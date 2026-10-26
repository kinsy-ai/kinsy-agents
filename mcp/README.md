# Kinsy MCP server

The remote [Model Context Protocol](https://modelcontextprotocol.io) server behind `https://mcp.kinsy.ai/mcp`. Hosted assistants and agents connect to it with a Kinsy API key and turn a brief and the user's source material into a finished, editable PowerPoint (.pptx) deck.

It is a thin client over the public [Kinsy API](https://kinsy.ai/docs): every call is made with the caller's own key, so credits, limits and deck ownership are enforced by the API exactly as for the CLI. The server stores nothing and holds no credentials of its own.

## Tools

| Tool | What it does | Changes anything? |
|---|---|---|
| `create_deck` | Starts a deck from a brief and optional sources (text). Answers at once with a `deck_id`. | Spends credits |
| `wait_for_deck` | Waits for a deck to finish (up to 540 s), streaming progress, then returns its links. | No |
| `get_deck` | Status and links; optionally slide image links and the claims the sources could not back. | No |
| `export_deck` | A fresh one-hour download link for the .pptx, PDF, or a zip of slide images. | No |
| `edit_slide` | Rewrites one slide from an instruction. | Spends credits |
| `list_themes` | The theme ids `create_deck` accepts. | No |

Results are a short sentence plus structured content. The server never echoes a brief or source text back, and never includes the key.

## Connect

Create a key in **Settings → API keys** on [kinsy.ai](https://kinsy.ai), then point your client at `https://mcp.kinsy.ai/mcp` with the header `Authorization: Bearer ksy_live_…`. Per-client instructions: [kinsy.ai/docs/mcp](https://kinsy.ai/docs/mcp).

## Develop

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.lock pytest
.venv/bin/python -m pytest
KINSY_MCP_SERVE=1 KINSY_API_BASE=https://kinsy.ai .venv/bin/uvicorn kinsy_mcp.server:app --port 8080
```

`requirements.in` lists the direct dependencies; `scripts/lock.sh` resolves the hash-pinned `requirements.lock` the image installs.

MIT. © Kinsy.
