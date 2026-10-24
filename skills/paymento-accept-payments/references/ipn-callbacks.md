# IPN callbacks and the return URL

## What Paymento sends

A server-to-server request to the store's IPN URL whenever the order status changes.

- Method: POST if `ipN_Method` is `1`, otherwise PUT.
- `Content-Type: application/json`.
- Header `X-HMAC-SHA256-Signature`: uppercase hex HMAC-SHA256 of the raw body.
- Body (PascalCase):

```json
{"Token":"d1179e54e58d4e51a285a5c659a2b7ef","PaymentId":"20016","OrderId":"etp-3900","OrderStatus":7,"AdditionalData":[{"Key":"invoice-number","Value":"A-578"}]}
```

`PaymentId` and `OrderId` are strings; `OrderStatus` is an integer (see the status table in SKILL.md). Treat the body as a hint: the token is what you verify.

## Checking the signature

1. Read the raw request bytes before any JSON parsing or body-parser middleware rewrites them.
2. Compute HMAC-SHA256 over those bytes with the store's secret key, used as UTF-8 text (not hex- or base64-decoded).
3. Hex-encode the result in uppercase.
4. Compare with the header in constant time. Missing header or mismatch: answer `401` and do nothing else.

Framework notes:
- Express: `express.raw({ type: "application/json" })` on the IPN route only.
- Next.js App Router: `await request.text()` (or `arrayBuffer()`), check, then `JSON.parse`.
- Laravel / PHP: `$request->getContent()` or `file_get_contents('php://input')`.
- Django: `request.body`; Flask: `request.get_data()`.
- ASP.NET Core: enable buffering and read `Request.Body` before model binding.

## Processing safely

Paymento retries a failed callback only while the order is still `Paid`: after 1 minute, 5 minutes, 30 minutes, 2 hours, 12 hours and 24 hours (7 attempts in total). Callbacks for other statuses are not retried, and the first successful verify moves `Paid` to `Approve`, which ends the retries. So the integration owns its own retries, and **verify is called only from the processing step below** — never directly from a return page, an admin "check status" button or a cron job. A verify outside this flow can approve a `Paid` order whose callback never arrived, ending Paymento's retries with nothing stored to fulfil it.

1. Check the signature.
2. Insert a **new row** for this callback (`id`, `token`, `received_at`, `processed_at NULL`). One row per callback, not per token, so an earlier status can never mark a later one done. If this insert fails, answer `5xx` (Paymento may retry).
3. Process the row: under a cross-process lock for the token, call verify, then update the order from `body.orderStatus`; then set `processed_at`.
4. Answer `2xx` once the row is stored, even if processing failed. The row stays pending.
5. A job (every minute) reprocesses pending rows. Alert on rows pending for more than an hour.

Order update rules:
- Idempotent: applying the same status twice changes nothing.
- Never move a paid order (`7`/`8`) back to an unpaid status; only `10 Refunded` may follow. An abandoned token of the same store order can still report `Timeout` or `UserCanceled` after another token paid.
- Fulfil on `7` or `8`, never on `3`.

On serverless platforms, finish processing before returning the response (as the Node.js reference does), because work after the response may be killed; the retry job covers failures.

## The return URL

When the customer leaves the gateway, the browser is redirected with a GET:

```
https://merchant.example/payments/return?token=3256e147…&orderId=etp-3900&status=3
```

It is not signed and anyone can build it. Never fulfil or cancel an order from its parameters.

Show the customer the status **stored on your order**. To refresh it (useful when the IPN was lost), only for a token your store created and saved with the order, and only while that order is not final: insert an inbox row for the token and run the same locked processor as a callback, then show the stored status. Ignore unknown tokens, so a crafted URL cannot fill the inbox. The Node.js reference's `paymentoReturnStatus` does exactly this.

## Testing

`scripts/send-test-ipn.mjs` sends a correctly signed callback to a local or tunnelled IPN URL:

```bash
PAYMENTO_IPN_SECRET=your-secret node scripts/send-test-ipn.mjs http://localhost:3000/api/paymento/ipn --token TOKEN --status 7
```

Add `--bad-signature` to check the `401` path and `--method PUT` to check the PUT route. A test callback carries a token Paymento may not know; verify then returns `Invalid Token`, which the handler must leave pending without changing any order. For a full end-to-end run, make a real testnet payment: <https://docs.paymento.io/accept-crypto-payments/testing-and-simulation>.
