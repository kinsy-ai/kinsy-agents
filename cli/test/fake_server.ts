// A fake https://kinsy.ai/v1 on 127.0.0.1 for the CLI tests. Routes are
// keyed "METHOD /path" (query string ignored); unknown routes answer with
// the real API's error envelope so the client's error path is exercised.
import http from "node:http";
import { AddressInfo } from "node:net";

export type Call = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: unknown;
};

export type Reply = {
  status?: number;
  json?: unknown;
  body?: Buffer | string;
  headers?: Record<string, string>;
};

export type Handler = (call: Call, nth: number) => Reply | Promise<Reply>;

export type FakeApi = {
  url: string;
  calls: Call[];
  close(): Promise<void>;
};

export function envelope(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return {
    error: { code, message, status, docs_url: `https://kinsy.ai/docs/errors#${code}`, ...extra },
  };
}

export async function startFakeApi(routes: Record<string, Handler>): Promise<FakeApi> {
  const calls: Call[] = [];
  const counts = new Map<string, number>();
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const body = Buffer.concat(chunks).toString("utf8");
      let json: unknown = undefined;
      if ((req.headers["content-type"] ?? "").includes("application/json") && body) {
        try {
          json = JSON.parse(body);
        } catch {
          json = undefined;
        }
      }
      const call: Call = { method: req.method ?? "GET", path: url.pathname, query: url.searchParams, headers: req.headers, body, json };
      calls.push(call);
      const key = `${call.method} ${call.path}`;
      const nth = (counts.get(key) ?? 0) + 1;
      counts.set(key, nth);
      const handler = routes[key];
      let reply: Reply;
      if (!handler) {
        reply = { status: 404, json: envelope(404, "not_found", `no route for ${key}`) };
      } else {
        reply = await handler(call, nth);
      }
      const status = reply.status ?? 200;
      const headers: Record<string, string> = { ...(reply.headers ?? {}) };
      let payload: Buffer | string;
      if (reply.json !== undefined) {
        payload = JSON.stringify(reply.json);
        headers["content-type"] ??= "application/json";
      } else {
        payload = reply.body ?? "";
      }
      res.writeHead(status, headers);
      res.end(payload);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
