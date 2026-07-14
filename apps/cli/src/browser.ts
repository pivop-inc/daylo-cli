import type { Env } from "./config.ts";

/**
 * Best-effort open of a URL in the default browser.
 * Disabled with DAYLO_NO_BROWSER=1 (tests, headless machines) — the caller
 * always prints the URL to stderr, so this failing is never fatal.
 */
export function openBrowser(url: string, env: Env = process.env): boolean {
  const disabled = env["DAYLO_NO_BROWSER"];
  if (disabled === "1" || disabled === "true") return false;
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    Bun.spawn({ cmd, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    return true;
  } catch {
    return false;
  }
}
