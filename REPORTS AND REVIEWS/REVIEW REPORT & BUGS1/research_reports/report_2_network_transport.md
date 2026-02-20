# System Bug Research Report 2: Network & Transport Vulnerabilities

**Scope:** WebSocket (WSS), HTTP/1.1 vs HTTP/2, Fetch API, AbortController  
**Target Audience:** Senior Network Engineers, Site Reliability Engineers (SREs), Backend Architects  
**Date:** 2026-02-18

---

## 1. Executive Summary

In a real-time trading application, the network layer is the nervous system. The primary transport (WebSocket) must guarantee **low latency**, **message integrity**, and **connection resilience**. However, naive implementations often suffer from **thundering herd problems** (DDOSing oneself), **silent data loss** (dropped messages during reconnections), and **race conditions** (out-of-order updates).

This report details the specific network anomalies that can destabilize the platform, often invisible during local development but catastrophic at scale.

---

## 2. Vulnerability Taxonomy: "The Reconnection Storm" (Self-Inflicted DDOS)

### 2.1 Description
When a server restarts or a network partition heals (e.g., ISP outage resolved), thousands of clients disconnect simultaneously. If all clients attempt to reconnect immediately—or after a fixed timeout (e.g., 1000ms)—the server receives a massive spike of `SYN` packets and TLS handshakes, overwhelming its capacity to accept connections. This causes timeouts, leading clients to retry *again* in sync, perpetuating the outage.

### 2.2 Manifestation
- **Scenario:** Server deployment triggers a restart.
- **Bug:** Clients retry every 1s. 10k users = 10k TLS handshakes/sec.
- **Result:** Load Balancer (ALB/Nginx) 503s. Server CPU spins at 100% processing handshakes, unable to process actual trades. Recovery takes 20+ minutes instead of 10 seconds.

### 2.3 Detection & Auditing
- **Code Review:** Look for `setTimeout(reconnect, 1000)` without `Math.random()`.
- **Simulation:** Disconnect 100 test clients, monitor server logs for synchronized connection attempts.

### 2.4 Remediation Pattern: Exponential Backoff with Jitter
**Mathematical Formula:**
`delay = min(cap, base * 2 ^ attempt)`
`jitter = delay * rand(-0.2, 0.2)`
`totalDelay = delay + jitter`

**Implementation:**
```typescript
const attempt = retryCount.current;
const baseDelay = 1000;
const cap = 30000;
const exponential = Math.min(cap, baseDelay * Math.pow(2, attempt));
const jitter = exponential * (Math.random() * 0.4 - 0.2); // +/- 20%
const delay = exponential + jitter;

setTimeout(connect, delay);
```
*This spreads the load over time, allowing the server to recover gracefully.*

---

## 3. Vulnerability Taxonomy: "Message Ordering & Loss" (The Gap Problem)

### 3.1 Description
TCP guarantees ordering *within a single connection*. It does **not** guarantee ordering across *reconnections*. If a client disconnects at `t=100` and reconnects at `t=105`, messages sent by the server during `100..105` are lost forever unless an application-level reliability layer exists.

### 3.2 Manifestation in Trading
- **Scenario:**
    1. Server sends: `Order Placed` (seq: 50)
    2. Connection drops.
    3. Server sends: `Order Filled` (seq: 51) -> LOST
    4. Client reconnects.
    5. Server sends: `Position Updated` (seq: 52)
- **Bug:** Client sees "Order Placed" then "Position Updated". The "Fill" notification is missing.
- **Result:** UI shows an open order (waiting for fill) but also a new position. The user is confused: "Did it fill? Partial fill? Is this a ghost position?"

### 3.3 Issues Arising
- **State Corruption:** Client state diverges from server state.
- **Financial Errors:** User might try to "cancel" the order, but it's already filled.

### 3.4 Remediation Pattern: Application-Level Sequence Numbers (ACK/NACK)
**Protocol Design:**
1. Server tags every message with a monotonically increasing `seq`.
2. Client tracks `last_seen_seq`.
3. On reconnect, client sends `Hello { last_seen_seq: 50 }`.
4. Server replays buffer from `seq=51`.

*If (and only if) the server supports replay buffers.* If not, the client **MUST** assume state is stale on every reconnect and fetch a full snapshot (REST or WS snapshot).

