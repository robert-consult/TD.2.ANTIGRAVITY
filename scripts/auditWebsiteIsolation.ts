import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const websiteRoot = path.join(repoRoot, "WEBSITE");
const websiteClientRoot = path.join(websiteRoot, "client", "src");
const rootScanRoots = [
  "client",
  "server",
  "shared",
  "db",
  "scripts",
  "e2e",
  "MOBILE",
  "NATIVE",
].map((segment) => path.join(repoRoot, segment));
const codeExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const ignoredDirectories = new Set(["node_modules", ".git", "dist", "build", ".tmp", "test-results"]);
const importPatterns = [
  /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
  /import\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
  /require\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
];

type Violation = {
  file: string;
  specifier: string;
  reason: string;
};

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(entryPath, out);
      continue;
    }
    if (!codeExtensions.has(path.extname(entry.name))) continue;
    out.push(entryPath);
  }

  return out;
}

function extractSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  for (const pattern of importPatterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]?.trim();
      if (specifier) specifiers.add(specifier);
    }
  }
  return Array.from(specifiers);
}

function resolveRelativeImport(importer: string, specifier: string): string {
  return path.resolve(path.dirname(importer), specifier);
}

function resolveWebsiteAlias(specifier: string): string {
  return path.resolve(websiteClientRoot, specifier.slice(2));
}

function collectWebsiteViolations(): Violation[] {
  const violations: Violation[] = [];
  for (const file of walkFiles(websiteRoot)) {
    const source = fs.readFileSync(file, "utf8");
    for (const specifier of extractSpecifiers(source)) {
      if (specifier.startsWith("@db") || specifier.startsWith("@shared") || specifier.startsWith("@assets")) {
        violations.push({
          file,
          specifier,
          reason: "WEBSITE imports a forbidden root alias",
        });
        continue;
      }

      if (specifier.startsWith("@/")) {
        const resolved = resolveWebsiteAlias(specifier);
        if (!resolved.startsWith(websiteClientRoot)) {
          violations.push({
            file,
            specifier,
            reason: "WEBSITE alias import resolves outside WEBSITE/client/src",
          });
        }
        continue;
      }

      if (specifier.startsWith("/")) {
        violations.push({
          file,
          specifier,
          reason: "WEBSITE uses an absolute filesystem import",
        });
        continue;
      }

      if (!specifier.startsWith(".")) continue;

      const resolved = resolveRelativeImport(file, specifier);
      if (!resolved.startsWith(websiteRoot)) {
        violations.push({
          file,
          specifier,
          reason: "WEBSITE relative import escapes WEBSITE/",
        });
      }
    }
  }
  return violations;
}

function collectRootViolations(): Violation[] {
  const violations: Violation[] = [];
  for (const root of rootScanRoots) {
    for (const file of walkFiles(root)) {
      const source = fs.readFileSync(file, "utf8");
      for (const specifier of extractSpecifiers(source)) {
        if (
          specifier === "tradeview-website" ||
          specifier === "tradequip-website" ||
          specifier.startsWith("WEBSITE/")
        ) {
          violations.push({
            file,
            specifier,
            reason: "Root code imports WEBSITE directly",
          });
          continue;
        }

        if (!specifier.startsWith(".")) continue;

        const resolved = resolveRelativeImport(file, specifier);
        if (resolved.startsWith(websiteRoot)) {
          violations.push({
            file,
            specifier,
            reason: "Root relative import resolves into WEBSITE/",
          });
        }
      }
    }
  }
  return violations;
}

function relativeToRepo(file: string): string {
  return path.relative(repoRoot, file) || file;
}

if (!fs.existsSync(websiteRoot)) {
  console.log("WEBSITE/ is not present; isolation audit skipped.");
  process.exit(0);
}

const violations = [...collectWebsiteViolations(), ...collectRootViolations()];

if (!violations.length) {
  console.log("WEBSITE isolation audit passed.");
  process.exit(0);
}

console.error("WEBSITE isolation audit failed:");
for (const violation of violations) {
  console.error(`- ${relativeToRepo(violation.file)} :: ${violation.specifier} :: ${violation.reason}`);
}
process.exit(1);
