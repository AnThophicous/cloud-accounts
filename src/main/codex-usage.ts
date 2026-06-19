import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type {
  CodexUsageBucket,
  CodexUsageCredits,
  CodexUsageSnapshot,
  CodexUsageWindow,
} from "../shared/types.js";

const DEFAULT_ISSUER = "https://auth.openai.com";
const DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

export type CodexAuthTokens = {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  accountId: string | null;
};

export type CodexUsageFetchResult = {
  snapshot: CodexUsageSnapshot;
  refreshedAuth: {
    accessToken: string;
    refreshToken: string | null;
    idToken: string | null;
    accountId: string | null;
    expiresAt: string | null;
  } | null;
};

type CodexAuthFile = Record<string, unknown> & {
  auth_mode?: string;
  account_id?: string | null;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
  } | null;
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
};

type CodexUsageResponse = Record<string, unknown> & {
  plan_type?: string | null;
  rate_limit?: Record<string, unknown> | null;
  credits?: Record<string, unknown> | null;
};

type CodexProfileResponse = Record<string, unknown> & {
  metadata?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
  stats?: Record<string, unknown> | null;
  daily_usage_buckets?: unknown[] | null;
  weekly_usage_buckets?: unknown[] | null;
  lifetime_tokens?: unknown;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
};

class HttpError extends Error {
  status: number;
  url: string;

