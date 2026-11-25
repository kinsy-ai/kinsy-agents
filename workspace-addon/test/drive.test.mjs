import { describe, expect, it } from "vitest";
import { load, plain, response } from "./harness.mjs";

const signedIn = { "kinsy.access": "acc1", "kinsy.refresh": "ref1" };
const PPTX_URL = "https://storage.googleapis.com/kinsy-decks/deck-1.pptx?X-Goog-Signature=abc";
const SESSION = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=XYZ";
const FILE_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const PPTX = Buffer.from("PK\u0003\u0004 pretend pptx bytes");
const caught = (fn) => { try { fn(); } catch (e) { return { kind: e.kind, message: e.message }; } return null; };

function routes(over = {}) {
  const r = {
    status: () => response(200, { deck_id: "deck-1", status: "done", title: "Q3 board update", artifacts: { pptx: { url: PPTX_URL, filename: "q3.pptx" } } }),
    download: () => response(200, PPTX),
    start: () => response(200, "", { Location: SESSION }),
    put: () => response(200, { id: FILE_ID }),
    ...over,
  };
  return (url, params) => {
    if (url.startsWith("https://kinsy.ai/v1/decks/")) return r.status(url, params);
    if (url === PPTX_URL) return r.download(url, params);
    if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id")) return r.start(url, params);
    if (url === SESSION) return r.put(url, params);
    throw new Error(`unexpected ${url}`);
  };
}

// With no presentation open (the add-on running somewhere other than
// Slides) the deck is saved as a new file and linked.
describe("save as a new Slides file", () => {
  it("downloads without a token, uploads with Google's, and answers with the Slides link", () => {
    const env = load({ host: "docs", props: signedIn, fetch: routes() });
    const out = plain(env.ctx.saveToSlides_("deck-1"));
    expect(out).toEqual({ url: `https://docs.google.com/presentation/d/${FILE_ID}/edit`, title: "Q3 board update" });

    const [status, download, start, put] = env.calls;
    expect(status.params.headers.Authorization).toBe("Bearer acc1");
    expect(download.params.headers).toBeUndefined();          // signed link carries its own authorisation
    expect(download.params.followRedirects).toBe(false);

    expect(plain(start.params.headers)).toEqual({
      Authorization: "Bearer ya29.google-token",
      "X-Upload-Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "X-Upload-Content-Length": String(PPTX.length),
    });
    expect(JSON.parse(start.params.payload)).toEqual({ name: "Q3 board update", mimeType: "application/vnd.google-apps.presentation" });
    expect(put.params.method).toBe("put");
    expect(plain(put.params.headers)).toEqual({ Authorization: "Bearer ya29.google-token" });
    expect(Buffer.from(plain(put.params.payload))).toEqual(PPTX);
    // The Kinsy token never goes to Google or to the download host.
    for (const c of [download, start, put]) expect(JSON.stringify(c.params)).not.toContain("acc1");
    expect(env.lock.held).toBe(false);
  });

  it("returns the file already made when the button is pressed again", () => {
    const env = load({ host: "docs", props: signedIn, fetch: routes() });
    const first = plain(env.ctx.saveToSlides_("deck-1"));
    const n = env.calls.length;
    const second = plain(env.ctx.saveToSlides_("deck-1"));
    expect(second).toEqual(first);
    expect(env.calls.slice(n).map((c) => c.url)).toEqual(["https://kinsy.ai/v1/decks/deck-1"]);   // no second upload
  });

  it("does not start a second save while one is running", () => {
    const env = load({ host: "docs", props: signedIn, fetch: routes() });
    env.lock.busy = true;
    expect(caught(() => env.ctx.saveToSlides_("deck-1"))).toMatchObject({ kind: "busy" });
    expect(env.calls.map((c) => c.url)).toEqual(["https://kinsy.ai/v1/decks/deck-1"]);
  });

  it("waits for a finished deck", () => {
    const env = load({ host: "docs", props: signedIn, fetch: routes({ status: () => response(200, { deck_id: "deck-1", status: "running" }) }) });
    expect(caught(() => env.ctx.saveToSlides_("deck-1"))).toMatchObject({ kind: "invalid" });
    expect(env.calls).toHaveLength(1);
  });

  it("only downloads from the storage host", () => {
    const evil = () => response(200, { status: "done", artifacts: { pptx: { url: "https://evil.example/deck.pptx" } } });
    const env = load({ host: "docs", props: signedIn, fetch: routes({ status: evil }) });
    expect(caught(() => env.ctx.saveToSlides_("deck-1"))).toMatchObject({ kind: "server" });
    expect(env.calls).toHaveLength(1);
  });

  it("says so when Drive is full, and a later press retries without rebuilding", () => {
    let full = true;
    const start = () => (full ? response(403, { error: { errors: [{ reason: "storageQuotaExceeded" }] } }) : response(200, "", { Location: SESSION }));
    const env = load({ host: "docs", props: signedIn, fetch: routes({ start }) });
    expect(caught(() => env.ctx.saveToSlides_("deck-1"))).toMatchObject({ kind: "drive_full" });
    expect(env.props.data["kinsy.lastSave"]).toBeUndefined();
    expect(env.lock.held).toBe(false);
    full = false;
    expect(plain(env.ctx.saveToSlides_("deck-1")).url).toContain(FILE_ID);
    expect(env.calls.some((c) => c.params.method === "post" && c.url === "https://kinsy.ai/v1/decks")).toBe(false);
  });

  it("refuses an upload session on another host", () => {
    const env = load({ host: "docs", props: signedIn, fetch: routes({ start: () => response(200, "", { Location: "https://evil.example/upload" }) }) });
    expect(caught(() => env.ctx.saveToSlides_("deck-1"))).toMatchObject({ kind: "drive" });
    expect(env.calls).toHaveLength(3);
  });

  it("refuses a file id that is not one", () => {
    const env = load({ host: "docs", props: signedIn, fetch: routes({ put: () => response(200, { id: "x/../y" }) }) });
    expect(caught(() => env.ctx.saveToSlides_("deck-1"))).toMatchObject({ kind: "drive" });
    expect(env.props.data["kinsy.lastSave"]).toBeUndefined();
  });

  it("never echoes Google's error text", () => {
    const env = load({ host: "docs", props: signedIn, fetch: routes({ put: () => response(500, "<b>internal ya29.secret</b>") }) });
    expect(caught(() => env.ctx.saveToSlides_("deck-1")).message).toBe("Google Drive didn't accept the file. Try again in a minute.");
  });

  it("cleans the title", () => {
    const env = load();
    expect(env.ctx.cleanTitle_("  A\tdeck\nname  ")).toBe("A deck name");
    expect(env.ctx.cleanTitle_("")).toBe("Kinsy deck");
    expect(env.ctx.cleanTitle_("x".repeat(500))).toHaveLength(200);
  });
});

