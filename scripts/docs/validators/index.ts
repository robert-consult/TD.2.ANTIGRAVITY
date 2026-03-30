import path from "node:path";
import { buildEnvCatalog } from "../generators/env/index";
import { buildRepositoryInventory } from "../generators/repository/index";
import { buildRestCatalog } from "../generators/rest/index";
import { buildAgentGuidanceCatalog, buildRuntimeInventory } from "../generators/runtime/index";
import { buildWsCatalog } from "../generators/ws/index";
import {
  extractFrontMatterBlock,
  pathExists,
  readText,
  relativeRepoPath,
  REPO_ROOT,
  repoPath,
  walkFiles,
} from "../lib/shared";

type ValidationFailure = {
  file: string;
  message: string;
};

type ScriptRegistry = {
  root: Set<string>;
  MOBILE: Set<string>;
  NATIVE: Set<string>;
  WEBSITE: Set<string>;
};

const ROOT_DOCS = [
  repoPath("AGENTS.md"),
  repoPath("README.md"),
  repoPath("PROJECT_STRUCTURE.md"),
  repoPath("CAPACITOR.md"),
  repoPath("ops", "README.md"),
  repoPath("petascale", "README.md"),
  repoPath("WEBSITE", "README.md"),
  repoPath("WEBSITE", "WIRING.md"),
  repoPath("MOBILE", "README.md"),
  repoPath("NATIVE", "README.md"),
];

const MAINTAINED_DOC_ROOTS = [
  repoPath("Documentation", "public"),
  repoPath("Documentation", "internal"),
  repoPath("Documentation", "generated"),
  repoPath("Documentation", "08_Documentation_Enhancement"),
];

const INTERNAL_ONLY_PATTERNS = [
  /\.agents\//,
  /PRODUCTION READINESS\//,
  /AUDIT_REPORT\.md/,
  /REAUDIT_REPORT\.md/,
  /security\/vuln-db\//,
  /JURISDICTION_CONTROLS_VERIFICATION_RUNBOOK\.md/,
  /CODEX_COUNTRY_TIMEZONE_CONTROLS\.md/,
  /Documentation\/internal\//,
  /Documentation\/generated\//,
  /Documentation\/08_Documentation_Enhancement\//,
];

