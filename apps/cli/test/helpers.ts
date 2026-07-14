import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN = join(import.meta.dir, "..", "bin", "daylo.ts");

export type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
  /** stdout parsed as JSON (the CLI prints one JSON value per line). */
  json(): unknown;
};

export type RunOptions = {
  /** Value written to the child's stdin (e.g. prompt answers). */
  input?: string;
  /** Extra environment variables layered over a clean base. */
  env?: Record<string, string | undefined>;
};

/**
 * Run the real `daylo` binary in a child process. Every run gets an isolated
 * config dir and a disabled browser so tests never touch ~/.config/daylo or
 * spawn a GUI. Pass `env.DAYLO_CONFIG_DIR` to share config across runs.
 */
export async function runCli(args: string[], options: RunOptions = {}): Promise<RunResult> {
  const proc = Bun.spawn(["bun", BIN, ...args], {
    env: {
      PATH: process.env["PATH"],
      HOME: process.env["HOME"],
      DAYLO_NO_BROWSER: "1",
      ...options.env,
    },
    stdin: options.input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (options.input !== undefined && proc.stdin !== undefined) {
    proc.stdin.write(options.input);
    await proc.stdin.end();
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return {
    code,
    stdout,
    stderr,
    json: () => JSON.parse(stdout.trim()),
  };
}

/** Create a throwaway config dir; returns the path and a cleanup function. */
export function makeConfigDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "daylo-e2e-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
