# Audit Trail Analytics + Export Column Map (Billion-Row Ready)

## Scope
This map documents the **implemented** audit-trail data flow and the exact export/linkage column coverage for:
- `GET /api/admin/trade-audit`
- `GET /api/admin/order-intent-audit`
- `GET /api/admin/audit-trail`
- `GET /api/admin/trade-audit/export/{csv|jsonl|parquet}`
- `GET /api/admin/order-intent-audit/export/{csv|jsonl|parquet}`
- `POST /api/admin/data-exports/trade-audit`
- `POST /api/admin/data-exports/order-intent-audit`

## Canonical Tables and Linkage Keys

### Primary audit tables
- `trade_audit`
- `order_intent_audit`

### Joined context tables
- `trades`
- `users`
- `symbol_configs`
- `user_login_history`
- `identity_audit`
- `user_account_events`

### Deterministic linkage keys
- `correlationId` (order lifecycle across intent + execution)
- `sessionId` (session-wide behavioral chain)
- `userId` / `actorUserId` (principal chain)
- `tradeId`, `orderId`, `executionId`, `positionId` (trade lifecycle chain)
- `prevHash` + `eventHash` (tamper-evident hash chain)

## Trade Audit Export Coverage (`trade_audit`)
Implemented export columns (CSV/JSONL/Parquet):
- `id`, `tradeId`, `eventType`, `eventCategory`, `eventAt`, `eventAtIso`, `eventAtMs`
- `correlationId`, `orderId`, `executionId`, `positionId`
- `actorType`, `actorUserId`, `sessionId`, `ip`, `userAgent`
- `symbol`, `side`, `orderType`, `timeInForce`, `qtyLots`, `notionalUsd`
- `grossProfitUsd`, `netProfitUsd`, `totalCostsUsd`
- `openCommissionUsd`, `closeCommissionUsd`, `openOtherFeesUsd`, `closeOtherFeesUsd`
- `financingAccruedUsd`, `swapAccruedUsd`, `overnightDays`, `categorySnapshot`, `costModelVersion`
- `requestedPrice`, `triggerPrice`, `limitPrice`, `stopPrice`, `fillPrice`, `avgFillPrice`
- `slippage`, `slippagePips`, `slippageReference`, `latencyMs`
- `quoteTs`, `quoteTsIso`, `quoteSource`, `quoteBid`, `quoteAsk`, `quoteMid`, `quoteSpread`, `spreadPips`
- `riskCheckName`, `riskLimitValue`, `riskObservedValue`, `riskResult`, `reasonCode`
- `payloadJson`, `prevHash`, `eventHash`, `note`
- `userId`, `username`, `userEmail`

## Order Intent Audit Export Coverage (`order_intent_audit`)
Implemented export columns (CSV/JSONL/Parquet):
- `id`, `correlationId`, `eventAt`, `eventAtIso`, `eventAtMs`, `eventCode`
- `decision`, `rejectCheck`, `rejectReason`
- `actorType`, `userId`, `sessionId`, `ip`, `userAgent`
- `symbol`, `side`, `orderType`, `timeInForce`, `qtyLots`
- `requestedPrice`, `limitPrice`, `stopPrice`, `takeProfit`, `stopLoss`
- `quoteBid`, `quoteAsk`, `quoteMid`, `quoteTs`, `quoteTsIso`, `quoteIsStale`
- `riskLimitJson`, `riskObservedJson`, `riskSnapshotJson`
- `payloadJson`, `prevHash`, `eventHash`
- `username`, `userEmail`

## Cross-System Mapping (OLTP -> OLAP -> Exports)

### Postgres source of truth
- Source writes and hash chains are persisted in Postgres tables above.

### ClickHouse replicated analytical tables
- `admin_trade_audit`
- `admin_order_intent_audit`

These include:
- lifecycle IDs (`trade_id`, `correlation_id`, `order_id`, `execution_id`, `position_id`)
- actor/network/device/session attributes
- quote/risk/slippage/cost fields
- hash-chain fields (`prev_hash`, `event_hash`)

### Export worker path
- Job metadata/state: `admin_data_export_jobs` + events/artifacts tables
- Queue transport: BullMQ/Valkey
- Artifact persistence: object storage key + signed download link
- Output formats: `csv`, `jsonl`, `parquet`

## Hedge-Fund Grade Audit Analytics Map (for future dashboards)

### Lifecycle integrity metrics
- Intent-to-execution conversion by `correlationId`
- Missing-chain detection: breaks in `prevHash` -> `eventHash`
- Orphaned intents (no downstream execution)

### Execution quality / TCA metrics
- Slippage distribution by symbol/session/latency bucket
- Quote staleness impact (`quoteIsStale`, `quoteTs`, `latencyMs`)
- Spread capture vs realized outcomes (`quoteSpread`, `netProfitUsd`)

### Risk control assurance metrics
- Rule pass/fail rates by `riskCheckName`
- Rejection taxonomy (`rejectCheck`, `reasonCode`, `rejectReason`)
- Override/exceptions heatmap by actor and timeframe

### Forensics and provenance metrics
- Admin/system/user actor ratios by event type
- Session-linked suspicious clusters (`sessionId`, `ip`, `device fingerprint context`)
- Correlation chain completeness score by period

## Capacity Notes (implemented architecture path)
- Request path stays bounded with queue-backed exports.
- Heavy export reads can run on ClickHouse with Postgres fallback.
- Artifacts stream to object storage (no in-memory giant response assembly).
- Parquet is first-class across API request schema, worker builders, UI buttons, and download content types.
