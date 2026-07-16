import { runLogin } from "./commands/login.ts";
import { runConnect, runDisconnect } from "./commands/providers.ts";
import { runSync } from "./commands/sync.ts";
import { runLatest, runList } from "./commands/weight.ts";
import { CliError, UsageError } from "./errors.ts";

export const USAGE = `daylo — one API for every smart scale

Usage: daylo <command> [options]

Commands:
  login                      Sign in via browser (device flow), create an API key, save config
  connect <withings|tanita>  Authorize a provider (opens browser, waits up to 5m)
  disconnect <withings|tanita>
  sync                       Pull new measurements from connected providers
  latest [--pretty]          Newest measurement as JSON (or null)
  list [--days 30] [--provider withings|tanita] [--pretty]

Options:
  --api-url <url>   Select API base URL (also: DAYLO_API_URL; keys stay origin-bound)
  --pretty          Human-readable output (default output is JSON on stdout)
  --help, -h        Show this help

Config: ~/.config/daylo/config.json (override dir with DAYLO_CONFIG_DIR)
Exit codes: 0 success, 1 error, 2 usage. Errors are JSON on stderr.`;

export async function run(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h") || argv[0] === "help") {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const [command, ...rest] = argv;
  if (command === undefined) {
    throw new UsageError(`Missing command.\n\n${USAGE}`);
  }
  switch (command) {
    case "login":
      return runLogin(rest);
    case "connect":
      return runConnect(rest);
    case "disconnect":
      return runDisconnect(rest);
    case "sync":
      return runSync(rest);
    case "latest":
      return runLatest(rest);
    case "list":
      return runList(rest);
    default:
      throw new UsageError(`Unknown command "${command}".\n\n${USAGE}`);
  }
}

export async function main(argv: string[]): Promise<void> {
  try {
    await run(argv);
  } catch (error) {
    const cliError =
      error instanceof CliError
        ? error
        : new CliError("internal_error", error instanceof Error ? error.message : String(error));
    process.stderr.write(
      `${JSON.stringify({ error: { code: cliError.code, message: cliError.message } })}\n`,
    );
    process.exitCode = cliError.exitCode;
  }
}
