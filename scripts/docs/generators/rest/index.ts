import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  DOC_LAST_VERIFIED,
  joinRoutePath,
  relativeRepoPath,
  renderFrontMatter,
  repoPath,
  resolveImportTarget,
  uniqueSorted,
  walkFiles,
  writeFileIfChanged,
} from "../../lib/shared";

type RouteRecord = {
  method: string;
  path: string;
  file: string;
  surface: string;
};

const OUTPUT_PATH = repoPath("Documentation", "generated", "REST_API_Catalog.md");
const GENERATOR_SOURCE = "scripts/docs/generators/rest/index.ts";

function classifySurface(routePath: string): string {
  if (routePath === "/status" || routePath === "/health" || routePath === "/ready" || routePath === "/metrics") {
    return "platform";
  }
  if (routePath.startsWith("/api/admin")) return "admin";
  if (routePath.startsWith("/api/partner")) return "partner";
  if (routePath.startsWith("/api/verification")) return "verification";
  if (routePath.startsWith("/api/legal")) return "legal";
  if (routePath.startsWith("/api/profile")) return "profile";
  if (routePath.startsWith("/api/trades") || routePath.startsWith("/api/account")) return "trader";
  if (routePath.startsWith("/api/mailbox")) return "mailbox";
  if (routePath.startsWith("/api/notifications") || routePath.startsWith("/api/push")) return "notifications";
  if (routePath.startsWith("/api/grift")) return "grift";
  if (routePath.startsWith("/api/i18n")) return "i18n";
  if (routePath.startsWith("/api/instruments") || routePath.startsWith("/api/market")) return "market-data";
  if (routePath.startsWith("/api/auth")) return "auth";
  if (routePath.startsWith("/api")) return "public-or-mixed";
  return "other";
}

