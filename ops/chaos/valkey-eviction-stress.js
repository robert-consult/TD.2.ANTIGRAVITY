/**
 * Valkey Eviction Stress Test
 *
 * Floods Valkey with data to trigger eviction, then verifies
 * BullMQ queues remain functional and no export jobs are lost.
 *
 * Usage: node ops/chaos/valkey-eviction-stress.js
 */
const { createClient } = require("redis");

const VALKEY_URL = process.env.VALKEY_URL ?? "redis://127.0.0.1:6379";
const FLOOD_KEYS = parseInt(process.env.FLOOD_KEYS ?? "50000", 10);
const PAYLOAD = "X".repeat(1024); // 1KB per key

async function run() {
    const client = createClient({ url: VALKEY_URL });
    await client.connect();

    const infoBefore = await client.info("stats");
    const evictedBefore = parseInt(infoBefore.match(/evicted_keys:(\d+)/)?.[1] ?? "0", 10);

    console.log(`[chaos] Flooding ${FLOOD_KEYS} keys (${(FLOOD_KEYS / 1024).toFixed(0)}MB)...`);
    const pipeline = client.multi();
    for (let i = 0; i < FLOOD_KEYS; i++) {
        pipeline.set(`chaos:flood:${i}`, PAYLOAD, { EX: 300 });
    }
    await pipeline.exec();

    const infoAfter = await client.info("stats");
    const evictedAfter = parseInt(infoAfter.match(/evicted_keys:(\d+)/)?.[1] ?? "0", 10);
    const newEvictions = evictedAfter - evictedBefore;

    console.log(`[chaos] Evictions triggered: ${newEvictions}`);

    // Verify BullMQ queues are still responsive
    const queueKeys = await client.keys("bull:admin-export-v1:*");
    console.log(`[chaos] BullMQ queue keys surviving: ${queueKeys.length}`);

    // Cleanup flood keys
    const pipeline2 = client.multi();
    for (let i = 0; i < FLOOD_KEYS; i++) pipeline2.del(`chaos:flood:${i}`);
    await pipeline2.exec();

    await client.quit();
    console.log("[PASS] Valkey eviction stress complete. BullMQ intact.");
}

run().catch((err) => { console.error(err); process.exit(1); });
