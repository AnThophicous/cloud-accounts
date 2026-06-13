import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, safeStorage } from "electron";
import type { ClaudeProviderData, ClaudeRateLimits, ProviderId, StoredAccount } from "../shared/types.js";

export type ClaudeCredentialsSnapshot = {
  raw: string;
  parsed: Record<string, unknown> | null;
  credentialsPath: string;
};

export type ClaudeDiscoveryResult =
  | {
      supported: true;
      credentialsPath: string;
    }
  | {
      supported: false;
      reason: string;
    };

export type ClaudeStatusSnapshot = ClaudeRateLimits & {
  supported: boolean;
  reason?: string;
  authStatus?: string;
};

function encryptString(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure storage is not available on this device.");
  }

  return safeStorage.encryptString(value).toString("base64");
}

function decryptString(value: string): string {
  return safeStorage.decryptString(Buffer.from(value, "base64"));
}

export function resolveClaudeCredentialsPath(): ClaudeDiscoveryResult {
  if (process.platform === "darwin") {
    return { supported: false, reason: "macOS credential provider not implemented" };
  }

  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  const baseDir = configDir && configDir.length > 0 ? configDir : path.join(os.homedir(), ".claude");
  return {
    supported: true,
    credentialsPath: path.join(baseDir, ".credentials.json"),
  };
}

export async function readClaudeCredentialsSnapshot(): Promise<ClaudeCredentialsSnapshot | null> {
  const resolved = resolveClaudeCredentialsPath();
  if (!resolved.supported) return null;

  try {
    const raw = await fs.readFile(resolved.credentialsPath, "utf8");
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
    return { raw, parsed, credentialsPath: resolved.credentialsPath };
  } catch {
    return null;
  }
}

export async function launchClaudeCode(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("claude", [], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });

    child.once("error", (error) => reject(error));
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export async function waitForClaudeCredentialsSnapshot(timeoutMs = 1000 * 60 * 20): Promise<ClaudeCredentialsSnapshot | null> {
  const discovery = resolveClaudeCredentialsPath();
  if (!discovery.supported) return null;

  const existing = await readClaudeCredentialsSnapshot();
  if (existing) return existing;

  const directory = path.dirname(discovery.credentialsPath);
  await fs.mkdir(directory, { recursive: true });

  return new Promise((resolve, reject) => {
    let settled = false;
    const start = Date.now();
    let watcher: ReturnType<typeof watch> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    };

    const finish = (value: ClaudeCredentialsSnapshot | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const poll = async () => {
      const snapshot = await readClaudeCredentialsSnapshot();
      if (snapshot) {
        finish(snapshot);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        finish(null);
      }
    };

    watcher = watch(directory, { persistent: false }, () => {
      void poll().catch((error) => fail(error instanceof Error ? error : new Error(String(error))));
    });

    pollTimer = setInterval(() => {
      void poll().catch((error) => fail(error instanceof Error ? error : new Error(String(error))));
    }, 1000);

    void poll().catch((error) => fail(error instanceof Error ? error : new Error(String(error))));

    timeoutTimer = setTimeout(() => {
      finish(null);
    }, timeoutMs);
  });
}

export async function writeClaudeCredentialsSnapshot(snapshot: string, credentialsPath?: string): Promise<void> {
  const resolved = credentialsPath ?? resolveClaudeCredentialsPath();
  if (typeof resolved === "object" && "supported" in resolved && !resolved.supported) {
    throw new Error(resolved.reason);
  }

  const targetPath = typeof resolved === "string" ? resolved : resolved.credentialsPath;
  const directory = path.dirname(targetPath);
  const tempPath = path.join(directory, `.claude-${process.pid}-${Date.now()}.tmp`);

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(tempPath, snapshot, { encoding: "utf8", mode: 0o600 });
  try {
    await fs.rename(tempPath, targetPath);
  } catch {
    await fs.rm(targetPath, { force: true }).catch(() => undefined);
    await fs.rename(tempPath, targetPath);
  }
}

export function encodeClaudeProviderData(data: ClaudeProviderData): string {
  return encryptString(JSON.stringify(data));
}

export function decodeClaudeProviderData(value: string | null): ClaudeProviderData | null {
  if (!value) return null;
  try {
    return JSON.parse(decryptString(value)) as ClaudeProviderData;
  } catch {
    return null;
  }
}

export async function captureClaudeSnapshot(): Promise<ClaudeProviderData> {
  const discovery = resolveClaudeCredentialsPath();
  if (!discovery.supported) {
    return {
      supported: false,
      reason: discovery.reason,
    };
  }

  const snapshot = await readClaudeCredentialsSnapshot();
  const status = await maybeReadClaudeStatusCache();
  if (!snapshot) {
    return {
      supported: true,
      credentialsPath: discovery.credentialsPath,
      reason: "Claude credentials file not found yet",
      status,
    };
  }

  return {
    supported: true,
    credentialsPath: snapshot.credentialsPath,
    credentialsSnapshot: encryptString(snapshot.raw),
    status,
  };
}

export async function restoreClaudeSnapshot(providerData: ClaudeProviderData | null): Promise<void> {
  if (!providerData?.supported) return;
  if (!providerData.credentialsSnapshot) return;
  const resolved = resolveClaudeCredentialsPath();
  if (!resolved.supported) return;
  await writeClaudeCredentialsSnapshot(providerData.credentialsSnapshot, resolved.credentialsPath);
}

export function synthesizeClaudeAccountName(providerData: ClaudeProviderData | null): string {
  if (!providerData?.supported) return "Claude Account";
  return providerData.status?.model ? `Claude ${providerData.status.model}` : "Claude Account";
}

export async function maybeReadClaudeStatusCache(): Promise<ClaudeRateLimits | null> {
  const cachePath = path.join(app.getPath("userData"), "claude-status.json");
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as ClaudeStatusSnapshot;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      fiveHourUsedPercent: parsed.fiveHourUsedPercent,
      fiveHourResetAt: parsed.fiveHourResetAt,
      sevenDayUsedPercent: parsed.sevenDayUsedPercent,
      sevenDayResetAt: parsed.sevenDayResetAt,
      model: parsed.model,
    };
  } catch {
    return null;
  }
}

export async function writeClaudeStatusCache(status: ClaudeStatusSnapshot): Promise<void> {
  const cachePath = path.join(app.getPath("userData"), "claude-status.json");
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

export function providerIsClaude(provider: ProviderId): boolean {
  return provider === "claude";
}

export function generateClaudeAccountLabel(): string {
  return `Claude ${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}
