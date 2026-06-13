import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { AnimatedThemeToggler } from "./components/ui/animated-theme-toggler";
import { Button } from "./components/ui/button";
import {
  BoxCheckCircle,
  BoxChevronLeft,
  BoxChevronRight,
  BoxCog,
  BoxLogOut,
  BoxPlus,
  BoxRightArrow,
  BoxTrash,
} from "./components/ui/boxicon";
import { useLocaleCopy } from "./i18n";
import { getCloudAccountsApi } from "./lib/api";
import { cn } from "./lib/utils";
import type {
  AccountPatch,
  CloudAccountsState,
  CodexUsageBucket,
  CodexUsageSnapshot,
  Locale,
  ProviderId,
  PublicAccount,
  ThemeMode,
} from "../shared/types";

const cloudAccounts = getCloudAccountsApi();

const fallbackState: CloudAccountsState = {
  accounts: [],
  activeAccountId: null,
  onboardingSeen: false,
  platform: "linux",
  appVersion: "0.1.0",
  themeMode: "system",
  locale: "en",
  preferredProvider: "chatgpt",
};

type AccountDraftState = {
  name: string;
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatPlatform(platform: CloudAccountsState["platform"]): string {
  if (platform === "macos") return "macOS";
  if (platform === "windows") return "Windows";
  return "Linux";
}

function formatCountdown(value?: string | null): string {
  if (!value) return "Not set";
  const target = new Date(value).getTime();
  if (!Number.isFinite(target)) return "Not set";
  const diff = Math.max(0, target - Date.now());
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function formatCompactNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function remainingPercentFromUsed(usedPercent: number | null | undefined): number | null {
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) return null;
  return Math.max(0, Math.min(100, Math.round(100 - usedPercent)));
}

function statusTone(status: PublicAccount["status"]): string {
  if (status === "warning") return "text-[var(--app-fg)]";
  if (status === "expired") return "text-[var(--app-fg)]";
  return "text-[var(--app-fg)]";
}

function providerLabel(provider: ProviderId): string {
  return provider === "claude" ? "Claude" : "ChatGPT";
}

function preferredLoginLabel(provider: ProviderId): string {
  return provider === "claude" ? "Claude beta" : "Codex / ChatGPT";
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

function chartSeriesFromBuckets(buckets: CodexUsageBucket[], fallbackRemaining: number | null) {
  if (buckets.length > 0) {
    return buckets.map((bucket, index) => {
      const remaining = bucket.remainingPercent ?? remainingPercentFromUsed(bucket.usedPercent) ?? fallbackRemaining ?? 0;
      return {
        name: bucket.label || `P${index + 1}`,
        tokens: bucket.tokens ?? 0,
        remaining,
      };
    });
  }

  if (fallbackRemaining == null) return [];
  return [
    { name: "Now", tokens: 0, remaining: fallbackRemaining },
    { name: "Now", tokens: 0, remaining: fallbackRemaining },
  ];
}

function latestTrendValue(data: Array<{ tokens: number }>, valueKey: "tokens"): number {
  if (data.length === 0) return 0;
  const latest = data[data.length - 1]?.[valueKey] ?? 0;
  if (latest > 0) return latest;
  const recentPositive = [...data].reverse().find((item) => (item[valueKey] ?? 0) > 0)?.[valueKey];
  return recentPositive ?? 0;
}

function usageHeadline(snapshot: CodexUsageSnapshot | null): string {
  const remaining = remainingPercentFromUsed(snapshot?.primary?.usedPercent);
  if (remaining == null) return "Usage unavailable";
  return `${remaining}% Left of Crédits`;
}

function usageLine(snapshot: CodexUsageSnapshot | null, kind: "primary" | "secondary"): string {
  const window = kind === "primary" ? snapshot?.primary : snapshot?.secondary;
  if (!window) return "Usage unavailable";
  const remaining = remainingPercentFromUsed(window.usedPercent);
  const reset = window.resetsAt ? formatDate(window.resetsAt) : "Not set";
  if (remaining == null) return `Usage unavailable${reset !== "Not set" ? ` · resets ${reset}` : ""}`;
  const label = kind === "primary" ? "5 Hours" : "Weekly";
  return `${remaining}% Remaining of ${label} Usage${reset !== "Not set" ? ` · resets ${reset}` : ""}`;
}

function usageBarWidth(snapshot: CodexUsageSnapshot | null): string {
  const remaining = remainingPercentFromUsed(snapshot?.primary?.usedPercent);
  return `${remaining ?? 0}%`;
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [draft, setDraft] = useState<AccountDraftState>({ name: "" });
  const { t } = useMemo(() => useLocaleCopy(state.locale), [state.locale]);

  const statusLabel = (status: PublicAccount["status"]): string => {
    if (status === "warning") return t("app.nearLimit", "Near limit");
    if (status === "expired") return t("app.expired", "Expired");
    return t("app.activeLabel", "Active");
  };

  const accountIndex = useMemo(() => new Map(state.accounts.map((account) => [account.id, account])), [state.accounts]);
  const selectedAccount = accountIndex.get(selectedId ?? "") ?? state.accounts[0] ?? null;
  const activeAccount = useMemo(
    () => state.accounts.find((account) => account.isActive) ?? null,
    [state.accounts],
  );
  const previewingAccount = Boolean(selectedAccount && activeAccount && selectedAccount.id !== activeAccount.id);

  const usageSnapshot = selectedAccount?.usageSnapshot ?? activeAccount?.usageSnapshot ?? null;
  const dailyTrendSeries = useMemo(
    () => chartSeriesFromBuckets(usageSnapshot?.dailyUsageBuckets ?? [], remainingPercentFromUsed(usageSnapshot?.primary?.usedPercent)),
    [usageSnapshot],
  );
  const weeklyTrendSeries = useMemo(
    () => chartSeriesFromBuckets(usageSnapshot?.weeklyUsageBuckets ?? [], remainingPercentFromUsed(usageSnapshot?.secondary?.usedPercent)),
    [usageSnapshot],
  );

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
        setError(err instanceof Error ? err.message : "Failed to load account data.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return cloudAccounts.onStateChanged((next) => {
      setState(next);
      setSelectedId(next.activeAccountId ?? next.accounts[0]?.id ?? null);
    });
  }, []);

  useEffect(() => {
    setThemeDocument(state.themeMode);
  }, [state.themeMode]);

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
    setSelectedId(next.activeAccountId ?? next.accounts[0]?.id ?? null);
    return next;
  };

  const connectAccount = async () => {
    setLoginBusy(true);
    try {
      await syncState(state.preferredProvider === "claude" ? cloudAccounts.startClaudeCapture() : cloudAccounts.startChatGPTLogin());
      setSettingsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoginBusy(false);
    }
  };

  const refreshUsage = async () => {
    setRefreshBusy(true);
    try {
      await syncState(cloudAccounts.refreshUsage());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh usage.");
    } finally {
      setRefreshBusy(false);
    }
  };

  const activateAccount = async (id: string) => {
    await syncState(cloudAccounts.activateAccount(id));
    setSelectedId(id);
  };

  const removeAccount = async (id: string) => {
    const next = await syncState(cloudAccounts.removeAccount(id));
    setSelectedId(next.activeAccountId ?? next.accounts[0]?.id ?? null);
  };

  const disconnectAccount = async () => {
    await syncState(cloudAccounts.clearActiveAccount());
  };

  const updateTheme = async (themeMode: ThemeMode) => {
    await syncState(cloudAccounts.setThemeMode(themeMode));
  };

  const updateLocale = async (locale: Locale) => {
    await syncState(cloudAccounts.setLocale(locale));
  };

  const updateProvider = async (provider: ProviderId) => {
    await syncState(cloudAccounts.setPreferredProvider(provider));
  };

  const saveName = async () => {
    if (!selectedAccount) return;
    setSaving(true);
    try {
      const patch: AccountPatch = {
        name: draft.name.trim() || selectedAccount.name,
      };
      await syncState(cloudAccounts.updateAccount(selectedAccount.id, patch));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the account name.");
    } finally {
      setSaving(false);
    }
  };

  const onboarding = !state.onboardingSeen || state.accounts.length === 0;

  if (loading) {
    return (
      <div className="app-shell flex h-full items-center justify-center px-6">
        <div className="text-sm text-[var(--app-fg-soft)]">{t("app.loading", "Loading Cloud Accounts…")}</div>
      </div>
    );
  }

  if (onboarding) {
    return (
      <OnboardingPage
        onConnect={connectAccount}
        loading={loginBusy}
        currentTheme={state.themeMode}
        currentLocale={state.locale}
        onThemeChange={updateTheme}
        onLocaleChange={updateLocale}
        onStartEmpty={async () => {
          await syncState(cloudAccounts.setOnboardingSeen());
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <div className="flex h-full">
        <aside
          className={cn(
            "flex shrink-0 flex-col border-r border-[var(--app-line)] bg-[var(--app-bg-elevated)] transition-[width] duration-300",
            sidebarCollapsed ? "w-[72px]" : "w-[286px]",
          )}
        >
          <div className={cn("border-b border-[var(--app-line)]", sidebarCollapsed ? "px-2 py-3" : "px-4 py-4")}>
            <div className="flex items-center justify-between gap-3">
              <div className={cn("min-w-0 transition-all duration-200", sidebarCollapsed ? "w-0 opacity-0" : "opacity-100")}>
                <p className="inline-label">{t("app.cloudAccounts", "Cloud Accounts")}</p>
                <h1 className="mt-2 font-display text-xl">{t("app.vault", "Vault")}</h1>
                <p className="mt-1 text-xs text-[var(--app-fg-soft)]">
                  {state.accounts.length} {t("app.saved", "saved")} · {formatPlatform(state.platform)}
                </p>
              </div>
              <button
                type="button"
                className={cn(
                  "inline-flex items-center justify-center rounded-full border border-[var(--app-line)] bg-[var(--app-surface)] text-[var(--app-fg)] transition-all duration-200 hover:border-[var(--app-line-strong)] hover:bg-[var(--app-surface-strong)]",
                  sidebarCollapsed ? "h-12 w-12 shadow-[0_8px_20px_rgba(0,0,0,0.08)]" : "h-11 w-11",
                )}
                onClick={() => setSidebarCollapsed((value) => !value)}
                aria-label={sidebarCollapsed ? t("app.expandSidebar", "Expand sidebar") : t("app.collapseSidebar", "Collapse sidebar")}
              >
                <span className={cn("transition-transform duration-200", sidebarCollapsed ? "translate-x-0.5" : "-translate-x-0.5")}>
                  {sidebarCollapsed ? <BoxChevronRight className="h-5 w-5" /> : <BoxChevronLeft className="h-5 w-5" />}
                </span>
              </button>
            </div>

            <div className={cn("mt-4 flex items-center gap-2", sidebarCollapsed && "flex-col")}>
              <Button
                variant="default"
                className={cn("h-10 flex-1 justify-center", sidebarCollapsed && "w-full")}
                onClick={connectAccount}
                disabled={loginBusy}
              >
                <BoxPlus className="h-4 w-4" />
                {!sidebarCollapsed
                  ? loginBusy
                    ? t("app.connecting", "Connecting...")
                    : state.preferredProvider === "claude"
                      ? t("app.connectClaudeBeta", "Connect Claude beta")
                      : t("app.connectCodex", "Connect Codex")
                  : null}
              </Button>
              <button
                className="inline-flex h-11 w-11 items-center justify-center border border-transparent text-[var(--app-fg)] transition-colors hover:border-[var(--app-line)] hover:bg-[var(--app-surface)]"
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Open settings"
              >
                <BoxCog className="h-5 w-5" />
              </button>
            </div>

            {!sidebarCollapsed ? (
              <p className="mt-3 px-2 text-xs leading-5 text-[var(--app-fg-soft)]">
                {t(
                  "app.previewHint",
                  "Click a card to preview it. Use Activate to switch the live Codex session.",
                )}
              </p>
            ) : null}

          </div>

          <div className={cn("flex-1 overflow-hidden", sidebarCollapsed ? "px-1 py-2" : "px-2 py-2")}>
            <div className={cn("inline-label px-2 py-2", sidebarCollapsed && "opacity-0")}>{t("app.accounts", "Accounts")}</div>
            <div className="no-scrollbar mt-1 h-[calc(100%-34px)] overflow-y-auto pr-1">
              <AnimatePresence initial={false}>
                {state.accounts.map((account) => {
                  const active = account.id === state.activeAccountId;
                  const selected = account.id === selectedAccount?.id;
                  const preview = selected && !active;
                  const remaining = remainingPercentFromUsed(account.usageSnapshot?.primary?.usedPercent);
                  return (
                    <motion.button
                      key={account.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      type="button"
                      onClick={() => {
                        setSelectedId(account.id);
                      }}
                      className={cn(
                        "group mb-2 w-full overflow-hidden rounded-[18px] border px-3 py-3 text-left transition-all",
                        selected
                          ? "border-[var(--app-fg)] bg-[var(--app-surface-strong)] shadow-[0_10px_24px_rgba(0,0,0,0.08)]"
                          : "border-[var(--app-line)] bg-[var(--app-surface)] hover:-translate-y-0.5 hover:border-[var(--app-line-strong)] hover:bg-[var(--app-surface-strong)]",
                      )}
                    >
                      <div className={cn("flex items-start gap-3", sidebarCollapsed && "justify-center")}>
                        <span
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border text-[11px] font-medium transition-all",
                            active
                              ? "border-[var(--app-fg)] bg-[var(--app-fg)] text-[var(--app-bg)] shadow-[0_6px_18px_rgba(0,0,0,0.12)]"
                              : selected
                                ? "border-[var(--app-fg)] bg-[var(--app-surface-strong)] text-[var(--app-fg)]"
                                : "border-[var(--app-line)] bg-[var(--app-bg)] text-[var(--app-fg-soft)] group-hover:border-[var(--app-line-strong)]",
                          )}
                        >
                          {account.name.slice(0, 1).toUpperCase()}
                        </span>
                        {!sidebarCollapsed ? (
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm text-[var(--app-fg)]">{account.name}</span>
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.18em]",
                                  active
                                    ? "border-[var(--app-fg)] bg-[var(--app-fg)] text-[var(--app-bg)]"
                                    : preview
                                      ? "border-[var(--app-fg)] text-[var(--app-fg)]"
                                      : "border-[var(--app-line)] text-[var(--app-fg-soft)]",
                                )}
                              >
                                {active
                                  ? t("app.activeLabel", "Active")
                                  : preview
                                    ? t("app.preview", "Preview")
                                    : t("app.savedLabel", "Saved")}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[var(--app-fg-soft)]">
                              <span className="truncate">{account.email}</span>
                              <span>{providerLabel(account.provider)}</span>
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-3">
                              <div className="h-1.5 flex-1 bg-[var(--app-line)]">
                                <div
                                  className="h-full bg-[var(--app-fg)] transition-all duration-300"
                                  style={{ width: `${remaining ?? 0}%` }}
                                />
                              </div>
                              <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-fg-soft)]">
                                {remaining != null ? `${remaining}%` : "—"}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-1">
                            <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--app-fg-soft)]">
                              {active ? "A" : preview ? "P" : "S"}
                            </span>
                            <span className="h-1.5 w-full rounded-full bg-[var(--app-line)]">
                              <span
                                className="block h-1.5 rounded-full bg-[var(--app-fg)] transition-all duration-300"
                                style={{ width: `${remaining ?? 0}%` }}
                              />
                            </span>
                          </div>
                        )}
                      </div>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden bg-[var(--app-bg)]">
          <header className="flex items-center justify-between border-b border-[var(--app-line)] px-5 py-3">
            <div className="min-w-0">
              <p className="inline-label">
                {previewingAccount
                  ? t("app.previewingAccount", "Previewing account")
                  : t("app.connectedAccount", "Connected account")}
              </p>
              <h2 className="mt-1 truncate font-display text-[1.55rem]">
                {selectedAccount?.name ?? activeAccount?.name ?? t("app.noAccount", "No account")}
              </h2>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                <BoxCog className="h-4 w-4" />
                {t("app.settings", "Settings")}
              </Button>
              <Button variant="outline" size="sm" onClick={refreshUsage} disabled={refreshBusy || loginBusy}>
                <BoxRightArrow className="h-4 w-4" />
                {refreshBusy ? t("app.refreshing", "Refreshing...") : t("app.refreshLiveUsage", "Refresh live usage")}
              </Button>
              {selectedAccount ? (
                <Button
                  variant={selectedAccount.isActive ? "outline" : "default"}
                  size="sm"
                  onClick={() => void activateAccount(selectedAccount.id)}
                  disabled={selectedAccount.isActive}
                >
                  <BoxPlus className="h-4 w-4" />
                  {t("app.activateSelected", "Activate selected")}
                </Button>
              ) : null}
              {selectedAccount ? (
                <Button variant="outline" size="sm" onClick={() => void removeAccount(selectedAccount.id)}>
                  <BoxTrash className="h-4 w-4" />
                  {t("app.removeAccount", "Remove account")}
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={disconnectAccount} disabled={!activeAccount}>
                <BoxLogOut className="h-4 w-4" />
                {t("app.signOut", "Sign out")}
              </Button>
            </div>
          </header>

          {error ? <div className="border-b border-[var(--app-line)] px-6 py-3 text-sm text-[var(--app-fg)]">{error}</div> : null}

          <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr]">
            <section className="border-b border-[var(--app-line)] px-5 py-5">
              <div className="flex flex-wrap items-end justify-between gap-5">
                <div className="max-w-3xl">
                  <p className="inline-label">{t("app.status", "Status")}</p>
                  <div className="mt-3 flex items-end gap-3">
                    <span className="metric-number font-display text-4xl leading-none">
                      <span className={statusTone(selectedAccount?.status ?? "active")}>
                        {usageHeadline(usageSnapshot)}
                      </span>
                    </span>
                    <span className="pb-1 text-sm uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">
                      {selectedAccount ? statusLabel(selectedAccount.status) : t("app.idle", "Idle")}
                    </span>
                  </div>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--app-fg-soft)]">
                    {t("app.quietLocalView", "Quiet local view for the account that is active right now.")}
                  </p>
                </div>

                <div className="grid gap-2 text-right text-xs text-[var(--app-fg-soft)]">
                  <div>
                    {selectedAccount
                      ? `${t("app.resets", "Resets")} ${formatDate(selectedAccount.resetAt)}`
                      : t("app.noResetTime", "No reset time")}
                  </div>
                  <div>
                    {selectedAccount
                      ? `${t("app.expires", "Expires")} ${formatDate(selectedAccount.expiresAt)}`
                      : t("app.noExpiry", "No expiry set")}
                  </div>
                </div>
              </div>
            </section>

            <section className="min-h-0 px-5 py-5">
              <div>
                <p className="inline-label">{t("app.usageView", "Usage view")}</p>
                <h3 className="mt-1 font-display text-[1.35rem]">{t("app.codexUsage", "Codex usage")}</h3>
              </div>

              <div className="mt-5 grid gap-3">
                <div className="surface px-4 py-4">
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div className="max-w-xl">
                      <p className="inline-label">{t("app.creditsLeft", "Credits left")}</p>
                      <h4 className="mt-2 font-display text-3xl">{usageHeadline(usageSnapshot)}</h4>
                      <p className="mt-2 text-sm leading-5 text-[var(--app-fg-soft)]">
                        {usageLine(usageSnapshot, "primary")}
                      </p>
                      <p className="mt-1 text-sm leading-5 text-[var(--app-fg-soft)]">
                        {usageLine(usageSnapshot, "secondary")}
                      </p>
                    </div>

                    <div className="grid gap-1 text-right text-xs text-[var(--app-fg-soft)]">
                      <div>
                        {usageSnapshot?.credits
                          ? `Credits balance: ${usageSnapshot.credits.balance ?? "—"}${usageSnapshot.credits.unlimited ? " · unlimited" : ""}`
                          : "Credits balance unavailable"}
                      </div>
                      <div>{usageSnapshot?.statsAsOf ? `Stats as of ${usageSnapshot.statsAsOf}` : "Stats timestamp unavailable"}</div>
                      <div>{usageSnapshot?.generatedAt ? `Generated ${formatDate(usageSnapshot.generatedAt)}` : "Generated time unavailable"}</div>
                    </div>
                  </div>

                  <div className="mt-3 h-1.5 bg-[var(--app-line)]">
                    <div className="h-full bg-[var(--app-fg)] transition-all duration-500" style={{ width: usageBarWidth(usageSnapshot) }} />
                  </div>
                </div>

                <div className="grid gap-2 md:grid-cols-3">
                  <SummaryTile
                    label={t("app.usage5hRemaining", "5h remaining")}
                    value={formatPercent(remainingPercentFromUsed(usageSnapshot?.primary?.usedPercent))}
                    helper={usageSnapshot?.primary?.resetsAt ? formatDate(usageSnapshot.primary.resetsAt) : "Not set"}
                  />
                  <SummaryTile
                    label={t("app.usageWeeklyRemaining", "Weekly remaining")}
                    value={formatPercent(remainingPercentFromUsed(usageSnapshot?.secondary?.usedPercent))}
                    helper={usageSnapshot?.secondary?.resetsAt ? formatDate(usageSnapshot.secondary.resetsAt) : "Not set"}
                  />
                  <SummaryTile
                    label={t("app.usageCredits", "Usage credits")}
                    value={usageSnapshot?.credits?.balance ?? "—"}
                    helper={usageSnapshot?.credits?.unlimited ? "Unlimited" : "Hard balance"}
                  />
                </div>

                <div className="grid gap-3 xl:grid-cols-2">
                  <UsageTrendCard
                    title={t("app.fiveHourUsage", "5 Hours Usage")}
                    subtitle={usageLine(usageSnapshot, "primary")}
                    data={dailyTrendSeries}
                    valueKey="tokens"
                    valueLabel="tokens"
                  />
                  <UsageTrendCard
                    title={t("app.weeklyUsage", "Weekly Usage")}
                    subtitle={usageLine(usageSnapshot, "secondary")}
                    data={weeklyTrendSeries}
                    valueKey="tokens"
                    valueLabel="tokens"
                  />
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>

      <AnimatePresence>
        {settingsOpen ? (
          <motion.div
            className="fixed inset-0 z-50 bg-black/35"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSettingsOpen(false)}
          >
          <motion.aside
              className="absolute right-0 top-0 h-full w-[340px] overflow-y-auto border-l border-[var(--app-line)] bg-[var(--app-bg)] p-5"
              initial={{ x: 24, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 24, opacity: 0 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between">
              <div>
                  <p className="inline-label">{t("app.settings", "Settings")}</p>
                  <h3 className="mt-2 font-display text-xl">{t("app.appAppearance", "Appearance")}</h3>
                </div>
                <button className="button-chip h-10 w-10 justify-center p-0" type="button" onClick={() => setSettingsOpen(false)}>
                  <BoxChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-6 space-y-5">
                <p className="text-sm leading-6 text-[var(--app-fg-soft)]">{t("app.chooseAppearance", "Choose how the app should look on this computer.")}</p>

                <div className="grid grid-cols-3 gap-2">
                  {(["system", "light", "dark"] as ThemeMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => updateTheme(mode)}
                      className="button-chip justify-center py-2 text-sm"
                      data-active={state.themeMode === mode}
                    >
                      {mode === "system" ? t("app.system", "System") : mode === "dark" ? t("app.dark", "Dark") : t("app.light", "Light")}
                    </button>
                  ))}
                </div>

                <div className="surface px-4 py-4">
                  <p className="font-display text-lg">{t("app.systemSync", "System sync")}</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--app-fg-soft)]">
                    {t("app.followOsOrLock", "The app can follow your operating system or stay locked to a single look.")}
                  </p>
                </div>

                <div className="surface px-4 py-4">
                  <p className="font-display text-lg">{t("app.security", "Security")}</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--app-fg-soft)]">
                    {t("app.secureStorage", "Tokens stay encrypted locally using the operating system's secure storage.")}
                  </p>
                </div>

                <div className="surface px-4 py-4">
                  <p className="font-display text-lg">{t("app.accountDetails", "Account details")}</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--app-fg-soft)]">
                    {t("app.accountDetailsHint", "Usage and profile metadata for the currently selected account.")}
                  </p>
                  <label className="mt-4 block">
                    <span className="inline-label">{t("app.displayName", "Display name")}</span>
                    <input
                      className="field mt-2"
                      value={draft.name}
                      onChange={(event) => setDraft({ name: event.target.value })}
                      placeholder={t("app.accountName", "Account name")}
                    />
                  </label>
                  <div className="mt-3 grid gap-2">
                    <Button variant="default" onClick={saveName} disabled={saving}>
                      <BoxCheckCircle className="h-4 w-4" />
                      {saving ? t("app.saving", "Saving...") : t("app.saveName", "Save name")}
                    </Button>
                  </div>
                  <div className="mt-4 grid gap-3 border-y border-[var(--app-line)] py-4 text-sm">
                    <InfoRow label={t("app.plan", "Plan")} value={usageSnapshot?.planType ? usageSnapshot.planType.toUpperCase() : t("app.notSet", "Not set")} />
                    <InfoRow label={t("app.profileEmail", "Profile email")} value={usageSnapshot?.profileEmail ?? selectedAccount?.email ?? t("app.notSet", "Not set")} />
                    <InfoRow label={t("app.profileName", "Profile name")} value={usageSnapshot?.profileName ?? selectedAccount?.name ?? t("app.notSet", "Not set")} />
                    <InfoRow label={t("app.statsAsOf", "Stats as of")} value={usageSnapshot?.statsAsOf ? formatDate(usageSnapshot.statsAsOf) : t("app.notSet", "Not set")} />
                    <InfoRow label={t("app.lastSaved", "Last saved")} value={selectedAccount ? formatDate(selectedAccount.updatedAt) : t("app.notSet", "Not set")} />
                    <InfoRow label={t("app.tokenExpires", "Token expires")} value={selectedAccount ? formatDate(selectedAccount.expiresAt) : t("app.notSet", "Not set")} />
                    <InfoRow label={t("app.resetWindow", "Reset window")} value={selectedAccount ? formatDate(selectedAccount.resetAt) : t("app.notSet", "Not set")} />
                    <InfoRow
                      label={t("app.usageCredits", "Usage credits")}
                      value={
                        usageSnapshot?.credits?.balance != null
                          ? `${usageSnapshot.credits.balance}${usageSnapshot.credits.unlimited ? " · unlimited" : ""}`
                          : t("app.notSet", "Not set")
                      }
                    />
                    <InfoRow
                      label={t("app.usage5hRemaining", "5h remaining")}
                      value={usageSnapshot?.primary?.usedPercent != null ? formatPercent(remainingPercentFromUsed(usageSnapshot.primary.usedPercent)) : t("app.notSet", "Not set")}
                    />
                    <InfoRow
                      label={t("app.usageWeeklyRemaining", "Weekly remaining")}
                      value={usageSnapshot?.secondary?.usedPercent != null ? formatPercent(remainingPercentFromUsed(usageSnapshot.secondary.usedPercent)) : t("app.notSet", "Not set")}
                    />
                    {selectedAccount?.provider === "claude" && selectedAccount.providerStatus ? (
                      <>
                        <InfoRow
                          label={t("app.claude5h", "Claude 5h")}
                          value={
                            selectedAccount.providerStatus.fiveHourUsedPercent != null
                              ? `${Math.round(selectedAccount.providerStatus.fiveHourUsedPercent)}% · ${formatCountdown(selectedAccount.providerStatus.fiveHourResetAt)}`
                              : t("app.notSet", "Not set")
                          }
                        />
                        <InfoRow
                          label={t("app.claude7d", "Claude 7d")}
                          value={
                            selectedAccount.providerStatus.sevenDayUsedPercent != null
                              ? `${Math.round(selectedAccount.providerStatus.sevenDayUsedPercent)}% · ${formatCountdown(selectedAccount.providerStatus.sevenDayResetAt)}`
                              : t("app.notSet", "Not set")
                          }
                        />
                        <InfoRow
                          label={t("app.model", "Model")}
                          value={selectedAccount.providerStatus.model ?? t("app.notSet", "Not set")}
                        />
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="surface px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-display text-lg">{t("app.betaLogins", "Beta logins")}</p>
                    <span className="button-chip px-2 py-1 text-[10px] uppercase tracking-[0.24em]">
                      {t("app.beta", "Beta")}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--app-fg-soft)]">
                    {t(
                      "app.betaLoginWarning",
                      "These login flows are experimental and may fail, so keep that in mind before using them.",
                    )}
                  </p>
                  <div className="mt-4 grid gap-2">
                    {(["chatgpt", "claude"] as ProviderId[]).map((provider) => (
                      <button
                        key={provider}
                        type="button"
                        onClick={() => void updateProvider(provider)}
                        className="button-chip w-full items-center justify-between px-3 py-3 text-left"
                        data-active={state.preferredProvider === provider}
                        disabled={provider === "claude" && state.platform === "macos"}
                      >
                        <div className="min-w-0">
                          <p className="font-display text-base">{preferredLoginLabel(provider)}</p>
                          <p className="mt-1 text-xs leading-5 text-[var(--app-fg-soft)]">
                            {provider === "chatgpt"
                              ? t("app.codexLoginHint", "Codex-style OpenAI login used by the app today.")
                              : t("app.claudeLoginHint", "Experimental local Claude capture. Not guaranteed to work.")}
                          </p>
                        </div>
                        <span className={cn(
                          "ml-3 shrink-0 text-[10px] uppercase tracking-[0.18em]",
                          state.preferredProvider === provider ? "text-[var(--app-fg)]" : "text-[var(--app-fg-soft)]",
                        )}>
                          {state.preferredProvider === provider ? t("app.current", "Current") : t("app.select", "Select")}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-[var(--app-fg-soft)]">
                    {t(
                      "app.betaLoginFootnote",
                      "Claude stays hidden here on purpose. If it misbehaves, treat it as unfinished.",
                    )}
                  </p>
                </div>

                <div className="surface px-4 py-4">
                  <p className="font-display text-lg">{t("app.language", "Language")}</p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {([
                      ["en", "English"],
                      ["pt", "Português"],
                      ["es", "Español"],
                    ] as Array<[Locale, string]>).map(([locale, label]) => (
                      <button
                        key={locale}
                        type="button"
                        onClick={() => {
                          void updateLocale(locale);
                        }}
                        className="button-chip justify-center px-3 py-2 text-xs"
                        data-active={state.locale === locale}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-2">
                  <AnimatedThemeToggler
                    className="button-chip h-11 w-full justify-center gap-2"
                    theme={state.themeMode === "dark" ? "dark" : "light"}
                    onThemeChange={(mode) => {
                      void updateTheme(mode);
                    }}
                  />
                </div>
              </div>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="inline-label">{label}</span>
      <span className="max-w-[55%] text-right text-sm text-[var(--app-fg)]">{value}</span>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="surface px-3 py-3">
      <p className="inline-label">{label}</p>
      <div className="mt-2 font-display text-xl text-[var(--app-fg)]">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.22em] text-[var(--app-fg-soft)]">{helper}</div>
    </div>
  );
}

function UsageTrendCard({
  title,
  subtitle,
  data,
  valueKey,
  valueLabel,
}: {
  title: string;
  subtitle: string;
  data: Array<{ name: string; tokens: number; remaining: number }>;
  valueKey: "tokens";
  valueLabel: string;
}) {
  const current = latestTrendValue(data, valueKey);
  const peak = Math.max(...data.map((item) => item[valueKey]), current, 1);
  const currentWidth = Math.max(0, Math.min(100, (current / peak) * 100));

  return (
    <div className="surface px-3 py-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="inline-label">{title}</p>
          <h4 className="mt-2 font-display text-lg">{formatCompactNumber(current)}</h4>
        </div>
        <span className="max-w-[55%] text-right text-[11px] leading-4 text-[var(--app-fg-soft)]">{subtitle}</span>
      </div>

      <div className="mt-3 h-1.5 bg-[var(--app-line)]">
        <div className="h-full bg-[var(--app-fg)] transition-all duration-500" style={{ width: `${currentWidth}%` }} />
      </div>

      <div className="mt-3 h-[150px]">
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 4, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id={`${title.replace(/[^a-z0-9]/gi, "").toLowerCase()}Fill`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--app-fg)" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="var(--app-fg)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--app-line)" strokeDasharray="4 8" vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "var(--app-fg-soft)", fontSize: 11 }} />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--app-fg-soft)", fontSize: 11 }}
                tickFormatter={(value) => formatCompactNumber(Number(value))}
                width={52}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--app-line-strong)", strokeDasharray: "4 4" }} />
              <Area
                type="monotone"
                dataKey={valueKey}
                stroke="var(--app-fg)"
                strokeWidth={1.5}
                fill={`url(#${title.replace(/[^a-z0-9]/gi, "").toLowerCase()}Fill)`}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.22em] text-[var(--app-fg-soft)]">
            No {valueLabel} history yet
          </div>
        )}
      </div>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-[var(--app-line)] bg-[var(--app-surface)] px-3 py-2 text-xs text-[var(--app-fg)]">
      <div className="uppercase tracking-[0.22em] text-[var(--app-fg-soft)]">{label}</div>
      <div className="mt-1 metric-number text-sm">{formatCompactNumber(payload[0]?.value ?? 0)} tokens</div>
    </div>
  );
}
