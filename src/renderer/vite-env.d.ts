/// <reference types="vite/client" />

import type { CloudAccountsApi } from "../shared/types";

declare global {
  interface Window {
    cloudAccounts: CloudAccountsApi;
  }
}

export {};
