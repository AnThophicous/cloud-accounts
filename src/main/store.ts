import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";
import { fetchCodexUsageSnapshot } from "./codex-usage.js";
import { syncCodexAuthFile } from "./codex-auth.js";
import {
  captureClaudeSnapshot,
  decodeClaudeProviderData,
  encodeClaudeProviderData,
  launchClaudeCode,
  maybeReadClaudeStatusCache,
  restoreClaudeSnapshot,
  waitForClaudeCredentialsSnapshot,
} from "./claude-provider.js";
import type {
  AccountDraft,
  AccountPatch,
  ClaudeRateLimits,
  CloudAccountsState,
  CodexUsageSnapshot,
  Locale,
  PlatformName,
  PublicAccount,
  StoredAccount,
  ThemeMode,
} from "../shared/types.js";

type SecretBundle = {
  accessToken: string;
  refreshToken: string;
  idToken: string;
};

type PersistedAccount = Omit<StoredAccount, "accessToken" | "refreshToken" | "idToken"> & {
  secrets: string;
  providerData?: string | null;
  providerStatus?: ClaudeRateLimits | null;
  usageSnapshot?: CodexUsageSnapshot | null;
};

type AppState = {
  accounts: StoredAccount[];
  activeAccountId: string | null;
  onboardingSeen: boolean;
  themeMode: ThemeMode;
  locale: Locale;
  preferredProvider: StoredAccount["provider"];
};

type DiskState = {
  accounts: PersistedAccount[];
  activeAccountId: string | null;
  onboardingSeen: boolean;
  themeMode: ThemeMode;
  locale: Locale;
  preferredProvider: StoredAccount["provider"];
};

const FILE_NAME = "cloud-accounts.json";
const USAGE_REFRESH_CACHE_TTL_MS = 45_000;

function platformName(): PlatformName {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return "linux";
}

