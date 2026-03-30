import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  DOC_LAST_VERIFIED,
  parseSimpleTableRow,
  readText,
  relativeRepoPath,
  renderFrontMatter,
  repoPath,
  uniqueSorted,
  writeFileIfChanged,
} from "../../lib/shared";

const execFileAsync = promisify(execFile);

type RuntimeTaskRecord = {
  symbol: string;
  file: string;
  category: string;
  roles: string;
  gate: string;
  responsibility: string;
};

const RUNTIME_OUTPUT_PATH = repoPath("Documentation", "generated", "Runtime_Inventory.md");
const AGENT_OUTPUT_PATH = repoPath("Documentation", "generated", "Agent_Guidance_Catalog.md");
const GENERATOR_SOURCE = "scripts/docs/generators/runtime/index.ts";

const TASK_METADATA: Record<
  string,
  { category: string; roles: string; gate: string; responsibility: string }
> = {
  bootstrapQuoteHub: {
    category: "quote-bootstrap",
    roles: "api,ws",
    gate: "after listen when `api` or `ws` role is active",
    responsibility: "Warm quote hub from Valkey snapshot data.",
  },
  bootstrapQuoteHubFromValkeySymbols: {
    category: "quote-bootstrap",
    roles: "api,ws",
    gate: "fallback after quote-hub snapshot bootstrap misses",
    responsibility: "Backfill quote hub from per-symbol Valkey keys.",
  },
  syncProviderConfigsFromDirToDb: {
    category: "market-data-config",
    roles: "api,ingestor",
    gate: "only when `MARKET_DATA_PROVIDER_FILE_SYNC=1`",
    responsibility: "Sync market-data provider config files into DB state.",
  },
  checkConfiguredProviderSecrets: {
    category: "market-data-preflight",
    roles: "all",
    gate: "post-listen runtime preflight",
    responsibility: "Warn when configured market-data providers are missing required env secrets.",
  },
  bootstrapDoc1Seed: {
    category: "legal-bootstrap",
    roles: "worker",
    gate: "worker only and skipped when background jobs are disabled",
    responsibility: "Seed baseline DOC1 legal material.",
  },
  maybeImportIp2AsnDataset: {
    category: "grift-bootstrap",
    roles: "worker",
    gate: "worker only when an ip2asn dataset path is configured",
    responsibility: "Import IP-to-ASN data for grift enrichment.",
  },
  startAdminDataExportWorker: {
    category: "admin-export",
    roles: "worker",
    gate: "worker only and skipped when background jobs are disabled",
    responsibility: "Run BullMQ-backed admin export jobs.",
  },
  startClickHouseSyncScheduler: {
    category: "analytics-sync",
    roles: "worker",
    gate: "worker only and skipped when background jobs are disabled",
    responsibility: "Schedule Postgres-to-ClickHouse synchronization.",
  },
  startAdminDataExportRetentionScheduler: {
    category: "admin-export",
    roles: "worker",
    gate: "worker only and skipped when background jobs are disabled",
    responsibility: "Expire and clean old export artifacts.",
  },
  startAdminDataRollupScheduler: {
    category: "admin-rollups",
    roles: "worker",
    gate: "worker only and skipped when background jobs are disabled",
    responsibility: "Maintain admin rollup read-model data.",
  },
  maybeIngestBuiltManifest: {
    category: "i18n",
    roles: "worker",
    gate: "worker only and skipped when background jobs are disabled",
    responsibility: "Load built i18n manifest data if present.",
  },
  startI18nWorker: {
    category: "i18n",
    roles: "worker",
    gate: "worker only and skipped when background jobs are disabled",
    responsibility: "Run DB-backed i18n worker processing.",
  },
  startQuoteFeed: {
    category: "market-data",
    roles: "ingestor",
    gate: "ingestor only",
    responsibility: "Start quote-feed ingestion.",
  },
  initExcursionTrackingPubSub: {
    category: "trade-analytics",
    roles: "ingestor",
    gate: "after quote feed starts",
    responsibility: "Initialize excursion-tracking pub/sub support.",
  },
  startAutoCloseScheduler: {
    category: "trade-automation",
    roles: "ingestor",
    gate: "ingestor only and skipped when background jobs are disabled",
    responsibility: "Run automated close scheduling.",
  },
  startMarginCallScheduler: {
    category: "risk-automation",
    roles: "ingestor",
    gate: "ingestor only and skipped when background jobs are disabled",
    responsibility: "Run margin-call scheduling.",
  },
  setupAdminViews: {
    category: "admin-bootstrap",
    roles: "worker",
    gate: "worker only",
    responsibility: "Create/update admin data views and tables.",
  },
  startGriftEvaluationScheduler: {
    category: "grift",
    roles: "worker",
    gate: "worker only and skipped when background jobs are disabled",
    responsibility: "Run grift evaluation scheduling.",
  },
  startVerificationReminderCron: {
    category: "verification",
    roles: "worker",
    gate: "worker only and skipped when background jobs are disabled",
    responsibility: "Schedule verification reminder sends.",
  },
  startTradeAuditVerificationCron: {
    category: "audit",
    roles: "worker",
    gate: "worker only and skipped when background jobs are disabled",
    responsibility: "Verify trade audit chain integrity.",
  },
  startAccountLifecycleSweepScheduler: {
    category: "account-lifecycle",
    roles: "worker",
    gate: "worker only and skipped when background jobs are disabled",
    responsibility: "Sweep inactive and deletion-grace accounts.",
  },
  startScoutMetricsCron: {
    category: "scouting",
    roles: "worker",
    gate: "worker only and skipped when background jobs are disabled",
    responsibility: "Calculate scout metrics snapshots.",
  },
  startChallengeEvaluationCron: {
    category: "recruitment",
    roles: "worker",
    gate: "worker only and skipped when background jobs are disabled",
    responsibility: "Evaluate challenge progression and outcomes.",
  },
  startPartnerAllocationSyncCron: {
    category: "partner",
    roles: "worker",
    gate: "worker only and skipped when background jobs are disabled",
    responsibility: "Sync partner allocation state.",
  },
};

