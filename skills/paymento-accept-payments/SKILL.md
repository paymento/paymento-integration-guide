---
name: paymento-accept-payments
description: Integrate Paymento, a non-custodial crypto payment gateway, so a website or app can accept Bitcoin, Ethereum, USDT, USDC and other crypto payments paid straight to the merchant's own wallet. Use when the user wants to accept crypto payments, add a crypto checkout or "pay with crypto" button, integrate Paymento's API, handle Paymento IPN callbacks or HMAC signatures, verify Paymento payments, or review or debug an existing Paymento integration, in any backend (Node.js, Next.js, Python, PHP, Laravel, .NET, Go and others).
---

# Paymento: accept crypto payments

Paymento is a non-custodial gateway: the customer pays from their wallet straight to the merchant's wallet, and Paymento never holds the funds. The integration is five server-side steps. Most failed integrations break one of the rules in [Rules that break integrations](#rules-that-break-integrations), so read that section before writing code.

## Before you write code

Confirm with the user, or find in the project:

1. **Paymento credentials** from the merchant dashboard at <https://app.paymento.io>: the store's **API key** and **secret key**. Store them as server-side environment variables (`PAYMENTO_API_KEY`, `PAYMENTO_IPN_SECRET`). Never ship them to a browser, mobile app bundle or client component.
2. **A public HTTPS IPN URL** on the backend (not localhost; for local development use a tunnel).
3. **A return URL** for the customer's browser after checkout.
4. **The stack and where orders live**, so callbacks can be stored durably and orders updated under a lock.

If the merchant uses WooCommerce, OpenCart or WHMCS, point them to the ready-made plugins at <https://docs.paymento.io/accept-crypto-payments/prebuilt-payment-plugins> instead of writing code.

## Integration steps

Base URL `https://api.paymento.io`. Every call sends the header `Api-Key: <PAYMENTO_API_KEY>` and JSON. Every response is `{ success, message, body }`.

0. **Set the IPN URL once per store**: `POST /v1/payment/settings` with `{ "ipN_URL": "https://…/api/paymento/ipn", "ipN_Method": 1 }`. It persists; do not call it per payment. A one-off setup script or admin action is enough.
1. **Create the payment**: `POST /v1/payment/request` with `{ fiatAmount, fiatCurrency, returnUrl, orderId }` (optional: `riskSpeed`, `language`, `emailAddress`, `tokenExpiryDate`, `cryptoAmounts`, `additionalData`). Check `success`, then the token is `body`.
2. **Redirect** the customer to `https://app.paymento.io/gateway?token={token}`.
3. **Receive the IPN** at the IPN URL: check the `X-HMAC-SHA256-Signature` header, store the callback durably, answer `2xx`.
4. **Verify**: `POST /v1/payment/verify` with `{ "token": "…" }` and act on `body.orderStatus`.
5. **Fulfil** when `orderStatus` is `8` (Approve) or `7` (Paid). Never on anything a browser reported.

Full field lists and response shapes: [references/api-reference.md](references/api-reference.md). Callback handling in depth: [references/ipn-callbacks.md](references/ipn-callbacks.md).

## Rules that break integrations

Each of these is a real failure mode. Apply all of them.

