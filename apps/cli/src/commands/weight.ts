import { apiFetch, buildContext } from "../api.ts";
import { boolFlag, parseArgs, stringFlag } from "../args.ts";
import { CliError, UsageError } from "../errors.ts";
import { formatLatestPretty, formatListPretty, printJson, printText } from "../output.ts";
import type { WeightMeasurement } from "../types.ts";
import { isProviderId, PROVIDER_IDS } from "../types.ts";

export async function runLatest(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv, {
    "api-url": { takesValue: true },
    pretty: { takesValue: false },
  });
  if (parsed.positionals.length > 0) throw new UsageError("daylo latest takes no arguments");
  const ctx = buildContext(stringFlag(parsed, "api-url"));
  const body = await apiFetch(ctx, "/api/v1/weight/latest");
  if (typeof body !== "object" || body === null || !("latest" in body)) {
    throw new CliError("unexpected_response", "Response did not include a `latest` field.");
  }
  const latest = (body as { latest: WeightMeasurement | null }).latest;
  if (boolFlag(parsed, "pretty")) printText(formatLatestPretty(latest));
  else printJson(latest);
}

export async function runList(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv, {
    "api-url": { takesValue: true },
    days: { takesValue: true },
    provider: { takesValue: true },
    pretty: { takesValue: false },
  });
  if (parsed.positionals.length > 0) throw new UsageError("daylo list takes no arguments");

  const query = new URLSearchParams();
  const days = stringFlag(parsed, "days");
  if (days !== undefined) {
    if (!/^\d+$/.test(days) || Number.parseInt(days, 10) < 1) {
      throw new UsageError("--days must be a positive integer");
    }
    query.set("days", days);
  }
  const provider = stringFlag(parsed, "provider");
  if (provider !== undefined) {
    if (!isProviderId(provider)) {
      throw new UsageError(
        `Unknown provider "${provider}". Expected one of: ${PROVIDER_IDS.join(", ")}`,
      );
    }
    query.set("provider", provider);
  }

  const ctx = buildContext(stringFlag(parsed, "api-url"));
  const qs = query.size > 0 ? `?${query.toString()}` : "";
  const body = await apiFetch(ctx, `/api/v1/weight/list${qs}`);
  const measurements =
    typeof body === "object" && body !== null
      ? (body as { measurements?: unknown }).measurements
      : undefined;
  if (!Array.isArray(measurements)) {
    throw new CliError("unexpected_response", "Response did not include a `measurements` array.");
  }
  if (boolFlag(parsed, "pretty")) printText(formatListPretty(measurements as WeightMeasurement[]));
  else printJson(measurements);
}
