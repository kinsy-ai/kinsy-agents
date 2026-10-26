"""A fake Kinsy /v1 for the MCP server tests, served through httpx.MockTransport.

Routes are keyed "METHOD /path"; a handler receives the request and the call
count for that route. Unknown routes answer with the API's 404 envelope.
"""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Callable

import httpx

GOOD = "ksy_live_" + "g" * 43
OTHER = "ksy_live_" + "o" * 43


def envelope(status: int, code: str, message: str, **extra) -> dict:
    return {"error": {"code": code, "message": message, "status": status,
                      "docs_url": f"https://kinsy.ai/docs/errors#{code}", **extra}}


ME = {"uid": "u1", "email": "u@example.com", "email_verified": True, "plan": "free",
      "credits": {"monthly_grant": 0, "period_used": 0, "period_remaining": 0, "extra": 100,
                  "total": 100, "resets_at": None, "degraded": False},
      "watermark": True, "target_max": 25, "client": "mcp",
      "key": {"key_id": "key_abc", "hint": "…gggg", "label": "laptop", "src": "web",
              "created_at": "2026-10-27T00:00:00+00:00", "last_used_at": None}}


def status(**over) -> dict:
    base = {"deck_id": "deck-1", "status": "running", "phase": "rendering", "progress": 0.4,
            "slides_rendered": 4, "slides_total": 10, "title": "Board update", "client": "mcp",
            "created_at": None, "updated_at": None, "error": None, "watermark": None,
            "artifacts": None, "slides": None, "quality": None}
    base.update(over)
    return base


DONE = status(status="done", phase="done", progress=1.0, slides_rendered=10, watermark=True,
              artifacts={"pptx": {"url": "https://storage.example/deck-1.pptx?sig=1",
                                  "filename": "board-update.pptx", "expires_at": "2026-10-27T13:00:00+00:00"},
                         "pdf": {"url": "https://storage.example/deck-1.pdf?sig=1",
                                 "filename": "board-update.pdf", "expires_at": "2026-10-27T13:00:00+00:00"}})


class FakeApi:
    def __init__(self, routes: dict[str, Callable[[httpx.Request, int], httpx.Response | dict | list]]):
        self.routes = {"GET /v1/me": self._me, **routes}
        self.calls: list[httpx.Request] = []
        self.counts: dict[str, int] = defaultdict(int)

    @staticmethod
    def _me(req: httpx.Request, n: int):
        if req.headers.get("authorization") in (f"Bearer {GOOD}", f"Bearer {OTHER}"):
            return ME
        return httpx.Response(401, json=envelope(401, "unauthorized", "invalid or revoked API key"))

    def handler(self, req: httpx.Request) -> httpx.Response:
        self.calls.append(req)
        key = f"{req.method} {req.url.path}"
        self.counts[key] += 1
        fn = self.routes.get(key)
        if fn is None:
            return httpx.Response(404, json=envelope(404, "not_found", f"no route {key}"))
        out = fn(req, self.counts[key])
        if isinstance(out, httpx.Response):
            return out
        return httpx.Response(200, json=out)

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)

    def bodies(self, key: str) -> list[dict]:
        method, path = key.split(" ", 1)
        return [json.loads(r.content) for r in self.calls
                if r.method == method and r.url.path == path and r.content]
