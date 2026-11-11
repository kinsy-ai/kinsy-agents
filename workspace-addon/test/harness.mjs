// Loads the Apps Script sources into one vm context with fakes for the
// Apps Script services, so the server side of the add-on runs under Node.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCES = ["Config.js", "Auth.js", "Api.js", "Drive.js", "Code.js"];
export const SCRIPT_ID = "SCRIPT123";

export function response(status, body = "", headers = {}) {
  const text = typeof body === "string" ? body : Buffer.isBuffer(body) ? "" : JSON.stringify(body);
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(text);
  return {
    getResponseCode: () => status,
    getContentText: () => text,
    getContent: () => Array.from(bytes),
    getHeaders: () => headers,
  };
}

function store(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getProperty: (k) => (k in data ? data[k] : null),
    setProperty: (k, v) => { data[k] = String(v); },
    deleteProperty: (k) => { delete data[k]; },
  };
}

// opts.host: "slides" | "docs"; opts.fetch: (url, params) => response
export function load(opts = {}) {
  const host = opts.host ?? "slides";
  const props = store(opts.props);
  const cache = {};
  const calls = [];
  const lock = { held: false, taken: 0, busy: false };
  const menu = { items: [], added: false };
  const shown = [];
  const ui = {
    createAddonMenu: () => ({
      addItem(label, fn) { menu.items.push([label, fn]); return this; },
      addToUi() { menu.added = true; },
    }),
    showSidebar: (html) => shown.push(html),
  };
  const wrongHost = (name) => () => { throw new Error(`Cannot call ${name} from this context.`); };
  const htmlOut = (content) => ({
    content,
    title: "",
    setTitle(t) { this.title = t; return this; },
    getContent() { return this.content; },
  });

  const ctx = {
    console,
    JSON,
    UrlFetchApp: {
      fetch(url, params = {}) {
        calls.push({ url, params });
        if (!opts.fetch) throw new Error(`unexpected fetch ${url}`);
        return opts.fetch(url, params, calls.length);
      },
    },
    PropertiesService: { getUserProperties: () => props },
    CacheService: {
      getUserCache: () => ({
        put: (k, v) => { cache[k] = v; },
        get: (k) => (k in cache ? cache[k] : null),
        remove: (k) => { delete cache[k]; },
      }),
    },
    LockService: {
      getUserLock: () => ({
        waitLock() { if (lock.busy) throw new Error("lock timeout"); lock.held = true; lock.taken += 1; },
        tryLock() { if (lock.busy) return false; lock.held = true; lock.taken += 1; return true; },
        releaseLock() { lock.held = false; },
      }),
    },
    ScriptApp: {
      getScriptId: () => SCRIPT_ID,
      getOAuthToken: () => "ya29.google-token",
      newStateToken() {
        const t = { method: "", args: {}, timeout: 0 };
        return {
          withMethod(m) { t.method = m; return this; },
          withArgument(k, v) { t.args[k] = v; return this; },
          withTimeout(s) { t.timeout = s; return this; },
          createToken: () => "state." + Buffer.from(JSON.stringify(t)).toString("base64url"),
        };
      },
    },
    Utilities: {
      getUuid: () => randomUUID(),
      DigestAlgorithm: { SHA_256: "SHA_256" },
      Charset: { US_ASCII: "US_ASCII" },
      computeDigest: (_alg, text) => Array.from(createHash("sha256").update(text).digest()).map((b) => (b > 127 ? b - 256 : b)),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes.map((b) => (b + 256) % 256)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
    },
    HtmlService: {
      createHtmlOutput: (s) => htmlOut(s),
      createHtmlOutputFromFile: (name) => htmlOut(readFileSync(join(ROOT, `${name}.html`), "utf8")),
      createTemplateFromFile: (name) => {
        const tpl = { source: readFileSync(join(ROOT, `${name}.html`), "utf8") };
        tpl.evaluate = () => htmlOut(tpl.source.replace(/<\?= (\w+) \?>/g, (_m, k) => String(tpl[k] ?? "")));
        return tpl;
      },
    },
    SlidesApp: host === "slides"
      ? { getUi: () => ui, getActivePresentation: () => ({ getName: () => "My slides" }) }
      : { getUi: wrongHost("SlidesApp.getUi()"), getActivePresentation: wrongHost("SlidesApp.getActivePresentation()") },
    DocumentApp: host === "docs"
      ? {
          getUi: () => ui,
          getActiveDocument: () => ({
            getName: () => opts.docName ?? "Q3 board notes",
            getBody: () => ({ getText: () => opts.docText ?? "Revenue grew 12% in Q3." }),
          }),
        }
      : { getUi: wrongHost("DocumentApp.getUi()"), getActiveDocument: wrongHost("DocumentApp.getActiveDocument()") },
  };
  vm.createContext(ctx);
  for (const f of SOURCES) vm.runInContext(readFileSync(join(ROOT, f), "utf8"), ctx, { filename: f });
  return { ctx, props, cache, calls, lock, menu, shown };
}

// Plain copy of a value made inside the vm (other-realm prototypes).
export const plain = (v) => JSON.parse(JSON.stringify(v));

export function stateArgs(state) {
  return JSON.parse(Buffer.from(state.replace(/^state\./, ""), "base64url").toString());
}