  constructor(url: string, status: number, statusText: string, body: string) {
    super(`${url} failed: ${status} ${statusText}${body ? `; body=${body.slice(0, 300)}` : ""}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseJwtClaims(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    const claims = JSON.parse(payload);
    return isRecord(claims) ? claims : null;
  } catch {
    return null;
  }
}

function parseJwtExpiration(jwt: string | null | undefined): string | null {
  if (!jwt) return null;
  const claims = parseJwtClaims(jwt);
  const exp = readNumber(claims?.exp);
  if (exp == null) return null;
  return new Date(exp * 1000).toISOString();
}

function extractAuthClaims(claims: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!claims) return null;
  const nested = claims["https://api.openai.com/auth"];
  return isRecord(nested) ? nested : claims;
}

function extractAccountIdFromToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const claims = parseJwtClaims(token);
  const auth = extractAuthClaims(claims);
  const value =
    (auth?.chatgpt_account_id as string | undefined) ??
    (auth?.chatgpt_account_user_id as string | undefined) ??
    (auth?.user_id as string | undefined) ??
    (auth?.chatgpt_user_id as string | undefined);
  return readString(value);
}

function readAuthPath(): string {
  return path.join(app.getPath("home"), ".codex", "auth.json");
}

function readConfigPath(): string {
  return path.join(app.getPath("home"), ".codex", "config.toml");
}

function authFilePath(): string {
  return readAuthPath();
}

async function writeJsonAtomic(filePath: string, payload: string): Promise<void> {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `.auth-${process.pid}-${Date.now()}.tmp`);

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(tempPath, payload, { encoding: "utf8", mode: 0o600 });

  try {
    await fs.rename(tempPath, filePath);
  } catch {
    await fs.rm(filePath, { force: true }).catch(() => undefined);
    await fs.rename(tempPath, filePath);
  }
}

async function readCodexAuthFile(): Promise<CodexAuthTokens | null> {
  try {
    const raw = await fs.readFile(authFilePath(), "utf8");
    const parsed = JSON.parse(raw) as CodexAuthFile;
    const accessToken = readString(parsed.tokens?.access_token) ?? readString(parsed.access_token);
    if (!accessToken) return null;
    const idToken = readString(parsed.tokens?.id_token) ?? readString(parsed.id_token);
    return {
      accessToken,
      refreshToken: readString(parsed.tokens?.refresh_token) ?? readString(parsed.refresh_token),
      idToken,
      accountId: readString(parsed.account_id) ?? extractAccountIdFromToken(accessToken) ?? extractAccountIdFromToken(idToken),
    };
  } catch {
    return null;
  }
}

async function readChatgptBaseUrl(): Promise<string> {
  try {
    const raw = await fs.readFile(readConfigPath(), "utf8");
    const match = raw.match(/^\s*chatgpt_base_url\s*=\s*["']([^"']+)["']\s*$/m);
    if (match?.[1]) {
      return match[1].replace(/\/?$/, "/");
    }
  } catch {
    // Ignore and fall back to the public ChatGPT backend.
  }

  return "https://chatgpt.com/backend-api/";
}

function resolveUsageUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/?$/, "/");
  return new URL("wham/usage", normalized).toString();
}

function resolveProfileUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/?$/, "/");
  return new URL("wham/profiles/me", normalized).toString();
}

function resolveUsageCandidates(baseUrl: string): string[] {
  const normalized = baseUrl.replace(/\/?$/, "/");
  const base = normalized.endsWith("/backend-api/") ? normalized : `${normalized.replace(/\/?$/, "")}/backend-api/`;
  return [
    new URL("wham/usage", base).toString(),
    "https://chatgpt.com/backend-api/wham/usage",
    "https://api.chatgpt-staging.com/backend-api/wham/usage",
    "http://localhost:8080/backend-api/wham/usage",
    "https://localhost:8443/backend-api/wham/usage",
  ];
}

function resolveProfileCandidates(baseUrl: string): string[] {
  const normalized = baseUrl.replace(/\/?$/, "/");
  const base = normalized.endsWith("/backend-api/") ? normalized : `${normalized.replace(/\/?$/, "")}/backend-api/`;
  return [
    new URL("wham/profiles/me", base).toString(),
    "https://chatgpt.com/backend-api/wham/profiles/me",
    "https://api.chatgpt-staging.com/backend-api/wham/profiles/me",
    "http://localhost:8080/backend-api/wham/profiles/me",
    "https://localhost:8443/backend-api/wham/profiles/me",
  ];
}

function toIso(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  return null;
}

function normalizeWindow(raw: unknown): CodexUsageWindow | null {
  if (!isRecord(raw)) return null;

  const usedPercent =
    readNumber(raw.used_percent) ??
    readNumber(raw.usedPercent) ??
    readNumber(raw.percent_used) ??
    readNumber(raw.percentUsed);

  const windowSeconds =
    readNumber(raw.limit_window_seconds) ?? readNumber(raw.window_duration_seconds) ?? readNumber(raw.windowSeconds);
  const windowMinutes = readNumber(raw.windowDurationMins) ?? (windowSeconds != null ? Math.round(windowSeconds / 60) : null);
  const resetAt = toIso(raw.reset_at) ?? toIso(raw.resetsAt) ?? toIso(raw.resetAt);

  return {
    usedPercent,
    windowMinutes,
    resetsAt: resetAt,
  };
}

function normalizeCredits(raw: unknown): CodexUsageCredits | null {
  if (!isRecord(raw)) return null;
  const balance = readString(raw.balance) ?? (readNumber(raw.balance) != null ? String(readNumber(raw.balance)) : null);
  const hasCredits = readBoolean(raw.has_credits) ?? readBoolean(raw.hasCredits);
  const unlimited = readBoolean(raw.unlimited);
  if (balance == null && hasCredits == null && unlimited == null) return null;
  return {
    balance,
    hasCredits,
    unlimited,
  };
}

function bucketLabel(date: string | null, kind: "daily" | "weekly", index: number): string {
  if (!date) return `${kind === "daily" ? "D" : "W"}${index + 1}`;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
  }).format(parsed);
}

function normalizeBucket(raw: unknown, kind: "daily" | "weekly", index: number): CodexUsageBucket | null {
  if (!isRecord(raw)) return null;

  const date =
    readString(raw.date) ??
    readString(raw.day) ??
    readString(raw.start_date) ??
    readString(raw.bucket_date) ??
    readString(raw.window_start) ??
    readString(raw.windowStart) ??
    toIso(raw.timestamp) ??
    toIso(raw.start_at);

  const tokens =
    readNumber(raw.tokens) ??
    readNumber(raw.token_count) ??
    readNumber(raw.tokenCount) ??
    readNumber(raw.value);

  const usedPercent =
    readNumber(raw.used_percent) ??
    readNumber(raw.usedPercent) ??
    readNumber(raw.usage_percent) ??
    readNumber(raw.usagePercent) ??
    readNumber(raw.percent_used) ??
    readNumber(raw.percentUsed);

  const remainingPercent =
    readNumber(raw.remaining_percent) ??
    readNumber(raw.remainingPercent) ??
    (usedPercent != null ? Math.max(0, Math.min(100, 100 - usedPercent)) : null);

  const windowDurationMins = readNumber(raw.window_duration_mins);
  const windowSeconds =
    readNumber(raw.limit_window_seconds) ??
    readNumber(raw.window_duration_seconds) ??
    readNumber(raw.windowSeconds) ??
    (windowDurationMins != null ? windowDurationMins * 60 : null);

  const windowMinutes =
    readNumber(raw.windowDurationMins) ?? readNumber(raw.window_minutes) ?? (windowSeconds != null ? Math.round(windowSeconds / 60) : null);

  return {
    label: bucketLabel(date, kind, index),
    date,
    tokens,
    usedPercent,
    remainingPercent,
    windowMinutes,
  };
}

function normalizeBuckets(raw: unknown, kind: "daily" | "weekly"): CodexUsageBucket[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, index) => normalizeBucket(entry, kind, index)).filter((item): item is CodexUsageBucket => Boolean(item));
}

async function fetchJson<T>(url: string, auth: CodexAuthTokens): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: "https://chatgpt.com",
      Referer: "https://chatgpt.com/codex/settings/usage",
      ...(auth.accountId ? { "ChatGPT-Account-ID": auth.accountId } : {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new HttpError(url, response.status, response.statusText, body);
  }

  return (await response.json()) as T;
}

function isAuthFailure(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status === 401 || error.status === 403;
  }

  if (error instanceof AggregateError) {
    return error.errors.some((entry) => isAuthFailure(entry));
  }

  return false;
}

async function fetchUsageAndProfile(
  usageUrls: string[],
  profileUrls: string[],
  auth: CodexAuthTokens,
): Promise<{ usage: CodexUsageResponse; profile: CodexProfileResponse }> {
  const usagePromise = Promise.any(usageUrls.map((url) => fetchJson<CodexUsageResponse>(url, auth)));
  const profilePromise = Promise.any(profileUrls.map((url) => fetchJson<CodexProfileResponse>(url, auth)));
  const [usage, profile] = await Promise.all([usagePromise, profilePromise]);
  return { usage, profile };
}

export async function refreshAccessToken(
  auth: CodexAuthTokens,
  options: { persistAuthFile?: boolean } = {},
): Promise<CodexAuthTokens | null> {
  if (!auth.refreshToken) return null;

  const tokenResponse = await fetch(`${DEFAULT_ISSUER}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: DEFAULT_CLIENT_ID,
      refresh_token: auth.refreshToken,
    }).toString(),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text().catch(() => "");
    throw new Error(`Token refresh failed: ${tokenResponse.status} ${tokenResponse.statusText}${body ? `; body=${body.slice(0, 200)}` : ""}`);
  }

  const tokens = (await tokenResponse.json()) as TokenResponse;
  const nextAccountId =
    extractAccountIdFromToken(tokens.access_token) ??
    extractAccountIdFromToken(tokens.id_token) ??
    auth.accountId;
  const next: CodexAuthTokens = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? auth.refreshToken,
    idToken: tokens.id_token ?? auth.idToken,
    accountId: nextAccountId,
  };

  if (options.persistAuthFile !== false) {
    try {
      const raw = await fs.readFile(authFilePath(), "utf8");
      const parsed = JSON.parse(raw) as CodexAuthFile;
      const nextFile: CodexAuthFile = {
        ...parsed,
        tokens: {
          ...(parsed.tokens ?? {}),
          access_token: next.accessToken,
          refresh_token: next.refreshToken ?? undefined,
          id_token: next.idToken ?? parsed.tokens?.id_token,
        },
        access_token: next.accessToken,
        refresh_token: next.refreshToken ?? undefined,
        id_token: next.idToken ?? parsed.tokens?.id_token,
        account_id: next.accountId ?? parsed.account_id ?? null,
        last_refresh: new Date().toISOString(),
      };
      await writeJsonAtomic(authFilePath(), `${JSON.stringify(nextFile, null, 2)}\n`);
    } catch {
      // Keep the fresh token in memory even if the file rewrite fails.
    }
  }

  return next;
}

