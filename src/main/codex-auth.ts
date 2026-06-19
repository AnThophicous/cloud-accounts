import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type { StoredAccount } from "../shared/types.js";

type CodexAuthFile = Record<string, unknown> & {
  auth_mode?: string;
  OPENAI_API_KEY?: string | null;
  tokens?: {
    id_token: string;
    access_token: string;
    refresh_token: string;
  } | null;
  account_id?: string | null;
  id_token?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  last_refresh?: string;
};

function codexAuthPath(): string {
  return path.join(app.getPath("home"), ".codex", "auth.json");
}

async function readExistingAuthFile(filePath: string): Promise<CodexAuthFile | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as CodexAuthFile;
    }
  } catch {
    return null;
  }

  return null;
}

async function writeJsonAtomic(filePath: string, payload: string): Promise<void> {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `.auth-${process.pid}-${Date.now()}.tmp`);

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(tempPath, payload, { encoding: "utf8", mode: 0o600 });

  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(filePath, { force: true }).catch(() => undefined);
    await fs.rename(tempPath, filePath);
  }
}

export async function syncCodexAuthFile(account: StoredAccount | null): Promise<void> {
  const filePath = codexAuthPath();
  if (!account) {
    await fs.rm(filePath, { force: true });
    return;
  }

  const current = await readExistingAuthFile(filePath);
  const next: CodexAuthFile = {
    ...(current ?? {}),
    auth_mode: "chatgpt",
    OPENAI_API_KEY: current?.OPENAI_API_KEY ?? null,
    account_id: account.accountId ?? current?.account_id ?? null,
    tokens: {
      id_token: account.idToken,
      access_token: account.accessToken,
      refresh_token: account.refreshToken,
    },
    id_token: account.idToken,
    access_token: account.accessToken,
    refresh_token: account.refreshToken,
    last_refresh: new Date().toISOString(),
  };

  await writeJsonAtomic(filePath, `${JSON.stringify(next, null, 2)}\n`);
}