function normalizeServerSpecifier(specifier: string): string {
  const withExtension = specifier.endsWith(".ts") ? specifier : `${specifier}.ts`;
  return path.posix.normalize(`server/${withExtension.replace(/^\.\//, "")}`);
}

function parseImportedSymbols(serverIndexText: string): Map<string, string> {
  const importMap = new Map<string, string>();
  const regex = /^import\s+(.*?)\s+from\s+["'](.+?)["'];/gm;

  for (const match of serverIndexText.matchAll(regex)) {
    const rawClause = match[1]?.trim() ?? "";
    const specifier = match[2]?.trim() ?? "";
    if (!specifier.startsWith(".")) continue;
    const fileTarget = normalizeServerSpecifier(specifier);

    if (rawClause.startsWith("{")) {
      const names = rawClause
        .replace(/[{}]/g, "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => value.split(/\s+as\s+/i).shift() ?? value);
      for (const name of names) {
        importMap.set(name, fileTarget);
      }
      continue;
    }

    const defaultName = rawClause.split(",")[0]?.trim();
    if (defaultName) {
      importMap.set(defaultName, fileTarget);
    }
  }

  const dynamicRegex = /const\s+\{\s*([^}]+)\s*\}\s*=\s*await\s+import\(["'](.+?)["']\);/gm;
  for (const match of serverIndexText.matchAll(dynamicRegex)) {
    const rawClause = match[1]?.trim() ?? "";
    const specifier = match[2]?.trim() ?? "";
    if (!specifier.startsWith(".")) continue;
    const fileTarget = normalizeServerSpecifier(specifier);
    const names = rawClause
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value.split(/\s+as\s+/i).shift() ?? value);
    for (const name of names) {
      importMap.set(name, fileTarget);
    }
  }

  return importMap;
}

async function collectRuntimeTaskRecords(): Promise<RuntimeTaskRecord[]> {
  const serverIndexText = await readText(repoPath("server", "index.ts"));
  const importMap = parseImportedSymbols(serverIndexText);
  const records: RuntimeTaskRecord[] = [];

  for (const [symbol, meta] of Object.entries(TASK_METADATA)) {
    const appears = new RegExp(`\\b${symbol}\\s*\\(`).test(serverIndexText);
    const file = importMap.get(symbol);
    if (!appears || !file) continue;
    records.push({
      symbol,
      file,
      category: meta.category,
      roles: meta.roles,
      gate: meta.gate,
      responsibility: meta.responsibility,
    });
  }

  return uniqueSorted(
    records.map(
      (record) =>
        `${record.category}\t${record.symbol}\t${record.file}\t${record.roles}\t${record.gate}\t${record.responsibility}`,
    ),
  ).map((value) => {
    const [category, symbol, file, roles, gate, responsibility] = value.split("\t");
    return { category, symbol, file, roles, gate, responsibility };
  });
}

async function collectAgentFiles(): Promise<string[]> {
  const scanRoots = [
    ".github",
    "attached_assets",
    "client",
    "db",
    "e2e",
    "gitops",
    "k8s",
    "MOBILE",
    "NATIVE",
    "PRODUCTION READINESS",
    "scripts",
    "security",
    "server",
    "shared",
    "WEBSITE",
  ];
  const { stdout } = await execFileAsync(
    "rg",
    [
      "-uu",
      "--files",
      ...scanRoots,
      "-g",
      "AGENTS.md",
      "-g",
      "**/AGENTS.md",
    ],
    { cwd: repoPath(".") },
  );

  return uniqueSorted(
    ["AGENTS.md", ...stdout
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((filePath) => path.basename(filePath) === "AGENTS.md")]
      .map((filePath) => relativeRepoPath(repoPath(filePath))),
  );
}

export async function buildRuntimeInventory(): Promise<string> {
  const runtimeRecords = await collectRuntimeTaskRecords();
  const agentFiles = await collectAgentFiles();

  const runtimeRows = runtimeRecords.map((record) =>
    parseSimpleTableRow([
      `\`${record.symbol}\``,
      record.category,
      `\`${record.file}\``,
      `\`${record.roles}\``,
      record.gate,
      record.responsibility,
    ]),
  );

  return [
    renderFrontMatter({
      audience: "generated",
      exposure: "internal",
      owner: "documentation-program",
      canonicalSources: ["server/index.ts", "server/routes.ts", "server/routes/wsCore.ts", "server/cron/", "server/services/", "server/feeds/"],
      lastVerified: DOC_LAST_VERIFIED,
      status: "generated",
      generatedFrom: [GENERATOR_SOURCE],
    }),
    "# Runtime Inventory",
    "",
    "> Generated from the live startup/runtime entrypoints.",
    "",
    "## Process Roles",
    "",
    "| Role | Meaning |",
    "| --- | --- |",
    "| `monolith` | Enables API, WS, ingestor, and worker responsibilities together. |",
    "| `api` | Runs HTTP routes and API-facing responsibilities. |",
    "| `ws` | Runs WebSocket upgrade and fanout responsibilities. |",
    "| `ingestor` | Runs quote-feed and market-ingestion responsibilities. |",
    "| `worker` | Runs schedulers, exports, sync jobs, and support workers. |",
    "",
    "## Startup And Job Inventory",
    "",
    "| Symbol | Category | Source File | Active Roles | Startup Gate | Responsibility |",
    "| --- | --- | --- | --- | --- | --- |",
    ...runtimeRows,
    "",
    "## Runtime Endpoints",
    "",
    "| Endpoint | Source | Notes |",
    "| --- | --- | --- |",
    "| `/status` | `server/index.ts` | Plain health probe. |",
    "| `/health` | `server/index.ts` | JSON health probe. |",
    "| `/ready` | `server/index.ts` | DB and Valkey readiness. |",
    "| `/metrics` | `server/routes/wsCore.ts` | Prometheus surface with private-access controls. |",
    "| `/ws` | `server/routes/wsCore.ts` | Session-authenticated WebSocket endpoint. |",
    "",
    `Agent guidance files discovered in the repo: **${agentFiles.length}**.`,
    "",
  ].join("\n");
}

export async function buildAgentGuidanceCatalog(): Promise<string> {
  const agentFiles = await collectAgentFiles();
  const rows = agentFiles.map((filePath) => parseSimpleTableRow([`\`${filePath}\``]));

  return [
    renderFrontMatter({
      audience: "generated",
      exposure: "internal",
      owner: "documentation-program",
      canonicalSources: ["AGENTS.md", "PROJECT_STRUCTURE.md", ".agents/", "*/AGENTS.md"],
      lastVerified: DOC_LAST_VERIFIED,
      status: "generated",
      generatedFrom: [GENERATOR_SOURCE],
    }),
    "# Agent Guidance Catalog",
    "",
    "> Generated from all repo-discovered `AGENTS.md` files.",
    "",
    "| Path |",
    "| --- |",
    ...rows,
    "",
  ].join("\n");
}

export async function generateRuntimeInventory(): Promise<void> {
  const runtimeContent = await buildRuntimeInventory();
  const agentContent = await buildAgentGuidanceCatalog();
  await writeFileIfChanged(RUNTIME_OUTPUT_PATH, runtimeContent);
  await writeFileIfChanged(AGENT_OUTPUT_PATH, agentContent);
}
