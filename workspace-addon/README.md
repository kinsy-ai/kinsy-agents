# Kinsy for Google Slides and Docs

A Google Workspace Editor add-on (Apps Script). Open **Extensions → Kinsy → Build a deck** in
Google Slides or Google Docs, describe the deck (in Docs you can build from the open document),
and Kinsy puts a finished, editable Google Slides file in your own Drive.

Install it from the Google Workspace Marketplace once it is listed; this directory is the source.

## How it works

| File | What it does |
| --- | --- |
| `Code.js` | The menu, the sidebar, and the functions the sidebar calls. |
| `Auth.js` | Sign-in at kinsy.ai (authorization code with PKCE, no client secret). |
| `Api.js` | Calls to Kinsy's public API (`https://kinsy.ai/v1`). |
| `Drive.js` | Downloads the finished pptx and saves it to Drive as Google Slides. |
| `Sidebar.html` | The 300 px panel. It talks only to the script, never to the network. |
| `Callback.html` | The page shown in the sign-in tab when it is finished. |

## What it can reach

Scopes, all of Google's narrow kind:

- `script.container.ui` — show the sidebar.
- `script.external_request` — call Kinsy and upload to Drive.
- `drive.file` — create the Slides file. Reaches only files this add-on created.
- `presentations.currentonly`, `documents.currentonly` — run inside the open file. The document's
  text is read only when you tick "Build from this document" and press Build; nothing is read
  in Slides.

Hosts it may call (`urlFetchWhitelist`): `kinsy.ai`, `storage.googleapis.com` (the deck
download), `www.googleapis.com` (the Drive upload). Your Kinsy sign-in is sent only to
`kinsy.ai`; it is kept in your own Apps Script user properties and never reaches the sidebar.
Sign out in the panel, or end the grant at kinsy.ai → Settings → Connected apps.

Builds use credits from your Kinsy account. Credits are sold by Kinsy at kinsy.ai, not by Google.

## Develop

```sh
cd workspace-addon
npm ci
npm test          # the script runs under Node against fakes of the Apps Script services
```

Push to an Apps Script project with [clasp](https://github.com/google/clasp) (`.claspignore`
sends only the script's own files). The script's Google Cloud project needs the Google Drive API
enabled for the upload. The sign-in redirect is
`https://script.google.com/macros/d/{SCRIPT_ID}/usercallback`; Kinsy accepts only the one listed
in `https://kinsy.ai/workspace-addon/oauth-client.json`, so a copy of this script under another
id cannot sign in to Kinsy.

Security reports: see [SECURITY.md](../SECURITY.md).
