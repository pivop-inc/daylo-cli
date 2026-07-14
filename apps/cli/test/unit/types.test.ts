import { describe, expect, test } from "bun:test";
import { isProviderId, PROVIDER_IDS } from "../../src/types.ts";

describe("isProviderId", () => {
  test("accepts known providers", () => {
    for (const id of PROVIDER_IDS) expect(isProviderId(id)).toBe(true);
  });

  test("rejects anything else", () => {
    expect(isProviderId("fitbit")).toBe(false);
    expect(isProviderId("")).toBe(false);
  });
});
