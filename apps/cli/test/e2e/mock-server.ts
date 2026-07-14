/**
 * Spec-faithful mock of the Daylo backend (docs/spec.md) built on Bun.serve.
 *
 * Protocol behavior (routes, auth, response shapes, error shape, X-Request-Id)
 * mirrors the spec. Mock-specific conveniences are isolated to:
 *   - fixture measurements (see `defaultFixtures`), shared by every user
 *   - `connectAutoCompleteMs`: after POST .../connect the provider flips to
 *     connected automatically, simulating the user finishing OAuth in a
 *     browser (a real backend needs a human; E2E gates those tests off).
 *   - `deviceAutoApproveMs`: after POST /api/auth/device/code the device is
 *     approved automatically, simulating the user signing in and approving in
 *     the browser (same rationale as connectAutoCompleteMs).
 */
import { randomUUID } from "node:crypto";
import type { ProviderId, ProviderStatus, WeightMeasurement } from "../../src/types.ts";
import { isProviderId, PROVIDER_IDS } from "../../src/types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

export function defaultFixtures(): WeightMeasurement[] {
  return [
    {
      id: "withings:1001",
      provider: "withings",
      measuredAt: daysAgoIso(1),
      weightKg: 72.4,
      fatRatioPercent: 21.3,
    },
    {
      id: "tanita:20260709",
      provider: "tanita",
      measuredAt: daysAgoIso(2),
      weightKg: 72.8,
      fatRatioPercent: null,
    },
    {
      id: "withings:1000",
      provider: "withings",
      measuredAt: daysAgoIso(45),
      weightKg: 74.1,
      fatRatioPercent: 22.0,
    },
  ];
}

type User = {
  id: string;
  email: string;
  name: string;
  providers: Map<ProviderId, { connected: boolean; connectedAt: string | null }>;
};

type DeviceState = {
  user: User | null;
  approved: boolean;
};

export type MockServerOptions = {
  measurements?: WeightMeasurement[];
  connectAutoCompleteMs?: number;
  deviceAutoApproveMs?: number;
};

export type MockServer = {
  url: string;
  stop(): void;
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": randomUUID(),
      ...headers,
    },
  });
}

function apiError(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message }, requestId: randomUUID() });
}

function newProviderState(): User["providers"] {
  return new Map(PROVIDER_IDS.map((p) => [p, { connected: false, connectedAt: null }]));
}

