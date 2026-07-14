import { describe, expect, test } from "bun:test";
import { requireApiKey, resolveApiUrl, toApiError } from "../../src/api.ts";
import { CliError } from "../../src/errors.ts";

describe("resolveApiUrl", () => {
  test("prefers the flag over env and config", () => {
    const url = resolveApiUrl(
      "http://flag",
      { apiUrl: "http://config" },
      { DAYLO_API_URL: "http://env" },
    );
    expect(url).toBe("http://flag");
  });

  test("prefers env over config", () => {
    const url = resolveApiUrl(
      undefined,
      { apiUrl: "http://config" },
      { DAYLO_API_URL: "http://env" },
    );
    expect(url).toBe("http://env");
  });

  test("falls back to config", () => {
    expect(resolveApiUrl(undefined, { apiUrl: "http://config" }, {})).toBe("http://config");
  });

  test("strips trailing slashes", () => {
    expect(resolveApiUrl("http://x/", {}, {})).toBe("http://x");
    expect(resolveApiUrl("http://x///", {}, {})).toBe("http://x");
  });

  test("falls back to the default hosted API when nothing is configured", () => {
    expect(resolveApiUrl(undefined, {}, {})).toBe("https://daylo.cc");
  });

  test("throws when the resolved URL is empty", () => {
    expect(() => resolveApiUrl("", {}, {})).toThrow(CliError);
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
