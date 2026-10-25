// Shared test context: a temp config dir, captured output, no real sleeping
// and no real browser.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Ctx } from "../src/context.js";

export const KEY = "ksy_live_" + "a".repeat(39) + "wxyz";

export const ME = {
  uid: "u-dev",
  email: "dev@example.com",
  email_verified: true,
  plan: "free",
  credits: { monthly_grant: 0, period_used: 0, period_remaining: 0, extra: 100, total: 100, resets_at: null, degraded: false },
  watermark: true,
  target_max: 25,
  client: "cli",
  key: { key_id: "key_abc", hint: "…wxyz", label: "CLI on mbp.local", src: "cli", created_at: "2026-10-25T10:00:00+00:00", last_used_at: null },
};

export type TestCtx = Ctx & {
  out: string[];
  err: string[];
  sleeps: number[];
  opened: string[];
  all(): string;
};

export function makeCtx(apiBase: string, extraEnv: Record<string, string> = {}): TestCtx {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinsy-cli-"));
  const out: string[] = [];
  const err: string[] = [];
  const sleeps: number[] = [];
  const opened: string[] = [];
  return {
    env: { KINSY_CONFIG_DIR: path.join(dir, "kinsy"), KINSY_API_BASE: apiBase, ...extraEnv },
    io: { stdout: (l) => out.push(l), stderr: (l) => err.push(l) },
    version: "0.0.0-test",
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    openBrowser: async (url) => {
      opened.push(url);
      return true;
    },
    isTTY: true,
    hostname: "mbp.local",
    out,
    err,
    sleeps,
    opened,
    all: () => [...out, ...err].join("\n"),
  };
}
