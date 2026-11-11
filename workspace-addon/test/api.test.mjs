import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, load, plain, response } from "./harness.mjs";

const signedIn = { "kinsy.access": "acc1", "kinsy.refresh": "ref1" };
const caught = (fn) => { try { fn(); } catch (e) { return { kind: e.kind, message: e.message }; } return null; };

describe("manifest", () => {
  const m = JSON.parse(readFileSync(join(ROOT, "appsscript.json"), "utf8"));

  it("asks for the five narrow scopes and nothing else", () => {
    expect(m.oauthScopes.sort()).toEqual([
      "https://www.googleapis.com/auth/documents.currentonly",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/presentations.currentonly",
      "https://www.googleapis.com/auth/script.container.ui",
      "https://www.googleapis.com/auth/script.external_request",
    ]);
  });

  it("may fetch only Kinsy, the download host and Google's upload host", () => {
    expect(m.urlFetchWhitelist).toEqual([
      "https://kinsy.ai/",
      "https://storage.googleapis.com/",
      "https://www.googleapis.com/",
    ]);
    expect(m.runtimeVersion).toBe("V8");
    expect(m.dependencies).toBeUndefined();     // no libraries
  });

  it("pushes exactly the files the script needs", () => {
    const keep = readFileSync(join(ROOT, ".claspignore"), "utf8").split("\n").filter((l) => l.startsWith("!")).map((l) => l.slice(1));
    expect(keep.sort()).toEqual(["Api.js", "Auth.js", "Callback.html", "Code.js", "Config.js", "Drive.js", "Sidebar.html", "appsscript.json"]);
  });
});

describe("API client", () => {
  it("sends the bearer and the client name to kinsy.ai", () => {
    const env = load({ props: signedIn, fetch: () => response(202, { deck_id: "deck-1", status: "queued" }) });
    const out = env.ctx.createDeck_("Board update", 10, []);
    expect(plain(out)).toMatchObject({ deck_id: "deck-1" });
    const { url, params } = env.calls[0];
    expect(url).toBe("https://kinsy.ai/v1/decks");
    expect(plain(params.headers)).toEqual({ Authorization: "Bearer acc1", "X-Kinsy-Client": "gws-addon/1.0.0" });
    expect(params.followRedirects).toBe(false);
    expect(JSON.parse(params.payload)).toEqual({ brief: "Board update", slides: 10, sources: [] });
  });

  it("refuses to send the bearer anywhere else", () => {
    const env = load({ props: signedIn });
    expect(caught(() => env.ctx.kinsyFetch_("get", "https://kinsy.ai.evil.example/v1/me", null, "acc1"))).toMatchObject({ kind: "invalid" });
    expect(caught(() => env.ctx.kinsyFetch_("get", "https://storage.googleapis.com/x", null, "acc1"))).toMatchObject({ kind: "invalid" });
    expect(env.calls).toHaveLength(0);
  });

  it("needs a sign-in", () => {
    const env = load();
    expect(caught(() => env.ctx.deckStatus_("deck-1"))).toMatchObject({ kind: "auth" });
    expect(env.calls).toHaveLength(0);
  });

  it("refreshes once on a 401 and retries with the new token", () => {
    const env = load({
      props: signedIn,
      fetch: (url, params) => {
        if (url.endsWith("/api/oauth/token")) return response(200, { access_token: "acc2", refresh_token: "ref2" });
        return params.headers.Authorization === "Bearer acc2" ? response(200, { deck_id: "deck-1", status: "running" }) : response(401, {});
      },
    });
    expect(plain(env.ctx.deckStatus_("deck-1"))).toMatchObject({ status: "running" });
    expect(env.calls.map((c) => c.url)).toEqual([
      "https://kinsy.ai/v1/decks/deck-1",
      "https://kinsy.ai/api/oauth/token",
      "https://kinsy.ai/v1/decks/deck-1",
    ]);
  });

  it("signs out when the retry is refused too", () => {
    const env = load({
      props: signedIn,
      fetch: (url) => (url.endsWith("/api/oauth/token") ? response(200, { access_token: "acc2", refresh_token: "ref2" }) : response(401, {})),
    });
    expect(caught(() => env.ctx.deckStatus_("deck-1"))).toMatchObject({ kind: "auth" });
    expect(env.props.data).toEqual({});
    expect(env.calls).toHaveLength(3);
  });

  it.each([
    [402, "credits"], [429, "busy"], [503, "server"], [422, "invalid"],
  ])("maps %i to %s with the server's message", (status, kind) => {
    const env = load({ props: signedIn, fetch: () => response(status, { error: { message: "Server says no." } }) });
    expect(caught(() => env.ctx.createDeck_("x", 10, []))).toEqual({ kind, message: "Server says no." });
  });

  it("copes with a reply that is not JSON", () => {
    const env = load({ props: signedIn, fetch: () => response(502, "<html>bad gateway</html>") });
    expect(caught(() => env.ctx.createDeck_("x", 10, []))).toEqual({ kind: "server", message: "Request failed (502)." });
  });

  it("reports an unreachable server", () => {
    const env = load({ props: signedIn, fetch: () => { throw new Error("DNS"); } });
    expect(caught(() => env.ctx.createDeck_("x", 10, []))).toMatchObject({ kind: "server" });
  });

  it("only accepts well-formed deck ids", () => {
    const env = load({ props: signedIn });
    for (const bad of ["../me", "deck 1", "", "a/b", "x".repeat(65), null]) {
      expect(caught(() => env.ctx.deckStatus_(bad))).toMatchObject({ kind: "invalid" });
    }
    expect(env.calls).toHaveLength(0);
  });
});
