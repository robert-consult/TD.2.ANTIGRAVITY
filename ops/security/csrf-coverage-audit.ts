/**
 * CSRF Coverage Audit
 *
 * Verifies global CSRF middleware wiring on `/api` and reports route-level
 * visibility gaps as informational warnings.
 *
 * Usage: npx tsx ops/security/csrf-coverage-audit.ts
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(currentDir, "../..");
const ROUTES_DIR = path.resolve(ROOT_DIR, "server/routes");
const ROUTES_WIRING_PATH = path.resolve(ROOT_DIR, "server/routes.ts");
const MUTATING = /\.(post|put|delete|patch)\s*\(/gi;
const LOCAL_GUARD_HINT = /requireAdmin|enforceCsrf|csrfProtection/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)],
  );
}

function verifyGlobalApiCsrfWiring(): string[] {
  if (!fs.existsSync(ROUTES_WIRING_PATH)) {
    return [`Missing routing entrypoint: ${ROUTES_WIRING_PATH}`];
  }
  const src = fs.readFileSync(ROUTES_WIRING_PATH, "utf-8");
  const issues: string[] = [];
  if (!/createCsrfProtection\s*\(/.test(src)) {
    issues.push("createCsrfProtection(...) is not initialized in server/routes.ts");
  }
  if (!/app\.use\(\s*["']\/api["']\s*,\s*csrfProtection\.issueCsrfToken\s*,\s*csrfProtection\.enforceCsrf\s*\)/.test(src)) {
    issues.push('Global CSRF guard is missing: app.use("/api", csrfProtection.issueCsrfToken, csrfProtection.enforceCsrf)');
  }
  return issues;
}

function routeVisibilityWarnings(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const warnings: string[] = [];

  lines.forEach((line, i) => {
    if (!MUTATING.test(line)) {
      MUTATING.lastIndex = 0;
      return;
    }
    const context = lines.slice(Math.max(0, i - 5), i + 1).join("\n");
    if (!LOCAL_GUARD_HINT.test(context)) {
      warnings.push(`${path.basename(filePath)}:${i + 1}`);
    }
    MUTATING.lastIndex = 0;
  });

  return warnings;
}

function main(): void {
  if (!fs.existsSync(ROUTES_DIR)) {
    console.error(`[FAIL] Routes directory not found: ${ROUTES_DIR}`);
    process.exit(1);
  }

  const globalIssues = verifyGlobalApiCsrfWiring();
  if (globalIssues.length > 0) {
    console.error("[FAIL] Global CSRF wiring issues detected:");
    for (const issue of globalIssues) console.error(`  - ${issue}`);
    process.exit(1);
  }

  const tsFiles = walk(ROUTES_DIR).filter((f) => f.endsWith(".ts") && !f.includes(".test."));
  const warnings = tsFiles.flatMap(routeVisibilityWarnings);
  if (warnings.length > 0) {
    console.warn(
      `[WARN] ${warnings.length} route definitions have no local CSRF/auth hint; global /api CSRF middleware is still active.`,
    );
    for (const warning of warnings.slice(0, 80)) console.warn(`  • ${warning}`);
    if (warnings.length > 80) {
      console.warn(`  • ... ${warnings.length - 80} more`);
    }
  }

  console.log(
    `[PASS] Global /api CSRF middleware wiring verified. Scanned ${tsFiles.length} route files for visibility hints.`,
  );
}

main();
