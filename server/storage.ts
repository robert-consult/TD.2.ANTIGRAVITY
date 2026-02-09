// @ts-nocheck
import { db, dbClient } from "@db";
import { eq, and, or, desc, sql, asc, lt, gt, gte, lte, isNull, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  users,
  trades,
  symbolConfigs,
  userSettings,
  userLoginHistory,
  userAccountEvents,
  userAdminNotes,
  traderJournal,
  adminActions,
  userSessions,
  signupFingerprints,
  InsertUser,
  User,
  InsertSymbolConfig,
  SymbolConfig,
  InsertTrade,
  Trade,
  InsertUserSettings,
  UserSettings,
  UserLoginHistory,
  UserAccountEvent,
  UserAdminNote,
  TraderJournal,
  AdminAction,
  UserSession,
} from "@shared/schema";
import crypto from "crypto";
import { mirrorAccountEventToTradeAudit, type AccountActionProvenance } from "./lib/accountEventMirror";
import { revokeAllSessionsForUser } from "./security/sessionTrail";
import { createNotification, sendFreezeMailboxMessage, sendUnfreezeMailboxMessage } from "./services/messaging";

// Type for signup fingerprint data
export type SignupFingerprintData = {
  requestId: string;
  ip: string;
  userAgent: string;
  geo?: {
    countryCode?: string;
    region?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
    inferredTz?: string;
  };
  device?: {
    deviceType?: string;
    browser?: string;
    os?: string;
  };
  identity?: {
    deviceFp?: string;
    deviceInstallId?: string;
    clientTz?: string;
    clientLang?: string;
  };
  countryIso2Selected?: string;
  regionKeySelected?: string;
};

