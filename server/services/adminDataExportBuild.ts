import fs from "fs";
import os from "os";
import path from "path";
import { dbClient } from "@db";
import {
  canonicalizeInstrumentCategory,
  normalizeInstrumentCategory,
} from "@shared/instruments/categories";
import type {
  AdminDataExportCreateRequest,
  AllTradesExportFilters,
  DailyPnlExportFilters,
  DeactivatedAccountsExportFilters,
  OrderIntentAuditExportFilters,
  TradeAuditExportFilters,
  TraderScoutingExportFilters,
  UserTimelineExportFilters,
  UsersExportFilters,
} from "@shared/admin/dataExports";
import {
  queryAllTradesFromClickHouse,
  queryDailyPnlFromClickHouse,
  queryDeactivatedAccountsFromClickHouse,
  queryOrderIntentAuditFromClickHouse,
  queryTradeAuditFromClickHouse,
  streamTraderScoutingFromClickHouse,
} from "./adminDataExportBuildClickhouse";

type BuildExportArtifactParams = {
  jobId: string;
  request: AdminDataExportCreateRequest;
};

type BuildExportArtifactResult = {
  filePath: string;
  filename: string;
  contentType: string;
  rowCount: number;
  truncated: boolean;
};

import { MAX_DEACTIVATED_USERS, MAX_USERS_EXPORT_ROWS, MAX_USER_TIMELINE_ROWS, MAX_TRADE_AUDIT_ROWS, MAX_ORDER_INTENT_AUDIT_ROWS, TRADER_SCOUT_FETCH_CHUNK, TRADE_FETCH_CHUNK, USER_EXPORT_FETCH_CHUNK, PARQUET_CONTENT_TYPE, ensureTmpDir, nowIsoDateTag, convertQuestionMarks, toUnixSec, safeCsv, writeJsonlLine, ParquetFieldType, sanitizeParquetValue, inferParquetFieldType, StreamingExportWriter, formatSessionLength, exportFileMeta, toInt, toIsoFromUnix, LEGACY_TRADE_PROFIT_NUMERIC_SQL, TRADE_NET_PROFIT_SQL, TRADER_SCOUT_CATEGORY_SQL, TRADER_SCOUT_SEARCH_SQL, buildDeactivatedAccountsCte, normalizeTraderScoutingExportRow, queryAll, writeParquetRows, createStreamingExportWriter, buildTraderScoutingExport, buildDeactivatedAccountsExport } from "./adminDataExportBuildSupport";
const USERS_EXPORT_COLUMNS = [
  "id",
  "name",
  "email",
  "username",
  "phone",
  "balance",
  "status",
  "isAdmin",
  "isDisabled",
  "isFrozen",
  "freezeReason",
  "leverage",
  "maxConcurrent",
  "maxConcurrentLots",
  "minHoldSec",
  "maxHoldSec",
  "createdAt",
  "lastLoginTime",
  "lastLoginIp",
  "totalSessionsLength",
  "totalSessionsLengthSec",
  "lastLogoutTime",
] as const;

const USER_TIMELINE_EXPORT_COLUMNS = [
  "userId",
  "userPhone",
  "userUsername",
  "userEmail",
  "eventId",
  "type",
  "source",
  "title",
  "description",
  "severity",
  "timestamp",
  "timestampIso",
  "reasonCode",
  "loginTime",
  "loginTimeIso",
  "loginIp",
  "sessionLength",
  "sessionLengthSec",
  "logoutTime",
  "logoutTimeIso",
  "metadataJson",
] as const;

function deriveUserAccountStatus(row: any): string {
  if (row.isFrozen && row.isDisabled) return "Frozen+Disabled";
  if (row.isFrozen) return "Frozen";
  if (row.isDisabled) return "Disabled";
  return "Active";
}

