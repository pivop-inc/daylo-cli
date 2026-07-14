import { apiFetch, buildContext } from "../api.ts";
import { parseArgs, stringFlag } from "../args.ts";
import { UsageError } from "../errors.ts";
import { printJson } from "../output.ts";

export async function runSync(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv, { "api-url": { takesValue: true } });
  if (parsed.positionals.length > 0) throw new UsageError("daylo sync takes no arguments");
  const ctx = buildContext(stringFlag(parsed, "api-url"));
  const body = await apiFetch(ctx, "/api/v1/sync", { method: "POST" });
  printJson(body);
}
