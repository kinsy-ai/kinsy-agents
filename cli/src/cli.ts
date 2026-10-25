#!/usr/bin/env node
// kinsy — a finished, editable PowerPoint deck from the command line.
// Thin client over https://kinsy.ai/v1; docs at https://kinsy.ai/docs/cli.
import { Command } from "commander";
import { runLogin } from "./commands/login.js";
import { runLogout } from "./commands/logout.js";
import { runMe } from "./commands/me.js";
import { runThemes } from "./commands/themes.js";
import { defaultCtx } from "./context.js";
import { EXIT_CODE_HELP } from "./exit.js";
import { VERSION } from "./version.js";

const ctx = defaultCtx();

function done(code: number): void {
  // Let stdout drain; the process ends on its own with this code.
  process.exitCode = code;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("kinsy")
    .description(
      "Kinsy from the command line: a finished, editable PowerPoint deck from a brief and your documents.\n" +
        "Docs: https://kinsy.ai/docs/cli",
    )
    .version(VERSION, "-V, --version")
    .showHelpAfterError()
    .addHelpText(
      "after",
      `
Start here:
  kinsy login                                     sign in once (opens your browser)
  kinsy create "Q3 board update" --file q3.pdf --slides 10 --wait --out board.pptx

${EXIT_CODE_HELP}

Environment:
  KINSY_API_KEY    use this key instead of the saved credentials (CI, agents)
  KINSY_API_BASE   talk to another server (default https://kinsy.ai)`,
    );

  program
    .command("login")
    .description("Sign in: opens kinsy.ai to approve this machine, or stores a key you pass with --key.")
    .option("--key <key>", "store an existing API key (ksy_live_…) instead of the browser flow")
    .option("--no-browser", "print the link instead of opening the browser")
    .option("--json", "machine-readable output")
    .addHelpText(
      "after",
      `
Examples:
  kinsy login                       browser flow: a code appears here, you confirm it on kinsy.ai
  kinsy login --no-browser          same, but you open the printed link yourself
  kinsy login --key ksy_live_…      store a key created in Settings → API keys`,
    )
    .action(async (opts: { key?: string; browser?: boolean; json?: boolean }) =>
      done(await runLogin({ key: opts.key, browser: opts.browser !== false, json: Boolean(opts.json) }, ctx)),
    );

  program
    .command("logout")
    .description("Forget the saved credentials on this machine (revoke the key itself in Settings).")
    .option("--json", "machine-readable output")
    .action(async (opts: { json?: boolean }) => done(await runLogout({ json: Boolean(opts.json) }, ctx)));

  program
    .command("me")
    .description("Who is signed in, the plan, the credit balance and whether new decks carry a watermark.")
    .option("--json", "print the account as the API returns it")
    .addHelpText("after", "\nExample:\n  kinsy me --json | jq .credits.total")
    .action(async (opts: { json?: boolean }) => done(await runMe({ json: Boolean(opts.json) }, ctx)));

  program
    .command("themes")
    .description("List the visual themes you can pass to create --theme.")
    .option("--json", "machine-readable output")
    .action(async (opts: { json?: boolean }) => done(await runThemes({ json: Boolean(opts.json) }, ctx)));

  return program;
}

const isMain = process.argv[1] && /(^|[\\/])(cli\.js|kinsy)$/.test(process.argv[1]);
if (isMain) {
  buildProgram().parseAsync(process.argv).catch((err: unknown) => {
    process.stderr.write(`kinsy: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
