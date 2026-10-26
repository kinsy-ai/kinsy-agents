#!/usr/bin/env node
// kinsy — a finished, editable PowerPoint deck from the command line.
// Thin client over https://kinsy.ai/v1; docs at https://kinsy.ai/docs/cli.
import { Command, InvalidArgumentError, Option } from "commander";
import { runCreate } from "./commands/create.js";
import { runEdit } from "./commands/edit.js";
import { runGet } from "./commands/get.js";
import { runStatus } from "./commands/status.js";
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

  const int = (what: string, min: number, max: number) => (value: string) => {
    const n = Number.parseInt(value, 10);
    if (!Number.isInteger(n) || n < min || n > max) throw new InvalidArgumentError(`${what} must be a whole number from ${min} to ${max}`);
    return n;
  };

  program
    .command("create")
    .description("Start a deck from a brief and/or documents; with --wait, stay until it is done and save the .pptx.")
    .argument("[brief]", "what the deck is about, who it is for, what it must cover (put it first, in quotes)")
    .option("-f, --file <path...>", "a document to build from: pdf, docx, pptx, xlsx, csv, md, txt or an image (repeatable)")
    .option("-n, --slides <n>", "how many slides, 4 to 25 (default: Kinsy decides, usually 10)", int("--slides", 4, 25))
    .option("--theme <id>", "a theme id from `kinsy themes`")
    .option("--template <id>", "a template id")
    .addOption(new Option("--research <mode>", "look things up on the web while planning").choices(["auto", "on", "off"]).default("auto"))
    .option("--no-intake", "skip the clarifying questions Kinsy would otherwise answer for itself")
    .option("-a, --answer <key=value...>", "answer a clarifying question up front, e.g. audience=\"the board\"")
    .option("-w, --wait", "stay until the deck is done (one to two minutes)")
    .option("-o, --out <path>", "save the .pptx here once the deck is done (implies --wait)")
    .option("--idempotency-key <key>", "safe retries: the same key within 24 h returns the first deck, charging nothing")
    .option("--json", "machine-readable output: one JSON object on stdout")
    .addHelpText(
      "after",
      `
Examples:
  kinsy create "Q3 board update for a 40-person SaaS company" --slides 10 --wait --out board.pptx
  kinsy create "Summarise this report for the leadership team" --file report.pdf --wait --out summary.pptx
  kinsy create "Lecture on the Krebs cycle for first-year students" -a audience="first-year medics" --json

Credits: 40 for up to 10 slides, 60 for 11 to 16, 90 for 17 to 25, plus 10 per picture.
Nothing is charged when there are not enough credits (exit 3; the top-up link is printed).`,
    )
    .action(
      async (
        brief: string | undefined,
        opts: {
          file?: string[]; slides?: number; theme?: string; template?: string; research?: "auto" | "on" | "off";
          intake?: boolean; answer?: string[]; wait?: boolean; out?: string; idempotencyKey?: string; json?: boolean;
        },
      ) =>
        done(
          await runCreate(
            {
              brief: brief ?? "",
              file: opts.file ?? [],
              slides: opts.slides,
              theme: opts.theme,
              template: opts.template,
              research: opts.research,
              intake: opts.intake !== false,
              answer: opts.answer ?? [],
              wait: Boolean(opts.wait),
              out: opts.out,
              idempotencyKey: opts.idempotencyKey,
              json: Boolean(opts.json),
            },
            ctx,
          ),
        ),
    );

  program
    .command("status")
    .description("Where a deck is: queued, running (with progress), done or error.")
    .argument("<deck_id>")
    .option("-w, --watch", "keep polling until it is done")
    .option("--json", "machine-readable output")
    .addHelpText("after", "\nExample:\n  kinsy status deck-7f3a1c --watch")
    .action(async (deckId: string, opts: { watch?: boolean; json?: boolean }) =>
      done(await runStatus({ deckId, watch: Boolean(opts.watch), json: Boolean(opts.json) }, ctx)),
    );

  program
    .command("get")
    .description("Download a finished deck: the .pptx (default), the PDF, or a zip of slide images.")
    .argument("<deck_id>")
    .option("--pptx", "the editable PowerPoint file (default)")
    .option("--pdf", "the PDF")
    .option("--png", "a zip of one image per slide")
    .option("-o, --out <path>", "where to save it (default: the deck's own filename in the current directory)")
    .option("--json", "machine-readable output")
    .addHelpText("after", "\nExamples:\n  kinsy get deck-7f3a1c --out board.pptx\n  kinsy get deck-7f3a1c --pdf")
    .action(async (deckId: string, opts: { pptx?: boolean; pdf?: boolean; png?: boolean; out?: string; json?: boolean }) => {
      const kind = opts.pdf ? "pdf" : opts.png ? "png" : "pptx";
      done(await runGet({ deckId, kind, out: opts.out, json: Boolean(opts.json) }, ctx));
    });

  program
    .command("edit")
    .description("Change one slide from an instruction (5 credits, plus 10 if it gets a new picture).")
    .argument("<deck_id>")
    .argument("<instruction>", "what to change, in quotes")
    .requiredOption("-s, --slide <n>", "the slide to change, counting from 1", int("--slide", 1, 51))
    .option("--json", "machine-readable output")
    .addHelpText("after", "\nExample:\n  kinsy edit deck-7f3a1c --slide 3 \"Tighten the headline and cut the bullets to three\"")
    .action(async (deckId: string, instruction: string, opts: { slide: number; json?: boolean }) =>
      done(await runEdit({ deckId, slide: opts.slide, instruction, json: Boolean(opts.json) }, ctx)),
    );

  return program;
}

const isMain = process.argv[1] && /(^|[\\/])(cli\.js|kinsy)$/.test(process.argv[1]);
if (isMain) {
  buildProgram().parseAsync(process.argv).catch((err: unknown) => {
    process.stderr.write(`kinsy: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
