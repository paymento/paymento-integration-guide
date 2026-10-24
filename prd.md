# Cursor Rule: Standard Integration of Paymento (v1)

**Purpose**: Make Cursor reliably scaffold identical, production‑grade Paymento integrations across stacks.

## Golden Flow

1. **Configure IPN once** → `POST /v1/payment/settings` with `{ ipN_URL, ipN_Method: 1 }`. This is a persistent store-level setting, not per payment. `ipN_Method` `1` = POST, `2` = PUT; **any other value (including `0`) is sent as PUT**.
2. **Create Payment** → `POST /v1/payment/request` with `{fiatAmount, fiatCurrency, returnUrl, orderId, riskSpeed?, language?, emailAddress?, tokenExpiryDate?, cryptoAmounts?, additionalData?}`. Check `success`, then read the **token** from `body`.
3. **Redirect** customer to **`https://app.paymento.io/gateway?token={token}`**.
4. **IPN**: Receive the callback at your IPN URL. Verify the **HMAC‑SHA256** signature header; answer `401` if it does not match.
5. **Verify**: Call `POST /v1/payment/verify { token }` and act on `body.orderStatus`. Treat the redirect and the IPN body as hints only; Verify is the source of truth.

## Hard Constraints

* **Auth**: Send `Api-Key: <merchant_key>` on all calls.
* **Envelope**: Every response is `{ success, message, body }`. **`payment/request` failures return HTTP 200 with `success: false`** and a human-readable `message` (e.g. `"Please set amount"`) — always check `success` before using `body`.
* **Verify semantics**: `success` is `true` **only** when the order is `Approve (8)` after the call. `success: false` is **not** an error (a payment two confirmations short returns it). Branch on `body.orderStatus`. An unknown token, or one belonging to another store, returns `message: "Invalid Token"` with an empty `body.token`.
* **Verify approves**: The first verify on a `Paid (7)` order moves it to `Approve (8)`. Verifying again is safe and still returns `success: true`.
* **Security**: Verify header `X-HMAC-SHA256-SIGNATURE` over the **raw request body** with your secret key (used as UTF‑8 text); the signature is **uppercase hex** HMAC‑SHA256. Compare in constant time.
* **Idempotency**: Your fulfillment must be idempotent (check order state before changes). Paymento itself returns the same token for an identical `payment/request` body sent again shortly after, while that order is still `Initialize`.
* **Statuses** (integers in JSON): `0 Initialize`, `1 Pending`, `2 PartialPaid`, `3 WaitingToConfirm`, `4 Timeout`, `5 UserCanceled`, `7 Paid`, `8 Approve`, `9 Reject`, `10 Refunded`. `6 Revert` is reserved and not produced. `Paid`, `Approve`, `Reject` and `Refunded` are final.
* **Speed / Risk**: `riskSpeed` (optional, default `0`) — `0=High`: the checkout tells the customer the payment was received as soon as it is seen on-chain (mempool/block); `1=Low`: the checkout waits for confirmations. **Either way, the order only becomes `Paid` after the asset's required confirmations** — `riskSpeed` changes the customer experience, not when you may fulfil.
* **Never** assume payment complete from the browser redirect; always Verify API.

## API Surface (v1)

Base URL: `https://api.paymento.io`

* `POST /v1/payment/request` → `{ success, message, body: token }`
* `POST /v1/payment/verify` → `{ success, message, body: { token, orderId, orderStatus, additionalData[], settlement? } }`
* `POST /v1/payment/settings` & `GET /v1/payment/settings` → configure/read `{ ipN_URL, ipN_Method }`.
* Supporting reads: `GET /v1/payment/coins`, `GET /v1/coins`, `POST /v1/coins/price`, `GET /v1/currencies`, `GET /v1/languages`, `GET /v1/ping`, `GET /v1/ping/merchant`.

`settlement` (present on every authorized verify) carries on-chain data so you need no blockchain API of your own: `expectedCryptoAmount`, `requestedFiatAmount`, `receivedCryptoAmount`, `pendingTxHash`, `toAddress`, `asset`, `network`, `standard`, `contractAddress`, and `transactions[]` with `txHash`, `explorerUrl`, `amount`, `confirmations`, `requiredConfirmations`, `status` (integer: `0 Pending`, `1 Mempool`, `2 InBlock`, `3 Completed`, `4 Revert`, `5 UnWatch`, `6 Invalid`), `blockHeight`, `detectedAt`, `confirmedAt`, `fromAddresses`, `toAddress`. Fields may be `null` (e.g. `confirmations` while in mempool). Never hardcode confirmation counts — read `requiredConfirmations`.

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

