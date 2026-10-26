import { KinsyError } from "../client.js";
import { clientFor, publicClient, type Ctx } from "../context.js";
import { credentialsPath, maskKey, saveCredentials } from "../credentials.js";
import { EXIT } from "../exit.js";
import { printError, printJson } from "../output.js";
import type { DeviceStart, DeviceToken, Me } from "../types.js";

export type LoginOpts = { key?: string; browser: boolean; json: boolean };

export const WEB_URL = "https://kinsy.ai";

// Save first, greet second: a key that was minted for us must never be lost
// because the greeting call (GET /v1/me) happened to fail.
async function finish(key: string, email: string | null | undefined, opts: LoginOpts, ctx: Ctx): Promise<number> {
  const file = saveCredentials({ apiKey: key, email: email ?? undefined, keyHint: maskKey(key) }, ctx.env);
  let me: Me | null = null;
  try {
    me = await clientFor(ctx, key).request<Me>("GET", "/v1/me");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    ctx.io.stderr(`Signed in, but the account details could not be fetched just now (${reason}).`);
  }
  if (opts.json) {
    printJson(
      {
        ok: true,
        email: me?.email ?? email ?? null,
        plan: me?.plan ?? null,
        credits: me?.credits?.total ?? null,
        key_hint: maskKey(key),
        credentials: file,
      },
      ctx.io,
    );
  } else {
    ctx.io.stdout(`Signed in as ${me?.email ?? email ?? "your Kinsy account"} (key ${maskKey(key)}).`);
    ctx.io.stdout(`Credentials saved to ${file} (readable by you only).`);
  }
  return EXIT.OK;
}

async function loginWithKey(key: string, opts: LoginOpts, ctx: Ctx): Promise<number> {
  if (!key.startsWith("ksy_")) {
    throw new KinsyError("That does not look like a Kinsy API key (they start with ksy_live_).", {
      status: 401,
      code: "unauthorized",
    });
  }
  // A pasted key is checked before it is stored: a refused key saves nothing.
  const me = await clientFor(ctx, key).request<Me>("GET", "/v1/me");
  return finish(key, me.email, opts, ctx);
}

// Only links on kinsy.ai (or the configured API host) are handed to the
// operating system's opener; anything else is printed for the person to
// judge. The URL comes from the server, and `open`/`xdg-open`/`cmd start`
// would happily interpret an odd string as flags or a command.
export function isOpenableLink(url: string, apiBase: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const allowed = new Set(["kinsy.ai", "www.kinsy.ai"]);
  try {
    allowed.add(new URL(apiBase).host);
  } catch {
    /* no api base host to allow */
  }
  return allowed.has(parsed.host);
}

export function openTargetFor(start: DeviceStart): string | null {
  const code = String(start.user_code ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!code) return null;
  try {
    const u = new URL(start.verification_uri);
    return `${u.origin}${u.pathname}?code=${encodeURIComponent(code)}`;
  } catch {
    return null;
  }
}

async function deviceLogin(opts: LoginOpts, ctx: Ctx): Promise<number> {
  const pub = publicClient(ctx);
  const start = await pub.request<DeviceStart>("POST", "/v1/auth/device", {
    json: { hostname: ctx.hostname, client: `cli/${ctx.version}` },
  });
  ctx.io.stderr(`To sign in, open ${start.verification_uri_complete}`);
  ctx.io.stderr(`and confirm the code ${start.user_code} for this machine (${ctx.hostname}).`);
  // What we hand to the operating system is built here from the verification
  // URI's origin and path plus the code, never the server's complete link as
  // given, so no server-supplied character reaches `open`/`cmd start`.
  let opened = false;
  const target = openTargetFor(start);
  if (opts.browser && ctx.isTTY && target && isOpenableLink(target, pub.apiBase)) {
    opened = await ctx.openBrowser(target);
  }
  ctx.io.stderr(opened ? "Opened your browser. Waiting for approval…" : "Waiting for approval…");

  let interval = start.interval > 0 ? start.interval : 5;
  const maxPolls = Math.ceil((start.expires_in > 0 ? start.expires_in : 600) / Math.max(1, interval)) + 10;
  for (let polls = 0; polls < maxPolls; polls++) {
    let res: DeviceToken;
    try {
      res = await pub.request<DeviceToken>("POST", "/v1/auth/device/token", {
        json: { device_code: start.device_code },
      });
    } catch (err) {
      // Several terminals behind one address can trip the per-address
      // damper; the approval may land while we wait, so wait rather than give up.
      if (err instanceof KinsyError && err.status === 429) {
        await ctx.sleep((err.retryAfter ?? interval + 5) * 1000);
        continue;
      }
      throw err;
    }
    switch (res.status) {
      case "pending":
        await ctx.sleep(interval * 1000);
        continue;
      case "slow_down":
        interval = res.interval > interval ? res.interval : interval + 5;
        await ctx.sleep(interval * 1000);
        continue;
      case "approved": {
        if (!res.api_key) {
          throw new KinsyError("the sign-in was approved but no key arrived; run kinsy login again", {
            status: 0,
            code: "bad_response",
          });
        }
        return finish(res.api_key, res.email, opts, ctx);
      }
      case "denied":
        throw new KinsyError("Sign-in was denied in the browser. Nothing was connected.", {
          status: 401,
          code: "access_denied",
        });
      case "expired":
        throw new KinsyError("The code expired before it was approved. Run kinsy login again.", {
          status: 401,
          code: "expired",
        });
      case "claimed":
        throw new KinsyError("That code was already used. Run kinsy login again for a fresh one.", {
          status: 401,
          code: "claimed",
        });
      default:
        throw new KinsyError(`unexpected sign-in status "${String(res.status)}"`, { status: 0, code: "bad_response" });
    }
  }
  throw new KinsyError("The code expired before it was approved. Run kinsy login again.", {
    status: 401,
    code: "expired",
  });
}

export async function runLogin(opts: LoginOpts, ctx: Ctx): Promise<number> {
  try {
    if (opts.key) return await loginWithKey(opts.key.trim(), opts, ctx);
    return await deviceLogin(opts, ctx);
  } catch (err) {
    return printError(err, opts, ctx.io);
  }
}

export { credentialsPath };
