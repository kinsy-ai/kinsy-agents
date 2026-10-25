// Exit codes are part of the CLI's contract with agents (documented in
// `kinsy --help` and the skill):
//   0 ok · 1 unexpected error · 2 not signed in / key refused · 3 not enough
//   credits (the checkout link is printed) · 4 bad input or not found ·
//   5 rate limited (retry after N seconds) · 6 the deck failed or the wait
//   timed out · 7 the server could not be reached or answered 5xx.
import { KinsyError } from "./client.js";

export const EXIT = {
  OK: 0,
  ERROR: 1,
  AUTH: 2,
  CREDITS: 3,
  INPUT: 4,
  RATE_LIMITED: 5,
  FAILED: 6,
  UNAVAILABLE: 7,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

const INPUT_STATUSES = new Set([400, 403, 404, 409, 413, 415, 422]);

export function exitCodeFor(err: unknown): ExitCode {
  if (!(err instanceof KinsyError)) return EXIT.ERROR;
  if (err.code === "timeout" || err.code === "deck_failed") return EXIT.FAILED;
  if (err.code === "not_signed_in") return EXIT.AUTH;
  if (err.status === 0 || err.status >= 500) return EXIT.UNAVAILABLE;
  if (err.status === 401) return EXIT.AUTH;
  if (err.status === 402) return EXIT.CREDITS;
  if (err.status === 429) return EXIT.RATE_LIMITED;
  if (INPUT_STATUSES.has(err.status)) return EXIT.INPUT;
  return EXIT.ERROR;
}

export const EXIT_CODE_HELP = `Exit codes:
  0  done
  1  unexpected error
  2  not signed in, or the key was refused (run: kinsy login)
  3  not enough credits (the top-up link is printed; nothing was charged)
  4  bad input, or the deck was not found
  5  rate limited (retry after the printed number of seconds)
  6  the deck failed to build, or --wait timed out
  7  the server could not be reached or answered with an error`;
