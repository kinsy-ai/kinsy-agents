import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCreate } from "../src/commands/create.js";
import { EXIT } from "../src/exit.js";
import { envelope, startFakeApi, type FakeApi, type Handler } from "./fake_server.js";
import { KEY, makeCtx } from "./helpers.js";

let api: FakeApi | null = null;
afterEach(async () => {
  await api?.close();
  api = null;
});

const CREATED = {
  deck_id: "deck-1",
  status: "queued",
  status_url: "https://kinsy.ai/v1/decks/deck-1",
  created_at: "2026-10-25T12:00:00+00:00",
  credits_charged: 40,
};

const PPTX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);

function status(partial: Record<string, unknown>) {
  return {
    deck_id: "deck-1", status: "running", phase: null, progress: 0, slides_rendered: 0, slides_total: 10,
    title: "Board update", client: "cli", created_at: null, updated_at: null, error: null, watermark: true,
    artifacts: null, ...partial,
  };
}

const statusSequence = (): Handler => (_c, nth) => {
  if (nth === 1) return { json: status({ status: "queued", phase: "queued" }) };
  if (nth === 2) return { json: status({ phase: "rendering", progress: 0.4, slides_rendered: 4 }) };
  return {
    json: status({
      status: "done", phase: "done", progress: 1, slides_rendered: 10,
      artifacts: {
        pptx: { url: "unused-here", filename: "board-update.pptx", expires_at: "2026-10-25T13:00:00+00:00" },
        pdf: null,
      },
    }),
  };
};

function filesRoute(base: () => string) {
  return {
    "POST /v1/files": ((call) => {
      const m = /filename="([^"]+)"/.exec(call.body);
      const name = m ? m[1] : "upload";
      return { json: { name, char_count: 12, truncated: false, text: `TEXT OF ${name}` } };
    }) as Handler,
    "GET /v1/decks/deck-1/files/pptx": ((call) => ({
      json: { url: `${base()}/signed/deck-1.pptx?sig=abc`, filename: "board-update.pptx", expires_at: "2026-10-25T13:00:00+00:00",
              redirect_was: call.query.get("redirect") },
    })) as Handler,
    "GET /signed/deck-1.pptx": (() => ({ body: PPTX, headers: { "content-type": "application/octet-stream" } })) as Handler,
  };
}

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kinsy-create-"));
}

const base = (opts: Partial<Parameters<typeof runCreate>[0]> = {}) => ({
  brief: "Q3 board update for a 40-person SaaS company.",
  file: [] as string[],
  answer: [] as string[],
  intake: true,
  wait: false,
  json: false,
  intervalMs: 3000,
  timeoutMs: 60_000,
  ...opts,
});

