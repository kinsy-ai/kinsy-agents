// A thin client over https://kinsy.ai/v1. Every error becomes a KinsyError
// carrying the API's envelope (code, message, checkout_url, retry_after)
// so commands can map it to an exit code and a one-line explanation.

const CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  402: "insufficient_credits",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "too_large",
  415: "unsupported_media_type",
  422: "validation_error",
  429: "rate_limited",
  503: "unavailable",
};

export type KinsyErrorOpts = {
  status: number;
  code: string;
  checkoutUrl?: string;
  retryAfter?: number;
  docsUrl?: string;
};

export class KinsyError extends Error {
  status: number;
  code: string;
  checkoutUrl?: string;
  retryAfter?: number;
  docsUrl?: string;

  constructor(message: string, opts: KinsyErrorOpts) {
    super(message);
    this.name = "KinsyError";
    this.status = opts.status;
    this.code = opts.code;
    this.checkoutUrl = opts.checkoutUrl;
    this.retryAfter = opts.retryAfter;
    this.docsUrl = opts.docsUrl;
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = { code: this.code, message: this.message, status: this.status };
    if (this.checkoutUrl) out.checkout_url = this.checkoutUrl;
    if (this.retryAfter !== undefined) out.retry_after = this.retryAfter;
    if (this.docsUrl) out.docs_url = this.docsUrl;
    return out;
  }
}

export function codeFor(status: number): string {
  return CODES[status] ?? (status >= 500 ? "server_error" : "error");
}

function errorFrom(status: number, text: string): KinsyError {
  try {
    const parsed = JSON.parse(text) as { error?: Record<string, unknown>; detail?: unknown };
    const e = parsed?.error;
    if (e && typeof e === "object") {
      return new KinsyError(String(e.message ?? `HTTP ${status}`), {
        status,
        code: String(e.code ?? codeFor(status)),
        checkoutUrl: typeof e.checkout_url === "string" ? e.checkout_url : undefined,
        retryAfter: typeof e.retry_after === "number" ? e.retry_after : undefined,
        docsUrl: typeof e.docs_url === "string" ? e.docs_url : undefined,
      });
    }
    if (typeof parsed?.detail === "string") {
      return new KinsyError(parsed.detail, { status, code: codeFor(status) });
    }
  } catch {
    /* not JSON: fall through */
  }
  const trimmed = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return new KinsyError(trimmed || `HTTP ${status}`, { status, code: codeFor(status) });
}

export type RequestOpts = {
  json?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
};

export type ClientOpts = {
  apiBase: string;
  apiKey?: string | null;
  version: string;
  fetch?: typeof fetch;
};

export class KinsyClient {
  readonly apiBase: string;
  readonly apiKey: string | null;
  readonly version: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ClientOpts) {
    this.apiBase = opts.apiBase.replace(/\/+$/, "");
    this.apiKey = opts.apiKey ?? null;
    this.version = opts.version;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  get hasKey(): boolean {
    return Boolean(this.apiKey);
  }

  private headers(extra?: Record<string, string>, json = false): Record<string, string> {
    const h: Record<string, string> = {
      "X-Kinsy-Client": `cli/${this.version}`,
      "User-Agent": `kinsy-cli/${this.version} (+https://kinsy.ai/docs/cli)`,
      Accept: "application/json",
      ...(extra ?? {}),
    };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  async request<T = unknown>(method: string, path: string, opts: RequestOpts = {}): Promise<T> {
    const url = `${this.apiBase}${path}`;
    const body = opts.json !== undefined ? JSON.stringify(opts.json) : opts.form;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: this.headers(opts.headers, opts.json !== undefined),
        body: body as RequestInit["body"],
        redirect: "manual",
      });
    } catch (err) {
      const host = new URL(url).host;
      const reason = err instanceof Error ? (err.cause as Error | undefined)?.message || err.message : String(err);
      throw new KinsyError(`could not reach ${host} (${reason})`, { status: 0, code: "network" });
    }
    const text = await res.text();
    if (!res.ok) throw errorFrom(res.status, text);
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new KinsyError("the server answered with something that is not JSON", {
        status: res.status,
        code: "bad_response",
      });
    }
  }

  // Signed download links carry their own authorisation in the query
  // string; sending the bearer to a storage host would leak it.
  async download(url: string): Promise<Uint8Array> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { "User-Agent": `kinsy-cli/${this.version} (+https://kinsy.ai/docs/cli)` },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new KinsyError(`download failed (${reason})`, { status: 0, code: "network" });
    }
    if (!res.ok) {
      throw new KinsyError(`download failed with HTTP ${res.status}`, { status: res.status, code: codeFor(res.status) });
    }
    return new Uint8Array(await res.arrayBuffer());
  }
}
