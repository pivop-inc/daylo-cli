import { UsageError } from "./errors.ts";

export type FlagSpec = Record<string, { takesValue: boolean }>;

export type ParsedArgs = {
  positionals: string[];
  flags: Record<string, string | true>;
};

export function parseArgs(argv: string[], spec: FlagSpec): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const flag = spec[name];
      if (flag === undefined) throw new UsageError(`Unknown flag --${name}`);
      if (flag.takesValue) {
        if (eq !== -1) {
          flags[name] = arg.slice(eq + 1);
        } else {
          const next = argv[i + 1];
          if (next === undefined) throw new UsageError(`Flag --${name} requires a value`);
          flags[name] = next;
          i++;
        }
      } else {
        if (eq !== -1) throw new UsageError(`Flag --${name} does not take a value`);
        flags[name] = true;
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      throw new UsageError(`Unknown flag ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

export function stringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags[name];
  return typeof value === "string" ? value : undefined;
}

export function boolFlag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags[name] === true;
}
