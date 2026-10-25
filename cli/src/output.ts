// One place decides how a failure reaches the person or the agent: a short
// sentence (plus a hint) on stderr, or the API's envelope as JSON on stdout
// when --json was asked for. Returns the exit code to use.
import { KinsyError } from "./client.js";
import { EXIT, exitCodeFor } from "./exit.js";

export type IO = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export const processIO: IO = {
  stdout: (line) => process.stdout.write(line + "\n"),
  stderr: (line) => process.stderr.write(line + "\n"),
};

export function hintFor(err: KinsyError): string | null {
  const code = exitCodeFor(err);
  if (code === EXIT.AUTH) return "Sign in with: kinsy login";
  if (code === EXIT.CREDITS && err.checkoutUrl) return `Top up at ${err.checkoutUrl} — nothing was charged.`;
  if (code === EXIT.RATE_LIMITED) return `Retry in ${err.retryAfter ?? 60} seconds.`;
  if (code === EXIT.UNAVAILABLE && err.status === 0) return "Check your connection (or KINSY_API_BASE) and try again.";
  if (code === EXIT.UNAVAILABLE) return "The server is having trouble; try again in a minute.";
  if (err.docsUrl) return `More: ${err.docsUrl}`;
  return null;
}

export function printError(err: unknown, opts: { json: boolean }, io: IO): number {
  const code = exitCodeFor(err);
  if (err instanceof KinsyError) {
    if (opts.json) {
      io.stdout(JSON.stringify({ error: err.toJSON() }));
    } else {
      io.stderr(`kinsy: ${err.message}`);
      const hint = hintFor(err);
      if (hint) io.stderr(hint);
    }
    return code;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (opts.json) {
    io.stdout(JSON.stringify({ error: { code: "error", message, status: 0 } }));
  } else {
    io.stderr(`kinsy: ${message}`);
  }
  return code;
}

export function printJson(value: unknown, io: IO): void {
  io.stdout(JSON.stringify(value));
}
