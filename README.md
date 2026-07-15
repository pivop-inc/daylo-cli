# Daylo

[![CI](https://github.com/pivop-inc/daylo-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/pivop-inc/daylo-cli/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/daylo-cli.svg)](https://www.npmjs.com/package/daylo-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Website](https://daylo.cc) · [npm](https://www.npmjs.com/package/daylo-cli) · [API spec](docs/spec.md)

**One API for every smart scale.**

Daylo connects vendor scale APIs (Withings, Tanita Health Planet) and exposes your weight data through a single normalized REST API and a JSON-first CLI. No UI, no dashboard — just your weight as clean JSON, for developers and AI agents.

Every vendor has its own OAuth flow, date format, and payload shape. Daylo hides all of it behind one interface — the same idea as the multi-provider SDKs that let you call every LLM the same way, applied to smart scales.

## Quickstart

Runs straight from npm with [Bun](https://bun.sh):

```sh
alias daylo="bunx daylo-cli"

daylo login              # opens your browser to sign in, creates an API key
daylo connect withings   # opens your browser for OAuth, waits until connected
daylo sync               # pull your measurements from the provider
daylo latest             # your most recent weight, as JSON
```

```json
{
  "latest": {
    "id": "withings:123456789",
    "provider": "withings",
    "measuredAt": "2026-07-11T07:42:13.000Z",
    "weightKg": 72.4,
    "fatRatioPercent": 21.3
  }
}
```

That's the whole loop: step on the scale, run `daylo sync`, and the data is yours.

### CLI

stdout is machine-parseable JSON by default — AI agents are the primary consumer. Add `--pretty` for humans. Errors go to stderr as JSON `{ "error": { "code", "message" } }`. Exit codes: 0 success, 1 error, 2 usage.

- `daylo login` — browser sign-in (Google or magic link) via the device flow, creates an API key named `cli`
- `daylo connect withings|tanita` — OAuth in the browser, polls until connected
- `daylo disconnect withings|tanita`
- `daylo sync` — pull new measurements from every connected provider
- `daylo latest [--pretty]`
- `daylo list [--days 30] [--provider withings|tanita] [--pretty]`

Config lives at `~/.config/daylo/config.json` (mode 600). `DAYLO_API_URL` or `--api-url` overrides the API endpoint (useful when pointing at a compatible API implementation).

## Use with AI agents

This repo ships a skill ([`skills/daylo/SKILL.md`](skills/daylo/SKILL.md)) that teaches your coding agent how to drive the daylo CLI — checking setup, syncing, and reading your weight as JSON. Install it once:

```sh
# Claude Code
mkdir -p ~/.claude/skills/daylo
curl -fsSL -o ~/.claude/skills/daylo/SKILL.md \
  https://raw.githubusercontent.com/pivop-inc/daylo-cli/main/skills/daylo/SKILL.md

# Codex
mkdir -p ~/.codex/skills/daylo
curl -fsSL -o ~/.codex/skills/daylo/SKILL.md \
  https://raw.githubusercontent.com/pivop-inc/daylo-cli/main/skills/daylo/SKILL.md
```

Then just ask, e.g. "What was my weight trend this month?" or "Sync my scale and show the latest reading."

## REST API

Base path `/api/v1`. Authenticate with your API key via `Authorization: Bearer <key>` or the `x-api-key` header.

[`docs/spec.md`](docs/spec.md) is the canonical API contract for v1. Third-party clients and CLI mocks should treat it as the source of truth.

```sh
curl -H "Authorization: Bearer $DAYLO_API_KEY" \
  "$DAYLO_API_URL/api/v1/weight/latest"
```

Every measurement comes back in one normalized shape, whatever the vendor:

```ts
type WeightMeasurement = {
  id: string; // "<provider>:<provider-native measurement id>"
  provider: "withings" | "tanita";
  measuredAt: string; // ISO 8601, UTC (Tanita returns JST — adapters normalize)
  weightKg: number;
  fatRatioPercent: number | null;
};
```

| Method + path                                       | Returns                                                                                                                                      |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                                   | `{ "ok": true }` (no auth)                                                                                                                   |
| `GET /api/v1/weight/latest`                         | `{ "latest": WeightMeasurement \| null }`                                                                                                    |
| `GET /api/v1/weight/list?days=30&provider=withings` | `{ "measurements": WeightMeasurement[] }` — `measuredAt` desc; `days` default 30, max 365                                                    |
| `POST /api/v1/sync`                                 | `{ "synced": { "withings": 3, "tanita": 0 } }`                                                                                               |
| `GET /api/v1/providers`                             | connection status per provider                                                                                                               |
| `POST /api/v1/providers/:provider/connect`          | `{ "authorizeUrl": "...", "state": "..." }` — begins OAuth                                                                                   |
| `DELETE /api/v1/providers/:provider`                | disconnect, delete stored tokens                                                                                                             |
| `DELETE /api/v1/me/data`                            | delete stored measurements and all stored provider tokens; account, auth data, and minimal legal acceptance records remain outside its scope |

Every response includes an `X-Request-Id` header. Non-2xx responses share one error shape:

```json
{ "error": { "code": "unauthorized", "message": "..." }, "requestId": "..." }
```

Signup/signin and API key issuance use [Better Auth](https://www.better-auth.com)'s standard endpoints mounted at `/api/auth/*`.

## Data deletion and privacy

`DELETE /api/v1/me/data` is the public measurement and connection data deletion endpoint. It deletes the authenticated user's stored measurements and all stored provider tokens. It does **not** delete the account, sessions, API keys, limited inquiry, security, and backup records, or minimal legal acceptance records that may be retained for a period reasonably necessary to verify contract formation and handle disputes. `daylo disconnect <provider>` deletes the stored tokens for only that provider.

For account deletion, access, correction, suspension of use, or similar privacy requests, contact [hello@pivop.jp](mailto:hello@pivop.jp). Daylo verifies the request through the registered email address or another reasonable method and responds within a reasonable period.

Data is retained only for periods appropriate to providing the service, security and incident response, legal requirements, external-service settings, and normal backup cycles. Information is deleted or made non-identifying when no longer needed. Backup records may remain until the normal rotation cycle completes; immediate individual deletion from backups is not promised.

Daylo does not currently use measurement data to train AI models or sell it for advertising. If individually linked measurement data is used in the future for a new purpose such as AI training, sale, or third-party analytics, Daylo will consider a separate opt-in first. Without separate consent, that use will be limited to aggregated or anonymized information from which an individual cannot reasonably be reconstructed. See the [Privacy Policy](https://daylo.cc/privacy-en.html) for details; the [Japanese version](https://daylo.cc/privacy.html) controls.

## Providers

| Provider             | Status                                      |
| -------------------- | ------------------------------------------- |
| Withings             | Supported — production verified on daylo.cc |
| Tanita Health Planet | Supported — production verified on daylo.cc |

Both launch providers have been connected, synced, and verified to return measurements on the hosted production service.

Adding a provider means implementing one `WeightProvider` interface and passing the shared contract-test suite. Vendor quirks never leak past the adapter.

## Open Core

Daylo follows a Tailscale-style open-core model. The CLI and SDK-facing client artifacts in this repo are MIT licensed; the server is provided as the hosted Daylo service at `daylo.cc`.

The backend implementation and deployment workflow are intentionally not part of this public repo. The public integration surface is the contract in [`docs/spec.md`](docs/spec.md).

## Roadmap

v1.1 will add an optional "weight gate": block your AI agent until you've stepped on the scale.

## License

[MIT](LICENSE)
