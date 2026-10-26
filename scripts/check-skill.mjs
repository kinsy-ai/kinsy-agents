#!/usr/bin/env node
// Keeps the skill honest and portable:
//   - skills/kinsy/SKILL.md exists, ≤ 150 lines, frontmatter limited to the
//     six portable fields, name == directory, description ≤ 1024 chars
//   - no `curl … | sh`, no key-shaped strings, no vendor or model names in
//     the skill, its references or the README (the names of agents a user
//     brings — Claude Code, Codex, Cursor, Copilot — are allowed as those
//     product phrases only)
//   - the Claude, Codex and portable manifests agree on the plugin name
// Exit 1 with every failure listed.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_DIR = path.join(ROOT, "skills", "kinsy");
const SKILL = path.join(SKILL_DIR, "SKILL.md");
const MAX_LINES = 150;
const PORTABLE_KEYS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
// Agents a user brings, plus their own command and directory names
// (`claude plugin …`, `.claude-plugin/`): product phrases, not the models behind Kinsy.
const HOST_AGENTS = /\.claude-plugin|\bclaude plugin\b|\bcodex plugin\b|\b(Claude Code|Claude Desktop|Claude\.ai|Codex CLI|Codex|Cursor|GitHub Copilot|Copilot CLI|Copilot|Gemini CLI|Antigravity)\b/g;
const VENDOR = /\b(sonnet|haiku|opus|fable|mythos|claude|anthropic|openai|gpt-?\w*|dall-?e|perplexity|libreoffice|gemini)\b/i;
const CURL_SH = /curl[^\n]*\|\s*(ba|z)?sh\b/i;
const KEY_SHAPED = /ksy_[a-z]+_[A-Za-z0-9_-]{8,}/;

const failures = [];
const fail = (msg) => failures.push(msg);

function scanCopy(file) {
  const text = readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file);
  text.split("\n").forEach((line, i) => {
    const stripped = line.replace(HOST_AGENTS, "");
    if (VENDOR.test(stripped)) fail(`${rel}:${i + 1}: names a vendor or model: ${line.trim().slice(0, 90)}`);
    if (CURL_SH.test(line)) fail(`${rel}:${i + 1}: pipes curl into a shell`);
    if (KEY_SHAPED.test(line)) fail(`${rel}:${i + 1}: contains a key-shaped string`);
  });
  return text;
}

if (!existsSync(SKILL)) {
  fail("skills/kinsy/SKILL.md missing");
} else {
  const text = scanCopy(SKILL);
  const lines = text.split("\n");
  if (lines.length > MAX_LINES) fail(`SKILL.md is ${lines.length} lines; the cap is ${MAX_LINES}`);
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) fail("SKILL.md has no frontmatter");
  else {
    const keys = m[1].split("\n").filter((l) => /^[A-Za-z-]+:/.test(l)).map((l) => l.split(":")[0]);
    for (const k of keys) if (!PORTABLE_KEYS.has(k)) fail(`frontmatter key "${k}" is not one of the six portable fields`);
    const name = (m[1].match(/^name:\s*(.+)$/m) ?? [])[1]?.trim();
    const description = (m[1].match(/^description:\s*(.+)$/m) ?? [])[1]?.trim();
    if (name !== path.basename(SKILL_DIR)) fail(`frontmatter name "${name}" must equal the directory name "${path.basename(SKILL_DIR)}"`);
    if (name && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) fail(`name "${name}" must be lowercase letters, digits and single hyphens`);
    if (!description) fail("frontmatter description missing");
    else if (description.length > 1024) fail(`description is ${description.length} chars; the cap is 1024`);
    const body = text.slice(m[0].length);
    if (!/kinsy(-cli)? login/.test(body)) fail("SKILL.md never tells the agent how the user signs in (kinsy login)");
    if (!/checkout_url/.test(body)) fail("SKILL.md never says what to do on exit 3 (show checkout_url and stop)");
  }
  const refs = path.join(SKILL_DIR, "references");
  if (existsSync(refs)) for (const f of readdirSync(refs)) if (f.endsWith(".md")) scanCopy(path.join(refs, f));
}

for (const f of ["README.md", "SECURITY.md", "cli/README.md"]) {
  const p = path.join(ROOT, f);
  if (existsSync(p)) scanCopy(p);
  else fail(`${f} missing`);
}

function readJson(rel) {
  const p = path.join(ROOT, rel);
  if (!existsSync(p)) {
    fail(`${rel} missing`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    fail(`${rel}: ${e.message}`);
    return null;
  }
}

const claude = readJson(".claude-plugin/plugin.json");
const market = readJson(".claude-plugin/marketplace.json");
const codex = readJson(".agents/plugins/marketplace.json");
const portable = readJson("plugin.json");
if (claude && claude.name !== "kinsy") fail(`.claude-plugin/plugin.json name is "${claude.name}", expected "kinsy"`);
if (market) {
  const entry = (market.plugins ?? []).find((p) => p.name === "kinsy");
  if (!entry) fail(".claude-plugin/marketplace.json has no plugin named kinsy");
  else if (entry.source !== ".") fail(`marketplace plugin source is "${entry.source}", expected "." (the repo root is the plugin)`);
  if (market.name !== "kinsy-ai") fail(`marketplace name is "${market.name}", expected "kinsy-ai"`);
}
if (codex && !(codex.plugins ?? []).some((p) => p.name === "kinsy")) fail(".agents/plugins/marketplace.json has no plugin named kinsy");
if (portable) {
  if (portable.name !== "kinsy") fail(`plugin.json name is "${portable.name}", expected "kinsy"`);
  if (!String(portable.$schema ?? "").startsWith("https://agent-plugins.org/schemas/")) fail("plugin.json $schema is not the agent-plugins schema");
  if (claude && portable.version !== claude.version) fail(`plugin.json version ${portable.version} differs from .claude-plugin/plugin.json ${claude.version}`);
}
if (existsSync(path.join(ROOT, ".mcp.json"))) fail(".mcp.json present: the remote server ships in a later release; a dead entry fails every session");

if (failures.length) {
  console.error(`check-skill: ${failures.length} problem(s)`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("check-skill: ok");
