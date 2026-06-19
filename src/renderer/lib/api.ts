import type {
  AccentColor,
  AccountDraft,
  CloudAccountsApi,
  CloudAccountsState,
  Locale,
  PublicAccount,
  ProviderId,
  ThemeMode,
} from "../../shared/types";

const STORAGE_KEY = "cloud-accounts.browser-state";

const fallbackState: CloudAccountsState = {
  accounts: [],
  activeAccountId: null,
  onboardingSeen: false,
  obscureEmails: false,
  platform: "linux",
  deviceName: "This computer",
  appVersion: "browser-demo",
  themeMode: "system",
  accentColor: "#0ea5a8",
  locale: "en",
  preferredProvider: "chatgpt",
};

function cloneState(state: CloudAccountsState): CloudAccountsState {
  return {
    ...state,
    accounts: state.accounts.map((account) => ({ ...account })),
  };
}

function readState(): CloudAccountsState {
  if (typeof window === "undefined") return cloneState(fallbackState);
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return cloneState(fallbackState);
  try {
    const parsed = JSON.parse(raw) as CloudAccountsState;
    return {
      ...fallbackState,
      ...parsed,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      activeAccountId: parsed.activeAccountId ?? null,
      onboardingSeen: Boolean(parsed.onboardingSeen),
      obscureEmails: Boolean(parsed.obscureEmails),
      deviceName: typeof parsed.deviceName === "string" && parsed.deviceName.trim() ? parsed.deviceName : "This computer",
      themeMode: parsed.themeMode === "light" || parsed.themeMode === "dark" ? parsed.themeMode : "system",
      accentColor: typeof parsed.accentColor === "string" && parsed.accentColor.trim() ? parsed.accentColor : "#0ea5a8",
      locale: parsed.locale === "pt" || parsed.locale === "es" ? parsed.locale : "en",
      preferredProvider: parsed.preferredProvider === "claude" ? "claude" : "chatgpt",
    };
  } catch {
    return cloneState(fallbackState);
  }
}

function writeState(state: CloudAccountsState): CloudAccountsState {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent(STORAGE_KEY, { detail: state }));
  }
  return state;
}

