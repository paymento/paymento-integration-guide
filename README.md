# Paymento Integration Guide

This repository contains the official **PRD (Product Requirement Document)** for integrating with the Paymento non-custodial payment gateway.

Paymento empowers merchants to accept cryptocurrency payments **directly wallet-to-wallet** — without intermediaries, preserving custody, lowering fees, and enhancing privacy.

---

## 📖 Contents

- [`prd.md`](./prd.md) – Product Requirement Document (technical + business flow, drop-in TypeScript snippets)
- [`swagger.json`](./swagger.json) – OpenAPI schema of the external API
- API reference: https://docs.paymento.io

---

## 🚀 Quick Start

Base URL: `https://api.paymento.io` · every call sends `Api-Key: <YOUR_API_KEY>`.

### 0. Set the IPN URL (once per store)

```bash
POST /v1/payment/settings
Body: { "ipN_URL": "https://merchant.com/api/paymento/ipn", "ipN_Method": 1 }
```

`ipN_Method`: `1` = POST, `2` = PUT. Any other value (including `0`) is sent as **PUT**.

### 1. Create Payment

```bash
POST /v1/payment/request
Body: { fiatAmount, fiatCurrency, returnUrl, orderId, riskSpeed }
```

→ `{ success, message, body: token }`. Failures return HTTP 200 with `success: false` and a `message` — check `success` before redirecting.

### 2. Redirect Customer

```
https://app.paymento.io/gateway?token=YOUR_TOKEN
```

### 3. Receive Callback (IPN)

- Body (PascalCase): `{ Token, PaymentId, OrderId, OrderStatus, AdditionalData }` — `PaymentId`/`OrderId` are strings, `OrderStatus` an integer
- Verify the `X-HMAC-SHA256-SIGNATURE` header: uppercase hex HMAC-SHA256 of the raw body with your secret key; answer `401` on mismatch

### 4. Verify Payment

```bash
POST /v1/payment/verify { token }
```

→ `{ success, message, body: { token, orderId, orderStatus, additionalData, settlement } }`

- `success` is `true` **only** when the order is `Approve (8)`. `success: false` is not an error — branch on `body.orderStatus`.
- The first verify on a `Paid (7)` order moves it to `Approve (8)`.
- `message: "Invalid Token"` means the token is unknown or belongs to another store.

---

## ✅ Status Codes

| Code | Status | Meaning |
|------|--------|---------|
| 0 | Initialize | Payment request created |
| 1 | Pending | User selected coin |
| 2 | PartialPaid | User underpaid |
| 3 | WaitingToConfirm | TX in mempool/block |
| 4 | Timeout | Payment expired |
| 5 | UserCanceled | User canceled at gateway |
| 7 | Paid | Confirmed on-chain |
| 8 | Approve | Store approved |
| 9 | Reject | Address no longer monitored, or not verified by the store |
| 10 | Refunded | Fully refunded to the payer |

`6` (Revert) is reserved and not produced. Status `1` means the customer chose a coin and an address was issued. `riskSpeed` only changes what the checkout shows the customer; an order reaches `Paid` only after the asset's required confirmations either way.

---

## 🛡️ Security

- All callbacks include an `X-HMAC-SHA256-SIGNATURE` header.
- Always validate using your secret key.
- Never rely solely on the browser redirect — always confirm with the Verify API.

---

## 📂 Repo Structure

```
/prd.md           # Product requirement doc with flows, snippets + acceptance checklist
/swagger.json     # Paymento external API schema
```

---

## 📬 Support

- **Docs**: https://docs.paymento.io
- **Email**: support@paymento.io
- **Community**: Telegram + Discord https://paymento.io/contact-us
