import fs from "node:fs";
import path from "node:path";

function readArg(name: string): string | null {
  const direct = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) {
    const value = direct.slice(name.length + 1).trim();
    return value || null;
  }

  const index = process.argv.findIndex((arg) => arg === name);
  if (index >= 0) {
    const value = String(process.argv[index + 1] ?? "").trim();
    return value || null;
  }

  return null;
}

function parseImageRef(imageRef: string): { newName: string; newTag: string } {
  const ref = String(imageRef || "").trim();
  if (!ref) throw new Error("Missing required --image argument");
  if (ref.includes("@")) throw new Error("Digest-only image refs are not supported by this updater");

  const lastSlash = ref.lastIndexOf("/");
  const lastColon = ref.lastIndexOf(":");
  if (lastColon <= lastSlash) throw new Error(`Image ref must include an explicit tag: ${ref}`);

  return {
    newName: ref.slice(0, lastColon),
    newTag: ref.slice(lastColon + 1),
  };
}

function updateOverlayKustomization(filePath: string, imageRef: string) {
  const { newName, newTag } = parseImageRef(imageRef);
  const current = fs.readFileSync(filePath, "utf8");

  let updated = current;
  updated = updated.replace(/(\n\s+newName:\s+).*/m, `$1${newName}`);
  updated = updated.replace(/(\n\s+newTag:\s+).*/m, `$1${newTag}`);

  if (updated === current) {
    throw new Error(`Failed to update image reference in ${filePath}`);
  }

  fs.writeFileSync(filePath, updated);
}

function main() {
  const overlay = readArg("--overlay");
  const image = readArg("--image");

  if (!overlay) throw new Error("Missing required --overlay argument");
  if (!image) throw new Error("Missing required --image argument");

  const filePath = path.resolve(process.cwd(), "k8s", "overlays", overlay, "kustomization.yaml");
  if (!fs.existsSync(filePath)) throw new Error(`Overlay not found: ${filePath}`);

  updateOverlayKustomization(filePath, image);
  process.stdout.write(`Updated ${filePath} to ${image}\n`);
}

main();
