# Kinsy

Kinsy builds finished, editable PowerPoint decks from a brief and your source documents: native
slides with real text boxes, tables and charts, plus a PDF. Numbers your sources don't support
are flagged. Use this connector to create a deck from a flow, an app or a Copilot Studio agent,
check on it, and get links to the files.

## Publisher: Kinsy

## Prerequisites

A Kinsy account and an API key. Create a free account at [kinsy.ai](https://kinsy.ai); it comes
with 100 credits, about one deck. Builds use credits: 40 for up to 10 slides, 60 for up to 16,
90 for up to 25, plus 10 for each generated picture. More credits are bought from Kinsy at
[kinsy.ai/pricing](https://kinsy.ai/pricing).

## Supported operations

### Create a deck
Starts a deck from a brief (who it is for, what it must achieve, the points it must make) and
optional source text. Answers at once with a deck ID. Send an idempotency key when a flow may
retry, so a retry is not charged twice.

### Get a deck
Status of a deck. While it builds: progress and slides ready. When done: title and links to the
PowerPoint and PDF files, valid for one hour. A deck is usually ready in one to two minutes;
in a flow, use a Do until loop with a 15-second delay until Status is done or error.

### List themes
The visual themes a deck can use.

### Get account
The account's plan and credit balance.

## Obtaining credentials

Sign in at [kinsy.ai](https://kinsy.ai), open Settings, API keys, and create a key. Paste it into
the connection's API key field. A key acts as your account: keep it in the connection only, and
revoke it in Settings if it leaks.

## Known issues and limitations

- Download links expire after one hour; call Get a deck again for fresh links.
- A deck takes one to two minutes; there is no trigger yet, so flows poll Get a deck.
- Up to 10 sources per deck, 120,000 characters each.

## Frequently asked questions

**Does Kinsy keep my documents?** Briefs, sources and decks are stored in your Kinsy account until
you delete them. See [kinsy.ai/privacy](https://kinsy.ai/privacy).

**Where do I get help?** [kinsy.ai/contact](https://kinsy.ai/contact) or support@kinsy.ai.

## Deployment instructions

```sh
paconn create --api-def apiDefinition.swagger.json --api-prop apiProperties.json --icon icon.png
```
