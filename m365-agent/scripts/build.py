"""Builds the uploadable package: dist/kinsy-copilot-agent.zip.

    KINSY_OAUTH_REFERENCE_ID=<id from the Teams Developer Portal> python3 m365-agent/scripts/build.py

The reference id names the OAuth client registration that Microsoft's token
vault holds for this agent. It is not a secret, but it differs per
registration, so it is filled in here and never committed.
"""
import os
import pathlib
import re
import sys
import zipfile

HERE = pathlib.Path(__file__).resolve().parents[1]
SRC = HERE / "appPackage"
FILES = ["manifest.json", "declarativeAgent.json", "ai-plugin.json", "mcp-tools.json", "color.png", "outline.png"]
PLACEHOLDER = "${{KINSY_OAUTH_REFERENCE_ID}}"


def build(reference_id: str, out: pathlib.Path) -> pathlib.Path:
    if not re.fullmatch(r"[A-Za-z0-9+/=_-]{8,200}", reference_id or ""):
        raise SystemExit("KINSY_OAUTH_REFERENCE_ID is missing or is not a registration id")
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name in FILES:
            data = (SRC / name).read_bytes()
            if name == "ai-plugin.json":
                text = data.decode()
                if text.count(PLACEHOLDER) != 1:
                    raise SystemExit("ai-plugin.json must contain the reference id placeholder exactly once")
                data = text.replace(PLACEHOLDER, reference_id).encode()
            z.writestr(name, data)
    return out


if __name__ == "__main__":
    path = build(os.environ.get("KINSY_OAUTH_REFERENCE_ID", ""), HERE / "dist" / "kinsy-copilot-agent.zip")
    print(f"wrote {path.relative_to(HERE.parent)}", file=sys.stderr)
