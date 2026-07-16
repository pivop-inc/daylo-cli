/**
 * End-to-end tests: they run the real `daylo` binary in a child process against
 * a backend reached over HTTP. By default that backend is the spec-faithful mock
 * (createMockServer); set DAYLO_E2E_API_URL to re-run the *protocol* assertions
 * against a real local backend instead:
 *
 *   DAYLO_E2E_API_URL=http://localhost:8787 \
 *   DAYLO_E2E_API_KEY=daylo_... \
 *   bun test test/e2e/cli.test.ts
 *
 * `daylo login` uses the browser-based device flow, which needs a human to sign
 * in and approve. The mock auto-approves; against a real backend there is no
 * browser, so supply a pre-minted DAYLO_E2E_API_KEY and the suite writes config
 * directly instead of running `login`.
 *
 * Assertions are split in two:
 *   - PROTOCOL assertions (shape, exit codes, error envelope) run everywhere.
 *   - FIXTURE assertions (exact mock weights, browser-auto-complete on connect)
 *     run only against the mock — guarded by `mockTest` / `if (usingMock)`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { saveConfig } from "../../src/config.ts";
import type { WeightMeasurement } from "../../src/types.ts";
import { PROVIDER_IDS } from "../../src/types.ts";
import { createMockServer, defaultFixtures, type MockServer } from "./mock-server.ts";
import { makeConfigDir, runCli } from "../helpers.ts";

const injectedUrl = process.env["DAYLO_E2E_API_URL"];
const usingMock = injectedUrl === undefined || injectedUrl === "";
/** Skip fixture-shaped tests when pointed at a real backend. */
const mockTest = usingMock ? test : test.skip;

/** A pre-minted key lets the real-backend E2E skip the browser device flow. */
const injectedApiKey = process.env["DAYLO_E2E_API_KEY"];

let server: MockServer | undefined;
let captureServer: ReturnType<typeof Bun.serve> | undefined;
let captureUrl: string;
let captureRequests = 0;
let captureAuthorizationHeaders: Array<string | null> = [];
let apiUrl: string;
let authed: { dir: string; cleanup: () => void };

/** Env for an authenticated command: reuse the config login() populated. */
function authedEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { DAYLO_CONFIG_DIR: authed.dir, ...extra };
}

function assertMeasurementShape(m: unknown): asserts m is WeightMeasurement {
  expect(m).toMatchObject({
    id: expect.any(String),
    provider: expect.any(String),
    measuredAt: expect.any(String),
    weightKg: expect.any(Number),
  });
  const fat = (m as WeightMeasurement).fatRatioPercent;
  expect(fat === null || typeof fat === "number").toBe(true);
}

beforeAll(async () => {
  captureServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      captureRequests += 1;
      captureAuthorizationHeaders.push(request.headers.get("authorization"));
      return new Response("ok");
    },
  });
  captureUrl = captureServer.url.origin;
  if (usingMock) {
    server = createMockServer({ connectAutoCompleteMs: 120 });
    apiUrl = server.url;
  } else {
    apiUrl = injectedUrl!.replace(/\/+$/, "");
  }
  authed = makeConfigDir();
  if (!usingMock && injectedApiKey !== undefined && injectedApiKey !== "") {
    // Real backend: the device flow needs a browser, so write config directly.
    saveConfig({ apiUrl, apiKey: injectedApiKey }, { DAYLO_CONFIG_DIR: authed.dir });
  } else {
    // Populate config with a real API key by driving `daylo login` end to end.
    // The mock auto-approves the device, simulating the browser sign-in.
    const login = await runCli(["login", "--api-url", apiUrl], {
      env: authedEnv({ DAYLO_LOGIN_POLL_INTERVAL_MS: "40" }),
    });
    expect(login.stderr + login.stdout).toBeTruthy();
    expect(login.code).toBe(0);
    expect((login.json() as { ok: boolean }).ok).toBe(true);
  }
});

afterAll(() => {
  server?.stop();
  captureServer?.stop(true);
  authed?.cleanup();
});

describe("login", () => {
  test("wrote a mode-600 config carrying apiUrl + apiKey", () => {
    const path = join(authed.dir, "config.json");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const cfg = JSON.parse(readFileSync(path, "utf8")) as { apiUrl: string; apiKey: string };
    expect(cfg.apiUrl).toBe(apiUrl);
    expect(typeof cfg.apiKey).toBe("string");
    expect(cfg.apiKey.length).toBeGreaterThan(0);
  });
});

describe("latest", () => {
  test("returns null or a well-shaped measurement (protocol)", async () => {
    const res = await runCli(["latest"], { env: authedEnv() });
    expect(res.code).toBe(0);
    const latest = res.json();
    if (latest !== null) assertMeasurementShape(latest);
  });

  mockTest("returns the newest fixture (fixture)", async () => {
    const res = await runCli(["latest"], { env: authedEnv() });
    const latest = res.json() as WeightMeasurement;
    expect(latest.id).toBe("withings:1001");
    expect(latest.weightKg).toBe(72.4);
  });

  mockTest("--pretty prints human text, not JSON (fixture)", async () => {
    const res = await runCli(["latest", "--pretty"], { env: authedEnv() });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("kg");
    expect(() => res.json()).toThrow();
  });
});

