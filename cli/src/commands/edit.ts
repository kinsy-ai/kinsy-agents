import { requireClient, type Ctx } from "../context.js";
import { EXIT } from "../exit.js";
import { printError, printJson } from "../output.js";
import type { EditResponse } from "../types.js";
import { webUrl } from "./create.js";

export type EditOpts = { deckId: string; slide: number; instruction: string; json: boolean };

export async function runEdit(opts: EditOpts, ctx: Ctx): Promise<number> {
  try {
    const res = await requireClient(ctx).request<EditResponse>(
      "POST",
      `/v1/decks/${encodeURIComponent(opts.deckId)}/edits`,
      { json: { slide: opts.slide, instruction: opts.instruction } },
    );
    if (opts.json) {
      printJson(res, ctx.io);
      return EXIT.OK;
    }
    if (res.clarify) {
      ctx.io.stdout(`Kinsy needs a decision before changing slide ${opts.slide}:`);
      ctx.io.stdout(`  ${res.clarify}`);
      ctx.io.stdout("Nothing was charged. Run the edit again with a more specific instruction.");
      return EXIT.OK;
    }
    const num = res.slide?.num ?? opts.slide;
    const headline = res.slide?.headline ?? "(no headline)";
    ctx.io.stdout(`Slide ${num} updated: ${headline}${res.layout_changed ? " (layout changed)" : ""}`);
    ctx.io.stdout(`${res.credits_charged} credits charged.`);
    ctx.io.stdout(`Review: ${webUrl(opts.deckId)}`);
    return EXIT.OK;
  } catch (err) {
    return printError(err, opts, ctx.io);
  }
}
