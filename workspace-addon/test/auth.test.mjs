import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SCRIPT_ID, load, plain, response, stateArgs } from "./harness.mjs";

const REDIRECT = `https://script.google.com/macros/d/${SCRIPT_ID}/usercallback`;
const tokens = (n) => response(200, { access_token: `acc${n}`, refresh_token: `ref${n}`, token_type: "Bearer" });

function startSignIn(env) {
  const url = new URL(env.ctx.authUrl_());
  const state = url.searchParams.get("state");
  return { url, state, nonce: stateArgs(state).args.n };
}

describe("sign-in", () => {
  it("builds the authorize URL for a public PKCE client", () => {
    const env = load();
    const { url, state, nonce } = startSignIn(env);
    expect(url.origin + url.pathname).toBe("https://kinsy.ai/oauth/authorize");
    const q = Object.fromEntries(url.searchParams);
    expect(q).toMatchObject({
      response_type: "code",
      client_id: "https://kinsy.ai/workspace-addon/oauth-client.json",
      redirect_uri: REDIRECT,
      code_challenge_method: "S256",
      scope: "decks",
    });
    expect(stateArgs(state)).toMatchObject({ method: "authCallback", timeout: 600 });
    const verifier = env.cache[`pkce:${nonce}`];
    expect(verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(q.code_challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("stores the tokens when the callback brings a code", () => {
    const env = load({ fetch: () => tokens(1) });
    const { nonce } = startSignIn(env);
    const verifier = env.cache[`pkce:${nonce}`];
    const page = env.ctx.authCallback({ parameter: { code: "CODE", n: nonce } });
    expect(page.getContent()).toContain("You're signed in");
    expect(env.calls).toHaveLength(1);
    expect(env.calls[0].url).toBe("https://kinsy.ai/api/oauth/token");
    expect(plain(env.calls[0].params.payload)).toEqual({
      grant_type: "authorization_code",
      code: "CODE",
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      client_id: "https://kinsy.ai/workspace-addon/oauth-client.json",
    });
    expect(env.calls[0].params.followRedirects).toBe(false);
    expect(env.props.data).toMatchObject({ "kinsy.access": "acc1", "kinsy.refresh": "ref1" });
    expect(env.cache[`pkce:${nonce}`]).toBeUndefined();     // single use
    expect(env.ctx.signedIn_()).toBe(true);
  });

  it("stores nothing when sign-in was refused", () => {
    const env = load();
    const { nonce } = startSignIn(env);
    const page = env.ctx.authCallback({ parameter: { error: "access_denied", n: nonce } });
    expect(page.getContent()).toContain("Sign-in didn't finish");
    expect(env.calls).toHaveLength(0);
    expect(env.props.data).toEqual({});
  });

  it("stores nothing without this person's verifier", () => {
    const env = load();
    const page = env.ctx.authCallback({ parameter: { code: "CODE", n: "someone-elses-nonce" } });
    expect(page.getContent()).toContain("Sign-in didn't finish");
    expect(env.calls).toHaveLength(0);
    expect(env.props.data).toEqual({});
  });

  it("stores nothing when the exchange is refused, and never echoes the reply", () => {
    const env = load({ fetch: () => response(400, { error: "invalid_grant", error_description: "<script>x</script>" }) });
    const { nonce } = startSignIn(env);
    const page = env.ctx.authCallback({ parameter: { code: "CODE", n: nonce } });
    expect(page.getContent()).toContain("Sign-in didn't finish");
    expect(page.getContent()).not.toContain("<script>x");
    expect(env.props.data).toEqual({});
  });
});

describe("refresh", () => {
  const signedIn = { "kinsy.access": "acc1", "kinsy.refresh": "ref1" };

  it("rotates both tokens under the user lock", () => {
    const env = load({ props: signedIn, fetch: () => tokens(2) });
    expect(env.ctx.refresh_("acc1")).toBe("acc2");
    expect(plain(env.calls[0].params.payload)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "ref1",
      client_id: "https://kinsy.ai/workspace-addon/oauth-client.json",
    });
    expect(env.props.data).toMatchObject({ "kinsy.access": "acc2", "kinsy.refresh": "ref2" });
    expect(env.lock.taken).toBe(1);
    expect(env.lock.held).toBe(false);
  });

  it("uses the token another call already refreshed instead of spending the refresh token twice", () => {
    const env = load({ props: { "kinsy.access": "acc2", "kinsy.refresh": "ref2" } });
    expect(env.ctx.refresh_("acc1")).toBe("acc2");
    expect(env.calls).toHaveLength(0);
  });

  it("signs out when the refresh token is refused", () => {
    const env = load({ props: signedIn, fetch: () => response(400, { error: "invalid_grant" }) });
    expect(() => env.ctx.refresh_("acc1")).toThrow(/sign-in has expired/i);
    expect(env.props.data).toEqual({});
    expect(env.lock.held).toBe(false);
  });

  it("keeps the tokens when Kinsy is briefly unreachable", () => {
    const env = load({ props: signedIn, fetch: () => response(503, "busy") });
    expect(() => env.ctx.refresh_("acc1")).toThrow(/could not be reached/i);
    expect(env.props.data).toMatchObject(signedIn);
  });
});

describe("sign-out", () => {
  it("revokes the refresh token and clears the store", () => {
    const env = load({ props: { "kinsy.access": "acc1", "kinsy.refresh": "ref1", "kinsy.lastSave": "{}" }, fetch: () => response(200, {}) });
    expect(plain(env.ctx.signOut())).toEqual({ ok: true });
    expect(env.calls[0].url).toBe("https://kinsy.ai/api/oauth/revoke");
    expect(plain(env.calls[0].params.payload)).toMatchObject({ token: "ref1" });
    expect(env.props.data).toEqual({});
  });

  it("clears the store even when the revoke call fails", () => {
    const env = load({ props: { "kinsy.access": "acc1", "kinsy.refresh": "ref1" }, fetch: () => { throw new Error("network"); } });
    expect(plain(env.ctx.signOut())).toEqual({ ok: true });
    expect(env.props.data).toEqual({});
  });
});
