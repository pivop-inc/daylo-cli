import type { Config, Env } from "./config.ts";
import { loadConfig } from "./config.ts";
import { CliError } from "./errors.ts";

export type ApiContext = {
  apiUrl: string;
  apiKey?: string;
};

/** Default hosted API endpoint, used when no flag, env, or config value is set. */
const DEFAULT_API_URL = "https://daylo.cc";
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseApiUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CliError("api_url_invalid", "API URL must be an absolute HTTP(S) URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new CliError("api_url_invalid", "API URL must use the http or https scheme.");
  }
  if (parsed.protocol === "http:" && !LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase())) {
    throw new CliError(
      "api_url_insecure",
      "API URL must use HTTPS unless it is localhost, 127.0.0.1, or [::1].",
    );
  }
  return parsed;
}

export function resolveApiUrl(
  flagValue: string | undefined,
  config: Config,
  env: Env = process.env,
): string {
  const url = flagValue ?? env["DAYLO_API_URL"] ?? config.apiUrl ?? DEFAULT_API_URL;
  if (url === "") {
    throw new CliError(
      "api_url_missing",
      "API URL is empty. Pass --api-url <url>, set DAYLO_API_URL, or run `daylo login` to configure one.",
    );
  }
  return parseApiUrl(url).href.replace(/\/+$/, "");
}

export function requireApiKey(config: Config): string {
  if (config.apiKey === undefined || config.apiKey === "") {
    throw new CliError("not_logged_in", "Not logged in. Run `daylo login` first.");
  }
  return config.apiKey;
}

/** Refuse to forward a stored API key outside the origin where it was issued. */
export function assertApiKeyOrigin(apiUrl: string, config: Config): void {
  if (config.apiUrl === undefined || config.apiUrl === "") {
    throw new CliError(
      "api_key_origin_missing",
      "Stored API key is not bound to an API origin. Run `daylo login` again.",
    );
  }
  const targetOrigin = parseApiUrl(apiUrl).origin;
  const savedOrigin = parseApiUrl(config.apiUrl).origin;
  if (targetOrigin !== savedOrigin) {
    throw new CliError(
      "api_origin_mismatch",
      `Refusing to send the stored API key to ${targetOrigin}; it was issued for ${savedOrigin}. Run \`daylo login --api-url ${apiUrl}\` to use that API.`,
    );
  }
}

/** Build the authenticated API context for a command (config + flag/env overrides). */
export function buildContext(apiUrlFlag: string | undefined, env: Env = process.env): ApiContext {
  const config = loadConfig(env);
  const apiUrl = resolveApiUrl(apiUrlFlag, config, env);
  const apiKey = requireApiKey(config);
  assertApiKeyOrigin(apiUrl, config);
  return {
    apiUrl,
    apiKey,
  };
}

async function parseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function toApiError(status: number, body: unknown): CliError {
  if (typeof body === "object" && body !== null && "error" in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === "object" && err !== null) {
      const code = (err as { code?: unknown }).code;
      const message = (err as { message?: unknown }).message;
      if (typeof code === "string" && typeof message === "string") {
        return new CliError(code, message);
      }
    }
  }
  return new CliError("http_error", `Request failed with HTTP ${status}`);
}

export async function apiFetch(
  ctx: ApiContext,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (ctx.apiKey !== undefined) headers["authorization"] = `Bearer ${ctx.apiKey}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(`${ctx.apiUrl}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    throw new CliError(
      "network_error",
      `Could not reach ${ctx.apiUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const body = await parseBody(response);
  if (!response.ok) throw toApiError(response.status, body);
  return body;
}
