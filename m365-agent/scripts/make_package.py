"""Writes the Copilot agent's package sources into appPackage/ from this
file (the manifests) and instructions.md. Run after editing either:
    python3 m365-agent/scripts/make_package.py
"""
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parents[1]
OUT = HERE / "appPackage"
APP_ID = "e54493d3-5d15-49d8-8db7-1cf1ddbed97b"
TOOLS = ["create_deck", "get_deck", "export_deck", "list_themes"]

SHORT = "Finished, editable PowerPoint decks from a brief and your documents."
FULL = (
    "Kinsy builds finished presentations. Describe the deck you need and who it is for, paste in the "
    "material it should be built from, and Kinsy returns an editable PowerPoint file with a clear storyline, "
    "charts, tables and pictures, laid out and ready to present. Figures your material does not support are "
    "flagged so you know what to check.\n\n"
    "How it works: ask Kinsy for a deck and confirm. A deck takes about two minutes to build; ask Kinsy "
    "whether it is ready and you get a download link for the PowerPoint file and a link to review and edit "
    "the deck on the web.\n\n"
    "What you need: a Kinsy account. You can create one free the first time you sign in, and it comes with "
    "100 credits, about one deck. A deck of up to 10 slides uses 40 credits, up to 16 slides 60, up to 25 "
    "slides 90, plus 10 for each generated picture. More credits or a monthly plan are bought from Kinsy on "
    "its website, not from Microsoft. Decks made on a free account carry a small Made with Kinsy mark.\n\n"
    "Kinsy uses AI to plan and write decks. AI-generated content can be wrong: review a deck before you "
    "present it. To report a problem with something Kinsy produced, write to support@kinsy.ai."
)

manifest = {
    "$schema": "https://developer.microsoft.com/json-schemas/teams/v1.30/MicrosoftTeams.schema.json",
    "manifestVersion": "1.30",
    "version": "1.0.0",
    "id": APP_ID,
    "developer": {
        "name": "Kinsy",
        "websiteUrl": "https://kinsy.ai",
        "privacyUrl": "https://kinsy.ai/privacy",
        "termsOfUseUrl": "https://kinsy.ai/terms",
    },
    "icons": {"color": "color.png", "outline": "outline.png"},
    "name": {"short": "Kinsy", "full": "Kinsy"},
    "description": {"short": SHORT, "full": FULL},
    "accentColor": "#F3F6F4",
    "copilotAgents": {"declarativeAgents": [{"id": "kinsy", "file": "declarativeAgent.json"}]},
    "validDomains": [],
}

agent = {
    "$schema": "https://developer.microsoft.com/json-schemas/copilot/declarative-agent/v1.9/schema.json",
    "version": "v1.9",
    "name": "Kinsy",
    "description": (
        "Builds finished, editable PowerPoint decks from a brief and your material, on your Kinsy account. "
        "Uses AI; review decks before presenting. Report problems to support@kinsy.ai."
    ),
    "instructions": (HERE / "instructions.md").read_text().strip(),
    "conversation_starters": [
        {"title": "Build a deck", "text": "Build a ten-slide deck for our board on third-quarter results: revenue, hiring, the two biggest risks and what we need from them."},
        {"title": "Turn notes into slides", "text": "I will paste my meeting notes. Turn them into a short deck for the leadership team."},
        {"title": "Is my deck ready?", "text": "Is my deck ready? Give me the link to download it."},
        {"title": "Choose a look", "text": "What themes can a Kinsy deck use?"},
        {"title": "Get the file again", "text": "Give me a fresh download link for the last deck you built."},
    ],
    "actions": [{"id": "kinsyMcp", "file": "ai-plugin.json"}],
}

plugin = {
    "$schema": "https://developer.microsoft.com/json-schemas/copilot/plugin/v2.4/schema.json",
    "schema_version": "v2.4",
    "name_for_human": "Kinsy",
    "description_for_human": SHORT,
    "description_for_model": (
        "Builds finished, editable PowerPoint decks on the person's Kinsy account from a brief and source "
        "text, reports on a deck's progress, and gives links to download or review a finished deck. Use for "
        "requests to make a presentation, deck or slides."
    ),
    "contact_email": "support@kinsy.ai",
    "namespace": "kinsy",
    "privacy_policy_url": "https://kinsy.ai/privacy",
    "legal_info_url": "https://kinsy.ai/terms",
    "functions": [
        {
            "name": "create_deck",
            "description": "Start building a PowerPoint deck from a brief and source text. Spends credits.",
            "capabilities": {
                "confirmation": {
                    "type": "AdaptiveCard",
                    "title": "Build this deck with Kinsy?",
                    "body": "Kinsy will build the deck from what you described. It uses credits from your Kinsy account. Do you want to proceed?",
                }
            },
        },
        {"name": "get_deck", "description": "Check whether a deck is ready and get its links."},
        {"name": "export_deck", "description": "Get a fresh download link for a finished deck."},
        {"name": "list_themes", "description": "List the visual themes a deck can use."},
    ],
    "runtimes": [
        {
            "type": "RemoteMCPServer",
            "spec": {"url": "https://mcp.kinsy.ai/mcp", "mcp_tool_description": {"file": "mcp-tools.json"}},
            "run_for_functions": TOOLS,
            # Filled at build time with the OAuth registration id from the Teams Developer Portal.
            "auth": {"type": "OAuthPluginVault", "reference_id": "${{KINSY_OAUTH_REFERENCE_ID}}"},
        }
    ],
}

for name, doc in (("manifest.json", manifest), ("declarativeAgent.json", agent), ("ai-plugin.json", plugin)):
    (OUT / name).write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
print("wrote manifest.json, declarativeAgent.json, ai-plugin.json")
