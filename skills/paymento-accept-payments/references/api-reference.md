# Paymento API reference

Base URL `https://api.paymento.io`. Send `Api-Key: <merchant API key>`, `Content-Type: application/json` and `Accept: application/json` on every call. Responses are camelCase JSON; enums are integers.

## Response envelope

```json
{ "success": true, "message": "", "body": "…" }
```

- Business-rule refusals return HTTP **200** with `success: false` and a readable `message`.
- API key problems return `400` (`code: "API_KEY_MISSING"`) or `401` (`code: "API_KEY_EMPTY"` / `"API_KEY_INVALID"`), body `{ success: false, message, code }`.

## POST /v1/payment/request

Creates a payment and returns its token. Provide either `fiatAmount` (with `fiatCurrency`) or `cryptoAmounts`.

| Field | Type | Notes |
| --- | --- | --- |
| `fiatAmount` | string | Digits with an optional `.` decimal point, e.g. `"1000.50"`. Thousands separators and decimal commas are refused. |
| `fiatCurrency` | string | e.g. `USD`, `EUR`. See `GET /v1/currencies`. |
| `returnUrl` | string | Where the customer's browser goes after the gateway. |
| `orderId` | string | The store's order id. Returned in callbacks and verify. |
| `riskSpeed` | int | Optional, default `0`. `0` High: checkout shows "received" once seen on-chain. `1` Low: checkout waits for confirmations. Does not change when the order becomes `Paid`. |
| `language` | string | Gateway language: a `culture` from `GET /v1/languages`. Unknown cultures are refused. |
| `emailAddress` | string | Customer email. |
| `tokenExpiryDate` | date-time | UTC, must be in the future. Defaults to the store's token lifetime (24 hours unless changed). |
| `cryptoAmounts` | array | `[{ "coinName": "Bitcoin", "amount": "0.01854793" }]` |
| `additionalData` | array | `[{ "key": "invoice-number", "value": "A-578" }]`, returned in callbacks and verify. |

Success: `{ "success": true, "message": "", "body": "3256e147c6fe4d36a9341a5112ed2214" }`. Refused: `{ "success": false, "message": "Please set amount", "body": "" }`.

An identical request body sent again shortly after, while that order is still `Initialize`, returns the same token instead of a second order.

Redirect the customer to `https://app.paymento.io/gateway?token={token}`.

## POST /v1/payment/verify

Body `{ "token": "…" }`. The API key must belong to the store that owns the payment.

```json
{
  "success": true,
  "message": "",
  "body": {
    "token": "3256e147c6fe4d36a9341a5112ed2214",
    "orderId": "5855",
    "orderStatus": 8,
    "additionalData": [{ "key": "invoice-number", "value": "A-578" }],
    "settlement": {
      "expectedCryptoAmount": 0.015,
      "requestedFiatAmount": 42.5,
      "receivedCryptoAmount": 0.015,
      "pendingTxHash": null,
      "toAddress": "0x742d…",
      "asset": "ETH",
      "network": "Ethereum",
      "standard": "Native",
      "contractAddress": null,
      "transactions": [{
        "txHash": "0xabc…", "explorerUrl": "https://etherscan.io/tx/0xabc…", "amount": 0.015,
        "confirmations": 12, "requiredConfirmations": 3, "status": 3, "blockHeight": 19234567,
        "detectedAt": "2026-05-19T10:22:11Z", "confirmedAt": "2026-05-19T10:28:44Z",
        "fromAddresses": "[\"0xsender…\"]", "toAddress": "0x742d…"
      }]
    }
  }
}
```

- `success` is `true` only when the order is `Approve (8)` after this call. The first verify on a `Paid (7)` order moves it to `Approve` and returns `true`; repeating it still returns `true`.
- `success: false` with a valid `body.token` is a normal in-progress answer: branch on `body.orderStatus`.
- Invalid or foreign token: `message: "Invalid Token"`, `body.token: ""`, `orderStatus: 0`, `settlement: null`.
- `settlement.transactions[].status`: `0` Pending, `1` Mempool, `2` InBlock, `3` Completed, `4` Revert, `5` UnWatch, `6` Invalid.
- `confirmations` is `null` while a transaction has no block height (e.g. in the mempool). Never hardcode confirmation counts; read `requiredConfirmations`.
- Fields may be `null` when data is not available.

## Order statuses

`0` Initialize, `1` Pending, `2` PartialPaid, `3` WaitingToConfirm, `4` Timeout, `5` UserCanceled, `6` Revert (reserved, not produced), `7` Paid, `8` Approve, `9` Reject, `10` Refunded. `7`–`10` are final: later chain activity does not move them back.

Only `Pending` orders time out; an order that has received something (`2`, `3`) is not timed out. Stores can set an underpayment tolerance of 0–5% in the merchant panel; overpayments are marked `Paid`.

## POST /v1/payment/settings and GET /v1/payment/settings

```json
{ "ipN_URL": "https://merchant.example/api/paymento/ipn", "ipN_Method": 1 }
```

`ipN_Method`: `1` POST, `2` PUT; any other value (including `0`) is sent as PUT. The setting is per store and persists. GET returns the same object in `body`.

## Supporting endpoints

| Endpoint | Returns |
| --- | --- |
| `GET /v1/payment/coins` | Coins the store accepts: `[{ name, shortcut }]` |
| `GET /v1/coins` | All supported coins with network and contract details |
| `POST /v1/coins/price` | Prices: body `{ coinNames: [], currency, include24HrChange }` |
| `GET /v1/currencies` | Supported fiat currencies |
| `GET /v1/languages` | Gateway languages: `[{ name, displayName, culture }]` |
| `GET /v1/ping`, `GET /v1/ping/merchant` | Health, and whether the API key's store is active |

The full schema is in [openapi.json](https://github.com/paymento/ai/blob/main/openapi.json).
