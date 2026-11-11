import { describe, expect, it } from "vitest";
import { load, plain, response } from "./harness.mjs";

const signedIn = { "kinsy.access": "acc1", "kinsy.refresh": "ref1" };
const KEY = "0123456789abcdef0123456789abcdef";

describe("menu", () => {
  it.each(["slides", "docs"])("adds one menu item in %s and touches nothing else", (host) => {
    const env = load({ host });
    env.ctx.onOpen({ authMode: "NONE" });
    expect(env.menu).toEqual({ items: [["Build a deck", "showSidebar"]], added: true });
    expect(env.calls).toHaveLength(0);
    expect(env.props.data).toEqual({});
    expect(env.shown).toHaveLength(0);          // never opens the sidebar by itself
  });

  it("installs the same menu", () => {
    const env = load();
    env.ctx.onInstall({ authMode: "FULL" });
    expect(env.menu.added).toBe(true);
  });

  it("opens the sidebar from the menu item", () => {
    const env = load();
    env.ctx.showSidebar();
    expect(env.shown).toHaveLength(1);
    expect(env.shown[0].title).toBe("Kinsy");
  });
});

describe("state", () => {
  it("offers a sign-in link when signed out", () => {
    const env = load({ host: "slides" });
    const s = plain(env.ctx.getState());
    expect(s).toMatchObject({ ok: true, signedIn: false, host: "slides", documentName: "" });
    expect(s.signInUrl).toMatch(/^https:\/\/kinsy\.ai\/oauth\/authorize\?/);
  });

  it("never hands a token to the sidebar", () => {
    const env = load({ host: "docs", props: signedIn });
    const s = plain(env.ctx.getState());
    expect(s).toMatchObject({ ok: true, signedIn: true, host: "docs", documentName: "Q3 board notes" });
    expect(s.signInUrl).toBeUndefined();
    expect(JSON.stringify(s)).not.toMatch(/acc1|ref1/);
  });
});