function publicFromDraft(draft: AccountDraft, active: boolean): PublicAccount {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    loginSessionId: draft.loginSessionId ?? null,
    name: draft.name,
    email: draft.email,
    provider: draft.provider,
    providerData: draft.providerData ?? null,
    expiresAt: draft.expiresAt,
    resetAt: draft.resetAt,
    quotaLimit: draft.quotaLimit,
    quotaRemaining: draft.quotaRemaining,
    usageCheckedAt: draft.usageSnapshot ? now : null,
    usageBlockedUntil: null,
    depletedAt: null,
    lastTokenRefreshAt: null,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
    accountId: draft.accountId ?? null,
    planType: draft.planType ?? null,
    isActive: active,
    status: "active" as const,
    tokenAgeMinutes: 0,
    providerStatus: draft.providerStatus ?? null,
    usageSnapshot: draft.usageSnapshot ?? null,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export function getCloudAccountsApi(): CloudAccountsApi {
  if (typeof window !== "undefined" && window.cloudAccounts) {
    return window.cloudAccounts;
  }

  return {
    async getState() {
      return readState();
    },
    async saveAccount(draft) {
      const current = readState();
      const account = publicFromDraft(draft, true);
      const next = writeState({
        ...current,
        onboardingSeen: true,
        activeAccountId: account.id,
        accounts: [account, ...current.accounts.filter((item) => item.id !== account.id)],
      });
      return next;
    },
    async activateAccount(id) {
      const current = readState();
      const next = writeState({
        ...current,
        activeAccountId: id,
      });
      return next;
    },
    async removeAccount(id) {
      const current = readState();
      const nextAccounts = current.accounts.filter((item) => item.id !== id);
      const next = writeState({
        ...current,
        accounts: nextAccounts,
        activeAccountId: current.activeAccountId === id ? nextAccounts[0]?.id ?? null : current.activeAccountId,
      });
      return next;
    },
    async clearActiveAccount() {
      const current = readState();
      return writeState({ ...current, activeAccountId: null });
    },
    async setOnboardingSeen() {
      const current = readState();
      return writeState({ ...current, onboardingSeen: true });
    },
    async setObscureEmails(obscureEmails: boolean) {
      const current = readState();
      return writeState({ ...current, obscureEmails });
    },
    async setThemeMode(themeMode: ThemeMode) {
      const current = readState();
      return writeState({ ...current, themeMode });
    },
    async setAccentColor(accentColor: AccentColor) {
      const current = readState();
      return writeState({ ...current, accentColor });
    },
    async setLocale(locale: Locale) {
      const current = readState();
      return writeState({ ...current, locale });
    },
    async setPreferredProvider(provider: ProviderId) {
      const current = readState();
      return writeState({ ...current, preferredProvider: provider === "claude" ? "claude" : "chatgpt" });
    },
    async openExternal(url) {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    async startChatGPTLogin() {
      const current = readState();
      const now = nowIso();
      const account = publicFromDraft(
        {
          loginSessionId: crypto.randomUUID(),
          name: "Demo ChatGPT Account",
          email: "demo@example.com",
          provider: "chatgpt",
          accessToken: "browser-demo-access-token",
          refreshToken: "browser-demo-refresh-token",
          idToken: "browser-demo-id-token",
          accountId: "browser-demo-account-id",
          planType: "pro",
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
          resetAt: new Date(Date.now() + 1000 * 60 * 60 * 6).toISOString(),
          quotaLimit: 100,
          quotaRemaining: 72,
          usageSnapshot: {
            fetchedAt: now,
            planType: "pro",
            profileEmail: "demo@example.com",
            profileName: "Demo ChatGPT Account",
            statsAsOf: now,
            generatedAt: now,
            statsError: null,
            primary: { usedPercent: 28, windowMinutes: 300, resetsAt: new Date(Date.now() + 1000 * 60 * 60 * 2).toISOString() },
            secondary: { usedPercent: 46, windowMinutes: 10080, resetsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 4).toISOString() },
            credits: { hasCredits: true, unlimited: false, balance: "7" },
            dailyUsageBuckets: [],
            weeklyUsageBuckets: [],
          },
        },
        true,
      );
      const next = writeState({
        ...current,
        onboardingSeen: true,
        activeAccountId: account.id,
        accounts: [{ ...account, createdAt: now, updatedAt: now, lastLoginAt: now }, ...current.accounts],
      });
      return next;
    },
    async startClaudeCapture() {
      const current = readState();
      const now = nowIso();
      const account = publicFromDraft(
        {
          loginSessionId: crypto.randomUUID(),
          name: "Claude Account",
          email: "local@claude",
          provider: "claude",
          accessToken: "browser-demo-access-token",
          refreshToken: "browser-demo-refresh-token",
          idToken: "browser-demo-id-token",
          accountId: null,
          planType: null,
          expiresAt: now,
          resetAt: now,
          quotaLimit: 100,
          quotaRemaining: 100,
          usageSnapshot: null,
          providerData: JSON.stringify({
            supported: false,
            reason: "Claude capture is only available in the desktop app.",
          }),
        },
        true,
      );
      const next = writeState({
        ...current,
        onboardingSeen: true,
        activeAccountId: account.id,
        accounts: [{ ...account, createdAt: now, updatedAt: now, lastLoginAt: now }, ...current.accounts],
      });
      return next;
    },
    async refreshUsage() {
      return readState();
    },
    async updateAccount(id, patch) {
      const current = readState();
      const accounts = current.accounts.map((item) =>
        item.id === id
          ? {
              ...item,
              ...(patch.name ? { name: patch.name } : null),
              ...(patch.email ? { email: patch.email } : null),
              ...(patch.expiresAt ? { expiresAt: patch.expiresAt } : null),
              ...(patch.resetAt ? { resetAt: patch.resetAt } : null),
              ...(typeof patch.quotaLimit === "number" ? { quotaLimit: patch.quotaLimit } : null),
              ...(typeof patch.quotaRemaining === "number" ? { quotaRemaining: patch.quotaRemaining } : null),
              updatedAt: nowIso(),
            }
          : item,
      );
      return writeState({ ...current, accounts });
    },
    onStateChanged(listener) {
      if (typeof window === "undefined") return () => undefined;
      const handler = (event: Event) => {
        const customEvent = event as CustomEvent<CloudAccountsState>;
        if (!customEvent.detail) return;
        listener(customEvent.detail);
      };
      window.addEventListener(STORAGE_KEY, handler as EventListener);
      return () => window.removeEventListener(STORAGE_KEY, handler as EventListener);
    },
  };
}