**Types**

```ts
export enum OrderStatus {
  Initialize = 0, Pending = 1, PartialPaid = 2, WaitingToConfirm = 3, Timeout = 4,
  UserCanceled = 5, Revert = 6 /* reserved */, Paid = 7, Approve = 8, Reject = 9, Refunded = 10,
}
export type Envelope<T> = { success: boolean; message: string; body: T };
export type VerifyResponse = {
  token: string;
  orderId: string;
  orderStatus: OrderStatus;
  additionalData: { key: string; value: string }[];
  settlement?: {
    expectedCryptoAmount: number | null;
    requestedFiatAmount: number | null;
    receivedCryptoAmount: number | null;
    toAddress: string | null;
    asset: string | null;
    network: string | null;
    transactions: { txHash: string; amount: number | null; confirmations: number | null;
                    requiredConfirmations: number | null; status: number }[];
  } | null;
};
```

**OpenAPI client wrapper**

```ts
async function call<T>(path:string, init:RequestInit):Promise<Envelope<T>>{
  const r = await fetch(`${process.env.PAYMENTO_API_BASE}${path}`, {
    ...init,
    headers:{
      "Api-Key": process.env.PAYMENTO_API_KEY!,
      "Content-Type":"application/json",
      Accept:"application/json",
      ...(init.headers||{})
    }
  });
  // 4xx here means a missing/invalid Api-Key or a malformed request.
  if(!r.ok) throw new Error(`PAYMENTO_HTTP_${r.status}: ${await r.text()}`);
  return r.json() as Promise<Envelope<T>>;
}

export const paymento = {
  async request(body:Record<string, unknown>):Promise<string>{
    const res = await call<string>("/v1/payment/request", {method:"POST", body:JSON.stringify(body)});
    // Business-rule failures come back as HTTP 200 with success=false.
    if(!res.success || !res.body?.trim()) throw new Error(`PAYMENTO_REQUEST_FAILED: ${res.message}`);
    return res.body.trim();
  },
  async verify(token:string):Promise<VerifyResponse>{
    const res = await call<VerifyResponse>("/v1/payment/verify", {method:"POST", body:JSON.stringify({ token })});
    // success=false is normal for every status except Approve; only an empty token means "Invalid Token".
    if(!res.body?.token) throw new Error(`PAYMENTO_VERIFY_FAILED: ${res.message}`);
    return res.body;
  },
  setSettings: (ipnUrl:string) =>
    call("/v1/payment/settings", {method:"POST", body:JSON.stringify({ ipN_URL: ipnUrl, ipN_Method: 1 })}),
  getSettings: () => call<{ ipN_URL:string; ipN_Method:number }>("/v1/payment/settings", {method:"GET"})
};
```

**Create payment → get gateway URL**

```ts
import { paymento } from "./paymento/service";
export async function createGatewayUrl(input:{orderId:string; amount:string; currency:string}){
  const token = await paymento.request({
    fiatAmount: input.amount,      // "1000.50" — "." decimal point, no thousands separators
    fiatCurrency: input.currency,
    returnUrl: process.env.PAYMENTO_RETURN_URL!,
    orderId: input.orderId,
    riskSpeed: 0,
  });
  return `https://app.paymento.io/gateway?token=${encodeURIComponent(token)}`;
}
```

**Verify IPN signature (Node/TS)**

```ts
import crypto from "crypto";
export function isValidIpnSignature(rawBody:unknown, signature:string|undefined):boolean{
  if(!Buffer.isBuffer(rawBody) || !signature) return false;
  const expected = Buffer.from(
    crypto.createHmac("sha256", process.env.PAYMENTO_IPN_SECRET!).update(rawBody).digest("hex").toUpperCase());
  const received = Buffer.from(signature.trim().toUpperCase());
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}
```

**IPN handler (Express)**

The callback body is PascalCase: `{ Token, PaymentId, OrderId, OrderStatus, AdditionalData: [{ Key, Value }] }`. `PaymentId` and `OrderId` are strings; `OrderStatus` is an integer.

**Store the callback before calling Verify.** Verify moves a `Paid` order to `Approve`, and Paymento only retries callbacks for orders still in `Paid`. If your process fails after Verify but before your order is updated, Paymento will never call again — so the retry has to come from your own store, not from Paymento. `PaymentoInbox` is a durable table (one row per callback: `id`, `token`, `processedAt`).

```ts
export async function processPaymentoCallback(id:string, token:string){
  const verified = await paymento.verify(token);   // source of truth; moves Paid → Approve, safe to repeat
  await Orders.applyPaymentoStatus(verified.orderId, verified.orderStatus);   // idempotent
  await PaymentoInbox.markProcessed(id);
}

