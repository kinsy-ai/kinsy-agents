import { afterEach, describe, expect, it } from "vitest";
import { runMe } from "../src/commands/me.js";
import { runThemes } from "../src/commands/themes.js";
import { saveCredentials } from "../src/credentials.js";
import { EXIT } from "../src/exit.js";
import { envelope, startFakeApi, type FakeApi } from "./fake_server.js";
import { KEY, ME, makeCtx } from "./helpers.js";

let api: FakeApi | null = null;
afterEach(async () => {
  await api?.close();
  api = null;
});

describe("kinsy me / themes", () => {
  it("me prints who, plan and credits without leaking the key", async () => {
    api = await startFakeApi({ "GET /v1/me": () => ({ json: ME }) });
    const ctx = makeCtx(api.url);
    saveCredentials({ apiKey: KEY }, ctx.env);
    expect(await runMe({ json: false }, ctx)).toBe(EXIT.OK);
    const text = ctx.out.join("\n");
    expect(text).toContain("dev@example.com");
    expect(text).toMatch(/Free/);
    expect(text).toMatch(/100/);
    expect(text).toMatch(/watermark/i);
    expect(text).not.toContain(KEY);
    expect(api.calls[0].headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("me --json prints the account exactly as the API returned it", async () => {
    api = await startFakeApi({ "GET /v1/me": () => ({ json: ME }) });
    const ctx = makeCtx(api.url, { KINSY_API_KEY: KEY });
    expect(await runMe({ json: true }, ctx)).toBe(EXIT.OK);
    expect(JSON.parse(ctx.out[0])).toEqual(ME);
  });

  it("me without credentials is exit 2 and says how to sign in", async () => {
    api = await startFakeApi({});
    const ctx = makeCtx(api.url);
    expect(await runMe({ json: false }, ctx)).toBe(EXIT.AUTH);
    expect(ctx.err.join("\n")).toMatch(/kinsy login/);
    expect(api.calls).toHaveLength(0);
  });

  it("me --json without credentials prints an error envelope on stdout", async () => {
    api = await startFakeApi({});
    const ctx = makeCtx(api.url);
    expect(await runMe({ json: true }, ctx)).toBe(EXIT.AUTH);
    expect(JSON.parse(ctx.out[0]).error.code).toBe("not_signed_in");
  });

  it("themes lists ids and names and needs no key", async () => {
    api = await startFakeApi({
      "GET /v1/themes": () => ({
        json: [
          { id: "slate", name: "Slate", description: "The house theme" },
          { id: "paper_academic", name: "Paper", description: "For lectures" },
        ],
      }),
    });
    const ctx = makeCtx(api.url);
    expect(await runThemes({ json: false }, ctx)).toBe(EXIT.OK);
    const text = ctx.out.join("\n");
    expect(text).toContain("slate");
    expect(text).toContain("paper_academic");
    expect(text).toContain("Slate");
    expect(api.calls[0].headers.authorization).toBeUndefined();
  });

  it("a server error on themes is exit 7", async () => {
    api = await startFakeApi({
      "GET /v1/themes": () => ({ status: 503, json: envelope(503, "unavailable", "try later") }),
    });
    const ctx = makeCtx(api.url);
    expect(await runThemes({ json: false }, ctx)).toBe(EXIT.UNAVAILABLE);
  });
});
