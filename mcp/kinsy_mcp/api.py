"""A small async client over the Kinsy /v1 API.

The MCP server never holds a credential of its own: each call is made with
the bearer the MCP client presented, so the API enforces ownership, credits
and rate limits exactly as it does for the CLI. Errors come back as ApiError
carrying the API's envelope (code, message, checkout link, retry hint).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from kinsy_mcp import __version__

DEFAULT_TIMEOUT = httpx.Timeout(60.0, connect=10.0)
# A slide edit re-renders the slide and can make a picture: give it room.
EDIT_TIMEOUT = httpx.Timeout(180.0, connect=10.0)

_CODES = {
    400: "bad_request", 401: "unauthorized", 402: "insufficient_credits", 403: "forbidden",
    404: "not_found", 409: "conflict", 413: "too_large", 415: "unsupported_media_type",
    422: "validation_error", 429: "rate_limited", 503: "unavailable",
}


@dataclass
class ApiError(Exception):
    status: int
    code: str
    message: str
    checkout_url: str | None = None
    retry_after: int | None = None

    def __str__(self) -> str:  # pragma: no cover - debugging aid
        return f"{self.status} {self.code}: {self.message}"


def _error_from(res: httpx.Response) -> ApiError:
    try:
        body = res.json()
    except ValueError:
        body = None
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        e = body["error"]
        return ApiError(
            status=res.status_code,
            code=str(e.get("code") or _CODES.get(res.status_code, "error")),
            message=str(e.get("message") or f"HTTP {res.status_code}"),
            checkout_url=e.get("checkout_url") if isinstance(e.get("checkout_url"), str) else None,
            retry_after=e.get("retry_after") if isinstance(e.get("retry_after"), int) else None,
        )
    if isinstance(body, dict) and isinstance(body.get("detail"), str):
        return ApiError(res.status_code, _CODES.get(res.status_code, "error"), body["detail"])
    code = _CODES.get(res.status_code, "server_error" if res.status_code >= 500 else "error")
    return ApiError(res.status_code, code, f"the Kinsy API answered HTTP {res.status_code}")


class KinsyApi:
    """One instance per server; the bearer is passed per call."""

    def __init__(self, base_url: str, *, transport: httpx.AsyncBaseTransport | None = None):
        self.base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self.base_url, transport=transport, timeout=DEFAULT_TIMEOUT,
            follow_redirects=False,
            headers={"User-Agent": f"kinsy-mcp/{__version__}", "X-Kinsy-Client": "mcp",
                     "Accept": "application/json"},
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def request(self, method: str, path: str, token: str | None, *,
                      json: Any = None, params: dict | None = None,
                      headers: dict | None = None, timeout: httpx.Timeout | None = None) -> Any:
        h = dict(headers or {})
        if token:
            h["Authorization"] = f"Bearer {token}"
        try:
            res = await self._client.request(method, path, json=json, params=params, headers=h,
                                             timeout=timeout or DEFAULT_TIMEOUT)
        except httpx.HTTPError:
            raise ApiError(0, "network", "Kinsy could not be reached just now") from None
        if res.status_code >= 400 or res.status_code in (301, 302, 303, 307, 308):
            raise _error_from(res)
        return res.json() if res.content else None

    # ---- the calls the tools make -----------------------------------------
    async def me(self, token: str) -> dict:
        return await self.request("GET", "/v1/me", token)

    async def create_deck(self, token: str, body: dict, idempotency_key: str | None) -> dict:
        headers = {"Idempotency-Key": idempotency_key} if idempotency_key else None
        return await self.request("POST", "/v1/decks", token, json=body, headers=headers)

    async def deck(self, token: str, deck_id: str, include: str = "") -> dict:
        params = {"include": include} if include else None
        return await self.request("GET", f"/v1/decks/{deck_id}", token, params=params)

    async def file_link(self, token: str, deck_id: str, kind: str) -> dict:
        return await self.request("GET", f"/v1/decks/{deck_id}/files/{kind}", token,
                                  params={"redirect": "false"})

    async def edit(self, token: str, deck_id: str, slide: int, instruction: str) -> dict:
        return await self.request("POST", f"/v1/decks/{deck_id}/edits", token,
                                  json={"slide": slide, "instruction": instruction},
                                  timeout=EDIT_TIMEOUT)

    async def themes(self) -> list[dict]:
        return await self.request("GET", "/v1/themes", None)
