# Jurisdiction Controls Verification Runbook (TradeCentral)

Assumptions:
- API base: `http://localhost:5000`
- Postgres: `DATABASE_URL` is set
- PowerShell terminal
- Seeded users from `npm run db:seed`:
  - Admin: `admin@local.test` / `changeme`
  - Demo: `demo@tradingfx.com` / `demo1234`

## 0) Pre-flight (schema + seed + server)

```powershell
cd TradingCentral-3AL-V3
npm run db:ensure
npm run db:seed
npm run dev
```

## 1) DB schema verification

```powershell
@'
import { Client } from "pg";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const db = new Client({ connectionString: url });
await db.connect();
const cols = (await db.query(
  "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='system_config'"
)).rows.map(r => String(r.column_name));
const need = [
  "jurisdiction_restricted_iso2_csv",
  "jurisdiction_restricted_message",
  "jurisdiction_enforce_by_ip_geo",
  "jurisdiction_enforce_by_signup_country",
  "jurisdiction_block_signup",
  "jurisdiction_block_login",
];
console.log("missing:", need.filter(n => !cols.includes(n)));
await db.end();
'@ | node --input-type=module
```

Expected: `missing: []`

## 2) Admin login (PowerShell WebSession)

```powershell
$base = "http://localhost:5000"
$admin = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType "application/json" -Body (@{ email="admin@local.test"; password="changeme" } | ConvertTo-Json) -WebSession $admin
Invoke-RestMethod "$base/api/admin/system-config" -WebSession $admin |
  Select-Object jurisdictionRestrictedIso2Csv,jurisdictionRestrictedMessage,jurisdictionBlockSignup,jurisdictionBlockLogin,jurisdictionEnforceBySignupCountry,jurisdictionEnforceByIpGeo
```

Expected: keys exist; CSV is normalized after save (e.g. `IR,KP`).

## 3) Configure restricted list (admin PUT)

```powershell
$cfg = @{
  jurisdictionRestrictedIso2Csv = "IR,KP"
  jurisdictionRestrictedMessage = "Access restricted due to regulatory sanctions."
  jurisdictionBlockSignup = $true
  jurisdictionBlockLogin = $true
  jurisdictionEnforceBySignupCountry = $true
  jurisdictionEnforceByIpGeo = $false
}
Invoke-RestMethod "$base/api/admin/system-config" -Method Put -ContentType "application/json" -Body ($cfg | ConvertTo-Json) -WebSession $admin
```

## 4) Signup blocked by signup-selected country (no captcha/terms required)

```powershell
$signup = @{
  email="blocked_ir_signup@example.com"
  username="blocked_ir_signup"
  password="Passw0rd!234"
  countryIso2="IR"
  termsToken="dummy_dummy_dummy"
  combinedSha256="dummy_dummy_dummy"
}
try {
  Invoke-RestMethod "$base/api/auth/register" -Method Post -ContentType "application/json" -Body ($signup | ConvertTo-Json)
} catch {
  $_.Exception.Response.StatusCode.value__
  (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd()
}
```

Expected:
- HTTP `403`
- JSON contains `code:"JURISDICTION_RESTRICTED"` and your configured message.

Confirm user NOT created + block audit row inserted:

```powershell
@'
import { Client } from "pg";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const db = new Client({ connectionString: url });
await db.connect();
console.log("users:", (await db.query(
  "SELECT id,email,country_iso2 FROM users WHERE email=$1",
  ["blocked_ir_signup@example.com"]
)).rows);
console.log("blocks:", (await db.query(
  "SELECT reason_code, ip_country_iso2, selected_country_iso2, created_at FROM signup_jurisdiction_blocks WHERE email_lower=$1 ORDER BY id DESC LIMIT 3",
  ["blocked_ir_signup@example.com"]
)).rows);
await db.end();
'@ | node --input-type=module
```

## 5) Signup blocked by IP geo (header simulation)

```powershell
$cfg.jurisdictionEnforceBySignupCountry = $false
$cfg.jurisdictionEnforceByIpGeo = $true
Invoke-RestMethod "$base/api/admin/system-config" -Method Put -ContentType "application/json" -Body ($cfg | ConvertTo-Json) -WebSession $admin

$signup.countryIso2 = "US"
try {
  Invoke-RestMethod "$base/api/auth/register" -Method Post -ContentType "application/json" -Body ($signup | ConvertTo-Json) -Headers @{ "cf-ipcountry"="IR" }
} catch {
  $_.Exception.Response.StatusCode.value__
  (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd()
}
```

Expected: `403` with `blockedBy:["IP_GEO"]`.