function parseImports(serverRoutesText: string, serverRoutesFile: string): Map<string, string> {
  const importMap = new Map<string, string>();
  const importRegex = /^import\s+(.+?)\s+from\s+["'](.+?)["'];/gm;

  for (const match of serverRoutesText.matchAll(importRegex)) {
    const rawClause = match[1]?.trim() ?? "";
    const specifier = match[2]?.trim() ?? "";
    const resolved = resolveImportTarget(serverRoutesFile, specifier);
    if (!resolved) continue;

    if (rawClause.startsWith("{")) {
      const names = rawClause
        .replace(/[{}]/g, "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => value.split(/\s+as\s+/i).pop() ?? value);
      for (const name of names) {
        importMap.set(name, resolved);
      }
      continue;
    }

    const parts = rawClause.split(",").map((value) => value.trim()).filter(Boolean);
    if (parts[0]) {
      importMap.set(parts[0], resolved);
    }
    if (parts[1]?.startsWith("{")) {
      const names = parts[1]
        .replace(/[{}]/g, "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => value.split(/\s+as\s+/i).pop() ?? value);
      for (const name of names) {
        importMap.set(name, resolved);
      }
    }
  }

  return importMap;
}

async function resolveMountPrefixes(): Promise<Map<string, string[]>> {
  const serverRoutesFile = repoPath("server", "routes.ts");
  const content = await readFile(serverRoutesFile, "utf8");
  const importMap = parseImports(content, serverRoutesFile);
  const prefixMap = new Map<string, Set<string>>();
  const useRegex = /app\.use\(\s*["'](\/[^"']*)["']\s*,\s*([A-Za-z0-9_]+)\s*\)/g;

  for (const match of content.matchAll(useRegex)) {
    const prefix = match[1]?.trim();
    const symbol = match[2]?.trim();
    if (!prefix || !symbol) continue;
    const target = importMap.get(symbol);
    if (!target) continue;
    const bucket = prefixMap.get(target) ?? new Set<string>();
    bucket.add(prefix);
    prefixMap.set(target, bucket);
  }

  const publicDir = repoPath("server", "routes", "public");
  prefixMap.set(path.join(publicDir, "index.ts"), new Set(["/api"]));
  const publicFiles = await walkFiles(publicDir);
  for (const filePath of publicFiles) {
    if (filePath.endsWith(".ts") && !filePath.endsWith(".test.ts")) {
      const bucket = prefixMap.get(filePath) ?? new Set<string>();
      bucket.add("/api");
      prefixMap.set(filePath, bucket);
    }
  }

  return new Map(
    [...prefixMap.entries()].map(([filePath, prefixes]) => [filePath, uniqueSorted(prefixes)]),
  );
}

async function collectRoutes(): Promise<RouteRecord[]> {
  const routeFiles = uniqueSorted([
    repoPath("server", "routes.ts"),
    ...(await walkFiles(repoPath("server", "routes"))),
  ]).filter((filePath) =>
    filePath.endsWith(".ts") &&
    !filePath.endsWith(".test.ts") &&
    !filePath.endsWith(".spec.ts"),
  );

  const mountPrefixes = await resolveMountPrefixes();
  const routeRegex = /\b(?:router|app)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
  const records: RouteRecord[] = [];

  for (const filePath of routeFiles) {
    const text = await readFile(filePath, "utf8");
    const prefixes = mountPrefixes.get(filePath) ?? [];

    for (const match of text.matchAll(routeRegex)) {
      const method = (match[1] ?? "").toUpperCase();
      const rawRoutePath = match[2] ?? "";
      if (!method || !rawRoutePath.startsWith("/")) continue;

      const expandedPaths = prefixes.length
        ? prefixes.map((prefix) => joinRoutePath(prefix, rawRoutePath))
        : [rawRoutePath];

      for (const fullPath of expandedPaths) {
        records.push({
          method,
          path: fullPath,
          file: relativeRepoPath(filePath),
          surface: classifySurface(fullPath),
        });
      }
    }
  }

  return uniqueSorted(records.map((route) => `${route.method}\t${route.path}\t${route.file}\t${route.surface}`)).map(
    (value) => {
      const [method, routePath, file, surface] = value.split("\t");
      return { method, path: routePath, file, surface };
    },
  );
}

export async function buildRestCatalog(): Promise<string> {
  const routes = await collectRoutes();
  const surfaceCounts = new Map<string, number>();
  for (const route of routes) {
    surfaceCounts.set(route.surface, (surfaceCounts.get(route.surface) ?? 0) + 1);
  }

  const summaryRows = uniqueSorted(surfaceCounts.keys()).map((surface) =>
    `| ${surface} | ${surfaceCounts.get(surface)} |`,
  );
  const routeRows = routes.map((route) => `| ${route.method} | ${route.path} | ${route.surface} | \`${route.file}\` |`);

  return [
    renderFrontMatter({
      audience: "generated",
      exposure: "internal",
      owner: "documentation-program",
      canonicalSources: ["server/routes.ts", "server/routes/"],
      lastVerified: DOC_LAST_VERIFIED,
      status: "generated",
      generatedFrom: [GENERATOR_SOURCE],
    }),
    "# REST API Catalog",
    "",
    "> Generated from the current route tree. Do not edit by hand.",
    "",
    `Generated on ${DOC_LAST_VERIFIED} from \`server/routes.ts\` and \`server/routes/**\`.`,
    "",
    `Total route declarations discovered: **${routes.length}**.`,
    "",
    "## Surface Counts",
    "",
    "| Surface | Count |",
    "| --- | ---: |",
    ...summaryRows,
    "",
    "## Route Catalog",
    "",
    "| Method | Path | Surface | Source |",
    "| --- | --- | --- | --- |",
    ...routeRows,
    "",
  ].join("\n");
}

export async function generateRestCatalog(): Promise<void> {
  const content = await buildRestCatalog();
  await writeFileIfChanged(OUTPUT_PATH, content);
}
