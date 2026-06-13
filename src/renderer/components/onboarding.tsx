"use client";

import { motion } from "framer-motion";
import { memo, useMemo, useState } from "react";
import { BentoCard, BentoGrid } from "./magicui/bento-grid";
import { AuroraText } from "./magicui/aurora-text";
import { Highlighter } from "./magicui/highlighter";
import { Globe } from "./magicui/globe";
import { ProgressiveBlur } from "./magicui/progressive-blur";
import Text3DFlip from "./magicui/text-3d-flip";
import { AnimatedSpan, Terminal, TypingAnimation } from "./magicui/terminal";
import { AnimatedThemeToggler } from "./ui/animated-theme-toggler";
import { Button } from "./ui/button";
import {
  BoxGroup,
  BoxLaptop,
  BoxLeftArrow,
  BoxRightArrow,
  BoxShield,
  BoxStar,
  BoxUser,
} from "./ui/boxicon";
import { useLocaleCopy } from "../i18n";
import type { ReactNode } from "react";
import type { Locale, ThemeMode } from "../../shared/types";
import { cn } from "../lib/utils";
import type { GlobeFocus } from "./magicui/globe";

type Props = {
  onConnect: () => Promise<void> | void;
  loading?: boolean;
  onStartEmpty?: () => Promise<void> | void;
  currentTheme: ThemeMode;
  currentLocale: Locale;
  onThemeChange: (mode: ThemeMode) => Promise<void> | void;
  onLocaleChange: (locale: Locale) => Promise<void> | void;
};

type StepId = 0 | 1 | 2 | 3 | 4;

const steps = [0, 1, 2, 3, 4] as const;
const localeFocus: Record<Locale, GlobeFocus> = {
  en: { latitude: 39.8283, longitude: -98.5795 },
  pt: { latitude: -23.5505, longitude: -46.6333 },
  es: { latitude: 40.4168, longitude: -3.7038 },
};

