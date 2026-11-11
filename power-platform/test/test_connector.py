"""The Power Platform connector against the live API's shape and the
certification rules that most often fail a submission."""
import json
import pathlib
import re
import struct

import pytest

HERE = pathlib.Path(__file__).resolve().parents[1]
API = json.loads((HERE / "apiDefinition.swagger.json").read_text())
PROPS = json.loads((HERE / "apiProperties.json").read_text())["properties"]
OPENAPI = HERE / "test" / "kinsy-openapi.json"   # snapshot of https://kinsy.ai/v1/openapi.json

OPS = [(path, method, op) for path, ops in API["paths"].items() for method, op in ops.items()]


def test_is_swagger_2_on_kinsy_over_https():
    assert API["swagger"] == "2.0"
    assert (API["host"], API["basePath"], API["schemes"]) == ("kinsy.ai", "/v1", ["https"])
    assert API["info"]["title"] == "Kinsy"
    assert len(API["info"]["description"]) <= 500
    assert API["info"]["contact"]["email"] == "support@kinsy.ai"


def test_connector_metadata_has_website_privacy_and_categories():
    meta = {m["propertyName"]: m["propertyValue"] for m in API["x-ms-connector-metadata"]}
    assert meta["Website"] == "https://kinsy.ai"
    assert meta["Privacy policy"] == "https://kinsy.ai/privacy"
    assert meta["Categories"]


@pytest.mark.parametrize("path,method,op", OPS, ids=[o["operationId"] for _, _, o in OPS])
def test_operation_text_follows_the_rules(path, method, op):
    assert re.fullmatch(r"[A-Z][A-Za-z]+", op["operationId"])
    s = op["summary"]
    assert 0 < len(s) <= 80 and not s.endswith(".") and s[0].isupper()
    assert op["description"].endswith(".") and op["description"] != s
    for p in op.get("parameters", []):
        if p["in"] != "body":
            assert p.get("x-ms-summary") and p.get("description"), p["name"]
    assert any(code.startswith("2") for code in op["responses"])


def test_every_body_and_response_field_has_a_friendly_name():
    def walk(schema, where):
        for name, prop in (schema.get("properties") or {}).items():
            assert prop.get("x-ms-summary"), f"{where}.{name}"
            walk(prop, f"{where}.{name}")
            if prop.get("type") == "array":
                walk(prop.get("items") or {}, f"{where}.{name}[]")
    for path, method, op in OPS:
        for p in op.get("parameters", []):
            if p["in"] == "body":
                walk(p["schema"], op["operationId"])
        for code, r in op["responses"].items():
            if "schema" in r:
                walk(r["schema"] if r["schema"].get("type") != "array" else r["schema"]["items"], f"{op['operationId']}.{code}")


def test_operations_exist_on_the_live_api_with_these_fields():
    live = json.loads(OPENAPI.read_text())
    for path, method, op in OPS:
        assert method in live["paths"][API["basePath"] + path], (method, path)
    create = API["paths"]["/decks"]["post"]["parameters"][1]["schema"]["properties"]
    live_create = live["components"]["schemas"]["DeckCreateRequest"]["properties"]
    assert set(create) <= set(live_create)
    themes = live["components"]["schemas"]["ThemeOption"]["properties"]
    assert {"id", "name"} <= set(themes)
    credits = live["components"]["schemas"]["CreditBalance"]["properties"]
    assert "total" in credits


def test_the_key_is_a_secure_connection_parameter_sent_as_a_bearer_token():
    key = PROPS["connectionParameters"]["api_key"]
    assert key["type"] == "securestring"
    assert API["securityDefinitions"]["api_key"] == {"type": "apiKey", "in": "header", "name": "Authorization"}
    auth = [p for p in PROPS["policyTemplateInstances"] if p["parameters"]["x-ms-apimTemplateParameter.name"] == "Authorization"]
    assert len(auth) == 1
    assert auth[0]["templateId"] == "setheader"
    assert auth[0]["parameters"]["x-ms-apimTemplateParameter.value"] == "Bearer @connectionParameters('api_key')"


def test_publisher_and_brand_colour():
    assert PROPS["publisher"] == PROPS["stackOwner"] == "Kinsy"
    assert re.fullmatch(r"#[0-9A-F]{6}", PROPS["iconBrandColor"])
    assert PROPS["iconBrandColor"] != "#007EE5"          # the default is refused at certification


def test_icon_is_a_square_png():
    data = (HERE / "icon.png").read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    w, h = struct.unpack(">II", data[16:24])
    assert w == h and 100 <= w <= 230


def test_readme_has_the_required_sections():
    text = (HERE / "readme.md").read_text()
    for heading in ("## Publisher:", "## Prerequisites", "## Supported operations", "## Obtaining credentials",
                    "## Known issues and limitations", "## Deployment instructions"):
        assert heading in text, heading
