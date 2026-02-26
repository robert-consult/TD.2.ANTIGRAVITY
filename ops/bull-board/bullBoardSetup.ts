/**
 * Bull-Board Express Adapter — TradeHub Queue Dashboard
 *
 * Mounts the Bull-Board UI at /admin/queues for monitoring BullMQ queues.
 * Uses @bull-board/express (MIT license, free).
 *
 * Usage (in your Express app):
 *   import { mountBullBoard } from './ops/bull-board/bullBoardSetup';
 *   mountBullBoard(app);
 *
 * Then access: https://<domain>/admin/queues
 */
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';
import type { Express } from 'express';

// Queue names matching the TradeHub export pipeline
const QUEUE_NAMES = [
    'admin:data-export',
    'admin:analytics-rollup',
    'admin:clickhouse-sync',
    'admin:csv-generation',
    'admin:parquet-generation',
    'admin:report-generation',
] as const;

export function mountBullBoard(app: Express, basePath = '/admin/queues') {
    // Valkey connection (same as BullMQ workers)
    const connection = {
        host: process.env.VALKEY_HOST || 'localhost',
        port: parseInt(process.env.VALKEY_PORT || '6379', 10),
        password: process.env.VALKEY_PASSWORD || undefined,
        tls: process.env.VALKEY_TLS === 'true' ? {} : undefined,
    };

    // Create queue references (read-only, no workers)
    const queues = QUEUE_NAMES.map(
        (name) => new BullMQAdapter(new Queue(name, { connection }))
    );

    // Express adapter
    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath(basePath);

    createBullBoard({
        queues,
        serverAdapter,
        options: {
            uiConfig: {
                boardTitle: 'TradeHub Export Pipeline',
                boardLogo: { path: '', width: '', height: '' },
                miscLinks: [
                    { text: 'Grafana', url: '/grafana/d/export-analytics-pipeline' },
                    { text: 'Headlamp', url: '/headlamp/tradehub-ops/exports' },
                ],
                favIcon: { default: 'static/images/logo.svg', alternative: '' },
            },
        },
    });

    // Mount with admin auth middleware (assumes requireAdmin is already applied)
    app.use(basePath, serverAdapter.getRouter());

    console.log(`[bull-board] Queue dashboard mounted at ${basePath}`);
    console.log(`[bull-board] Monitoring ${QUEUE_NAMES.length} queues`);
}

export { QUEUE_NAMES };
