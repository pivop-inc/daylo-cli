import type { ApiContext } from "../api.ts";
import { apiFetch, buildContext } from "../api.ts";
import type { ParsedArgs } from "../args.ts";
import { parseArgs, stringFlag } from "../args.ts";
import { openBrowser } from "../browser.ts";
import { CliError, UsageError } from "../errors.ts";
import { note, printJson } from "../output.ts";
import type { ProviderId, ProviderStatus } from "../types.ts";
import { isProviderId, PROVIDER_IDS } from "../types.ts";

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function parseProviderCommand(
  command: string,
  argv: string[],
): { provider: ProviderId; parsed: ParsedArgs } {
  const parsed = parseArgs(argv, { "api-url": { takesValue: true } });
  const [provider, ...rest] = parsed.positionals;
  if (provider === undefined) {
    throw new UsageError(`Usage: daylo ${command} <${PROVIDER_IDS.join("|")}>`);
  }
  if (rest.length > 0) {
    throw new UsageError(`daylo ${command} takes exactly one provider argument`);
  }
  if (!isProviderId(provider)) {
    throw new UsageError(
      `Unknown provider "${provider}". Expected one of: ${PROVIDER_IDS.join(", ")}`,
    );
  }
  return { provider, parsed };
}

async function fetchProviderStatus(ctx: ApiContext, provider: ProviderId): Promise<ProviderStatus> {
  const body = await apiFetch(ctx, "/api/v1/providers");
  const providers =
    typeof body === "object" && body !== null
      ? (body as { providers?: unknown }).providers
      : undefined;
  if (!Array.isArray(providers)) {
    throw new CliError(
      "unexpected_response",
      "GET /api/v1/providers did not return a providers array.",
    );
  }
  const entry = providers.find(
    (p: unknown): p is ProviderStatus =>
      typeof p === "object" &&
      p !== null &&
      (p as { provider?: unknown }).provider === provider &&
      typeof (p as { connected?: unknown }).connected === "boolean",
  );
  if (entry === undefined) {
    throw new CliError(
      "unexpected_response",
      `Provider "${provider}" missing from /api/v1/providers response.`,
    );
  }
  return entry;
}

export async function runConnect(argv: string[]): Promise<void> {
  const { provider, parsed } = parseProviderCommand("connect", argv);
  const ctx = buildContext(stringFlag(parsed, "api-url"));

  const body = await apiFetch(ctx, `/api/v1/providers/${provider}/connect`, { method: "POST" });
  const authorizeUrl =
    typeof body === "object" && body !== null
      ? (body as { authorizeUrl?: unknown }).authorizeUrl
      : undefined;
  if (typeof authorizeUrl !== "string") {
    throw new CliError(
      "unexpected_response",
      "Connect response did not include an `authorizeUrl` string.",
    );
  }

  note(`Open this URL in your browser to authorize ${provider}:`);
  note(`  ${authorizeUrl}`);
  if (openBrowser(authorizeUrl)) note("Opened your browser.");

  const intervalMs = positiveIntEnv("DAYLO_CONNECT_POLL_INTERVAL_MS", DEFAULT_POLL_INTERVAL_MS);
  const timeoutMs = positiveIntEnv("DAYLO_CONNECT_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  note(`Waiting for authorization (timeout ${Math.round(timeoutMs / 1000)}s)...`);

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await fetchProviderStatus(ctx, provider);
    if (status.connected) {
      printJson(status);
      return;
    }
    if (Date.now() + intervalMs > deadline) {
      throw new CliError(
        "connect_timeout",
        `Timed out waiting for ${provider} authorization after ${Math.round(timeoutMs / 1000)}s.`,
      );
    }
    await Bun.sleep(intervalMs);
  }
}

export async function runDisconnect(argv: string[]): Promise<void> {
  const { provider, parsed } = parseProviderCommand("disconnect", argv);
  const ctx = buildContext(stringFlag(parsed, "api-url"));
  const body = await apiFetch(ctx, `/api/v1/providers/${provider}`, { method: "DELETE" });
  printJson(body);
}
