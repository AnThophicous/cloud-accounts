export type PlatformName = "macos" | "windows" | "linux";
export type ThemeMode = "system" | "light" | "dark";
export type Locale = "en" | "pt" | "es";
export type ProviderId = "chatgpt" | "claude" | "api" | "other";

export type AccountStatus = "active" | "warning" | "expired" | "idle";

export interface CodexUsageWindow {
  usedPercent: number | null;
  windowMinutes: number | null;
  resetsAt: string | null;
}

export interface CodexUsageCredits {
  hasCredits: boolean | null;
  unlimited: boolean | null;
  balance: string | null;
}

export interface CodexUsageBucket {
  label: string;
  date: string | null;
  tokens: number | null;
  usedPercent: number | null;
  remainingPercent: number | null;
  windowMinutes: number | null;
}

export interface CodexUsageSnapshot {
  fetchedAt: string;
  planType: string | null;
  profileEmail: string | null;
  profileName: string | null;
  statsAsOf: string | null;
  generatedAt: string | null;
  statsError: string | null;
  primary: CodexUsageWindow | null;
  secondary: CodexUsageWindow | null;
  credits: CodexUsageCredits | null;
  dailyUsageBuckets: CodexUsageBucket[];
  weeklyUsageBuckets: CodexUsageBucket[];
}

export interface ClaudeRateLimits {
  fiveHourUsedPercent?: number;
  fiveHourResetAt?: string;
  sevenDayUsedPercent?: number;
  sevenDayResetAt?: string;
  model?: string;
}

export interface ClaudeProviderData {
  supported: boolean;
  reason?: string;
  credentialsPath?: string;
  credentialsSnapshot?: string;
  status?: ClaudeRateLimits | null;
}

export interface StoredAccount {
  id: string;
  loginSessionId: string | null;
  name: string;
  email: string;
  provider: ProviderId;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  accountId: string | null;
  planType: string | null;
  expiresAt: string;
  resetAt: string;
  quotaLimit: number;
  quotaRemaining: number;
  usageSnapshot: CodexUsageSnapshot | null;
  lastLoginAt: string;
  createdAt: string;
  updatedAt: string;
  providerData: string | null;
  providerStatus: ClaudeRateLimits | null;
}

export interface PublicAccount extends Omit<
  StoredAccount,
  "accessToken" | "refreshToken" | "idToken" | "accountId" | "planType"
> {
  status: AccountStatus;
  isActive: boolean;
  tokenAgeMinutes: number;
  accountId: string | null;
  planType: string | null;
  providerStatus: ClaudeRateLimits | null;
}

export interface CloudAccountsState {
  accounts: PublicAccount[];
  activeAccountId: string | null;
  onboardingSeen: boolean;
  platform: PlatformName;
  appVersion: string;
  themeMode: ThemeMode;
  locale: Locale;
  preferredProvider: ProviderId;
}

export interface AccountDraft {
  loginSessionId?: string | null;
  name: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accountId?: string | null;
  planType?: string | null;
  expiresAt: string;
  resetAt: string;
  quotaLimit: number;
  quotaRemaining: number;
  provider: StoredAccount["provider"];
  providerData?: string | null;
  providerStatus?: ClaudeRateLimits | null;
  usageSnapshot?: CodexUsageSnapshot | null;
}

export interface AccountPatch {
  name?: string;
  email?: string;
  expiresAt?: string;
  resetAt?: string;
  quotaLimit?: number;
  quotaRemaining?: number;
}

export interface CloudAccountsApi {
  getState(): Promise<CloudAccountsState>;
  saveAccount(draft: AccountDraft): Promise<CloudAccountsState>;
  activateAccount(id: string): Promise<CloudAccountsState>;
  removeAccount(id: string): Promise<CloudAccountsState>;
  clearActiveAccount(): Promise<CloudAccountsState>;
  setOnboardingSeen(): Promise<CloudAccountsState>;
  setThemeMode(mode: ThemeMode): Promise<CloudAccountsState>;
  setLocale(locale: Locale): Promise<CloudAccountsState>;
  setPreferredProvider(provider: ProviderId): Promise<CloudAccountsState>;
  openExternal(url: string): Promise<void>;
  startChatGPTLogin(): Promise<CloudAccountsState>;
  startClaudeCapture(): Promise<CloudAccountsState>;
  refreshUsage(): Promise<CloudAccountsState>;
  updateAccount(id: string, patch: AccountPatch): Promise<CloudAccountsState>;
  onStateChanged(listener: (state: CloudAccountsState) => void): () => void;
}
