import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runEdit } from "../src/commands/edit.js";
import { defaultOutPath, runGet } from "../src/commands/get.js";
import { runStatus } from "../src/commands/status.js";
import { EXIT } from "../src/exit.js";
import { envelope, startFakeApi, type FakeApi } from "./fake_server.js";
import { KEY, makeCtx } from "./helpers.js";

let api: FakeApi | null = null;
afterEach(async () => {
  await api?.close();
  api = null;
});

const RUNNING = {
  deck_id: "deck-1", status: "running", phase: "rendering", progress: 0.4, slides_rendered: 4, slides_total: 10,
  title: "Board update", client: "cli", created_at: null, updated_at: null, error: null, watermark: false, artifacts: null,
};

const PDF = Buffer.from("%PDF-1.7 fake");

describe("kinsy status / get / edit", () => {
  it("status prints state, phase and progress", async () => {
    api = await startFakeApi({ "GET /v1/decks/deck-1": () => ({ json: RUNNING }) });
    const ctx = makeCtx(api.url, { KINSY_API_KEY: KEY });
    expect(await runStatus({ deckId: "deck-1", watch: false, json: false }, ctx)).toBe(EXIT.OK);
    const text = ctx.out.join("\n");
    expect(text).toContain("running");
    expect(text).toContain("rendering");
    expect(text).toContain("4/10");
    expect(text).toContain("40%");
  });

  it("status --json prints the status object; --watch follows until done", async () => {
    api = await startFakeApi({
      "GET /v1/decks/deck-1": (_c, nth) =>
        nth < 3
          ? { json: RUNNING }
          : { json: { ...RUNNING, status: "done", phase: "done", progress: 1, slides_rendered: 10,
                      artifacts: { pptx: { url: "x", filename: "board-update.pptx", expires_at: "e" }, pdf: null } } },
    });
    const ctx = makeCtx(api.url, { KINSY_API_KEY: KEY });
    expect(await runStatus({ deckId: "deck-1", watch: true, json: true, intervalMs: 1000 }, ctx)).toBe(EXIT.OK);
    expect(ctx.out).toHaveLength(1);
    expect(JSON.parse(ctx.out[0]).status).toBe("done");
    expect(ctx.sleeps).toEqual([1000, 1000]);
  });

  it("a deck that is not yours is exit 4", async () => {
    api = await startFakeApi({
      "GET /v1/decks/deck-9": () => ({ status: 403, json: envelope(403, "forbidden", "not your deck") }),
    });
    const ctx = makeCtx(api.url, { KINSY_API_KEY: KEY });
    expect(await runStatus({ deckId: "deck-9", watch: false, json: false }, ctx)).toBe(EXIT.INPUT);
  });

  it("get --pdf writes the file and reports where", async () => {
    api = await startFakeApi({
      "GET /v1/decks/deck-1/files/pdf": () => ({
        json: { url: `${api!.url}/signed/deck-1.pdf`, filename: "board-update.pdf", expires_at: "e" },
      }),
      "GET /signed/deck-1.pdf": () => ({ body: PDF, headers: { "content-type": "application/pdf" } }),
    });
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kinsy-get-")), "deck.pdf");
    const ctx = makeCtx(api.url, { KINSY_API_KEY: KEY });
    expect(await runGet({ deckId: "deck-1", kind: "pdf", out, json: false }, ctx)).toBe(EXIT.OK);
    expect(fs.readFileSync(out)).toEqual(PDF);
    expect(ctx.out.join("\n")).toContain(out);
    expect(api.calls[0].query.get("redirect")).toBe("false");
  });

  it("get --json reports path, filename and size", async () => {
    api = await startFakeApi({
      "GET /v1/decks/deck-1/files/pptx": () => ({
        json: { url: `${api!.url}/signed/deck-1.pptx`, filename: "board-update.pptx", expires_at: "e" },
      }),
      "GET /signed/deck-1.pptx": () => ({ body: PDF }),
    });
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kinsy-get-")), "deck.pptx");
    const ctx = makeCtx(api.url, { KINSY_API_KEY: KEY });
    expect(await runGet({ deckId: "deck-1", kind: "pptx", out, json: true }, ctx)).toBe(EXIT.OK);
    expect(JSON.parse(ctx.out[0])).toEqual({ deck_id: "deck-1", kind: "pptx", path: out, filename: "board-update.pptx", bytes: PDF.length });
  });

  it("defaultOutPath prefers the server's filename and falls back to the id", () => {
    expect(defaultOutPath("deck-1", "pptx", "board-update.pptx")).toBe("board-update.pptx");
    expect(defaultOutPath("deck-1", "pdf", undefined)).toBe("deck-1.pdf");
    expect(defaultOutPath("deck-1", "png", "../../etc/passwd")).toBe("deck-1.zip");   // png = a zip of slide images
  });

  it("edit posts the slide and instruction and prints the new headline", async () => {
    api = await startFakeApi({
      "POST /v1/decks/deck-1/edits": () => ({
        json: { deck_id: "deck-1", slide: { num: 3, layout: "bullets", headline: "Three asks", png_url: "" },
                clarify: null, layout_changed: false, title: "Board update", images_generated: 0, credits_charged: 5 },
      }),
    });
    const ctx = makeCtx(api.url, { KINSY_API_KEY: KEY });
    expect(await runEdit({ deckId: "deck-1", slide: 3, instruction: "Cut to three bullets", json: false }, ctx)).toBe(EXIT.OK);
    expect(api.calls[0].json).toEqual({ slide: 3, instruction: "Cut to three bullets" });
    const text = ctx.out.join("\n");
    expect(text).toContain("Three asks");
    expect(text).toMatch(/5 credits/);
  });

  it("edit prints the clarifying question when the instruction was ambiguous", async () => {
    api = await startFakeApi({
      "POST /v1/decks/deck-1/edits": () => ({
        json: { deck_id: "deck-1", slide: null, clarify: "Which chart do you mean?", layout_changed: false,
                title: "", images_generated: 0, credits_charged: 0 },
      }),
    });
    const ctx = makeCtx(api.url, { KINSY_API_KEY: KEY });
    expect(await runEdit({ deckId: "deck-1", slide: 2, instruction: "fix the chart", json: false }, ctx)).toBe(EXIT.OK);
    expect(ctx.out.join("\n")).toContain("Which chart do you mean?");
    expect(ctx.out.join("\n")).toMatch(/nothing was charged/i);
  });

  it("edit on someone else's deck is exit 4", async () => {
    api = await startFakeApi({
      "POST /v1/decks/deck-9/edits": () => ({ status: 403, json: envelope(403, "forbidden", "not your deck") }),
    });
    const ctx = makeCtx(api.url, { KINSY_API_KEY: KEY });
    expect(await runEdit({ deckId: "deck-9", slide: 1, instruction: "x", json: false }, ctx)).toBe(EXIT.INPUT);
  });
});
