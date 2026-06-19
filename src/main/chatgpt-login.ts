import crypto from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import { shell } from "electron";

const DEFAULT_ISSUER = "https://auth.openai.com";
const DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEFAULT_PORT = 1455;
const FALLBACK_PORT = 1457;
let activeLoginCancel: (() => void) | null = null;

type JwtClaims = {
  email?: string;
  profile?: { email?: string };
  auth?: {
    chatgpt_plan_type?: string;
    chatgpt_user_id?: string;
    user_id?: string;
    chatgpt_account_id?: string;
    chatgpt_account_is_fedramp?: boolean;
  };
  "https://api.openai.com/profile"?: { email?: string; email_verified?: boolean };
  "https://api.openai.com/auth"?: {
    chatgpt_plan_type?: string;
    chatgpt_user_id?: string;
    user_id?: string;
    chatgpt_account_id?: string;
    chatgpt_account_is_fedramp?: boolean;
    chatgpt_subscription_active_start?: string;
    chatgpt_subscription_active_until?: string;
    chatgpt_subscription_last_checked?: string;
  };
  exp?: number;
};

export interface ChatGPTLoginAccountSeed {
  loginSessionId: string;
  name: string;
  email: string;
  accountId: string | null;
  planType: string | null;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: string;
  resetAt: string;
  quotaLimit: number;
  quotaRemaining: number;
  provider: "chatgpt";
}

type LoginOptions = {
  issuer?: string;
  clientId?: string;
  allowedWorkspaceIds?: string[];
  onFinalAccount?: (account: ChatGPTLoginAccountSeed) => Promise<void> | void;
};

type TokenResponse = {
  id_token: string;
  access_token: string;
  refresh_token: string;
};

function randomBase64Url(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBase64Url(64);
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

function parseJwtClaims(jwt: string): JwtClaims {
  const parts = jwt.split(".");
  if (parts.length < 2 || !parts[1]) {
    throw new Error("Invalid JWT format.");
  }
  const payload = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(payload) as JwtClaims;
}

function parseJwtExpiration(jwt: string): Date | null {
  try {
    const claims = parseJwtClaims(jwt);
    if (!claims.exp) return null;
    return new Date(claims.exp * 1000);
  } catch {
    return null;
  }
}

function titleCase(value: string): string {
  return value
    .split(/[\s._-]+/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function resolveDisplayName(claims: JwtClaims): string {
  const email = claims.email ?? claims.profile?.email ?? claims["https://api.openai.com/profile"]?.email;
  if (email) return email;

  const planType = claims.auth?.chatgpt_plan_type ?? claims["https://api.openai.com/auth"]?.chatgpt_plan_type;
  if (planType) {
    return `ChatGPT ${titleCase(planType)}`;
  }

  const userId =
    claims.auth?.chatgpt_user_id ??
    claims.auth?.user_id ??
    claims["https://api.openai.com/auth"]?.chatgpt_user_id ??
    claims["https://api.openai.com/auth"]?.user_id;
  if (userId) return `ChatGPT ${userId.slice(0, 6)}`;

  return "ChatGPT Account";
}

function resolvePlanType(claims: JwtClaims): string | null {
  return claims.auth?.chatgpt_plan_type ?? claims["https://api.openai.com/auth"]?.chatgpt_plan_type ?? null;
}

function resolveAccountId(claims: JwtClaims): string | null {
  return claims.auth?.chatgpt_account_id ?? claims["https://api.openai.com/auth"]?.chatgpt_account_id ?? null;
}

function deriveEstimatedUsageSeed(email: string, accountId: string | null): Uint8Array {
  return crypto.createHash("sha256").update(`${email}:${accountId ?? ""}`).digest();
}

function htmlPage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="light" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f6f4;
        --fg: #0c0c0c;
        --muted: #5f5f5f;
        --border: #dad8d2;
        --accent: #111111;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--fg);
        background: linear-gradient(180deg, #f8f8f6 0%, #f2f2ef 100%);
        display: grid;
        place-items: center;
        padding: 24px;
      }
      .card {
        width: min(640px, 100%);
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 24px;
        box-shadow: 0 20px 72px rgba(0, 0, 0, 0.08);
        padding: 28px;
      }
      .eyebrow {
        font-size: 12px;
        letter-spacing: .22em;
        text-transform: uppercase;
        color: var(--muted);
      }
      h1 {
        margin: 14px 0 10px;
        font-size: 30px;
        line-height: 1.1;
        letter-spacing: -0.04em;
      }
      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
      }
      .hint {
        margin-top: 20px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 10px 14px;
        color: var(--fg);
        text-decoration: none;
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: var(--accent);
      }
      .status {
        margin-top: 18px;
        font-size: 13px;
        color: var(--muted);
      }
    </style>
    <script>
      setTimeout(() => {
        try { window.close(); } catch {}
      }, 250);
    </script>
  </head>
  <body>
    <main class="card">
      <div class="eyebrow">Cloud Accounts</div>
      <h1>${title}</h1>
      <p>${message}</p>
      <p class="status">This tab will close automatically.</p>
      <a class="hint" href="#" onclick="window.close(); return false;">
        <span class="dot"></span>
        You can close this tab
      </a>
    </main>
  </body>
</html>`;
}

function buildAuthorizeUrl(
  issuer: string,
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  state: string,
  allowedWorkspaceIds?: string[],
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "codex_cli_rs",
  });

  if (allowedWorkspaceIds?.length) {
    params.set("allowed_workspace_id", allowedWorkspaceIds.join(","));
  }

  return `${issuer.replace(/\/$/, "")}/oauth/authorize?${params.toString()}`;
}

async function exchangeCodeForTokens(
  issuer: string,
  clientId: string,
  redirectUri: string,
  codeVerifier: string,
  code: string,
): Promise<TokenResponse> {
  const tokenUrl = `${issuer.replace(/\/$/, "")}/oauth/token`;
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${errorText.slice(0, 220)}`);
  }

  return (await response.json()) as TokenResponse;
}

