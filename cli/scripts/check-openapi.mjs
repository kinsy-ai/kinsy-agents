#!/usr/bin/env node
// Checks the hand-written types in src/types.ts against the live OpenAPI
// document: every path the CLI calls exists and every field it reads is
// declared. Run by hand or on a schedule, not in the unit tests (network).
//
//   node scripts/check-openapi.mjs [url-or-path]   (default https://kinsy.ai/v1/openapi.json)
import { readFileSync } from "node:fs";

const source = process.argv[2] ?? "https://kinsy.ai/v1/openapi.json";
const spec = /^https?:/.test(source)
  ? await (await fetch(source)).json()
  : JSON.parse(readFileSync(source, "utf8"));

const PATHS = {
  "POST /v1/decks": "DeckCreateResponse",
  "GET /v1/decks/{deck_id}": "DeckStatus",
  "GET /v1/decks/{deck_id}/files/{kind}": "FileLink",
  "POST /v1/decks/{deck_id}/edits": "EditResponse",
  "POST /v1/files": "FileResponse",
  "GET /v1/me": "MeResponse",
  "GET /v1/themes": null,
  "POST /v1/auth/device": "DeviceStartResponse",
  "POST /v1/auth/device/token": "DeviceTokenResponse",
};

const FIELDS = {
  DeckCreateResponse: ["deck_id", "status_url", "credits_charged"],
  DeckStatus: ["deck_id", "status", "phase", "progress", "slides_rendered", "slides_total", "title", "error", "artifacts"],
  FileLink: ["url", "filename", "expires_at"],
  EditResponse: ["deck_id", "slide", "clarify", "layout_changed", "credits_charged"],
  FileResponse: ["name", "char_count", "truncated", "text"],
  MeResponse: ["email", "plan", "credits", "watermark", "key"],
  DeviceStartResponse: ["device_code", "user_code", "verification_uri", "verification_uri_complete", "expires_in", "interval"],
  DeviceTokenResponse: ["status", "interval", "api_key", "key_hint", "key_id", "email"],
  CreditBalance: ["total", "period_remaining", "extra"],
};

const problems = [];
for (const [op, schemaName] of Object.entries(PATHS)) {
  const [method, path] = op.split(" ");
  const operation = spec.paths?.[path]?.[method.toLowerCase()];
  if (!operation) {
    problems.push(`missing operation ${op}`);
    continue;
  }
  if (schemaName) {
    const ref = operation.responses?.["200"]?.content?.["application/json"]?.schema?.$ref
      ?? operation.responses?.["202"]?.content?.["application/json"]?.schema?.$ref;
    if (!ref || !ref.endsWith(`/${schemaName}`)) problems.push(`${op} does not answer with ${schemaName} (got ${ref ?? "nothing"})`);
  }
}
for (const [name, fields] of Object.entries(FIELDS)) {
  const props = spec.components?.schemas?.[name]?.properties;
  if (!props) {
    problems.push(`schema ${name} missing`);
    continue;
  }
  for (const f of fields) if (!(f in props)) problems.push(`${name}.${f} missing`);
}
if (problems.length) {
  console.error(`check-openapi: ${problems.length} problem(s) against ${source}`);
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log(`check-openapi: ok (${Object.keys(spec.paths).length} paths in ${source})`);
