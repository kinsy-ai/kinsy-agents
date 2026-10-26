"""The remote MCP server: transport auth, the six tools, and what never leaks."""

from __future__ import annotations

import json

import anyio
import httpx
import pytest

from mcp import Client

from kinsy_mcp import server as srv
from kinsy_mcp.api import KinsyApi
from tests.fake_api import DONE, GOOD, ME, OTHER, FakeApi, envelope, status

pytestmark = pytest.mark.anyio

ACCEPT = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
TOOLS = {"create_deck", "get_deck", "wait_for_deck", "export_deck", "edit_slide", "list_themes"}


@pytest.fixture
def anyio_backend():
    return "asyncio"


def build(fake: FakeApi, token: str | None = GOOD):
    api = KinsyApi("https://api.test", transport=fake.transport)
    return srv.build_server(api, token_provider=lambda: token)


def text_of(result) -> str:
    return "\n".join(getattr(c, "text", "") or getattr(c, "uri", "") for c in result.content)


# ---------------------------------------------------------------------------
# Transport: authentication happens before any tool runs
# ---------------------------------------------------------------------------
async def _http(fake: FakeApi, auth: str | None, body: dict) -> httpx.Response:
    api = KinsyApi("https://api.test", transport=fake.transport)
    app = srv.create_app(api)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                     base_url="https://mcp.kinsy.ai") as h:
            headers = dict(ACCEPT)
            if auth:
                headers["Authorization"] = auth
            return await h.post("/mcp", headers=headers, json=body)


LIST = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}


def rpc(res: httpx.Response) -> dict:
    """The JSON-RPC response in a reply, whether sent as JSON or as an event stream."""
    if res.headers.get("content-type", "").startswith("application/json"):
        return res.json()
    msgs = [json.loads(line[5:]) for line in res.text.splitlines() if line.startswith("data:") and line[5:].strip()]
    return [m for m in msgs if "result" in m or "error" in m][-1]


async def test_no_bearer_is_401_with_resource_metadata():
    res = await _http(FakeApi({}), None, LIST)
    assert res.status_code == 401
    assert 'resource_metadata="https://mcp.kinsy.ai/.well-known/oauth-protected-resource/mcp"' in res.headers["www-authenticate"]


async def test_refused_key_is_401_and_a_non_kinsy_token_never_reaches_the_api():
    fake = FakeApi({})
    assert (await _http(fake, "Bearer ksy_live_" + "x" * 43, LIST)).status_code == 401
    assert fake.counts["GET /v1/me"] == 1
    assert (await _http(fake, "Bearer eyJhbGciOi.not.ours", LIST)).status_code == 401
    assert fake.counts["GET /v1/me"] == 1


async def test_good_key_lists_six_tools_over_http():
    res = await _http(FakeApi({}), f"Bearer {GOOD}", LIST)
    assert res.status_code == 200, res.text
    names = {t["name"] for t in rpc(res)["result"]["tools"]}
    assert names == TOOLS


async def test_tool_call_over_http_forwards_the_callers_own_key():
    fake = FakeApi({"GET /v1/decks/deck-1": lambda r, n: status()})
    call = {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": {"name": "get_deck", "arguments": {"deck_id": "deck-1"}}}
    for token in (GOOD, OTHER):
        res = await _http(fake, f"Bearer {token}", call)
        assert res.status_code == 200, res.text
        assert rpc(res)["result"]["structuredContent"]["status"] == "running"
        sent = [r for r in fake.calls if r.url.path == "/v1/decks/deck-1"][-1]
        assert sent.headers["authorization"] == f"Bearer {token}"
        assert sent.headers["x-kinsy-client"] == "mcp"


async def test_wait_for_deck_streams_progress_over_http(monkeypatch):
    seq = [status(phase="queued", progress=0.05), DONE]
    fake = FakeApi({"GET /v1/decks/deck-1": lambda r, n: seq[min(n, 2) - 1]})

    async def no_sleep(s):
        return None
    monkeypatch.setattr(srv, "_sleep", no_sleep)
    call = {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": {"name": "wait_for_deck", "arguments": {"deck_id": "deck-1"},
                       "_meta": {"progressToken": "p1"}}}
    res = await _http(fake, f"Bearer {GOOD}", call)
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/event-stream")
    events = [json.loads(line[5:]) for line in res.text.splitlines() if line.startswith("data:") and line[5:].strip()]
    progress = [e for e in events if e.get("method") == "notifications/progress"]
    assert progress and progress[-1]["params"]["progress"] == 100
    assert events[-1]["result"]["structuredContent"]["status"] == "done"