async function buildUsersExport(params: {
  request: AdminDataExportCreateRequest;
  outputPath: string;
}): Promise<{ rowCount: number; truncated: boolean; filename: string; contentType: string }> {
  const filters = params.request.filters as UsersExportFilters;
  const limit = Math.max(1, Math.min(MAX_USERS_EXPORT_ROWS, Math.trunc(filters.limit ?? 100_000)));
  const includeAdmins = Boolean(filters.includeAdmins ?? true);
  const includeDeleted = Boolean(filters.includeDeleted ?? true);
  const schemaHints: Partial<Record<string, ParquetFieldType>> = {
    id: "INT64",
    balance: "DOUBLE",
    leverage: "DOUBLE",
    maxConcurrent: "INT64",
    maxConcurrentLots: "INT64",
    minHoldSec: "INT64",
    maxHoldSec: "INT64",
    createdAt: "UTF8",
    lastLoginTime: "UTF8",
    totalSessionsLengthSec: "INT64",
    lastLogoutTime: "UTF8",
  };

  const writer = await createStreamingExportWriter({
    format: params.request.format,
    outputPath: params.outputPath,
    columns: USERS_EXPORT_COLUMNS,
    schemaHints,
  });

  let written = 0;
  let lastUserId = 0;
  let truncated = false;
  try {
    while (written <= limit) {
      const remaining = limit + 1 - written;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const fetchLimit = Math.min(USER_EXPORT_FETCH_CHUNK, remaining);
      const usersChunk = await queryAll<any>(
        `
          SELECT
            u.id AS "id",
            u.name AS "name",
            u.email AS "email",
            u.username AS "username",
            u.phone AS "phone",
            u.balance AS "balance",
            u.is_admin AS "isAdmin",
            u.is_disabled AS "isDisabled",
            u.is_frozen AS "isFrozen",
            u.freeze_reason_code AS "freezeReasonCode",
            us.leverage AS "leverage",
            us.max_concurrent AS "maxConcurrent",
            us.max_concurrent_lots AS "maxConcurrentLots",
            us.min_hold_sec AS "minHoldSec",
            us.max_hold_sec AS "maxHoldSec",
            u.created_at AS "createdAt"
          FROM users u
          LEFT JOIN user_settings us ON us.user_id = u.id
          WHERE u.id > $1::int
            AND ($2::boolean OR u.is_admin = FALSE)
            AND ($3::boolean OR COALESCE(u.is_deleted, FALSE) = FALSE)
          ORDER BY u.id ASC
          LIMIT $4::int
        `,
        [lastUserId, includeAdmins, includeDeleted, fetchLimit],
      );

      if (usersChunk.length === 0) break;

      const userIds = usersChunk
        .map((row) => Number(row.id))
        .filter((value) => Number.isFinite(value) && value > 0);

      const loginStatsByUser = new Map<
        number,
        {
          lastLoginTime: number | null;
          lastLoginIp: string | null;
          lastLogoutTime: number | null;
          totalSessionLengthSec: number;
        }
      >();

      if (userIds.length > 0) {
        const loginStatsRows = await queryAll<any>(
          `
            WITH scoped AS (
              SELECT user_id, ip, created_at, logout_at, session_length_sec, success
              FROM user_login_history
              WHERE user_id = ANY($1::int[])
            ),
            latest_login AS (
              SELECT DISTINCT ON (user_id)
                user_id,
                created_at AS last_login_time,
                ip AS last_login_ip
              FROM scoped
              WHERE success = TRUE
              ORDER BY user_id, created_at DESC
            ),
            latest_logout AS (
              SELECT DISTINCT ON (user_id)
                user_id,
                logout_at AS last_logout_time
              FROM scoped
              WHERE success = TRUE AND logout_at IS NOT NULL
              ORDER BY user_id, logout_at DESC
            ),
            session_totals AS (
              SELECT
                user_id,
                COALESCE(SUM(COALESCE(session_length_sec, 0)), 0)::bigint AS total_session_length_sec
              FROM scoped
              WHERE success = TRUE
              GROUP BY user_id
            )
            SELECT
              COALESCE(ll.user_id, lo.user_id, st.user_id) AS "userId",
              ll.last_login_time AS "lastLoginTime",
              ll.last_login_ip AS "lastLoginIp",
              lo.last_logout_time AS "lastLogoutTime",
              st.total_session_length_sec AS "totalSessionLengthSec"
            FROM latest_login ll
            FULL OUTER JOIN latest_logout lo
              ON lo.user_id = ll.user_id
            FULL OUTER JOIN session_totals st
              ON st.user_id = COALESCE(ll.user_id, lo.user_id)
          `,
          [userIds],
        );

        for (const row of loginStatsRows) {
          const userId = Number(row.userId);
          if (!Number.isFinite(userId) || userId <= 0) continue;
          loginStatsByUser.set(userId, {
            lastLoginTime: row.lastLoginTime == null ? null : Number(row.lastLoginTime),
            lastLoginIp: row.lastLoginIp == null ? null : String(row.lastLoginIp),
            lastLogoutTime: row.lastLogoutTime == null ? null : Number(row.lastLogoutTime),
            totalSessionLengthSec:
              row.totalSessionLengthSec == null ? 0 : Math.max(0, Number(row.totalSessionLengthSec)),
          });
        }
      }

      for (const user of usersChunk) {
        if (written >= limit) {
          truncated = true;
          break;
        }
        const userId = Number(user.id);
        const stats = loginStatsByUser.get(userId);
        const balanceNum = Number(user.balance);
        await writer.writeRow({
          id: userId,
          name: user.name ?? "",
          email: user.email ?? "",
          username: user.username ?? "",
          phone: user.phone ?? "",
          balance: Number.isFinite(balanceNum) ? balanceNum : user.balance ?? "",
          status: deriveUserAccountStatus(user),
          isAdmin: user.isAdmin ? "Yes" : "No",
          isDisabled: user.isDisabled ? "Yes" : "No",
          isFrozen: user.isFrozen ? "Yes" : "No",
          freezeReason: user.freezeReasonCode ?? "",
          leverage: user.leverage == null ? null : Number(user.leverage),
          maxConcurrent: user.maxConcurrent == null ? null : Number(user.maxConcurrent),
          maxConcurrentLots: user.maxConcurrentLots == null ? null : Number(user.maxConcurrentLots),
          minHoldSec: user.minHoldSec == null ? null : Number(user.minHoldSec),
          maxHoldSec: user.maxHoldSec == null ? null : Number(user.maxHoldSec),
          createdAt: toIsoFromUnix(user.createdAt) ?? "",
          lastLoginTime: toIsoFromUnix(stats?.lastLoginTime) ?? "",
          lastLoginIp: stats?.lastLoginIp ?? "",
          totalSessionsLength: formatSessionLength(stats?.totalSessionLengthSec ?? 0),
          totalSessionsLengthSec: stats?.totalSessionLengthSec ?? 0,
          lastLogoutTime: toIsoFromUnix(stats?.lastLogoutTime) ?? "",
        });
        written += 1;
      }

      lastUserId = Number(usersChunk[usersChunk.length - 1]?.id || lastUserId);
      if (usersChunk.length < fetchLimit || truncated) break;
    }
  } finally {
    await writer.close();
  }

  const file = exportFileMeta(`users_export_${Date.now()}`, params.request.format);
  return {
    rowCount: written,
    truncated,
    filename: file.filename,
    contentType: file.contentType,
  };
}

