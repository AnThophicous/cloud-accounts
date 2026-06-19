"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { Button } from "./ui/button";
import { BoxLeftArrow, BoxPlus, BoxRightArrow } from "./ui/boxicon";
import { useLocaleCopy } from "../i18n";
import { cn } from "../lib/utils";
import type { Locale, PlatformName, ThemeMode } from "../../shared/types";

const localeOptions: Array<[Locale, string]> = [
  ["en", "English"],
  ["pt", "Português"],
  ["es", "Español"],
];

type Props = {
  onConnect: () => Promise<void> | void;
  loading?: boolean;
  onStartEmpty?: () => Promise<void> | void;
  currentTheme: ThemeMode;
  currentLocale: Locale;
  currentAccentColor: string;
  platform: PlatformName;
  deviceName: string;
  onThemeChange: (mode: ThemeMode) => Promise<void> | void;
  onAccentColorChange: (color: string) => Promise<void> | void;
  onLocaleChange: (locale: Locale) => Promise<void> | void;
};

type StepId = 0 | 1 | 2 | 3;

function normalizeHexColor(value: string): string | null {
  const normalized = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return normalized.toLowerCase();
}

export function OnboardingPage({
  onConnect,
  loading = false,
  onStartEmpty,
  currentTheme,
  currentLocale,
  currentAccentColor,
  platform,
  deviceName,
  onThemeChange,
  onAccentColorChange,
  onLocaleChange,
}: Props) {
  const [step, setStep] = useState<StepId>(0);
  const [accentDraft, setAccentDraft] = useState(currentAccentColor);
  const { t } = useMemo(() => useLocaleCopy(currentLocale), [currentLocale]);

  useEffect(() => {
    setAccentDraft(currentAccentColor);
  }, [currentAccentColor]);

  const commitAccentColor = async (value: string) => {
    const normalized = normalizeHexColor(value);
    if (!normalized || normalized === currentAccentColor) return;
    await onAccentColorChange(normalized);
  };

  return (
    <div className="app-shell flex h-full items-center justify-center px-4 py-6">
      <div className="onboarding-shell w-full max-w-[920px] px-7 py-7">
        <div className="flex min-h-[520px] flex-col">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">
                {t("app.cloudAccounts", "Cloud Accounts")}
              </div>
              <div className="mt-3 text-[2.35rem] font-semibold leading-[0.95] tracking-[-0.06em] text-[var(--app-fg)]">
                {step === 2 ? `Welcome ${deviceName}` : t("app.switchWithoutNoise", "Switch without the noise")}
              </div>
            </div>
            <div className="hidden gap-2 md:flex">
              {[
                t("app.platform", "Platform"),
                t("app.language", "Language"),
                t("app.connectAccount", "Connect account"),
                t("app.theme", "Theme"),
              ].map((label, index) => (
                <div key={label} className={cn("onboarding-chip", step === index && "onboarding-chip-active")}>
                  {label}
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1">
            <StepWrap active={step === 0}>
              <p className="text-sm leading-7 text-[var(--app-fg-soft)]">
                {t("app.platformStepBody", "Pick the machine profile to continue. Your current platform is already highlighted.")}
              </p>
              <div className="mt-8 grid gap-3 md:grid-cols-3">
                <PlatformCard label="macOS" active={platform === "macos"} />
                <PlatformCard label="Windows" active={platform === "windows"} />
                <PlatformCard label="Linux" active={platform === "linux"} />
              </div>
            </StepWrap>

            <StepWrap active={step === 1}>
              <p className="text-sm leading-7 text-[var(--app-fg-soft)]">
                {t("app.languageStepBody", "What is your language? Choose the language for the interface below.")}
              </p>
              <div className="mt-8 max-w-[320px]">
                <select
                  className="field"
                  value={currentLocale}
                  onChange={(event) => {
                    void onLocaleChange(event.target.value as Locale);
                  }}
                >
                  {localeOptions.map(([locale, label]) => (
                    <option key={locale} value={locale}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </StepWrap>

            <StepWrap active={step === 2}>
              <div className="max-w-[520px]">
                <p className="text-sm leading-7 text-[var(--app-fg-soft)]">
                  {t("app.welcomeStepBody", "Connect your account to start rotating sessions and tracking usage from one place.")}
                </p>
                <div className="mt-8 rounded-[18px] border border-[var(--app-line)] bg-[var(--app-surface)] px-5 py-5">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">
                    {t("app.connectAccount", "Connect account")}
                  </div>
                  <div className="mt-3 text-base leading-7 text-[var(--app-fg)]">
                    {t("app.codexLoginHint", "Codex-style OpenAI login currently used by the app.")}
                  </div>
                  <div className="mt-5">
                    <Button onClick={() => void onConnect()} disabled={loading}>
                      <BoxPlus className="text-base" />
                      {loading ? t("app.connecting", "Connecting...") : t("app.connectCodex", "Connect Codex")}
                    </Button>
                  </div>
                </div>
              </div>
            </StepWrap>

            <StepWrap active={step === 3}>
              <p className="text-sm leading-7 text-[var(--app-fg-soft)]">
                {t("app.themeStepBody", "Choose the base theme and the accent color used for important text and highlights.")}
              </p>
              <div className="mt-8 inline-flex rounded-[12px] border border-[var(--app-line)] bg-[var(--app-surface)] p-1">
                {(["light", "dark"] as ThemeMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={cn("segmented-item", currentTheme === mode && "segmented-item-active")}
                    onClick={() => {
                      void onThemeChange(mode);
                    }}
                  >
                    {mode === "light" ? t("app.light", "Light") : t("app.dark", "Dark")}
                  </button>
                ))}
              </div>
              <div className="theme-color-panel mt-6 max-w-[420px]">
                <label className="text-[11px] uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">
                  {t("app.accentColor", "Accent color")}
                </label>
                <div className="theme-color-row mt-3">
                  <label className="color-preview" style={{ backgroundColor: normalizeHexColor(accentDraft) ?? currentAccentColor }}>
                    <input
                      className="sr-only"
                      type="color"
                      value={normalizeHexColor(accentDraft) ?? currentAccentColor}
                      onChange={(event) => {
                        setAccentDraft(event.target.value);
                        void commitAccentColor(event.target.value);
                      }}
                    />
                  </label>
                  <input
                    className="field"
                    value={accentDraft}
                    placeholder="#0ea5a8"
                    onChange={(event) => setAccentDraft(event.target.value)}
                    onBlur={() => {
                      void commitAccentColor(accentDraft);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commitAccentColor(accentDraft);
                      }
                    }}
                  />
                </div>
              </div>
            </StepWrap>
          </div>

          <div className="mt-8 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setStep((value) => Math.max(0, value - 1) as StepId)} disabled={step === 0}>
                <BoxLeftArrow className="text-base" />
              </Button>
              <div className="flex items-center gap-2">
                {[0, 1, 2, 3].map((index) => (
                  <button
                    key={index}
                    type="button"
                    className={cn("step-dot", step === index && "step-dot-active")}
                    onClick={() => setStep(index as StepId)}
                    aria-label={`Step ${index + 1}`}
                  />
                ))}
              </div>
              <Button variant="ghost" size="icon" onClick={() => setStep((value) => Math.min(3, value + 1) as StepId)} disabled={step === 3}>
                <BoxRightArrow className="text-base" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              {step === 3 ? (
                <>
                  {onStartEmpty ? (
                    <Button variant="ghost" onClick={() => void onStartEmpty()}>
                      {t("app.startEmpty", "Start empty")}
                    </Button>
                  ) : null}
                  <Button onClick={() => void onStartEmpty?.()}>
                    {t("app.finishSetup", "Finish setup")}
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepWrap({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <motion.div
      initial={false}
      animate={{ opacity: active ? 1 : 0, y: active ? 0 : 8 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn(active ? "block" : "hidden")}
    >
      {children}
    </motion.div>
  );
}

function PlatformCard({ label, active }: { label: string; active: boolean }) {
  return (
    <div className={cn("rounded-[18px] border px-5 py-5", active ? "border-[var(--app-accent-brand)] bg-[var(--app-accent-brand-soft)]" : "border-[var(--app-line)] bg-[var(--app-surface)]")}>
      <div className="text-sm font-medium text-[var(--app-fg)]">{label}</div>
    </div>
  );
}
