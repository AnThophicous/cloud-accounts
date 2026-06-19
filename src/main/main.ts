import { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startChatGPTLogin } from "./chatgpt-login.js";
import { CloudAccountsStore } from "./store.js";
import type { AccentColor, AccountDraft, AccountPatch, Locale, ProviderId, ThemeMode } from "../shared/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = new CloudAccountsStore();
const STATE_CHANGED_CHANNEL = "cloud-accounts:state-changed";

let codexUsageRefreshTimer: NodeJS.Timeout | null = null;
let codexUsageRefreshInFlight = false;

async function broadcastState(): Promise<void> {
  const state = await store.getState();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(STATE_CHANGED_CHANNEL, state);
  }
}

async function saveAccountAndBroadcast(
  draft: Parameters<CloudAccountsStore["saveAccount"]>[0],
  options: Parameters<CloudAccountsStore["saveAccount"]>[1] = {},
): Promise<void> {
  await store.saveAccount(draft, options);
  await broadcastState();
}

function scheduleNextCodexUsageRefresh(): void {
  if (codexUsageRefreshTimer) {
    clearTimeout(codexUsageRefreshTimer);
  }

  const delay = store.getNextUsageSchedulerDelayMs();
  codexUsageRefreshTimer = setTimeout(() => {
    void refreshActiveCodexUsageOnInterval();
  }, delay);
}

async function refreshActiveCodexUsageAndBroadcast(options: { forceActiveRefresh?: boolean } = {}): Promise<void> {
  await store.runUsageSchedulerTick(options);
  await broadcastState();
  scheduleNextCodexUsageRefresh();
}

async function refreshActiveCodexUsageOnInterval(): Promise<void> {
  if (codexUsageRefreshInFlight) return;
  codexUsageRefreshInFlight = true;
  try {
    await refreshActiveCodexUsageAndBroadcast();
  } finally {
    codexUsageRefreshInFlight = false;
    scheduleNextCodexUsageRefresh();
  }
}

function resolveRendererUrl(): string {
  if (!app.isPackaged) {
    return process.env.VITE_DEV_SERVER_URL ?? "http://localhost:4173";
  }

  return path.join(app.getAppPath(), "dist", "index.html");
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#f6f6f4",
    title: "Cloud Accounts",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? { x: 18, y: 18 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  Menu.setApplicationMenu(null);

  const url = resolveRendererUrl();
  if (url.startsWith("http")) {
    await win.loadURL(url);
  } else {
    await win.loadFile(url);
  }
}

function registerIpc(): void {
  ipcMain.handle("cloud-accounts:get-state", async () => store.getState());
  ipcMain.handle("cloud-accounts:save-account", async (_event, draft: AccountDraft) => {
    const state = await store.saveAccount(draft);
    await broadcastState();
    void refreshActiveCodexUsageAndBroadcast();
    return state;
  });
  ipcMain.handle("cloud-accounts:activate-account", async (_event, id: string) => {
    const state = await store.activateAccount(id);
    await broadcastState();
    void refreshActiveCodexUsageAndBroadcast();
    return state;
  });
  ipcMain.handle("cloud-accounts:remove-account", async (_event, id: string) => {
    const state = await store.removeAccount(id);
    await broadcastState();
    scheduleNextCodexUsageRefresh();
    return state;
  });
  ipcMain.handle("cloud-accounts:clear-active-account", async () => {
    const state = await store.clearActiveAccount();
    await broadcastState();
    scheduleNextCodexUsageRefresh();
    return state;
  });
  ipcMain.handle("cloud-accounts:set-onboarding-seen", async () => {
    const state = await store.setOnboardingSeen();
    await broadcastState();
    return state;
  });
  ipcMain.handle("cloud-accounts:set-obscure-emails", async (_event, enabled: boolean) => {
    const state = await store.setObscureEmails(enabled);
    await broadcastState();
    return state;
  });
  ipcMain.handle("cloud-accounts:set-theme-mode", async (_event, mode: ThemeMode) => {
    nativeTheme.themeSource = mode;
    const state = await store.setThemeMode(mode);
    await broadcastState();
    return state;
  });
  ipcMain.handle("cloud-accounts:set-accent-color", async (_event, color: AccentColor) => {
    const state = await store.setAccentColor(color);
    await broadcastState();
    return state;
  });
  ipcMain.handle("cloud-accounts:set-locale", async (_event, locale: Locale) => {
    const state = await store.setLocale(locale);
    await broadcastState();
    return state;
  });
  ipcMain.handle("cloud-accounts:set-preferred-provider", async (_event, provider: ProviderId) => {
    const state = await store.setPreferredProvider(provider);
    await broadcastState();
    return state;
  });
  ipcMain.handle("cloud-accounts:open-external", async (_event, url: string) => {
    await shell.openExternal(url);
  });
  ipcMain.handle("cloud-accounts:start-login", async () => {
    await startChatGPTLogin({
      onFinalAccount: async (finalAccount) => {
        await saveAccountAndBroadcast(finalAccount);
        void refreshActiveCodexUsageAndBroadcast();
      },
    });
    return store.getState();
  });
  ipcMain.handle("cloud-accounts:start-claude", async () => {
    const state = await store.startClaudeCapture();
    await broadcastState();
    scheduleNextCodexUsageRefresh();
    return state;
  });
  ipcMain.handle("cloud-accounts:refresh-usage", async () => {
    const next = await store.runUsageSchedulerTick({ forceActiveRefresh: true });
    await broadcastState();
    scheduleNextCodexUsageRefresh();
    return next;
  });
  ipcMain.handle("cloud-accounts:update-account", async (_event, id: string, patch: AccountPatch) => {
    const state = await store.updateAccount(id, patch);
    await broadcastState();
    scheduleNextCodexUsageRefresh();
    return state;
  });
}

app.whenReady().then(async () => {
  await store.load();
  const snapshot = await store.getState();
  nativeTheme.themeSource = snapshot.themeMode;
  registerIpc();
  await createWindow();
  void refreshActiveCodexUsageAndBroadcast();
  scheduleNextCodexUsageRefresh();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (codexUsageRefreshTimer) {
    clearTimeout(codexUsageRefreshTimer);
    codexUsageRefreshTimer = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});
