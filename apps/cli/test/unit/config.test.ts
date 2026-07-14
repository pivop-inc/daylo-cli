import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir, configPath, loadConfig, saveConfig } from "../../src/config.ts";
import { CliError } from "../../src/errors.ts";
import { makeConfigDir } from "../helpers.ts";

let temp: { dir: string; cleanup: () => void };
let env: Record<string, string>;

beforeEach(() => {
  temp = makeConfigDir();
  env = { DAYLO_CONFIG_DIR: temp.dir };
});
afterEach(() => temp.cleanup());

describe("configDir / configPath", () => {
  test("honors DAYLO_CONFIG_DIR override", () => {
    expect(configDir(env)).toBe(temp.dir);
    expect(configPath(env)).toBe(join(temp.dir, "config.json"));
  });

  test("falls back to ~/.config/daylo when unset", () => {
    expect(configDir({})).toMatch(/\.config\/daylo$/);
  });
});

describe("loadConfig", () => {
  test("returns {} when the file is absent", () => {
    expect(loadConfig(env)).toEqual({});
  });

  test("round-trips a saved config", () => {
    saveConfig({ apiUrl: "http://x", apiKey: "k" }, env);
    expect(loadConfig(env)).toEqual({ apiUrl: "http://x", apiKey: "k" });
  });

  test("ignores non-string fields", () => {
    writeFileSync(configPath(env), JSON.stringify({ apiUrl: 5, apiKey: "k" }));
    expect(loadConfig(env)).toEqual({ apiKey: "k" });
  });

  test("throws on invalid JSON", () => {
    writeFileSync(configPath(env), "{not json");
    expect(() => loadConfig(env)).toThrow(CliError);
  });

  test("throws when the top level is not an object", () => {
    writeFileSync(configPath(env), "[]");
    expect(() => loadConfig(env)).toThrow(CliError);
  });
});

describe("saveConfig", () => {
  test("writes the file mode 600", () => {
    const path = saveConfig({ apiUrl: "http://x", apiKey: "k" }, env);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("overwrites an existing file and re-applies mode 600", () => {
    const path = saveConfig({ apiUrl: "http://a" }, env);
    writeFileSync(path, "loose", { mode: 0o644 });
    saveConfig({ apiUrl: "http://b", apiKey: "k" }, env);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(loadConfig(env)).toEqual({ apiUrl: "http://b", apiKey: "k" });
  });
});
