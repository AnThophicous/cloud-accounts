import { contextBridge, ipcRenderer } from "electron";
import type {
  AccountDraft,
  AccountPatch,
  CloudAccountsApi,
  CloudAccountsState,
  Locale,
  ProviderId,
  ThemeMode,
} from "./shared/types.js";

const api: CloudAccountsApi = {
  getState: () => ipcRenderer.invoke("cloud-accounts:get-state") as Promise<CloudAccountsState>,
  saveAccount: (draft: AccountDraft) => ipcRenderer.invoke("cloud-accounts:save-account", draft) as Promise<CloudAccountsState>,
  activateAccount: (id: string) => ipcRenderer.invoke("cloud-accounts:activate-account", id) as Promise<CloudAccountsState>,
  removeAccount: (id: string) => ipcRenderer.invoke("cloud-accounts:remove-account", id) as Promise<CloudAccountsState>,
  clearActiveAccount: () => ipcRenderer.invoke("cloud-accounts:clear-active-account") as Promise<CloudAccountsState>,
  setOnboardingSeen: () => ipcRenderer.invoke("cloud-accounts:set-onboarding-seen") as Promise<CloudAccountsState>,
  setThemeMode: (mode: ThemeMode) => ipcRenderer.invoke("cloud-accounts:set-theme-mode", mode) as Promise<CloudAccountsState>,
  setLocale: (locale: Locale) => ipcRenderer.invoke("cloud-accounts:set-locale", locale) as Promise<CloudAccountsState>,
  setPreferredProvider: (provider: ProviderId) =>
    ipcRenderer.invoke("cloud-accounts:set-preferred-provider", provider) as Promise<CloudAccountsState>,
  openExternal: (url: string) => ipcRenderer.invoke("cloud-accounts:open-external", url) as Promise<void>,
  startChatGPTLogin: () => ipcRenderer.invoke("cloud-accounts:start-login") as Promise<CloudAccountsState>,
  startClaudeCapture: () => ipcRenderer.invoke("cloud-accounts:start-claude") as Promise<CloudAccountsState>,
  refreshUsage: async () => {
    try {
      return (await ipcRenderer.invoke("cloud-accounts:refresh-usage")) as CloudAccountsState;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("No handler registered for 'cloud-accounts:refresh-usage'")) {
        return (await ipcRenderer.invoke("cloud-accounts:get-state")) as CloudAccountsState;
      }
      throw error;
    }
  },
  updateAccount: (id: string, patch: AccountPatch) =>
    ipcRenderer.invoke("cloud-accounts:update-account", id, patch) as Promise<CloudAccountsState>,
  onStateChanged: (listener: (state: CloudAccountsState) => void) => {
    const channel = "cloud-accounts:state-changed";
    const subscription = (_event: Electron.IpcRendererEvent, state: CloudAccountsState) => listener(state);
    ipcRenderer.on(channel, subscription);
    return () => {
      ipcRenderer.removeListener(channel, subscription);
    };
  },
};

contextBridge.exposeInMainWorld("cloudAccounts", api);
