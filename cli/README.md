# kinsy

A finished, editable PowerPoint deck from a brief and your documents, from the command line. Thin client over the [Kinsy API](https://kinsy.ai/docs); Node 20 or newer.

```bash
npm install -g kinsy-cli        # or run every command through: npx kinsy-cli …
kinsy login                 # once: a code appears here, you confirm it on kinsy.ai
kinsy create "Q3 board update for a 40-person SaaS company: revenue and churn against plan, the Q4 hiring plan, two asks for the board" \
  --file q3-metrics.csv --slides 10 --out board.pptx
```

One to two minutes later `board.pptx` is on disk: it opens in PowerPoint as designed and every element is editable. The printed link opens the same deck on kinsy.ai to review and edit.

| Command | What it does |
|---|---|
| `kinsy login [--key …] [--no-browser]` | Sign in once; the terminal gets its own revocable key. |
| `kinsy create [brief] [--file …] [--slides N] [--wait] [--out deck.pptx] [--json]` | Start a deck; `--out` waits for it and saves the .pptx. |
| `kinsy status <id> [--watch]` | Queued, running (with progress), done or error. |
| `kinsy get <id> [--pptx\|--pdf\|--png] [--out …]` | Download a finished deck. |
| `kinsy edit <id> --slide N "<instruction>"` | Change one slide. |
| `kinsy me` · `kinsy themes` · `kinsy logout` | Account, catalogue, sign out. |

Every command takes `--json`. Exit codes: 0 done · 2 not signed in · 3 not enough credits (the top-up link is printed; nothing charged) · 4 bad input · 5 rate limited · 6 the deck failed · 7 server unreachable. `kinsy --help` has the full list.

Credentials live in `~/.config/kinsy/credentials.json` (readable by you only) or `KINSY_API_KEY`; the key is only ever shown masked. Same credits as the web app, no API plan. Docs: [kinsy.ai/docs/cli](https://kinsy.ai/docs/cli) · for agents: [kinsy.ai/docs/agents](https://kinsy.ai/docs/agents) · source and skill: [github.com/kinsy-ai/kinsy-agents](https://github.com/kinsy-ai/kinsy-agents). MIT, © Kinsy.