const DELETE = `https://www.googleapis.com/drive/v3/files/${FILE_ID}`;
function inPlace(over = {}) {
  const base = routes(over);
  return (url, params) => (url === DELETE ? (over.del ?? (() => response(204)))(url, params) : base(url, params));
}
const titles = (env) => env.active.list.map((s) => s.title);

describe("add the deck to the open presentation", () => {
  it("puts the slides in the presentation that is open and links nowhere else", () => {
    const env = load({ props: signedIn, fetch: inPlace(), slides: [["Our plan", "2026"], ["Budget"]] });
    const out = plain(env.ctx.saveToSlides_("deck-1"));
    expect(out).toEqual({ added: 3, title: "Q3 board update" });
    expect(titles(env)).toEqual(["own-1", "own-2", "Cover", "Agenda", "Close"]);
    expect(env.opened).toEqual([FILE_ID]);
    expect(env.selected).toEqual(["Cover"]);            // the person lands on the first new slide
    expect(env.lock.held).toBe(false);
  });

  it("replaces the single empty slide of a new presentation", () => {
    const env = load({ props: signedIn, fetch: inPlace() });
    env.ctx.saveToSlides_("deck-1");
    expect(titles(env)).toEqual(["Cover", "Agenda", "Close"]);
  });

  it("keeps a single slide that has something on it", () => {
    for (const slides of [[["Hello"]], [[null]]]) {
      const env = load({ props: signedIn, fetch: inPlace(), slides });
      env.ctx.saveToSlides_("deck-1");
      expect(titles(env)).toEqual(["own-1", "Cover", "Agenda", "Close"]);
    }
  });

  it("removes the working copy from Drive afterwards, with Google's token", () => {
    const env = load({ props: signedIn, fetch: inPlace() });
    env.ctx.saveToSlides_("deck-1");
    const del = env.calls.at(-1);
    expect(del.url).toBe(DELETE);
    expect(del.params.method).toBe("delete");
    expect(plain(del.params.headers)).toEqual({ Authorization: "Bearer ya29.google-token" });
  });

  it("does not add the slides twice when asked again", () => {
    const env = load({ props: signedIn, fetch: inPlace() });
    const first = plain(env.ctx.saveToSlides_("deck-1"));
    const n = env.calls.length;
    expect(plain(env.ctx.saveToSlides_("deck-1"))).toEqual(first);
    expect(titles(env)).toEqual(["Cover", "Agenda", "Close"]);
    expect(env.calls.slice(n).map((c) => c.url)).toEqual(["https://kinsy.ai/v1/decks/deck-1"]);
  });

  it("takes back a half-finished copy, removes the working copy, and can be retried", () => {
    const env = load({ props: signedIn, fetch: inPlace(), slides: [["Our plan"]], failAppendAt: 2 });
    expect(caught(() => env.ctx.saveToSlides_("deck-1"))).toMatchObject({ kind: "drive" });
    expect(titles(env)).toEqual(["own-1"]);
    expect(env.calls.at(-1).url).toBe(DELETE);
    expect(env.lock.held).toBe(false);
    env.ctx.saveToSlides_("deck-1");                     // the second attempt goes through
    expect(titles(env)).toEqual(["own-1", "Cover", "Agenda", "Close"]);
  });

  it("still succeeds when the working copy cannot be removed", () => {
    const env = load({ props: signedIn, fetch: inPlace({ del: () => { throw new Error("network"); } }) });
    expect(plain(env.ctx.saveToSlides_("deck-1")).added).toBe(3);
  });

  it("says so when the converted deck cannot be opened", () => {
    const env = load({ props: signedIn, fetch: inPlace(), openById: () => { throw new Error("secret detail"); } });
    const err = caught(() => env.ctx.saveToSlides_("deck-1"));
    expect(err.kind).toBe("drive");
    expect(err.message).not.toContain("secret");
  });
});
