import { describe, expect, test } from "bun:test";
import { boolFlag, parseArgs, stringFlag } from "../../src/args.ts";
import { UsageError } from "../../src/errors.ts";

const SPEC = {
  "api-url": { takesValue: true },
  days: { takesValue: true },
  pretty: { takesValue: false },
};

describe("parseArgs", () => {
  test("collects positionals", () => {
    const parsed = parseArgs(["withings", "extra"], {});
    expect(parsed.positionals).toEqual(["withings", "extra"]);
  });

  test("--flag value form", () => {
    const parsed = parseArgs(["--api-url", "http://x"], SPEC);
    expect(stringFlag(parsed, "api-url")).toBe("http://x");
  });

  test("--flag=value form", () => {
    const parsed = parseArgs(["--api-url=http://x", "--days=7"], SPEC);
    expect(stringFlag(parsed, "api-url")).toBe("http://x");
    expect(stringFlag(parsed, "days")).toBe("7");
  });

  test("boolean flag", () => {
    const parsed = parseArgs(["--pretty"], SPEC);
    expect(boolFlag(parsed, "pretty")).toBe(true);
    expect(boolFlag(parseArgs([], SPEC), "pretty")).toBe(false);
  });

  test("mixes positionals and flags in any order", () => {
    const parsed = parseArgs(["latest", "--pretty", "--api-url", "http://x"], SPEC);
    expect(parsed.positionals).toEqual(["latest"]);
    expect(boolFlag(parsed, "pretty")).toBe(true);
    expect(stringFlag(parsed, "api-url")).toBe("http://x");
  });

  test("-- stops flag parsing", () => {
    const parsed = parseArgs(["--", "--pretty"], SPEC);
    expect(parsed.positionals).toEqual(["--pretty"]);
    expect(boolFlag(parsed, "pretty")).toBe(false);
  });

  test("unknown flag is a usage error", () => {
    expect(() => parseArgs(["--nope"], SPEC)).toThrow(UsageError);
  });

  test("value flag without value is a usage error", () => {
    expect(() => parseArgs(["--api-url"], SPEC)).toThrow(UsageError);
  });

  test("value given to boolean flag is a usage error", () => {
    expect(() => parseArgs(["--pretty=1"], SPEC)).toThrow(UsageError);
  });

  test("bare short flag is a usage error", () => {
    expect(() => parseArgs(["-x"], SPEC)).toThrow(UsageError);
  });

  test("stringFlag returns undefined when absent", () => {
    expect(stringFlag(parseArgs([], SPEC), "api-url")).toBeUndefined();
  });
});