describe("kinsy create", () => {
  it("uploads each --file and sends them as sources", async () => {
    api = await startFakeApi({
      ...filesRoute(() => api!.url),
      "POST /v1/decks": () => ({ status: 202, json: CREATED }),
    });
    const dir = tmpdir();
    const notes = path.join(dir, "notes.md");
    const csv = path.join(dir, "data.csv");
    fs.writeFileSync(notes, "# notes\nhello");
    fs.writeFileSync(csv, "a,b\n1,2");
    const ctx = makeCtx(api.url, { KINSY_API_KEY: KEY });
    const code = await runCreate(base({ file: [notes, csv], slides: 10, theme: "slate" }), ctx);
    expect(code).toBe(EXIT.OK);
    const uploads = api.calls.filter((c) => c.path === "/v1/files");
    expect(uploads).toHaveLength(2);
    expect(uploads[0].headers["content-type"]).toMatch(/^multipart\/form-data/);
    const create = api.calls.find((c) => c.path === "/v1/decks")!;
    expect(create.json).toEqual({
      brief: "Q3 board update for a 40-person SaaS company.",
      sources: [
        { name: "notes.md", text: "TEXT OF notes.md" },
        { name: "data.csv", text: "TEXT OF data.csv" },
      ],
      slides: 10,
      theme: "slate",
      research: "auto",
      intake: "auto",
      answers: {},
    });
    expect(create.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(ctx.out.join("\n")).toContain("deck-1");
    expect(ctx.out.join("\n")).toContain("https://kinsy.ai/deck/deck-1");
    expect(ctx.out.join("\n")).toMatch(/40 credits/);
  });

  it("--wait polls until done and writes the pptx to --out", async () => {
    api = await startFakeApi({
      ...filesRoute(() => api!.url),
      "POST /v1/decks": () => ({ status: 202, json: CREATED }),
      "GET /v1/decks/deck-1": statusSequence(),
    });
    const out = path.join(tmpdir(), "nested", "board.pptx");
    const ctx = makeCtx(api.url, { KINSY_API_KEY: KEY });
    const code = await runCreate(base({ wait: true, out }), ctx);
    expect(code).toBe(EXIT.OK);
    expect(fs.readFileSync(out)).toEqual(PPTX);
    expect(ctx.sleeps).toEqual([3000, 3000]);
    expect(ctx.err.join("\n")).toMatch(/rendering.*4\/10/);
    expect(ctx.out.join("\n")).toContain(out);
    expect(ctx.out.join("\n")).toContain("https://kinsy.ai/deck/deck-1");
    const link = api.calls.find((c) => c.path === "/v1/decks/deck-1/files/pptx")!;
    expect(link.query.get("redirect")).toBe("false");
    const signed = api.calls.find((c) => c.path === "/signed/deck-1.pptx")!;
    expect(signed.headers.authorization).toBeUndefined();
  });

  it("a 402 prints the checkout url, exits 3 and never polls or writes", async () => {
    api = await startFakeApi({
      "POST /v1/decks": () => ({
        status: 402,
        json: envelope(402, "insufficient_credits", "Not enough credits.", { checkout_url: "https://kinsy.ai/pricing?src=api" }),
      }),
    });
    const out = path.join(tmpdir(), "board.pptx");
    const ctx = makeCtx(api.url, { KINSY_API_KEY: KEY });
    const code = await runCreate(base({ wait: true, out }), ctx);
    expect(code).toBe(EXIT.CREDITS);
    expect(ctx.err.join("\n")).toContain("https://kinsy.ai/pricing?src=api");
    expect(api.calls.filter((c) => c.path.startsWith("/v1/decks/"))).toHaveLength(0);
    expect(fs.existsSync(out)).toBe(false);
  });

  it("--json prints exactly one JSON object on stdout", async () => {
    api = await startFakeApi({
      ...filesRoute(() => api!.url),
      "POST /v1/decks": () => ({ status: 202, json: CREATED }),
      "GET /v1/decks/deck-1": statusSequence(),
    });
    const out = path.join(tmpdir(), "board.pptx");
    const ctx = makeCtx(api.url, { KINSY_API_KEY: KEY });
    expect(await runCreate(base({ wait: true, out, json: true }), ctx)).toBe(EXIT.OK);
    expect(ctx.out).toHaveLength(1);
    const parsed = JSON.parse(ctx.out[0]);
    expect(parsed).toMatchObject({
      deck_id: "deck-1", status: "done", slides_total: 10, credits_charged: 40,
      pptx_path: out, web_url: "https://kinsy.ai/deck/deck-1",
    });
    expect(ctx.out[0]).not.toContain(KEY);

    // and the 402 case keeps the one-object contract
    await api.close();
    api = await startFakeApi({
      "POST /v1/decks": () => ({ status: 402, json: envelope(402, "insufficient_credits", "Not enough credits.", { checkout_url: "https://kinsy.ai/pricing?src=api" }) }),
    });
    const ctx2 = makeCtx(api.url, { KINSY_API_KEY: KEY });
    expect(await runCreate(base({ json: true }), ctx2)).toBe(EXIT.CREDITS);
    expect(ctx2.out).toHaveLength(1);
    expect(JSON.parse(ctx2.out[0]).error.checkout_url).toBe("https://kinsy.ai/pricing?src=api");
  });

  it("a failed build is exit 6 and a timed-out wait is exit 6", async () => {
    api = await startFakeApi({
      "POST /v1/decks": () => ({ status: 202, json: CREATED }),
      "GET /v1/decks/deck-1": (_c, nth) =>
        nth === 1
          ? { json: status({ phase: "planning" }) }
          : { json: status({ status: "error", phase: "error", error: "The brief had nothing to say." }) },
    });
    const ctx = makeCtx(api.url, { KINSY_API_KEY: KEY });
    expect(await runCreate(base({ wait: true }), ctx)).toBe(EXIT.FAILED);
    expect(ctx.err.join("\n")).toContain("The brief had nothing to say.");

    await api.close();
    api = await startFakeApi({
      "POST /v1/decks": () => ({ status: 202, json: CREATED }),
      "GET /v1/decks/deck-1": () => ({ json: status({ phase: "rendering", progress: 0.5 }) }),
    });
    const ctx2 = makeCtx(api.url, { KINSY_API_KEY: KEY });
    expect(await runCreate(base({ wait: true, timeoutMs: 20 }), ctx2)).toBe(EXIT.FAILED);
    expect(ctx2.err.join("\n")).toMatch(/timed out|still running/i);
    expect(ctx2.err.join("\n")).toContain("kinsy status deck-1");
  });

  it("--idempotency-key, --answer and --no-intake reach the request", async () => {
    api = await startFakeApi({ "POST /v1/decks": () => ({ status: 202, json: CREATED }) });
    const ctx = makeCtx(api.url, { KINSY_API_KEY: KEY });
    const code = await runCreate(
      base({ answer: ["audience=the board", "tone=direct"], intake: false, idempotencyKey: "run-42", research: "off" }),
      ctx,
    );
    expect(code).toBe(EXIT.OK);
    const create = api.calls.find((c) => c.path === "/v1/decks")!;
    expect(create.headers["idempotency-key"]).toBe("run-42");
    expect(create.json).toMatchObject({ intake: "skip", research: "off", answers: { audience: "the board", tone: "direct" } });
  });

  it("no brief and no files is exit 4 without a request", async () => {
    api = await startFakeApi({});
    const ctx = makeCtx(api.url, { KINSY_API_KEY: KEY });
    expect(await runCreate(base({ brief: "  " }), ctx)).toBe(EXIT.INPUT);
    expect(api.calls).toHaveLength(0);
  });

  it("a missing --file is exit 4 before anything is uploaded", async () => {
    api = await startFakeApi({});
    const ctx = makeCtx(api.url, { KINSY_API_KEY: KEY });
    expect(await runCreate(base({ file: ["/no/such/file.pdf"] }), ctx)).toBe(EXIT.INPUT);
    expect(api.calls).toHaveLength(0);
    expect(ctx.err.join("\n")).toContain("/no/such/file.pdf");
  });
});