export function OnboardingPage({
  onConnect,
  loading = false,
  onStartEmpty,
  currentTheme,
  currentLocale,
  onThemeChange,
  onLocaleChange,
}: Props) {
  const [step, setStep] = useState<StepId>(0);
  const { t } = useMemo(() => useLocaleCopy(currentLocale), [currentLocale]);

  return (
    <div className="app-shell flex h-full overflow-hidden">
      <div className="grid h-full w-full lg:grid-cols-[1.12fr_0.88fr]">
        <section className="relative flex min-h-0 flex-col border-r border-[var(--app-line)] bg-[var(--app-bg)] px-6 py-6 lg:px-8 lg:py-7">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="inline-label">{t("app.cloudAccounts", "Cloud Accounts")}</p>
              <h1 className="mt-2 font-display text-2xl">{t("app.setup", "Setup")}</h1>
            </div>
            <AnimatedThemeToggler
              className="inline-flex h-12 w-12 items-center justify-center bg-transparent text-[var(--app-fg)] transition-opacity hover:opacity-70"
              theme={currentTheme === "dark" ? "dark" : "light"}
              onThemeChange={(mode) => {
                void onThemeChange(mode);
              }}
            />
          </div>

          <div className="mt-10 max-w-4xl">
            <Text3DFlip
              as="h2"
              className="font-display text-5xl leading-[0.96] text-[var(--app-fg)] sm:text-6xl lg:text-[5rem]"
              textClassName="text-[var(--app-fg)]"
              flipTextClassName="text-[var(--app-fg)]"
              rotateDirection="top"
              staggerDuration={0.035}
              staggerFrom="center"
            >
              {t("app.switchWithoutNoise", "Switch without the noise")}
            </Text3DFlip>
            <p className="mt-5 max-w-2xl text-[15px] leading-7 text-[var(--app-fg-soft)]">
              {t("app.pickTheme", "Pick a theme, connect once, and keep the rest quiet.")}
            </p>
          </div>

          <div className="mt-10 flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="inline-label">{t("app.setupFlow", "Setup flow")}</p>
              <p className="font-display text-3xl">{String(step + 1).padStart(2, "0")}</p>
            </div>

            <div className="h-1.5 bg-[var(--app-line)]">
              <motion.div
                className="h-full bg-[var(--app-fg)]"
                animate={{ width: `${((step + 1) / steps.length) * 100}%` }}
                transition={{ duration: 0.35, ease: "easeOut" }}
              />
            </div>

      <div className="relative min-h-0 flex-1 overflow-hidden border border-[var(--app-line)] bg-[var(--app-surface)]">
              <StepDeck>
                <ThemeStep
                  active={step === 0}
                  currentTheme={currentTheme}
                  onThemeChange={onThemeChange}
                  onNext={() => setStep(1)}
                  t={t}
                />
                <LanguageStep
                  active={step === 1}
                  currentLocale={currentLocale}
                  onLocaleChange={onLocaleChange}
                  onBack={() => setStep(0)}
                  onNext={() => setStep(2)}
                  t={t}
                />
                <ConfigStep
                  active={step === 2}
                  onBack={() => setStep(1)}
                  onNext={() => setStep(3)}
                  t={t}
                />
                <SecurityStep
                  active={step === 3}
                  onBack={() => setStep(2)}
                  onNext={() => setStep(4)}
                  t={t}
                />
                <LoginStep
                  active={step === 4}
                  loading={loading}
                  onBack={() => setStep(3)}
                  onConnect={onConnect}
                  onStartEmpty={onStartEmpty}
                  t={t}
                />
              </StepDeck>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button className="button-chip h-11 min-w-[132px] justify-center px-4" type="button" onClick={() => setStep((value) => Math.max(0, value - 1) as StepId)} aria-label="Previous step">
                  <BoxLeftArrow className="h-4 w-4" />
                  {t("app.back", "Back")}
                </button>
                <button className="button-chip h-11 min-w-[132px] justify-center px-4" type="button" onClick={() => setStep((value) => Math.min(4, value + 1) as StepId)} aria-label="Next step">
                  {t("app.next", "Next")}
                  <BoxRightArrow className="h-4 w-4" />
                </button>
              </div>
              <span className="text-xs uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">
                {step === 4 ? t("app.ready", "Ready") : t("app.preparing", "Preparing")}
              </span>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-col bg-[var(--app-bg-elevated)] px-6 py-6 lg:px-8 lg:py-7">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="inline-label">{t("app.preferences", "Preferences")}</p>
              <h2 className="mt-2 font-display text-2xl">{t("app.keepClean", "Keep the interface calm and readable.")}</h2>
            </div>
            <div className="hidden lg:block" />
          </div>

          <div className="mt-8 grid gap-4">
            <BentoGrid className="gap-4 lg:grid-cols-2">
              <BentoCard
                name={t("app.theme", "Theme")}
                description={t("app.themesInApp", "Keep the app on system, light, or dark without extra noise.")}
                Icon={BoxLaptop}
                className="min-h-[190px]"
              />
              <BentoCard
                name={t("app.language", "Language")}
                description={t("app.chooseLanguage", "Choose the language you want to use.")}
                Icon={BoxGroup}
                className="min-h-[190px]"
              />
              <BentoCard
                name={t("app.security", "Security")}
                description={t("app.tokensEncrypted", "Tokens stay encrypted locally.")}
                Icon={BoxShield}
                className="min-h-[190px]"
              />
              <BentoCard
                name={t("app.profiles", "Profiles")}
                description={t("app.profilesReady", "Keep every account ready and switch when you need it.")}
                Icon={BoxUser}
                className="min-h-[190px]"
              />
            </BentoGrid>
          </div>

          <div className="mt-8 border-y border-[var(--app-line)] py-5">
            <div className="flex items-center gap-3">
              <BoxStar className="h-4 w-4 text-[var(--app-fg-soft)]" />
              <p className="text-sm text-[var(--app-fg-soft)]">{t("app.renameLater", "Rename profiles later, keep the screen clean, and let the app stay in the background.")}</p>
            </div>
          </div>

          <div className="mt-8 rounded-none border border-[var(--app-line)] bg-[var(--app-surface)] p-4">
            <p className="font-display text-2xl">
              <AuroraText>{t("app.readyWhenYouAre", "Ready when you are.")}</AuroraText>
            </p>
            <p className="mt-2 max-w-md text-sm leading-6 text-[var(--app-fg-soft)]">
              {t("app.pickTheme", "Pick a theme, connect once, and keep the rest quiet.")}
            </p>
          </div>
        </section>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--app-bg)] to-transparent" />
    </div>
  );
}

function StepDeck({ children }: { children: ReactNode }) {
  return <div className="relative h-full min-h-0">{children}</div>;
}