## 6) Login blocked by stored user country

```powershell
@'
import { Client } from "pg";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const db = new Client({ connectionString: url });
await db.connect();
await db.query("UPDATE users SET country_iso2=$1 WHERE email=$2", ["IR", "demo@tradingfx.com"]);
await db.end();
'@ | node --input-type=module

$cfg.jurisdictionEnforceBySignupCountry = $true
$cfg.jurisdictionEnforceByIpGeo = $false
Invoke-RestMethod "$base/api/admin/system-config" -Method Put -ContentType "application/json" -Body ($cfg | ConvertTo-Json) -WebSession $admin

try {
  Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType "application/json" -Body (@{ email="demo@tradingfx.com"; password="demo1234" } | ConvertTo-Json)
} catch {
  $_.Exception.Response.StatusCode.value__
  (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd()
}
```

Expected: `403` with `code:"JURISDICTION_RESTRICTED"`.

## 7) Admin self-lockout prevention (must PASS)

```powershell
@'
import { Client } from "pg";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const db = new Client({ connectionString: url });
await db.connect();
await db.query("UPDATE users SET country_iso2=$1 WHERE email=$2", ["IR", "admin@local.test"]);
await db.end();
'@ | node --input-type=module

$admin2 = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType "application/json" -Body (@{ email="admin@local.test"; password="changeme" } | ConvertTo-Json) -WebSession $admin2
Invoke-RestMethod "$base/api/admin/system-config" -WebSession $admin2 | Select-Object id
```

Expected: admin login succeeds and can still reach admin endpoints (no lockout).

## 8) Active session invalidation (already-logged-in gets kicked)

```powershell
# Allow IR temporarily so demo can log in
$cfg.jurisdictionRestrictedIso2Csv = "KP"
Invoke-RestMethod "$base/api/admin/system-config" -Method Put -ContentType "application/json" -Body ($cfg | ConvertTo-Json) -WebSession $admin

$demo = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType "application/json" -Body (@{ email="demo@tradingfx.com"; password="demo1234" } | ConvertTo-Json) -WebSession $demo

# Re-enable IR restriction
$cfg.jurisdictionRestrictedIso2Csv = "IR,KP"
Invoke-RestMethod "$base/api/admin/system-config" -Method Put -ContentType "application/json" -Body ($cfg | ConvertTo-Json) -WebSession $admin

# Next authenticated API call should 403 and destroy session
try { Invoke-RestMethod "$base/api/auth/current-user" -WebSession $demo } catch {
  $_.Exception.Response.StatusCode.value__
  (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd()
}

# Follow-up should be unauthenticated (session destroyed)
try { Invoke-RestMethod "$base/api/auth/current-user" -WebSession $demo } catch {
  $_.Exception.Response.StatusCode.value__
}
```

Expected: first call `403` with `code:"JURISDICTION_RESTRICTED"`, second call `401`.

## 9) WebSocket enforcement (policy disconnect)

Precondition: allow demo login first (remove `IR` from the restricted list):

```powershell
$cfg.jurisdictionRestrictedIso2Csv = "KP"
Invoke-RestMethod "$base/api/admin/system-config" -Method Put -ContentType "application/json" -Body ($cfg | ConvertTo-Json) -WebSession $admin
```

In a separate terminal, run (keeps the WS open):

```powershell
@'
import { WebSocket } from "ws";

const base = "http://localhost:5000";
const wsUrl = "ws://localhost:5000/ws";

const loginRes = await fetch(base + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "demo@tradingfx.com", password: "demo1234" }),
});
const setCookie = loginRes.headers.get("set-cookie") || "";
const m = setCookie.match(/connect\\.sid=([^;]+)/);
if (!m) throw new Error("No connect.sid set-cookie. Is login blocked?");
const cookie = `connect.sid=${m[1]}`;

const ws = new WebSocket(wsUrl, { headers: { Cookie: cookie } });
ws.on("open", () => console.log("WS open"));
ws.on("message", (d) => console.log("WS message:", d.toString()));
ws.on("close", (code, reason) => console.log("WS close:", code, reason.toString()));
ws.on("error", (e) => console.error("WS error:", e));
'@ | node --input-type=module
```

While it's running, add `IR` back into the restricted list:

```powershell
$cfg.jurisdictionRestrictedIso2Csv = "IR,KP"
Invoke-RestMethod "$base/api/admin/system-config" -Method Put -ContentType "application/json" -Body ($cfg | ConvertTo-Json) -WebSession $admin
```

Expected within ~30s:
- server emits `ws:error` then closes with `4403` and reason `JURISDICTION_BLOCKED`.
