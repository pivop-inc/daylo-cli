import type { WeightMeasurement } from "./types.ts";

/** Machine-readable output: compact JSON, one value per line, on stdout. */
export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export function printText(text: string): void {
  process.stdout.write(`${text}\n`);
}

/** Informational messages for humans never pollute stdout. */
export function note(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function formatMeasurement(m: WeightMeasurement): string {
  const fat = m.fatRatioPercent === null ? "fat -" : `fat ${m.fatRatioPercent}%`;
  return `${m.measuredAt}  ${m.weightKg} kg  ${fat}  [${m.provider}]`;
}

export function formatLatestPretty(latest: WeightMeasurement | null): string {
  if (latest === null) return "No measurements yet.";
  return formatMeasurement(latest);
}

export function formatListPretty(measurements: WeightMeasurement[]): string {
  if (measurements.length === 0) return "No measurements.";
  return measurements.map(formatMeasurement).join("\n");
}