function StepFrame({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <motion.section
      className={cn(
        "absolute inset-0 flex flex-col overflow-y-auto p-5 lg:p-6 no-scrollbar",
        active ? "pointer-events-auto" : "pointer-events-none",
      )}
      initial={false}
      animate={{
        opacity: active ? 1 : 0,
        x: active ? 0 : 16,
        scale: active ? 1 : 0.985,
      }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      aria-hidden={!active}
    >
      {children}
    </motion.section>
  );
}

function ThemeStep({
  active,
  currentTheme,
  onThemeChange,
  onNext,
  t,
}: {
  active: boolean;
  currentTheme: ThemeMode;
  onThemeChange: (mode: ThemeMode) => Promise<void> | void;
  onNext: () => void;
  t: (key: string, fallback?: string) => string;
}) {
  return (
    <StepFrame active={active}>
      <div className="flex items-center justify-between">
        <p className="inline-label">{t("app.stepOne", "Step one")}</p>
        <span className="text-xs uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">{t("app.theme", "Theme")}</span>
      </div>

      <div className="mt-4 border border-[var(--app-line)] bg-[var(--app-surface-strong)] p-5">
        <p className="font-display text-2xl">{t("app.chooseLook", "Choose the look now, then let the app keep quiet.")}</p>
        <p className="mt-3 text-sm leading-6 text-[var(--app-fg-soft)]">
          <Highlighter action="underline">{t("app.system", "System")}</Highlighter>, <Highlighter action="underline">{t("app.light", "Light")}</Highlighter>, <Highlighter action="underline">{t("app.dark", "Dark")}</Highlighter>.
        </p>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {(["system", "light", "dark"] as ThemeMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => {
              void onThemeChange(mode);
            }}
            className={cn(
              "border px-4 py-4 text-left transition-colors",
              currentTheme === mode
                ? "border-[var(--app-line-strong)] bg-[var(--app-surface-strong)]"
                : "border-[var(--app-line)] bg-[var(--app-surface)] hover:bg-[var(--app-surface-strong)]",
            )}
          >
            <p className="font-display text-lg capitalize">{t(`app.${mode}`, mode)}</p>
            <p className="mt-2 text-sm text-[var(--app-fg-soft)]">
              {mode === "system" ? t("app.followComputer", "Follow this computer.") : mode === "dark" ? t("app.blackAndGray", "Black and gray.") : t("app.whiteAndGray", "White and gray.")}
            </p>
          </button>
        ))}
      </div>

      <div className="sticky bottom-0 mt-6 flex items-center justify-between gap-3 border-t border-[var(--app-line)] bg-[var(--app-surface)] pt-4">
        <span className="text-sm text-[var(--app-fg-soft)]">{t("app.keepClean", "Keep the interface calm and readable.")}</span>
        <Button onClick={onNext} className="min-w-[132px]">
          {t("app.next", "Next")}
          <BoxRightArrow className="h-4 w-4" />
        </Button>
      </div>
    </StepFrame>
  );
}

