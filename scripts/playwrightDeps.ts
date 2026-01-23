import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function run(cmd: string, args: string[], opts?: { cwd?: string }) {
  execFileSync(cmd, args, { stdio: "inherit", cwd: opts?.cwd });
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function listDebs(dir: string) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".deb"))
    .map((d) => d.name);
}

function main() {
  if (process.platform !== "linux") {
    console.log(`[e2e:deps] Skipping (platform=${process.platform})`);
    return;
  }

  const base = path.resolve(".tmp/playwright-deps");
  const debsDir = path.join(base, "debs");
  const rootDir = path.join(base, "root");
  const libDir = path.join(rootDir, "usr/lib/x86_64-linux-gnu");
  const sentinel = path.join(libDir, "libnspr4.so");

  if (fs.existsSync(sentinel)) {
    console.log(`[e2e:deps] OK (${libDir})`);
    return;
  }

  ensureDir(debsDir);
  ensureDir(rootDir);

  run("apt-get", ["download", "libnspr4", "libnss3", "libasound2t64"], { cwd: debsDir });
  const debs = listDebs(debsDir);
  if (!debs.length) {
    throw new Error(`[e2e:deps] No .deb files downloaded into ${debsDir}`);
  }

  for (const deb of debs) {
    run("dpkg-deb", ["-x", path.join(debsDir, deb), rootDir]);
  }

  if (!fs.existsSync(sentinel)) {
    throw new Error(`[e2e:deps] Missing ${sentinel} after extraction`);
  }

  console.log(`[e2e:deps] Ready (${libDir})`);
}

main();

