# Daylo v1 — Specification (the contract)

Daylo is one API for every smart scale: a hosted backend that connects vendor scale APIs (Withings, Tanita Health Planet) and exposes your weight data through a single normalized REST API, plus a JSON-first CLI. Developer-facing, no UI. This document is the single source of truth for v1 — backend, CLI, landing page, and docs are all written against it. If an implementation needs to deviate, update this file first.

Hosted service stack: Cloudflare Workers + Hono + Turso (libSQL) + Drizzle + Better Auth (Google social login + magic link + device authorization + API key plugins). The public contract is the normalized REST API and CLI behavior described here.

## Normalized measurement (core type)

```ts
type ProviderId = "withings" | "tanita";

type WeightMeasurement = {
  id: string; // "<provider>:<provider-native measurement id>"
  provider: ProviderId;
  measuredAt: string; // ISO 8601, UTC (Tanita returns JST — adapters normalize)
  weightKg: number;
  fatRatioPercent: number | null;
};
```

The database may store additional columns (raw payload JSON, sync metadata), but the API returns exactly this shape.

## REST API

Base path `/api/v1`. Authentication: API key via `Authorization: Bearer <key>` or `x-api-key` header. Every response includes `X-Request-Id`. Error shape (all non-2xx):

```json
{ "error": { "code": "unauthorized", "message": "..." }, "requestId": "..." }
```

- `GET /api/health` → `{ "ok": true }` (no auth)
- `GET /api/v1/weight/latest` → `{ "latest": WeightMeasurement | null }`
- `GET /api/v1/weight/list?days=30&provider=withings` → `{ "measurements": WeightMeasurement[] }` — sorted by `measuredAt` desc; `days` default 30, max 365; `provider` optional filter
- `POST /api/v1/sync` → pulls new measurements from every connected provider → `{ "synced": { "withings": 3, "tanita": 0 } }` (keys only for connected providers)
- `GET /api/v1/providers` → `{ "providers": [{ "provider": "withings", "connected": true, "connectedAt": "..." }, { "provider": "tanita", "connected": false, "connectedAt": null }] }`
- `POST /api/v1/providers/:provider/connect` → `{ "authorizeUrl": "...", "state": "..." }` — begins OAuth; state is bound to the user and single-use
- `GET /connect/:provider/callback?code&state` → OAuth callback (browser-facing, returns minimal HTML "connected, return to your terminal"; no API key auth — state is the credential)
- `GET /device?user_code=...` → browser-facing authentication + device-approval page (no API key auth; sign in with Google or magic link, then approve the CLI's device code)
- `DELETE /api/v1/providers/:provider` → disconnect, delete stored tokens → `{ "ok": true }`
- `DELETE /api/v1/me/data` → delete all measurements and provider tokens for the authenticated user → `{ "ok": true }`

Authentication is passwordless, mounted at `/api/auth/*`. Users sign in with **Google social login** or a **magic link** (emailed via Resend; in dev the link is logged instead). The CLI authenticates with the **OAuth 2.0 Device Authorization Grant**: `POST /api/auth/device/code` returns a `user_code` and `device_code` → the user opens `GET /device?user_code=...` in a browser, signs in, and approves → the CLI polls `POST /api/auth/device/token` until it receives a session token → the CLI presents that token as `Authorization: Bearer <token>` to `POST /api/auth/api-key/create` to mint an API key named `cli`.

## WeightProvider interface (backend)

```ts
interface WeightProvider {
  readonly id: ProviderId;
  buildAuthorizeUrl(input: { redirectUri: string; state: string }): string;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<ProviderTokens>;
  refresh(tokens: ProviderTokens): Promise<ProviderTokens>;
  fetchMeasurements(input: {
    tokens: ProviderTokens;
    from?: Date;
    to?: Date;
  }): Promise<WeightMeasurement[]>;
}
```

One contract test suite runs identically against both adapters with mocked HTTP (this is the backbone of the test strategy). Provider quirks live inside adapters; nothing vendor-specific leaks past this interface.

- **Withings**: OAuth connect, token refresh with locking, encrypted token storage, sync, and normalization are implemented and verified end to end on production `daylo.cc`.
- **Tanita Health Planet**: OAuth2 at `https://www.healthplanet.jp/oauth/auth` and `/oauth/token`, scope `innerscan`. Measurements: `GET /status/innerscan.json?tag=6021,6022` (6021 = weight kg, 6022 = body fat %). Dates are JST `yyyyMMddHHmmss` — convert to UTC. Production credentials are active; connect, sync, and data retrieval are verified end to end on production `daylo.cc`.

## Multi-tenant lite (storage model)

- `body_measurements`: add `user_id` + `provider` + provider-native id; unique on (user_id, provider, provider_measurement_id); index (user_id, timestamp)
- `oauth_tokens` / `oauth_token_locks`: reuse existing (provider, profile) key with profile = userId
- `oauth_states`: state → (userId, provider, expiresAt) for the connect flow
- Webhooks are out of scope for v1 (polling via `POST /api/v1/sync` is the required path)
- No consent screens, no org features. Data deletion is the API endpoint only.

## CLI (`daylo`)

JSON-first: stdout is machine-parseable JSON by default — AI agents are the primary consumer. `--pretty` renders for humans. Errors go to stderr as JSON `{ "error": { "code", "message" } }`. Exit codes: 0 success, 1 error, 2 usage. Config at `~/.config/daylo/config.json` (mode 600) storing `{ apiUrl, apiKey }`. `DAYLO_API_URL` env and `--api-url` flag override (needed for compatible API implementations, staging, and tests).

- `daylo login` — no prompts; runs the device authorization flow (opens `GET /device?user_code=...` in the browser for the user to approve), polls for approval, mints an API key `cli`, and saves config
- `daylo connect withings|tanita` — `POST .../connect`, open `authorizeUrl` in browser, poll `GET /api/v1/providers` until connected (timeout 5 min)
- `daylo disconnect withings|tanita`
- `daylo sync`
- `daylo latest [--pretty]` → the `latest` object (or `null`)
- `daylo list [--days 30] [--provider withings|tanita] [--pretty]` → the `measurements` array

Install path for v1 is `bunx @pivop/daylo`. `bunx github:pivop-inc/daylo` remains a source fallback during npm release windows. The CLI runs directly on Bun.

## Verification (applies to every workspace)

`bun test` green, `bunx tsc --noEmit` clean, `bunx oxlint` clean. Backend: contract tests pass for both adapters. CLI: E2E script against a mock server, re-runnable against a compatible API.
