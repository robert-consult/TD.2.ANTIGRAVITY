import { Router } from "express";
import { requireAdmin } from "../middleware/requireAdmin";
import { AdminDaysQuerySchema } from "@shared/admin/dataTab";
import {
  getOrRefreshAdminDataRollup,
  type AdminDataRollupMetricKey,
} from "../services/adminDataRollups";

export const adminDataRollupsRouter = Router();
adminDataRollupsRouter.use(requireAdmin);

function parseMaxAgeSec(): number {
  const parsed = Number(process.env.ADMIN_DATA_ROLLUP_MAX_AGE_SEC ?? 300);
  if (!Number.isFinite(parsed)) return 300;
  return Math.max(15, Math.min(3600, Math.trunc(parsed)));
}

const ROLLUP_MAX_AGE_SEC = parseMaxAgeSec();

function writeRollupHeaders(
  res: any,
  params: {
    metricKey: AdminDataRollupMetricKey;
    windowDays: number;
    asOfSec: number;
    cacheState: "fresh" | "recomputed";
  },
): void {
  res.setHeader("X-Admin-Rollup-Metric", params.metricKey);
  res.setHeader("X-Admin-Rollup-Window-Days", String(params.windowDays));
  res.setHeader("X-Admin-Rollup-As-Of", String(params.asOfSec));
  res.setHeader("X-Admin-Rollup-Cache-State", params.cacheState);
}

adminDataRollupsRouter.get("/kpi-summary", async (req, res) => {
  try {
    const { days: windowDays } = AdminDaysQuerySchema.parse(req.query);
    const result = await getOrRefreshAdminDataRollup<any>({
      metricKey: "kpi_summary",
      windowDays,
      maxAgeSec: ROLLUP_MAX_AGE_SEC,
      refreshedByRole: "api",
    });
    writeRollupHeaders(res, {
      metricKey: "kpi_summary",
      windowDays,
      asOfSec: result.asOfSec,
      cacheState: result.cacheState,
    });
    return res.json(result.data);
  } catch (error) {
    console.error("Get KPI summary rollup error:", error);
    return res.status(500).json({ message: "Failed to fetch KPI summary" });
  }
});

adminDataRollupsRouter.get("/signup-funnel", async (req, res) => {
  try {
    const { days: windowDays } = AdminDaysQuerySchema.parse(req.query);
    const result = await getOrRefreshAdminDataRollup<any>({
      metricKey: "signup_funnel",
      windowDays,
      maxAgeSec: ROLLUP_MAX_AGE_SEC,
      refreshedByRole: "api",
    });
    writeRollupHeaders(res, {
      metricKey: "signup_funnel",
      windowDays,
      asOfSec: result.asOfSec,
      cacheState: result.cacheState,
    });
    return res.json(result.data);
  } catch (error) {
    console.error("Get signup funnel rollup error:", error);
    return res.status(500).json({ message: "Failed to fetch signup funnel" });
  }
});

adminDataRollupsRouter.get("/user-analytics", async (req, res) => {
  try {
    const { days: windowDays } = AdminDaysQuerySchema.parse(req.query);
    const result = await getOrRefreshAdminDataRollup<any>({
      metricKey: "user_analytics",
      windowDays,
      maxAgeSec: ROLLUP_MAX_AGE_SEC,
      refreshedByRole: "api",
    });
    writeRollupHeaders(res, {
      metricKey: "user_analytics",
      windowDays,
      asOfSec: result.asOfSec,
      cacheState: result.cacheState,
    });
    return res.json(result.data);
  } catch (error) {
    console.error("Get user analytics rollup error:", error);
    return res.status(500).json({ message: "Failed to fetch user analytics" });
  }
});

adminDataRollupsRouter.get("/analytics/compliance", async (_req, res) => {
  try {
    const result = await getOrRefreshAdminDataRollup<any>({
      metricKey: "compliance",
      windowDays: 0,
      maxAgeSec: ROLLUP_MAX_AGE_SEC,
      refreshedByRole: "api",
    });
    writeRollupHeaders(res, {
      metricKey: "compliance",
      windowDays: 0,
      asOfSec: result.asOfSec,
      cacheState: result.cacheState,
    });
    return res.json(result.data);
  } catch (error) {
    console.error("Get compliance rollup error:", error);
    return res.status(500).json({ message: "Failed to fetch compliance metrics" });
  }
});

adminDataRollupsRouter.get("/deactivated-accounts/summary", async (req, res) => {
  try {
    const { days: windowDays } = AdminDaysQuerySchema.parse(req.query);
    const result = await getOrRefreshAdminDataRollup<any>({
      metricKey: "deactivated_summary",
      windowDays,
      maxAgeSec: ROLLUP_MAX_AGE_SEC,
      refreshedByRole: "api",
    });
    writeRollupHeaders(res, {
      metricKey: "deactivated_summary",
      windowDays,
      asOfSec: result.asOfSec,
      cacheState: result.cacheState,
    });
    return res.json(result.data);
  } catch (error) {
    console.error("Get deactivated summary rollup error:", error);
    return res.status(500).json({ message: "Failed to load deactivated account summary" });
  }
});
