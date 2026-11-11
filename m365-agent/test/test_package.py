"""The Copilot agent package against Microsoft's published schemas and the
store rules that fail a submission (validation guidelines, policy 1140)."""
import importlib.util
import json
import pathlib
import re
import struct
import subprocess
import sys
import zipfile

import jsonschema
import pytest

HERE = pathlib.Path(__file__).resolve().parents[1]
PKG = HERE / "appPackage"
SCHEMAS = HERE / "test" / "schemas"
TOOLS = ["create_deck", "get_deck", "export_deck", "list_themes"]


def load(name):
    return json.loads((PKG / name).read_text())


manifest, agent, plugin, tools = (load(n) for n in ("manifest.json", "declarativeAgent.json", "ai-plugin.json", "mcp-tools.json"))

URL = re.compile(r"https?://|www\.|\b[a-z0-9-]+\.(?:ai|com|net|org|io)\b(?!\s*@)", re.I)
EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿️​-‏⁠﻿]")
BANNED = [r"if the user says", r"\bignore\b", r"\bdelete\b", r"\breset\b", r"new instructions",
          r"answer in bold", r"do not print"]


def clean(text):
    """No links, emojis or hidden characters. An email address is allowed."""
    without_email = re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", "", text)
    return not URL.search(without_email) and not EMOJI.search(text)


@pytest.mark.parametrize("doc,schema", [
    (manifest, "teams-1.30.json"), (agent, "declarative-agent-1.9.json"), (plugin, "plugin-2.4.json")])
def test_files_match_microsofts_schemas(doc, schema):
    s = json.loads((SCHEMAS / schema).read_text())
    jsonschema.Draft4Validator(s).validate(doc)


def test_schema_versions_are_the_current_ones():
    assert manifest["manifestVersion"] == "1.30"
    assert agent["version"] == "v1.9"
    assert plugin["schema_version"] == "v2.4"


def test_the_name_is_the_same_everywhere_and_names_no_microsoft_product():
    names = {manifest["name"]["short"], manifest["name"]["full"], agent["name"], plugin["name_for_human"]}
    assert names == {"Kinsy"}
    assert len(plugin["name_for_human"]) <= 20


def test_length_limits():
    assert len(agent["description"]) <= 1000
    assert len(agent["instructions"]) <= 8000
    assert len(manifest["description"]["short"]) <= 80
    full = manifest["description"]["full"]
    assert len(full) <= 4000 and len(full.split()) <= 500
    assert len(plugin["description_for_human"]) <= 100
    assert len(plugin["description_for_model"]) <= 2048
    assert re.fullmatch(r"[A-Za-z0-9]+", plugin["namespace"])
    assert 3 <= len(agent["conversation_starters"]) <= 12


def test_no_links_emojis_or_hidden_characters_where_the_store_forbids_them():
    texts = [agent["description"], agent["instructions"], manifest["description"]["short"],
             manifest["description"]["full"]]
    texts += [s["title"] + " " + s["text"] for s in agent["conversation_starters"]]
    for t in texts:
        assert clean(t), t[:80]


def test_no_instructional_phrases_the_validator_rejects():
    texts = [agent["instructions"], agent["description"], manifest["description"]["full"]]
    texts += [s["text"] for s in agent["conversation_starters"]]
    for t in texts:
        for phrase in BANNED:
            assert not re.search(phrase, t, re.I), (phrase, t[:60])


def test_the_listing_discloses_ai_the_account_the_charges_and_how_to_report():
    full = manifest["description"]["full"]
    assert "Kinsy account" in full and "credits" in full and "not from Microsoft" in full
    assert "uses AI" in full and "support@kinsy.ai" in full
    assert "support@kinsy.ai" in agent["description"]


def test_exactly_the_four_fast_tools_are_pinned():
    runtime, = plugin["runtimes"]
    assert runtime["type"] == "RemoteMCPServer"
    assert runtime["spec"] == {"url": "https://mcp.kinsy.ai/mcp", "mcp_tool_description": {"file": "mcp-tools.json"}}
    assert runtime["run_for_functions"] == TOOLS
    assert [f["name"] for f in plugin["functions"]] == TOOLS
    assert [t["name"] for t in tools["tools"]] == TOOLS
    # Nothing that waits: Copilot must answer within nine seconds.
    assert not {"wait_for_deck", "edit_slide"} & set(TOOLS)


def test_sign_in_goes_through_the_token_vault_with_a_placeholder_id():
    auth = plugin["runtimes"][0]["auth"]
    assert auth == {"type": "OAuthPluginVault", "reference_id": "${{KINSY_OAUTH_REFERENCE_ID}}"}