**Code Pattern (Snapshot Fallback):**
```typescript
socket.on('open', () => {
  if (isReconnect) {
    // ⚠️ Assume we missed data. Nuke state and refetch.
    fetchAllOrders();
    fetchPortfolio();
  }
});
```

---

## 4. Vulnerability Taxonomy: "Head-of-Line Blocking" (HTTP/1.1 vs HTTP/2)

### 4.1 Description
Browsers limit concurrent TCP connections per origin (usually 6). If using HTTP/1.1 for REST APIs alongside WS, heavy REST traffic (e.g., loading historical chart data) can block critical order placements.

### 4.2 Manifestation
- **Scenario:** User loads a dashboard. The app fires 20 parallel requests for "Chart History (1y)".
- **Bug:** User clicks "Buy". The `POST /order` request is queued behind the 20 large chart downloads.
- **Result:** The order is delayed by 2 seconds. The price moves. The trade fails or executes at a bad price.

### 4.3 Detection
- **Network Tab:** Look for "Queueing" or "Stalled" time in the request timing breakdown.
- **Protocol Check:** Is `h2` enabled?

### 4.4 Remediation
- **Enable HTTP/2 (h2):** Allows multiplexing requests over a single TCP connection.
- **Domain Sharding (Legacy):** `api-data.domain.com` vs `api-trade.domain.com`.
- **Prioritization:** Load critical data first; lazy-load charts.

---

## 5. Bug Taxonomy: "Phantom Writes" (Optimistic UI Rollback Failures)

### 5.1 Description
To feel fast, apps update the UI *before* the server confirms the action ("Optimistic UI"). If the request fails, the UI must rollback. If the rollback fails or is partial, the UI shows a "phantom" state (e.g., a deleted item that is actually still there).

### 5.2 Manifestation
- **Scenario:** User cancels an order. UI immediately removes it from the list.
- **Bug:** Network is offline. The `DELETE` request fails.
- **Code implementation:** The `.catch()` block shows a toaster "Failed to cancel" but *forgets* to re-add the order to the list.
- **Result:** User thinks order is cancelled. It executes 5 mins later. User loses money.

### 5.3 Detection
- **Chaos Engineering:** In intercepts execution, block network requests, click UI actions. Does the state revert perfectly?
- **Code Review:** Check `onMutate` (React Query) logic. Does it return a rollback context? Does `onError` use that context?

### 5.4 Remediation Pattern (TanStack Query)
```typescript
onMutate: async (newOrder) => {
  await queryClient.cancelQueries('orders');
  const previousOrders = queryClient.getQueryData('orders');
  queryClient.setQueryData('orders', old => [...old, newOrder]);
  return { previousOrders }; // ⬅️ Save snaphot
},
onError: (err, newOrder, context) => {
  queryClient.setQueryData('orders', context.previousOrders); // ⬅️ Rollback
}
```

---

## 6. Vulnerability Taxonomy: "Socket Hijacking" (CSWSH)

### 6.1 Description
Cross-Site WebSocket Hijacking (CSWSH). Unlike HTTP, WebSockets don't have Same-Origin Policy (SOP) by default in the handshake. If a user visits `evil.com`, that site can initiate a WS connection to `your-trading-site.com`. If you rely *only* on cookies for auth, the browser sends the cookies, the connection succeeds, and `evil.com` can trade on the user's behalf.

### 6.2 Detection
- **Inspect Handshake:** Does the server check the `Origin` header during the HTTP Upgrade?
- **Test:** Use a tool (like Burp Suite) to connect with a fake `Origin: https://evil.com`. Does it verify 101 Switching Protocols?

### 6.3 Remediation
- **Check Origin Header:** Server **MUST** validate `Origin` matches the expected domain.
- **Token Auth:** Don't rely on cookies alone. Require a randomized `token` in the protocol (`ws://host?token=xyz`) or the first message.

---

## 7. Vulnerability Taxonomy: "CORS Misconfiguration" (The Open Door)

### 7.1 Description
Cross-Origin Resource Sharing (CORS) controls which origins can access your API. A misconfigured `Access-Control-Allow-Origin` header can allow any website to read responses from your API, including sensitive data like account balances and trade history.

### 7.2 Common Misconfigurations