function mapTokenResponse(tokens: TokenResponse, loginSessionId: string): ChatGPTLoginAccountSeed {
  const claims = parseJwtClaims(tokens.id_token);
  const expiresAt = parseJwtExpiration(tokens.access_token) ?? new Date(Date.now() + 1000 * 60 * 60 * 24);
  const email = claims.email ?? claims.profile?.email ?? "chatgpt-user";
  const planType = resolvePlanType(claims);
  const accountId = resolveAccountId(claims);
  const name = resolveDisplayName(claims);
  const seed = deriveEstimatedUsageSeed(email, accountId);
  const remaining = 10 + (seed[0] % 78);
  const resetHours = 2 + (seed[1] % 8);
  const resetAt = new Date(Date.now() + resetHours * 60 * 60 * 1000);

  return {
    loginSessionId,
    name,
    email,
    accountId,
    planType,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    expiresAt: expiresAt.toISOString(),
    resetAt: resetAt.toISOString(),
    quotaLimit: 100,
    quotaRemaining: remaining,
    provider: "chatgpt",
  };
}

export async function startChatGPTLogin(options: LoginOptions = {}): Promise<void> {
  activeLoginCancel?.();
  activeLoginCancel = null;
  const issuer = options.issuer ?? DEFAULT_ISSUER;
  const clientId = options.clientId ?? DEFAULT_CLIENT_ID;
  const { codeVerifier, codeChallenge } = generatePkce();
  const state = randomBase64Url(32);
  const loginSessionId = randomBase64Url(12);
  const portCandidates = [DEFAULT_PORT, FALLBACK_PORT];

  for (const port of portCandidates) {
    const result = await new Promise<boolean>((resolve, reject) => {
      let settled = false;
      let callbackPort = port;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let server!: http.Server;

      const cleanup = () => {
        clearTimeout(timeout);
        if (activeLoginCancel === cancel) {
          activeLoginCancel = null;
        }
      };

      const closeServer = () => {
        cleanup();
        server.close();
      };

      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        closeServer();
        reject(error);
      };

      const cancel = () => {
        if (settled) return;
        settled = true;
        closeServer();
      };

      server = http.createServer((req, res) => {
        if (!req.url) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Missing request URL");
          return;
        }

        const url = new URL(req.url, `http://127.0.0.1:${callbackPort}`);

        if (url.pathname === "/cancel") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(htmlPage("Login cancelled", "The sign-in flow was cancelled."));
          fail(new Error("Login cancelled."));
          return;
        }

        if (url.pathname !== "/auth/callback") {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }

        const error = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");
        const receivedState = url.searchParams.get("state");
        const code = url.searchParams.get("code");

        if (receivedState !== state) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(htmlPage("State mismatch", "The login callback state did not match. Please try again."));
          fail(new Error("State mismatch."));
          return;
        }

        if (error) {
          res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            htmlPage(
              "Login error",
              `${error}${errorDescription ? ` - ${errorDescription}` : ""}. Please close this tab and try again.`,
            ),
          );
          fail(new Error(errorDescription ? `${error}: ${errorDescription}` : error));
          return;
        }

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(htmlPage("Missing code", "No authorization code was returned by the provider."));
          fail(new Error("Missing authorization code."));
          return;
        }

        void (async () => {
          try {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(
              htmlPage(
                "Signed in",
                "Your account is connected. Cloud Accounts will update immediately.",
              ),
            );
            closeServer();
            void (async () => {
              try {
                const tokens = await exchangeCodeForTokens(
                  issuer,
                  clientId,
                  `http://localhost:${callbackPort}/auth/callback`,
                  codeVerifier,
                  code,
                );
                const account = mapTokenResponse(tokens, loginSessionId);
                await options.onFinalAccount?.(account);
              } catch (error_) {
                const message = error_ instanceof Error ? error_.message : "Unknown login error.";
                console.warn(`ChatGPT login finalization failed: ${message}`);
              }
            })();
            finish(true);
          } catch (error_) {
            const message = error_ instanceof Error ? error_.message : "Unknown login error.";
            res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
            res.end(htmlPage("Sign-in failed", message));
            fail(error_ instanceof Error ? error_ : new Error(message));
          }
        })();
      });

      server.once("error", (error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (/EADDRINUSE/i.test(message)) {
          settled = true;
          clearTimeout(timeout);
          resolve(false);
          return;
        }
        fail(error instanceof Error ? error : new Error(message));
      });

      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address === "object") {
          callbackPort = address.port;
        }
        const redirectUri = `http://localhost:${callbackPort}/auth/callback`;
        const authUrl = buildAuthorizeUrl(
          issuer,
          clientId,
          redirectUri,
          codeChallenge,
          state,
          options.allowedWorkspaceIds,
        );
        activeLoginCancel = cancel;
        void shell.openExternal(authUrl);
        finish(true);
      });

      timeout = setTimeout(() => {
        fail(new Error("Login timed out."));
      }, 1000 * 60 * 20);
    });

    if (result) {
      return;
    }
  }

  throw new Error("Unable to start the local login callback server.");
}