const LEGACY_REFERENCE_PATTERNS = [
  /Documentation\/legacy\//,
  /Documentation\/0[0-7]_[A-Za-z0-9_-]+\//,
  /(?:^|[(/`\s])(?:\.\.\/|\.\/)?legacy\/[A-Za-z0-9_-]+\//,
  /(?:^|[(/`\s])(?:\.\.\/|\.\/)?0[0-7]_[A-Za-z0-9_-]+\//,
];

const ROOT_PATH_TOKENS = new Set([
  ".agents",
  ".github",
  "AGENTS.md",
  "AUDIT_COMPLIANCE_STATUS.md",
  "AUDIT_REPORT.md",
  "CAPACITOR.md",
  "CODEX_COUNTRY_TIMEZONE_CONTROLS.md",
  "Documentation",
  "JURISDICTION_CONTROLS_VERIFICATION_RUNBOOK.md",
  "MOBILE",
  "NATIVE",
  "PROJECT_STRUCTURE.md",
  "PRODUCTION READINESS",
  "README.md",
  "REAUDIT_REPORT.md",
  "REPORTS AND REVIEWS",
  "WEBSITE",
  "attached_assets",
  "client",
  "config",
  "db",
  "design",
  "e2e",
  "gitops",
  "k8s",
  "ops",
  "package.json",
  "petascale",
  "scripts",
  "security",
  "server",
  "shared",
]);

async function loadPackageScripts(packageDir: string): Promise<Set<string>> {
  const packageJsonPath = path.join(packageDir, "package.json");
  if (!(await pathExists(packageJsonPath))) return new Set<string>();
  const content = JSON.parse(await readText(packageJsonPath)) as { scripts?: Record<string, string> };
  return new Set(Object.keys(content.scripts ?? {}));
}

async function collectMaintainedDocs(): Promise<string[]> {
  const rootSummary = repoPath("Documentation", "SUMMARY.md");
  const files = (
    await Promise.all(
      MAINTAINED_DOC_ROOTS.map(async (dirPath) =>
        (await walkFiles(dirPath)).filter((filePath) => filePath.endsWith(".md")),
      ),
    )
  ).flat();
  files.push(rootSummary);
  files.push(...ROOT_DOCS);
  return [...new Set(files)].sort((left, right) => left.localeCompare(right));
}

function addFailure(failures: ValidationFailure[], filePath: string, message: string): void {
  failures.push({ file: relativeRepoPath(filePath), message });
}

function stripAnchor(target: string): string {
  return target.replace(/[?#].*$/, "");
}

async function resolveMarkdownTarget(currentFile: string, target: string): Promise<boolean> {
  const clean = stripAnchor(target);
  if (!clean) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return true;
  if (clean.startsWith("/")) {
    return true;
  }

  const candidates = [
    path.resolve(path.dirname(currentFile), clean),
    path.resolve(REPO_ROOT, clean.replace(/^\/+/, "")),
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return true;
  }
  return false;
}

function isSummaryFile(filePath: string): boolean {
  return path.basename(filePath) === "SUMMARY.md";
}

function isGeneratedDoc(filePath: string): boolean {
  return filePath.startsWith(repoPath("Documentation", "generated"));
}

function isArchiveBoundaryEnforcedDoc(filePath: string): boolean {
  return (
    filePath.startsWith(repoPath("Documentation", "public")) ||
    filePath.startsWith(repoPath("Documentation", "internal")) ||
    filePath.startsWith(repoPath("Documentation", "generated"))
  );
}

function looksLikeRepoPathReference(value: string): boolean {
  if (!value) return false;
  if (/\s/.test(value)) return false;
  if (value.startsWith("npm run ")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  if (value.startsWith("/")) return false;
  if (value.startsWith("@")) return false;
  if (/[<>*]/.test(value)) return false;
  if (value.includes("...")) return false;
  if (value.includes("|")) return false;

  if (value.startsWith("./") || value.startsWith("../")) {
    return true;
  }

  const firstSegment = value.split("/")[0] ?? "";
  return ROOT_PATH_TOKENS.has(firstSegment);
}

function validateFrontMatter(filePath: string, content: string, failures: ValidationFailure[]): void {
  if (!filePath.startsWith(repoPath("Documentation")) || isSummaryFile(filePath)) return;
  const block = extractFrontMatterBlock(content);
  if (!block) {
    addFailure(failures, filePath, "missing required front matter");
    return;
  }

  const requiredKeys = ["audience:", "exposure:", "owner:", "canonical_sources:", "last_verified:", "status:"];
  for (const requiredKey of requiredKeys) {
    if (!block.includes(requiredKey)) {
      addFailure(failures, filePath, `front matter missing \`${requiredKey.replace(":", "")}\``);
    }
  }

  if (isGeneratedDoc(filePath) && !block.includes("generated_from:")) {
    addFailure(failures, filePath, "generated document missing `generated_from`");
  }
}

async function validateLinks(filePath: string, content: string, failures: ValidationFailure[]): Promise<void> {
  const markdownLinkRegex = /\[[^\]]+\]\(([^)]+)\)/g;

  for (const match of content.matchAll(markdownLinkRegex)) {
    const rawTarget = match[1]?.trim() ?? "";
    if (!rawTarget || rawTarget.startsWith("#")) continue;
    if (!(await resolveMarkdownTarget(filePath, rawTarget))) {
      addFailure(failures, filePath, `broken markdown link: ${rawTarget}`);
    }
  }
}

async function validatePathCodeSpans(filePath: string, content: string, failures: ValidationFailure[]): Promise<void> {
  const codeSpanRegex = /`([^`\n]+)`/g;

  for (const match of content.matchAll(codeSpanRegex)) {
    const value = match[1]?.trim() ?? "";
    if (!value) continue;
    if (!looksLikeRepoPathReference(value)) continue;

    const candidates = [
      path.resolve(path.dirname(filePath), value),
      path.resolve(REPO_ROOT, value.replace(/^\/+/, "")),
    ];
    const exists = await Promise.all(candidates.map((candidate) => pathExists(candidate)));
    if (!exists.some(Boolean)) {
      addFailure(failures, filePath, `stale path reference: ${value}`);
    }
  }
}

function inferDefaultScope(filePath: string): keyof ScriptRegistry {
  if (filePath.startsWith(repoPath("MOBILE"))) return "MOBILE";
  if (filePath.startsWith(repoPath("NATIVE"))) return "NATIVE";
  if (filePath.startsWith(repoPath("WEBSITE"))) return "WEBSITE";
  return "root";
}

async function loadScriptRegistry(): Promise<ScriptRegistry> {
  return {
    root: await loadPackageScripts(REPO_ROOT),
    MOBILE: await loadPackageScripts(repoPath("MOBILE")),
    NATIVE: await loadPackageScripts(repoPath("NATIVE")),
    WEBSITE: await loadPackageScripts(repoPath("WEBSITE")),
  };
}

function scriptScopeForLine(
  linePrefix: string,
  defaultScope: keyof ScriptRegistry,
): keyof ScriptRegistry {
  const scopedMatch = linePrefix.match(/cd\s+(MOBILE|NATIVE|WEBSITE)\s+&&[\s\S]*$/);
  if (scopedMatch?.[1] === "MOBILE" || scopedMatch?.[1] === "NATIVE" || scopedMatch?.[1] === "WEBSITE") {
    return scopedMatch[1];
  }
  return defaultScope;
}

async function validateScriptCommands(
  filePath: string,
  content: string,
  failures: ValidationFailure[],
  scriptRegistry: ScriptRegistry,
): Promise<void> {
  const defaultScope = inferDefaultScope(filePath);

  for (const line of content.split("\n")) {
    const genericCommandRegex = /npm run ([a-zA-Z0-9:_-]+)/g;
    for (const match of line.matchAll(genericCommandRegex)) {
      const script = match[1] ?? "";
      const scope = scriptScopeForLine(line.slice(0, match.index ?? 0), defaultScope);
      const scripts = scriptRegistry[scope];
      if (!scripts.has(script)) {
        addFailure(
          failures,
          filePath,
          `invalid npm script for ${scope === "root" ? "root" : scope}: ${script}`,
        );
      }
    }
  }
}

function validatePublicDocs(filePath: string, content: string, failures: ValidationFailure[]): void {
  if (!filePath.startsWith(repoPath("Documentation", "public"))) return;

  for (const pattern of INTERNAL_ONLY_PATTERNS) {
    if (pattern.test(content)) {
      addFailure(failures, filePath, `public doc references internal-only material matching ${pattern}`);
    }
  }
}

function validateLegacyBoundary(filePath: string, content: string, failures: ValidationFailure[]): void {
  if (!isArchiveBoundaryEnforcedDoc(filePath)) return;

  for (const pattern of LEGACY_REFERENCE_PATTERNS) {
    if (pattern.test(content)) {
      addFailure(failures, filePath, `maintained doc references legacy archive material matching ${pattern}`);
    }
  }
}

async function validateGeneratedFreshness(failures: ValidationFailure[]): Promise<void> {
  const expected = new Map<string, string>([
    [repoPath("Documentation", "generated", "REST_API_Catalog.md"), await buildRestCatalog()],
    [repoPath("Documentation", "generated", "WebSocket_Catalog.md"), await buildWsCatalog()],
    [repoPath("Documentation", "generated", "Environment_Catalog.md"), await buildEnvCatalog()],
    [repoPath("Documentation", "generated", "Runtime_Inventory.md"), await buildRuntimeInventory()],
    [repoPath("Documentation", "generated", "Agent_Guidance_Catalog.md"), await buildAgentGuidanceCatalog()],
    [repoPath("Documentation", "generated", "Repository_Inventory.md"), await buildRepositoryInventory()],
  ]);

  for (const [filePath, expectedContent] of expected.entries()) {
    if (!(await pathExists(filePath))) {
      addFailure(failures, filePath, "generated file is missing");
      continue;
    }
    const current = await readText(filePath);
    const normalizedExpected = expectedContent.endsWith("\n") ? expectedContent : `${expectedContent}\n`;
    if (current !== normalizedExpected) {
      addFailure(failures, filePath, "generated file is stale; run `npm run docs:generate`");
    }
  }
}

export async function validateDocs(): Promise<void> {
  const failures: ValidationFailure[] = [];
  const files = await collectMaintainedDocs();
  const scriptRegistry = await loadScriptRegistry();

  for (const filePath of files) {
    const content = await readText(filePath);
    validateFrontMatter(filePath, content, failures);
    await validateLinks(filePath, content, failures);
    await validatePathCodeSpans(filePath, content, failures);
    await validateScriptCommands(filePath, content, failures, scriptRegistry);
    validatePublicDocs(filePath, content, failures);
    validateLegacyBoundary(filePath, content, failures);
  }

  await validateGeneratedFreshness(failures);

  if (failures.length) {
    for (const failure of failures) {
      console.error(`${failure.file}: ${failure.message}`);
    }
    throw new Error(`Documentation validation failed with ${failures.length} issue(s).`);
  }

  console.log(`Documentation validation passed for ${files.length} maintained markdown files.`);
}
