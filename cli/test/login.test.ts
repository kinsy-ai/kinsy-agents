import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { runLogin } from "../src/commands/login.js";
import { runLogout } from "../src/commands/logout.js";
import { credentialsPath, loadCredentials } from "../src/credentials.js";
import { EXIT } from "../src/exit.js";
import { envelope, startFakeApi, type FakeApi, type Handler } from "./fake_server.js";
import { KEY, ME, makeCtx } from "./helpers.js";

let api: FakeApi | null = null;
afterEach(async () => {
  await api?.close();
  api = null;
});

const START = {
  device_code: "device-secret-123",
  user_code: "WXYZ-2345",
  verification_uri: "https://kinsy.ai/cli-auth",
  verification_uri_complete: "https://kinsy.ai/cli-auth?code=WXYZ-2345",
  expires_in: 600,
  interval: 5,
};

const tokenSequence = (...statuses: string[]): Handler => (call, nth) => {
  const status = statuses[Math.min(nth, statuses.length) - 1];
  if (call.json && (call.json as { device_code?: string }).device_code !== START.device_code) {
    return { status: 404, json: envelope(404, "not_found", "unknown device code") };
  }
  if (status === "approved") {
    return { json: { status, interval: 5, api_key: KEY, key_hint: "…wxyz", email: "dev@example.com" } };
  }
  if (status === "slow_down") return { json: { status, interval: 10, api_key: null } };
  return { json: { status, interval: 5, api_key: null } };
};

