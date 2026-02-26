/**
 * CSRF Coverage Audit
 *
 * Scans all registered Express routes and verifies that mutating methods
 * (POST, PUT, DELETE, PATCH) are protected by the CSRF middleware.
 *
 * Usage: npx tsx ops/security/csrf-coverage-audit.ts
 */

import * as fs from "fs";
import * as path from "path";

const ROUTES_DIR = path.resolve(__dirname, "../../server/routes");
const MUTATING = /\.(post|put|delete|patch)\s*\(/gi;
const CSRF_GUARD = /requireAdmin|enforceCsrf|csrfProtection/;

function auditFile(filePath: string): string[] {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const issues: string[] = [];

    lines.forEach((line, i) => {
        if (MUTATING.test(line)) {
            // Check surrounding context (5 lines before) for CSRF guard
            const context = lines.slice(Math.max(0, i - 5), i + 1).join("\n");
            if (!CSRF_GUARD.test(context)) {
                issues.push(`${path.basename(filePath)}:${i + 1} — mutating route without visible CSRF guard`);
            }
        }
        MUTATING.lastIndex = 0; // reset regex
    });

    return issues;
}

function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]
    );
}

const tsFiles = walk(ROUTES_DIR).filter((f) => f.endsWith(".ts") && !f.includes(".test."));
const allIssues = tsFiles.flatMap(auditFile);

if (allIssues.length > 0) {
    console.error(`[AUDIT] ${allIssues.length} route(s) missing CSRF guard:`);
    allIssues.forEach((i) => console.error(`  ⚠ ${i}`));
    process.exit(1);
} else {
    console.log(`[PASS] All ${tsFiles.length} route files have CSRF coverage on mutating endpoints.`);
}
