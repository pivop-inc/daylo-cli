import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CliError } from "./errors.ts";

export type Config = {
  apiUrl?: string;
  apiKey?: string;
};

export type Env = Record<string, string | undefined>;

export function configDir(env: Env = process.env): string {
  const override = env["DAYLO_CONFIG_DIR"];
  if (override !== undefined && override !== "") return override;
  return join(homedir(), ".config", "daylo");
}

export function configPath(env: Env = process.env): string {
  return join(configDir(env), "config.json");
}

export function loadConfig(env: Env = process.env): Config {
  const path = configPath(env);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new CliError(
      "config_unreadable",
      `Could not read config at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError(
      "config_invalid",
      `Config at ${path} is not valid JSON. Fix or delete it, then run \`daylo login\`.`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CliError("config_invalid", `Config at ${path} must be a JSON object.`);
  }
  const record = parsed as Record<string, unknown>;
  const config: Config = {};
  if (typeof record["apiUrl"] === "string") config.apiUrl = record["apiUrl"];
  if (typeof record["apiKey"] === "string") config.apiKey = record["apiKey"];
  return config;
}

export function saveConfig(config: Config, env: Env = process.env): string {
  const dir = configDir(env);
  const path = configPath(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync's mode only applies when the file is created; enforce it always.
  chmodSync(path, 0o600);
  return path;
}