const ipnHandler:express.RequestHandler = async (req,res,next)=>{
  let id:string, token:string;
  try{
    if(!isValidIpnSignature(req.body, req.get("x-hmac-sha256-signature"))) return res.sendStatus(401);
    ({ Token: token } = JSON.parse(req.body.toString("utf8")));
    id = await PaymentoInbox.save(token);   // a new row per callback, so a later status is never marked done by an earlier one
  }catch(err){ return next(err); }   // not stored: answer 5xx (Express 4 does not catch async errors on its own)
  try{ await processPaymentoCallback(id, token); }
  catch(err){ console.error("PAYMENTO_CALLBACK_DEFERRED", id, err); }   // stays pending for the retry job
  res.sendStatus(200);   // stored, so retrying is now our job
};

// Run every minute (cron / queue worker). Alert on rows pending for more than an hour.
export async function retryPendingPaymentoCallbacks(){
  for(const { id, token } of await PaymentoInbox.pending()){
    await processPaymentoCallback(id, token).catch(err => console.error("PAYMENTO_CALLBACK_RETRY", id, err));
  }
}
// Paymento sends PUT unless ipN_Method is 1, so accept both.
app.post("/api/paymento/ipn", express.raw({type:"application/json"}), ipnHandler);
app.put ("/api/paymento/ipn", express.raw({type:"application/json"}), ipnHandler);
```

## Acceptance Checklist (Cursor must satisfy)

* [ ] Uses `Api-Key` header on all API calls.
* [ ] Sets the IPN URL once with `ipN_Method: 1`, or the IPN endpoint accepts both POST and PUT.
* [ ] Checks `success` on `payment/request`; never redirects with an empty token.
* [ ] Redirects to `gateway?token=...` after `request`.
* [ ] IPN endpoint **verifies HMAC** (uppercase hex, constant-time compare) and returns `401` on mismatch or missing header.
* [ ] Persists each authenticated IPN durably **before** calling Verify, and retries unprocessed ones from its own job.
* [ ] Calls **Verify API** on IPN; branches on `body.orderStatus`, not `success`; fulfillment is **idempotent**.
* [ ] Status codes mapped (including `10 Refunded`) and user‑visible order states updated.
* [ ] Errors bubble with machine‑readable codes; logs include `{orderId, token, status}`.
* [ ] E2E tests cover partial, timeout, cancel, paid, approve, reject, refunded.

---

# PRD: Paymento Integration (v1)

## Objective & Success

Enable any web/app backend to accept crypto via Paymento with a single flow.

* **TTFP**: < 2 hours from API key to first verified order.
* **Verification**: > 99.5% IPN HMAC validated.
* **Idempotency**: 0 duplicate fulfillments in tests.

## Scope (v1)

**In**: Create/Verify payment, IPN setup, HMAC verification, redirect flow, status mapping, language/coins listing, health checks.
**Out**: On‑chain address derivation, custody, fiat off‑ramp, refunds (future), split payments.

## Personas

* Plugin dev (Shopify / Woo / OpenCart), SaaS engineer, mobile app backend.

## User Stories

* As a merchant, I send `payment/request`, get a token, and redirect to the gateway.
* As a backend, I verify IPN via HMAC and confirm via `payment/verify`.
* As a storefront, I display available coins and localized labels.
* As a frontend dev, I must not access server-only environment variables in client components.

## Detailed Flow

0. **Setup (once)**: backend calls `POST /v1/payment/settings` with `{ ipN_URL, ipN_Method: 1 }`.
1. **Request**: backend calls `POST /v1/payment/request`; on `success: false` show/log `message` and stop.
2. **Redirect**: browser → `gateway?token`.
3. **IPN**: Paymento calls the merchant IPN URL with body `{ Token, PaymentId, OrderId, OrderStatus, AdditionalData[] }` (PascalCase; `PaymentId`/`OrderId` strings, `OrderStatus` integer) and header `X-HMAC-SHA256-SIGNATURE`.
4. **Persist + Verify**: backend stores the authenticated callback, then calls `POST /v1/payment/verify` with `{ token }`. A `Paid` order becomes `Approve` on this call, which ends Paymento's retries — unprocessed callbacks are retried from the merchant's own store.
5. **Fulfill**: if `body.orderStatus` is `Approve(8)` (or `Paid(7)`), mark order paid. Do **not** fulfil on `WaitingToConfirm(3)`. Handle `PartialPaid(2)`, `Timeout(4)`, `Reject(9)`, `Refunded(10)` per business rules.

⚠️ **Important Implementation Note**: Environment variables (`PAYMENTO_API_KEY`, `PAYMENTO_IPN_SECRET`, etc.) must only be accessed on the **server-side**. If you call `createPayment` or `request()` from client-side code (React components), these secrets will not be available and will break security. Always wrap Paymento API calls inside a server-side API route.

## API Contract Notes

* Base URL: `https://api.paymento.io`.
* Headers: `Api-Key`, `Content-Type: application/json`, `Accept: application/json|text/plain`.
* JSON responses are camelCase with integer enums; the IPN callback body is PascalCase.
* Settings: `POST/GET /v1/payment/settings` to set/read `ipN_URL` and `ipN_Method` (`1` POST, `2` PUT; anything else is sent as PUT).
* Listings: `GET /v1/payment/coins`, `GET /v1/coins`, `POST /v1/coins/price`, `GET /v1/currencies`, `GET /v1/languages`.
* Health: `GET /v1/ping`, `GET /v1/ping/merchant`.