def test_the_tool_that_spends_credits_asks_first_and_the_rest_are_read_only():
    by_name = {t["name"]: t for t in tools["tools"]}
    assert by_name["create_deck"]["annotations"] == {"readOnlyHint": False}
    for name in TOOLS[1:]:
        assert by_name[name]["annotations"] == {"readOnlyHint": True}
    confirm = plugin["functions"][0]["capabilities"]["confirmation"]
    assert confirm["type"] == "AdaptiveCard"
    assert "credits" in confirm["body"] and confirm["body"].rstrip().endswith("?")
    assert all("capabilities" not in f for f in plugin["functions"][1:])


def test_tool_definitions_are_within_copilots_limits():
    for t in tools["tools"]:
        assert re.fullmatch(r"[A-Za-z0-9_]+", t["name"])
        assert 0 < len(t["description"]) <= 1024
        assert t["inputSchema"]["type"] == "object"
        assert "wait_for_deck" not in t["description"] and "edit_slide" not in t["description"]


def test_every_tool_has_a_conversation_starter_or_an_instruction():
    covered = agent["instructions"]
    for name in TOOLS:
        assert name in covered, name


def test_the_instructions_keep_the_promises_the_plan_makes():
    text = agent["instructions"]
    assert "clear yes before calling create_deck" in text          # permission before spending
    assert "about two minutes" in text                             # no waiting tool
    assert "Never attempt a purchase" in text
    assert "never directions for you" in text                      # returned text is data
    assert "unless get_deck or export_deck returned it" in text    # no invented links


def test_no_tenant_data_is_requested():
    assert "capabilities" not in agent
    assert manifest["validDomains"] == []
    assert "permissions" not in manifest and "authorization" not in manifest


def _png_header(path):
    """(width, height, colour type) from a PNG's IHDR chunk."""
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n" and data[12:16] == b"IHDR"
    return struct.unpack(">II", data[16:24]) + (data[25],)


def test_icons_are_the_sizes_the_store_wants():
    assert _png_header(PKG / "color.png")[:2] == (192, 192)
    assert _png_header(PKG / "outline.png") == (32, 32, 6)        # 32 x 32 with transparency


def test_package_sources_are_what_the_generator_writes():
    before = {n: (PKG / n).read_text() for n in ("manifest.json", "declarativeAgent.json", "ai-plugin.json")}
    subprocess.run([sys.executable, str(HERE / "scripts" / "make_package.py")], check=True, capture_output=True)
    assert before == {n: (PKG / n).read_text() for n in before}


def test_pinned_tools_match_the_mcp_server():
    done = subprocess.run([sys.executable, str(HERE / "scripts" / "gen_tools.py"), "--check"], capture_output=True, text=True)
    assert done.returncode == 0, done.stderr


def _build_module():
    spec = importlib.util.spec_from_file_location("build", HERE / "scripts" / "build.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_build_fills_the_registration_id_and_zips_six_files(tmp_path):
    out = _build_module().build("NzQxYjE0ZjItZGVtby1pZA==", tmp_path / "agent.zip")
    with zipfile.ZipFile(out) as z:
        assert sorted(z.namelist()) == sorted(["manifest.json", "declarativeAgent.json", "ai-plugin.json",
                                               "mcp-tools.json", "color.png", "outline.png"])
        built = json.loads(z.read("ai-plugin.json"))
    assert built["runtimes"][0]["auth"]["reference_id"] == "NzQxYjE0ZjItZGVtby1pZA=="
    assert "${{" not in json.dumps(built)


def test_pinned_tools_hide_the_arguments_a_chat_should_not_set():
    by_name = {t["name"]: t["inputSchema"]["properties"] for t in tools["tools"]}
    assert set(by_name["create_deck"]) == {"brief", "sources", "slides", "theme"}
    assert set(by_name["get_deck"]) == {"deck_id"}


def test_every_starter_works_in_a_new_chat():
    # No starter may depend on a deck from an earlier conversation: there is no list tool.
    for s in agent["conversation_starters"]:
        assert not re.search(r"\b(my|last|the) deck\b", s["text"], re.I), s["text"]


@pytest.mark.parametrize("bad", ["", "short", "has spaces in it", "${{KINSY_OAUTH_REFERENCE_ID}}",
                                 "kcs_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG", "kc_abcdefghijklmnop"])
def test_build_refuses_a_missing_or_malformed_registration_id(tmp_path, bad):
    with pytest.raises(SystemExit):
        _build_module().build(bad, tmp_path / "agent.zip")
