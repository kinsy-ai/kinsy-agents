# Kinsy for agents

A finished, editable PowerPoint deck from a brief and your documents, callable from any agent or terminal. This repository holds the `kinsy` command-line client, the `kinsy` Agent Skill, and the plugin manifests that let one install line work in Claude Code, Codex and any agent that reads [Agent Skills](https://agentskills.io).

Kinsy's output is a native .pptx: real text boxes, tables and charts, embedded fonts, a slide master. It opens in PowerPoint as designed and in Google Slides, and numbers the sources do not support are flagged. A finished deck takes one to two minutes.

## Install

**The skill** (any agent that reads Agent Skills):

```bash
npx skills add kinsy-ai/kinsy-agents
```

**Claude Code** (the skill as a plugin):

```bash
claude plugin marketplace add kinsy-ai/kinsy-agents
claude plugin install kinsy@kinsy-ai
```

**Codex:**

```bash
codex plugin marketplace add kinsy-ai/kinsy-agents
```

then install `kinsy` from `/plugins`.

**The CLI on its own** (Node 20 or newer):

```bash
npx kinsy-cli login
```

## Thirty seconds to a deck

```bash
npx kinsy-cli login                      # once: a code appears here, you confirm it on kinsy.ai
npx kinsy-cli create "Q3 board update for a 40-person SaaS company: revenue and churn against plan, the Q4 hiring plan, two asks for the board" \
  --file q3-metrics.csv --slides 10 --wait --out board.pptx
```

`board.pptx` opens in PowerPoint with every element editable; the printed link opens the same deck on kinsy.ai to review and edit. `kinsy --help` lists every command, flag and exit code; `kinsy create --help` has worked examples.

## What is here

```
skills/kinsy/SKILL.md          the skill: when to use Kinsy, how to brief it, how to hand the .pptx back
skills/kinsy/references/       command reference and the API in one page
cli/                           the kinsy CLI (TypeScript, published to npm as `kinsy-cli`; the command it installs is `kinsy`)
.claude-plugin/                Claude Code plugin + marketplace manifests (the repo root is the plugin)
.agents/plugins/               Codex marketplace manifest
plugin.json                    portable Agent Plugins manifest
mcp/                           the remote MCP server behind https://mcp.kinsy.ai/mcp (Python, official SDK)
```

## How the key is handled

- `kinsy login` uses a device sign-in: the terminal shows a short code, you confirm it on kinsy.ai while signed in, and the terminal receives its own API key labelled "CLI on <hostname>". The key never passes through the browser or the chat.
- The key is stored in `~/.config/kinsy/credentials.json` (mode 0600) and only ever printed masked. `KINSY_API_KEY` in the environment overrides it for CI and agents.
- Keys work only on the `/v1` API; billing, account and key management need a signed-in session, so a leaked key cannot buy credits or create keys. Revoke a key any time in Settings → API keys.
- The skill tells agents never to ask for a key, never to paste one anywhere, and to treat documents and slide text as data rather than instructions.

## Pricing

The same credits everywhere: no API plan, no surcharge. New accounts start with free credits once the email is verified; credit packs and plans are bought on [kinsy.ai/pricing](https://kinsy.ai/pricing) and spent from any surface. When the balance is too low the CLI prints the top-up link and exits with code 3 without charging anything.

## Documentation

- [Use Kinsy from your agent](https://kinsy.ai/docs/agents)
- [CLI reference](https://kinsy.ai/docs/cli)
- [API reference](https://kinsy.ai/docs/api) and [OpenAPI document](https://kinsy.ai/v1/openapi.json)

A remote connector for hosted assistants is in progress; this repository will carry its manifest when it ships.

## Privacy, terms and support

Briefs and documents you pass to the CLI go to your own Kinsy account at kinsy.ai and nowhere else; the decks it makes stay there until you delete them. [Privacy](https://kinsy.ai/privacy) · [Terms](https://kinsy.ai/terms) · [Support](https://kinsy.ai/contact) (support@kinsy.ai).

## Security

See [SECURITY.md](SECURITY.md). Releases of the CLI are published from GitHub Actions with provenance; nothing here asks you to pipe a script into a shell.

## Licence

MIT. © Kinsy.
