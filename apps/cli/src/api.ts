import type { Config, Env } from "./config.ts";
import { loadConfig } from "./config.ts";
import { CliError } from "./errors.ts";

export type ApiContext = {
  apiUrl: string;
  apiKey?: string;
};

/** Default hosted API endpoint, used when no flag, env, or config value is set. */
const DEFAULT_API_URL = "https://daylo.cc";

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
  return url.replace(/\/+$/, "");
}

export function requireApiKey(config: Config): string {
  if (config.apiKey === undefined || config.apiKey === "") {
    throw new CliError("not_logged_in", "Not logged in. Run `daylo login` first.");
  }
  return config.apiKey;
}

/** Build the authenticated API context for a command (config + flag/env overrides). */
export function buildContext(apiUrlFlag: string | undefined, env: Env = process.env): ApiContext {
  const config = loadConfig(env);
  return {
    apiUrl: resolveApiUrl(apiUrlFlag, config, env),
    apiKey: requireApiKey(config),
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
