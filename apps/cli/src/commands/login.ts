import { resolveApiUrl } from "../api.ts";
import { parseArgs, stringFlag } from "../args.ts";
import { openBrowser } from "../browser.ts";
import { loadConfig, saveConfig } from "../config.ts";
import { CliError, UsageError } from "../errors.ts";
import { note, printJson } from "../output.ts";

const CLIENT_ID = "daylo-cli";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function postJson(url: string, origin: string, body: unknown): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      // Better Auth's CSRF protection rejects cookie-auth POSTs without an Origin.
      headers: { "content-type": "application/json", accept: "application/json", origin },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new CliError(
      "network_error",
      `Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

type DeviceCode = {
  deviceCode: string;
  userCode: string;
  verificationUriComplete: string;
  intervalMs: number;
  expiresInMs: number;
};

async function requestDeviceCode(apiUrl: string): Promise<DeviceCode> {
  const response = await postJson(`${apiUrl}/api/auth/device/code`, apiUrl, {
    client_id: CLIENT_ID,
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || body === null) {
    throw new CliError(
      "device_code_failed",
      `Could not start the device login flow (HTTP ${response.status}).`,
    );
  }
  const deviceCode = body["device_code"];
  const userCode = body["user_code"];
  const verificationUriComplete = body["verification_uri_complete"] ?? body["verification_uri"];
  if (
    typeof deviceCode !== "string" ||
    typeof userCode !== "string" ||
    typeof verificationUriComplete !== "string"
  ) {
    throw new CliError("unexpected_response", "Device code response was missing required fields.");
  }
  const interval = typeof body["interval"] === "number" ? body["interval"] : 5;
  const expiresIn = typeof body["expires_in"] === "number" ? body["expires_in"] : 1800;
  return {
    deviceCode,
    userCode,
    verificationUriComplete,
    intervalMs: interval * 1000,
    expiresInMs: expiresIn * 1000,
  };
}

/** Poll the token endpoint until the browser approves, then return the session token. */
async function pollForToken(apiUrl: string, code: DeviceCode): Promise<string> {
  let intervalMs = positiveIntEnv("DAYLO_LOGIN_POLL_INTERVAL_MS", code.intervalMs);
  const timeoutMs = positiveIntEnv("DAYLO_LOGIN_TIMEOUT_MS", code.expiresInMs);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const response = await postJson(`${apiUrl}/api/auth/device/token`, apiUrl, {
      grant_type: GRANT_TYPE,
      device_code: code.deviceCode,
      client_id: CLIENT_ID,
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;

    if (response.ok) {
      const token = body === null ? undefined : body["access_token"];
      if (typeof token !== "string") {
        throw new CliError(
          "unexpected_response",
          "Token response did not include an `access_token` string.",
        );
      }
      return token;
    }

    const error = body === null ? undefined : body["error"];
    if (error === "slow_down") {
      intervalMs += 5000;
    } else if (error === "access_denied") {
      throw new CliError("access_denied", "Login was denied in the browser.");
    } else if (error === "expired_token") {
      throw new CliError(
        "expired_token",
        "The login request expired before you approved it. Run `daylo login` again.",
      );
    } else if (error !== "authorization_pending") {
      throw new CliError(
        "device_token_failed",
        `Login failed (HTTP ${response.status}${typeof error === "string" ? `: ${error}` : ""}).`,
      );
    }

    if (Date.now() + intervalMs > deadline) {
      throw new CliError(
        "login_timeout",
        `Timed out waiting for browser approval after ${Math.round(timeoutMs / 1000)}s. Run \`daylo login\` again.`,
      );
    }
    await Bun.sleep(intervalMs);
  }
}

async function createApiKey(apiUrl: string, accessToken: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/api/auth/api-key/create`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        // Better Auth's CSRF protection rejects cookie-auth POSTs without an Origin.
        origin: apiUrl,
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name: "cli" }),
    });
  } catch (error) {
    throw new CliError(
      "network_error",
      `Could not reach ${apiUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new CliError(
      "api_key_create_failed",
      `Could not create API key (HTTP ${response.status}).`,
    );
  }
  const body = (await response.json().catch(() => null)) as { key?: unknown } | null;
  if (body === null || typeof body.key !== "string") {
    throw new CliError("unexpected_response", "API key response did not include a `key` string.");
  }
  return body.key;
}

export async function runLogin(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv, { "api-url": { takesValue: true } });
  if (parsed.positionals.length > 0) {
    throw new UsageError("daylo login takes no positional arguments");
  }
  const existing = loadConfig();
  const apiUrl = resolveApiUrl(stringFlag(parsed, "api-url"), existing);

  const code = await requestDeviceCode(apiUrl);
  note(`To sign in, open this URL in your browser and approve the request:`);
  note(`  ${code.verificationUriComplete}`);
  note(`Code: ${code.userCode}`);
  if (openBrowser(code.verificationUriComplete)) note("Opened your browser.");
  note("Waiting for you to sign in (Google or magic link) and approve...");

  const accessToken = await pollForToken(apiUrl, code);
  const apiKey = await createApiKey(apiUrl, accessToken);
  const path = saveConfig({ apiUrl, apiKey });
  note(`Saved API key "cli" to ${path}`);
  printJson({ ok: true, apiUrl });
}
