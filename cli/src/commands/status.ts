import { requireClient, type Ctx } from "../context.js";
import { EXIT } from "../exit.js";
import { printError, printJson } from "../output.js";
import type { DeckStatus } from "../types.js";
import { DEFAULT_INTERVAL_MS, DEFAULT_TIMEOUT_MS, progressReporter, waitForDeck } from "../wait.js";
import { webUrl } from "./create.js";

export type StatusOpts = {
  deckId: string;
  watch: boolean;
  json: boolean;
  intervalMs?: number;
  timeoutMs?: number;
};

export function describeStatus(s: DeckStatus): string[] {
  const pct = Math.round((s.progress ?? 0) * 100);
  const lines = [
    `${s.deck_id}: ${s.status}${s.phase && s.phase !== s.status ? ` (${s.phase})` : ""}`,
    `${s.slides_rendered}/${s.slides_total ?? "?"} slides · ${pct}%${s.title ? ` · ${s.title}` : ""}`,
  ];
  if (s.status === "done") {
    lines.push(`Download:  kinsy get ${s.deck_id} --out deck.pptx`);
    lines.push(`On the web: ${webUrl(s.deck_id)}`);
  } else if (s.status === "error") {
    lines.push(`Failed: ${s.error ?? "no reason given"}`);
  } else {
    lines.push(`Follow it: kinsy status ${s.deck_id} --watch`);
  }
  return lines;
}

export async function runStatus(opts: StatusOpts, ctx: Ctx): Promise<number> {
  try {
    const client = requireClient(ctx);
    const path = `/v1/decks/${encodeURIComponent(opts.deckId)}`;
    const status = opts.watch
      ? await waitForDeck(client, opts.deckId, {
          intervalMs: opts.intervalMs ?? DEFAULT_INTERVAL_MS,
          timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          sleep: ctx.sleep,
          onProgress: progressReporter(ctx.io.stderr),
        })
      : await client.request<DeckStatus>("GET", path);
    if (opts.json) printJson(status, ctx.io);
    else for (const line of describeStatus(status)) ctx.io.stdout(line);
    return status.status === "error" ? EXIT.FAILED : EXIT.OK;
  } catch (err) {
    return printError(err, opts, ctx.io);
  }
}
