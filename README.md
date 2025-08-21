# Paymento Integration Guide

This repository contains the official **PRD (Product Requirement Document)** for integrating with the Paymento non-custodial payment gateway.

Paymento empowers merchants to accept cryptocurrency payments **directly wallet-to-wallet** — without intermediaries, preserving custody, lowering fees, and enhancing privacy.

---

## 📖 Contents

- [`prd.md`](./prd.md) – Product Requirement Document (technical + business flow)
- Example code snippets (TypeScript, Node.js, .NET)
- API references (Swagger + docs)

---

## 🚀 Quick Start

### 1. Create Payment

```bash
POST /v1/payment/request
Headers: Api-Key: <YOUR_API_KEY>
Body: { fiatAmount, fiatCurrency, returnUrl, orderId, riskSpeed }
```

→ Receive a token

### 2. Redirect Customer

```
https://app.paymento.io/gateway?token=YOUR_TOKEN
```

### 3. Receive Callback (IPN)

- Verify the `X-HMAC-SHA256-SIGNATURE` header
- Use raw POST body + your Paymento secret to validate

### 4. Verify Payment

```bash
POST /v1/payment/verify { token }
```

→ Returns `{ orderId, orderStatus }`

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
| 9 | Reject | Store rejected |

---

## 🛡️ Security

- All callbacks include an `X-HMAC-SHA256-SIGNATURE` header.
- Always validate using your secret key.
- Never rely solely on the browser redirect — always confirm with the Verify API.

---

## 📂 Repo Structure

```
/prd.md           # Product requirement doc with flows + acceptance checklist
/examples/        # Sample code snippets (TS, Node, .NET)
/swagger.json     # Full Paymento API schema
```

---

## 📬 Support

- **Docs**: https://paymento.io
- **Email**: support@paymento.io
- **Community**: Telegram + Discord https://paymento.io/contact-us