function LanguageStep({
  active,
  currentLocale,
  onLocaleChange,
  onBack,
  onNext,
  t,
}: {
  active: boolean;
  currentLocale: Locale;
  onLocaleChange: (locale: Locale) => Promise<void> | void;
  onBack: () => void;
  onNext: () => void;
  t: (key: string, fallback?: string) => string;
}) {
  return (
    <StepFrame active={active}>
      <div className="flex items-center justify-between">
        <p className="inline-label">{t("app.stepTwo", "Step two")}</p>
        <span className="text-xs uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">{t("app.language", "Language")}</span>
      </div>

      <div className="mt-4 border border-[var(--app-line)] bg-[var(--app-surface-strong)] p-4">
        <p className="font-display text-xl">{t("app.whereFrom", "Where are you from?")}</p>
        <p className="mt-2 text-sm leading-6 text-[var(--app-fg-soft)]">{t("app.chooseLanguage", "Choose the language you want to use.")}</p>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[0.82fr_1.18fr]">
        <div className="grid gap-2">
          {([
            ["en", "English"],
            ["pt", "Português"],
            ["es", "Español"],
          ] as Array<[Locale, string]>).map(([locale, label]) => (
            <button
              key={locale}
              type="button"
              onClick={() => {
                void onLocaleChange(locale);
              }}
              className={cn(
                "flex items-center justify-between border px-4 py-3 text-left transition-colors",
                currentLocale === locale
                  ? "border-[var(--app-line-strong)] bg-[var(--app-surface-strong)]"
                  : "border-[var(--app-line)] bg-[var(--app-surface)] hover:bg-[var(--app-surface-strong)]",
              )}
            >
              <div>
                <p className="font-display text-lg">{label}</p>
                <p className="mt-1 text-sm text-[var(--app-fg-soft)]">
                  {locale === "en"
                    ? "English"
                    : locale === "pt"
                      ? "Português"
                      : "Español"}
                </p>
              </div>
              <span className="text-[10px] uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">
                {currentLocale === locale ? t("app.current", "Current") : t("app.nextStep", "Next")}
              </span>
            </button>
          ))}
        </div>

        <div className="relative min-h-[250px] overflow-hidden border border-[var(--app-line)] bg-[var(--app-surface)]">
          <div className="absolute left-5 top-5 z-10">
            <p className="font-display text-3xl text-[var(--app-fg)]">{t("app.whereFrom", "Where are you from?")}</p>
            <p className="mt-2 max-w-xs text-sm leading-6 text-[var(--app-fg-soft)]">
              {t("app.chooseLanguage", "Choose the language you want to use.")}
            </p>
          </div>
          <Globe className="top-16" focus={localeFocus[currentLocale]} />
          <div className="pointer-events-none absolute inset-0 h-full bg-[radial-gradient(circle_at_50%_200%,rgba(0,0,0,0.18),rgba(255,255,255,0))]" />
        </div>
      </div>

      <div className="sticky bottom-0 mt-6 flex items-center justify-between gap-3 border-t border-[var(--app-line)] bg-[var(--app-surface)] pt-4">
        <Button variant="outline" className="min-w-[140px]" onClick={onBack}>
          <BoxLeftArrow className="h-4 w-4" />
          {t("app.back", "Back")}
        </Button>
        <Button className="min-w-[140px]" onClick={onNext}>
          {t("app.next", "Next")}
          <BoxRightArrow className="h-4 w-4" />
        </Button>
      </div>
    </StepFrame>
  );
}

function ConfigStep({
  active,
  onBack,
  onNext,
  t,
}: {
  active: boolean;
  onBack: () => void;
  onNext: () => void;
  t: (key: string, fallback?: string) => string;
}) {
  return (
    <StepFrame active={active}>
      <div className="flex items-center justify-between">
        <p className="inline-label">{t("app.stepThree", "Step three")}</p>
        <span className="text-xs uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">{t("app.preferences", "Preferences")}</span>
      </div>

      <div className="mt-4 border border-[var(--app-line)] bg-[var(--app-surface-strong)] p-5">
        <p className="font-display text-2xl">{t("app.stayInControl", "Stay in control without thinking about it.")}</p>
        <p className="mt-3 text-sm leading-6 text-[var(--app-fg-soft)]">{t("app.switchQuiet", "Switch later without extra noise.")}</p>
      </div>

      <div className="mt-4 grid gap-3">
        <BentoGrid className="lg:grid-cols-3">
          <BentoCard name={t("app.profiles", "Profiles")} description={t("app.profilesReady", "Keep every account ready and switch when you need it.")} Icon={BoxGroup} className="min-h-[185px]" />
          <BentoCard name={t("app.vault", "Vault")} description={t("app.tokensEncrypted", "Tokens stay encrypted locally.")} Icon={BoxShield} className="min-h-[185px]" />
          <BentoCard name={t("app.displayName", "Display name")} description={t("app.renameLater", "Rename profiles later, keep the screen clean, and let the app stay in the background.")} Icon={BoxUser} className="min-h-[185px]" />
        </BentoGrid>
      </div>

      <div className="sticky bottom-0 mt-6 flex items-center justify-between gap-3 border-t border-[var(--app-line)] bg-[var(--app-surface)] pt-4">
        <Button variant="outline" className="min-w-[132px]" onClick={onBack}>
          <BoxLeftArrow className="h-4 w-4" />
          {t("app.back", "Back")}
        </Button>
        <Button className="min-w-[132px]" onClick={onNext}>
          {t("app.next", "Next")}
          <BoxRightArrow className="h-4 w-4" />
        </Button>
      </div>
    </StepFrame>
  );
}

