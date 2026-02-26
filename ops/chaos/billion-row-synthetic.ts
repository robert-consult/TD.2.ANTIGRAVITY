/**
 * Billion-Row Synthetic ClickHouse Stress Test
 *
 * Inserts 1M synthetic trade rows into ClickHouse in batches,
 * then runs an aggregation query and asserts sub-second performance.
 *
 * Usage: npx tsx ops/chaos/billion-row-synthetic.ts
 */
import { createClient } from "@clickhouse/client";

const BATCH = 10_000;
const TOTAL = 1_000_000;
const CH_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const CH_DB = process.env.CLICKHOUSE_DATABASE ?? "tradehub";

const ch = createClient({ url: CH_URL, database: CH_DB });

function syntheticRow(i: number) {
    const ts = Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 86400 * 365);
    return `(${i}, ${Math.ceil(Math.random() * 100000)}, '${["EURUSD", "BTCUSD", "XAUUSD"][i % 3]}', ${(Math.random() * 200).toFixed(4)}, ${(Math.random() * 200).toFixed(4)}, ${ts}, ${ts + 3600}, ${(Math.random() * 1000 - 500).toFixed(2)})`;
}

async function run() {
    console.log(`[chaos] Inserting ${TOTAL.toLocaleString()} synthetic rows...`);
    const start = Date.now();

    for (let offset = 0; offset < TOTAL; offset += BATCH) {
        const rows = Array.from({ length: BATCH }, (_, j) => syntheticRow(offset + j)).join(",\n");
        await ch.command({
            query: `INSERT INTO trades_sync (id, user_id, symbol, open_price, close_price, opened_at, closed_at, realized_pnl) VALUES ${rows}`,
        });
        if (offset % 100_000 === 0) console.log(`  ${offset.toLocaleString()} / ${TOTAL.toLocaleString()}`);
    }

    console.log(`[chaos] Insert complete in ${((Date.now() - start) / 1000).toFixed(1)}s`);

    // Aggregation benchmark
    const qStart = Date.now();
    const result = await ch.query({
        query: `SELECT count(), sum(realized_pnl), avg(realized_pnl) FROM trades_sync WHERE opened_at > toUnixTimestamp(now() - INTERVAL 30 DAY)`,
        format: "JSONEachRow",
    });
    const rows = await result.json();
    const elapsed = Date.now() - qStart;

    console.log(`[chaos] Aggregation result:`, rows);
    console.log(`[chaos] Query latency: ${elapsed}ms`);

    if (elapsed > 1000) {
        console.error(`[FAIL] Aggregation exceeded 1s threshold (${elapsed}ms)`);
        process.exit(1);
    }
    console.log("[PASS] Sub-second aggregation confirmed.");
    await ch.close();
}

run().catch((err) => { console.error(err); process.exit(1); });
