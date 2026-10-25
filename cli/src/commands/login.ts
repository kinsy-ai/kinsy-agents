import { KinsyError } from "../client.js";
import { clientFor, publicClient, type Ctx } from "../context.js";
import { credentialsPath, maskKey, saveCredentials } from "../credentials.js";
import { EXIT } from "../exit.js";
import { printError, printJson } from "../output.js";
import type { DeviceStart, DeviceToken, Me } from "../types.js";

export type LoginOpts = { key?: string; browser: boolean; json: boolean };

export const WEB_URL = "https://kinsy.ai";

async function finish(key: string, me: Me, opts: LoginOpts, ctx: Ctx): Promise<number> {
  const file = saveCredentials({ apiKey: key, email: me.email ?? undefined, keyHint: maskKey(key) }, ctx.env);
  if (opts.json) {
    printJson(
      {
        ok: true,
        email: me.email,
        plan: me.plan,
        credits: me.credits?.total ?? null,
        key_hint: maskKey(key),
        credentials: file,
      },
      ctx.io,
    );
  } else {
    ctx.io.stdout(`Signed in as ${me.email ?? "your Kinsy account"} (key ${maskKey(key)}).`);
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
  const me = await clientFor(ctx, key).request<Me>("GET", "/v1/me");
  return finish(key, me, opts, ctx);
}

async function deviceLogin(opts: LoginOpts, ctx: Ctx): Promise<number> {
  const pub = publicClient(ctx);
  const start = await pub.request<DeviceStart>("POST", "/v1/auth/device", {
    json: { hostname: ctx.hostname, client: `cli/${ctx.version}` },
  });
  ctx.io.stderr(`To sign in, open ${start.verification_uri_complete}`);
  ctx.io.stderr(`and confirm the code ${start.user_code} for this machine (${ctx.hostname}).`);
  let opened = false;
  if (opts.browser && ctx.isTTY) opened = await ctx.openBrowser(start.verification_uri_complete);
  ctx.io.stderr(opened ? "Opened your browser. Waiting for approval…" : "Waiting for approval…");

  let interval = start.interval > 0 ? start.interval : 5;
  const maxPolls = Math.ceil((start.expires_in > 0 ? start.expires_in : 600) / Math.max(1, interval)) + 10;
  for (let n = 0; n < maxPolls; n++) {
    if (n > 0) await ctx.sleep(interval * 1000);
    const res = await pub.request<DeviceToken>("POST", "/v1/auth/device/token", {
      json: { device_code: start.device_code },
    });
    switch (res.status) {
      case "pending":
        continue;
      case "slow_down":
        interval = res.interval > interval ? res.interval : interval + 5;
        continue;
      case "approved": {
        if (!res.api_key) {
          throw new KinsyError("the sign-in was approved but no key arrived; run kinsy login again", {
            status: 0,
            code: "bad_response",
          });
        }
        const me = await clientFor(ctx, res.api_key).request<Me>("GET", "/v1/me");
        return finish(res.api_key, me, opts, ctx);
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