function initialState(): AppState {
  return {
    accounts: [],
    activeAccountId: null,
    onboardingSeen: false,
    themeMode: "system",
    locale: "en",
    preferredProvider: "chatgpt",
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function tokenAgeMinutes(createdAt: string): number {
  const created = new Date(createdAt).getTime();
  return Math.max(0, Math.round((Date.now() - created) / 60000));
}

function computeStatus(account: StoredAccount): PublicAccount["status"] {
  const expiresAt = new Date(account.expiresAt).getTime();
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return "expired";
  const primaryUsed = account.usageSnapshot?.primary?.usedPercent;
  const secondaryUsed = account.usageSnapshot?.secondary?.usedPercent;
  if (
    (typeof primaryUsed === "number" && primaryUsed >= 75) ||
    (typeof secondaryUsed === "number" && secondaryUsed >= 75)
  ) {
    return "warning";
  }
  if (account.quotaLimit > 0 && account.quotaRemaining / Math.max(1, account.quotaLimit) <= 0.25) return "warning";
  return "active";
}

function toPublicAccount(account: StoredAccount, activeAccountId: string | null): PublicAccount {
  return {
    ...account,
    status: computeStatus(account),
    isActive: account.id === activeAccountId,
    tokenAgeMinutes: tokenAgeMinutes(account.createdAt),
  };
}

function parseThemeMode(value: unknown): ThemeMode {
  return value === "light" || value === "dark" ? value : "system";
}

function parseLocale(value: unknown): Locale {
  return value === "pt" || value === "es" ? value : "en";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function getSecretBundle(account: Record<string, unknown>): SecretBundle | null {
  const accessToken = readString(account.accessToken);
  const refreshToken = readString(account.refreshToken);
  const idToken = readString(account.idToken);
  if (accessToken || refreshToken || idToken) {
    return {
      accessToken,
      refreshToken,
      idToken,
    };
  }

  const encrypted = readString(account.secrets) || readString(account.encryptedSecrets);
  if (!encrypted) return null;

  const decrypted = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  return JSON.parse(decrypted) as SecretBundle;
}

function getProviderData(account: Record<string, unknown>): string | null {
  const raw = readString(account.providerData);
  if (raw) return raw;

  const encrypted = readString(account.encryptedProviderData);
  if (!encrypted) return null;

  const decrypted = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  return decrypted;
}

function normalizeAccount(raw: unknown): StoredAccount | null {
  if (!isObject(raw)) return null;

  try {
    const secrets = getSecretBundle(raw);
    if (!secrets) return null;

    return {
      id: readString(raw.id, randomUUID()),
      loginSessionId: typeof raw.loginSessionId === "string" ? raw.loginSessionId : null,
      name: readString(raw.name, "Unnamed account"),
      email: readString(raw.email),
      provider:
        raw.provider === "api" || raw.provider === "other" || raw.provider === "claude"
          ? raw.provider
          : "chatgpt",
      accessToken: secrets.accessToken,
      refreshToken: secrets.refreshToken,
      idToken: secrets.idToken,
      accountId: typeof raw.accountId === "string" ? raw.accountId : null,
    planType: typeof raw.planType === "string" ? raw.planType : null,
      expiresAt: readString(raw.expiresAt, nowIso()),
      resetAt: readString(raw.resetAt, nowIso()),
      quotaLimit: readNumber(raw.quotaLimit, 100),
      quotaRemaining: readNumber(raw.quotaRemaining, 100),
      usageSnapshot: isObject(raw.usageSnapshot) ? (raw.usageSnapshot as unknown as CodexUsageSnapshot) : null,
      lastLoginAt: readString(raw.lastLoginAt, nowIso()),
      createdAt: readString(raw.createdAt, nowIso()),
      updatedAt: readString(raw.updatedAt, nowIso()),
      providerData: getProviderData(raw),
      providerStatus: isObject(raw.providerStatus) ? (raw.providerStatus as ClaudeRateLimits) : null,
    };
  } catch {
    return null;
  }
}

function encryptSecretBundle(secrets: SecretBundle): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure storage is not available on this device.");
  }

  return safeStorage.encryptString(JSON.stringify(secrets)).toString("base64");
}

function toPersistedAccount(account: StoredAccount): PersistedAccount {
  return {
    id: account.id,
    loginSessionId: account.loginSessionId,
    name: account.name,
    email: account.email,
    provider: account.provider,
    accountId: account.accountId,
    planType: account.planType,
    expiresAt: account.expiresAt,
    resetAt: account.resetAt,
    quotaLimit: account.quotaLimit,
    quotaRemaining: account.quotaRemaining,
    usageSnapshot: account.usageSnapshot,
    lastLoginAt: account.lastLoginAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    providerData: account.providerData,
    providerStatus: account.providerStatus,
    secrets: encryptSecretBundle({
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      idToken: account.idToken,
    }),
  };
}

export class CloudAccountsStore {
  private state: AppState = initialState();
  private usageRefreshCache = new Map<string, { fetchedAt: number; snapshot: CodexUsageSnapshot }>();

  private filePath(): string {
    return path.join(app.getPath("userData"), FILE_NAME);
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath(), "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const rawAccounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
      const accounts = rawAccounts.map(normalizeAccount).filter((item): item is StoredAccount => Boolean(item));
      const activeAccountId =
        typeof parsed.activeAccountId === "string" && accounts.some((item) => item.id === parsed.activeAccountId)
          ? parsed.activeAccountId
          : null;

      this.state = {
        accounts,
        activeAccountId,
        onboardingSeen: readBoolean(parsed.onboardingSeen),
        themeMode: parseThemeMode(parsed.themeMode),
        locale: parseLocale(parsed.locale),
        preferredProvider:
          parsed.preferredProvider === "claude" || parsed.preferredProvider === "chatgpt"
            ? parsed.preferredProvider
            : "chatgpt",
      };
    } catch {
      this.state = initialState();
    }
  }

  private async persist(): Promise<void> {
    const filePath = this.filePath();
    const payload: DiskState = {
      ...this.state,
      accounts: this.state.accounts.map(toPersistedAccount),
    };
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  private activeAccount(): StoredAccount | null {
    if (!this.state.activeAccountId) return null;
    return this.state.accounts.find((item) => item.id === this.state.activeAccountId) ?? null;
  }

  private async syncActiveProviderArtifacts(): Promise<void> {
    const active = this.activeAccount();
    if (!active) {
      await syncCodexAuthFile(null);
      return;
    }

    if (active.provider === "chatgpt") {
      await syncCodexAuthFile(active);
      return;
    }

    if (active.provider === "claude") {
      await restoreClaudeSnapshot(decodeClaudeProviderData(active.providerData));
    }
  }

  private snapshot(): CloudAccountsState {
    return {
      accounts: this.state.accounts.map((account) => toPublicAccount(account, this.state.activeAccountId)),
      activeAccountId: this.state.activeAccountId,
      onboardingSeen: this.state.onboardingSeen,
      platform: platformName(),
      appVersion: app.getVersion(),
      themeMode: this.state.themeMode,
      locale: this.state.locale,
      preferredProvider: this.state.preferredProvider,
    };
  }

  async getState(): Promise<CloudAccountsState> {
    return this.snapshot();
  }

  async saveAccount(
    draft: AccountDraft,
    options: { syncCodexAuth?: boolean } = {},
  ): Promise<CloudAccountsState> {
    const newId = randomUUID();
    const timestamp = nowIso();
    const activeBefore = this.state.activeAccountId;
    const account: StoredAccount = {
      id: newId,
      loginSessionId: draft.loginSessionId ?? null,
      name: draft.name.trim(),
      email: draft.email.trim(),
      provider: draft.provider,
      accessToken: draft.accessToken.trim(),
      refreshToken: draft.refreshToken.trim(),
      idToken: (draft.idToken ?? "").trim(),
      accountId: draft.accountId ?? null,
      planType: draft.planType ?? null,
      expiresAt: draft.expiresAt,
      resetAt: draft.resetAt,
      quotaLimit: draft.quotaLimit,
      quotaRemaining: draft.quotaRemaining,
      usageSnapshot: draft.usageSnapshot ?? null,
      lastLoginAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      providerData: draft.providerData ?? null,
      providerStatus: draft.providerStatus ?? null,
    };

    const matchIndex = this.state.accounts.findIndex((item) => {
      if (account.loginSessionId && item.loginSessionId === account.loginSessionId) return true;
      if (account.accountId && item.accountId === account.accountId) return true;
      return item.email.toLowerCase() === account.email.toLowerCase();
    });

    if (matchIndex >= 0) {
      const existing = this.state.accounts[matchIndex];
      const matchedWasActive = existing.id === activeBefore;
      this.state.accounts[matchIndex] = {
        ...existing,
        ...account,
        id: existing.id,
        createdAt: existing.createdAt,
      };
      this.state.accounts.unshift(this.state.accounts.splice(matchIndex, 1)[0]);
      if (matchedWasActive) {
        this.state.activeAccountId = this.state.accounts[0]?.id ?? null;
      }
    } else {
      this.state.accounts = [account, ...this.state.accounts];
      this.state.activeAccountId = newId;
    }

    this.state.onboardingSeen = true;
    await this.persist();
    if (options.syncCodexAuth !== false) {
      await this.syncActiveProviderArtifacts();
    }
    return this.snapshot();
  }

  async activateAccount(id: string): Promise<CloudAccountsState> {
    const account = this.state.accounts.find((item) => item.id === id) ?? null;
    this.state.activeAccountId = account ? id : null;
    await this.persist();
    await this.syncActiveProviderArtifacts();
    return this.snapshot();
  }

  async removeAccount(id: string): Promise<CloudAccountsState> {
    this.state.accounts = this.state.accounts.filter((item) => item.id !== id);
    if (this.state.activeAccountId === id) {
      this.state.activeAccountId = this.state.accounts[0]?.id ?? null;
    }
    await this.persist();
    await syncCodexAuthFile(this.activeAccount());
    return this.snapshot();
  }

  async clearActiveAccount(): Promise<CloudAccountsState> {
    this.state.activeAccountId = null;
    await this.persist();
    await this.syncActiveProviderArtifacts();
    return this.snapshot();
  }

  async setOnboardingSeen(): Promise<CloudAccountsState> {
    this.state.onboardingSeen = true;
    await this.persist();
    return this.snapshot();
  }

  async setThemeMode(themeMode: ThemeMode): Promise<CloudAccountsState> {
    this.state.themeMode = themeMode;
    await this.persist();
    return this.snapshot();
  }

  async setLocale(locale: Locale): Promise<CloudAccountsState> {
    this.state.locale = locale;
    await this.persist();
    return this.snapshot();
  }

  async setPreferredProvider(provider: StoredAccount["provider"]): Promise<CloudAccountsState> {
    this.state.preferredProvider = provider === "claude" ? "claude" : "chatgpt";
    await this.persist();
    return this.snapshot();
  }

  async updateAccount(id: string, patch: AccountPatch): Promise<CloudAccountsState> {
    const account = this.state.accounts.find((item) => item.id === id);
    if (!account) {
      return this.snapshot();
    }

    if (typeof patch.name === "string") account.name = patch.name.trim();
    if (typeof patch.email === "string") account.email = patch.email.trim();
    if (typeof patch.expiresAt === "string") account.expiresAt = patch.expiresAt;
    if (typeof patch.resetAt === "string") account.resetAt = patch.resetAt;
    if (typeof patch.quotaLimit === "number" && Number.isFinite(patch.quotaLimit)) {
      account.quotaLimit = patch.quotaLimit;
    }
    if (typeof patch.quotaRemaining === "number" && Number.isFinite(patch.quotaRemaining)) {
      account.quotaRemaining = patch.quotaRemaining;
    }
    account.updatedAt = nowIso();
    await this.persist();
    return this.snapshot();
  }

  async refreshCodexUsage(accountId: string, options: { force?: boolean } = {}): Promise<CloudAccountsState> {
    const account = this.state.accounts.find((item) => item.id === accountId);
    if (!account || account.provider !== "chatgpt") {
      return this.snapshot();
    }

    const cached = this.usageRefreshCache.get(accountId);
    if (!options.force && cached && Date.now() - cached.fetchedAt < USAGE_REFRESH_CACHE_TTL_MS) {
      account.usageSnapshot = cached.snapshot;
      if (cached.snapshot.planType) {
        account.planType = cached.snapshot.planType;
      }
      if (cached.snapshot.primary?.resetsAt) {
        account.resetAt = cached.snapshot.primary.resetsAt;
      }
      if (typeof cached.snapshot.primary?.usedPercent === "number") {
        account.quotaLimit = 100;
        account.quotaRemaining = Math.max(0, 100 - Math.round(cached.snapshot.primary.usedPercent));
      }
      account.updatedAt = nowIso();
      await this.persist();
      return this.snapshot();
    }

    const usage = await fetchCodexUsageSnapshot();
    if (!usage) {
      return this.snapshot();
    }

    this.usageRefreshCache.set(accountId, { fetchedAt: Date.now(), snapshot: usage });
    account.usageSnapshot = usage;
    if (usage.planType) {
      account.planType = usage.planType;
    }
    if (usage.primary?.resetsAt) {
      account.resetAt = usage.primary.resetsAt;
    }
    if (typeof usage.primary?.usedPercent === "number") {
      account.quotaLimit = 100;
      account.quotaRemaining = Math.max(0, 100 - Math.round(usage.primary.usedPercent));
    }
    account.updatedAt = nowIso();
    await this.persist();
    return this.snapshot();
  }

  async startClaudeCapture(): Promise<CloudAccountsState> {
    const bootstrap = await captureClaudeSnapshot();
    if (!bootstrap.supported) {
      throw new Error(bootstrap.reason ?? "Claude is not supported on this platform.");
    }

    await launchClaudeCode();
    const fileSnapshot = await waitForClaudeCredentialsSnapshot();
    if (!fileSnapshot) {
      throw new Error("Claude credentials file was not created.");
    }
    const status = (await maybeReadClaudeStatusCache()) ?? null;
    const providerData = encodeClaudeProviderData({
      supported: true,
      credentialsPath: fileSnapshot.credentialsPath,
      credentialsSnapshot: fileSnapshot.raw,
      status,
    });

    const account = await this.saveAccount(
      {
        loginSessionId: randomUUID(),
        name: status?.model ? `Claude ${status.model}` : "Claude Account",
        email: "local@claude",
        provider: "claude",
        accessToken: "",
        refreshToken: "",
        idToken: "",
        accountId: null,
        planType: null,
        expiresAt: nowIso(),
        resetAt: nowIso(),
        quotaLimit: 100,
        quotaRemaining: 100,
        providerData,
        providerStatus: status,
      },
      { syncCodexAuth: false },
    );
    return account;
  }
}