async def test_repeated_findings_are_counted_once():
    q = {"available": True, "fact_claims": 2, "flagged": 3, "missing_topics": [],
         "findings": [{"slide": 2, "claim": "A", "verdict": "unsupported"},
                      {"slide": 2, "claim": "A", "verdict": "unsupported"},
                      {"slide": 3, "claim": "B", "verdict": "contradicted"}]}
    fake = FakeApi({"GET /v1/decks/deck-1": lambda r, n: {**DONE, "quality": q}})
    async with Client(build(fake)) as c:
        r = await c.call_tool("get_deck", {"deck_id": "deck-1", "include_quality": True})
    assert r.structured_content["quality"]["flagged"] == 2


async def test_verifier_caches_a_good_key_for_a_minute():
    fake = FakeApi({})
    api = KinsyApi("https://api.test", transport=fake.transport)
    v = srv.KinsyTokenVerifier(api)
    a = await v.verify_token(GOOD)
    b = await v.verify_token(GOOD)
    assert a is not None and b is not None and a.subject == "u1"
    assert fake.counts["GET /v1/me"] == 1
    assert await v.verify_token("ksy_live_" + "z" * 43) is None


async def test_protected_resource_metadata_names_the_issuer():
    api = KinsyApi("https://api.test", transport=FakeApi({}).transport)
    app = srv.create_app(api)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://mcp.kinsy.ai") as h:
            prm = (await h.get("/.well-known/oauth-protected-resource/mcp")).json()
            health = await h.get("/health")
    assert prm["resource"] == "https://mcp.kinsy.ai/mcp"
    assert prm["authorization_servers"] == ["https://kinsy.ai"]
    assert health.status_code == 200 and health.json() == {"ok": True}


# ---------------------------------------------------------------------------
# Tool metadata
# ---------------------------------------------------------------------------
async def test_every_tool_has_a_title_annotations_and_a_use_when_description():
    async with Client(build(FakeApi({}))) as c:
        tools = {t.name: t for t in (await c.list_tools()).tools}
    assert set(tools) == TOOLS
    for name, t in tools.items():
        assert t.title, name
        assert t.annotations is not None and t.annotations.open_world_hint is False, name
        assert t.description and "Use this" in t.description, name
    for name in ("get_deck", "wait_for_deck", "export_deck", "list_themes"):
        assert tools[name].annotations.read_only_hint is True, name
    assert tools["edit_slide"].annotations.destructive_hint is True
    assert tools["create_deck"].annotations.destructive_hint is False
    assert tools["create_deck"].annotations.read_only_hint is False


async def test_instructions_lead_with_the_task_and_stay_short():
    s = build(FakeApi({}))
    assert len(srv.INSTRUCTIONS) <= 4096
    assert srv.INSTRUCTIONS.lstrip().lower().startswith("kinsy makes finished, editable powerpoint")


# ---------------------------------------------------------------------------
# create_deck
# ---------------------------------------------------------------------------
CREATED = {"deck_id": "deck-1", "status": "queued", "status_url": "https://kinsy.ai/v1/decks/deck-1",
           "created_at": "2026-10-27T12:00:00+00:00", "credits_charged": 40}


async def test_create_deck_forwards_the_request_and_never_echoes_the_brief():
    fake = FakeApi({"POST /v1/decks": lambda r, n: httpx.Response(202, json=CREATED)})
    brief = "SECRET-BRIEF quarterly numbers for the board"
    source = "SECRET-SOURCE revenue was 4.2M"
    async with Client(build(fake)) as c:
        r = await c.call_tool("create_deck", {
            "brief": brief, "sources": [{"name": "q3.md", "text": source}], "slides": 10,
            "theme": "slate", "answers": {"audience": "the board"}, "idempotency_key": "run-1"})
    assert r.is_error is False
    sent = fake.bodies("POST /v1/decks")[0]
    assert sent == {"brief": brief, "sources": [{"name": "q3.md", "text": source}], "slides": 10,
                    "theme": "slate", "research": "auto", "intake": "auto",
                    "answers": {"audience": "the board"}}
    req = [x for x in fake.calls if x.url.path == "/v1/decks"][0]
    assert req.headers["idempotency-key"] == "run-1"
    assert r.structured_content == {"deck_id": "deck-1", "status": "queued", "credits_charged": 40,
                                    "web_url": "https://kinsy.ai/deck/deck-1"}
    out = text_of(r)
    assert "deck-1" in out and "wait_for_deck" in out
    assert "SECRET" not in out and GOOD not in out


async def test_create_deck_402_is_an_error_with_the_top_up_link_and_no_charge():
    fake = FakeApi({"POST /v1/decks": lambda r, n: httpx.Response(402, json=envelope(
        402, "insufficient_credits", "Not enough credits for a 10-slide deck.",
        checkout_url="https://kinsy.ai/pricing?src=api"))})
    async with Client(build(fake)) as c:
        r = await c.call_tool("create_deck", {"brief": "x"})
    assert r.is_error is True
    out = text_of(r)
    assert "https://kinsy.ai/pricing?src=mcp" in out
    assert "nothing was charged" in out.lower()
    assert "buy" not in out.lower()


