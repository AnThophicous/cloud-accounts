import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { OnboardingPage } from "./components/onboarding";
import { AccountStatusEmoji } from "./components/account-status-emoji";
import { Button } from "./components/ui/button";
import { BoxCheckCircle, BoxCog, BoxLogOut, BoxPlus, BoxRightArrow, BoxTrash } from "./components/ui/boxicon";
import { useLocaleCopy } from "./i18n";
import { getCloudAccountsApi } from "./lib/api";
import { cn } from "./lib/utils";
import type {
  AccountPatch,
  CloudAccountsState,
  CodexUsageBucket,
  CodexUsageSnapshot,
  Locale,
  PublicAccount,
  ThemeMode,
} from "../shared/types";

const cloudAccounts = getCloudAccountsApi();
const ACCENT_OPTIONS = ["#0ea5a8", "#2563eb", "#f97316", "#e11d48", "#7c3aed", "#22c55e"];

const fallbackState: CloudAccountsState = {
  accounts: [],
  activeAccountId: null,
  onboardingSeen: false,
  obscureEmails: false,
  platform: "linux",
  deviceName: "This computer",
  appVersion: "0.1.0",
  themeMode: "system",
  accentColor: "#0ea5a8",
  locale: "en",
  preferredProvider: "chatgpt",
};

type AccountDraftState = {
  name: string;
};

function localeTag(locale: Locale): string {
  if (locale === "pt") return "pt-BR";
  if (locale === "es") return "es-ES";
  return "en-US";
}

function setThemeDocument(themeMode: ThemeMode): void {
  if (typeof document === "undefined") return;
  if (themeMode === "system") {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.classList.remove("dark");
  } else {
    document.documentElement.setAttribute("data-theme", themeMode);
    document.documentElement.classList.toggle("dark", themeMode === "dark");
  }
}

function setAccentDocument(accentColor: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--app-accent", accentColor);
  document.documentElement.style.setProperty("--app-accent-soft", `${accentColor}1a`);
  document.documentElement.style.setProperty("--app-accent-brand", accentColor);
  document.documentElement.style.setProperty("--app-accent-brand-soft", `${accentColor}1a`);
}

function maskedIdentity(
  account: PublicAccount | null,
  obscureEmails: boolean,
  t: (key: string, fallback?: string) => string,
): string {
  if (!account) return t("app.notSet", "Not set");
  const trimmedName = account.name.trim();
  const trimmedEmail = account.email.trim();
  if (!obscureEmails) return trimmedEmail || trimmedName || t("app.notSet", "Not set");
  if (trimmedName && !trimmedName.includes("@")) return trimmedName;
  return t("app.privateAccount", "Private account");
}

function visibleName(
  account: PublicAccount | null,
  obscureEmails: boolean,
  t: (key: string, fallback?: string) => string,
): string {
  if (!account) return t("app.notSet", "Not set");
  const trimmedName = account.name.trim();
  if (trimmedName && !trimmedName.includes("@")) return trimmedName;
  if (obscureEmails) return t("app.privateAccount", "Private account");
  return trimmedName || account.email.trim() || t("app.notSet", "Not set");
}

