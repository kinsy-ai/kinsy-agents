import { KinsyClient, KinsyError } from "./client.js";
import type { DeckStatus } from "./types.js";

export type WaitOpts = {
  intervalMs: number;
  timeoutMs: number;
  sleep: (ms: number) => Promise<void>;
  onProgress?: (status: DeckStatus) => void;
  now?: () => number;
};

export const DEFAULT_INTERVAL_MS = 3000;
export const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

// Poll GET /v1/decks/{id} until the deck is done or failed. The API never
// waits on our behalf (one cheap read per poll), so the waiting lives here.
export async function waitForDeck(client: KinsyClient, deckId: string, opts: WaitOpts): Promise<DeckStatus> {
  const now = opts.now ?? Date.now;
  const started = now();
  for (;;) {
    const status = await client.request<DeckStatus>("GET", `/v1/decks/${encodeURIComponent(deckId)}`);
    opts.onProgress?.(status);
    if (status.status === "done" || status.status === "error") return status;
    if (now() - started > opts.timeoutMs) {
      throw new KinsyError(
        `still running after ${Math.round(opts.timeoutMs / 1000)} s; check later with: kinsy status ${deckId}`,
        { status: 0, code: "timeout" },
      );
    }
    await opts.sleep(opts.intervalMs);
  }
}

export function progressLine(s: DeckStatus): string {
  const pct = Math.round((s.progress ?? 0) * 100);
  return `${s.phase ?? s.status} · ${s.slides_rendered}/${s.slides_total ?? "?"} slides · ${pct}%`;
}

// Prints each distinct progress line once, on stderr, so stdout stays clean
// for --json and for piping.
export function progressReporter(stderr: (line: string) => void): (s: DeckStatus) => void {
  let last = "";
  return (s) => {
    const line = progressLine(s);
    if (line !== last) {
      stderr(line);
      last = line;
    }
  };
}
