export const PROVIDER_IDS = ["withings", "tanita"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type WeightMeasurement = {
  id: string;
  provider: ProviderId;
  measuredAt: string;
  weightKg: number;
  fatRatioPercent: number | null;
};

export type ProviderStatus = {
  provider: ProviderId;
  connected: boolean;
  connectedAt: string | null;
};

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}