function mergeUsageSnapshot(
  usage: CodexUsageResponse | null,
  profile: CodexProfileResponse | null,
): CodexUsageSnapshot {
  const rateLimit = usage?.rate_limit ?? null;
  const profileMeta = profile?.metadata ?? null;
  const profileInfo = profile?.profile ?? null;
  const profileStats = profile?.stats ?? null;

  const primary = normalizeWindow((rateLimit && (rateLimit.primary_window ?? rateLimit.primary)) ?? null) ?? null;
  const secondary = normalizeWindow((rateLimit && (rateLimit.secondary_window ?? rateLimit.secondary)) ?? null) ?? null;
  const stats = isRecord(profileStats) ? profileStats : null;

  return {
    fetchedAt: new Date().toISOString(),
    planType: readString(usage?.plan_type) ?? readString(profileInfo?.plan_type) ?? readString(profileStats?.plan_type),
    profileEmail: readString(profileInfo?.email) ?? readString(profileInfo?.profile_email) ?? readString(profileStats?.email),
    profileName: readString(profileInfo?.name) ?? readString(profileInfo?.display_name) ?? readString(profileStats?.name),
    statsAsOf: toIso(profileMeta?.stats_as_of) ?? toIso(profileMeta?.statsAsOf),
    generatedAt: toIso(profileMeta?.generated_at) ?? toIso(profileMeta?.generatedAt),
    statsError: readString(profileMeta?.stats_error) ?? readString(profileMeta?.statsError),
    primary,
    secondary,
    credits: normalizeCredits(usage?.credits),
    dailyUsageBuckets: normalizeBuckets(stats?.daily_usage_buckets, "daily"),
    weeklyUsageBuckets: normalizeBuckets(stats?.weekly_usage_buckets, "weekly"),
  };
}

