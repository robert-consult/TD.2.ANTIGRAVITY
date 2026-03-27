import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  DOC_LAST_VERIFIED,
  parseSimpleTableRow,
  renderFrontMatter,
  repoPath,
  uniqueSorted,
  writeFileIfChanged,
} from "../../lib/shared";

type InventoryMeta = {
  classification: string;
  documentedIn: string[];
  note: string;
};

type InventoryRow = {
  entry: string;
  kind: string;
  classification: string;
  documentedIn: string[];
  note: string;
};

type SourceDocRow = {
  path: string;
  type: string;
  scope: string;
};

const execFileAsync = promisify(execFile);
const OUTPUT_PATH = repoPath("Documentation", "generated", "Repository_Inventory.md");
const GENERATOR_SOURCE = "scripts/docs/generators/repository/index.ts";

const ENTRY_OVERRIDES: Record<string, InventoryMeta> = {
  ".agents": {
    classification: "governance",
    documentedIn: ["Documentation/internal/00_Documentation_Hub.md", "Documentation/08_Documentation_Enhancement/02_Canonical_Source_Map.md"],
    note: "Agent checklists, production requirements, and scan-first context map.",
  },
  ".code-workspace.code-workspace": {
    classification: "editor-local",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Workspace file retained for local editor setup.",
  },
  ".dockerignore": {
    classification: "build-config",
    documentedIn: ["Documentation/internal/08_Infrastructure_and_Operations.md"],
    note: "Container build ignore rules.",
  },
  ".env": {
    classification: "local-secret-config",
    documentedIn: ["Documentation/generated/Environment_Catalog.md", "Documentation/generated/Repository_Inventory.md"],
    note: "Local environment file; never commit secrets from this file.",
  },
  ".env.example": {
    classification: "env-template",
    documentedIn: ["Documentation/generated/Environment_Catalog.md"],
    note: "Environment template and env-catalog source input.",
  },
  ".git": {
    classification: "vcs-metadata",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Git metadata; excluded from documentation maintenance scope.",
  },
  ".gitattributes": {
    classification: "repo-config",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Git attribute rules.",
  },
  ".githooks": {
    classification: "repo-tooling",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Repository-local hook automation.",
  },
  ".github": {
    classification: "ci",
    documentedIn: ["Documentation/internal/08_Infrastructure_and_Operations.md", "Documentation/generated/Repository_Inventory.md"],
    note: "CI workflows and automation entrypoints.",
  },
  ".gitignore": {
    classification: "repo-config",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Git ignore rules for generated and local artifacts.",
  },
  ".npmrc": {
    classification: "dependency-config",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "npm client configuration.",
  },
  ".replit": {
    classification: "editor-local",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Environment-specific IDE/runtime config.",
  },
  ".sops.template.yaml": {
    classification: "secret-template",
    documentedIn: ["Documentation/internal/08_Infrastructure_and_Operations.md"],
    note: "Template for SOPS-backed secret-management workflows.",
  },
  ".swift-version": {
    classification: "toolchain-config",
    documentedIn: ["Documentation/internal/07_Mobile_and_Native.md"],
    note: "Swift toolchain version hint for Apple-platform work.",
  },
  ".tmp": {
    classification: "local-artifact",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Scratch and audit output directory; not a maintained source module.",
  },
  ".vscode": {
    classification: "editor-local",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Workspace editor settings.",
  },
  "AGENTS.md": {
    classification: "governance",
    documentedIn: ["Documentation/internal/00_Documentation_Hub.md", "Documentation/08_Documentation_Enhancement/02_Canonical_Source_Map.md"],
    note: "Repo-wide operating router and golden command source.",
  },
  "AUDIT_COMPLIANCE_STATUS.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md", "Documentation/generated/Repository_Inventory.md"],
    note: "Compliance audit reference; treat as invariant/supporting reference, not runtime truth.",
  },
  "AUDIT_REPORT.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md", "Documentation/generated/Repository_Inventory.md"],
    note: "Primary audit reference for security/compliance invariants.",
  },
  "AUDIT_REPORT_DEACTIVATION.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Focused historical audit note for account deactivation behavior.",
  },
  "CAPACITOR.md": {
    classification: "module-reference",
    documentedIn: ["Documentation/internal/07_Mobile_and_Native.md"],
    note: "Capacitor wrapper mode and same-origin guidance.",
  },
  "CODEX_COUNTRY_TIMEZONE_CONTROLS.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Jurisdiction and timezone control invariant reference.",
  },
  "COT_OUTPUT_EXTRACTION_GUIDE.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Auxiliary workflow guide retained as repo-local reference.",
  },
  "DB_HARDENING_REPORT.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Database hardening audit note.",
  },
  "DEEP_AUDIT_FINDINGS.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Historical deep-audit findings; verify against live tree before reuse.",
  },
  "Dockerfile": {
    classification: "build-config",
    documentedIn: ["Documentation/internal/08_Infrastructure_and_Operations.md"],
    note: "Primary container build definition.",
  },
  "Documentation": {
    classification: "maintained-docs",
    documentedIn: ["Documentation/internal/00_Documentation_Hub.md", "Documentation/08_Documentation_Enhancement/03_Target_Documentation_Architecture.md"],
    note: "Maintained docs lanes plus legacy migration inputs.",
  },
  "FINAL_AUDIT_REMAINING_GAPS.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Historical gap register retained for context, not canonical truth.",
  },
  "FIX_TRACKER.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Historical fix tracker retained as supporting evidence.",
  },
  "INMEMORY_TO_POSTGRES_PERSISTENCE_REPORT.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Persistence migration review note.",
  },
  "JURISDICTION_CONTROLS_VERIFICATION_RUNBOOK.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Canonical compliance runbook reference.",
  },
  "LICENSE.txt": {
    classification: "legal-file",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Repository license file.",
  },
  "MIGRATION_REVIEW.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Migration-risk review reference.",
  },
  "MOBILE": {
    classification: "product-module",
    documentedIn: ["Documentation/internal/07_Mobile_and_Native.md"],
    note: "Capacitor wrapper shells and bridge helpers.",
  },
  "NATIVE": {
    classification: "product-module",
    documentedIn: ["Documentation/internal/07_Mobile_and_Native.md"],
    note: "React Native app and platform-native shells.",
  },
  "PATCH_DELIVERY_GUIDE.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Patch-delivery process note.",
  },
  "PRODUCTION READINESS": {
    classification: "operator-archive",
    documentedIn: ["Documentation/internal/08_Infrastructure_and_Operations.md", "Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Operator-focused readiness material retained in-repo.",
  },
  "PROJECT_STRUCTURE.md": {
    classification: "governance",
    documentedIn: ["Documentation/internal/00_Documentation_Hub.md", "Documentation/08_Documentation_Enhancement/02_Canonical_Source_Map.md"],
    note: "Deep-map of the entire codebase and navigation source of truth.",
  },
  "README.md": {
    classification: "governance",
    documentedIn: ["Documentation/public/01_Platform_Overview.md", "Documentation/internal/00_Documentation_Hub.md"],
    note: "Primary repo overview and quick-start reference.",
  },
  "REAUDIT_REPORT.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Reaudit reference for preserved invariants.",
  },
  "REAUDIT_STATUS_REPORT.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Historical reaudit status note.",
  },
  "REPORTS AND REVIEWS": {
    classification: "archive",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Large historical report archive; use as lead material only.",
  },
  "SHARED_SERVICES_AUDIT.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Shared-service audit reference.",
  },
  "TD.2.ANTIGRAVITY.code-workspace": {
    classification: "editor-local",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Workspace file for local editor setup.",
  },
  "TRADE_HISTORY_TASK_LIST.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Historical task list retained as supporting context.",
  },
  "WEBSITE": {
    classification: "product-module",
    documentedIn: ["Documentation/public/03_Public_Website_and_Education.md", "Documentation/internal/06_Website_and_Education.md"],
    note: "Standalone public marketing and education site.",
  },
  "admin_data_exports": {
    classification: "runtime-artifact",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Generated export artifacts; operational data, not source.",
  },
  "attached_assets": {
    classification: "asset-inputs",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Attached prompt or design assets used as working inputs.",
  },
  "capacitor.config.ts": {
    classification: "build-config",
    documentedIn: ["Documentation/internal/07_Mobile_and_Native.md"],
    note: "Capacitor wrapper runtime/build config.",
  },
  "client": {
    classification: "product-module",
    documentedIn: ["Documentation/internal/01_Runtime_Topology.md", "Documentation/internal/02_Trader_Journey.md", "Documentation/internal/03_Admin_Journey.md"],
    note: "Main authenticated web app.",
  },
  "components.json": {
    classification: "build-config",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "UI component generator config.",
  },
  "config": {
    classification: "support-module",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Application configuration inputs such as market-data provider config.",
  },
  "data": {
    classification: "repo-data",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Repo-local data inputs or generated support data.",
  },
  "db": {
    classification: "product-module",
    documentedIn: ["Documentation/internal/guides/Adding_Database_Table.md", "Documentation/generated/Environment_Catalog.md"],
    note: "Drizzle migrations, schema tooling, and seed scripts.",
  },
  "db_backups": {
    classification: "runtime-artifact",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Database backup artifacts.",
  },
  "design": {
    classification: "support-module",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Design assets such as badges, certificates, and themes.",
  },
  "design_guidelines.md": {
    classification: "reference-guide",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "UI design guidance for frontend work.",
  },
  "dist": {
    classification: "build-artifact",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Build outputs; generated, not edited by hand.",
  },
  "docker-compose.infra.durable.yml": {
    classification: "infra-config",
    documentedIn: ["Documentation/internal/08_Infrastructure_and_Operations.md"],
    note: "Durable local infra compose stack.",
  },
  "docker-compose.infra.yml": {
    classification: "infra-config",
    documentedIn: ["Documentation/internal/08_Infrastructure_and_Operations.md"],
    note: "Primary local Postgres + Valkey compose stack.",
  },
  "drizzle.config.ts": {
    classification: "build-config",
    documentedIn: ["Documentation/internal/guides/Adding_Database_Table.md"],
    note: "Drizzle configuration entrypoint.",
  },
  "e2e": {
    classification: "quality-module",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Playwright end-to-end coverage and runbook tests.",
  },
  "fast_load_audit_report.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Performance-focused audit reference.",
  },
  "generate_tree.py": {
    classification: "repo-tooling",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Local repo tree helper script.",
  },
  "generated-icon.png": {
    classification: "asset",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Generated image asset stored at the repo root.",
  },
  "gitops": {
    classification: "operator-module",
    documentedIn: ["Documentation/internal/08_Infrastructure_and_Operations.md"],
    note: "GitOps deployment structure and overlays.",
  },
  "grift_audit_checklist.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Fraud-control audit checklist reference.",
  },
  "grift_verification_report.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Fraud-control verification note.",
  },
  "k8s": {
    classification: "operator-module",
    documentedIn: ["Documentation/internal/08_Infrastructure_and_Operations.md"],
    note: "Kubernetes manifests and cluster runtime definitions.",
  },
  "migration_imports": {
    classification: "repo-data",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Migration import inputs and artifacts.",
  },
  "node_modules": {
    classification: "dependency-cache",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Installed dependencies; excluded from documentation maintenance scope.",
  },
  "ops": {
    classification: "operator-module",
    documentedIn: ["Documentation/internal/08_Infrastructure_and_Operations.md"],
    note: "Observability, runbooks, security ops, and cluster operator assets.",
  },
  "output-inline-code.md": {
    classification: "reference-report",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Auxiliary workflow note retained in the root.",
  },
  "package-lock.json": {
    classification: "dependency-lock",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Root dependency lockfile.",
  },
  "package.json": {
    classification: "build-config",
    documentedIn: ["Documentation/internal/00_Documentation_Hub.md", "Documentation/08_Documentation_Enhancement/05_Docs_Automation_Contract.md"],
    note: "Root command and dependency manifest.",
  },
  "petascale": {
    classification: "operator-module",
    documentedIn: ["Documentation/internal/08_Infrastructure_and_Operations.md"],
    note: "ClickHouse and analytics-oriented stack, including vendor sync.",
  },
  "playwright.config.ts": {
    classification: "build-config",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Playwright configuration.",
  },
  "postcss.config.js": {
    classification: "build-config",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "PostCSS configuration.",
  },
  "replit.md": {
    classification: "reference-guide",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Environment-specific repo note retained in the root.",
  },
  "scripts": {
    classification: "product-module",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md", "Documentation/08_Documentation_Enhancement/05_Docs_Automation_Contract.md"],
    note: "Operational tooling, audits, generators, and load tests.",
  },
  "security": {
    classification: "operator-module",
    documentedIn: ["Documentation/internal/08_Infrastructure_and_Operations.md", "Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Security-local materials including vulnerability database inputs.",
  },
  "server": {
    classification: "product-module",
    documentedIn: ["Documentation/internal/01_Runtime_Topology.md", "Documentation/internal/02_Trader_Journey.md", "Documentation/internal/03_Admin_Journey.md", "Documentation/internal/04_Partner_Journey.md"],
    note: "Express API, WebSocket runtime, trading, security, and worker logic.",
  },
  "server-5000.log": {
    classification: "runtime-artifact",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Local server log artifact.",
  },
  "server-5000.node.pid": {
    classification: "runtime-artifact",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Local process PID artifact.",
  },
  "server-5000.pid": {
    classification: "runtime-artifact",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Local process PID artifact.",
  },
  "sessions.db": {
    classification: "runtime-artifact",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Local session database artifact.",
  },
  "shared": {
    classification: "product-module",
    documentedIn: ["Documentation/internal/guides/Adding_API_Endpoint.md", "Documentation/internal/guides/Adding_Database_Table.md", "Documentation/generated/WebSocket_Catalog.md"],
    note: "Shared contracts, schemas, instruments, locale, and WS types.",
  },
  "swiftly-x86_64.tar.gz": {
    classification: "archive-artifact",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Local archived binary payload retained in the workspace.",
  },
  "tailwind.config.cjs": {
    classification: "build-config",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Tailwind configuration.",
  },
  "test-results": {
    classification: "build-artifact",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Test output artifacts.",
  },
  "trades.json": {
    classification: "runtime-artifact",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Local trade data artifact.",
  },
  "trading_app.db": {
    classification: "runtime-artifact",
    documentedIn: ["Documentation/internal/09_Repo_Supporting_Modules.md"],
    note: "Local development SQLite artifact retained in the workspace.",
  },
  "trading_app_fixed.db-journal": {
    classification: "runtime-artifact",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "SQLite journal artifact.",
  },
  "tsconfig.json": {
    classification: "build-config",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Root TypeScript configuration.",
  },
  "vite.config.ts": {
    classification: "build-config",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Vite configuration for the web app.",
  },
  "vitest.config.ts": {
    classification: "build-config",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Vitest configuration.",
  },
};

