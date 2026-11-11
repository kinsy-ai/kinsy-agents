# Kinsy for Microsoft 365 Copilot

A declarative agent for Microsoft 365 Copilot. It lets someone in Copilot describe a deck and get
a finished, editable PowerPoint file, built on their own Kinsy account through Kinsy's MCP server
(`https://mcp.kinsy.ai/mcp`).

## What is here

| Path | What it is |
| --- | --- |
| `appPackage/` | The package: app manifest (1.30), declarative agent (1.9), plugin manifest (2.4), the pinned tool definitions and two icons. |
| `instructions.md` | The agent's instructions (copied into `declarativeAgent.json`). |
| `scripts/make_package.py` | Source of the three manifests. Run it after editing it or `instructions.md`. |
| `scripts/gen_tools.py` | Writes `mcp-tools.json` from the MCP server's own tool list. |
| `scripts/build.py` | Zips the package with the OAuth registration id filled in. |
| `test/` | Checks against Microsoft's published schemas (vendored in `test/schemas/`) and the store's validation rules. |

## Why four tools

Copilot requires agents to answer within nine seconds, so the agent offers only the tools that
answer at once: `create_deck`, `get_deck`, `export_deck`, `list_themes`. It starts a build, says it
takes about two minutes, and gives the links when asked. Editing a slide is done on kinsy.ai.

## Sign-in

People sign in to Kinsy through Microsoft's token vault (authorization code with PKCE). The vault
holds a client id and secret registered at kinsy.ai; the registration's id goes into the package
at build time:

```sh
KINSY_OAUTH_REFERENCE_ID=<registration id> python3 m365-agent/scripts/build.py
# → m365-agent/dist/kinsy-copilot-agent.zip
```

## Test

```sh
mcp/.venv/bin/python -m pytest m365-agent/test
```

Builds use credits from the person's Kinsy account. Credits are sold by Kinsy, not by Microsoft.
