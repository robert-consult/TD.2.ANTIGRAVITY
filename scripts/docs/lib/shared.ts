import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const DOC_LAST_VERIFIED = "2026-03-30";
export const REPO_ROOT = process.cwd();

const DEFAULT_SKIPPED_DIR_NAMES = new Set([
  ".git",
  ".gradle",
  "Pods",
  "build",
  "dist",
  "node_modules",
]);

export type DocMeta = {
  audience: string;
  exposure: string;
  owner: string;
  canonicalSources: string[];
  lastVerified?: string;
  status: string;
  generatedFrom?: string[];
};

export function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

export function repoPath(...segments: string[]): string {
  return path.join(REPO_ROOT, ...segments);
}

export function relativeRepoPath(filePath: string): string {
  return toPosix(path.relative(REPO_ROOT, filePath));
}

export async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function walkFiles(dirPath: string): Promise<string[]> {
  return walkFilesWithOptions(dirPath, { skipDirNames: DEFAULT_SKIPPED_DIR_NAMES });
}

type WalkFilesOptions = {
  skipDirNames?: Set<string>;
};

export async function walkFilesWithOptions(
  dirPath: string,
  options: WalkFilesOptions = {},
): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (options.skipDirNames?.has(entry.name)) {
          return [];
        }
        return walkFilesWithOptions(fullPath, options);
      }
      return [fullPath];
    }),
  );
  return files.flat();
}

export function renderFrontMatter(meta: DocMeta): string {
  const lines = [
    "---",
    `audience: ${meta.audience}`,
    `exposure: ${meta.exposure}`,
    `owner: ${meta.owner}`,
    "canonical_sources:",
    ...meta.canonicalSources.map((value) => `  - ${value}`),
    `last_verified: ${meta.lastVerified ?? DOC_LAST_VERIFIED}`,
    `status: ${meta.status}`,
  ];

  if (meta.generatedFrom?.length) {
    lines.push("generated_from:");
    lines.push(...meta.generatedFrom.map((value) => `  - ${value}`));
  }

  lines.push("---", "");
  return lines.join("\n");
}

export async function writeFileIfChanged(filePath: string, content: string): Promise<boolean> {
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  const exists = await pathExists(filePath);
  if (exists) {
    const current = await readText(filePath);
    if (current === normalized) {
      return false;
    }
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, normalized, "utf8");
  return true;
}

export function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function joinRoutePath(prefix: string, routePath: string): string {
  if (!prefix) return routePath;
  if (routePath.startsWith(prefix)) return routePath;
  if (routePath === "/") return prefix;
  return `${prefix.replace(/\/+$/, "")}/${routePath.replace(/^\/+/, "")}`;
}

export function resolveImportTarget(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const candidates = [
    path.resolve(path.dirname(fromFile), specifier),
    path.resolve(path.dirname(fromFile), `${specifier}.ts`),
    path.resolve(path.dirname(fromFile), `${specifier}.tsx`),
    path.resolve(path.dirname(fromFile), specifier, "index.ts"),
    path.resolve(path.dirname(fromFile), specifier, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function extractFrontMatterBlock(content: string): string | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  return match?.[1] ?? null;
}

export function parseSimpleTableRow(columns: string[]): string {
  return `| ${columns.join(" | ")} |`;
}
