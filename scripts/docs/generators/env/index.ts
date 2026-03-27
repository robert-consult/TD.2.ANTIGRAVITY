import {
  DOC_LAST_VERIFIED,
  parseSimpleTableRow,
  readText,
  renderFrontMatter,
  repoPath,
  uniqueSorted,
  walkFiles,
  writeFileIfChanged,
} from "../../lib/shared";

type EnvRecord = {
  name: string;
  defaultValue: string;
  declaredInExample: boolean;
  startupRule: string;
  references: string[];
};

const OUTPUT_PATH = repoPath("Documentation", "generated", "Environment_Catalog.md");
const GENERATOR_SOURCE = "scripts/docs/generators/env/index.ts";

const STARTUP_RULES = new Map<string, string>([
  ["SESSION_SECRET", "Fail-fast when missing; weak values warned in development."],
  ["LEGAL_TERMS_HMAC_SECRET", "Fail-fast when missing or shorter than 32 chars."],
  ["ENCRYPTION_KEY", "Warn in development, fail-fast in production unless 64 hex chars."],
  ["EMAIL_VERIFY_TOKEN_SECRET", "Required in production; short values fail in production."],
  ["COOKIE_SAMESITE", "Fail-fast when set to `none`."],
]);

function parseEnvExample(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const name = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1);
    if (/^[A-Z0-9_]+$/.test(name)) {
      map.set(name, value);
    }
  }
  return map;
}

async function collectReferences(): Promise<Map<string, Set<string>>> {
  const targetRoots = [
    repoPath("server"),
    repoPath("shared"),
    repoPath("scripts"),
    repoPath("db"),
    repoPath("MOBILE"),
    repoPath("NATIVE"),
    repoPath("WEBSITE"),
  ];
  const files = (
    await Promise.all(
      targetRoots.map(async (root) =>
        (await walkFiles(root)).filter((filePath) => /\.(ts|tsx|js|mjs|cjs|sh|md|json)$/.test(filePath)),
      ),
    )
  ).flat();

  const referenceMap = new Map<string, Set<string>>();
  const envRegex = /\bprocess\.env\.([A-Z0-9_]+)\b|\brequireEnv\(\s*["']([A-Z0-9_]+)["']\s*\)/g;

  for (const filePath of files) {
    if (filePath.includes("/node_modules/")) continue;
    const text = await readText(filePath);
    for (const match of text.matchAll(envRegex)) {
      const envName = match[1] ?? match[2] ?? "";
      if (!envName) continue;
      const bucket = referenceMap.get(envName) ?? new Set<string>();
      bucket.add(filePath.replace(`${process.cwd()}/`, "").replace(/\\/g, "/"));
      referenceMap.set(envName, bucket);
    }
  }

  return referenceMap;
}

export async function buildEnvCatalog(): Promise<string> {
  const envExample = parseEnvExample(await readText(repoPath(".env.example")));
  const references = await collectReferences();
  const envNames = uniqueSorted([...envExample.keys(), ...references.keys()]);

  const records: EnvRecord[] = envNames.map((name) => ({
    name,
    defaultValue: envExample.get(name) ?? "",
    declaredInExample: envExample.has(name),
    startupRule: STARTUP_RULES.get(name) ?? "",
    references: uniqueSorted(references.get(name) ?? []),
  }));

  const rows = records.map((record) =>
    parseSimpleTableRow([
      `\`${record.name}\``,
      record.declaredInExample ? `\`${record.defaultValue || "(empty)"}\`` : "No",
      record.startupRule || "Referenced only; no explicit fail-fast rule discovered.",
      record.references.length
        ? record.references.slice(0, 4).map((value) => `\`${value}\``).join("<br>")
        : "No source references discovered.",
    ]),
  );

  return [
    renderFrontMatter({
      audience: "generated",
      exposure: "internal",
      owner: "documentation-program",
      canonicalSources: [".env.example", "server/index.ts", "server/routes/wsCore.ts", "server/routes.ts"],
      lastVerified: DOC_LAST_VERIFIED,
      status: "generated",
      generatedFrom: [GENERATOR_SOURCE],
    }),
    "# Environment Catalog",
    "",
    "> Generated from `.env.example` plus direct `process.env.*` and `requireEnv()` references.",
    "",
    `Environment names discovered: **${records.length}**.`,
    "",
    "| Variable | Example Default | Startup Rule | Example Source References |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

export async function generateEnvCatalog(): Promise<void> {
  const content = await buildEnvCatalog();
  await writeFileIfChanged(OUTPUT_PATH, content);
}
