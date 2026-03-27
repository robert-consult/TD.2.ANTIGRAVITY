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

type RuntimeInitRecord = {
  symbol: string;
  file: string;
};

const RUNTIME_OUTPUT_PATH = repoPath("Documentation", "generated", "Runtime_Inventory.md");
const AGENT_OUTPUT_PATH = repoPath("Documentation", "generated", "Agent_Guidance_Catalog.md");
const GENERATOR_SOURCE = "scripts/docs/generators/runtime/index.ts";

function parseImportedSymbols(serverIndexText: string): Map<string, string> {
  const importMap = new Map<string, string>();
  const regex = /^import\s+(.*?)\s+from\s+["'](.+?)["'];/gm;

  for (const match of serverIndexText.matchAll(regex)) {
    const rawClause = match[1]?.trim() ?? "";
    const specifier = match[2]?.trim() ?? "";
    if (!specifier.startsWith(".")) continue;
    const fileTarget = specifier.endsWith(".ts") ? specifier : `${specifier}.ts`;

    if (rawClause.startsWith("{")) {
      const names = rawClause
        .replace(/[{}]/g, "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => value.split(/\s+as\s+/i).shift() ?? value);
      for (const name of names) {
        importMap.set(name, path.posix.normalize(`server/${fileTarget.replace(/^\.\//, "")}`));
      }
      continue;
    }

    const defaultName = rawClause.split(",")[0]?.trim();
    if (defaultName) {
      importMap.set(defaultName, path.posix.normalize(`server/${fileTarget.replace(/^\.\//, "")}`));
    }
  }

  return importMap;
}

async function collectRuntimeInitRecords(): Promise<RuntimeInitRecord[]> {
  const serverIndexText = await readText(repoPath("server", "index.ts"));
  const importMap = parseImportedSymbols(serverIndexText);
  const callRegex = /\b(start[A-Z][A-Za-z0-9_]*|bootstrap[A-Z][A-Za-z0-9_]*|maybe[A-Z][A-Za-z0-9_]*|setupAdminViews)\s*\(/g;
  const records: RuntimeInitRecord[] = [];

  for (const match of serverIndexText.matchAll(callRegex)) {
    const symbol = match[1] ?? "";
    const file = importMap.get(symbol);
    if (!symbol || !file) continue;
    records.push({ symbol, file });
  }

  return uniqueSorted(records.map((record) => `${record.symbol}\t${record.file}`)).map((value) => {
    const [symbol, file] = value.split("\t");
    return { symbol, file };
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
  const runtimeRecords = await collectRuntimeInitRecords();
  const agentFiles = await collectAgentFiles();

  const runtimeRows = runtimeRecords.map((record) =>
    parseSimpleTableRow([`\`${record.symbol}\``, `\`${record.file}\``]),
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
    "## Deferred Initialization Symbols",
    "",
    "| Symbol | Source File |",
    "| --- | --- |",
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