| Pattern | Risk Level | Description |
|---------|-----------|-------------|
| `Access-Control-Allow-Origin: *` | 🟠 High | Any site can read responses (no credentials) |
| Reflecting `Origin` header verbatim | 🔴 Critical | Attacker's origin is echoed back, enables credentialed requests |
| `null` origin allowed | 🟠 High | `iframe` sandboxes and `data:` URIs send `Origin: null` |
| Regex bypass: `/example\.com/` | 🟠 High | Matches `evil-example.com` (missing anchor) |

### 7.3 Manifestation in Trading
- **Scenario:** API endpoint `/api/account-summary` returns balance, equity, and P&L.
- **Bug:** Server reflects `Origin` header in CORS response with `Access-Control-Allow-Credentials: true`.
- **Attack:** Attacker hosts `evil.com` with `fetch('https://trading.com/api/account-summary', { credentials: 'include' })`.
- **Result:** Attacker reads the victim's full account data cross-origin.

### 7.4 Detection
- **Burp Suite:** Send requests with `Origin: https://evil.com` and check if the response includes `Access-Control-Allow-Origin: https://evil.com`.
- **Automated Scanner:** OWASP ZAP, `cors-scanner` npm package.
- **Code Review:** Grep for `Access-Control-Allow-Origin` or framework CORS config (e.g., Express `cors()` options).

### 7.5 Remediation
- **Allowlist approach:** Maintain a hardcoded list of allowed origins. Never reflect or wildcard.
- **No credentials with wildcard:** If you must use `*`, never set `Access-Control-Allow-Credentials: true`.

```typescript
// ✅ Express example
const ALLOWED_ORIGINS = ['https://app.trading.com', 'https://admin.trading.com'];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) callback(null, true);
    else callback(new Error('CORS blocked'));
  },
  credentials: true,
}));
```

---

## 8. Vulnerability Taxonomy: "DNS Rebinding" (The Browser Proxy Attack)

### 8.1 Description
An attacker controls a domain (`evil.com`) and its DNS. Initially, `evil.com` resolves to the attacker's IP. After the browser opens the page and JS runs, the attacker changes the DNS to point to `127.0.0.1` (or an internal IP like `192.168.1.1`). Subsequent `fetch()` requests from the page now hit the victim's **local network**, bypassing firewalls. The SOP allows this because the origin (`evil.com`) hasn't changed.

### 8.2 Relevance to Trading Systems
If the trading platform has an **admin panel** or **internal API** running on `localhost:3000` or an internal network, DNS rebinding can expose it. Internal APIs often lack authentication because they're "behind the firewall."

### 8.3 Detection
- **Pentest:** Use tools like `singularity` or `rbndr.us` to simulate DNS rebinding.
- **Code Review:** Do internal APIs validate the `Host` header? Do they require authentication even from localhost?

### 8.4 Remediation
- **Host Header Validation:** Reject requests where the `Host` header doesn't match expected values.
- **Authentication Everywhere:** No "trusted network" assumptions. All APIs require auth tokens.
- **DNS Pinning (browsers):** Modern browsers mitigate this partially, but not completely.

---

## 9. Bug Taxonomy: "Fetch Timeout Traps" (The Infinite Wait)

### 9.1 Description
The native `fetch()` API has **no built-in timeout**. If the server hangs (e.g., keeps the TCP connection open but sends no response), the `fetch()` Promise never resolves or rejects. The UI shows a loading spinner forever.

### 9.2 Manifestation
- **Scenario:** CDN edge node crashes. TCP handshake succeeds but no HTTP response is sent.
- **Bug:** `fetch('/api/orders')` hangs indefinitely.
- **Result:** User sees "Loading orders…" forever. They can't trade.

### 9.3 Detection
- **Chaos Engineering:** Use a proxy (e.g., Toxiproxy) to add a 60-second delay to responses. Does the UI handle it?
- **Code Review:** Do all `fetch()` calls use `AbortController` with a timeout signal?

### 9.4 Remediation
```typescript
// ✅ AbortController with timeout (modern)
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
try {
  const res = await fetch(url, { signal: controller.signal });
} catch (err) {
  if (err.name === 'AbortError') {
    showToast('Request timed out. Please try again.');
  }
} finally {
  clearTimeout(timeout);
}

// ✅ Even simpler (AbortSignal.timeout, available in modern browsers)
const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
```