async function buildUserTimelineExport(params: {
  request: AdminDataExportCreateRequest;
  outputPath: string;
}): Promise<{ rowCount: number; truncated: boolean; filename: string; contentType: string }> {
  const filters = params.request.filters as UserTimelineExportFilters;
  const userId = Math.trunc(filters.userId);
  const limit = Math.max(1, Math.min(MAX_USER_TIMELINE_ROWS, Math.trunc(filters.limit ?? 100_000)));
  const user = await queryAll<any>(
    `
      SELECT id, phone, username, email
      FROM users
      WHERE id = $1::int
      LIMIT 1
    `,
    [userId],
  );
  const userRow = user[0];
  if (!userRow) throw new Error("User not found for timeline export");

  const timelineRows = await queryAll<any>(
    `
      WITH login_events AS (
        SELECT
          ('login-' || l.id)::text AS event_id,
          'LOGIN'::text AS event_type,
          'LOGIN'::text AS event_source,
          CASE WHEN l.success THEN 'User logged in' ELSE 'Login failed' END::text AS title,
          CASE
            WHEN l.success THEN ('From IP: ' || COALESCE(l.ip, 'unknown'))
            ELSE ('Failed: ' || COALESCE(l.failure_reason, 'unknown'))
          END::text AS description,
          CASE WHEN l.success THEN 'INFO' ELSE 'WARN' END::text AS severity,
          NULL::text AS reason_code,
          l.created_at AS ts,
          l.created_at AS login_time,
          l.ip AS login_ip,
          NULL::int AS session_length_sec,
          NULL::int AS logout_time,
          NULL::text AS metadata_json
        FROM user_login_history l
        WHERE l.user_id = $1::int
      ),
      logout_events AS (
        SELECT
          ('logout-' || l.id)::text AS event_id,
          'LOGOUT'::text AS event_type,
          'LOGOUT'::text AS event_source,
          'User logged out'::text AS title,
          (
            'Session length: ' ||
            CASE
              WHEN COALESCE(l.session_length_sec, 0) <= 0 THEN 'Unknown'
              WHEN l.session_length_sec >= 3600 THEN
                (l.session_length_sec / 3600)::int::text || 'h ' ||
                ((l.session_length_sec % 3600) / 60)::int::text || 'm ' ||
                (l.session_length_sec % 60)::int::text || 's'
              WHEN l.session_length_sec >= 60 THEN
                (l.session_length_sec / 60)::int::text || 'm ' ||
                (l.session_length_sec % 60)::int::text || 's'
              ELSE l.session_length_sec::int::text || 's'
            END
          )::text AS description,
          'INFO'::text AS severity,
          NULL::text AS reason_code,
          l.logout_at AS ts,
          l.created_at AS login_time,
          l.ip AS login_ip,
          l.session_length_sec AS session_length_sec,
          l.logout_at AS logout_time,
          NULL::text AS metadata_json
        FROM user_login_history l
        WHERE l.user_id = $1::int
          AND l.success = TRUE
          AND l.logout_at IS NOT NULL
      ),
      account_events AS (
        SELECT
          ('event-' || e.id)::text AS event_id,
          e.event_type AS event_type,
          'ACCOUNT_EVENT'::text AS event_source,
          e.title AS title,
          COALESCE(e.description, '') AS description,
          CASE WHEN e.event_type ILIKE '%FREEZE%' THEN 'HIGH' ELSE 'INFO' END::text AS severity,
          e.reason_code AS reason_code,
          e.created_at AS ts,
          NULL::int AS login_time,
          NULL::text AS login_ip,
          NULL::int AS session_length_sec,
          NULL::int AS logout_time,
          e.metadata AS metadata_json
        FROM user_account_events e
        WHERE e.user_id = $1::int
      ),
      trade_open_events AS (
        SELECT
          ('trade-open-' || t.id)::text AS event_id,
          'TRADE_OPENED'::text AS event_type,
          'TRADE'::text AS event_source,
          (COALESCE(t.type, 'TRADE') || ' ' || COALESCE(s.symbol, 'Unknown'))::text AS title,
          (COALESCE(t.lots::text, '0') || ' lots @ ' || COALESCE(t.open_price::text, '0'))::text AS description,
          'INFO'::text AS severity,
          NULL::text AS reason_code,
          t.opened_at AS ts,
          NULL::int AS login_time,
          NULL::text AS login_ip,
          NULL::int AS session_length_sec,
          NULL::int AS logout_time,
          jsonb_build_object(
            'tradeId', t.id,
            'symbol', s.symbol,
            'lots', t.lots
          )::text AS metadata_json
        FROM trades t
        LEFT JOIN symbol_configs s ON s.id = t.symbol_id
        WHERE t.user_id = $1::int
          AND t.status IN ('OPEN', 'CLOSED')
      ),
      trade_close_events AS (
        SELECT
          ('trade-close-' || t.id)::text AS event_id,
          'TRADE_CLOSED'::text AS event_type,
          'TRADE'::text AS event_source,
          ('Closed ' || COALESCE(s.symbol, 'Unknown'))::text AS title,
          (
            'P/L: $' ||
            to_char(
              COALESCE(
                t.net_profit_usd::numeric,
                CASE
                  WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::numeric
                  WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::numeric
                  ELSE 0::numeric
                END
              ),
              'FM9999999999990D00'
            )
          )::text AS description,
          CASE
            WHEN COALESCE(
              t.net_profit_usd::numeric,
              CASE
                WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::numeric
                WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::numeric
                ELSE 0::numeric
              END
            ) >= 0 THEN 'INFO'
            ELSE 'WARN'
          END::text AS severity,
          NULL::text AS reason_code,
          t.closed_at AS ts,
          NULL::int AS login_time,
          NULL::text AS login_ip,
          NULL::int AS session_length_sec,
          NULL::int AS logout_time,
          jsonb_build_object(
            'tradeId', t.id,
            'symbol', s.symbol,
            'profit', t.profit,
            'netProfitUsd', t.net_profit_usd,
            'totalCostsUsd', t.total_costs_usd
          )::text AS metadata_json
        FROM trades t
        LEFT JOIN symbol_configs s ON s.id = t.symbol_id
        WHERE t.user_id = $1::int
          AND t.status = 'CLOSED'
          AND t.closed_at IS NOT NULL
      ),
      combined AS (
        SELECT * FROM login_events
        UNION ALL
        SELECT * FROM logout_events
        UNION ALL
        SELECT * FROM account_events
        UNION ALL
        SELECT * FROM trade_open_events
        UNION ALL
        SELECT * FROM trade_close_events
      )
      SELECT
        event_id AS "eventId",
        event_type AS "type",
        event_source AS "source",
        title,
        description,
        severity,
        reason_code AS "reasonCode",
        ts AS "timestamp",
        login_time AS "loginTime",
        login_ip AS "loginIp",
        session_length_sec AS "sessionLengthSec",
        logout_time AS "logoutTime",
        metadata_json AS "metadataJson"
      FROM combined
      WHERE ts IS NOT NULL
      ORDER BY ts DESC, event_id DESC
      LIMIT $2::int
    `,
    [userId, limit + 1],
  );

  const truncated = timelineRows.length > limit;
  const sliced = truncated ? timelineRows.slice(0, limit) : timelineRows;
  const writer = await createStreamingExportWriter({
    format: params.request.format,
    outputPath: params.outputPath,
    columns: USER_TIMELINE_EXPORT_COLUMNS,
    schemaHints: {
      userId: "INT64",
      timestamp: "INT64",
      loginTime: "INT64",
      sessionLengthSec: "INT64",
      logoutTime: "INT64",
    },
  });

  try {
    for (const row of sliced) {
      const sessionLengthSec = row.sessionLengthSec == null ? null : Number(row.sessionLengthSec);
      await writer.writeRow({
        userId,
        userPhone: userRow.phone ?? null,
        userUsername: userRow.username ?? null,
        userEmail: userRow.email ?? null,
        eventId: row.eventId ?? null,
        type: row.type ?? null,
        source: row.source ?? null,
        title: row.title ?? null,
        description: row.description ?? null,
        severity: row.severity ?? null,
        timestamp: row.timestamp == null ? null : Number(row.timestamp),
        timestampIso: toIsoFromUnix(row.timestamp),
        reasonCode: row.reasonCode ?? null,
        loginTime: row.loginTime == null ? null : Number(row.loginTime),
        loginTimeIso: toIsoFromUnix(row.loginTime),
        loginIp: row.loginIp ?? null,
        sessionLength: formatSessionLength(sessionLengthSec),
        sessionLengthSec,
        logoutTime: row.logoutTime == null ? null : Number(row.logoutTime),
        logoutTimeIso: toIsoFromUnix(row.logoutTime),
        metadataJson: row.metadataJson ?? null,
      });
    }
  } finally {
    await writer.close();
  }

  const file = exportFileMeta(`user_${userId}_timeline_${Date.now()}`, params.request.format);
  return {
    rowCount: sliced.length,
    truncated,
    filename: file.filename,
    contentType: file.contentType,
  };
}

const TRADE_AUDIT_EXPORT_COLUMNS = [
  "id",
  "tradeId",
  "eventType",
  "eventCategory",
  "eventAt",
  "eventAtIso",
  "eventAtMs",
  "correlationId",
  "orderId",
  "executionId",
  "positionId",
  "actorType",
  "actorUserId",
  "sessionId",
  "ip",
  "userAgent",
  "symbol",
  "side",
  "orderType",
  "timeInForce",
  "qtyLots",
  "notionalUsd",
  "grossProfitUsd",
  "netProfitUsd",
  "totalCostsUsd",
  "openCommissionUsd",
  "closeCommissionUsd",
  "openOtherFeesUsd",
  "closeOtherFeesUsd",
  "financingAccruedUsd",
  "swapAccruedUsd",
  "overnightDays",
  "categorySnapshot",
  "costModelVersion",
  "requestedPrice",
  "triggerPrice",
  "limitPrice",
  "stopPrice",
  "fillPrice",
  "avgFillPrice",
  "slippage",
  "slippagePips",
  "slippageReference",
  "latencyMs",
  "quoteTs",
  "quoteTsIso",
  "quoteSource",
  "quoteBid",
  "quoteAsk",
  "quoteMid",
  "quoteSpread",
  "spreadPips",
  "riskCheckName",
  "riskLimitValue",
  "riskObservedValue",
  "riskResult",
  "reasonCode",
  "payloadJson",
  "prevHash",
  "eventHash",
  "note",
  "userId",
  "username",
  "userEmail",
] as const;

