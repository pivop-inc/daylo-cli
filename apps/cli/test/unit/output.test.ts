import { describe, expect, test } from "bun:test";
import { formatLatestPretty, formatListPretty, formatMeasurement } from "../../src/output.ts";
import type { WeightMeasurement } from "../../src/types.ts";

const withFat: WeightMeasurement = {
  id: "withings:1",
  provider: "withings",
  measuredAt: "2026-07-10T08:00:00.000Z",
  weightKg: 72.4,
  fatRatioPercent: 21.3,
};
const noFat: WeightMeasurement = {
  ...withFat,
  id: "tanita:2",
  provider: "tanita",
  fatRatioPercent: null,
};

describe("formatMeasurement", () => {
  test("renders weight, fat and provider", () => {
    expect(formatMeasurement(withFat)).toBe(
      "2026-07-10T08:00:00.000Z  72.4 kg  fat 21.3%  [withings]",
    );
  });

  test("renders a dash when fat ratio is null", () => {
    expect(formatMeasurement(noFat)).toContain("fat -");
  });
});

describe("formatLatestPretty", () => {
  test("renders the measurement", () => {
    expect(formatLatestPretty(withFat)).toBe(formatMeasurement(withFat));
  });

  test("renders a friendly line when null", () => {
    expect(formatLatestPretty(null)).toBe("No measurements yet.");
  });
});

describe("formatListPretty", () => {
  test("joins measurements one per line", () => {
    expect(formatListPretty([withFat, noFat]).split("\n")).toHaveLength(2);
  });

  test("renders a friendly line when empty", () => {
    expect(formatListPretty([])).toBe("No measurements.");
  });
});
