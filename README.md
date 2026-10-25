# Paymento for AI agents

Agent skills that let AI coding agents integrate [Paymento](https://paymento.io), a non-custodial crypto payment gateway, into any website or app. Customers pay from their wallet straight to the merchant's wallet; Paymento never holds the funds.

| Skill | What it does |
| --- | --- |
| [`paymento-accept-payments`](skills/paymento-accept-payments/SKILL.md) | Integrates Paymento checkout into a backend: payment requests, the gateway redirect, signed IPN callbacks, verification and safe order fulfilment. Node.js reference code (tested), plus Python, PHP and C# building blocks. |

## Install

**Claude Code**

```bash
/plugin install paymento --marketplace paymento/ai
```

or, from a shell:

```bash
claude plugin marketplace add paymento/ai
claude plugin install paymento@paymento
```

**Codex**

```bash
codex plugin marketplace add paymento/ai
```

then install **Paymento** from the Plugins directory.

**Cursor, OpenCode and 75+ other agents** ([skills CLI](https://skills.sh))

```bash
npx skills add paymento/ai
```

**Any other agent**: point it at [`skills/paymento-accept-payments/SKILL.md`](skills/paymento-accept-payments/SKILL.md) and the files it links to.

Then ask your agent something like *"Add Paymento crypto checkout to this app"*.

## What's in this repository

```
skills/paymento-accept-payments/
  SKILL.md                     # the flow, the rules that break integrations, the done checklist
  references/api-reference.md  # endpoints, fields, envelopes, statuses
  references/ipn-callbacks.md  # callback format, signature, retries, processing
  references/nodejs.md         # drop-in Node.js / TypeScript code
  references/other-languages.md# Python, PHP and C# building blocks
  scripts/send-test-ipn.mjs    # sends a correctly signed test callback to your IPN URL
openapi.json                   # Paymento external API schema
tests/                         # checks that the reference code still behaves as documented
.claude-plugin/                # Claude Code plugin and marketplace manifests
plugin.json                    # Agent Plugins manifest (Cursor, Codex)
.agents/plugins/               # Codex marketplace
assets/logo.svg                # plugin logo
```

## Data handling

The plugin contains an agent skill and documentation only: no MCP server, connector or hooks. It does not read, store or send personal data, and it never reads the installer's credentials.

Data leaves the machine in two places, both under the developer's control:

| What | Sends to | Data |
| --- | --- | --- |
| `scripts/send-test-ipn.mjs`, when the developer runs it | The IPN URL the developer passes on the command line (their own endpoint) | A synthetic test callback, signed with `PAYMENTO_IPN_SECRET` from the developer's environment. The secret itself is not sent. |
| The integration code the skill writes into the merchant's app, at the app's runtime | `https://api.paymento.io` (Paymento's API) | Payment requests and verifications, authenticated with the merchant's own `PAYMENTO_API_KEY` |

Nothing is sent to Paymento or anyone else by the plugin itself.

## Development

The Node.js reference is executable documentation: `tests/check-nodejs-reference.ts` extracts its code blocks and runs them against signed callbacks, failure cases and a concurrency race.

```bash
node --experimental-transform-types --no-warnings tests/check-nodejs-reference.ts
claude plugin validate .
```

## License

[MIT](LICENSE), Copyright (c) 2026 Prokey Technologies Inc. Copy the snippets into your own code freely.

Paymento and the Paymento logo are trademarks of Prokey Technologies Inc. This license does not grant rights to use them.

## Support

- **Docs**: https://docs.paymento.io
- **Email**: support@paymento.io
- **Community**: https://paymento.io/contact-us