const ORDER_INTENT_AUDIT_EXPORT_COLUMNS = [
  "id",
  "correlationId",
  "eventAt",
  "eventAtIso",
  "eventAtMs",
  "eventCode",
  "decision",
  "rejectCheck",
  "rejectReason",
  "actorType",
  "userId",
  "sessionId",
  "ip",
  "userAgent",
  "symbol",
  "side",
  "orderType",
  "timeInForce",
  "qtyLots",
  "requestedPrice",
  "limitPrice",
  "stopPrice",
  "takeProfit",
  "stopLoss",
  "quoteBid",
  "quoteAsk",
  "quoteMid",
  "quoteTs",
  "quoteTsIso",
  "quoteIsStale",
  "riskLimitJson",
  "riskObservedJson",
  "riskSnapshotJson",
  "payloadJson",
  "prevHash",
  "eventHash",
  "username",
  "userEmail",
] as const;

function normalizeTradeAuditExportRow(row: any): Record<string, unknown> {
  const symbol = row.symbol || row.symbolFromTrade || null;
  const notionalUsd = row.notionalUsd ?? row.tradeNotionalUsd ?? null;
  const grossProfitUsd = row.grossProfitUsd ?? row.tradeGrossProfitUsd ?? null;
  const netProfitUsd = row.netProfitUsd ?? row.tradeNetProfitUsd ?? null;
  const totalCostsUsd = row.totalCostsUsd ?? row.tradeTotalCostsUsd ?? null;
  const openCommissionUsd = row.openCommissionUsd ?? row.tradeOpenCommissionUsd ?? null;
  const closeCommissionUsd = row.closeCommissionUsd ?? row.tradeCloseCommissionUsd ?? null;
  const openOtherFeesUsd = row.openOtherFeesUsd ?? row.tradeOpenOtherFeesUsd ?? null;
  const closeOtherFeesUsd = row.closeOtherFeesUsd ?? row.tradeCloseOtherFeesUsd ?? null;
  const financingAccruedUsd = row.financingAccruedUsd ?? row.tradeFinancingAccruedUsd ?? null;
  const swapAccruedUsd = row.swapAccruedUsd ?? row.tradeSwapAccruedUsd ?? null;
  const overnightDays = row.overnightDays ?? row.tradeOvernightDays ?? null;
  const categorySnapshot = row.categorySnapshot ?? row.tradeCategorySnapshot ?? null;
  const costModelVersion = row.costModelVersion ?? row.tradeCostModelVersion ?? null;
  const eventAt = toInt(row.eventAt);
  const quoteTs = toInt(row.quoteTs);
  return {
    id: toInt(row.id),
    tradeId: toInt(row.tradeId),
    eventType: row.eventType ? String(row.eventType) : null,
    eventCategory: row.eventCategory ? String(row.eventCategory) : null,
    eventAt,
    eventAtIso: toIsoFromUnix(eventAt),
    eventAtMs: row.eventAtMs == null ? null : toInt(row.eventAtMs),
    correlationId: row.correlationId ? String(row.correlationId) : null,
    orderId: row.orderId ? String(row.orderId) : null,
    executionId: row.executionId ? String(row.executionId) : null,
    positionId: row.positionId ? String(row.positionId) : null,
    actorType: row.actorType ? String(row.actorType) : null,
    actorUserId: row.actorUserId == null ? null : toInt(row.actorUserId),
    sessionId: row.sessionId ? String(row.sessionId) : null,
    ip: row.ip ? String(row.ip) : null,
    userAgent: row.userAgent ? String(row.userAgent) : null,
    symbol: symbol ? String(symbol) : null,
    side: row.side ? String(row.side) : null,
    orderType: row.orderType ? String(row.orderType) : null,
    timeInForce: row.timeInForce ? String(row.timeInForce) : null,
    qtyLots: row.qtyLots == null ? null : Number(row.qtyLots),
    notionalUsd: notionalUsd == null ? null : Number(notionalUsd),
    grossProfitUsd: grossProfitUsd == null ? null : Number(grossProfitUsd),
    netProfitUsd: netProfitUsd == null ? null : Number(netProfitUsd),
    totalCostsUsd: totalCostsUsd == null ? null : Number(totalCostsUsd),
    openCommissionUsd: openCommissionUsd == null ? null : Number(openCommissionUsd),
    closeCommissionUsd: closeCommissionUsd == null ? null : Number(closeCommissionUsd),
    openOtherFeesUsd: openOtherFeesUsd == null ? null : Number(openOtherFeesUsd),
    closeOtherFeesUsd: closeOtherFeesUsd == null ? null : Number(closeOtherFeesUsd),
    financingAccruedUsd: financingAccruedUsd == null ? null : Number(financingAccruedUsd),
    swapAccruedUsd: swapAccruedUsd == null ? null : Number(swapAccruedUsd),
    overnightDays: overnightDays == null ? null : toInt(overnightDays),
    categorySnapshot: categorySnapshot == null ? null : String(categorySnapshot),
    costModelVersion: costModelVersion == null ? null : String(costModelVersion),
    requestedPrice: row.requestedPrice == null ? null : Number(row.requestedPrice),
    triggerPrice: row.triggerPrice == null ? null : Number(row.triggerPrice),
    limitPrice: row.limitPrice == null ? null : Number(row.limitPrice),
    stopPrice: row.stopPrice == null ? null : Number(row.stopPrice),
    fillPrice: row.fillPrice == null ? null : Number(row.fillPrice),
    avgFillPrice: row.avgFillPrice == null ? null : Number(row.avgFillPrice),
    slippage: row.slippage == null ? null : Number(row.slippage),
    slippagePips: row.slippagePips == null ? null : Number(row.slippagePips),
    slippageReference: row.slippageReference == null ? null : String(row.slippageReference),
    latencyMs: row.latencyMs == null ? null : toInt(row.latencyMs),
    quoteTs,
    quoteTsIso: toIsoFromUnix(quoteTs),
    quoteSource: row.quoteSource == null ? null : String(row.quoteSource),
    quoteBid: row.quoteBid == null ? null : Number(row.quoteBid),
    quoteAsk: row.quoteAsk == null ? null : Number(row.quoteAsk),
    quoteMid: row.quoteMid == null ? null : Number(row.quoteMid),
    quoteSpread: row.quoteSpread == null ? null : Number(row.quoteSpread),
    spreadPips: row.spreadPips == null ? null : Number(row.spreadPips),
    riskCheckName: row.riskCheckName == null ? null : String(row.riskCheckName),
    riskLimitValue: row.riskLimitValue == null ? null : Number(row.riskLimitValue),
    riskObservedValue: row.riskObservedValue == null ? null : Number(row.riskObservedValue),
    riskResult: row.riskResult == null ? null : String(row.riskResult),
    reasonCode: row.reasonCode == null ? null : String(row.reasonCode),
    payloadJson: row.payloadJson == null ? null : String(row.payloadJson),
    prevHash: row.prevHash == null ? null : String(row.prevHash),
    eventHash: row.eventHash == null ? null : String(row.eventHash),
    note: row.note == null ? null : String(row.note),
    userId: row.userId == null ? null : toInt(row.userId),
    username: row.username == null ? null : String(row.username),
    userEmail: row.userEmail == null ? null : String(row.userEmail),
  };
}

