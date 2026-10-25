# `kinsy` command reference

Install: `npm install -g kinsy` (Node 20 or newer), or run every command through `npx kinsy …`. Full docs: https://kinsy.ai/docs/cli

## Signing in

| Command | What it does |
|---|---|
| `kinsy login` | Starts a device sign-in: prints a short code and opens https://kinsy.ai/cli-auth. The user confirms the code in the browser; the terminal receives its own API key, labelled "CLI on <hostname>". |
| `kinsy login --no-browser` | Same, without opening the browser; the link and code are printed for the user to open. |
| `kinsy login --key ksy_live_…` | Stores a key created in Settings → API keys after checking it works. |
| `kinsy logout` | Forgets the saved credentials on this machine. The key stays valid until revoked in Settings → API keys. |
| `kinsy me` | Who is signed in, the plan, the credit balance, whether new decks carry a watermark, and which key is in use. |

Credentials live in `~/.config/kinsy/credentials.json` (mode 0600 in a 0700 directory). `KINSY_API_KEY` in the environment overrides the file (CI, agents). `KINSY_API_BASE` points at another server. The key is only ever shown masked: `ksy_live_…wxyz`.

## Making decks

```
kinsy create [brief] [options]
```

| Option | Meaning |
|---|---|
| `[brief]` | What the deck is about, who it is for, what it must cover. Put it first, in quotes. Optional when `--file` is given. |
| `-f, --file <path...>` | Documents to build from: pdf, docx, pptx, xlsx, csv, md, txt or images. Repeatable. Each is extracted on the server and sent as a source. |
| `-n, --slides <n>` | 4 to 25. Omit to let Kinsy choose (usually 10). |
| `--theme <id>` | A theme id from `kinsy themes`. |
| `--template <id>` | A template id. |
| `--research <auto\|on\|off>` | Whether to look things up on the web while planning. Default `auto`. |
| `--no-intake` | Skip the clarifying questions Kinsy would otherwise answer for itself. |
| `-a, --answer <key=value...>` | Answer a clarifying question up front, e.g. `-a audience="the board"`. |
| `-w, --wait` | Stay until the deck is done (one to two minutes), printing progress on stderr. |
| `-o, --out <path>` | With `--wait`: save the .pptx here. |
| `--idempotency-key <key>` | Safe retries: the same key within 24 hours returns the first deck and charges nothing. |
| `--json` | One JSON object on stdout; everything else on stderr. |

Credits: 40 for up to 10 slides, 60 for 11 to 16, 90 for 17 to 25, plus 10 per picture the deck needs. Nothing is charged when the balance is too low (exit 3).

### Following, downloading, editing

| Command | What it does |
|---|---|
| `kinsy status <deck_id> [--watch] [--json]` | Queued, running (phase, slides rendered, percent), done or error. `--watch` keeps polling until done. Exit 6 when the deck failed. |
| `kinsy get <deck_id> [--pptx\|--pdf\|--png] [--out <path>] [--json]` | Downloads the finished deck: the editable .pptx (default), the PDF, or a zip of slide images. Links are fetched fresh each time. |
| `kinsy edit <deck_id> --slide <n> "<instruction>" [--json]` | Rewrites one slide (counting from 1). 5 credits, plus 10 if it gets a new picture. If the instruction is too vague, Kinsy prints a question instead and charges nothing. |
| `kinsy themes [--json]` | The theme ids you can pass to `--theme`. Needs no key. |

The web link for any deck is `https://kinsy.ai/deck/<deck_id>`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | done |
| 1 | unexpected error |
| 2 | not signed in, or the key was refused |
| 3 | not enough credits; the top-up link is printed and nothing was charged |
| 4 | bad input, or the deck was not found |
| 5 | rate limited; `retry_after` seconds are printed |
| 6 | the deck failed to build, or `--wait` timed out |
| 7 | the server could not be reached, or answered with an error |

With `--json`, an error is `{"error": {"code", "message", "status", "checkout_url"?, "retry_after"?, "docs_url"?}}` on stdout.

## Limits

15 decks a day and 40 edits, intake calls or file extractions an hour per account; 120 requests a minute per key; briefs up to 50,000 characters; up to 10 sources of 120,000 characters each; files up to 25 MB. Details: https://kinsy.ai/docs
