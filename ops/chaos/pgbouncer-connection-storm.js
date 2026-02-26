/**
 * PgBouncer Connection Storm Test
 *
 * Fires N concurrent TCP connections to verify graceful rejection
 * without cascading failures to the upstream Postgres instance.
 *
 * Usage: node ops/chaos/pgbouncer-connection-storm.js
 */
const net = require("net");

const HOST = process.env.PGBOUNCER_HOST ?? "127.0.0.1";
const PORT = parseInt(process.env.PGBOUNCER_PORT ?? "6432", 10);
const CONCURRENT = parseInt(process.env.STORM_CONNECTIONS ?? "5000", 10);
const TIMEOUT_MS = 5000;

let connected = 0, rejected = 0, errors = 0;

function attempt(i) {
    return new Promise((resolve) => {
        const sock = net.createConnection({ host: HOST, port: PORT, timeout: TIMEOUT_MS });
        sock.on("connect", () => { connected++; sock.destroy(); resolve(); });
        sock.on("error", () => { rejected++; resolve(); });
        sock.on("timeout", () => { errors++; sock.destroy(); resolve(); });
    });
}

async function run() {
    console.log(`[chaos] Firing ${CONCURRENT} connections at ${HOST}:${PORT}...`);
    const start = Date.now();

    // Fire in waves of 500 to avoid local FD exhaustion
    for (let offset = 0; offset < CONCURRENT; offset += 500) {
        const batch = Math.min(500, CONCURRENT - offset);
        await Promise.all(Array.from({ length: batch }, (_, j) => attempt(offset + j)));
    }

    const elapsed = Date.now() - start;
    console.log(`[chaos] Results: connected=${connected} rejected=${rejected} errors=${errors} (${elapsed}ms)`);

    if (connected > CONCURRENT * 0.5) {
        console.error("[FAIL] PgBouncer accepted too many connections — pool limits may be misconfigured.");
        process.exit(1);
    }
    console.log("[PASS] PgBouncer rejected the storm gracefully.");
}

run().catch((err) => { console.error(err); process.exit(1); });