function SecurityStep({
  active,
  onBack,
  onNext,
  t,
}: {
  active: boolean;
  onBack: () => void;
  onNext: () => void;
  t: (key: string, fallback?: string) => string;
}) {
  return (
    <StepFrame active={active}>
      <div className="flex items-center justify-between">
        <p className="inline-label">{t("app.stepFour", "Step four")}</p>
        <span className="text-xs uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">{t("app.security", "Security")}</span>
      </div>

      <div className="mt-4 border border-[var(--app-line)] bg-[var(--app-surface-strong)] p-5">
        <p className="font-display text-2xl">{t("app.securityLine", "Tokens stay encrypted locally with the operating system.")}</p>
        <p className="mt-3 text-sm leading-6 text-[var(--app-fg-soft)]">{t("app.keepClean", "Keep the interface calm and readable.")}</p>
      </div>

      <div className="relative mt-4 border border-[var(--app-line)] bg-[var(--app-surface)]">
        <Terminal className="terminal-scroll max-h-[260px]">
          <TypingAnimation>&gt; cloudaccounts --secure</TypingAnimation>
          <AnimatedSpan className="text-[var(--app-fg-soft)]">Tokens stored locally.</AnimatedSpan>
          <AnimatedSpan className="text-[var(--app-fg-soft)]">Names stay editable.</AnimatedSpan>
          <AnimatedSpan className="text-[var(--app-fg-soft)]">Email stays hidden from the main screen.</AnimatedSpan>
        </Terminal>
        <ProgressiveBlur position="bottom" height="28%" />
      </div>

      <div className="sticky bottom-0 mt-6 flex items-center justify-between gap-3 border-t border-[var(--app-line)] bg-[var(--app-surface)] pt-4">
        <Button variant="outline" className="min-w-[132px]" onClick={onBack}>
          <BoxLeftArrow className="h-4 w-4" />
          {t("app.back", "Back")}
        </Button>
        <Button className="min-w-[132px]" onClick={onNext}>
          {t("app.next", "Next")}
          <BoxRightArrow className="h-4 w-4" />
        </Button>
      </div>
    </StepFrame>
  );
}

function LoginStep({
  active,
  loading,
  onBack,
  onConnect,
  onStartEmpty,
  t,
}: {
  active: boolean;
  loading: boolean;
  onBack: () => void;
  onConnect: () => Promise<void> | void;
  onStartEmpty?: () => Promise<void> | void;
  t: (key: string, fallback?: string) => string;
}) {
  return (
    <StepFrame active={active}>
      <div className="flex items-center justify-between">
        <p className="inline-label">{t("app.stepFive", "Step five")}</p>
        <span className="text-xs uppercase tracking-[0.24em] text-[var(--app-fg-soft)]">{t("app.connectAccount", "Connect account")}</span>
      </div>

      <div className="mt-4 border border-[var(--app-line)] bg-[var(--app-surface-strong)] p-5">
        <p className="font-display text-2xl">{t("app.connectOne", "Connect one account and keep it ready.")}</p>
        <p className="mt-3 text-sm leading-6 text-[var(--app-fg-soft)]">
          {t("app.oneClickNextTime", "Ready. One click next time.")}
        </p>
      </div>

      <div className="relative mt-4 border border-[var(--app-line)] bg-[var(--app-surface)]">
        <Terminal className="terminal-scroll max-h-[188px]">
          <TypingAnimation>&gt; cloudaccounts</TypingAnimation>
          <AnimatedSpan className="text-[var(--app-fg-soft)]">Beta logins live in Settings.</AnimatedSpan>
          <AnimatedSpan className="text-[var(--app-fg-soft)]">Codex is the default path.</AnimatedSpan>
          <AnimatedSpan className="text-[var(--app-fg-soft)]">Claude stays hidden and experimental.</AnimatedSpan>
          <AnimatedSpan className="text-[var(--app-fg-soft)]">May not work on every machine.</AnimatedSpan>
        </Terminal>
        <ProgressiveBlur position="bottom" height="28%" />
      </div>

      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-3 border-t border-[var(--app-line)] bg-[var(--app-surface)] pt-4">
        <Button variant="outline" className="min-w-[140px]" onClick={onBack}>
          <BoxLeftArrow className="h-4 w-4" />
          {t("app.back", "Back")}
        </Button>
        <Button variant="default" className="min-w-[180px]" onClick={onConnect} disabled={loading}>
          <BoxStar className="h-4 w-4" />
          {loading ? t("app.connecting", "Connecting...") : t("app.connect", "Connect")}
        </Button>
        {onStartEmpty ? (
          <Button variant="outline" className="min-w-[140px]" onClick={onStartEmpty}>
            {t("app.startEmpty", "Start empty")}
          </Button>
        ) : null}
      </div>
    </StepFrame>
  );
}