describe("kinsy login", () => {
  it("device flow: shows the code, opens the browser, polls, saves the key once approved and never prints it", async () => {
    api = await startFakeApi({
      "POST /v1/auth/device": () => ({ json: START }),
      "POST /v1/auth/device/token": tokenSequence("pending", "slow_down", "approved"),
      "GET /v1/me": () => ({ json: ME }),
    });
    const ctx = makeCtx(api.url);
    const code = await runLogin({ browser: true, json: false }, ctx);
    expect(code).toBe(EXIT.OK);
    expect(loadCredentials(ctx.env).apiKey).toBe(KEY);
    expect(fs.statSync(credentialsPath(ctx.env)).mode & 0o777).toBe(0o600);
    expect(ctx.all()).not.toContain(KEY);
    expect(ctx.all()).toContain("WXYZ-2345");
    expect(ctx.all()).toContain("https://kinsy.ai/cli-auth?code=WXYZ-2345");
    expect(ctx.opened).toEqual(["https://kinsy.ai/cli-auth?code=WXYZ-2345"]);
    expect(ctx.sleeps).toEqual([5000, 10000]);
    expect(ctx.all()).toMatch(/Signed in as dev@example\.com/);
    expect(ctx.all()).toContain("ksy_live_…wxyz");
    const start = api.calls.find((c) => c.path === "/v1/auth/device")!;
    expect(start.json).toEqual({ hostname: "mbp.local", client: "cli/0.0.0-test" });
    expect(start.headers.authorization).toBeUndefined();
  });

  it("--no-browser prints the link instead of opening it; --json prints one object", async () => {
    api = await startFakeApi({
      "POST /v1/auth/device": () => ({ json: START }),
      "POST /v1/auth/device/token": tokenSequence("approved"),
      "GET /v1/me": () => ({ json: ME }),
    });
    const ctx = makeCtx(api.url);
    const code = await runLogin({ browser: false, json: true }, ctx);
    expect(code).toBe(EXIT.OK);
    expect(ctx.opened).toEqual([]);
    expect(ctx.err.join("\n")).toContain("https://kinsy.ai/cli-auth?code=WXYZ-2345");
    expect(ctx.out).toHaveLength(1);
    const parsed = JSON.parse(ctx.out[0]);
    expect(parsed).toMatchObject({ ok: true, email: "dev@example.com", key_hint: "ksy_live_…wxyz", plan: "free" });
    expect(ctx.out[0]).not.toContain(KEY);
  });

  it("--key validates against /v1/me and saves; a refused key is exit 2 and saves nothing", async () => {
    api = await startFakeApi({
      "GET /v1/me": (call) =>
        call.headers.authorization === `Bearer ${KEY}`
          ? { json: ME }
          : { status: 401, json: envelope(401, "unauthorized", "invalid or revoked API key") },
    });
    const good = makeCtx(api.url);
    expect(await runLogin({ key: KEY, browser: true, json: false }, good)).toBe(EXIT.OK);
    expect(loadCredentials(good.env).apiKey).toBe(KEY);
    expect(good.all()).not.toContain(KEY);
    expect(good.opened).toEqual([]);

    const bad = makeCtx(api.url);
    expect(await runLogin({ key: "ksy_live_" + "b".repeat(43), browser: true, json: false }, bad)).toBe(EXIT.AUTH);
    expect(loadCredentials(bad.env).apiKey).toBeNull();
    expect(bad.err.join("\n")).toMatch(/invalid or revoked/);
  });

  it("denied and expired both end with exit 2 and nothing saved", async () => {
    api = await startFakeApi({
      "POST /v1/auth/device": () => ({ json: START }),
      "POST /v1/auth/device/token": (call, nth) =>
        nth === 1 ? { json: { status: "denied", interval: 5 } } : { json: { status: "expired", interval: 5 } },
    });
    const denied = makeCtx(api.url);
    expect(await runLogin({ browser: false, json: false }, denied)).toBe(EXIT.AUTH);
    expect(denied.err.join("\n")).toMatch(/denied/i);
    expect(loadCredentials(denied.env).apiKey).toBeNull();

    const expired = makeCtx(api.url);
    expect(await runLogin({ browser: false, json: false }, expired)).toBe(EXIT.AUTH);
    expect(expired.err.join("\n")).toMatch(/expired/i);
  });

  it("opens only http(s) links on kinsy.ai or the API host; anything else is printed, never opened", async () => {
    api = await startFakeApi({
      "POST /v1/auth/device": (_c, nth) => ({
        json:
          nth === 1
            ? { ...START, verification_uri: "-a Calculator", verification_uri_complete: "-a Calculator" }
            : nth === 2
              ? { ...START, verification_uri: `${api!.url}/cli-auth`, verification_uri_complete: `${api!.url}/cli-auth?code=WXYZ-2345` }
              : { ...START, verification_uri_complete: "https://kinsy.ai/cli-auth?code=WXYZ-2345&calc" },
      }),
      "POST /v1/auth/device/token": tokenSequence("approved"),
      "GET /v1/me": () => ({ json: ME }),
    });
    const odd = makeCtx(api.url);
    expect(await runLogin({ browser: true, json: false }, odd)).toBe(EXIT.OK);
    expect(odd.opened).toEqual([]);
    expect(odd.err.join("\n")).toContain("-a Calculator");

    const own = makeCtx(api.url);
    expect(await runLogin({ browser: true, json: false }, own)).toBe(EXIT.OK);
    expect(own.opened).toEqual([`${api.url}/cli-auth?code=WXYZ-2345`]);
    // a kinsy.ai link with a smuggled command separator is rebuilt from origin + path + code
    const smuggle = makeCtx(api.url);
    expect(await runLogin({ browser: true, json: false }, smuggle)).toBe(EXIT.OK);
    expect(smuggle.opened).toEqual(["https://kinsy.ai/cli-auth?code=WXYZ-2345"]);
  });

  it("a 429 during the poll waits retry_after and carries on", async () => {
    api = await startFakeApi({
      "POST /v1/auth/device": () => ({ json: START }),
      "POST /v1/auth/device/token": (_c, nth) =>
        nth === 1
          ? { status: 429, json: envelope(429, "rate_limited", "slow down", { retry_after: 7 }) }
          : { json: { status: "approved", interval: 5, api_key: KEY, key_hint: "…wxyz", email: "dev@example.com" } },
      "GET /v1/me": () => ({ json: ME }),
    });
    const ctx = makeCtx(api.url);
    expect(await runLogin({ browser: false, json: false }, ctx)).toBe(EXIT.OK);
    expect(ctx.sleeps).toEqual([7000]);
    expect(loadCredentials(ctx.env).apiKey).toBe(KEY);
  });

  it("saves the key before the greeting call, so a failing /v1/me never loses a minted key", async () => {
    api = await startFakeApi({
      "POST /v1/auth/device": () => ({ json: START }),
      "POST /v1/auth/device/token": tokenSequence("approved"),
      "GET /v1/me": () => ({ status: 503, json: envelope(503, "unavailable", "try later") }),
    });
    const ctx = makeCtx(api.url);
    expect(await runLogin({ browser: false, json: false }, ctx)).toBe(EXIT.OK);
    expect(loadCredentials(ctx.env).apiKey).toBe(KEY);
    expect(ctx.all()).toMatch(/Signed in/);
    expect(ctx.all()).not.toContain(KEY);
  });

  it("logout removes the file and says how to revoke; a second logout is still exit 0", async () => {
    const ctx = makeCtx("http://127.0.0.1:9");
    fs.mkdirSync(ctx.env.KINSY_CONFIG_DIR!, { recursive: true });
    fs.writeFileSync(credentialsPath(ctx.env), JSON.stringify({ api_key: KEY }));
    expect(await runLogout({ json: false }, ctx)).toBe(EXIT.OK);
    expect(fs.existsSync(credentialsPath(ctx.env))).toBe(false);
    expect(ctx.all()).toMatch(/Settings/);
    expect(await runLogout({ json: false }, ctx)).toBe(EXIT.OK);
  });
});
