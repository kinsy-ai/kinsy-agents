import { publicClient, type Ctx } from "../context.js";
import { EXIT } from "../exit.js";
import { printError, printJson } from "../output.js";
import type { Theme } from "../types.js";

export async function runThemes(opts: { json: boolean }, ctx: Ctx): Promise<number> {
  try {
    const themes = await publicClient(ctx).request<Theme[]>("GET", "/v1/themes");
    if (opts.json) {
      printJson(themes, ctx.io);
      return EXIT.OK;
    }
    const width = Math.max(4, ...themes.map((t) => t.id.length));
    for (const t of themes) {
      const tail = t.description ? ` — ${t.description}` : "";
      ctx.io.stdout(`${t.id.padEnd(width)}  ${t.name}${tail}`);
    }
    ctx.io.stdout("");
    ctx.io.stdout("Pass one with: kinsy create \"…\" --theme <id>");
    return EXIT.OK;
  } catch (err) {
    return printError(err, opts, ctx.io);
  }
}