export async function fetchCodexUsageSnapshot(
  sourceAuth?: CodexAuthTokens,
  options: { persistAuthFile?: boolean } = {},
): Promise<CodexUsageFetchResult | null> {
  const auth = sourceAuth ?? (await readCodexAuthFile());
  if (!auth) return null;
  const baseUrl = await readChatgptBaseUrl();
  const usageUrls = resolveUsageCandidates(baseUrl);
  const profileUrls = resolveProfileCandidates(baseUrl);

  try {
    const { usage, profile } = await fetchUsageAndProfile(usageUrls, profileUrls, auth);

    const hasUsageData = Boolean(usage?.rate_limit);
    const hasProfileData = Boolean(
      profile?.stats?.daily_usage_buckets || profile?.stats?.weekly_usage_buckets || profile?.metadata || profile?.profile,
    );

    if ((!hasUsageData || !hasProfileData) && auth.refreshToken) {
      const refreshed = await refreshAccessToken(auth, options);
      if (!refreshed) return null;
      const { usage: retryUsage, profile: retryProfile } = await fetchUsageAndProfile(usageUrls, profileUrls, refreshed);
      return {
        snapshot: mergeUsageSnapshot(retryUsage ?? null, retryProfile ?? null),
        refreshedAuth: {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          idToken: refreshed.idToken,
          accountId: refreshed.accountId,
          expiresAt: parseJwtExpiration(refreshed.accessToken),
        },
      };
    }

    return {
      snapshot: mergeUsageSnapshot(usage, profile),
      refreshedAuth: null,
    };
  } catch (error) {
    if (auth.refreshToken && isAuthFailure(error)) {
      try {
        const refreshed = await refreshAccessToken(auth, options);
        if (!refreshed) return null;
        const { usage, profile } = await fetchUsageAndProfile(usageUrls, profileUrls, refreshed);
        return {
          snapshot: mergeUsageSnapshot(usage ?? null, profile ?? null),
          refreshedAuth: {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            idToken: refreshed.idToken,
            accountId: refreshed.accountId,
            expiresAt: parseJwtExpiration(refreshed.accessToken),
          },
        };
      } catch (refreshError) {
        console.warn(
          `Codex usage refresh retry failed: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`,
        );
        return null;
      }
    }

    console.warn(
      `Codex usage refresh failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