describe("list", () => {
  test("returns an array of well-shaped measurements (protocol)", async () => {
    const res = await runCli(["list"], { env: authedEnv() });
    expect(res.code).toBe(0);
    const measurements = res.json();
    expect(Array.isArray(measurements)).toBe(true);
    for (const m of measurements as unknown[]) assertMeasurementShape(m);
  });

  mockTest("default window is 30 days, newest first (fixture)", async () => {
    const res = await runCli(["list"], { env: authedEnv() });
    const measurements = res.json() as WeightMeasurement[];
    // Two fixtures are within 30 days; the 45-day-old one is excluded.
    expect(measurements.map((m) => m.id)).toEqual(["withings:1001", "tanita:20260709"]);
  });

  mockTest("--days 365 widens the window (fixture)", async () => {
    const res = await runCli(["list", "--days", "365"], { env: authedEnv() });
    expect((res.json() as WeightMeasurement[]).length).toBe(defaultFixtures().length);
  });

  mockTest("--provider filters (fixture)", async () => {
    const res = await runCli(["list", "--days", "365", "--provider", "tanita"], {
      env: authedEnv(),
    });
    const measurements = res.json() as WeightMeasurement[];
    expect(measurements.every((m) => m.provider === "tanita")).toBe(true);
    expect(measurements.length).toBe(1);
  });

  test("--days 0 is rejected as usage error (protocol)", async () => {
    const res = await runCli(["list", "--days", "0"], { env: authedEnv() });
    expect(res.code).toBe(2);
  });

  test("--provider fitbit is rejected as usage error (protocol)", async () => {
    const res = await runCli(["list", "--provider", "fitbit"], { env: authedEnv() });
    expect(res.code).toBe(2);
  });
});

describe("sync", () => {
  test("returns a synced map (protocol)", async () => {
    const res = await runCli(["sync"], { env: authedEnv() });
    expect(res.code).toBe(0);
    const body = res.json() as { synced?: unknown };
    expect(typeof body.synced).toBe("object");
    expect(body.synced).not.toBeNull();
  });
});

describe("connect / disconnect (mock only — real OAuth needs a human)", () => {
  mockTest("connect polls until the provider reports connected", async () => {
    const res = await runCli(["connect", "withings"], {
      env: authedEnv({ DAYLO_CONNECT_POLL_INTERVAL_MS: "40", DAYLO_CONNECT_TIMEOUT_MS: "8000" }),
    });
    expect(res.code).toBe(0);
    const status = res.json() as { provider: string; connected: boolean };
    expect(status.provider).toBe("withings");
    expect(status.connected).toBe(true);
  });

  mockTest("after connect, sync reports a count for that provider", async () => {
    const res = await runCli(["sync"], { env: authedEnv() });
    const synced = (res.json() as { synced: Record<string, number> }).synced;
    expect(typeof synced["withings"]).toBe("number");
  });

  mockTest("disconnect returns ok", async () => {
    const res = await runCli(["disconnect", "withings"], { env: authedEnv() });
    expect(res.code).toBe(0);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe("errors and usage", () => {
  mockTest("--api-url cannot forward the stored key to another origin", async () => {
    captureRequests = 0;
    captureAuthorizationHeaders = [];
    const res = await runCli(["latest", "--api-url", captureUrl], { env: authedEnv() });
    expect(res.code).toBe(1);
    expect(res.stdout).toBe("");
    const err = JSON.parse(res.stderr.trim()) as { error: { code: string } };
    expect(err.error.code).toBe("api_origin_mismatch");
    expect(captureRequests).toBe(0);
    expect(captureAuthorizationHeaders).toEqual([]);
  });

  mockTest("DAYLO_API_URL cannot forward the stored key to another origin", async () => {
    captureRequests = 0;
    captureAuthorizationHeaders = [];
    const res = await runCli(["latest"], {
      env: authedEnv({ DAYLO_API_URL: captureUrl }),
    });
    expect(res.code).toBe(1);
    const err = JSON.parse(res.stderr.trim()) as { error: { code: string } };
    expect(err.error.code).toBe("api_origin_mismatch");
    expect(captureRequests).toBe(0);
    expect(captureAuthorizationHeaders).toEqual([]);
  });

  test("not logged in → exit 1 with JSON error on stderr", async () => {
    const fresh = makeConfigDir();
    try {
      const res = await runCli(["latest", "--api-url", apiUrl], {
        env: { DAYLO_CONFIG_DIR: fresh.dir },
      });
      expect(res.code).toBe(1);
      expect(res.stdout).toBe("");
      const err = JSON.parse(res.stderr.trim()) as { error: { code: string } };
      expect(err.error.code).toBe("not_logged_in");
    } finally {
      fresh.cleanup();
    }
  });

  test("unknown command → exit 2", async () => {
    const res = await runCli(["frobnicate"], { env: authedEnv() });
    expect(res.code).toBe(2);
    const err = JSON.parse(res.stderr.trim()) as { error: { code: string } };
    expect(err.error.code).toBe("usage");
  });

  test("unknown flag → exit 2", async () => {
    const res = await runCli(["latest", "--nope"], { env: authedEnv() });
    expect(res.code).toBe(2);
  });

  test("--help → exit 0 with usage on stdout", async () => {
    const res = await runCli(["--help"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Usage: daylo");
  });

  test("known providers are the two spec providers", () => {
    expect([...PROVIDER_IDS]).toEqual(["withings", "tanita"]);
  });
});
