import { afterEach, describe, expect, it } from "vitest";
import { KinsyClient, KinsyError } from "../src/client.js";
import { EXIT, exitCodeFor } from "../src/exit.js";
import { envelope, startFakeApi, type FakeApi } from "./fake_server.js";

let api: FakeApi | null = null;
afterEach(async () => {
  await api?.close();
  api = null;
});

describe("KinsyClient", () => {
  it("sends the client header and the bearer on every call", async () => {
    api = await startFakeApi({
      "GET /v1/me": (call) => ({ json: { seen: call.headers } }),
    });
    const client = new KinsyClient({ apiBase: api.url, apiKey: "ksy_live_k", version: "0.0.0-test" });
    const body = await client.request<{ seen: Record<string, string> }>("GET", "/v1/me");
    expect(body.seen.authorization).toBe("Bearer ksy_live_k");
    expect(body.seen["x-kinsy-client"]).toBe("cli/0.0.0-test");
    expect(body.seen["user-agent"]).toMatch(/^kinsy-cli\/0\.0\.0-test/);
  });

  it("a 402 envelope becomes a KinsyError with the checkout url and exit code 3", async () => {
    api = await startFakeApi({
      "POST /v1/decks": () => ({
        status: 402,
        json: envelope(402, "insufficient_credits", "Not enough credits for a 10-slide deck.", {
          checkout_url: "https://kinsy.ai/pricing?src=api",
        }),
      }),
    });
    const client = new KinsyClient({ apiBase: api.url, apiKey: "ksy_live_k", version: "t" });
    const err = await client.request("POST", "/v1/decks", { json: { brief: "x" } }).catch((e) => e);
    expect(err).toBeInstanceOf(KinsyError);
    expect(err.status).toBe(402);
    expect(err.code).toBe("insufficient_credits");
    expect(err.checkoutUrl).toBe("https://kinsy.ai/pricing?src=api");
    expect(err.message).toBe("Not enough credits for a 10-slide deck.");
    expect(exitCodeFor(err)).toBe(EXIT.CREDITS);
  });

  it("a 429 carries retry_after and exit code 5; a 401 is exit code 2", async () => {
    api = await startFakeApi({
      "GET /v1/me": (_c, nth) =>
        nth === 1
          ? { status: 429, json: envelope(429, "rate_limited", "slow down", { retry_after: 60 }) }
          : { status: 401, json: envelope(401, "unauthorized", "invalid or revoked API key") },
    });
    const client = new KinsyClient({ apiBase: api.url, apiKey: "ksy_live_k", version: "t" });
    const first = await client.request("GET", "/v1/me").catch((e) => e);
    expect(first.retryAfter).toBe(60);
    expect(exitCodeFor(first)).toBe(EXIT.RATE_LIMITED);
    const second = await client.request("GET", "/v1/me").catch((e) => e);
    expect(exitCodeFor(second)).toBe(EXIT.AUTH);
  });

  it("a refused connection and a non-JSON 5xx are exit code 7", async () => {
    const closed = await startFakeApi({});
    const url = closed.url;
    await closed.close();
    const client = new KinsyClient({ apiBase: url, apiKey: null, version: "t" });
    const err = await client.request("GET", "/v1/themes").catch((e) => e);
    expect(err).toBeInstanceOf(KinsyError);
    expect(err.status).toBe(0);
    expect(err.code).toBe("network");
    expect(exitCodeFor(err)).toBe(EXIT.UNAVAILABLE);

    api = await startFakeApi({
      "GET /v1/themes": () => ({ status: 503, body: "<html>no instance</html>", headers: { "content-type": "text/html" } }),
    });
    const client2 = new KinsyClient({ apiBase: api.url, apiKey: null, version: "t" });
    const err2 = await client2.request("GET", "/v1/themes").catch((e) => e);
    expect(err2.status).toBe(503);
    expect(exitCodeFor(err2)).toBe(EXIT.UNAVAILABLE);
  });

  it("400-class answers are exit code 4 and anything else is 1", async () => {
    api = await startFakeApi({
      "GET /v1/decks/nope": () => ({ status: 404, json: envelope(404, "not_found", "deck not found") }),
      "POST /v1/decks": () => ({ status: 422, json: envelope(422, "validation_error", "slides must be 4 to 25") }),
    });
    const client = new KinsyClient({ apiBase: api.url, apiKey: "k", version: "t" });
    expect(exitCodeFor(await client.request("GET", "/v1/decks/nope").catch((e) => e))).toBe(EXIT.INPUT);
    expect(exitCodeFor(await client.request("POST", "/v1/decks", { json: {} }).catch((e) => e))).toBe(EXIT.INPUT);
    expect(exitCodeFor(new Error("boom"))).toBe(EXIT.ERROR);
  });

  it("download fetches raw bytes without the bearer", async () => {
    api = await startFakeApi({
      "GET /signed/deck.pptx": (call) => ({
        body: call.headers.authorization ? "LEAKED" : Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        headers: { "content-type": "application/octet-stream" },
      }),
    });
    const client = new KinsyClient({ apiBase: api.url, apiKey: "ksy_live_k", version: "t" });
    const bytes = await client.download(`${api.url}/signed/deck.pptx`);
    expect(Array.from(bytes)).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });
});
