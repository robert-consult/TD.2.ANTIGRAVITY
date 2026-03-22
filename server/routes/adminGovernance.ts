import { Router } from "express";
import { requireAdmin } from "../middleware/requireAdmin";
import { getRuntimeGovernanceSnapshot } from "../services/runtimeGovernance";

export const adminGovernanceRouter = Router();
adminGovernanceRouter.use(requireAdmin);

adminGovernanceRouter.get("/runtime-config/governance", async (_req, res) => {
  try {
    res.json(await getRuntimeGovernanceSnapshot());
  } catch (error: any) {
    console.error("Error fetching runtime governance snapshot:", error);
    res.status(500).json({
      message: String(error?.message ?? "Failed to fetch runtime governance snapshot"),
    });
  }
});
