#!/usr/bin/env node
// Sends a Paymento-style IPN callback, signed the way Paymento signs it, to an IPN URL under test.
// Usage: PAYMENTO_IPN_SECRET=... node send-test-ipn.mjs <ipn-url> [--token T] [--order-id O]
//        [--status 7] [--payment-id P] [--method POST|PUT] [--bad-signature]
import crypto from "node:crypto";

const args = process.argv.slice(2);
const url = args[0]?.startsWith("--") ? undefined : args[0];
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const secret = process.env.PAYMENTO_IPN_SECRET;

if (!url || !secret) {
  console.error("Usage: PAYMENTO_IPN_SECRET=... node send-test-ipn.mjs <ipn-url> [--token T] [--order-id O] [--status 7] [--payment-id P] [--method POST|PUT] [--bad-signature]");
  process.exit(2);
}

// Same key order and casing as Paymento's callback body.
const body = JSON.stringify({
  Token: opt("token", crypto.randomBytes(16).toString("hex")),
  PaymentId: opt("payment-id", "20016"),
  OrderId: opt("order-id", "test-order-1"),
  OrderStatus: Number(opt("status", "7")),
  AdditionalData: [],
});
let signature = crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex").toUpperCase();
if (args.includes("--bad-signature")) signature = signature.replace(/^./, (c) => (c === "0" ? "1" : "0"));

const res = await fetch(url, {
  method: opt("method", "POST").toUpperCase(),
  headers: { "Content-Type": "application/json", Accept: "application/json", "X-HMAC-SHA256-Signature": signature },
  body,
});
console.log(`${res.status} ${res.statusText}`);
console.log(`sent: ${body}`);
const text = await res.text();
if (text) console.log(`response: ${text.slice(0, 500)}`);
process.exit(res.ok || (args.includes("--bad-signature") && res.status === 401) ? 0 : 1);
