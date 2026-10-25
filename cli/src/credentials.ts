// Where the key lives: KINSY_API_KEY in the environment, else
// ~/.config/kinsy/credentials.json (0600, inside a 0700 directory).
// KINSY_API_BASE points the CLI at another server; KINSY_CONFIG_DIR moves
// the file (used by the tests). The key is never printed: see maskKey.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_API_BASE = "https://kinsy.ai";

export type Env = Record<string, string | undefined>;

export type Credentials = {
  apiKey: string | null;
  apiBase: string;
  source: "env" | "file" | "none";
  email?: string;
  keyHint?: string;
  savedAt?: string;
};

type Stored = { api_key?: string; email?: string; key_hint?: string; saved_at?: string };

export function configDir(env: Env = process.env): string {
  if (env.KINSY_CONFIG_DIR) return env.KINSY_CONFIG_DIR;
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "kinsy");
}

export function credentialsPath(env: Env = process.env): string {
  return path.join(configDir(env), "credentials.json");
}

export function apiBase(env: Env = process.env): string {
  return (env.KINSY_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, "");
}

function readStored(env: Env): Stored | null {
  try {
    const raw = fs.readFileSync(credentialsPath(env), "utf8");
    const parsed = JSON.parse(raw) as Stored;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function loadCredentials(env: Env = process.env): Credentials {
  const base = apiBase(env);
  if (env.KINSY_API_KEY) {
    return { apiKey: env.KINSY_API_KEY, apiBase: base, source: "env" };
  }
  const stored = readStored(env);
  if (stored?.api_key) {
    return {
      apiKey: stored.api_key,
      apiBase: base,
      source: "file",
      email: stored.email,
      keyHint: stored.key_hint,
      savedAt: stored.saved_at,
    };
  }
  return { apiKey: null, apiBase: base, source: "none" };
}

export function saveCredentials(
  c: { apiKey: string; email?: string; keyHint?: string },
  env: Env = process.env,
): string {
  const file = credentialsPath(env);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* best effort on filesystems without POSIX modes */
  }
  const body: Stored = {
    api_key: c.apiKey,
    email: c.email,
    key_hint: c.keyHint ?? maskKey(c.apiKey),
    saved_at: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* as above */
  }
  return file;
}

export function clearCredentials(env: Env = process.env): boolean {
  const file = credentialsPath(env);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

// "ksy_live_…wxyz": the prefix says what kind of token it is, the tail lets
// a person match it against Settings → API keys; nothing in between.
export function maskKey(key: string): string {
  if (!key || key.length < 16) return "…";
  const m = /^(ksy_[a-z]+_)/.exec(key);
  return `${m ? m[1] : ""}…${key.slice(-4)}`;
}
