# Security

## Reporting a vulnerability

Email **support@kinsy.ai** with "security" in the subject. Include what you found, how to reproduce it, and what you think the impact is. You will get an acknowledgement within five business days and a plan or a fix as soon as we have one. Please do not open a public issue for a vulnerability, and please do not test against accounts that are not yours.

In scope: everything in this repository (the CLI, the skill, the manifests, the workflows) and the Kinsy API and web app at kinsy.ai that they talk to.

## How the CLI handles credentials

- `kinsy login` uses a device sign-in. The terminal shows a short code; the person confirms it on kinsy.ai while signed in; the server hands the terminal its own API key exactly once. The key never passes through the browser or a chat window.
- The key is stored in `~/.config/kinsy/credentials.json` with mode 0600 inside a 0700 directory, or read from `KINSY_API_KEY`. It is only ever printed masked (`ksy_live_…wxyz`).
- Signed download links are fetched without the key.
- Keys work only on the `/v1` API. Billing, account and key management need a signed-in web session, so a leaked key cannot buy credits or mint keys. Revoke a key at any time in Settings → API keys.

## Supply chain

- The CLI is published to npm from this repository's GitHub Actions with provenance attestations; there is no manual publish path.
- Dependencies are pinned by `package-lock.json` and audited in CI; the repository is scanned for secrets (including Kinsy's own `ksy_` key format) on every push.
- Nothing here asks you to pipe a script into a shell.