---

## 10. Bug Taxonomy: "WebSocket Backpressure" (The Drowning Client)

### 10.1 Description
If the server sends messages faster than the client can process them (e.g., 1000 price ticks/sec during market open, but the client's render loop processes 60/sec), the browser's WS receive buffer grows. Eventually, the tab consumes GBs of memory and crashes.

### 10.2 Manifestation
- **Scenario:** Market opens. All symbols update simultaneously.
- **Bug:** Client receives 500 `quote` messages/second. Each triggers a React state update + re-render.
- **Result:** 1. Browser lag starts at 200ms, grows to 2s+. 2. Tab crashes (OOM) after 10 minutes.

### 10.3 Detection
- **Performance Monitor:** Watch "JS heap size" during high-frequency WS activity.
- **WS frame counter:** Log `messageCount` per second. If it exceeds 100/sec, backpressure is likely.
- **Code Review:** Does the WS handler debounce or batch incoming messages?

### 10.4 Remediation
**Client-Side Throttling:**
```typescript
// Batch: accumulate messages, flush at requestAnimationFrame rate
const buffer: Quote[] = [];
socket.onmessage = (e) => {
  buffer.push(JSON.parse(e.data));
};

function flushLoop() {
  if (buffer.length > 0) {
    const batch = buffer.splice(0); // drain the buffer
    updateQuotes(batch); // single state update for all
  }
  requestAnimationFrame(flushLoop);
}
requestAnimationFrame(flushLoop);
```

**Server-Side Flow Control:**
Allow clients to send a `pause` / `resume` signal for specific channels when overwhelmed.

---

## 11. Bug Taxonomy: "Request Deduplication & Batching Failures"

### 11.1 Description
Multiple UI components may independently request the same data at the same time (e.g., Header and Dashboard both call `GET /api/user`). Without deduplication, this causes redundant network traffic and unnecessary server load.

### 11.2 Manifestation
- **Scenario:** A Dashboard page has 5 widgets. Each widget calls `useQuery(['user'])` independently.
- **Bug 1 (TanStack dedup working):** No issue — TanStack Query deduplicates by key.
- **Bug 2 (Custom fetch without dedup):** 5 identical requests hit the server. Server-side rate limiter triggers and blocks the user.

### 11.3 Detection
- **Network Tab:** Filter by URL. Multiple identical requests at the same timestamp = missing dedup.
- **Server Logs:** High request rates from single clients for the same endpoint.

### 11.4 Remediation
- **TanStack Query:** Already deduplicates by query key. Ensure all components use the same key factory.
- **Custom Fetch Layer:** Implement a request-level dedup map:
```typescript
const inflight = new Map<string, Promise<Response>>();

async function dedupFetch(url: string): Promise<Response> {
  if (inflight.has(url)) return inflight.get(url)!;
  const promise = fetch(url).finally(() => inflight.delete(url));
  inflight.set(url, promise);
  return promise;
}
```
- **GraphQL/Batching:** Combine multiple queries into one request using DataLoader or GraphQL batching.

---

## 12. Vulnerability Taxonomy: "Certificate Pinning & TLS Downgrade"

### 12.1 Description
In a web app, TLS is handled by the browser — you don't pin certificates directly. However, failure to enforce HTTPS (via HSTS), or allowing mixed content, can expose the app to TLS stripping/downgrade attacks.

### 12.2 Manifestation
- **Scenario:** Navigation link uses `http://` instead of `https://`.
- **Bug:** Browser follows HTTP link. MITM attacker intercepts, reads cookies, modifies response.
- **Result:** Session hijacked. Attacker trades on behalf of the user.

### 12.3 Detection
- **Security Headers Check:** Use `securityheaders.com` or `hardenize.com`.
- **Mixed Content:** DevTools Console warns about mixed content (HTTP resources on HTTPS page).
- **Code Review:** Grep for `http://` in source code (excluding `localhost`).

### 12.4 Remediation
- **HSTS:** `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- **Content-Security-Policy:** `upgrade-insecure-requests` directive
- **Cookie Flags:** `Secure; SameSite=Strict; HttpOnly` on all session cookies

---

**End of Report 2**