function defaultMeta(entryName: string, kind: string): InventoryMeta {
  if (kind === "directory") {
    return {
      classification: "unclassified-directory",
      documentedIn: ["Documentation/generated/Repository_Inventory.md"],
      note: "Top-level directory not yet assigned a narrower documentation class.",
    };
  }

  return {
    classification: "unclassified-file",
    documentedIn: ["Documentation/generated/Repository_Inventory.md"],
    note: "Top-level file not yet assigned a narrower documentation class.",
  };
}

function classifySourceDocType(filePath: string): string {
  const baseName = path.basename(filePath);
  if (baseName === "AGENTS.md") return "AGENTS";
  if (baseName === "README.md") return "README";
  if (baseName === "WIRING.md") return "WIRING";
  return "other";
}

function classifySourceDocScope(filePath: string): string {
  const directory = path.posix.dirname(filePath);
  return directory === "." ? "repo-root" : directory;
}

async function collectInventoryRows(): Promise<InventoryRow[]> {
  const entries = await fs.readdir(repoPath("."), { withFileTypes: true });
  const rows = entries.map((entry) => {
    const kind = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other";
    const meta = ENTRY_OVERRIDES[entry.name] ?? defaultMeta(entry.name, kind);
    return {
      entry: entry.name,
      kind,
      classification: meta.classification,
      documentedIn: meta.documentedIn,
      note: meta.note,
    };
  });

  return rows.sort((left, right) => left.entry.localeCompare(right.entry));
}