function normalizeOrderIntentAuditExportRow(row: any): Record<string, unknown> {
  const eventAt = toInt(row.eventAt);
  const quoteTs = toInt(row.quoteTs);
  return {
    id: toInt(row.id),
    correlationId: row.correlationId == null ? null : String(row.correlationId),
    eventAt,
    eventAtIso: toIsoFromUnix(eventAt),
    eventAtMs: row.eventAtMs == null ? null : toInt(row.eventAtMs),
    eventCode: row.eventCode == null ? null : String(row.eventCode),
    decision: row.decision == null ? null : String(row.decision),
    rejectCheck: row.rejectCheck == null ? null : String(row.rejectCheck),
    rejectReason: row.rejectReason == null ? null : String(row.rejectReason),
    actorType: row.actorType == null ? null : String(row.actorType),
    userId: row.userId == null ? null : toInt(row.userId),
    sessionId: row.sessionId == null ? null : String(row.sessionId),
    ip: row.ip == null ? null : String(row.ip),
    userAgent: row.userAgent == null ? null : String(row.userAgent),
    symbol: row.symbol == null ? null : String(row.symbol),
    side: row.side == null ? null : String(row.side),
    orderType: row.orderType == null ? null : String(row.orderType),
    timeInForce: row.timeInForce == null ? null : String(row.timeInForce),
    qtyLots: row.qtyLots == null ? null : Number(row.qtyLots),
    requestedPrice: row.requestedPrice == null ? null : Number(row.requestedPrice),
    limitPrice: row.limitPrice == null ? null : Number(row.limitPrice),
    stopPrice: row.stopPrice == null ? null : Number(row.stopPrice),
    takeProfit: row.takeProfit == null ? null : Number(row.takeProfit),
    stopLoss: row.stopLoss == null ? null : Number(row.stopLoss),
    quoteBid: row.quoteBid == null ? null : Number(row.quoteBid),
    quoteAsk: row.quoteAsk == null ? null : Number(row.quoteAsk),
    quoteMid: row.quoteMid == null ? null : Number(row.quoteMid),
    quoteTs,
    quoteTsIso: toIsoFromUnix(quoteTs),
    quoteIsStale: row.quoteIsStale == null ? null : Boolean(row.quoteIsStale),
    riskLimitJson: row.riskLimitJson == null ? null : String(row.riskLimitJson),
    riskObservedJson: row.riskObservedJson == null ? null : String(row.riskObservedJson),
    riskSnapshotJson: row.riskSnapshotJson == null ? null : String(row.riskSnapshotJson),
    payloadJson: row.payloadJson == null ? null : String(row.payloadJson),
    prevHash: row.prevHash == null ? null : String(row.prevHash),
    eventHash: row.eventHash == null ? null : String(row.eventHash),
    username: row.username == null ? null : String(row.username),
    userEmail: row.userEmail == null ? null : String(row.userEmail),
  };
}

function writeCsvRows(
  fd: fs.WriteStream,
  columns: readonly string[],
  rows: Array<Record<string, unknown>>,
): void {
  fd.write("\uFEFF");
  fd.write(columns.join(","));
  fd.write("\n");
  for (const row of rows) {
    const values = columns.map((column) => row[column] ?? "");
    fd.write(values.map(safeCsv).join(","));
    fd.write("\n");
  }
}

