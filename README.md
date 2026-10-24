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

**Cursor, Codex, OpenCode and 75+ other agents** ([skills CLI](https://skills.sh))

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
```

## Development

The Node.js reference is executable documentation: `tests/check-nodejs-reference.ts` extracts its code blocks and runs them against signed callbacks, failure cases and a concurrency race.

```bash
node --experimental-transform-types --no-warnings tests/check-nodejs-reference.ts
claude plugin validate .
```

## Support

- **Docs**: https://docs.paymento.io
- **Email**: support@paymento.io
- **Community**: https://paymento.io/contact-us
