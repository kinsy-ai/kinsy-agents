"""Writes appPackage/mcp-tools.json: the four tools the Copilot agent pins,
taken from the MCP server's own tools/list so names and schemas cannot drift.

Run from the repo root with the MCP server's environment:
    mcp/.venv/bin/python m365-agent/scripts/gen_tools.py [--check]

Copilot honours only readOnlyHint, ignores description text past 1,024
characters, and must answer within nine seconds, so the tools that wait
(wait_for_deck, edit_slide) are not offered and descriptions that point at
them are reworded here.
"""
from __future__ import annotations

import asyncio
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "mcp"))

from mcp import Client  # noqa: E402

from kinsy_mcp.server import build_server  # noqa: E402

PINNED = ["create_deck", "get_deck", "export_deck", "list_themes"]
# Arguments left out of the pinned definitions (all optional on the server).
# idempotency_key: a model that reused one value would get the first deck back
# for a different request. The others steer the build in ways a chat should not.
HIDDEN = {
    "create_deck": {"idempotency_key", "skip_questions", "answers", "research"},
    "get_deck": {"include_previews", "include_quality"},
}
OUT = ROOT / "m365-agent" / "appPackage" / "mcp-tools.json"

# Wording for Copilot, where a build is started and checked on later.
DESCRIPTIONS = {
    "create_deck": (
        "Start building a finished, editable PowerPoint deck from a brief and, when the person has "
        "documents or data, their text as sources. Use when the person asks for a deck, a "
        "presentation or slides. Answers at once with a deck_id; the deck itself takes one to two "
        "minutes, so tell the person and check on it with get_deck when they ask. Spends credits "
        "from the person's Kinsy account: 40 up to 10 slides, 60 up to 16, 90 up to 25, plus 10 for "
        "each generated picture. Ask before building."
    ),
    "get_deck": (
        "Check a deck by its deck_id: whether it is still building and how far along, or finished, "
        "with its title, slide count, a link to review and edit it on the web, and download links. "
        "Use when the person asks whether a deck is ready or wants its links. Reads only."
    ),
}


async def tools() -> list[dict]:
    server = build_server(api=None, token_provider=lambda: None)  # listing calls no API
    async with Client(server) as c:
        listed = {t.name: t for t in (await c.list_tools()).tools}
    out = []
    for name in PINNED:
        t = listed[name].model_dump(mode="json", by_alias=True, exclude_none=True)
        schema = t["inputSchema"]
        for arg in HIDDEN.get(name, ()):
            schema["properties"].pop(arg)
        entry = {
            "name": t["name"],
            "title": t.get("title") or t["name"],
            "description": DESCRIPTIONS.get(name, t["description"]),
            "inputSchema": schema,
            "annotations": {"readOnlyHint": bool(t.get("annotations", {}).get("readOnlyHint"))},
        }
        out.append(entry)
    return out


def main() -> int:
    text = json.dumps({"tools": asyncio.run(tools())}, indent=2, ensure_ascii=False) + "\n"
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text() != text:
            print("m365-agent/appPackage/mcp-tools.json is out of date; run gen_tools.py", file=sys.stderr)
            return 1
        return 0
    OUT.write_text(text)
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
