import fs from "node:fs/promises";
import path from "node:path";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".map",
  ".svg",
  ".txt",
]);

const MIN_BYTES = 1024;

async function listFilesRecursive(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(fullPath)));
      continue;
    }
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function main() {
  const distPublicDir = path.resolve(process.cwd(), "dist", "public");
  const files = await listFilesRecursive(distPublicDir).catch(() => []);
  if (files.length === 0) {
    console.warn(`[precompress] No files found under ${distPublicDir}`);
    return;
  }

  let processed = 0;
  for (const filePath of files) {
    if (filePath.endsWith(".br") || filePath.endsWith(".gz")) continue;
    const ext = path.extname(filePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;

    const stat = await fs.stat(filePath);
    if (stat.size < MIN_BYTES) continue;

    const content = await fs.readFile(filePath);

    const gzipPath = `${filePath}.gz`;
    const brotliPath = `${filePath}.br`;

    const gzipped = gzipSync(content, { level: 9 });
    await fs.writeFile(gzipPath, gzipped);

    const brotlied = brotliCompressSync(content, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      },
    });
    await fs.writeFile(brotliPath, brotlied);
    processed += 1;
  }

  console.log(`[precompress] Generated .gz/.br for ${processed} files`);
}

main().catch((err) => {
  console.error("[precompress] Failed:", err);
  process.exitCode = 1;
});