## Environment & Server-Only Policy

- Never expose secrets in the browser. `PAYMENTO_API_KEY` and `PAYMENTO_IPN_SECRET` are server-only.
- All Paymento API calls (/v1/payment/request, /v1/payment/verify, /v1/payment/settings) must be performed on the backend (server, serverless function, edge worker).
- For static sites, use a serverless function (Vercel/Netlify/Cloudflare Workers) to call Paymento APIs.


## Status Mapping (enum → UI)

```
0 Initialize        → "Created"
1 Pending          → "Waiting for payment"
2 PartialPaid      → "Partially paid"
3 WaitingToConfirm → "Awaiting confirmations"
4 Timeout          → "Expired"
5 UserCanceled     → "Canceled by user"
6 Revert           → (reserved, not produced)
7 Paid             → "Paid (confirmed)"
8 Approve          → "Approved by store"
9 Reject           → "Rejected"
10 Refunded        → "Refunded"
```

## Non‑Functional

* **Observability**: Log correlation IDs; capture raw IPN signature and hash match boolean.
* **Resilience**: Paymento retries failed callbacks only while the order is still `Paid`; the first successful Verify moves it to `Approve` and ends those retries, and callbacks for other statuses are never resent. So persist every authenticated IPN in a durable inbox **before** calling Verify, answer `2xx` once it is stored, and retry unprocessed rows (Verify → update order → mark processed) from your own job with backoff until they succeed. Verify and fulfillment are idempotent, so reprocessing is safe. Answer `5xx` only when the callback could not be stored.
* **Security**: Validate token shape; reject if signature mismatch.

## Test Cases

* Valid IPN + Verify (+Paid → Approve)
* IPN with missing or wrong signature → `401`, no state change
* Verify with unknown token → `PAYMENTO_VERIFY_FAILED`, no state change
* `payment/request` returning `success: false` → error surfaced, no redirect
* IPN delivered as PUT (when `ipN_Method` is not 1)
* Order update fails after Verify (order now `Approve`) → callback stays pending and the retry job fulfils it
* Callback cannot be stored → `5xx`, Verify not called
* Duplicate IPN (ignored)
* PartialPaid → manual review
* Timeout → auto-cancel
* UserCanceled → noop
* Reject → refund or re‑issue (business‑defined)
* Refunded → order marked refunded
* Client-side env misuse → ensure API keys are not exposed in frontend bundles.

## Rollout & Docs

* README with env vars + quickstart.
* Status table + flow diagram.

**Consequences if skipped**: Without IPN+Verify/HMAC, merchants can be spoofed; without idempotency, orders duplicate; without status mapping, support load increases. If environment variables are accessed client-side, API keys may leak and integrations will fail.
