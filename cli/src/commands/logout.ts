import type { Ctx } from "../context.js";
import { clearCredentials } from "../credentials.js";
import { EXIT } from "../exit.js";
import { printError, printJson } from "../output.js";

export async function runLogout(opts: { json: boolean }, ctx: Ctx): Promise<number> {
  try {
    const removed = clearCredentials(ctx.env);
    if (opts.json) {
      printJson({ ok: true, removed }, ctx.io);
      return EXIT.OK;
    }
    ctx.io.stdout(removed ? "Signed out on this machine." : "No credentials were stored on this machine.");
    ctx.io.stdout("To disable the key everywhere, revoke it in Settings → API keys at https://kinsy.ai/settings.");
    return EXIT.OK;
  } catch (err) {
    return printError(err, opts, ctx.io);
  }
}
