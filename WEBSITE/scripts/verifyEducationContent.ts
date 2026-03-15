import fs from "node:fs/promises";
import path from "node:path";
import {
  type GeneratedCatalog,
  type GeneratedLessonPayload,
  type GeneratedModulePayload,
  GENERATED_CONTENT_ROOT,
  loadScaffold,
} from "./educationContentUtils";

const REQUIRED_MODULE9_FLAGS = [
  "Optional Extension",
  "Crypto/DeFi",
  "Elevated Risk",
  "Compliance Review Pending",
  "Re-review by June 12, 2026",
];

const REQUIRED_MODULE10_FLAGS = [
  "Platform Guide",
  "Screenshots Pending",
  "UI verified March 12, 2026",
  "Re-verify by June 12, 2026",
];

function hasFlagSet(flags: string[], requiredFlags: string[]) {
  return requiredFlags.every((flag) => flags.includes(flag));
}

async function readJson<T>(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const { moduleCatalog, screenshotManifest } = await loadScaffold();
  const catalog = await readJson<GeneratedCatalog>(
    path.join(GENERATED_CONTENT_ROOT, "catalog.json"),
  );
  const moduleIndex = await readJson<{
    modules: Record<string, { file: string }>;
  }>(path.join(GENERATED_CONTENT_ROOT, "module-index.json"));
  const lessonIndex = await readJson<{
    lessons: Record<string, { file: string; moduleSlug: string; lessonSlug: string }>;
  }>(path.join(GENERATED_CONTENT_ROOT, "lesson-index.json"));

  assert(moduleCatalog.tracks.length === 10, "Scaffold should contain 10 tracks.");
  assert(catalog.totals.tracks === 10, "Generated catalog should contain 10 tracks.");
  assert(catalog.totals.educationTracks === 9, "Generated catalog should contain 9 education tracks.");
  assert(catalog.totals.lessons === 35, "Generated catalog should contain 35 lessons.");
  assert(catalog.totals.quizItems >= 105, "Generated catalog should contain at least 105 quiz items.");
  assert(catalog.core.length === 7, "Catalog core group should contain 7 modules.");
  assert(catalog.optionalExtensions.length === 2, "Catalog optional extensions group should contain 2 modules.");
  assert(Boolean(catalog.platformGuide), "Catalog should include a platform guide card.");
  assert(Object.keys(moduleIndex.modules).length === 10, "Module index should contain 10 module records.");
  assert(Object.keys(lessonIndex.lessons).length === 35, "Lesson index should contain 35 lesson records.");

  const lessonPayloads: GeneratedLessonPayload[] = [];

  for (const record of Object.values(lessonIndex.lessons)) {
    const lessonPayload = await readJson<GeneratedLessonPayload>(
      path.join(GENERATED_CONTENT_ROOT, record.file),
    );
    lessonPayloads.push(lessonPayload);
    assert(
      lessonPayload.quizItems.length >= 3,
      `Lesson ${record.lessonSlug} must contain at least 3 quiz items.`,
    );
    assert(
      !/<script[\s>]/i.test(lessonPayload.bodyHtml),
      `Lesson ${record.lessonSlug} contains a disallowed <script> tag in rendered HTML.`,
    );
    assert(
      !/<[^>]+\son[a-z]+\s*=/i.test(lessonPayload.bodyHtml),
      `Lesson ${record.lessonSlug} contains a disallowed inline event handler in rendered HTML.`,
    );
    assert(
      !/javascript:/i.test(lessonPayload.bodyHtml),
      `Lesson ${record.lessonSlug} contains a disallowed javascript: URL in rendered HTML.`,
    );
  }

  const modulesNeedingFreshness = new Set([
    "module-6-macro-and-event-awareness",
    "module-9-crypto-and-defi",
    "module-10-how-to-use-app",
  ]);

  for (const moduleSlug of Array.from(modulesNeedingFreshness)) {
    const moduleLessons = lessonPayloads.filter(
      (lessonPayload) => lessonPayload.moduleSlug === moduleSlug,
    );
    assert(moduleLessons.length > 0, `No lessons found for ${moduleSlug}.`);

    for (const lessonPayload of moduleLessons) {
      assert(
        lessonPayload.freshness?.lastVerifiedOn,
        `Lesson ${lessonPayload.lessonSlug} is missing lastVerifiedOn freshness metadata.`,
      );
      assert(
        lessonPayload.freshness?.nextReviewOn,
        `Lesson ${lessonPayload.lessonSlug} is missing nextReviewOn freshness metadata.`,
      );
    }
  }

  const module9Lessons = lessonPayloads.filter(
    (lessonPayload) => lessonPayload.moduleSlug === "module-9-crypto-and-defi",
  );
  assert(module9Lessons.length === 4, "Module 9 should contain 4 lessons.");
  for (const lessonPayload of module9Lessons) {
    assert(
      hasFlagSet(lessonPayload.flags, REQUIRED_MODULE9_FLAGS),
      `Module 9 lesson ${lessonPayload.lessonSlug} is missing one or more required flags.`,
    );
    const disclosureIds = lessonPayload.disclosures.map((disclosure) => disclosure.id);
    assert(
      disclosureIds.includes("cryptoElevatedRisk"),
      `Module 9 lesson ${lessonPayload.lessonSlug} is missing the crypto risk disclosure.`,
    );
    assert(
      disclosureIds.includes("antiImpersonation"),
      `Module 9 lesson ${lessonPayload.lessonSlug} is missing the anti-impersonation disclosure.`,
    );
  }

  const module10Lessons = lessonPayloads.filter(
    (lessonPayload) => lessonPayload.moduleSlug === "module-10-how-to-use-app",
  );
  assert(module10Lessons.length === 4, "Module 10 should contain 4 lessons.");

  const expectedPlaceholderCounts = new Map<string, number>([
    ["10.1-dashboard-layout", 4],
    ["10.2-portfolio-metrics", 3],
    ["10.3-executing-trades", 3],
    ["10.4-advanced-features", 6],
  ]);

  const totalPlaceholders = module10Lessons.reduce(
    (count, lessonPayload) => count + (lessonPayload.screenshotPlaceholders?.length ?? 0),
    0,
  );
  assert(totalPlaceholders === screenshotManifest.placeholders.length, "Module 10 placeholder total does not match the manifest.");
  assert(totalPlaceholders === 16, "Module 10 should expose 16 screenshot placeholders.");

  for (const lessonPayload of module10Lessons) {
    assert(
      hasFlagSet(lessonPayload.flags, REQUIRED_MODULE10_FLAGS),
      `Module 10 lesson ${lessonPayload.lessonSlug} is missing one or more required flags.`,
    );
    assert(
      (lessonPayload.screenshotPlaceholders?.length ?? 0) ===
        expectedPlaceholderCounts.get(lessonPayload.lessonSlug),
      `Module 10 lesson ${lessonPayload.lessonSlug} has the wrong screenshot placeholder count.`,
    );
    const disclosureIds = lessonPayload.disclosures.map((disclosure) => disclosure.id);
    assert(
      disclosureIds.includes("platformGuide"),
      `Module 10 lesson ${lessonPayload.lessonSlug} is missing the platform guide disclosure.`,
    );
    assert(
      disclosureIds.includes("screenshotPending"),
      `Module 10 lesson ${lessonPayload.lessonSlug} is missing the screenshot pending disclosure.`,
    );
  }

  for (const moduleSlug of Object.keys(moduleIndex.modules)) {
    const modulePayload = await readJson<GeneratedModulePayload>(
      path.join(GENERATED_CONTENT_ROOT, moduleIndex.modules[moduleSlug].file),
    );
    assert(
      modulePayload.lessonCount > 0,
      `Module ${moduleSlug} should contain at least one lesson.`,
    );
  }

  console.log("Education content verification passed.");
}

main().catch((error) => {
  console.error("Education content verification failed.");
  console.error(error);
  process.exit(1);
});
