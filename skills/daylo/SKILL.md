---
name: daylo
description: Fetch and analyze weight and body-composition data from smart scales via the daylo CLI. Use when the user wants to read, sync, trend, or report their weight or body-fat data, connect or set up a smart scale (Withings, Tanita Health Planet), or configure daylo. Triggers include "What's my weight?", "show my weight trend", "sync my scale", "connect my smart scale", "set up daylo", and Japanese requests like「体重を教えて」「体重の推移」「体重計をつないで」.
---

# Daylo

Daylo exposes weight measurements from smart scales (Withings, Tanita Health Planet) as normalized JSON through a CLI. Use it to sync and read the user's weight data on their behalf.

## Running the CLI

Run every command as `bunx github:katsu105/daylo <command>` (requires [Bun](https://bun.sh)). If the user has aliased `daylo` (e.g. `alias daylo="bunx github:katsu105/daylo"`) and it resolves, use `daylo <command>` directly instead.

stdout is machine-readable JSON by default — do not pass `--pretty`.

## Check setup state first

Before fetching data, check whether `~/.config/daylo/config.json` exists (the directory can be overridden by the `DAYLO_CONFIG_DIR` env var). If it exists, the user is logged in. If not, guide them through setup (login, then connect a provider) before doing anything else.

## Interactive commands — do NOT run them yourself

These commands prompt the user or open a browser, so let the user run them in their own terminal. Never execute them yourself:

- `daylo login` — opens the browser to sign in (Google or magic link) and waits for you to approve; then creates an API key and writes config.
- `daylo connect withings|tanita` — opens the browser for OAuth and polls up to 5 minutes until the connection completes.

In Claude Code, tell the user they can run these directly with the `!` prefix, e.g. `! daylo login` or `! daylo connect withings`.

## Fetching data

1. `daylo sync` — pull new measurements from every connected provider. Returns `{ "synced": { "withings": 3, "tanita": 0 } }`. When the user needs current data, sync first, then read.
2. `daylo latest` — the single newest measurement, or `null`.
3. `daylo list [--days N] [--provider withings|tanita]` — measurements in `measuredAt` descending order. `--days` defaults to 30, max 365. Use `--provider` to filter to one scale.

## Output shape

Every measurement is normalized to this shape:

```ts
type WeightMeasurement = {
  id: string; // "<provider>:<provider-native id>"
  provider: "withings" | "tanita";
  measuredAt: string; // ISO 8601, UTC
  weightKg: number;
  fatRatioPercent: number | null;
};
```

`fatRatioPercent` can be `null` — handle the missing case when reporting body fat.

## Error handling

Errors print to stderr as `{ "error": { "code", "message" } }`. Exit codes: 0 success, 1 error, 2 usage.

- An `unauthorized`-type error means the session expired — ask the user to run `daylo login` again.
- If `sync` returns all zeros and no provider is connected, ask the user to run `daylo connect withings` or `daylo connect tanita`.

## Self-hosted backends

To point the CLI at a self-hosted backend, set the `DAYLO_API_URL` env var or pass `--api-url <url>` on any command.
