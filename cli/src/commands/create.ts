import fs from "node:fs";
import path from "node:path";
import { KinsyError } from "../client.js";
import { requireClient, type Ctx } from "../context.js";
import { downloadArtifact, kb } from "../download.js";
import { EXIT } from "../exit.js";
import { printError, printJson } from "../output.js";
import type { DeckCreateResponse, FileResponse } from "../types.js";
import { DEFAULT_INTERVAL_MS, DEFAULT_TIMEOUT_MS, progressReporter, waitForDeck } from "../wait.js";

export const WEB_BASE = "https://kinsy.ai";

export function webUrl(deckId: string): string {
  return `${WEB_BASE}/deck/${encodeURIComponent(deckId)}`;
}

export type CreateOpts = {
  brief: string;
  file: string[];
  slides?: number;
  theme?: string;
  template?: string;
  research?: "auto" | "on" | "off";
  intake: boolean;
  answer: string[];
  wait: boolean;
  out?: string;
  idempotencyKey?: string;
  json: boolean;
  intervalMs?: number;
  timeoutMs?: number;
};

export function parseAnswers(list: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of list) {
    const i = item.indexOf("=");
    const key = i > 0 ? item.slice(0, i).trim() : "";
    const value = i > 0 ? item.slice(i + 1).trim() : "";
    if (!key || !value) {
      throw new KinsyError(`--answer expects key=value, got "${item}"`, { status: 400, code: "bad_request" });
    }
    out[key] = value;
  }
  return out;
}

export async function runCreate(opts: CreateOpts, ctx: Ctx): Promise<number> {
  try {
    const brief = (opts.brief ?? "").trim();
    const files = opts.file ?? [];
    if (!brief && files.length === 0) {
      throw new KinsyError("Give a brief, or at least one --file.", { status: 400, code: "bad_request" });
    }
    for (const f of files) {
      if (!fs.existsSync(f) || !fs.statSync(f).isFile()) {
        throw new KinsyError(`file not found: ${f}`, { status: 400, code: "bad_request" });
      }
    }
    const answers = parseAnswers(opts.answer ?? []);
    const client = requireClient(ctx);

    const sources: { name: string; text: string }[] = [];
    for (const f of files) {
      const name = path.basename(f);
      const form = new FormData();
      form.append("file", new Blob([fs.readFileSync(f)]), name);
      const extracted = await client.request<FileResponse>("POST", "/v1/files", { form });
      if (extracted.truncated) {
        ctx.io.stderr(`note: ${name} is long; only its first ${extracted.char_count} characters are used.`);
      }
      sources.push({ name, text: extracted.text });
    }

    const body: Record<string, unknown> = {
      brief,
      sources,
      research: opts.research ?? "auto",
      intake: opts.intake ? "auto" : "skip",
      answers,
    };
    if (opts.slides !== undefined) body.slides = opts.slides;
    if (opts.theme) body.theme = opts.theme;
    if (opts.template) body.template = opts.template;
    const headers = opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined;

    const created = await client.request<DeckCreateResponse>("POST", "/v1/decks", { json: body, headers });
    const id = created.deck_id;
    const web = webUrl(id);

    // Asking for the file is asking to wait for it.
    const wait = opts.wait || Boolean(opts.out);
    if (!wait) {
      if (opts.json) {
        printJson({ ...created, web_url: web }, ctx.io);
      } else {
        ctx.io.stdout(`Deck ${id} queued (${created.credits_charged} credits).`);
        ctx.io.stdout(`Follow it:   kinsy status ${id} --watch`);
        ctx.io.stdout(`Download:    kinsy get ${id} --out deck.pptx   (once it is done)`);
        ctx.io.stdout(`On the web:  ${web}`);
      }
      return EXIT.OK;
    }

    const final = await waitForDeck(client, id, {
      intervalMs: opts.intervalMs ?? DEFAULT_INTERVAL_MS,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      sleep: ctx.sleep,
      onProgress: progressReporter(ctx.io.stderr),
    });
    if (final.status === "error") {
      throw new KinsyError(final.error || "the deck failed to build", { status: 0, code: "deck_failed" });
    }
    const saved = opts.out ? await downloadArtifact(client, id, "pptx", opts.out) : null;

    if (opts.json) {
      printJson(
        { ...final, credits_charged: created.credits_charged, web_url: web, pptx_path: saved?.path ?? null },
        ctx.io,
      );
    } else {
      const slides = final.slides_total ?? final.slides_rendered;
      ctx.io.stdout(`Done: ${final.title ?? id}, ${slides} slides, ${created.credits_charged} credits.`);
      if (saved) ctx.io.stdout(`Saved ${saved.path} (${kb(saved.bytes)}). It opens in PowerPoint as designed and every element is editable.`);
      else ctx.io.stdout(`Download:   kinsy get ${id} --out deck.pptx`);
      ctx.io.stdout(`Review and edit on the web: ${web}`);
    }
    return EXIT.OK;
  } catch (err) {
    return printError(err, opts, ctx.io);
  }
}
