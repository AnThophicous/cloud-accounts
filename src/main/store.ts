import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, safeStorage } from "electron";
import { fetchCodexUsageSnapshot, type CodexAuthTokens } from "./codex-usage.js";
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
  AccentColor,
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
  obscureEmails: boolean;
  themeMode: ThemeMode;
  accentColor: AccentColor;
  locale: Locale;
  preferredProvider: StoredAccount["provider"];
};

type DiskState = {
  accounts: PersistedAccount[];
  activeAccountId: string | null;
  onboardingSeen: boolean;
  obscureEmails: boolean;
  themeMode: ThemeMode;
  accentColor: AccentColor;
  locale: Locale;
  preferredProvider: StoredAccount["provider"];
};

const FILE_NAME = "cloud-accounts.json";
const USAGE_REFRESH_CACHE_TTL_MS = 45_000;
const AUTO_USAGE_REFRESH_INTERVAL_MS = 60_000;
const NEAR_EXHAUSTION_PERCENT = 10;
const MIN_SCHEDULER_DELAY_MS = 15_000;
const MAX_SCHEDULER_DELAY_MS = 60 * 60 * 1000;

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
    obscureEmails: false,
    themeMode: "system",
    accentColor: "#0ea5a8",
    locale: "en",
    preferredProvider: "chatgpt",
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function toTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
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
    (typeof secondaryUsed === "number" && secondaryUsed >= 75) ||
    isUsageBlocked(account)
  ) {
    return "warning";
  }
  if (account.quotaLimit > 0 && account.quotaRemaining / Math.max(1, account.quotaLimit) <= 0.25) return "warning";
  return "active";
}

function getSnapshotRemainingPercent(account: StoredAccount): number | null {
  const values = [account.usageSnapshot?.primary?.usedPercent, account.usageSnapshot?.secondary?.usedPercent]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .map((usedPercent) => Math.max(0, Math.min(100, 100 - usedPercent)));

  if (values.length === 0) return null;
  return Math.min(...values);
}

function getKnownRemainingPercent(account: StoredAccount): number | null {
  const values: number[] = [];
  if (account.quotaLimit > 0) {
    values.push(Math.max(0, Math.min(100, (account.quotaRemaining / Math.max(1, account.quotaLimit)) * 100)));
  } else if (account.quotaRemaining > 0) {
    values.push(Math.max(0, Math.min(100, account.quotaRemaining)));
  }

  const snapshotRemaining = getSnapshotRemainingPercent(account);
  if (snapshotRemaining != null) {
    values.push(snapshotRemaining);
  }

  if (values.length === 0) return null;
  return Math.min(...values);
}

function getNextResetAt(account: StoredAccount): string | null {
  const candidates = [account.usageSnapshot?.primary?.resetsAt, account.usageSnapshot?.secondary?.resetsAt, account.resetAt]
    .map((value) => ({ value, timestamp: toTimestamp(value) }))
    .filter((entry): entry is { value: string; timestamp: number } => Boolean(entry.value) && entry.timestamp != null)
    .sort((left, right) => left.timestamp - right.timestamp);

  return candidates[0]?.value ?? null;
}

function isUsageBlocked(account: StoredAccount, now = Date.now()): boolean {
  const blockedUntil = toTimestamp(account.usageBlockedUntil);
  return blockedUntil != null && blockedUntil > now;
}

function isNearExhaustion(account: StoredAccount): boolean {
  const remaining = getKnownRemainingPercent(account);
  return remaining != null && remaining <= NEAR_EXHAUSTION_PERCENT;
}