1. **A refused payment request is HTTP 200.** `payment/request` returns `200` with `success: false` and a readable `message` (for example `"Please set amount"`). Check `success` before using `body`, or the customer is sent to `gateway?token=` with no token.
2. **`success: false` from verify is not an error.** It is `true` only when the order is `Approve (8)`. A payment two confirmations short returns `success: false` with `orderStatus: 3`. Branch on `body.orderStatus`. `message: "Invalid Token"` (with an empty `body.token`) is the only failure.
3. **Verify approves.** The first verify on a `Paid (7)` order moves it to `Approve (8)` and returns `success: true`. Repeating it is safe.
4. **The IPN method defaults to PUT.** `ipN_Method` `1` is POST and `2` is PUT; any other value, including `0`, is sent as PUT. Set `1`, or accept both methods on the IPN route.
5. **Check the signature over the raw body.** Uppercase hex HMAC-SHA256 of the exact request bytes, keyed with the secret key as UTF-8 text, compared in constant time. Parse JSON only after it matches. Answer `401` if the header is missing or wrong.
6. **Store the callback before calling verify.** Paymento retries a failed callback only while the order is still `Paid`, and your first verify moves it to `Approve`. If your server fails between verify and updating the order, Paymento never calls again. Save each authenticated callback as its own row, answer `2xx` once it is saved, and retry unprocessed rows from your own job.
7. **One processor per token at a time.** The IPN handler and the retry job can run the same token together; an older verify result can then overwrite a newer one. Hold a lock shared by every process (database advisory lock or `SELECT … FOR UPDATE`) around verify and the order update.
8. **Never un-pay an order.** One store order can have several tokens (a customer who retries checkout), and an abandoned token still reports `Timeout` or `UserCanceled` later. Once an order is paid (`7`/`8`), ignore any non-paid status; only `10 Refunded` may follow.
9. **The callback body is PascalCase; API responses are camelCase.** Callback: `{ Token, PaymentId, OrderId, OrderStatus, AdditionalData: [{ Key, Value }] }`. `PaymentId` and `OrderId` are strings, `OrderStatus` is an integer. All enums are integers in JSON.
10. **The return URL is unsigned.** The browser arrives with `?token=…&orderId=…&status=…`. Use it to show a page, never to change an order.
11. **`riskSpeed` does not change when you may fulfil.** `0` (default) tells the customer "payment received" as soon as it is seen on-chain; `1` waits for confirmations. The order reaches `Paid` only after the required confirmations either way.
12. **`fiatAmount` is a string with a `.` decimal point** (`"1000.50"`). Thousands separators and decimal commas are refused.

## Order statuses

| Value | Status | What the integration does |
| --- | --- | --- |
| 0 | Initialize | Request created; nothing to do. |
| 1 | Pending | Customer chose a coin; waiting for payment. |
| 2 | PartialPaid | Less than owed arrived. Merchant decides: wait, refund, or accept. |
| 3 | WaitingToConfirm | Enough arrived, not yet confirmed. Show "confirming"; do not fulfil. |
| 4 | Timeout | Window expired with nothing received. Cancel unless already paid by another token. |
| 5 | UserCanceled | Customer cancelled at checkout. Same as Timeout. |
| 7 | Paid | Confirmed on-chain. Fulfil (verify moves it to 8). |
| 8 | Approve | Verified by the store. Fulfil (idempotently). |
| 9 | Reject | Address no longer monitored or not verified. Do not fulfil. |
| 10 | Refunded | Fully refunded to the payer. Mark refunded. |

`6` (Revert) is reserved and not produced. `7`, `8`, `9` and `10` are final.

## Implementation by stack

- **Node.js / TypeScript** (Express, Next.js, serverless): complete, tested code in [references/nodejs.md](references/nodejs.md). Adapt its persistence functions to the project's database.
- **Python, PHP, C#/.NET**: signature checks and API calls in [references/other-languages.md](references/other-languages.md). Follow the same structure as the Node.js reference.

Keep the code in the project's existing style and layers: an API client module, a payment-creation route, the IPN route, a retry job, and a callback table in the existing database with a migration made the way the project makes them.

## Test the integration

1. Run the IPN endpoint locally (through a tunnel if Paymento must reach it) and send it signed callbacks with [scripts/send-test-ipn.mjs](scripts/send-test-ipn.mjs). Check that a wrong signature gets `401`, a valid one gets `2xx` and a stored row, and a repeat changes nothing.
2. Make real test payments on testnets: <https://docs.paymento.io/accept-crypto-payments/testing-and-simulation>.

## Done when

- [ ] Keys live only in server-side environment variables.
- [ ] The IPN URL is set once with `ipN_Method: 1`, or the IPN route accepts POST and PUT.
- [ ] Payment creation checks `success` and never redirects without a token.
- [ ] The IPN route checks the HMAC over the raw body in constant time and answers `401` on failure.
- [ ] Each authenticated callback is stored before verify; a job retries unprocessed ones.
- [ ] Verify and the order update run under a cross-process lock per token.
- [ ] Fulfilment branches on `body.orderStatus`, is idempotent, and never un-pays an order.
- [ ] The return URL page shows status only and changes nothing.
- [ ] All statuses in the table above are handled, including `10 Refunded`.

## Sources

- API documentation: <https://docs.paymento.io/api-documentation/api-overview>
- Documentation index for agents: <https://docs.paymento.io/llms.txt>
- OpenAPI schema: [openapi.json](https://github.com/paymento/ai/blob/main/openapi.json)
