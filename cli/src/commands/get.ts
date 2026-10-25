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