export function createMockServer(options: MockServerOptions = {}): MockServer {
  const measurements = options.measurements ?? defaultFixtures();
  const connectAutoCompleteMs = options.connectAutoCompleteMs ?? 200;
  const deviceAutoApproveMs = options.deviceAutoApproveMs ?? 200;

  const sessions = new Map<string, User>(); // session token -> user
  const apiKeys = new Map<string, User>(); // api key -> user
  const oauthStates = new Map<string, { user: User; provider: ProviderId }>();
  const devices = new Map<string, DeviceState>(); // device_code -> state
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function createSession(user: User): { token: string; headers: Record<string, string> } {
    const token = `sess_${randomUUID()}`;
    sessions.set(token, user);
    return {
      token,
      headers: {
        "set-cookie": `better-auth.session_token=${token}; Path=/; HttpOnly; SameSite=Lax`,
      },
    };
  }

  function sessionUser(request: Request): User | null {
    const cookie = request.headers.get("cookie");
    if (cookie !== null) {
      const match = /better-auth\.session_token=([^;\s]+)/.exec(cookie);
      if (match !== null) {
        const user = sessions.get(match[1]!);
        if (user !== undefined) return user;
      }
    }
    const auth = request.headers.get("authorization");
    if (auth?.startsWith("Bearer ") === true) {
      const user = sessions.get(auth.slice("Bearer ".length));
      if (user !== undefined) return user;
    }
    return null;
  }

  function apiKeyUser(request: Request): User | null {
    const auth = request.headers.get("authorization");
    const key =
      auth?.startsWith("Bearer ") === true
        ? auth.slice("Bearer ".length)
        : request.headers.get("x-api-key");
    if (key === null || key === undefined) return null;
    return apiKeys.get(key) ?? null;
  }

  function markConnected(user: User, provider: ProviderId): void {
    user.providers.set(provider, { connected: true, connectedAt: new Date().toISOString() });
  }

  function providerList(user: User): ProviderStatus[] {
    return PROVIDER_IDS.map((provider) => {
      const state = user.providers.get(provider)!;
      return { provider, connected: state.connected, connectedAt: state.connectedAt };
    });
  }

  async function readJson(request: Request): Promise<Record<string, unknown>> {
    try {
      const body: unknown = await request.json();
      if (typeof body === "object" && body !== null) return body as Record<string, unknown>;
    } catch {
      // fall through
    }
    return {};
  }

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const { pathname } = url;
      const method = request.method;

      // ---- health ----
      if (method === "GET" && pathname === "/api/health") return json(200, { ok: true });

      // ---- Better Auth ----
      // Mirror Better Auth's CSRF protection: only *cookie-auth* POSTs to
      // /api/auth/* require an Origin header. Bearer/unauthenticated POSTs (the
      // device flow) do not (verified against the real backend).
      if (
        method === "POST" &&
        pathname.startsWith("/api/auth/") &&
        request.headers.get("cookie") !== null &&
        request.headers.get("origin") === null
      ) {
        return json(403, { message: "Missing or null Origin", code: "MISSING_OR_NULL_ORIGIN" });
      }

      // Device authorization: the CLI requests a code, then polls for a token
      // while the "browser" (simulated by a timer) signs in and approves.
      if (method === "POST" && pathname === "/api/auth/device/code") {
        const body = await readJson(request);
        if (body["client_id"] !== "daylo-cli") {
          return json(400, { error: "invalid_client" });
        }
        const deviceCode = `device_${randomUUID()}`;
        const userCode = randomUUID().slice(0, 8).toUpperCase();
        const state: DeviceState = { user: null, approved: false };
        devices.set(deviceCode, state);
        if (deviceAutoApproveMs > 0) {
          const timer = setTimeout(() => {
            // Simulate the user signing in (creating a user) and approving.
            state.user = {
              id: randomUUID(),
              email: `device-${randomUUID()}@example.com`,
              name: "device-user",
              providers: newProviderState(),
            };
            state.approved = true;
            timers.delete(timer);
          }, deviceAutoApproveMs);
          timers.add(timer);
        }
        return json(200, {
          device_code: deviceCode,
          user_code: userCode,
          verification_uri: `${url.origin}/device`,
          verification_uri_complete: `${url.origin}/device?user_code=${userCode}`,
          expires_in: 1800,
          interval: 1,
        });
      }

      if (method === "POST" && pathname === "/api/auth/device/token") {
        const body = await readJson(request);
        const state =
          typeof body["device_code"] === "string" ? devices.get(body["device_code"]) : undefined;
        if (state === undefined) {
          return json(400, { error: "expired_token" });
        }
        if (!state.approved || state.user === null) {
          return json(400, { error: "authorization_pending" });
        }
        const session = createSession(state.user);
        return json(200, {
          access_token: session.token,
          token_type: "Bearer",
          expires_in: 604800,
          scope: "",
        });
      }

      if (method === "POST" && pathname === "/api/auth/api-key/create") {
        const user = sessionUser(request);
        if (user === null) return json(401, { message: "Unauthorized" });
        const body = await readJson(request);
        const name = typeof body["name"] === "string" ? body["name"] : "key";
        const key = `daylo_${randomUUID().replaceAll("-", "")}`;
        apiKeys.set(key, user);
        return json(200, { id: randomUUID(), name, key });
      }

      // ---- OAuth callback (browser-facing; state is the credential) ----
      const callbackMatch = /^\/connect\/([^/]+)\/callback$/.exec(pathname);
      if (method === "GET" && callbackMatch !== null) {
        const state = url.searchParams.get("state") ?? "";
        const entry = oauthStates.get(state);
        if (entry === undefined || entry.provider !== callbackMatch[1]) {
          return new Response("<html><body>Invalid state</body></html>", {
            status: 400,
            headers: { "content-type": "text/html", "x-request-id": randomUUID() },
          });
        }
        oauthStates.delete(state); // single-use
        markConnected(entry.user, entry.provider);
        return new Response("<html><body>Connected. Return to your terminal.</body></html>", {
          status: 200,
          headers: { "content-type": "text/html", "x-request-id": randomUUID() },
        });
      }

      // ---- /api/v1 (API key auth) ----
      if (pathname.startsWith("/api/v1/")) {
        const user = apiKeyUser(request);
        if (user === null) return apiError(401, "unauthorized", "Missing or invalid API key");

        if (method === "GET" && pathname === "/api/v1/weight/latest") {
          const sorted = [...measurements].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
          return json(200, { latest: sorted[0] ?? null });
        }

        if (method === "GET" && pathname === "/api/v1/weight/list") {
          const daysRaw = url.searchParams.get("days");
          let days = 30;
          if (daysRaw !== null) {
            days = Number.parseInt(daysRaw, 10);
            if (!Number.isInteger(days) || days < 1 || days > 365) {
              return apiError(400, "validation_error", "days must be an integer between 1 and 365");
            }
          }
          const provider = url.searchParams.get("provider");
          if (provider !== null && !isProviderId(provider)) {
            return apiError(400, "validation_error", "provider must be withings or tanita");
          }
          const since = Date.now() - days * DAY_MS;
          const filtered = measurements
            .filter((m) => new Date(m.measuredAt).getTime() >= since)
            .filter((m) => provider === null || m.provider === provider)
            .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
          return json(200, { measurements: filtered });
        }

        if (method === "POST" && pathname === "/api/v1/sync") {
          const synced: Partial<Record<ProviderId, number>> = {};
          for (const provider of PROVIDER_IDS) {
            if (user.providers.get(provider)!.connected) {
              synced[provider] = measurements.filter((m) => m.provider === provider).length;
            }
          }
          return json(200, { synced });
        }

        if (method === "GET" && pathname === "/api/v1/providers") {
          return json(200, { providers: providerList(user) });
        }

        const connectMatch = /^\/api\/v1\/providers\/([^/]+)\/connect$/.exec(pathname);
        if (method === "POST" && connectMatch !== null) {
          const provider = connectMatch[1]!;
          if (!isProviderId(provider)) {
            return apiError(400, "validation_error", "unknown provider");
          }
          const state = randomUUID();
          oauthStates.set(state, { user, provider });
          if (connectAutoCompleteMs > 0) {
            const timer = setTimeout(() => {
              // Simulate the user completing OAuth in the browser.
              if (oauthStates.delete(state)) markConnected(user, provider);
              timers.delete(timer);
            }, connectAutoCompleteMs);
            timers.add(timer);
          }
          const authorizeUrl = `${url.origin}/connect/${provider}/callback?code=mock-code&state=${state}`;
          return json(200, { authorizeUrl, state });
        }

        const providerMatch = /^\/api\/v1\/providers\/([^/]+)$/.exec(pathname);
        if (method === "DELETE" && providerMatch !== null) {
          const provider = providerMatch[1]!;
          if (!isProviderId(provider)) {
            return apiError(400, "validation_error", "unknown provider");
          }
          user.providers.set(provider, { connected: false, connectedAt: null });
          return json(200, { ok: true });
        }

        if (method === "DELETE" && pathname === "/api/v1/me/data") {
          user.providers = newProviderState();
          return json(200, { ok: true });
        }

        return apiError(404, "not_found", `No route for ${method} ${pathname}`);
      }

      return apiError(404, "not_found", `No route for ${method} ${pathname}`);
    },
  });

  return {
    url: server.url.origin,
    stop() {
      for (const timer of timers) clearTimeout(timer);
      server.stop(true);
    },
  };
}