describe("build", () => {
  const created = () => response(202, { deck_id: "deck-9", status: "queued" });

  it("sends the brief and no document from Slides", () => {
    const env = load({ host: "slides", props: signedIn, fetch: created });
    expect(plain(env.ctx.startBuild({ key: KEY, brief: "  Board update  ", slides: 12, useDocument: false }))).toEqual({ ok: true, deckId: "deck-9" });
    expect(JSON.parse(env.calls[0].params.payload)).toEqual({ brief: "Board update", slides: 12, sources: [] });
  });

  it("sends the document as a source when asked to, in Docs", () => {
    const env = load({ host: "docs", props: signedIn, fetch: created, docText: "  Revenue grew 12%.  " });
    expect(plain(env.ctx.startBuild({ key: KEY, brief: "", slides: 8, useDocument: true }))).toEqual({ ok: true, deckId: "deck-9" });
    expect(JSON.parse(env.calls[0].params.payload)).toEqual({
      brief: "", slides: 8, sources: [{ name: "Q3 board notes", text: "Revenue grew 12%." }],
    });
  });

  it("does not read the document unless asked", () => {
    const env = load({ host: "docs", props: signedIn, fetch: created });
    env.ctx.startBuild({ key: KEY, brief: "Board update", slides: 10 });
    expect(JSON.parse(env.calls[0].params.payload).sources).toEqual([]);
  });

  it("caps a very long document", () => {
    const env = load({ host: "docs", props: signedIn, fetch: created, docText: "a".repeat(150000) });
    env.ctx.startBuild({ key: KEY, brief: "", slides: 10, useDocument: true });
    expect(JSON.parse(env.calls[0].params.payload).sources[0].text).toHaveLength(120000);
  });

  it("cannot use a document from Slides", () => {
    const env = load({ host: "slides", props: signedIn, fetch: created });
    expect(plain(env.ctx.startBuild({ key: KEY, brief: "", slides: 10, useDocument: true }))).toMatchObject({ ok: false, kind: "invalid" });
    expect(env.calls).toHaveLength(0);
  });

  it("needs a brief or a document", () => {
    const env = load({ host: "slides", props: signedIn, fetch: created });
    expect(plain(env.ctx.startBuild({ key: KEY, brief: "   ", slides: 10 }))).toMatchObject({ ok: false, kind: "invalid" });
    const empty = load({ host: "docs", props: signedIn, fetch: created, docText: "  " });
    expect(plain(empty.ctx.startBuild({ key: KEY, brief: "", slides: 10, useDocument: true }))).toMatchObject({ ok: false, kind: "invalid" });
    expect(env.calls.length + empty.calls.length).toBe(0);
  });

  it("names the submission so a repeat cannot be charged twice", () => {
    const env = load({ props: signedIn, fetch: created });
    env.ctx.startBuild({ key: KEY, brief: "x", slides: 10 });
    expect(env.calls[0].params.headers["Idempotency-Key"]).toBe("gws-" + KEY);
  });

  it("refuses a submission without a well-formed key", () => {
    const env = load({ props: signedIn, fetch: created });
    for (const key of [undefined, "", "short", "has spaces in it 0123456789", "x".repeat(65), 42]) {
      expect(plain(env.ctx.startBuild({ key, brief: "x", slides: 10 }))).toMatchObject({ ok: false, kind: "invalid" });
    }
    expect(env.calls).toHaveLength(0);
  });

  it("falls back to ten slides on a bad count", () => {
    const env = load({ props: signedIn, fetch: created });
    env.ctx.startBuild({ key: KEY, brief: "x", slides: 99 });
    env.ctx.startBuild({ key: KEY, brief: "x", slides: "abc" });
    expect(env.calls.map((c) => JSON.parse(c.params.payload).slides)).toEqual([10, 10]);
  });

  it("answers out-of-credits as its own kind", () => {
    const env = load({ props: signedIn, fetch: () => response(402, { error: { message: "This deck needs 40 credits." } }) });
    expect(plain(env.ctx.startBuild({ key: KEY, brief: "x", slides: 10 }))).toEqual({ ok: false, kind: "credits", message: "This deck needs 40 credits." });
  });

  it("hides unexpected errors", () => {
    const env = load({ props: signedIn, fetch: () => ({ getResponseCode: () => { throw new Error("secret detail acc1"); } }) });
    expect(plain(env.ctx.startBuild({ key: KEY, brief: "x", slides: 10 }))).toEqual({ ok: false, kind: "server", message: "Something went wrong. Try again." });
  });
});

describe("poll and save", () => {
  it("reports progress in the sidebar's shape", () => {
    const env = load({ props: signedIn, fetch: () => response(200, { deck_id: "deck-9", status: "running", progress: 0.4, slides_rendered: 4, slides_total: 10, title: "Q3" }) });
    expect(plain(env.ctx.pollDeck("deck-9"))).toEqual({ ok: true, status: "running", progress: 0.4, slidesRendered: 4, slidesTotal: 10, title: "Q3", error: "" });
  });

  it("copes with a deck that has no counts yet", () => {
    const env = load({ props: signedIn, fetch: () => response(200, { deck_id: "deck-9", status: "queued", slides_total: null }) });
    expect(plain(env.ctx.pollDeck("deck-9"))).toEqual({ ok: true, status: "queued", progress: 0, slidesRendered: 0, slidesTotal: null, title: "", error: "" });
  });

  it("signs out the sidebar when the sign-in has ended", () => {
    const env = load({ props: signedIn, fetch: (url) => (url.endsWith("/token") ? response(400, { error: "invalid_grant" }) : response(401, {})) });
    expect(plain(env.ctx.pollDeck("deck-9"))).toMatchObject({ ok: false, kind: "auth" });
    expect(plain(env.ctx.getState()).signedIn).toBe(false);
  });

  it("tells the sidebar when sign-in has finished, without a token", () => {
    expect(plain(load().ctx.checkSignIn())).toEqual({ ok: true, signedIn: false });
    expect(plain(load({ props: signedIn }).ctx.checkSignIn())).toEqual({ ok: true, signedIn: true });
  });

  it("wraps the save", () => {
    const env = load({ props: signedIn, fetch: () => response(200, { status: "running" }) });
    expect(plain(env.ctx.saveDeck("deck-9"))).toMatchObject({ ok: false, kind: "invalid" });
  });
});
