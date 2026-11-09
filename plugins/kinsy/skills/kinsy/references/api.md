# The Kinsy API in one page

Base URL `https://kinsy.ai/v1`. Every call except the catalogues, the spec and the device sign-in carries `Authorization: Bearer ksy_live_…`. JSON in, JSON out. Full reference: https://kinsy.ai/docs/api · spec: https://kinsy.ai/v1/openapi.json

| Call | What it does | Credits |
|---|---|---|
| `POST /v1/decks` | Start a deck from `brief`, `sources[]` (`{name, text}`), `slides`, `theme`, `template`, `research`, `intake`, `answers`. Answers in under two seconds with `deck_id`, `status_url`, `credits_charged`. Optional `Idempotency-Key` header. | 40 / 60 / 90 by slide band, plus 10 per picture |
| `GET /v1/decks/{id}` | `status` (`queued`, `running`, `done`, `error`), `phase`, `progress` 0 to 1, `slides_rendered` of `slides_total`, `title`, `error`, and once done `artifacts.pptx` / `artifacts.pdf` with signed `url`, `filename`, `expires_at` (one hour). | free |
| `GET /v1/decks/{id}/files/{pptx\|pdf\|png}` | 302 to a fresh signed link; `?redirect=false` returns `{url, filename, expires_at}` as JSON. | free |
| `POST /v1/decks/{id}/edits` | `{slide, instruction}` → the new slide, or `clarify` (a question; nothing charged). | 5, plus 10 for a new picture |
| `POST /v1/files` | `multipart/form-data`, one `file` field → `{name, char_count, truncated, text}` to use as a source. | free |
| `POST /v1/intake` | The clarifying questions Kinsy would ask about a brief, each with suggested answers. | free |
| `GET /v1/decks` | Your decks, newest first. | free |
| `GET /v1/me` | Plan, `credits.total`, `watermark`, and the key in use. The cheapest way to check a key works. | free |
| `GET /v1/themes` · `GET /v1/templates` | The catalogues. No key needed. | free |
| `POST /v1/auth/device` · `POST /v1/auth/device/token` | The device sign-in behind `kinsy login`: start with `{hostname, client}`, show the `user_code`, poll with the `device_code` until `status` is `approved` (the one answer that carries `api_key`). No key needed. | free |

## Errors

```json
{"error": {"code": "insufficient_credits", "message": "…", "status": 402,
           "docs_url": "https://kinsy.ai/docs/errors#insufficient_credits",
           "checkout_url": "https://kinsy.ai/pricing?src=api"}}
```

`401` the key is missing, invalid or revoked · `402` not enough credits (show `checkout_url`; nothing was charged) · `403` not your deck · `404` unknown deck · `422` invalid field · `429` rate limited (`retry_after` seconds) · `503` temporarily unavailable.

## Three calls, no CLI

```bash
curl -s -X POST https://kinsy.ai/v1/decks -H "Authorization: Bearer $KINSY_API_KEY" \
  -H "Content-Type: application/json" -d '{"brief": "…", "slides": 10}'            # → deck_id
curl -s https://kinsy.ai/v1/decks/$DECK -H "Authorization: Bearer $KINSY_API_KEY"   # until .status == "done"
curl -L -o deck.pptx https://kinsy.ai/v1/decks/$DECK/files/pptx -H "Authorization: Bearer $KINSY_API_KEY"
```
