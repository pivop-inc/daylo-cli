import { describe, expect, test } from "bun:test";
import { assertApiKeyOrigin, requireApiKey, resolveApiUrl, toApiError } from "../../src/api.ts";
import { CliError } from "../../src/errors.ts";

function expectCliError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error("should have thrown");
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe(code);
    expect((error as CliError).exitCode).toBe(1);
  }
}

describe("resolveApiUrl", () => {
  test("prefers the flag over env and config", () => {
    const url = resolveApiUrl(
      "https://flag.example",
      { apiUrl: "https://config.example" },
      { DAYLO_API_URL: "https://env.example" },
    );
    expect(url).toBe("https://flag.example");
  });

  test("prefers env over config", () => {
    const url = resolveApiUrl(
      undefined,
      { apiUrl: "https://config.example" },
      { DAYLO_API_URL: "https://env.example" },
    );
    expect(url).toBe("https://env.example");
  });

  test("falls back to config", () => {
    expect(resolveApiUrl(undefined, { apiUrl: "https://config.example" }, {})).toBe(
      "https://config.example",
    );
  });

  test("strips trailing slashes", () => {
    expect(resolveApiUrl("https://x.example/", {}, {})).toBe("https://x.example");
    expect(resolveApiUrl("https://x.example///", {}, {})).toBe("https://x.example");
  });

  test("falls back to the default hosted API when nothing is configured", () => {
    expect(resolveApiUrl(undefined, {}, {})).toBe("https://daylo.cc");
  });

  test("throws when the resolved URL is empty", () => {
    expectCliError(() => resolveApiUrl("", {}, {}), "api_url_missing");
  });

  test("allows HTTPS and loopback HTTP", () => {
    expect(resolveApiUrl("https://api.example", {}, {})).toBe("https://api.example");
    expect(resolveApiUrl("http://localhost:8787", {}, {})).toBe("http://localhost:8787");
    expect(resolveApiUrl("http://127.0.0.1:8787", {}, {})).toBe("http://127.0.0.1:8787");
    expect(resolveApiUrl("http://[::1]:8787", {}, {})).toBe("http://[::1]:8787");
  });

  test("rejects malformed and unsupported URLs", () => {
    expectCliError(() => resolveApiUrl("not-a-url", {}, {}), "api_url_invalid");
    expectCliError(() => resolveApiUrl("ftp://api.example", {}, {}), "api_url_invalid");
  });

  test("rejects non-loopback HTTP", () => {
    expectCliError(() => resolveApiUrl("http://api.example", {}, {}), "api_url_insecure");
  });
});

describe("requireApiKey", () => {
  test("returns the key when present", () => {
    expect(requireApiKey({ apiKey: "k" })).toBe("k");
  });

  test("throws not_logged_in when absent", () => {
    try {
      requireApiKey({});
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).code).toBe("not_logged_in");
      expect((error as CliError).exitCode).toBe(1);
    }
  });
});

describe("assertApiKeyOrigin", () => {
  test("allows an authenticated request to the saved origin", () => {
    expect(() =>
      assertApiKeyOrigin("https://api.example/v2", {
        apiUrl: "https://api.example/v1",
        apiKey: "k",
      }),
    ).not.toThrow();
  });

  test("rejects a different host, scheme, or port", () => {
    const config = { apiUrl: "https://api.example", apiKey: "k" };
    expectCliError(
      () => assertApiKeyOrigin("https://attacker.example", config),
      "api_origin_mismatch",
    );
    expectCliError(
      () => assertApiKeyOrigin("http://localhost", { apiUrl: "https://localhost", apiKey: "k" }),
      "api_origin_mismatch",
    );
    expectCliError(
      () =>
        assertApiKeyOrigin("http://127.0.0.1:8788", {
          apiUrl: "http://127.0.0.1:8787",
          apiKey: "k",
        }),
      "api_origin_mismatch",
    );
  });

  test("fails closed when a stored key has no saved API URL", () => {
    expectCliError(
      () => assertApiKeyOrigin("https://daylo.cc", { apiKey: "k" }),
      "api_key_origin_missing",
    );
  });
});

describe("toApiError", () => {
  test("adopts the backend error code and message", () => {
    const err = toApiError(401, {
      error: { code: "unauthorized", message: "bad key" },
      requestId: "r",
    });
    expect(err.code).toBe("unauthorized");
    expect(err.message).toBe("bad key");
  });

  test("falls back to a generic http_error for unshaped bodies", () => {
    const err = toApiError(500, "oops");
    expect(err.code).toBe("http_error");
    expect(err.message).toContain("500");
  });
});
