# daylo-cli (CLI)

One API for every smart scale — `daylo` is the JSON-first command line client.
stdout is machine-parseable JSON by default (AI agents are the primary consumer);
`--pretty` renders for humans. Errors go to **stderr** as JSON
`{ "error": { "code", "message" } }`. Exit codes: `0` success, `1` error, `2` usage.

Zero runtime dependencies — it runs directly on Bun's built-ins.

## Install

The official npm package runs with Bun:

```sh
alias daylo="bunx daylo-cli"
daylo latest
```

## Run it from the repo

From a checkout, run the binary directly with Bun:

```sh
bun apps/cli/bin/daylo.ts <command> [options]
# or, inside apps/cli:
bun bin/daylo.ts latest
```

Commands (see `docs/spec.md` for the contract):

- **login** — open your browser to sign in (Google or magic link) via the OAuth
  device flow, then mint an API key named `cli` and save config. Polls until you
  approve in the browser; tune with `DAYLO_LOGIN_POLL_INTERVAL_MS` /
  `DAYLO_LOGIN_TIMEOUT_MS`.
- **connect `<withings|tanita>`** — begin OAuth, open the authorize URL in your
  browser, and poll until the provider reports connected (5 min timeout).
- **disconnect `<withings|tanita>`** — remove a provider.
- **sync** — pull new measurements from every connected provider.
- **latest `[--pretty]`** — the newest measurement as JSON (or `null`).
- **list `[--days 30] [--provider withings|tanita] [--pretty]`** — measurements,
  newest first.

Global options: `--api-url <url>` (also `DAYLO_API_URL`), `--pretty`, `--help`.

### Configuration

Config lives at `~/.config/daylo/config.json` (mode `600`) holding
`{ apiUrl, apiKey }`. Override the location with `DAYLO_CONFIG_DIR` (used by the
tests so they never touch your real config). The API base URL resolves in order:
`--api-url` flag → `DAYLO_API_URL` env → saved config.

Other env knobs: `DAYLO_NO_BROWSER=1` suppresses browser launch (headless / CI);
`DAYLO_LOGIN_POLL_INTERVAL_MS` and `DAYLO_LOGIN_TIMEOUT_MS` tune the login device-flow
poll; `DAYLO_CONNECT_POLL_INTERVAL_MS` and `DAYLO_CONNECT_TIMEOUT_MS` tune the connect poll.

## Point it at a compatible API

The default endpoint is `https://daylo.cc`. For a protocol-compatible API,
staging endpoint, or test fixture, either pass `--api-url` or export the env:

```sh
export DAYLO_API_URL=https://example.com
bun bin/daylo.ts login
bun bin/daylo.ts latest
```

## Tests

```sh
bun test                       # unit + E2E (E2E spins up a spec-faithful mock backend)
bunx tsc --noEmit              # types
bunx oxlint                    # lint
```

### Run the E2E suite against a compatible API

The E2E suite (`test/e2e/cli.test.ts`) drives the real compiled binary over HTTP.
By default it starts the in-process mock (`test/e2e/mock-server.ts`). To re-run the
**protocol** assertions (shapes, exit codes, error envelope) against a compatible
API, inject its URL — the fixture-value assertions auto-skip. `daylo login` uses
the browser device flow (needs a human), so supply a pre-minted API key and the
suite writes config directly instead of running `login`:

```sh
DAYLO_E2E_API_URL=https://daylo.cc \
DAYLO_E2E_API_KEY=daylo_... \
bun test test/e2e/cli.test.ts
```
