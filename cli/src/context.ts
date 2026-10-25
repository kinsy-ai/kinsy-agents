// Everything a command needs from the outside world, so tests can swap the
// clock, the browser, the output and the config directory.
import { spawn } from "node:child_process";
import os from "node:os";
import { KinsyClient, KinsyError } from "./client.js";
import { loadCredentials, type Env } from "./credentials.js";
import { processIO, type IO } from "./output.js";
import { VERSION } from "./version.js";

export type Ctx = {
  env: Env;
  io: IO;
  version: string;
  sleep: (ms: number) => Promise<void>;
  openBrowser: (url: string) => Promise<boolean>;
  isTTY: boolean;
  hostname: string;
  fetch?: typeof fetch;
};

export function openBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const [cmd, args] =
      process.platform === "darwin"
        ? ["open", [url]]
        : process.platform === "win32"
          ? ["cmd", ["/c", "start", "", url]]
          : ["xdg-open", [url]];
    try {
      const child = spawn(cmd, args, { stdio: "ignore", detached: true });
      child.on("error", () => resolve(false));
      child.on("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

export function defaultCtx(): Ctx {
  return {
    env: process.env,
    io: processIO,
    version: VERSION,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    openBrowser,
    isTTY: Boolean(process.stdout.isTTY && process.stderr.isTTY),
    hostname: os.hostname(),
  };
}

export function clientFor(ctx: Ctx, apiKey: string | null | undefined): KinsyClient {
  return new KinsyClient({
    apiBase: loadCredentials(ctx.env).apiBase,
    apiKey: apiKey ?? null,
    version: ctx.version,
    fetch: ctx.fetch,
  });
}

// The catalogues and the device flow need no key.
export function publicClient(ctx: Ctx): KinsyClient {
  return clientFor(ctx, null);
}

export function requireClient(ctx: Ctx): KinsyClient {
  const creds = loadCredentials(ctx.env);
  if (!creds.apiKey) {
    throw new KinsyError("You are not signed in.", { status: 401, code: "not_signed_in" });
  }
  return clientFor(ctx, creds.apiKey);
}
