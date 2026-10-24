# Python, PHP and C# snippets

The building blocks for stacks other than Node.js. Structure the integration exactly like [nodejs.md](nodejs.md): an API client that checks `success`, an IPN route that checks the signature, stores the callback and answers `2xx`, a processor that verifies and updates the order under a lock, and a retry job.

## Python

```python
import hashlib, hmac, os
import requests  # pip install requests

API = os.environ.get("PAYMENTO_API_BASE", "https://api.paymento.io")
HEADERS = {"Api-Key": os.environ["PAYMENTO_API_KEY"], "Accept": "application/json"}

def is_valid_ipn_signature(raw_body: bytes, signature: str | None) -> bool:
    if not signature:
        return False
    expected = hmac.new(os.environ["PAYMENTO_IPN_SECRET"].encode(), raw_body, hashlib.sha256).hexdigest().upper()
    return hmac.compare_digest(expected, signature.strip().upper())

def create_payment(order_id: str, amount: str, currency: str, return_url: str) -> str:
    r = requests.post(f"{API}/v1/payment/request", headers=HEADERS, timeout=30, json={
        "fiatAmount": amount, "fiatCurrency": currency, "returnUrl": return_url, "orderId": order_id})
    r.raise_for_status()
    res = r.json()
    if not res["success"] or not (res["body"] or "").strip():  # refusals are HTTP 200
        raise RuntimeError(f"PAYMENTO_REQUEST_FAILED: {res['message']}")
    return res["body"].strip()

def verify(token: str) -> dict:
    r = requests.post(f"{API}/v1/payment/verify", headers=HEADERS, timeout=30, json={"token": token})
    r.raise_for_status()
    res = r.json()
    if not res["body"]["token"]:  # "Invalid Token"; success=false alone is normal
        raise RuntimeError(f"PAYMENTO_VERIFY_FAILED: {res['message']}")
    return res["body"]  # branch on body["orderStatus"]
```

Raw body: Django `request.body`, Flask `request.get_data()`, FastAPI `await request.body()`. Header: `request.headers.get("X-HMAC-SHA256-Signature")`.

## PHP

```php
<?php
function paymento_call(string $method, string $path, ?array $body = null): array {
    $ch = curl_init((getenv('PAYMENTO_API_BASE') ?: 'https://api.paymento.io') . $path);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_HTTPHEADER     => ['Api-Key: ' . getenv('PAYMENTO_API_KEY'), 'Content-Type: application/json', 'Accept: application/json'],
        CURLOPT_POSTFIELDS     => $body === null ? null : json_encode($body),
    ]);
    $raw = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($raw === false || $status >= 400) {
        throw new RuntimeException("PAYMENTO_HTTP_$status");
    }
    return json_decode($raw, true);
}

function paymento_create_payment(string $orderId, string $amount, string $currency, string $returnUrl): string {
    $res = paymento_call('POST', '/v1/payment/request', [
        'fiatAmount' => $amount, 'fiatCurrency' => $currency, 'returnUrl' => $returnUrl, 'orderId' => $orderId,
    ]);
    if (empty($res['success']) || trim((string) $res['body']) === '') { // refusals are HTTP 200
        throw new RuntimeException('PAYMENTO_REQUEST_FAILED: ' . $res['message']);
    }
    return trim($res['body']);
}

function paymento_verify(string $token): array {
    $res = paymento_call('POST', '/v1/payment/verify', ['token' => $token]);
    if (empty($res['body']['token'])) { // "Invalid Token"; success=false alone is normal
        throw new RuntimeException('PAYMENTO_VERIFY_FAILED: ' . $res['message']);
    }
    return $res['body']; // branch on $body['orderStatus']
}

function paymento_signature_valid(string $rawBody, ?string $signature): bool {
    if ($signature === null || trim($signature) === '') {
        return false;
    }
    $expected = strtoupper(hash_hmac('sha256', $rawBody, getenv('PAYMENTO_IPN_SECRET')));
    return hash_equals($expected, strtoupper(trim($signature)));
}

// IPN route (plain PHP). Laravel: $request->getContent() and $request->header('X-HMAC-SHA256-Signature').
$raw = file_get_contents('php://input');
if (!paymento_signature_valid($raw, $_SERVER['HTTP_X_HMAC_SHA256_SIGNATURE'] ?? null)) {
    http_response_code(401);
    exit;
}
$token = json_decode($raw, true)['Token'];
// store a new inbox row for $token, then process it under a lock (see nodejs.md); answer 200 once stored
```

## C# (.NET)

```csharp
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

public sealed class PaymentoClient(HttpClient http)  // BaseAddress https://api.paymento.io, header Api-Key set at registration
{
    public static bool IsValidIpnSignature(byte[] rawBody, string? signature, string secret)
    {
        if (string.IsNullOrWhiteSpace(signature)) return false;
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var expected = Convert.ToHexString(hmac.ComputeHash(rawBody));  // uppercase
        return CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(signature.Trim().ToUpperInvariant()));
    }

    public async Task<string> CreatePaymentAsync(string orderId, string amount, string currency, string returnUrl)
    {
        var res = await PostAsync("/v1/payment/request", new { fiatAmount = amount, fiatCurrency = currency, returnUrl, orderId });
        var token = res.GetProperty("body").GetString()?.Trim();
        if (!res.GetProperty("success").GetBoolean() || string.IsNullOrEmpty(token))  // refusals are HTTP 200
            throw new InvalidOperationException($"PAYMENTO_REQUEST_FAILED: {res.GetProperty("message").GetString()}");
        return token;
    }

    public async Task<JsonElement> VerifyAsync(string token)
    {
        var res = await PostAsync("/v1/payment/verify", new { token });
        var body = res.GetProperty("body");
        if (string.IsNullOrEmpty(body.GetProperty("token").GetString()))  // "Invalid Token"; success=false alone is normal
            throw new InvalidOperationException($"PAYMENTO_VERIFY_FAILED: {res.GetProperty("message").GetString()}");
        return body;  // branch on body.GetProperty("orderStatus").GetInt32()
    }

    private async Task<JsonElement> PostAsync(string path, object body)
    {
        using var response = await http.PostAsJsonAsync(path, body);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }
}
```

ASP.NET Core IPN route: call `Request.EnableBuffering()`, copy `Request.Body` to a byte array before any model binding, check the signature, then deserialize. Map both `MapPost` and `MapPut` unless the store's `ipN_Method` is `1`.