async def test_create_deck_needs_a_brief_or_a_source():
    fake = FakeApi({})
    async with Client(build(fake)) as c:
        r = await c.call_tool("create_deck", {"brief": "  "})
    assert r.is_error is True
    assert fake.counts["POST /v1/decks"] == 0


# ---------------------------------------------------------------------------
# get_deck / wait_for_deck
# ---------------------------------------------------------------------------
async def test_get_deck_done_gives_links_previews_and_quality_when_asked():
    slides = [{"num": i, "layout": "bullets", "headline": f"H{i}", "png_url": f"https://storage.example/s{i}.png"}
              for i in range(1, 9)]
    quality = {"available": True, "fact_claims": 12, "flagged": 1, "missing_topics": [],
               "findings": [{"slide": 3, "claim": "Revenue grew 40%", "verdict": "unsupported", "fix": "", "fixed": False}]}
    fake = FakeApi({"GET /v1/decks/deck-1": lambda r, n: {**DONE, "slides": slides, "quality": quality}})
    async with Client(build(fake)) as c:
        r = await c.call_tool("get_deck", {"deck_id": "deck-1", "include_previews": True, "include_quality": True})
    sc = r.structured_content
    assert sc["status"] == "done" and sc["pptx_url"].endswith("deck-1.pptx?sig=1")
    assert sc["expires_at"] == "2026-10-27T13:00:00+00:00" and sc["watermark"] is True
    assert len(sc["previews"]) == 6 and sc["previews"][0] == {"slide": 1, "headline": "H1",
                                                               "image_url": "https://storage.example/s1.png"}
    assert sc["quality"] == {"fact_claims": 12, "flagged": 1,
                             "flagged_claims": [{"slide": 3, "claim": "Revenue grew 40%", "verdict": "unsupported"}]}
    req = [x for x in fake.calls if x.url.path == "/v1/decks/deck-1"][0]
    assert req.url.params["include"] == "slides,quality"
    assert "1 claim" in text_of(r)


async def test_wait_for_deck_reports_progress_and_returns_when_done(monkeypatch):
    seq = [status(phase="queued", progress=0.05), status(), DONE]
    fake = FakeApi({"GET /v1/decks/deck-1": lambda r, n: seq[min(n, 3) - 1]})
    sleeps: list[float] = []

    async def no_sleep(s):
        sleeps.append(s)
    monkeypatch.setattr(srv, "_sleep", no_sleep)
    progress: list[float] = []

    async def on_progress(p, total, message):
        progress.append(p)
    async with Client(build(fake)) as c:
        r = await c.call_tool("wait_for_deck", {"deck_id": "deck-1"}, progress_callback=on_progress)
    assert r.structured_content["status"] == "done"
    assert sleeps == [3, 3]
    assert progress and progress[-1] == 100


async def test_wait_for_deck_returns_the_current_status_at_its_deadline(monkeypatch):
    fake = FakeApi({"GET /v1/decks/deck-1": lambda r, n: status()})
    clock = {"t": 0.0}

    async def tick(s):
        clock["t"] += s
    monkeypatch.setattr(srv, "_sleep", tick)
    monkeypatch.setattr(srv, "_now", lambda: clock["t"])
    async with Client(build(fake)) as c:
        r = await c.call_tool("wait_for_deck", {"deck_id": "deck-1", "timeout_seconds": 30})
    assert r.is_error is False
    assert r.structured_content["status"] == "running"
    assert clock["t"] <= 33
    assert "still" in text_of(r).lower() and "wait_for_deck" in text_of(r)


async def test_wait_for_deck_caps_the_timeout(monkeypatch):
    fake = FakeApi({"GET /v1/decks/deck-1": lambda r, n: status()})
    clock = {"t": 0.0}

    async def tick(s):
        clock["t"] += s
    monkeypatch.setattr(srv, "_sleep", tick)
    monkeypatch.setattr(srv, "_now", lambda: clock["t"])
    async with Client(build(fake)) as c:
        await c.call_tool("wait_for_deck", {"deck_id": "deck-1", "timeout_seconds": 5000})
    assert clock["t"] <= srv.MAX_WAIT_S + 3


async def test_a_failed_deck_is_reported_as_a_tool_error():
    fake = FakeApi({"GET /v1/decks/deck-1": lambda r, n: status(status="error", phase="error",
                                                                  error="The brief had nothing to say.")})
    async with Client(build(fake)) as c:
        r = await c.call_tool("get_deck", {"deck_id": "deck-1"})
    assert r.is_error is True
    assert "The brief had nothing to say." in text_of(r)


