# Cursor Rule: Standard Integration of Paymento (v1)

**Purpose**: Make Cursor reliably scaffold identical, production‑grade Paymento integrations across stacks.

## Golden Flow
1. **Create Payment** → `POST /v1/payment/request` with `{fiatAmount, fiatCurrency, returnUrl, orderId, riskSpeed, language, emailAddress, cryptoAmounts?, additionalData?}`. Receive **token**.
2. **Redirect** customer to **`https://app.paymento.io/gateway?token={token}`**.
3. **IPN**: Receive callback at your **IPN URL** (set via `POST /v1/payment/settings`). Verify the **HMAC‑SHA256** signature header.
4. **Verify**: Call `POST /v1/payment/verify { token }` to finalize the order. Treat redirect status as advisory only; IPN+Verify are source of truth.

## Hard Constraints
- **Auth**: Send `Api-Key: <merchant_key>` on all calls.
- **Security**: Verify header `X-HMAC-SHA256-SIGNATURE` using raw request body and your secret; compare **uppercase hex** HMAC‑SHA256.
- **Idempotency**: Upstream supports idempotent behavior by token; your fulfillment must be idempotent (check order state before changes).
- **Statuses** (int codes): `0 Initialize`, `1 Pending`, `2 PartialPaid`, `3 WaitingToConfirm`, `4 Timeout`, `5 UserCanceled`, `7 Paid`, `8 Approve`, `9 Reject`.
- **Speed / Risk**: `riskSpeed` — `0=High` (accept on mempool), `1=Low` (accept on confirmations). Merchants choose.
- **Never** assume payment complete from the browser redirect; always Verify API.

## API Surface (v1)
- `POST /v1/payment/request` → `{ body: token }`
- `POST /v1/payment/verify` → `{ body: { token, orderId, orderStatus, additionalData[] } }`
- `POST /v1/payment/settings` & `GET /v1/payment/settings` → configure/read IPN URL + HTTP method.
- Supporting reads: `GET /v1/payment/coins`, `GET /v1/coins`, `POST /v1/coins/price`, `GET /v1/currencies`, `GET /v1/languages`, `GET /v1/ping`, `GET /v1/ping/merchant`.

## Standard Project Layout (generated)
```
/src/paymento/
  client.ts            # OpenAPI client wrapper
  types.ts             # Typed models (VerifyResponse, Status enum)
  service.ts           # request(), verify(), getSettings(), setSettings()
/api/paymento/
  ipn.ts               # IPN endpoint with HMAC verification
  return.ts            # Browser return URL handler (advisory)
/checkout/
  createCharge.ts      # calls request(), returns token & gateway URL
  ui.tsx               # button, redirect logic, errors
/tests/
  ipn.spec.ts          # signature + idempotency tests
  e2e.request.spec.ts  # request→gateway→ipn→verify flow (mock IPN)
```

## Required Config (env)
```
PAYMENTO_API_BASE=https://api.paymento.io
PAYMENTO_API_KEY=...
PAYMENTO_IPN_SECRET=...
PAYMENTO_RETURN_URL=https://merchant.com/payments/return
PAYMENTO_IPN_URL=https://merchant.com/api/paymento/ipn
```