export const storage = {
  // User operations
  async createUser(userData: { 
    email: string; 
    username: string; 
    password: string; 
    isAdmin?: boolean; 
    balance?: string; 
    countryIso2?: string; 
    regionKey?: string; 
    country?: string; 
    phone?: string | null;
    fingerprint?: SignupFingerprintData;
  }): Promise<User> {
    const passwordHash = await bcrypt.hash(userData.password, 10);
    const fp = userData.fingerprint;
    const ipHash = fp?.ip ? crypto.createHash('sha256').update(fp.ip).digest('hex') : null;

    // Default preferences aligned to signup context
    const tzRaw = String(fp?.identity?.clientTz ?? fp?.geo?.inferredTz ?? "").trim();
    const isProbablyIanaTz = (tz: string) => tz === "UTC" || /^[A-Za-z0-9_+\-]+\/[A-Za-z0-9_+\-]+$/.test(tz);
    const timezone = tzRaw && isProbablyIanaTz(tzRaw) ? tzRaw : "UTC";
    const langRaw = String(fp?.identity?.clientLang ?? "").trim();
    const language = langRaw || "en";
    
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email: userData.email,
          username: userData.username,
          passwordHash,
          isAdmin: userData.isAdmin || false,
          balance: userData.balance || "1000000.00",
          timezone,
          language,
          countryIso2: userData.countryIso2 ?? null,
          regionKey: userData.regionKey ?? null,
          country: userData.countryIso2 ?? userData.country ?? null,
          phone: userData.phone ?? null,
          // Signup fingerprinting columns
          signupIp: fp?.ip ?? null,
          signupIpHash: ipHash,
          signupUserAgent: fp?.userAgent ?? null,
          signupCountryCode: fp?.geo?.countryCode ?? null,
          signupRegion: fp?.geo?.region ?? null,
          signupCity: fp?.geo?.city ?? null,
          signupLatitude: fp?.geo?.latitude ?? null,
          signupLongitude: fp?.geo?.longitude ?? null,
          signupDeviceType: fp?.device?.deviceType ?? null,
          signupBrowser: fp?.device?.browser ?? null,
          signupOs: fp?.device?.os ?? null,
          signupClientTz: fp?.identity?.clientTz ?? null,
          signupInferredTz: fp?.geo?.inferredTz ?? null,
          signupDeviceFp: fp?.identity?.deviceFp ?? null,
          signupDeviceInstallId: fp?.identity?.deviceInstallId ?? null,
          signupClientLang: fp?.identity?.clientLang ?? null,
        })
        .returning();

      // Insert immutable signup fingerprint record (only if we have IP - required field)
      if (fp && fp.ip && ipHash) {
        try {
          await tx.insert(signupFingerprints).values({
            userId: user.id,
            requestId: fp.requestId,
            ip: fp.ip,
            ipHash: ipHash,
            userAgent: fp.userAgent ?? null,
            deviceType: fp.device?.deviceType ?? null,
            browser: fp.device?.browser ?? null,
            os: fp.device?.os ?? null,
            countryCode: fp.geo?.countryCode ?? null,
            region: fp.geo?.region ?? null,
            city: fp.geo?.city ?? null,
            latitude: fp.geo?.latitude ?? null,
            longitude: fp.geo?.longitude ?? null,
            inferredTz: fp.geo?.inferredTz ?? null,
            clientTz: fp.identity?.clientTz ?? null,
            clientLang: fp.identity?.clientLang ?? null,
            deviceFp: fp.identity?.deviceFp ?? null,
            deviceInstallId: fp.identity?.deviceInstallId ?? null,
            countryIso2Selected: fp.countryIso2Selected ?? null,
            regionKeySelected: fp.regionKeySelected ?? null,
          });
        } catch (fpErr) {
          console.error("[Signup] Failed to insert fingerprint record; rolling back user creation:", fpErr);
          throw fpErr;
        }
      } else if (fp && !fp.ip) {
        console.warn("[Signup] Missing IP address - signup fingerprint record not created for user", user.id);
      }

      // Record account creation event in timeline
      await tx.insert(userAccountEvents).values({
        userId: user.id,
        adminId: null,
        eventType: 'ACCOUNT_CREATED',
        title: 'Account created',
        description: `Account registered with email ${user.email}`,
        reasonCode: null,
        reasonText: null,
        metadata: JSON.stringify({ 
          email: user.email, 
          username: user.username,
          initialBalance: userData.balance || "1000000.00",
          signupCountry: fp?.geo?.countryCode ?? null,
          signupCity: fp?.geo?.city ?? null,
        }),
      });

      return user;
    });
  },

  async getUserByEmail(email: string): Promise<User | undefined> {
    const normalizedEmail = email.toLowerCase();
    return await db.query.users.findFirst({
      where: sql`LOWER(${users.email}) = ${normalizedEmail}`,
    });
  },

  async getUserById(id: number): Promise<User | undefined> {
    return await db.query.users.findFirst({
      where: eq(users.id, id),
    });
  },

  async getUserByUsername(username: string): Promise<User | undefined> {
    const normalizedUsername = username.toLowerCase();
    return await db.query.users.findFirst({
      where: sql`LOWER(${users.username}) = ${normalizedUsername}`,
    });
  },

  async updateUser(userId: number, data: Partial<{
    email: string;
    username: string;
    name: string;
    phone: string;
    countryIso2: string;
    country: string;
    password: string;
    passwordHash: string;
  }>): Promise<User> {
    // If password is provided directly, hash it
    const updateData: Record<string, any> = { ...data };
    if (data.password) {
      updateData.passwordHash = await bcrypt.hash(data.password, 10);
      delete updateData.password;
    }
    
    const [updatedUser] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, userId))
      .returning();
    return updatedUser;
  },
  
  async makeUserAdmin(id: number): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ isAdmin: true })
      .where(eq(users.id, id))
      .returning();
    return updatedUser;
  },

  async verifyUser(email: string, password: string): Promise<User | null> {
    const user = await this.getUserByEmail(email);
    if (!user) return null;

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) return null;

    return user;
  },

  async updateUserBalance(userId: number, newBalance: string): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ balance: newBalance })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser;
  },
  
  /**
   * Update a user's margin metrics (used margin, equity, free margin)
   * Used in the MetaTrader-style margin system
   */
  async updateUserMarginMetrics(userId: number, metrics: {
    usedMargin?: number;
    equity?: number;
    freeMargin?: number;
  }): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set(metrics)
      .where(eq(users.id, userId))
      .returning();
    return updatedUser;
  },

  // Symbol config operations
  async createSymbolConfig(data: InsertSymbolConfig): Promise<SymbolConfig> {
    const [symbolConfig] = await db.insert(symbolConfigs).values(data).returning();
    return symbolConfig;
  },

  async getSymbolConfigs(): Promise<SymbolConfig[]> {
    return await db.query.symbolConfigs.findMany({
      where: eq(symbolConfigs.enabled, true),
      orderBy: [asc(symbolConfigs.symbol)],
    });
  },
  
  async getAllSymbolConfigs(): Promise<SymbolConfig[]> {
    return await db.query.symbolConfigs.findMany({
      orderBy: [asc(symbolConfigs.symbol)],
    });
  },

  async getSymbolConfigById(id: number): Promise<SymbolConfig | undefined> {
    return await db.query.symbolConfigs.findFirst({
      where: eq(symbolConfigs.id, id),
    });
  },

  async getSymbolConfigBySymbol(symbol: string): Promise<SymbolConfig | undefined> {
    return await db.query.symbolConfigs.findFirst({
      where: eq(symbolConfigs.symbol, symbol),
    });
  },
  
  async updateSymbolConfig(id: number, data: Partial<SymbolConfig>): Promise<SymbolConfig> {
    const [updated] = await db
      .update(symbolConfigs)
      .set(data)
      .where(eq(symbolConfigs.id, id))
      .returning();
    return updated;
  },
  
  async deleteSymbolConfig(id: number): Promise<void> {
    await db
      .delete(symbolConfigs)
      .where(eq(symbolConfigs.id, id));
  },
  
  async getTradesBySymbolId(symbolId: number, openOnly: boolean = false): Promise<Trade[]> {
    if (openOnly) {
      return await db.query.trades.findMany({
        where: and(
          eq(trades.symbolId, symbolId),
          eq(trades.status, "OPEN")
        ),
        orderBy: [desc(trades.openedAt)]
      });
    } else {
      return await db.query.trades.findMany({
        where: eq(trades.symbolId, symbolId),
        orderBy: [desc(trades.openedAt)]
      });
    }
  },

  // Trade operations
  async createTrade(data: Omit<InsertTrade, "profit" | "status" | "closedAt">): Promise<Trade> {
    const orderType = data.orderType || "Market";
    // Case-insensitive check for market orders (handles MARKET, Market, market)
    const isMarketOrder = orderType.toLowerCase() === "market";
    const status = isMarketOrder ? "OPEN" : "PENDING";
    const nowSec = Math.floor(Date.now() / 1000);
    
    const [trade] = await db
      .insert(trades)
      .values({
        ...data,
        status,
        executedAt: isMarketOrder ? nowSec : undefined,
      })
      .returning();
    return trade;
  },

  async getTradesByUserId(userId: number): Promise<Trade[]> {
    return await db.query.trades.findMany({
      where: eq(trades.userId, userId),
      orderBy: [desc(trades.openedAt)],
      with: {
        symbol: true,
      },
    });
  },

  async getTradeHistoryByUserId(userId: number): Promise<Trade[]> {
    return await db.query.trades.findMany({
      where: and(
        eq(trades.userId, userId),
        or(eq(trades.status, "CLOSED"), eq(trades.status, "CANCELED"))
      ),
      orderBy: [desc(trades.closedAt), desc(trades.openedAt)],
      with: {
        symbol: true,
      },
    });
  },

  async getOpenTradesByUserId(userId: number): Promise<Trade[]> {
    return await db.query.trades.findMany({
      where: and(eq(trades.userId, userId), eq(trades.status, "OPEN")),
      orderBy: [desc(trades.openedAt)],
      with: {
        symbol: true,
      },
    });
  },

  async getPendingTradesByUserId(userId: number): Promise<Trade[]> {
    return await db.query.trades.findMany({
      where: and(eq(trades.userId, userId), eq(trades.status, "PENDING")),
      orderBy: [desc(trades.openedAt)],
      with: {
        symbol: true,
      },
    });
  },

  async getTradeById(id: number): Promise<Trade | undefined> {
    return await db.query.trades.findFirst({
      where: eq(trades.id, id),
      with: {
        symbol: true,
      },
    });
  },

  async closeTrade(
    id: number,
    closePrice: number,
    profit: string,
    auditOrCosts?: {
      closeReason: string;
      closeQuoteTs: number | Date;
      closeSource: string;
      closeBid: number;
      closeAsk: number;
      closeMid: number;
      closeSpread: number;
    } | {
      grossProfitUsd?: number;
      netProfitUsd?: number;
      notionalUsd?: number;
      totalCostsUsd?: number;
      openCommissionUsd?: number;
      closeCommissionUsd?: number;
      openOtherFeesUsd?: number;
      closeOtherFeesUsd?: number;
      financingAccruedUsd?: number;
      swapAccruedUsd?: number;
      overnightDays?: number;
      categorySnapshot?: string;
      costModelVersion?: string;
    },
    maybeCosts?: {
      grossProfitUsd?: number;
      netProfitUsd?: number;
      notionalUsd?: number;
      totalCostsUsd?: number;
      openCommissionUsd?: number;
      closeCommissionUsd?: number;
      openOtherFeesUsd?: number;
      closeOtherFeesUsd?: number;
      financingAccruedUsd?: number;
      swapAccruedUsd?: number;
      overnightDays?: number;
      categorySnapshot?: string;
      costModelVersion?: string;
    },
  ): Promise<Trade> {
    const hasAuditFields = (value: any) =>
      value &&
      (value.closeReason !== undefined ||
        value.closeQuoteTs !== undefined ||
        value.closeSource !== undefined);
    const audit = hasAuditFields(auditOrCosts)
      ? (auditOrCosts as any)
      : (hasAuditFields(maybeCosts) ? (maybeCosts as any) : undefined);
    const costs = hasAuditFields(auditOrCosts)
      ? (maybeCosts as any)
      : (auditOrCosts as any);

    const normalizeCostNumber = (value: unknown): number | undefined => {
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    };

    const nowSec = Math.floor(Date.now() / 1000);
    const closeQuoteTs = audit?.closeQuoteTs == null
      ? undefined
      : typeof audit.closeQuoteTs === "number"
        ? Math.floor(audit.closeQuoteTs)
        : Math.floor(audit.closeQuoteTs.getTime() / 1000);

    const [updatedTrade] = await db
      .update(trades)
      .set({
        closePrice,
        profit,
        status: "CLOSED",
        closedAt: nowSec,
        ...(costs ? {
          grossProfitUsd: normalizeCostNumber(costs.grossProfitUsd),
          netProfitUsd: normalizeCostNumber(costs.netProfitUsd),
          notionalUsd: normalizeCostNumber(costs.notionalUsd),
          totalCostsUsd: normalizeCostNumber(costs.totalCostsUsd),
          openCommissionUsd: normalizeCostNumber(costs.openCommissionUsd),
          closeCommissionUsd: normalizeCostNumber(costs.closeCommissionUsd),
          openOtherFeesUsd: normalizeCostNumber(costs.openOtherFeesUsd),
          closeOtherFeesUsd: normalizeCostNumber(costs.closeOtherFeesUsd),
          financingAccruedUsd: normalizeCostNumber(costs.financingAccruedUsd),
          swapAccruedUsd: normalizeCostNumber(costs.swapAccruedUsd),
          overnightDays: Number.isFinite(Number(costs.overnightDays))
            ? Math.max(0, Math.trunc(Number(costs.overnightDays)))
            : undefined,
          categorySnapshot:
            typeof costs.categorySnapshot === "string" && costs.categorySnapshot.trim()
              ? costs.categorySnapshot
              : undefined,
          costModelVersion:
            typeof costs.costModelVersion === "string" && costs.costModelVersion.trim()
              ? costs.costModelVersion
              : undefined,
        } : {}),
        ...(audit ? {
          closeReason: audit.closeReason,
          closeQuoteTs,
          closeSource: audit.closeSource,
          closeBid: audit.closeBid,
          closeAsk: audit.closeAsk,
          closeMid: audit.closeMid,
          closeSpread: audit.closeSpread,
        } : {}),
      })
      .where(eq(trades.id, id))
      .returning();
    return updatedTrade;
  },

  // User settings operations
  async listUsersWithSettings() {
    const usersWithSettings = await db.select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      username: users.username,
      email: users.email,
      balance: users.balance,
      isAdmin: users.isAdmin,
      isDisabled: users.isDisabled,
      isFrozen: users.isFrozen,
      freezeReasonCode: users.freezeReasonCode,
      freezeReasonText: users.freezeReasonText,
      createdAt: users.createdAt,
      leverage: userSettings.leverage,
      maxConcurrent: userSettings.maxConcurrent,
      maxConcurrentPerInstrument: userSettings.maxConcurrentPerInstrument,
      maxConcurrentLots: userSettings.maxConcurrentLots,
      minHoldSec: userSettings.minHoldSec,
      maxHoldSec: userSettings.maxHoldSec,
      showOnLeaderboard: userSettings.showOnLeaderboard,
    })
    .from(users)
    .leftJoin(userSettings, eq(users.id, userSettings.userId));
    
    return usersWithSettings;
  },

  async upsertSettings(data: InsertUserSettings) {
    await db
      .insert(userSettings)
      .values(data)
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: data,
      });
    
    return data;
  },

  async getUserSettingsById(userId: number) {
    return await db.query.userSettings.findFirst({
      where: eq(userSettings.userId, userId),
    });
  },

  // Risk management functions for Phase-2
  async getClosedTradesByDateRange(userId: number, startTimestamp: number): Promise<Trade[]> {
    return await db.query.trades.findMany({
      where: and(
        eq(trades.userId, userId),
        eq(trades.status, "CLOSED"),
        gte(trades.closedAt, startTimestamp)
      ),
      orderBy: [desc(trades.closedAt)]
    });
  },

  async disableUserAccount(userId: number): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ isDisabled: true })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser;
  },

  async getOldOpenTrades(olderThanTimestamp: number): Promise<Trade[]> {
    return await db.query.trades.findMany({
      where: and(
        eq(trades.status, "OPEN"),
        lt(trades.openedAt, olderThanTimestamp)
      ),
      orderBy: [asc(trades.openedAt)]
    });
  },

  // Leaderboard operations
  async getLeaderboard(limit = 10): Promise<any[]> {
    const capped = Math.min(100, Math.max(1, Number(limit) || 10));

    const res = await dbClient.query(
      `
      WITH closed AS (
        SELECT
          t.user_id,
          COALESCE(
            t.net_profit_usd::numeric,
            CASE
              WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::numeric
              WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::numeric
              ELSE 0::numeric
            END
          ) AS profit_num
        FROM trades t
        WHERE t.status = 'CLOSED'
      )
      SELECT
        u.id AS "userId",
        u.username AS "username",
        COALESCE(SUM(c.profit_num), 0)::float8 AS "profit",
        COALESCE(
          ROUND(
            (
              COALESCE(SUM(c.profit_num), 0)
              / NULLIF(COALESCE(u.starting_equity, 1000000)::numeric, 0)
            ) * 100,
            1
          ),
          0
        )::float8 AS "profitPct",
        COALESCE(
          ROUND(
            (
              SUM(CASE WHEN c.profit_num > 0 THEN 1 ELSE 0 END)::numeric
              / NULLIF(COUNT(c.profit_num), 0)::numeric
            ) * 100,
            1
          ),
          0
        )::float8 AS "winRate",
        COUNT(c.profit_num)::int AS "totalTrades"
      FROM users u
      LEFT JOIN user_settings us ON us.user_id = u.id
      LEFT JOIN closed c ON c.user_id = u.id
      WHERE COALESCE(us.show_lb, true) = true
      GROUP BY u.id, u.username, u.starting_equity
      ORDER BY "profit" DESC
      LIMIT $1
      `,
      [capped],
    );

    return res.rows.map((r: any) => ({
      userId: Number(r.userId),
      username: String(r.username ?? ""),
      profit: Number(r.profit ?? 0),
      profitPct: Number(r.profitPct ?? 0),
      winRate: Number(r.winRate ?? 0),
      totalTrades: Number(r.totalTrades ?? 0),
    }));
  },

  async updateTradeTargets(
    id: number,
    takeProfit: number | null,
    stopLoss: number | null,
  ): Promise<Trade> {
    const [t] = await db
      .update(trades)
      .set({ takeProfit, stopLoss })
      .where(and(eq(trades.id, id), or(eq(trades.status, "OPEN"), eq(trades.status, "PENDING"))))
      .returning();
    return t;
  },

  async cancelTrade(id: number): Promise<Trade> {
    const nowSec = Math.floor(Date.now() / 1000);
    const [t] = await db
      .update(trades)
      .set({ status: "CANCELED", closeReason: "CANCELED_BY_USER", closedAt: nowSec })
      .where(and(eq(trades.id, id), eq(trades.status, "PENDING")))
      .returning();
    return t;
  },

  // ====== USER MANAGEMENT: Login History & IP Tracking ======
  
  async recordLoginAttempt(data: {
    userId?: number;
    email: string;
    ip?: string;
    userAgent?: string;
    success: boolean;
    failureReason?: string;
  }): Promise<UserLoginHistory> {
    const [record] = await db.insert(userLoginHistory).values({
      userId: data.userId,
      email: data.email,
      ip: data.ip || null,
      userAgent: data.userAgent || null,
      success: data.success,
      failureReason: data.failureReason || null,
    }).returning();
    return record;
  },

  async getUserLoginHistory(userId: number, limit = 50): Promise<UserLoginHistory[]> {
    return await db.query.userLoginHistory.findMany({
      where: eq(userLoginHistory.userId, userId),
      orderBy: [desc(userLoginHistory.createdAt)],
      limit,
    });
  },

  async recordLogout(userId: number): Promise<UserLoginHistory | null> {
    // Find the most recent successful login without a logout
    const [latestLogin] = await db.select()
      .from(userLoginHistory)
      .where(and(
        eq(userLoginHistory.userId, userId),
        eq(userLoginHistory.success, true),
        sql`${userLoginHistory.logoutAt} IS NULL`
      ))
      .orderBy(desc(userLoginHistory.createdAt))
      .limit(1);
    
    if (!latestLogin) return null;
    
    const logoutAtSec = Math.floor(Date.now() / 1000);
    const loginAtSec = latestLogin.createdAt instanceof Date
      ? Math.floor(latestLogin.createdAt.getTime() / 1000)
      : Math.floor(Number(latestLogin.createdAt) || 0);
    const sessionLengthSec = Math.max(0, logoutAtSec - loginAtSec);
    
    const [updated] = await db.update(userLoginHistory)
      .set({ 
        logoutAt: logoutAtSec,
        sessionLengthSec,
      })
      .where(eq(userLoginHistory.id, latestLogin.id))
      .returning();
    
    return updated;
  },

  async getActiveSession(userId: number): Promise<UserLoginHistory | null> {
    // Find active session (login without logout)
    const [session] = await db.select()
      .from(userLoginHistory)
      .where(and(
        eq(userLoginHistory.userId, userId),
        eq(userLoginHistory.success, true),
        sql`${userLoginHistory.logoutAt} IS NULL`
      ))
      .orderBy(desc(userLoginHistory.createdAt))
      .limit(1);
    
    return session || null;
  },

  async getOnlineUsers(): Promise<{
    onlineCount: number;
    offlineCount: number;
    onlineUsers: Array<{
      id: number;
      userId: number;
      email: string;
      username: string | null;
      name: string | null;
      ip: string | null;
      loginTime: Date;
      sessionDuration: number;
    }>;
  }> {
    // Get all active sessions (login without logout)
    const activeSessions = await db.select({
      id: userLoginHistory.id,
      userId: userLoginHistory.userId,
      email: userLoginHistory.email,
      username: users.username,
      name: users.name,
      ip: userLoginHistory.ip,
      createdAt: userLoginHistory.createdAt,
    })
    .from(userLoginHistory)
    .leftJoin(users, eq(userLoginHistory.userId, users.id))
    .where(and(
      eq(userLoginHistory.success, true),
      sql`${userLoginHistory.logoutAt} IS NULL`
    ))
    .orderBy(desc(userLoginHistory.createdAt));

    // Get unique online user IDs
    const onlineUserIds = new Set<number>();
    const onlineUsers: Array<{
      id: number;
      userId: number;
      email: string;
      username: string | null;
      name: string | null;
      ip: string | null;
      loginTime: Date;
      sessionDuration: number;
    }> = [];

    const now = Date.now();
    for (const session of activeSessions) {
      if (session.userId && !onlineUserIds.has(session.userId)) {
        onlineUserIds.add(session.userId);
        const loginTime = session.createdAt instanceof Date 
          ? session.createdAt 
          : new Date(Number(session.createdAt) * 1000);
        const sessionDuration = Math.round((now - loginTime.getTime()) / 1000);
        
        onlineUsers.push({
          id: session.id,
          userId: session.userId,
          email: session.email,
          username: session.username,
          name: session.name,
          ip: session.ip,
          loginTime,
          sessionDuration,
        });
      }
    }

    // Get total user count
    const allUsers = await db.select({ id: users.id }).from(users);
    const totalUsers = allUsers.length;
    const onlineCount = onlineUserIds.size;
    const offlineCount = totalUsers - onlineCount;

    return {
      onlineCount,
      offlineCount,
      onlineUsers,
    };
  },
  
  async getAllLoginHistory(limit = 200): Promise<any[]> {
    const history = await db.select({
      id: userLoginHistory.id,
      userId: userLoginHistory.userId,
      email: userLoginHistory.email,
      username: users.username,
      ipAddress: userLoginHistory.ip,
      userAgent: userLoginHistory.userAgent,
      success: userLoginHistory.success,
      failureReason: userLoginHistory.failureReason,
      createdAt: userLoginHistory.createdAt,
      // Geo-enrichment columns
      countryCode: userLoginHistory.countryCode,
      region: userLoginHistory.region,
      city: userLoginHistory.city,
      latitude: userLoginHistory.latitude,
      longitude: userLoginHistory.longitude,
      // Device identity columns
      clientTz: userLoginHistory.clientTz,
      clientLang: userLoginHistory.clientLang,
      deviceFp: userLoginHistory.deviceFp,
      deviceInstallId: userLoginHistory.deviceInstallId,
    })
    .from(userLoginHistory)
    .leftJoin(users, eq(userLoginHistory.userId, users.id))
    .orderBy(desc(userLoginHistory.createdAt))
    .limit(limit);
    
    return history;
  },

  async getUserLoginStats(userId: number): Promise<{
    lastLoginTime: Date | null;
    lastLoginIp: string | null;
    lastLogoutTime: Date | null;
    totalSessionLengthSec: number;
  }> {
    // Get all successful logins for this user
    const logins = await db.select()
      .from(userLoginHistory)
      .where(and(
        eq(userLoginHistory.userId, userId),
        eq(userLoginHistory.success, true)
      ))
      .orderBy(desc(userLoginHistory.createdAt));
    
    if (logins.length === 0) {
      return {
        lastLoginTime: null,
        lastLoginIp: null,
        lastLogoutTime: null,
        totalSessionLengthSec: 0,
      };
    }
    
    // Most recent login
    const lastLogin = logins[0];
    const lastLoginTime = lastLogin.createdAt instanceof Date 
      ? lastLogin.createdAt 
      : new Date(Number(lastLogin.createdAt) * 1000);
    
    // Find last logout (most recent logoutAt that exists)
    const loginsWithLogout = logins.filter(l => l.logoutAt);
    let lastLogoutTime: Date | null = null;
    if (loginsWithLogout.length > 0) {
      const lo = loginsWithLogout[0].logoutAt;
      lastLogoutTime = lo instanceof Date ? lo : new Date(Number(lo) * 1000);
    }
    
    // Sum up all session lengths
    const totalSessionLengthSec = logins.reduce((sum, l) => sum + (l.sessionLengthSec || 0), 0);
    
    return {
      lastLoginTime,
      lastLoginIp: lastLogin.ip || null,
      lastLogoutTime,
      totalSessionLengthSec,
    };
  },

  async getAllUsersLoginStats(): Promise<Map<number, {
    lastLoginTime: Date | null;
    lastLoginIp: string | null;
    lastLogoutTime: Date | null;
    totalSessionLengthSec: number;
  }>> {
    // Get all successful logins grouped by user
    const allLogins = await db.select()
      .from(userLoginHistory)
      .where(eq(userLoginHistory.success, true))
      .orderBy(desc(userLoginHistory.createdAt));
    
    const statsMap = new Map<number, {
      lastLoginTime: Date | null;
      lastLoginIp: string | null;
      lastLogoutTime: Date | null;
      totalSessionLengthSec: number;
    }>();
    
    // Group by userId
    const loginsByUser: Record<number, typeof allLogins> = {};
    for (const login of allLogins) {
      if (!login.userId) continue;
      if (!loginsByUser[login.userId]) {
        loginsByUser[login.userId] = [];
      }
      loginsByUser[login.userId].push(login);
    }
    
    // Compute stats for each user
    for (const userIdStr of Object.keys(loginsByUser)) {
      const userId = parseInt(userIdStr);
      const logins = loginsByUser[userId];
      const lastLogin = logins[0];
      const lastLoginTime = lastLogin.createdAt instanceof Date 
        ? lastLogin.createdAt 
        : new Date(Number(lastLogin.createdAt) * 1000);
      
      const loginsWithLogout = logins.filter((l: typeof lastLogin) => l.logoutAt);
      let lastLogoutTime: Date | null = null;
      if (loginsWithLogout.length > 0) {
        const lo = loginsWithLogout[0].logoutAt;
        lastLogoutTime = lo instanceof Date ? lo : new Date(Number(lo) * 1000);
      }
      
      const totalSessionLengthSec = logins.reduce((sum: number, l: typeof lastLogin) => sum + (l.sessionLengthSec || 0), 0);
      
      statsMap.set(userId, {
        lastLoginTime,
        lastLoginIp: lastLogin.ip || null,
        lastLogoutTime,
        totalSessionLengthSec,
      });
    }
    
    return statsMap;
  },

  // ====== USER MANAGEMENT: Account Events (Timeline) ======
  
  async recordAccountEvent(data: {
    userId: number;
    adminId?: number;
    eventType: string;
    title: string;
    description?: string;
    reasonCode?: string;
    reasonText?: string;
    metadata?: Record<string, any>;
    provenance?: AccountActionProvenance;
  }): Promise<UserAccountEvent> {
    const [record] = await db.insert(userAccountEvents).values({
      userId: data.userId,
      adminId: data.adminId || null,
      eventType: data.eventType,
      title: data.title,
      description: data.description || null,
      reasonCode: data.reasonCode || null,
      reasonText: data.reasonText || null,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      createdAt: Math.floor(Date.now() / 1000),
    }).returning();
    try {
      await mirrorAccountEventToTradeAudit({
        accountEventId: record.id,
        userId: data.userId,
        adminId: data.adminId,
        eventType: data.eventType,
        title: data.title,
        description: data.description ?? null,
        reasonCode: data.reasonCode ?? null,
        reasonText: data.reasonText ?? null,
        metadata: data.metadata ?? null,
        provenance: data.provenance,
      });
    } catch (e) {
      console.warn("[audit] mirrorAccountEventToTradeAudit failed:", e);
    }
    return record;
  },

  async getUserTimeline(userId: number, limit = 200): Promise<any[]> {
    // Merge login events, trades, and account events into a unified timeline
    const [logins, accountEvents, userTrades] = await Promise.all([
      db.query.userLoginHistory.findMany({
        where: eq(userLoginHistory.userId, userId),
        orderBy: [desc(userLoginHistory.createdAt)],
        limit: 100,
      }),
      db.query.userAccountEvents.findMany({
        where: eq(userAccountEvents.userId, userId),
        orderBy: [desc(userAccountEvents.createdAt)],
        limit: 100,
      }),
      db.query.trades.findMany({
        where: eq(trades.userId, userId),
        orderBy: [desc(trades.openedAt)],
        limit: 100,
        with: { symbol: true },
      }),
    ]);

    // Transform into unified timeline format
    const timeline: any[] = [];

    for (const login of logins) {
      // Add LOGIN event
      timeline.push({
        id: `login-${login.id}`,
        type: 'LOGIN',
        title: login.success ? 'User logged in' : 'Login failed',
        description: login.success 
          ? `From IP: ${login.ip || 'unknown'}` 
          : `Failed: ${login.failureReason || 'unknown'}`,
        timestamp: login.createdAt,
        severity: login.success ? 'INFO' : 'WARN',
        metadata: { 
          ip: login.ip, 
          userAgent: login.userAgent,
          loginTime: login.createdAt,
        },
        loginTime: login.createdAt,
        loginIp: login.ip,
      });

      // Add LOGOUT event if user has logged out
      if (login.success && login.logoutAt) {
        const formatSessionLength = (seconds: number | null | undefined) => {
          if (!seconds) return 'Unknown';
          const hours = Math.floor(seconds / 3600);
          const mins = Math.floor((seconds % 3600) / 60);
          const secs = seconds % 60;
          if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
          if (mins > 0) return `${mins}m ${secs}s`;
          return `${secs}s`;
        };

        timeline.push({
          id: `logout-${login.id}`,
          type: 'LOGOUT',
          title: 'User logged out',
          description: `Session length: ${formatSessionLength(login.sessionLengthSec)}`,
          timestamp: login.logoutAt,
          severity: 'INFO',
          metadata: { 
            ip: login.ip, 
            userAgent: login.userAgent,
            loginTime: login.createdAt,
            logoutTime: login.logoutAt,
            sessionLengthSec: login.sessionLengthSec,
          },
          loginTime: login.createdAt,
          logoutTime: login.logoutAt,
          sessionLengthSec: login.sessionLengthSec,
          loginIp: login.ip,
        });
      }
    }

    for (const event of accountEvents) {
      timeline.push({
        id: `event-${event.id}`,
        type: event.eventType,
        title: event.title,
        description: event.description,
        timestamp: event.createdAt,
        severity: event.eventType.includes('FREEZE') ? 'HIGH' : 'INFO',
        reasonCode: event.reasonCode,
        reasonText: event.reasonText,
        metadata: event.metadata ? JSON.parse(event.metadata) : null,
        adminId: event.adminId,
      });
    }

    for (const trade of userTrades) {
      if (trade.status === 'OPEN' || trade.status === 'CLOSED') {
        timeline.push({
          id: `trade-open-${trade.id}`,
          type: 'TRADE_OPENED',
          title: `${trade.type} ${(trade as any).symbol?.symbol || 'Unknown'}`,
          description: `${trade.lots} lots @ ${trade.openPrice}`,
          timestamp: trade.openedAt,
          severity: 'INFO',
          metadata: { tradeId: trade.id, symbol: (trade as any).symbol?.symbol, lots: trade.lots },
        });
      }
      if (trade.status === 'CLOSED' && trade.closedAt) {
        const netProfit = Number((trade as any).netProfitUsd);
        const legacyProfit = Number.parseFloat(String(trade.profit || "0"));
        const timelineProfit = Number.isFinite(netProfit)
          ? netProfit
          : (Number.isFinite(legacyProfit) ? legacyProfit : 0);
        timeline.push({
          id: `trade-close-${trade.id}`,
          type: 'TRADE_CLOSED',
          title: `Closed ${(trade as any).symbol?.symbol || 'Unknown'}`,
          description: `P/L: $${timelineProfit.toFixed(2)}`,
          timestamp: trade.closedAt,
          severity: timelineProfit >= 0 ? 'INFO' : 'WARN',
          metadata: {
            tradeId: trade.id,
            profit: trade.profit,
            netProfitUsd: Number.isFinite(netProfit) ? netProfit : null,
            totalCostsUsd: Number((trade as any).totalCostsUsd ?? 0),
          },
        });
      }
    }

    // Sort by timestamp descending and limit
    timeline.sort((a, b) => {
      const aTime = a.timestamp instanceof Date ? a.timestamp.getTime() : Number(a.timestamp) * 1000;
      const bTime = b.timestamp instanceof Date ? b.timestamp.getTime() : Number(b.timestamp) * 1000;
      return bTime - aTime;
    });

    return timeline.slice(0, limit);
  },

  // ====== USER MANAGEMENT: Admin Notes & Flags ======
  
  async addUserNote(data: {
    userId: number;
    adminId?: number;
    type: 'NOTE' | 'FLAG';
    severity: 'INFO' | 'WARN' | 'HIGH' | 'CRITICAL';
    flagCode?: string;
    content: string;
    provenance?: AccountActionProvenance;
  }): Promise<UserAdminNote> {
    const [note] = await db.insert(userAdminNotes).values({
      userId: data.userId,
      adminId: data.adminId || null,
      type: data.type,
      severity: data.severity,
      flagCode: data.flagCode || null,
      content: data.content,
    }).returning();
    
    // Also record as account event
    await this.recordAccountEvent({
      userId: data.userId,
      adminId: data.adminId,
      eventType: data.type === 'FLAG' ? 'FLAG_ADDED' : 'NOTE_ADDED',
      title: data.type === 'FLAG' ? `Flag: ${data.flagCode || data.severity}` : 'Admin note added',
      description: data.content.substring(0, 100),
      reasonCode: data.flagCode,
      provenance: data.provenance,
    });
    
    return note;
  },

  async getUserNotes(userId: number): Promise<UserAdminNote[]> {
    return await db.query.userAdminNotes.findMany({
      where: eq(userAdminNotes.userId, userId),
      orderBy: [desc(userAdminNotes.createdAt)],
    });
  },

  async resolveUserNote(noteId: number, adminId: number): Promise<UserAdminNote> {
    const nowSec = Math.floor(Date.now() / 1000);
    const [updated] = await db.update(userAdminNotes)
      .set({
        isResolved: true,
        resolvedAt: nowSec,
        resolvedByAdminId: adminId,
      })
      .where(eq(userAdminNotes.id, noteId))
      .returning();
    return updated;
  },

  // ====== USER MANAGEMENT: Freeze/Unfreeze ======
  
  async freezeUserAccount(params: {
    userId: number;
    adminId: number;
    reasonCode: string;
    reasonText?: string;
    provenance?: AccountActionProvenance;
  }): Promise<User> {
    const nowSec = Math.floor(Date.now() / 1000);
    const [updated] = await db.update(users)
      .set({
        isFrozen: true,
        freezeReasonCode: params.reasonCode,
        freezeReasonText: params.reasonText || null,
        frozenAt: nowSec,
        frozenBy: params.adminId,
      })
      .where(eq(users.id, params.userId))
      .returning();
    
    if (!updated) {
      throw new Error(`User not found: ${params.userId}`);
    }
    
    // Record event
    await this.recordAccountEvent({
      userId: params.userId,
      adminId: params.adminId,
      eventType: 'FREEZE',
      title: 'Account frozen',
      description: params.reasonText || params.reasonCode,
      reasonCode: params.reasonCode,
      reasonText: params.reasonText,
      provenance: params.provenance,
      });

    try {
      await this.logAdminAction({
        adminId: params.adminId,
        userId: params.userId,
        actionType: "ACCOUNT_FREEZE",
        metadata: {
          reasonCode: params.reasonCode,
          reasonText: params.reasonText ?? null,
        },
        ip: params.provenance?.ip ?? null,
        userAgent: params.provenance?.userAgent ?? null,
      });
    } catch (e) {
      console.warn("[audit] logAdminAction failed (freezeUserAccount):", e);
    }

    try {
      await revokeAllSessionsForUser({
        actorUserId: params.adminId,
        targetUserId: params.userId,
        reason: params.reasonText || params.reasonCode,
      });
    } catch (e) {
      console.error("Failed to revoke sessions after freeze:", e);
    }

    void createNotification({
      userId: params.userId,
      type: "ACCOUNT",
      severity: "CRITICAL",
      title: "Account frozen",
      message: params.reasonText
        ? `Your account has been frozen. Reason: ${params.reasonCode}: ${params.reasonText}.`
        : `Your account has been frozen. Reason: ${params.reasonCode}.`,
      sourceEvent: `ACCOUNT_FREEZE:${params.userId}:${nowSec}`,
      link: "/profile",
      playSound: true,
    }).catch((err) => {
      console.error("[notifications] failed to create freeze notification:", err);
    });

    void sendFreezeMailboxMessage({
      userId: params.userId,
      reasonCode: params.reasonCode,
      reasonText: params.reasonText,
    }).catch((err) => {
      console.error("[mailbox] failed to create freeze mailbox message:", err);
    });
     
    return updated;
  },

  async unfreezeUserAccount(params: {
    userId: number;
    adminId: number;
    reason?: string;
    provenance?: AccountActionProvenance;
  }): Promise<User> {
    const timestamp = Math.floor(Date.now() / 1000);
    const [updated] = await db.update(users)
      .set({
        isFrozen: false,
        freezeReasonCode: null,
        freezeReasonText: null,
        frozenAt: null,
        frozenBy: null,
      })
      .where(eq(users.id, params.userId))
      .returning();
    
    if (!updated) {
      throw new Error(`User not found: ${params.userId}`);
    }
    
    // Record event
    await this.recordAccountEvent({
      userId: params.userId,
      adminId: params.adminId,
      eventType: 'UNFREEZE',
      title: 'Account unfrozen',
      description: params.reason || 'Account access restored',
      provenance: params.provenance,
    });

    try {
      await this.logAdminAction({
        adminId: params.adminId,
        userId: params.userId,
        actionType: "ACCOUNT_UNFREEZE",
        metadata: {
          reason: params.reason ?? null,
        },
        ip: params.provenance?.ip ?? null,
        userAgent: params.provenance?.userAgent ?? null,
      });
    } catch (e) {
      console.warn("[audit] logAdminAction failed (unfreezeUserAccount):", e);
    }

    void createNotification({
      userId: params.userId,
      type: "ACCOUNT",
      severity: "SUCCESS",
      title: "Account unfrozen",
      message: params.reason
        ? `Your account access has been restored. Note: ${params.reason}.`
        : "Your account access has been restored.",
      sourceEvent: `ACCOUNT_UNFREEZE:${params.userId}:${timestamp}`,
      link: "/profile",
      playSound: true,
    }).catch((err) => {
      console.error("[notifications] failed to create unfreeze notification:", err);
    });

    void sendUnfreezeMailboxMessage({
      userId: params.userId,
      reason: params.reason,
    }).catch((err) => {
      console.error("[mailbox] failed to create unfreeze mailbox message:", err);
    });
     
    return updated;
  },

  // ====== USER MANAGEMENT: Enable/Disable & Bulk Actions ======
  
  async setUserDisabled(
    userId: number,
    disabled: boolean,
    adminId?: number,
    provenance?: AccountActionProvenance
  ): Promise<User> {
    const [updated] = await db.update(users)
      .set({ isDisabled: disabled })
      .where(eq(users.id, userId))
      .returning();
    
    if (adminId !== undefined) {
      await this.recordAccountEvent({
        userId,
        adminId,
        eventType: 'STATUS_CHANGE',
        title: disabled ? 'Account disabled' : 'Account enabled',
        description: disabled ? 'Trading privileges revoked' : 'Trading privileges restored',
        provenance,
      });

      try {
        await this.logAdminAction({
          adminId,
          userId,
          actionType: disabled ? "ACCOUNT_DISABLE" : "ACCOUNT_ENABLE",
          metadata: { disabled },
          ip: provenance?.ip ?? null,
          userAgent: provenance?.userAgent ?? null,
        });
      } catch (e) {
        console.warn("[audit] logAdminAction failed (setUserDisabled):", e);
      }
    }

    if (disabled) {
      try {
        await revokeAllSessionsForUser({
          actorUserId: adminId ?? 0,
          targetUserId: userId,
          reason: "Account disabled",
        });
      } catch (e) {
        console.error("Failed to revoke sessions after disable:", e);
      }
    }
     
    return updated;
  },

  async bulkSetUsersDisabled(
    userIds: number[],
    disabled: boolean,
    adminId: number,
    provenance?: AccountActionProvenance
  ): Promise<number> {
    const result = await db.update(users)
      .set({ isDisabled: disabled })
      .where(inArray(users.id, userIds));
    
    // Record events for each user
    for (const userId of userIds) {
      await this.recordAccountEvent({
        userId,
        adminId,
        eventType: 'STATUS_CHANGE',
        title: disabled ? 'Account disabled (bulk)' : 'Account enabled (bulk)',
        description: `Bulk action affecting ${userIds.length} accounts`,
        provenance,
      });

      try {
        await this.logAdminAction({
          adminId,
          userId,
          actionType: disabled ? "ACCOUNT_DISABLE_BULK" : "ACCOUNT_ENABLE_BULK",
          metadata: { disabled, userCount: userIds.length },
          ip: provenance?.ip ?? null,
          userAgent: provenance?.userAgent ?? null,
        });
      } catch (e) {
        console.warn("[audit] logAdminAction failed (bulkSetUsersDisabled):", e);
      }

      if (disabled) {
        try {
          await revokeAllSessionsForUser({
            actorUserId: adminId ?? 0,
            targetUserId: userId,
            reason: "Account disabled (bulk)",
          });
        } catch (e) {
          console.error("Failed to revoke sessions after bulk disable:", e);
        }
      }
    }
    
    return userIds.length;
  },

  async bulkApplyRiskProfile(
    userIds: number[],
    settings: Partial<UserSettings>,
    adminId: number,
    provenance?: AccountActionProvenance
  ): Promise<number> {
    let count = 0;
    for (const userId of userIds) {
      await db.insert(userSettings)
        .values({ userId, ...settings } as any)
        .onConflictDoUpdate({
          target: userSettings.userId,
          set: settings as any,
        });
      
      await this.recordAccountEvent({
        userId,
        adminId,
        eventType: 'SETTINGS_CHANGE',
        title: 'Risk profile applied (bulk)',
        description: `Settings updated: ${Object.keys(settings).join(', ')}`,
        metadata: settings as any,
        provenance,
      });
      
      count++;
    }
    return count;
  },

  // ====== USER MANAGEMENT: Get All Users with full info ======
  
  async getAllUsersWithDetails() {
    const allUsers = await db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      username: users.username,
      phone: users.phone,
      balance: users.balance,
      isAdmin: users.isAdmin,
      isDisabled: users.isDisabled,
      isFrozen: users.isFrozen,
      freezeReasonCode: users.freezeReasonCode,
      freezeReasonText: users.freezeReasonText,
      frozenAt: users.frozenAt,
      createdAt: users.createdAt,
      leverage: userSettings.leverage,
      maxConcurrent: userSettings.maxConcurrent,
      maxConcurrentLots: userSettings.maxConcurrentLots,
      minHoldSec: userSettings.minHoldSec,
      maxHoldSec: userSettings.maxHoldSec,
    })
    .from(users)
    .leftJoin(userSettings, eq(users.id, userSettings.userId));
    
    return allUsers;
  },

  // ====== TRADER JOURNAL ======

  async getJournalEntries(userId: number, limit = 200): Promise<TraderJournal[]> {
    return await db.query.traderJournal.findMany({
      where: eq(traderJournal.userId, userId),
      orderBy: [desc(traderJournal.createdAt)],
      limit,
    });
  },

  async createJournalEntry(data: {
    userId: number;
    tradeId?: number | null;
    tradeIds?: number[] | null;
    note: string;
    mood?: string | null;
    tags?: string[] | null;
    attachmentUrl?: string | null;
  }): Promise<TraderJournal> {
    const [entry] = await db.insert(traderJournal).values({
      userId: data.userId,
      tradeId: data.tradeId ?? null,
      tradeIds: data.tradeIds ? JSON.stringify(data.tradeIds) : null,
      note: data.note,
      mood: data.mood ?? null,
      tags: data.tags ? JSON.stringify(data.tags) : null,
      attachmentUrl: data.attachmentUrl ?? null,
    }).returning();
    return entry;
  },

  async updateJournalEntry(id: number, userId: number, data: {
    note?: string;
    mood?: string | null;
    tags?: string[] | null;
    attachmentUrl?: string | null;
    tradeId?: number | null;
    tradeIds?: number[] | null;
  }): Promise<TraderJournal | null> {
    const updates: any = { updatedAt: Math.floor(Date.now() / 1000) };
    if (data.note !== undefined) updates.note = data.note;
    if (data.mood !== undefined) updates.mood = data.mood;
    if (data.tags !== undefined) updates.tags = data.tags ? JSON.stringify(data.tags) : null;
    if (data.attachmentUrl !== undefined) updates.attachmentUrl = data.attachmentUrl;
    if (data.tradeId !== undefined) updates.tradeId = data.tradeId;
    if (data.tradeIds !== undefined) updates.tradeIds = data.tradeIds ? JSON.stringify(data.tradeIds) : null;

    const [updated] = await db.update(traderJournal)
      .set(updates)
      .where(and(eq(traderJournal.id, id), eq(traderJournal.userId, userId)))
      .returning();
    return updated || null;
  },

  async deleteJournalEntry(id: number, userId: number): Promise<boolean> {
    const result = await db.delete(traderJournal)
      .where(and(eq(traderJournal.id, id), eq(traderJournal.userId, userId)))
      .returning({ id: traderJournal.id });
    return result.length > 0;
  },

  // ====== ADMIN ACTIONS AUDIT ======

  async logAdminAction(data: {
    adminId: number;
    userId: number;
    actionType: string;
    metadata?: any;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<AdminAction> {
    const [action] = await db.insert(adminActions).values({
      adminId: data.adminId,
      userId: data.userId,
      actionType: data.actionType,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      ip: data.ip ?? null,
      userAgent: data.userAgent ?? null,
    }).returning();
    return action;
  },

  async getAdminActions(limit = 100): Promise<AdminAction[]> {
    return await db.query.adminActions.findMany({
      orderBy: [desc(adminActions.createdAt)],
      limit,
    });
  },

  // ====== SESSION MANAGEMENT ======

  async createUserSession(data: {
    sessionId: string;
    userId: number;
    ip?: string | null;
    userAgent?: string | null;
    deviceType?: string | null;
    browser?: string | null;
    os?: string | null;
    expiresAt?: Date | null;
  }): Promise<UserSession> {
    const [session] = await db.insert(userSessions).values({
      sessionId: data.sessionId,
      userId: data.userId,
      ip: data.ip ?? null,
      userAgent: data.userAgent ?? null,
      deviceType: data.deviceType ?? null,
      browser: data.browser ?? null,
      os: data.os ?? null,
      expiresAt: data.expiresAt ?? null,
    }).returning();
    return session;
  },

  async getUserSessions(userId: number): Promise<UserSession[]> {
    return await db.query.userSessions.findMany({
      where: eq(userSessions.userId, userId),
      orderBy: [desc(userSessions.lastActiveAt)],
    });
  },

  async updateSessionActivity(sessionId: string): Promise<void> {
    await db.update(userSessions)
      .set({ lastActiveAt: sql`(strftime('%s', 'now'))` })
      .where(eq(userSessions.sessionId, sessionId));
  },

  async terminateSession(userId: number, sessionId: string): Promise<void> {
    await db.delete(userSessions)
      .where(and(
        eq(userSessions.userId, userId),
        eq(userSessions.sessionId, sessionId)
      ));
  },

  async terminateAllOtherSessions(userId: number, currentSessionId: string): Promise<void> {
    await db.delete(userSessions)
      .where(and(
        eq(userSessions.userId, userId),
        sql`${userSessions.sessionId} != ${currentSessionId}`
      ));
  },

  async deleteSessionBySessionId(sessionId: string): Promise<void> {
    await db.delete(userSessions)
      .where(eq(userSessions.sessionId, sessionId));
  },

  // ====== USER PREFERENCES ======

  async updateUserPreferences(userId: number, data: {
    timezone?: string;
    language?: string;
  }): Promise<void> {
    // Country is immutable after signup; do not update it from preferences.
    const updates: Record<string, string> = {};
    if (typeof data.timezone === "string") updates.timezone = data.timezone;
    if (typeof data.language === "string") updates.language = data.language;

    if (Object.keys(updates).length === 0) return;

    await db.update(users)
      .set(updates)
      .where(eq(users.id, userId));
  },

  // ====== VERIFICATION COMPLIANCE ======

  async getVerificationComplianceMetrics(): Promise<{
    verifiedWithin14Days: number;
    overdueReverify: number;
    lockedAccounts: number;
    pendingKyc: number;
    totalUsers: number;
  }> {
    const now = Math.floor(Date.now() / 1000);
    const fourteenDaysAgo = now - (14 * 24 * 60 * 60);
    
    const allUsers = await db.query.users.findMany();
    
    let verifiedWithin14Days = 0;
    let overdueReverify = 0;
    let lockedAccounts = 0;
    let pendingKyc = 0;
    
    for (const user of allUsers) {
      const u = user as any;
      if (u.isDisabled || u.isFrozen) {
        lockedAccounts++;
      }
      if (u.kycStatus === 'pending') {
        pendingKyc++;
      }
      if (u.kycStatus === 'approved' && u.kycVerifiedAt) {
        const verifiedAt = typeof u.kycVerifiedAt === 'number' ? u.kycVerifiedAt : 
          (u.kycVerifiedAt instanceof Date ? Math.floor(u.kycVerifiedAt.getTime() / 1000) : 0);
        if (verifiedAt >= fourteenDaysAgo) {
          verifiedWithin14Days++;
        }
        if (u.kycExpiresAt) {
          const expiresAt = typeof u.kycExpiresAt === 'number' ? u.kycExpiresAt : 
            (u.kycExpiresAt instanceof Date ? Math.floor(u.kycExpiresAt.getTime() / 1000) : 0);
          if (expiresAt < now) {
            overdueReverify++;
          }
        }
      }
      if (u.kycStatus === 'reverify_required') {
        overdueReverify++;
      }
    }
    
    return {
      verifiedWithin14Days,
      overdueReverify,
      lockedAccounts,
      pendingKyc,
      totalUsers: allUsers.length,
    };
  },
};
// @ts-nocheck