async function collectSourceDocs(): Promise<SourceDocRow[]> {
  const scanRoots = [
    ".github",
    "Documentation",
    "MOBILE",
    "NATIVE",
    "WEBSITE",
    "attached_assets",
    "client",
    "config",
    "db",
    "e2e",
    "gitops",
    "k8s",
    "ops",
    "petascale",
    "PRODUCTION READINESS",
    "REPORTS AND REVIEWS",
    "scripts",
    "security",
    "server",
    "shared",
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
      "-g",
      "README.md",
      "-g",
      "**/README.md",
      "-g",
      "WIRING.md",
      "-g",
      "**/WIRING.md",
    ],
    { cwd: repoPath(".") },
  );

  return uniqueSorted(
    ["AGENTS.md", "README.md", ...stdout
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean)],
  ).map((filePath) => ({
    path: filePath,
    type: classifySourceDocType(filePath),
    scope: classifySourceDocScope(filePath),
  }));
}

export async function buildRepositoryInventory(): Promise<string> {
  const inventoryRows = await collectInventoryRows();
  const sourceDocs = await collectSourceDocs();

  const classCounts = new Map<string, number>();
  for (const row of inventoryRows) {
    classCounts.set(row.classification, (classCounts.get(row.classification) ?? 0) + 1);
  }

  const summaryRows = uniqueSorted(classCounts.keys()).map((classification) =>
    parseSimpleTableRow([classification, String(classCounts.get(classification) ?? 0)]),
  );

  const inventoryTableRows = inventoryRows.map((row) =>
    parseSimpleTableRow([
      `\`${row.entry}\``,
      row.kind,
      row.classification,
      row.documentedIn.map((value) => `\`${value}\``).join("<br>"),
      row.note,
    ]),
  );

  const sourceDocRows = sourceDocs.map((row) =>
    parseSimpleTableRow([`\`${row.path}\``, row.type, `\`${row.scope}\``]),
  );

  return [
    renderFrontMatter({
      audience: "generated",
      exposure: "internal",
      owner: "documentation-program",
      canonicalSources: [
        "AGENTS.md",
        "README.md",
        "PROJECT_STRUCTURE.md",
        "CAPACITOR.md",
        "MOBILE/README.md",
        "NATIVE/README.md",
        "WEBSITE/README.md",
        "WEBSITE/WIRING.md",
        "ops/README.md",
        "petascale/README.md",
      ],
      lastVerified: DOC_LAST_VERIFIED,
      status: "generated",
      generatedFrom: [GENERATOR_SOURCE],
    }),
    "# Repository Inventory",
    "",
    "> Generated from the live top-level tree and tracked local source-document files.",
    "",
    `Top-level entries discovered: **${inventoryRows.length}**.`,
    "",
    `Tracked source-document files discovered: **${sourceDocs.length}**.`,
    "",
    "## Classification Counts",
    "",
    "| Classification | Count |",
    "| --- | ---: |",
    ...summaryRows,
    "",
    "## Top-Level Inventory",
    "",
    "| Entry | Kind | Classification | Maintained Reference | Notes |",
    "| --- | --- | --- | --- | --- |",
    ...inventoryTableRows,
    "",
    "## Local Source-Document Index",
    "",
    "| Path | Type | Scope |",
    "| --- | --- | --- |",
    ...sourceDocRows,
    "",
  ].join("\n");
}

export async function generateRepositoryInventory(): Promise<void> {
  const content = await buildRepositoryInventory();
  await writeFileIfChanged(OUTPUT_PATH, content);
}
