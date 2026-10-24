# Node.js / TypeScript reference

Drop-in code for a Node.js backend (Express shown; the same functions work in Next.js route handlers, Fastify or serverless functions). Every block here is exercised by `tests/check-nodejs-reference.ts` in the [paymento/ai](https://github.com/paymento/ai) repository.

Environment (server-side only):

```
PAYMENTO_API_BASE=https://api.paymento.io
PAYMENTO_API_KEY=...
PAYMENTO_IPN_SECRET=...
PAYMENTO_RETURN_URL=https://merchant.example/payments/return
```

`Orders` and `PaymentoInbox` stand for the app's own persistence. Implement them against the app's database:

| Function | Contract |
| --- | --- |
| `PaymentoInbox.save(token)` | Insert a new row (`id`, `token`, `receivedAt`, `processedAt = null`); return its id. Durable before it returns. |
| `PaymentoInbox.markProcessed(id)` | Set `processedAt` on that row only. |
| `PaymentoInbox.pending()` | Rows with `processedAt = null`, oldest first. |
| `Orders.withPaymentoLock(token, fn)` | Run `fn` while holding a lock shared by every process (Postgres `pg_advisory_xact_lock(hashtext(token))`, MySQL `GET_LOCK`, or `SELECT … FOR UPDATE` on a row keyed by token). Never an in-memory mutex. |
| `Orders.applyPaymentoStatus(orderId, status)` | Idempotent. Never move a paid order (7/8) back to an unpaid status; only `10 Refunded` may follow. |

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

**Process one callback per token at a time.** The HTTP handler and the retry job can pick up the same token together; without serialization an earlier Verify (`WaitingToConfirm`) can write its result after a later one (`Approve`) and revert your order. `Orders.withPaymentoLock(token, fn)` must be a lock shared by every process — e.g. Postgres `pg_advisory_xact_lock(hashtext(token))` or `SELECT … FOR UPDATE` on a row keyed by the token — never an in-memory mutex. Separately, `Orders.applyPaymentoStatus` must never move a paid order (`Paid 7` / `Approve 8`) back to an unpaid status; only `Refunded (10)` may follow. A merchant order can have several tokens (a customer who retries checkout), and an abandoned one still reports `Timeout` or `UserCanceled` later.

```ts
export async function processPaymentoCallback(id:string, token:string){
  await Orders.withPaymentoLock(token, async ()=>{
    const verified = await paymento.verify(token);   // source of truth; moves Paid → Approve, safe to repeat
    await Orders.applyPaymentoStatus(verified.orderId, verified.orderStatus);   // idempotent, never un-pays
  });
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