function isEligibleChatgptAccount(account: StoredAccount, now = Date.now()): boolean {
  if (account.provider !== "chatgpt") return false;
  const expiresAt = toTimestamp(account.expiresAt);
  if (expiresAt != null && expiresAt <= now) return false;
  return !isUsageBlocked(account, now);
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
      usageCheckedAt: typeof raw.usageCheckedAt === "string" ? raw.usageCheckedAt : null,
      usageBlockedUntil: typeof raw.usageBlockedUntil === "string" ? raw.usageBlockedUntil : null,
      depletedAt: typeof raw.depletedAt === "string" ? raw.depletedAt : null,
      lastTokenRefreshAt: typeof raw.lastTokenRefreshAt === "string" ? raw.lastTokenRefreshAt : null,
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
    usageCheckedAt: account.usageCheckedAt,
    usageBlockedUntil: account.usageBlockedUntil,
    depletedAt: account.depletedAt,
    lastTokenRefreshAt: account.lastTokenRefreshAt,
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
        obscureEmails: readBoolean(parsed.obscureEmails),
        themeMode: parseThemeMode(parsed.themeMode),
        accentColor: typeof parsed.accentColor === "string" && parsed.accentColor.trim() ? parsed.accentColor : "#0ea5a8",
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

  private accountAuth(account: StoredAccount): CodexAuthTokens {
    return {
      accessToken: account.accessToken,
      refreshToken: account.refreshToken || null,
      idToken: account.idToken || null,
      accountId: account.accountId,
    };
  }

  private rankAccountsByRemaining(accounts: StoredAccount[]): StoredAccount[] {
    return [...accounts].sort((left, right) => {
      const remainingDiff = (getKnownRemainingPercent(right) ?? -1) - (getKnownRemainingPercent(left) ?? -1);
      if (remainingDiff !== 0) return remainingDiff;

      const checkedDiff = (toTimestamp(right.usageCheckedAt) ?? 0) - (toTimestamp(left.usageCheckedAt) ?? 0);
      if (checkedDiff !== 0) return checkedDiff;

      return (toTimestamp(right.updatedAt) ?? 0) - (toTimestamp(left.updatedAt) ?? 0);
    });
  }

  private bestEligibleChatgptAccount(): StoredAccount | null {
    const eligible = this.state.accounts.filter((account) => isEligibleChatgptAccount(account));
    return this.rankAccountsByRemaining(eligible)[0] ?? null;
  }

  private markUsageAvailability(account: StoredAccount, fetchedAt: string): void {
    const remaining = getKnownRemainingPercent(account);
    const nextResetAt = getNextResetAt(account);
    account.usageCheckedAt = fetchedAt;

    if (remaining != null && remaining <= 0) {
      account.depletedAt = fetchedAt;
      account.usageBlockedUntil = nextResetAt;
      account.quotaLimit = Math.max(account.quotaLimit, 100);
      account.quotaRemaining = 0;
      return;
    }

    account.usageBlockedUntil = null;
    account.depletedAt = null;
  }

  private applyUsageSnapshot(account: StoredAccount, usage: CodexUsageSnapshot, fetchedAt: string): void {
    this.usageRefreshCache.set(account.id, { fetchedAt: Date.now(), snapshot: usage });
    account.usageSnapshot = usage;
    if (usage.planType) {
      account.planType = usage.planType;
    }
    if (usage.primary?.resetsAt) {
      account.resetAt = usage.primary.resetsAt;
    }

    const remaining = getSnapshotRemainingPercent(account);
    if (remaining != null) {
      account.quotaLimit = 100;
      account.quotaRemaining = Math.max(0, Math.round(remaining));
    }

    this.markUsageAvailability(account, fetchedAt);
    account.updatedAt = fetchedAt;
  }

  private async setActiveAccountId(id: string | null): Promise<void> {
    this.state.activeAccountId = id;
    await this.persist();
    await this.syncActiveProviderArtifacts();
  }

  private async switchToBestChatgptAccount(current: StoredAccount | null): Promise<boolean> {
    const best = this.bestEligibleChatgptAccount();
    if (!best || best.id === current?.id) {
      return false;
    }

    const currentRemaining = current ? getKnownRemainingPercent(current) : null;
    const bestRemaining = getKnownRemainingPercent(best);
    const shouldSwitch =
      !current ||
      current.provider !== "chatgpt" ||
      isUsageBlocked(current) ||
      isNearExhaustion(current) ||
      (bestRemaining != null && currentRemaining != null && bestRemaining > currentRemaining);

    if (!shouldSwitch) {
      return false;
    }

    await this.setActiveAccountId(best.id);
    return true;
  }

  private nextUsageDueAt(account: StoredAccount | null): number | null {
    if (!account || account.provider !== "chatgpt") return null;

    const now = Date.now();
    const blockedUntil = toTimestamp(account.usageBlockedUntil);
    if (blockedUntil != null && blockedUntil > now) {
      return blockedUntil;
    }

    const checkedAt = toTimestamp(account.usageCheckedAt);
    if (checkedAt == null) {
      return now;
    }

    return checkedAt + AUTO_USAGE_REFRESH_INTERVAL_MS;
  }

  private dueRevalidationCandidate(): StoredAccount | null {
    const now = Date.now();
    const candidates = this.state.accounts
      .filter((account) => account.provider === "chatgpt" && Boolean(account.depletedAt))
      .filter((account) => {
        const blockedUntil = toTimestamp(account.usageBlockedUntil);
        return blockedUntil != null && blockedUntil <= now;
      })
      .sort((left, right) => {
        const blockedDiff = (toTimestamp(left.usageBlockedUntil) ?? 0) - (toTimestamp(right.usageBlockedUntil) ?? 0);
        if (blockedDiff !== 0) return blockedDiff;
        return (toTimestamp(left.usageCheckedAt) ?? 0) - (toTimestamp(right.usageCheckedAt) ?? 0);
      });

    return candidates[0] ?? null;
  }

  private async revalidateReturnedAccount(candidate: StoredAccount): Promise<void> {
    const checkedAt = nowIso();

    const result = await fetchCodexUsageSnapshot(this.accountAuth(candidate), {
      persistAuthFile: false,
    });
    if (result) {
      if (result.refreshedAuth) {
        this.applyRefreshedAuth(candidate, result.refreshedAuth);
      }
      this.applyUsageSnapshot(candidate, result.snapshot, checkedAt);
    } else {
      candidate.usageCheckedAt = checkedAt;
      candidate.updatedAt = checkedAt;
    }
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
      obscureEmails: this.state.obscureEmails,
      platform: platformName(),
      deviceName: os.hostname(),
      appVersion: app.getVersion(),
      themeMode: this.state.themeMode,
      accentColor: this.state.accentColor,
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
      usageCheckedAt: draft.usageSnapshot ? timestamp : null,
      usageBlockedUntil: null,
      depletedAt: null,
      lastTokenRefreshAt: null,
      lastLoginAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      providerData: draft.providerData ?? null,
      providerStatus: draft.providerStatus ?? null,
    };
    this.markUsageAvailability(account, timestamp);

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
    await this.setActiveAccountId(account ? id : null);
    return this.snapshot();
  }

  async removeAccount(id: string): Promise<CloudAccountsState> {
    this.state.accounts = this.state.accounts.filter((item) => item.id !== id);
    if (this.state.activeAccountId === id) {
      this.state.activeAccountId = this.state.accounts[0]?.id ?? null;
    }
    await this.persist();
    await this.syncActiveProviderArtifacts();
    return this.snapshot();
  }

  async clearActiveAccount(): Promise<CloudAccountsState> {
    await this.setActiveAccountId(null);
    return this.snapshot();
  }

  async setOnboardingSeen(): Promise<CloudAccountsState> {
    this.state.onboardingSeen = true;
    await this.persist();
    return this.snapshot();
  }

  async setObscureEmails(obscureEmails: boolean): Promise<CloudAccountsState> {
    this.state.obscureEmails = Boolean(obscureEmails);
    await this.persist();
    return this.snapshot();
  }

  async setThemeMode(themeMode: ThemeMode): Promise<CloudAccountsState> {
    this.state.themeMode = themeMode;
    await this.persist();
    return this.snapshot();
  }

  async setAccentColor(accentColor: AccentColor): Promise<CloudAccountsState> {
    this.state.accentColor = typeof accentColor === "string" && accentColor.trim() ? accentColor.trim() : "#0ea5a8";
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
    const timestamp = nowIso();
    this.markUsageAvailability(account, account.usageCheckedAt ?? timestamp);
    account.updatedAt = timestamp;
    await this.persist();
    return this.snapshot();
  }

  private applyRefreshedAuth(
    account: StoredAccount,
    refreshedAuth: NonNullable<NonNullable<Awaited<ReturnType<typeof fetchCodexUsageSnapshot>>>["refreshedAuth"]>,
  ): void {
    account.accessToken = refreshedAuth.accessToken;
    account.refreshToken = refreshedAuth.refreshToken ?? "";
    if (refreshedAuth.idToken) {
      account.idToken = refreshedAuth.idToken;
    }
    if (refreshedAuth.accountId) {
      account.accountId = refreshedAuth.accountId;
    }
    if (refreshedAuth.expiresAt) {
      account.expiresAt = refreshedAuth.expiresAt;
    }
    account.lastTokenRefreshAt = nowIso();
  }

  async refreshCodexUsage(accountId: string, options: { force?: boolean } = {}): Promise<CloudAccountsState> {
    const account = this.state.accounts.find((item) => item.id === accountId);
    if (!account || account.provider !== "chatgpt") {
      return this.snapshot();
    }

    if (!options.force && isUsageBlocked(account)) {
      return this.snapshot();
    }

    const cached = this.usageRefreshCache.get(accountId);
    if (!options.force && cached && Date.now() - cached.fetchedAt < USAGE_REFRESH_CACHE_TTL_MS) {
      this.applyUsageSnapshot(account, cached.snapshot, nowIso());
      await this.persist();
      return this.snapshot();
    }

    const result = await fetchCodexUsageSnapshot(this.accountAuth(account), {
      persistAuthFile: this.state.activeAccountId === accountId,
    });
    if (!result) {
      return this.snapshot();
    }

    const { snapshot: usage, refreshedAuth } = result;
    if (refreshedAuth) {
      this.applyRefreshedAuth(account, refreshedAuth);
    }

    this.applyUsageSnapshot(account, usage, nowIso());
    await this.persist();
    if (this.state.activeAccountId === accountId) {
      await this.syncActiveProviderArtifacts();
    }
    return this.snapshot();
  }

  getNextUsageSchedulerDelayMs(): number {
    const active = this.activeAccount();
    if (!active || active.provider !== "chatgpt") {
      return AUTO_USAGE_REFRESH_INTERVAL_MS;
    }

    const now = Date.now();
    const dueTimes = this.state.accounts
      .filter((account) => account.provider === "chatgpt")
      .map((account) => this.nextUsageDueAt(account))
      .filter((value): value is number => value != null);

    if (dueTimes.length === 0) {
      return AUTO_USAGE_REFRESH_INTERVAL_MS;
    }

    const nextDueAt = Math.min(...dueTimes);
    const delay = Math.max(MIN_SCHEDULER_DELAY_MS, nextDueAt - now);
    return Math.min(delay, MAX_SCHEDULER_DELAY_MS);
  }

  private nextProbeCandidate(activeAccountId: string): StoredAccount | null {
    const now = Date.now();
    const candidates = this.rankAccountsByRemaining(
      this.state.accounts.filter((account) => {
        if (account.id === activeAccountId || account.provider !== "chatgpt") {
          return false;
        }
        if (isUsageBlocked(account, now)) {
          return false;
        }
        const checkedAt = toTimestamp(account.usageCheckedAt) ?? 0;
        return checkedAt + AUTO_USAGE_REFRESH_INTERVAL_MS <= now;
      }),
    );
    return candidates[0] ?? null;
  }

  async runUsageSchedulerTick(options: { forceActiveRefresh?: boolean } = {}): Promise<CloudAccountsState> {
    const activeBefore = this.activeAccount();
    if (!activeBefore || activeBefore.provider !== "chatgpt") {
      return this.snapshot();
    }

    const revalidationCandidate = this.dueRevalidationCandidate();
    if (revalidationCandidate) {
      await this.revalidateReturnedAccount(revalidationCandidate);
      await this.persist();
    }

    await this.switchToBestChatgptAccount(activeBefore);

    let active = this.activeAccount();
    if (!active || active.provider !== "chatgpt") {
      return this.snapshot();
    }

    if (isUsageBlocked(active)) {
      const switched = await this.switchToBestChatgptAccount(active);
      if (!switched) {
        return this.snapshot();
      }
      active = this.activeAccount();
      if (!active || active.provider !== "chatgpt") {
        return this.snapshot();
      }
    }

    const dueAt = this.nextUsageDueAt(active);
    if (!options.forceActiveRefresh && dueAt != null && dueAt > Date.now()) {
      return this.snapshot();
    }

    await this.refreshCodexUsage(active.id, { force: options.forceActiveRefresh });

    let refreshedActive = this.activeAccount();
    let switched = await this.switchToBestChatgptAccount(refreshedActive);
    refreshedActive = this.activeAccount();

    if (!switched && refreshedActive && refreshedActive.provider === "chatgpt" && (isUsageBlocked(refreshedActive) || isNearExhaustion(refreshedActive))) {
      const candidate = this.nextProbeCandidate(refreshedActive.id);
      if (candidate) {
        await this.refreshCodexUsage(candidate.id, { force: true });
        refreshedActive = this.activeAccount();
        switched = await this.switchToBestChatgptAccount(refreshedActive);
      }
    }

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
