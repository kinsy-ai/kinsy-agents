#!/usr/bin/env bash
# Registers the OAuth client that Microsoft's token vault uses for the Kinsy
# agent, once. Prints the client id; puts the client secret on the clipboard
# and never prints it or writes it to a file. Paste the secret straight into
# the Teams Developer Portal (Tools → OAuth client registration).
#
# The secret is shown by Kinsy only at registration. If it is lost, run this
# again and update the portal entry with the new id and secret.
set -euo pipefail

ISSUER="${KINSY_ISSUER:-https://kinsy.ai}"
command -v pbcopy >/dev/null || { echo "pbcopy is needed (macOS)" >&2; exit 1; }

reply="$(curl -fsS -X POST "$ISSUER/api/oauth/register" \
  -H 'Content-Type: application/json' \
  -d '{
    "client_name": "Microsoft 365 Copilot",
    "redirect_uris": ["https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect"],
    "token_endpoint_auth_method": "client_secret_post",
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"]
  }')"

python3 - "$reply" <<'PY'
import json, subprocess, sys
d = json.loads(sys.argv[1])
secret = d.get("client_secret")
if not d.get("client_id") or not secret:
    sys.exit("registration did not return a client id and secret")
subprocess.run(["pbcopy"], input=secret.encode(), check=True)
print("Client ID:          ", d["client_id"])
print("Client secret:       on the clipboard (not shown). Paste it into the portal now.")
print("Authorization URL:   https://kinsy.ai/oauth/authorize")
print("Token URL:           https://kinsy.ai/api/oauth/token")
print("Refresh URL:         https://kinsy.ai/api/oauth/token")
print("Scope:               decks offline_access")
print("Base URL:            https://mcp.kinsy.ai/mcp")
print("PKCE:                on    Token exchange: request body")
print("Usage:               Any Microsoft 365 organization, any Teams app")
PY