async function fetchTradeAuditExportRows(
  filters: TradeAuditExportFilters,
): Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean }> {
  const limit = Math.max(1, Math.min(MAX_TRADE_AUDIT_ROWS, Math.trunc(filters.limit ?? 100_000)));
  const clickhouseRows = await queryTradeAuditFromClickHouse({ filters: { ...filters, limit } }).catch((error) => {
    console.warn("[admin-export] trade audit clickhouse query failed; falling back to postgres", error);
    return null;
  });
  if (clickhouseRows) {
    return {
      rows: clickhouseRows.rows.map((row) => normalizeTradeAuditExportRow(row)),
      truncated: clickhouseRows.truncated,
    };
  }

  const where: string[] = [];
  const params: any[] = [];
  if (filters.tradeId != null) {
    where.push("ta.trade_id = ?");
    params.push(Math.trunc(filters.tradeId));
  }
  if (filters.eventType && String(filters.eventType).toLowerCase() !== "all") {
    where.push("ta.event_type = ?");
    params.push(String(filters.eventType));
  }
  if (filters.riskResult && String(filters.riskResult).toLowerCase() !== "all") {
    where.push("ta.risk_result = ?");
    params.push(String(filters.riskResult));
  }
  if (filters.correlationId) {
    where.push("ta.correlation_id = ?");
    params.push(String(filters.correlationId));
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  params.push(limit + 1);
  const rawRows = await queryAll<any>(
    `
      SELECT
        ta.id AS "id",
        ta.trade_id AS "tradeId",
        ta.event_type AS "eventType",
        ta.event_category AS "eventCategory",
        ta.event_at AS "eventAt",
        ta.event_at_ms AS "eventAtMs",
        ta.correlation_id AS "correlationId",
        ta.order_id AS "orderId",
        ta.execution_id AS "executionId",
        ta.position_id AS "positionId",
        ta.actor_type AS "actorType",
        ta.actor_user_id AS "actorUserId",
        ta.session_id AS "sessionId",
        ta.ip AS "ip",
        ta.user_agent AS "userAgent",
        ta.symbol AS "symbol",
        ta.side AS "side",
        ta.order_type AS "orderType",
        ta.time_in_force AS "timeInForce",
        ta.qty_lots AS "qtyLots",
        ta.notional_usd AS "notionalUsd",
        ta.gross_profit_usd AS "grossProfitUsd",
        ta.net_profit_usd AS "netProfitUsd",
        ta.total_costs_usd AS "totalCostsUsd",
        ta.open_commission_usd AS "openCommissionUsd",
        ta.close_commission_usd AS "closeCommissionUsd",
        ta.open_other_fees_usd AS "openOtherFeesUsd",
        ta.close_other_fees_usd AS "closeOtherFeesUsd",
        ta.financing_accrued_usd AS "financingAccruedUsd",
        ta.swap_accrued_usd AS "swapAccruedUsd",
        ta.overnight_days AS "overnightDays",
        ta.category_snapshot AS "categorySnapshot",
        ta.cost_model_version AS "costModelVersion",
        ta.requested_price AS "requestedPrice",
        ta.trigger_price AS "triggerPrice",
        ta.limit_price AS "limitPrice",
        ta.stop_price AS "stopPrice",
        ta.fill_price AS "fillPrice",
        ta.avg_fill_price AS "avgFillPrice",
        ta.slippage AS "slippage",
        ta.slippage_pips AS "slippagePips",
        ta.slippage_reference AS "slippageReference",
        ta.latency_ms AS "latencyMs",
        ta.quote_ts AS "quoteTs",
        ta.quote_source AS "quoteSource",
        ta.quote_bid AS "quoteBid",
        ta.quote_ask AS "quoteAsk",
        ta.quote_mid AS "quoteMid",
        ta.quote_spread AS "quoteSpread",
        ta.spread_pips AS "spreadPips",
        ta.risk_check_name AS "riskCheckName",
        ta.risk_limit_value AS "riskLimitValue",
        ta.risk_observed_value AS "riskObservedValue",
        ta.risk_result AS "riskResult",
        ta.reason_code AS "reasonCode",
        ta.payload_json AS "payloadJson",
        ta.prev_hash AS "prevHash",
        ta.event_hash AS "eventHash",
        ta.note AS "note",
        t.user_id AS "userId",
        u.username AS "username",
        u.email AS "userEmail",
        s.symbol AS "symbolFromTrade",
        t.notional_usd AS "tradeNotionalUsd",
        t.gross_profit_usd AS "tradeGrossProfitUsd",
        t.net_profit_usd AS "tradeNetProfitUsd",
        t.total_costs_usd AS "tradeTotalCostsUsd",
        t.open_commission_usd AS "tradeOpenCommissionUsd",
        t.close_commission_usd AS "tradeCloseCommissionUsd",
        t.open_other_fees_usd AS "tradeOpenOtherFeesUsd",
        t.close_other_fees_usd AS "tradeCloseOtherFeesUsd",
        t.financing_accrued_usd AS "tradeFinancingAccruedUsd",
        t.swap_accrued_usd AS "tradeSwapAccruedUsd",
        t.overnight_days AS "tradeOvernightDays",
        t.category_snapshot AS "tradeCategorySnapshot",
        t.cost_model_version AS "tradeCostModelVersion"
      FROM trade_audit ta
      LEFT JOIN trades t ON ta.trade_id = t.id
      LEFT JOIN users u ON u.id = t.user_id
      LEFT JOIN symbol_configs s ON s.id = t.symbol_id
      ${whereSql}
      ORDER BY ta.event_at DESC, ta.id DESC
      LIMIT ?::int
    `,
    params,
  );

  const truncated = rawRows.length > limit;
  const sliced = truncated ? rawRows.slice(0, limit) : rawRows;
  return {
    rows: sliced.map((row) => normalizeTradeAuditExportRow(row)),
    truncated,
  };
}

async function fetchOrderIntentAuditExportRows(
  filters: OrderIntentAuditExportFilters,
): Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean }> {
  const limit = Math.max(1, Math.min(MAX_ORDER_INTENT_AUDIT_ROWS, Math.trunc(filters.limit ?? 100_000)));
  const clickhouseRows = await queryOrderIntentAuditFromClickHouse({
    filters: { ...filters, limit },
  }).catch((error) => {
    console.warn("[admin-export] order intent audit clickhouse query failed; falling back to postgres", error);
    return null;
  });
  if (clickhouseRows) {
    return {
      rows: clickhouseRows.rows.map((row) => normalizeOrderIntentAuditExportRow(row)),
      truncated: clickhouseRows.truncated,
    };
  }

  const where: string[] = [];
  const params: any[] = [];
  if (filters.correlationId) {
    where.push("oia.correlation_id = ?");
    params.push(String(filters.correlationId));
  }
  if (filters.decision && String(filters.decision).toLowerCase() !== "all") {
    where.push("oia.decision = ?");
    params.push(String(filters.decision));
  }
  if (filters.userId != null) {
    where.push("oia.user_id = ?");
    params.push(Math.trunc(filters.userId));
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  params.push(limit + 1);
  const rawRows = await queryAll<any>(
    `
      SELECT
        oia.id AS "id",
        oia.correlation_id AS "correlationId",
        oia.event_at AS "eventAt",
        oia.event_at_ms AS "eventAtMs",
        oia.event_code AS "eventCode",
        oia.decision AS "decision",
        oia.reject_check AS "rejectCheck",
        oia.reject_reason AS "rejectReason",
        oia.actor_type AS "actorType",
        oia.user_id AS "userId",
        oia.session_id AS "sessionId",
        oia.ip AS "ip",
        oia.user_agent AS "userAgent",
        oia.symbol AS "symbol",
        oia.side AS "side",
        oia.order_type AS "orderType",
        oia.time_in_force AS "timeInForce",
        oia.qty_lots AS "qtyLots",
        oia.requested_price AS "requestedPrice",
        oia.limit_price AS "limitPrice",
        oia.stop_price AS "stopPrice",
        oia.take_profit AS "takeProfit",
        oia.stop_loss AS "stopLoss",
        oia.quote_bid AS "quoteBid",
        oia.quote_ask AS "quoteAsk",
        oia.quote_mid AS "quoteMid",
        oia.quote_ts AS "quoteTs",
        oia.quote_is_stale AS "quoteIsStale",
        oia.risk_limit_json AS "riskLimitJson",
        oia.risk_observed_json AS "riskObservedJson",
        oia.risk_snapshot_json AS "riskSnapshotJson",
        oia.payload_json AS "payloadJson",
        oia.prev_hash AS "prevHash",
        oia.event_hash AS "eventHash",
        u.username AS "username",
        u.email AS "userEmail"
      FROM order_intent_audit oia
      LEFT JOIN users u ON u.id = oia.user_id
      ${whereSql}
      ORDER BY oia.event_at DESC, oia.id DESC
      LIMIT ?::int
    `,
    params,
  );

  const truncated = rawRows.length > limit;
  const sliced = truncated ? rawRows.slice(0, limit) : rawRows;
  return {
    rows: sliced.map((row) => normalizeOrderIntentAuditExportRow(row)),
    truncated,
  };
}

async function buildTradeAuditExport(params: {
  request: AdminDataExportCreateRequest;
  outputPath: string;
}): Promise<{ rowCount: number; truncated: boolean; filename: string; contentType: string }> {
  const filters = params.request.filters as TradeAuditExportFilters;
  const fetched = await fetchTradeAuditExportRows(filters);

  if (params.request.format === "jsonl") {
    const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
    for (const row of fetched.rows) {
      writeJsonlLine(fd, row);
    }
    await new Promise<void>((resolve, reject) => {
      fd.end(() => resolve());
      fd.on("error", reject);
    });
    return {
      rowCount: fetched.rows.length,
      truncated: fetched.truncated,
      filename: `trade_audit_${Date.now()}.jsonl`,
      contentType: "application/x-ndjson",
    };
  }

  if (params.request.format === "parquet") {
    await writeParquetRows({
      outputPath: params.outputPath,
      rows: fetched.rows,
      columns: TRADE_AUDIT_EXPORT_COLUMNS,
    });
    return {
      rowCount: fetched.rows.length,
      truncated: fetched.truncated,
      filename: `trade_audit_${Date.now()}.parquet`,
      contentType: PARQUET_CONTENT_TYPE,
    };
  }

  const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
  writeCsvRows(fd, TRADE_AUDIT_EXPORT_COLUMNS, fetched.rows);
  await new Promise<void>((resolve, reject) => {
    fd.end(() => resolve());
    fd.on("error", reject);
  });
  return {
    rowCount: fetched.rows.length,
    truncated: fetched.truncated,
    filename: `trade_audit_${Date.now()}.csv`,
    contentType: "text/csv; charset=utf-8",
  };
}

async function buildOrderIntentAuditExport(params: {
  request: AdminDataExportCreateRequest;
  outputPath: string;
}): Promise<{ rowCount: number; truncated: boolean; filename: string; contentType: string }> {
  const filters = params.request.filters as OrderIntentAuditExportFilters;
  const fetched = await fetchOrderIntentAuditExportRows(filters);

  if (params.request.format === "jsonl") {
    const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
    for (const row of fetched.rows) {
      writeJsonlLine(fd, row);
    }
    await new Promise<void>((resolve, reject) => {
      fd.end(() => resolve());
      fd.on("error", reject);
    });
    return {
      rowCount: fetched.rows.length,
      truncated: fetched.truncated,
      filename: `order_intent_audit_${Date.now()}.jsonl`,
      contentType: "application/x-ndjson",
    };
  }

  if (params.request.format === "parquet") {
    await writeParquetRows({
      outputPath: params.outputPath,
      rows: fetched.rows,
      columns: ORDER_INTENT_AUDIT_EXPORT_COLUMNS,
    });
    return {
      rowCount: fetched.rows.length,
      truncated: fetched.truncated,
      filename: `order_intent_audit_${Date.now()}.parquet`,
      contentType: PARQUET_CONTENT_TYPE,
    };
  }

  const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
  writeCsvRows(fd, ORDER_INTENT_AUDIT_EXPORT_COLUMNS, fetched.rows);
  await new Promise<void>((resolve, reject) => {
    fd.end(() => resolve());
    fd.on("error", reject);
  });
  return {
    rowCount: fetched.rows.length,
    truncated: fetched.truncated,
    filename: `order_intent_audit_${Date.now()}.csv`,
    contentType: "text/csv; charset=utf-8",
  };
}

async function buildAllTradesExport(params: {
  request: AdminDataExportCreateRequest;
  outputPath: string;
}): Promise<{ rowCount: number; truncated: boolean; filename: string; contentType: string }> {
  const filters = params.request.filters as AllTradesExportFilters;
  const limit = Math.max(1, Math.min(5_000_000, Math.trunc(filters.limit ?? 50_000)));
  let rows = await queryAllTradesFromClickHouse(limit).catch((error) => {
    console.warn("[admin-export] all trades clickhouse query failed; falling back to postgres", error);
    return null;
  });
  if (!rows || rows.length === 0) {
    rows = await queryAll<any>(
      `
        SELECT
          t.id,
          t.user_id AS "userId",
          u.username,
          s.symbol,
          t.type,
          t.status,
          t.lots,
          t.open_price AS "openPrice",
          t.close_price AS "closePrice",
          t.opened_at AS "openedAt",
          t.closed_at AS "closedAt",
          COALESCE(
            t.net_profit_usd,
            CASE
              WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN NULL
              WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::real
              ELSE NULL
            END
          ) AS "netProfitUsd"
        FROM trades t
        LEFT JOIN users u ON u.id = t.user_id
        LEFT JOIN symbol_configs s ON s.id = t.symbol_id
        ORDER BY t.opened_at DESC
        LIMIT $1::int;
      `,
      [limit],
    );
  }

  if (params.request.format === "jsonl") {
    const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
    for (const row of rows) {
      const rawUserId = row.userId ?? row.user_id;
      const rawOpenPrice = row.openPrice ?? row.open_price;
      const rawClosePrice = row.closePrice ?? row.close_price;
      const rawOpenedAt = row.openedAt ?? row.opened_at;
      const rawClosedAt = row.closedAt ?? row.closed_at;
      const rawNetProfitUsd = row.netProfitUsd ?? row.net_profit_usd;
      writeJsonlLine(fd, {
        id: Number(row.id),
        userId: Number(rawUserId),
        username: row.username ? String(row.username) : null,
        symbol: row.symbol ? String(row.symbol) : null,
        type: row.type ? String(row.type) : null,
        status: row.status ? String(row.status) : null,
        lots: row.lots != null ? Number(row.lots) : null,
        openPrice: rawOpenPrice == null ? null : Number(rawOpenPrice),
        closePrice: rawClosePrice == null ? null : Number(rawClosePrice),
        openedAt: rawOpenedAt == null ? null : Number(rawOpenedAt),
        closedAt: rawClosedAt == null ? null : Number(rawClosedAt),
        netProfitUsd: rawNetProfitUsd == null ? null : Number(rawNetProfitUsd),
      });
    }
    await new Promise<void>((resolve, reject) => {
      fd.end(() => resolve());
      fd.on("error", reject);
    });
    return {
      rowCount: rows.length,
      truncated: false,
      filename: `all_trades_${Date.now()}.jsonl`,
      contentType: "application/x-ndjson",
    };
  }

  const columns = [
    "id",
    "userId",
    "username",
    "symbol",
    "type",
    "status",
    "lots",
    "openPrice",
    "closePrice",
    "openedAt",
    "closedAt",
    "netProfitUsd",
  ];
  const normalizedRows = rows.map((row) => ({
    id: row.id,
    userId: row.userId ?? row.user_id,
    username: row.username ?? null,
    symbol: row.symbol ?? null,
    type: row.type ?? null,
    status: row.status ?? null,
    lots: row.lots ?? null,
    openPrice: row.openPrice ?? row.open_price ?? null,
    closePrice: row.closePrice ?? row.close_price ?? null,
    openedAt: row.openedAt ?? row.opened_at ?? null,
    closedAt: row.closedAt ?? row.closed_at ?? null,
    netProfitUsd: row.netProfitUsd ?? row.net_profit_usd ?? null,
  }));

  if (params.request.format === "parquet") {
    await writeParquetRows({
      outputPath: params.outputPath,
      rows: normalizedRows,
      columns,
      schemaHints: {
        id: "INT64",
        userId: "INT64",
        lots: "DOUBLE",
        openPrice: "DOUBLE",
        closePrice: "DOUBLE",
        openedAt: "INT64",
        closedAt: "INT64",
        netProfitUsd: "DOUBLE",
      },
    });
    return {
      rowCount: normalizedRows.length,
      truncated: false,
      filename: `all_trades_${Date.now()}.parquet`,
      contentType: PARQUET_CONTENT_TYPE,
    };
  }

  const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
  fd.write("\uFEFF");
  fd.write(columns.join(","));
  fd.write("\n");
  for (const row of normalizedRows) {
    const values = [
      row.id,
      row.userId,
      row.username,
      row.symbol,
      row.type,
      row.status,
      row.lots,
      row.openPrice,
      row.closePrice,
      row.openedAt,
      row.closedAt,
      row.netProfitUsd,
    ];
    fd.write(values.map(safeCsv).join(","));
    fd.write("\n");
  }
  await new Promise<void>((resolve, reject) => {
    fd.end(() => resolve());
    fd.on("error", reject);
  });
  return {
    rowCount: rows.length,
    truncated: false,
    filename: `all_trades_${Date.now()}.csv`,
    contentType: "text/csv; charset=utf-8",
  };
}

async function buildDailyPnlExport(params: {
  request: AdminDataExportCreateRequest;
  outputPath: string;
}): Promise<{ rowCount: number; truncated: boolean; filename: string; contentType: string }> {
  const filters = params.request.filters as DailyPnlExportFilters;
  const limitDays = Math.max(1, Math.min(3650, Math.trunc(filters.limitDays ?? 365)));
  let rows = await queryDailyPnlFromClickHouse(limitDays).catch((error) => {
    console.warn("[admin-export] daily pnl clickhouse query failed; falling back to postgres", error);
    return null;
  });

  if (!rows || rows.length === 0) {
    rows = await queryAll<any>(
      `
        SELECT
          date,
          SUM(profit_day) AS total_profit,
          SUM(trades_closed) AS total_trades,
          SUM(trades_won) AS winning_trades,
          COUNT(DISTINCT user_id) AS active_users
        FROM daily_closes
        GROUP BY date
        ORDER BY date DESC
        LIMIT $1::int
      `,
      [limitDays],
    );
  }

  if (params.request.format === "jsonl") {
    const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
    for (const row of rows) {
      writeJsonlLine(fd, {
        date: row.date ? String(row.date) : null,
        totalProfit: Number(row.total_profit || 0),
        totalTrades: Number(row.total_trades || 0),
        winningTrades: Number(row.winning_trades || 0),
        activeUsers: Number(row.active_users || 0),
      });
    }
    await new Promise<void>((resolve, reject) => {
      fd.end(() => resolve());
      fd.on("error", reject);
    });
    return {
      rowCount: rows.length,
      truncated: false,
      filename: `daily_pnl_${Date.now()}.jsonl`,
      contentType: "application/x-ndjson",
    };
  }

  const normalizedRows = rows.map((row) => ({
    date: row.date ? String(row.date) : null,
    total_profit: Number(row.total_profit || 0),
    total_trades: Number(row.total_trades || 0),
    winning_trades: Number(row.winning_trades || 0),
    active_users: Number(row.active_users || 0),
  }));

  if (params.request.format === "parquet") {
    await writeParquetRows({
      outputPath: params.outputPath,
      rows: normalizedRows,
      columns: ["date", "total_profit", "total_trades", "winning_trades", "active_users"],
      schemaHints: {
        total_profit: "DOUBLE",
        total_trades: "INT64",
        winning_trades: "INT64",
        active_users: "INT64",
      },
    });
    return {
      rowCount: normalizedRows.length,
      truncated: false,
      filename: `daily_pnl_${Date.now()}.parquet`,
      contentType: PARQUET_CONTENT_TYPE,
    };
  }

  const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
  fd.write("\uFEFF");
  fd.write("date,total_profit,total_trades,winning_trades,active_users\n");
  for (const row of normalizedRows) {
    const values = [
      row.date ?? "",
      row.total_profit,
      row.total_trades,
      row.winning_trades,
      row.active_users,
    ];
    fd.write(values.map(safeCsv).join(","));
    fd.write("\n");
  }
  await new Promise<void>((resolve, reject) => {
    fd.end(() => resolve());
    fd.on("error", reject);
  });
  return {
    rowCount: rows.length,
    truncated: false,
    filename: `daily_pnl_${Date.now()}.csv`,
    contentType: "text/csv; charset=utf-8",
  };
}

export async function buildAdminDataExportArtifact(
  params: BuildExportArtifactParams,
): Promise<BuildExportArtifactResult> {
  const dir = ensureTmpDir();
  const ext =
    params.request.format === "jsonl" ? "jsonl" : params.request.format === "parquet" ? "parquet" : "csv";
  const outputPath = path.join(dir, `${params.jobId}.${Date.now()}.${ext}`);

  try {
    if (params.request.type === "users") {
      const built = await buildUsersExport({
        request: params.request,
        outputPath,
      });
      return {
        filePath: outputPath,
        filename: built.filename,
        contentType: built.contentType,
        rowCount: built.rowCount,
        truncated: built.truncated,
      };
    }

    if (params.request.type === "user_timeline") {
      const built = await buildUserTimelineExport({
        request: params.request,
        outputPath,
      });
      return {
        filePath: outputPath,
        filename: built.filename,
        contentType: built.contentType,
        rowCount: built.rowCount,
        truncated: built.truncated,
      };
    }

    if (params.request.type === "trader_scouting") {
      const built = await buildTraderScoutingExport({
        request: params.request,
        outputPath,
      });
      return {
        filePath: outputPath,
        filename: built.filename,
        contentType: built.contentType,
        rowCount: built.rowCount,
        truncated: built.truncated,
      };
    }

    if (params.request.type === "deactivated_accounts") {
      const built = await buildDeactivatedAccountsExport({
        request: params.request,
        outputPath,
      });
      return {
        filePath: outputPath,
        filename: built.filename,
        contentType: built.contentType,
        rowCount: built.rowCount,
        truncated: built.truncated,
      };
    }

    if (params.request.type === "all_trades") {
      const built = await buildAllTradesExport({
        request: params.request,
        outputPath,
      });
      return {
        filePath: outputPath,
        filename: built.filename,
        contentType: built.contentType,
        rowCount: built.rowCount,
        truncated: built.truncated,
      };
    }

    if (params.request.type === "daily_pnl") {
      const built = await buildDailyPnlExport({
        request: params.request,
        outputPath,
      });
      return {
        filePath: outputPath,
        filename: built.filename,
        contentType: built.contentType,
        rowCount: built.rowCount,
        truncated: built.truncated,
      };
    }

    if (params.request.type === "trade_audit") {
      const built = await buildTradeAuditExport({
        request: params.request,
        outputPath,
      });
      return {
        filePath: outputPath,
        filename: built.filename,
        contentType: built.contentType,
        rowCount: built.rowCount,
        truncated: built.truncated,
      };
    }

    if (params.request.type === "order_intent_audit") {
      const built = await buildOrderIntentAuditExport({
        request: params.request,
        outputPath,
      });
      return {
        filePath: outputPath,
        filename: built.filename,
        contentType: built.contentType,
        rowCount: built.rowCount,
        truncated: built.truncated,
      };
    }

    throw new Error(`Unsupported export type: ${params.request.type}`);
  } catch (err) {
    fs.rmSync(outputPath, { force: true });
    throw err;
  }
}