function formatDate(value: string | null | undefined, locale: Locale, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(localeTag(locale), {
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatCompactNumber(value: number | null | undefined, locale: Locale): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(localeTag(locale), {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function remainingPercentFromUsed(usedPercent: number | null | undefined): number | null {
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) return null;
  return Math.max(0, Math.min(100, Math.round(100 - usedPercent)));
}

function knownRemainingPercent(account: PublicAccount | null, snapshot: CodexUsageSnapshot | null): number | null {
  if (!account) return null;
  if (snapshot?.credits?.unlimited) return 100;

  const values: number[] = [];
  const primary = remainingPercentFromUsed(snapshot?.primary?.usedPercent);
  const secondary = remainingPercentFromUsed(snapshot?.secondary?.usedPercent);

  if (primary != null) values.push(primary);
  if (secondary != null) values.push(secondary);

  if (account.quotaLimit > 0) {
    values.push(Math.max(0, Math.min(100, Math.round((account.quotaRemaining / Math.max(1, account.quotaLimit)) * 100))));
  }

  if (values.length === 0) return null;
  return Math.min(...values);
}

function hasFutureDate(value: string | null | undefined): boolean {
  if (!value) return false;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed > Date.now();
}

function mainHeadline(
  account: PublicAccount | null,
  snapshot: CodexUsageSnapshot | null,
  t: (key: string, fallback?: string) => string,
): string {
  if (snapshot?.credits?.unlimited) return t("app.unlimitedCredits", "Unlimited credits");
  if (snapshot?.credits?.balance && snapshot.credits.balance !== "0") {
    return `${snapshot.credits.balance} ${t("app.creditBalance", "credits available")}`;
  }
  const remaining = remainingPercentFromUsed(snapshot?.primary?.usedPercent);
  if (remaining == null) return t("app.usageUnavailable", "Usage unavailable");
  if (account && hasFutureDate(account.usageBlockedUntil)) return t("app.primaryWindowExhausted", "5-hour window exhausted");
  return `${remaining}% ${t("app.primaryWindowLeft", "left in the 5-hour window")}`;
}

function statusText(
  account: PublicAccount | null,
  snapshot: CodexUsageSnapshot | null,
  t: (key: string, fallback?: string) => string,
): string {
  if (!account) return t("app.idle", "Idle");
  if (account.status === "expired") return t("app.expired", "Expired");
  const remaining = knownRemainingPercent(account, snapshot);
  if (remaining === 0) return t("app.noCredits", "No credits");
  if (account.usageBlockedUntil && hasFutureDate(account.usageBlockedUntil)) return t("app.windowResetPending", "Waiting for reset");
  if (remaining != null && remaining <= 15) return t("app.nearLimit", "Near limit");
  return t("app.activeLabel", "Active");
}

function usageLine(snapshot: CodexUsageSnapshot | null, locale: Locale, t: (key: string, fallback?: string) => string): string {
  if (!snapshot?.primary && !snapshot?.secondary) return t("app.usageUnavailable", "Usage unavailable");
  const parts = [
    snapshot?.primary ? `${t("app.fiveHourWindow", "5-hour window")} ${formatPercent(remainingPercentFromUsed(snapshot.primary.usedPercent))}` : "",
    snapshot?.primary?.resetsAt ? `${t("app.resets", "Resets")} ${formatDate(snapshot.primary.resetsAt, locale, "")}` : "",
    snapshot?.secondary ? `${t("app.weeklyWindow", "weekly window")} ${formatPercent(remainingPercentFromUsed(snapshot.secondary.usedPercent))}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function chartSeriesFromBuckets(buckets: CodexUsageBucket[], localeLabel: string) {
  return buckets.map((bucket, index) => ({
    name: bucket.label || `${localeLabel} ${index + 1}`,
    tokens: bucket.tokens ?? 0,
  }));
}

export default function App() {
  const [state, setState] = useState<CloudAccountsState>(fallbackState);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginBusy, setLoginBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  const [draft, setDraft] = useState<AccountDraftState>({ name: "" });
  const { t } = useMemo(() => useLocaleCopy(state.locale), [state.locale]);

  const selectedAccount = useMemo(
    () => state.accounts.find((account) => account.id === selectedId) ?? state.accounts[0] ?? null,
    [selectedId, state.accounts],
  );
  const activeAccount = useMemo(
    () => state.accounts.find((account) => account.isActive) ?? null,
    [state.accounts],
  );
  const usageSnapshot = selectedAccount?.usageSnapshot ?? activeAccount?.usageSnapshot ?? null;
  const chartData = useMemo(() => {
    const source = usageSnapshot?.dailyUsageBuckets?.length ? usageSnapshot.dailyUsageBuckets : usageSnapshot?.weeklyUsageBuckets ?? [];
    return chartSeriesFromBuckets(source, t("app.now", "Now"));
  }, [t, usageSnapshot]);

  useEffect(() => {
    let mounted = true;
    cloudAccounts
      .getState()
      .then((next) => {
        if (!mounted) return;
        setState(next);
        setSelectedId(next.activeAccountId ?? next.accounts[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : t("app.loadFailed", "Failed to load account data."));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [t]);

  useEffect(() => cloudAccounts.onStateChanged((next) => {
    setState(next);
    setSelectedId((current) => current ?? next.activeAccountId ?? next.accounts[0]?.id ?? null);
  }), []);

  useEffect(() => setThemeDocument(state.themeMode), [state.themeMode]);
  useEffect(() => setAccentDocument(state.accentColor), [state.accentColor]);

  useEffect(() => {
    if (state.themeMode !== "system" || typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applySystemTheme = () => setThemeDocument("system");
    applySystemTheme();
    media.addEventListener("change", applySystemTheme);
    return () => media.removeEventListener("change", applySystemTheme);
  }, [state.themeMode]);

  useEffect(() => {
    if (!selectedAccount) return;
    setDraft({ name: selectedAccount.name });
  }, [selectedAccount?.id]);

  const syncState = async (task: Promise<CloudAccountsState>) => {
    setError(null);
    const next = await task;
    setState(next);
    if (!selectedId || !next.accounts.some((account) => account.id === selectedId)) {
      setSelectedId(next.activeAccountId ?? next.accounts[0]?.id ?? null);
    }
    return next;
  };

  const connectAccount = async () => {
    setLoginBusy(true);
    try {
      await syncState(cloudAccounts.startChatGPTLogin());
      setSettingsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("app.loginFailed", "Login failed."));
    } finally {
      setLoginBusy(false);
    }
  };

  const refreshUsage = async () => {
    setRefreshBusy(true);
    try {
      await syncState(cloudAccounts.refreshUsage());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("app.refreshFailed", "Could not refresh usage."));
    } finally {
      setRefreshBusy(false);
    }
  };

  const activateAccount = async (id: string) => {
    await syncState(cloudAccounts.activateAccount(id));
    setSelectedId(id);
    setDockOpen(false);
  };

  const removeAccount = async (id: string) => {
    const next = await syncState(cloudAccounts.removeAccount(id));
    setSelectedId(next.activeAccountId ?? next.accounts[0]?.id ?? null);
  };

  const disconnectAccount = async () => {
    await syncState(cloudAccounts.clearActiveAccount());
  };

  const saveName = async () => {
    if (!selectedAccount) return;
    setSaving(true);
    try {
      const patch: AccountPatch = { name: draft.name.trim() || selectedAccount.name };
      await syncState(cloudAccounts.updateAccount(selectedAccount.id, patch));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("app.saveNameFailed", "Could not save the account name."));
    } finally {
      setSaving(false);
    }
  };

  const onboarding = !state.onboardingSeen || state.accounts.length === 0;

  if (loading) {
    return <div className="app-shell flex h-full items-center justify-center text-sm text-[var(--app-fg-soft)]">{t("app.loading", "Loading Cloud Accounts...")}</div>;
  }

  if (onboarding) {
    return (
      <OnboardingPage
        onConnect={connectAccount}
        loading={loginBusy}
        currentTheme={state.themeMode}
        currentLocale={state.locale}
        currentAccentColor={state.accentColor}
        platform={state.platform}
        deviceName={state.deviceName}
        onThemeChange={async (mode) => {
          await syncState(cloudAccounts.setThemeMode(mode));
        }}
        onAccentColorChange={async (color) => {
          await syncState(cloudAccounts.setAccentColor(color));
        }}
        onLocaleChange={async (locale) => {
          await syncState(cloudAccounts.setLocale(locale));
        }}
        onStartEmpty={async () => {
          await syncState(cloudAccounts.setOnboardingSeen());
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <div
        className="dock-hover-zone"
        onMouseEnter={() => setDockOpen(true)}
        onMouseLeave={() => setDockOpen(false)}
      >
        <div className="dock-trigger" />
        <AnimatePresence>
          {dockOpen ? (
            <motion.div
              className="account-dock"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">
                  {t("app.accounts", "Accounts")}
                </div>
                <button type="button" className="dock-add" onClick={connectAccount} disabled={loginBusy} aria-label={t("app.connectAccount", "Connect account")}>
                  <BoxPlus className="text-base" />
                </button>
              </div>
              <div className="mt-3 grid gap-2">
                {state.accounts.map((account) => {
                  const selected = account.id === selectedAccount?.id;
                  return (
                    <button
                      key={account.id}
                      type="button"
                      className={cn("dock-account", selected && "dock-account-active")}
                      onClick={() => void activateAccount(account.id)}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <AccountStatusEmoji account={account} className="h-[18px] w-[18px] shrink-0" />
                        <span className="truncate text-sm text-[var(--app-fg)]">{maskedIdentity(account, state.obscureEmails, t)}</span>
                      </div>
                      <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--app-fg-soft)]">
                        {account.isActive ? t("app.activeLabel", "Active") : t("app.select", "Select")}
                      </span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="mx-auto flex h-full w-full max-w-[1180px] flex-col overflow-y-auto px-4 pb-6 pt-12 no-scrollbar md:px-5 md:pb-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">
              {t("app.cloudAccounts", "Cloud Accounts")}
            </div>
            <div className="mt-2 text-sm text-[var(--app-fg-soft)]">
              {state.deviceName} · {selectedAccount?.provider === "claude" ? "Claude" : "ChatGPT"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} aria-label={t("app.openSettings", "Open settings")}>
              <BoxCog className="text-lg" />
            </Button>
          </div>
        </div>

        {error ? <div className="app-banner mt-4">{error}</div> : null}

        {selectedAccount ? (
          <motion.div
            key={selectedAccount.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="grid min-h-0 gap-4 pt-4 xl:grid-cols-[minmax(0,1.42fr)_320px]"
          >
            <section className="page-card flex min-h-0 flex-col overflow-hidden px-5 py-5 md:px-6 md:py-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 max-w-[680px]">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">
                    {selectedAccount.isActive ? t("app.connectedAccount", "Connected account") : t("app.previewingAccount", "Previewing account")}
                  </div>
                  <h1 className="mt-4 max-w-[680px] text-[clamp(2.45rem,5vw,3.9rem)] font-semibold leading-[0.94] tracking-[-0.07em] text-[var(--app-fg)]">
                    {mainHeadline(selectedAccount, usageSnapshot, t)}
                  </h1>
                  <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--app-fg-soft)]">
                    {usageLine(usageSnapshot, state.locale, t)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={refreshUsage} disabled={refreshBusy || loginBusy}>
                    <BoxRightArrow className="text-base" />
                    {refreshBusy ? t("app.refreshing", "Refreshing...") : t("app.refreshLiveUsage", "Refresh live usage")}
                  </Button>
                  {!selectedAccount.isActive ? (
                    <Button size="sm" onClick={() => void activateAccount(selectedAccount.id)}>
                      {t("app.activateSelected", "Activate selected")}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="mt-8 grid gap-3 md:grid-cols-3">
                <MetricCard label={t("app.status", "Status")} value={statusText(selectedAccount, usageSnapshot, t)} detail={maskedIdentity(selectedAccount, state.obscureEmails, t)} />
                <MetricCard label={t("app.usage5hRemaining", "5h remaining")} value={formatPercent(remainingPercentFromUsed(usageSnapshot?.primary?.usedPercent))} detail={formatDate(usageSnapshot?.primary?.resetsAt, state.locale, t("app.noResetTime", "No reset time"))} />
                <MetricCard label={t("app.usageCredits", "Usage credits")} value={usageSnapshot?.credits?.unlimited ? t("app.unlimited", "Unlimited") : usageSnapshot?.credits?.balance ?? "—"} detail={usageSnapshot?.planType?.toUpperCase() ?? t("app.notSet", "Not set")} />
              </div>

              <div className="mt-8 rounded-[18px] border border-[var(--app-line)] bg-[var(--app-surface)] px-4 py-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">
                      {t("app.codexUsage", "Codex usage")}
                    </div>
                    <div className="mt-2 text-lg font-medium text-[var(--app-fg)]">
                      {visibleName(selectedAccount, state.obscureEmails, t)}
                    </div>
                  </div>
                  <div className="text-sm text-[var(--app-fg-soft)]">
                    {chartData.length > 0 ? `${formatCompactNumber(chartData[chartData.length - 1]?.tokens ?? 0, state.locale)} ${t("app.tokens", "tokens")}` : t("app.noHistoryYet", "No history yet")}
                  </div>
                </div>
                <div className="mt-4 h-[clamp(240px,32vh,300px)] overflow-hidden">
                  {chartData.length > 1 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="usageFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--app-accent-brand)" stopOpacity={0.18} />
                            <stop offset="100%" stopColor="var(--app-accent-brand)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="var(--app-line)" strokeDasharray="3 6" vertical={false} />
                        <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "var(--app-fg-soft)", fontSize: 11 }} />
                        <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--app-fg-soft)", fontSize: 11 }} tickFormatter={(value) => formatCompactNumber(Number(value), state.locale)} width={52} />
                        <Tooltip content={<ChartTooltip locale={state.locale} />} cursor={{ stroke: "var(--app-line-strong)", strokeDasharray: "3 3" }} />
                        <Area type="monotone" dataKey="tokens" stroke="var(--app-accent-brand)" strokeWidth={1.8} fill="url(#usageFill)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-[var(--app-fg-soft)]">
                      {t("app.noHistoryYet", "No history yet")}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <aside className="space-y-4">
              <div className="page-card px-5 py-5">
                <div className="flex items-center gap-3">
                  <AccountStatusEmoji account={selectedAccount} className="h-7 w-7" />
                  <div className="min-w-0">
                    <div className="truncate text-base font-medium text-[var(--app-fg)]">{visibleName(selectedAccount, state.obscureEmails, t)}</div>
                    <div className="truncate text-sm text-[var(--app-fg-soft)]">{maskedIdentity(selectedAccount, state.obscureEmails, t)}</div>
                  </div>
                </div>
                <div className="mt-5 space-y-4">
                  <DetailRow label={t("app.plan", "Plan")} value={usageSnapshot?.planType?.toUpperCase() ?? t("app.notSet", "Not set")} />
                  <DetailRow label={t("app.profileName", "Profile name")} value={visibleName(selectedAccount, state.obscureEmails, t)} />
                  <DetailRow label={t("app.tokenExpires", "Token expires")} value={formatDate(selectedAccount.expiresAt, state.locale, t("app.notSet", "Not set"))} />
                  <DetailRow label={t("app.resetWindow", "Reset window")} value={formatDate(selectedAccount.resetAt, state.locale, t("app.notSet", "Not set"))} />
                </div>
              </div>

              <div className="page-card px-5 py-5">
                <label className="text-[11px] uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">
                  {t("app.displayName", "Display name")}
                </label>
                <input className="field mt-3" value={draft.name} onChange={(event) => setDraft({ name: event.target.value })} placeholder={t("app.accountName", "Account name")} />
                <div className="mt-3 flex gap-2">
                  <Button variant="outline" onClick={saveName} disabled={saving}>
                    <BoxCheckCircle className="text-base" />
                    {saving ? t("app.saving", "Saving...") : t("app.saveName", "Save name")}
                  </Button>
                </div>
              </div>

              <div className="page-card px-5 py-5">
                <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">
                  {selectedAccount.isActive ? t("app.connectedAccount", "Connected account") : t("app.preview", "Preview")}
                </div>
                <div className="mt-3 text-sm leading-6 text-[var(--app-fg-soft)]">
                  {selectedAccount.isActive
                    ? t("app.quietLocalView", "Quiet local view for the account that is active right now.")
                    : t("app.previewHint", "Select any account to inspect it first, then activate it when you want to switch the live Codex session.")}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {selectedAccount.isActive ? (
                    <Button variant="ghost" onClick={disconnectAccount}>
                      <BoxLogOut className="text-base" />
                      {t("app.signOut", "Sign out")}
                    </Button>
                  ) : (
                    <Button onClick={() => void activateAccount(selectedAccount.id)}>
                      {t("app.activateSelected", "Activate selected")}
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => void removeAccount(selectedAccount.id)}>
                    <BoxTrash className="text-base" />
                    {t("app.removeAccount", "Remove account")}
                  </Button>
                </div>
              </div>
            </aside>
          </motion.div>
        ) : null}
      </div>

      <AnimatePresence>
        {settingsOpen ? (
          <motion.div className="fixed inset-0 z-50 bg-black/22" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSettingsOpen(false)}>
            <motion.aside className="settings-sheet" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} transition={{ duration: 0.18 }} onClick={(event) => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">{t("app.settings", "Settings")}</div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-[var(--app-fg)]">{t("app.appAppearance", "Appearance")}</h2>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(false)}>
                  <BoxRightArrow className="rotate-180 text-lg" />
                </Button>
              </div>

              <div className="mt-6 grid gap-5">
                <section>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">{t("app.theme", "Theme")}</div>
                  <div className="mt-3 inline-flex rounded-[12px] border border-[var(--app-line)] bg-[var(--app-surface)] p-1">
                    {(["light", "dark"] as ThemeMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={cn("segmented-item", state.themeMode === mode && "segmented-item-active")}
                        onClick={() => void syncState(cloudAccounts.setThemeMode(mode))}
                      >
                        {mode === "light" ? t("app.light", "Light") : t("app.dark", "Dark")}
                      </button>
                    ))}
                  </div>
                </section>

                <section>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">{t("app.language", "Language")}</div>
                  <div className="mt-3 inline-flex rounded-[12px] border border-[var(--app-line)] bg-[var(--app-surface)] p-1">
                    {([
                      ["en", "English"],
                      ["pt", "Português"],
                      ["es", "Español"],
                    ] as Array<[Locale, string]>).map(([locale, label]) => (
                      <button key={locale} type="button" className={cn("segmented-item", state.locale === locale && "segmented-item-active")} onClick={() => void syncState(cloudAccounts.setLocale(locale))}>
                        {label}
                      </button>
                    ))}
                  </div>
                </section>

                <section>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">{t("app.themeBuilder", "Theme builder")}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {ACCENT_OPTIONS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={cn("accent-swatch", state.accentColor === color && "accent-swatch-active")}
                        style={{ backgroundColor: color }}
                        onClick={() => void syncState(cloudAccounts.setAccentColor(color))}
                        aria-label={color}
                      />
                    ))}
                    <input className="accent-input" type="color" value={state.accentColor} onChange={(event) => void syncState(cloudAccounts.setAccentColor(event.target.value))} />
                  </div>
                </section>

                <section>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">{t("app.privacyMode", "Privacy mode")}</div>
                  <div className="mt-3 rounded-[18px] border border-[var(--app-line)] bg-[var(--app-surface)] px-4 py-4">
                    <div className="text-sm text-[var(--app-fg)]">{t("app.privacyModeHint", "Hide account emails in the interface when you need to record or share screenshots.")}</div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        variant={state.obscureEmails ? "default" : "outline"}
                        size="sm"
                        onClick={() => void syncState(cloudAccounts.setObscureEmails(true))}
                      >
                        {t("app.hideEmails", "Hide emails")}
                      </Button>
                      <Button
                        variant={!state.obscureEmails ? "default" : "outline"}
                        size="sm"
                        onClick={() => void syncState(cloudAccounts.setObscureEmails(false))}
                      >
                        {t("app.showEmails", "Show emails")}
                      </Button>
                    </div>
                  </div>
                </section>
              </div>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[16px] border border-[var(--app-line)] bg-[var(--app-surface)] px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">{label}</div>
      <div className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-[var(--app-fg)]">{value}</div>
      <div className="mt-2 text-sm text-[var(--app-fg-soft)]">{detail}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-[var(--app-fg-soft)]">{label}</span>
      <span className="max-w-[58%] text-right text-[var(--app-fg)]">{value}</span>
    </div>
  );
}

function ChartTooltip({ active, payload, label, locale }: { active?: boolean; payload?: Array<{ value?: number | string }>; label?: string; locale: Locale }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[14px] border border-[var(--app-line)] bg-[var(--app-surface)] px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
      <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">{label}</div>
      <div className="mt-1 text-sm text-[var(--app-fg)]">{formatCompactNumber(Number(payload[0]?.value ?? 0), locale)} tokens</div>
    </div>
  );
}
