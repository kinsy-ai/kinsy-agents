import { requireClient, type Ctx } from "../context.js";
import { downloadArtifact, kb, type ArtifactKind } from "../download.js";
import { EXIT } from "../exit.js";
import { printError, printJson } from "../output.js";

export { defaultOutPath } from "../download.js";

export type GetOpts = { deckId: string; kind: ArtifactKind; out?: string; json: boolean };

export async function runGet(opts: GetOpts, ctx: Ctx): Promise<number> {
  try {
    const saved = await downloadArtifact(requireClient(ctx), opts.deckId, opts.kind, opts.out);
    if (opts.json) {
      printJson({ deck_id: opts.deckId, kind: opts.kind, path: saved.path, filename: saved.filename, bytes: saved.bytes }, ctx.io);
    } else {
      ctx.io.stdout(`Saved ${saved.path} (${kb(saved.bytes)}).`);
    }
    return EXIT.OK;
  } catch (err) {
    return printError(err, opts, ctx.io);
  }
}

export type SlidesOpts = { deckId: string; json: boolean };
type Delivery = { to: string; url: string; file_id: string; title: string };

// --slides: the server saves the deck to the user's connected Google Drive
// as Google Slides and answers with the link; nothing is downloaded here.
export async function runGetSlides(opts: SlidesOpts, ctx: Ctx): Promise<number> {
  try {
    const res = await requireClient(ctx).request<Delivery>(
      "POST", `/v1/decks/${encodeURIComponent(opts.deckId)}/deliver`, { json: { to: "google_slides" } },
    );
    if (opts.json) {
      printJson({ deck_id: opts.deckId, ...res }, ctx.io);
    } else {
      ctx.io.stdout(`Saved to Google Slides: ${res.url}`);
    }
    return EXIT.OK;
  } catch (err) {
    return printError(err, opts, ctx.io);
  }
}