async def test_someone_elses_deck_is_an_error_not_a_leak():
    fake = FakeApi({"GET /v1/decks/deck-9": lambda r, n: httpx.Response(403, json=envelope(403, "forbidden", "not your deck"))})
    async with Client(build(fake)) as c:
        r = await c.call_tool("get_deck", {"deck_id": "deck-9"})
    assert r.is_error is True
    assert "not your deck" in text_of(r)


# ---------------------------------------------------------------------------
# export_deck / edit_slide / list_themes
# ---------------------------------------------------------------------------
async def test_export_deck_never_follows_the_redirect_and_returns_a_resource_link():
    link = {"url": "https://storage.example/deck-1.pptx?sig=2", "filename": "board-update.pptx",
            "expires_at": "2026-10-27T13:00:00+00:00"}
    fake = FakeApi({"GET /v1/decks/deck-1/files/pptx": lambda r, n: link})
    async with Client(build(fake)) as c:
        r = await c.call_tool("export_deck", {"deck_id": "deck-1"})
    req = [x for x in fake.calls if x.url.path.endswith("/files/pptx")][0]
    assert req.url.params["redirect"] == "false"
    assert r.structured_content == {"deck_id": "deck-1", "format": "pptx", **link}
    links = [c for c in r.content if getattr(c, "type", "") == "resource_link"]
    assert links and str(links[0].uri) == link["url"]
    assert links[0].mime_type == "application/vnd.openxmlformats-officedocument.presentationml.presentation"


async def test_edit_slide_returns_the_new_headline_or_the_question():
    answers = [
        {"deck_id": "deck-1", "slide": {"num": 3, "layout": "bullets", "headline": "Three asks", "png_url": ""},
         "clarify": None, "layout_changed": False, "title": "Board update", "images_generated": 0, "credits_charged": 5},
        {"deck_id": "deck-1", "slide": None, "clarify": "Which chart do you mean?", "layout_changed": False,
         "title": "", "images_generated": 0, "credits_charged": 0},
    ]
    fake = FakeApi({"POST /v1/decks/deck-1/edits": lambda r, n: answers[n - 1]})
    async with Client(build(fake)) as c:
        a = await c.call_tool("edit_slide", {"deck_id": "deck-1", "slide": 3, "instruction": "Cut to three"})
        b = await c.call_tool("edit_slide", {"deck_id": "deck-1", "slide": 2, "instruction": "fix the chart"})
    assert fake.bodies("POST /v1/decks/deck-1/edits")[0] == {"slide": 3, "instruction": "Cut to three"}
    assert a.structured_content["headline"] == "Three asks" and a.structured_content["credits_charged"] == 5
    assert b.structured_content["clarify"] == "Which chart do you mean?"
    assert "nothing was charged" in text_of(b).lower()


@pytest.mark.parametrize("bad", ["../me", "../decks?", "x?include=slides", "a/b", "%2e%2e", "deck 1"])
async def test_deck_ids_cannot_steer_requests_to_other_paths(bad):
    fake = FakeApi({})
    async with Client(build(fake)) as c:
        outs = [await c.call_tool("get_deck", {"deck_id": bad}),
                await c.call_tool("edit_slide", {"deck_id": bad, "slide": 1, "instruction": "x"}),
                await c.call_tool("export_deck", {"deck_id": bad}),
                await c.call_tool("wait_for_deck", {"deck_id": bad})]
    assert all(r.is_error for r in outs)
    assert [r.url.path for r in fake.calls] == []


async def test_list_themes():
    fake = FakeApi({"GET /v1/themes": lambda r, n: [
        {"id": "slate", "name": "Slate", "description": "The house theme", "background": "#fff",
         "ink": "#000", "accent": "#c00", "accent_secondary": "#0c0"}]})
    async with Client(build(fake)) as c:
        r = await c.call_tool("list_themes", {})
    assert r.structured_content == {"themes": [{"id": "slate", "name": "Slate", "description": "The house theme"}]}


async def test_a_network_failure_is_a_plain_tool_error():
    def boom(r, n):
        raise httpx.ConnectError("down")
    fake = FakeApi({"GET /v1/decks/deck-1": boom})
    async with Client(build(fake)) as c:
        r = await c.call_tool("get_deck", {"deck_id": "deck-1"})
    assert r.is_error is True
    assert "could not be reached" in text_of(r)


async def test_no_result_ever_contains_the_key():
    fake = FakeApi({"GET /v1/decks/deck-1": lambda r, n: DONE,
                    "POST /v1/decks": lambda r, n: httpx.Response(402, json=envelope(402, "insufficient_credits", "no"))})
    async with Client(build(fake)) as c:
        outs = [await c.call_tool("get_deck", {"deck_id": "deck-1"}),
                await c.call_tool("create_deck", {"brief": "x"})]
    for r in outs:
        blob = text_of(r) + json.dumps(r.structured_content or {})
        assert GOOD not in blob and "ksy_live_" not in blob