## TypeScript Snippets (drop‑in)
**Create payment → get gateway URL**
```ts
import { request } from "./paymento/service";
export async function createGatewayUrl(input:{orderId:string; amount:string; currency:string}){
  const token = await request({
    fiatAmount: input.amount,
    fiatCurrency: input.currency,
    returnUrl: process.env.PAYMENTO_RETURN_URL!,
    orderId: input.orderId,
    riskSpeed: 0,
  });
  return `https://app.paymento.io/gateway?token=${token}`;
}
```

**Verify IPN signature (Node/TS)**
```ts
import crypto from "crypto";
export function verifyIpnSignature(rawBody:Buffer, signature:string){
  const h = crypto.createHmac("sha256", process.env.PAYMENTO_IPN_SECRET!)
                  .update(rawBody)
                  .digest("hex")
                  .toUpperCase();
  if(h !== signature) throw new Error("INVALID_SIGNATURE");
}
```

**IPN handler (Express)**
```ts
app.post("/api/paymento/ipn", express.raw({type:"application/json"}), async (req,res)=>{
  const sig = req.headers["x-hmac-sha256-signature"] as string;
  verifyIpnSignature(req.body, sig);
  const { Token: token } = JSON.parse(req.body.toString());
  const verify = await paymento.verify({ token });
  await Orders.fulfillIfUnfulfilled(verify.orderId, verify.orderStatus);
  res.sendStatus(200);
});
```

**OpenAPI client wrapper**
```ts
async function call<T>(path:string, init:RequestInit):Promise<T>{
  const r = await fetch(`${process.env.PAYMENTO_API_BASE}${path}`, {
    ...init,
    headers:{
      "Api-Key": process.env.PAYMENTO_API_KEY!,
      "Content-Type":"application/json",
      Accept:"application/json",
      ...(init.headers||{})
    }
  });
  if(!r.ok) throw new Error(`PAYMENTO_HTTP_${r.status}`);
  const json = await r.json();
  return json.body as T;
}
export const paymento = {
  request: (body:any) => call<string>("/v1/payment/request", {method:"POST", body:JSON.stringify(body)}),
  verify:  (body:any) => call<{token:string;orderId:string;orderStatus:number;additionalData?:{key:string;value:string}[]}>("/v1/payment/verify", {method:"POST", body:JSON.stringify(body)}),
  setSettings: (body:any) => call("/v1/payment/settings", {method:"POST", body:JSON.stringify(body)}),
  getSettings: () => call("/v1/payment/settings", {method:"GET"})
};
```

## Acceptance Checklist (Cursor must satisfy)
- [ ] Uses `Api-Key` header on all API calls.
- [ ] Redirects to `gateway?token=...` after `request`.
- [ ] IPN endpoint exists and **verifies HMAC** with **uppercase hex**.
- [ ] Calls **Verify API** on IPN; fulfillment is **idempotent**.
- [ ] Status codes mapped and user‑visible order states updated.
- [ ] Errors bubble with machine‑readable codes; logs include `{orderId, token, status}`.
- [ ] E2E tests cover partial, timeout, cancel, paid, approve, reject.

---

# PRD: Paymento Integration (v1)

## Objective & Success
Enable any web/app backend to accept crypto via Paymento with a single flow.
- **TTFP**: < 2 hours from API key to first verified order.
- **Verification**: > 99.5% IPN HMAC validated.
- **Idempotency**: 0 duplicate fulfillments in tests.

## Scope (v1)
**In**: Create/Verify payment, IPN setup, HMAC verification, redirect flow, status mapping, language/coins listing, health checks.
**Out**: On‑chain address derivation, custody, fiat off‑ramp, refunds (future), split payments.

## Personas
- Plugin dev (Shopify / Woo / OpenCart), SaaS engineer, mobile app backend.

## User Stories
- As a merchant, I send `payment/request`, get a token, and redirect to the gateway.
- As a backend, I verify IPN via HMAC and confirm via `payment/verify`.
- As a storefront, I display available coins and localized labels.

## Detailed Flow
1. **Request**: backend calls `POST /v1/payment/request`.
2. **Redirect**: browser → `gateway?token`.
3. **IPN**: Paymento calls merchant IPN with body `{ Token, PaymentId, OrderId, OrderStatus, AdditionalData[] }` and header signature.
4. **Verify**: backend calls `POST /v1/payment/verify` with `{ token }`.
5. **Fulfill**: if status is `Paid(7)` or `Approve(8)`, mark order paid; handle `PartialPaid(2)`, `Timeout(4)`, `Reject(9)` per business rules.

## API Contract Notes
- Headers: `Api-Key`, `Content-Type: application/json`, `Accept: application/json|text/plain`.
- Settings: `POST/GET /v1/payment/settings` to set/read **IPN URL** and HTTP method.
- Listings: `GET /v1/payment/coins`, `GET /v1/coins`, `POST /v1/coins/price`, `GET /v1/currencies`, `GET /v1/languages`.
- Health: `GET /v1/ping`, `GET /v1/ping/merchant`.

## Status Mapping (enum → UI)
```
0 Initialize        → "Created"
1 Pending          → "Waiting for selection"
2 PartialPaid      → "Partially paid"
3 WaitingToConfirm → "Awaiting confirmations"
4 Timeout          → "Expired"
5 UserCanceled     → "Canceled by user"
7 Paid             → "Paid (confirmed)"
8 Approve          → "Approved by store"
9 Reject           → "Rejected"
```

## Non‑Functional
- **Observability**: Log correlation IDs; capture raw IPN signature and hash match boolean.
- **Resilience**: Retry Verify with backoff on 5xx; never retry IPN responses.
- **Security**: Validate token shape; reject if signature mismatch.

## Test Cases
- Valid IPN + Verify (+Paid, +Approve)
- Duplicate IPN (ignored)
- PartialPaid → manual review
- Timeout → auto-cancel
- UserCanceled → noop
- Reject → refund or re‑issue (business‑defined)


## Rollout & Docs
- README with env vars + quickstart.
- Status table + flow diagram.

**Consequences if skipped**: Without IPN+Verify/HMAC, merchants can be spoofed; without idempotency, orders duplicate; without status mapping, support load increases.

