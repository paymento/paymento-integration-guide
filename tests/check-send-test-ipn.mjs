// Checks scripts/send-test-ipn.mjs signs callbacks the way the reference handler verifies them.
// node tests/check-send-test-ipn.mjs
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "../skills/paymento-accept-payments/scripts/send-test-ipn.mjs");
const secret = "test-secret";
const seen = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c)).on("end", () => {
    const raw = Buffer.concat(chunks);
    const expected = Buffer.from(crypto.createHmac("sha256", secret).update(raw).digest("hex").toUpperCase());
    const got = Buffer.from(String(req.headers["x-hmac-sha256-signature"] ?? ""));
    const ok = expected.length === got.length && crypto.timingSafeEqual(expected, got);
    seen.push({ method: req.method, ok, body: JSON.parse(raw) });
    res.writeHead(ok ? 200 : 401).end();
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/ipn`;
// Async spawn: the test server shares this event loop, so a blocking spawn would deadlock.
const run = (...args) => new Promise((resolve) =>
  execFile(process.execPath, [script, url, ...args], { env: { ...process.env, PAYMENTO_IPN_SECRET: secret }, timeout: 10000 },
    (err) => resolve(err ? err.code ?? 1 : 0)));
const check = (cond, msg) => { if (!cond) { server.close(); throw new Error(msg); } };

check(await run("--token", "abc", "--status", "8", "--order-id", "o-1") === 0, "valid callback rejected");
check(seen.at(-1).ok && seen.at(-1).method === "POST" && seen.at(-1).body.Token === "abc" && seen.at(-1).body.OrderStatus === 8 && seen.at(-1).body.OrderId === "o-1", "valid callback content wrong");
check(await run("--method", "PUT") === 0 && seen.at(-1).method === "PUT", "PUT not sent");
check(await run("--bad-signature") === 0 && seen.at(-1).ok === false, "bad signature accepted");
server.close();
console.log("send-test-ipn: all checks passed");
