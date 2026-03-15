import fs from "node:fs/promises";
import path from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";

export type TrackType = "coreCurriculum" | "optionalExtension" | "platformGuide";
export type CatalogGroup = "core" | "optionalExtensions" | "platformGuide";
export type DisclosureTone = "info" | "warning" | "danger";

export type ScaffoldLesson = {
  lessonSlug: string;
  publicTitle: string;
  packetFile: string;
  companionLessonFile: string;
};

export type ScaffoldTrack = {
  moduleSlug: string;
  trackType: TrackType;
  catalogGroup: CatalogGroup;
  publicTitle: string;
  cardSummary: string;
  status: string;
  flags: string[];
  baseRoute: string;
  lessons: ScaffoldLesson[];
};

export type ModuleCatalog = {
  generatedOn: string;
  tracks: ScaffoldTrack[];
};

export type ReleaseFlagMatrix = {
  generatedOn: string;
  tracks: Record<string, { status: string; flags: string[] }>;
};

export type DisclosureRegistryEntry = {
  id: string;
  title: string;
  tone: DisclosureTone;
  bodyTemplate: string;
  defaultPlacements: string[];
};

export type DisclosureRegistry = Record<string, DisclosureRegistryEntry>;

export type ScreenshotPlaceholderManifestEntry = {
  placeholderId: string;
  lessonSlug: string;
  surface: string;
  device: string;
  expectedLabels: string[];
  sourcePath: string;
  status: string;
  altText: string;
};

export type ScreenshotPlaceholderManifest = {
  moduleSlug: string;
  placeholders: ScreenshotPlaceholderManifestEntry[];
};

export type PacketFreshness = {
  classification: string;
  cadence?: string;
  lastVerifiedOn?: string;
  nextReviewOn?: string;
};

export type GeneratedDisclosure = {
  id: string;
  title: string;
  tone: DisclosureTone;
  body: string;
  placements: string[];
};

export type GeneratedQuizItem = {
  id: string;
  prompt: string;
  choices: Array<{ label: string; text: string }>;
  correctAnswer: { label: string; text: string };
  explanation: string;
  lessonAnchor: string;
};

export type GeneratedLessonSummary = {
  lessonSlug: string;
  title: string;
  summary: string;
  href: string;
};

export type GeneratedLessonLink = {
  lessonSlug: string;
  title: string;
  href: string;
};

export type GeneratedScreenshotPlaceholder = {
  placeholderId: string;
  surface: string;
  device: string;
  expectedLabels: string[];
  sourcePath: string;
  status: string;
  altText: string;
};

export type GeneratedLessonPayload = {
  moduleSlug: string;
  moduleTitle: string;
  moduleBaseRoute: string;
  moduleFlags: string[];
  trackType: TrackType;
  catalogGroup: CatalogGroup;
  lessonSlug: string;
  title: string;
  summary: string;
  bodyHtml: string;
  learningOutcomes: string[];
  quizItems: GeneratedQuizItem[];
  disclosures: GeneratedDisclosure[];
  flags: string[];
  freshness: PacketFreshness | null;
  complianceChecklist: Array<{
    key: string;
    type: "boolean" | "text";
    value: boolean | string;
  }>;
  openQuestions: string[];
  sources: Array<{ label: string; url: string }>;
  previousLesson: GeneratedLessonLink | null;
  nextLesson: GeneratedLessonLink | null;
  sidebarLessons: GeneratedLessonLink[];
  screenshotPlaceholders?: GeneratedScreenshotPlaceholder[];
};

export type GeneratedModulePayload = {
  moduleSlug: string;
  trackType: TrackType;
  catalogGroup: CatalogGroup;
  publicTitle: string;
  cardSummary: string;
  status: string;
  flags: string[];
  baseRoute: string;
  lessonCount: number;
  quizItemCount: number;
  disclosures: GeneratedDisclosure[];
  lessons: GeneratedLessonSummary[];
};

export type GeneratedCatalogCard = {
  moduleSlug: string;
  trackType: TrackType;
  catalogGroup: CatalogGroup;
  publicTitle: string;
  cardSummary: string;
  status: string;
  flags: string[];
  baseRoute: string;
  lessonCount: number;
};

export type GeneratedCatalog = {
  generatedOn: string;
  totals: {
    tracks: number;
    educationTracks: number;
    lessons: number;
    quizItems: number;
  };
  core: GeneratedCatalogCard[];
  optionalExtensions: GeneratedCatalogCard[];
  platformGuide: GeneratedCatalogCard;
  legacyModules: Array<{
    slug: string;
    title: string;
    description: string;
    category: string;
    level: "Beginner";
    url: string;
  }>;
};

const WEBSITE_ROOT = path.resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = path.resolve(WEBSITE_ROOT, "..");
const PUBLIC_WEBSITE_ROOT = path.resolve(WORKSPACE_ROOT, "..", "PUBLIC WEBSITE");

export const EDUCATION_STAGING_ROOT = path.join(
  PUBLIC_WEBSITE_ROOT,
  "education_module_development",
);
export const INTEGRATION_FRAMEWORK_ROOT = path.join(
  PUBLIC_WEBSITE_ROOT,
  "integration_enhancements_framework",
);
export const GENERATED_CONTENT_ROOT = path.join(
  WEBSITE_ROOT,
  "server",
  "content",
  "generated",
);

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function loadScaffold() {
  const [moduleCatalog, releaseFlagMatrix, disclosureRegistry, screenshotManifest] =
    await Promise.all([
      readJsonFile<ModuleCatalog>(
        path.join(INTEGRATION_FRAMEWORK_ROOT, "module_catalog.json"),
      ),
      readJsonFile<ReleaseFlagMatrix>(
        path.join(INTEGRATION_FRAMEWORK_ROOT, "release_flag_matrix.json"),
      ),
      readJsonFile<DisclosureRegistry>(
        path.join(INTEGRATION_FRAMEWORK_ROOT, "disclosure_registry.json"),
      ),
      readJsonFile<ScreenshotPlaceholderManifest>(
        path.join(
          INTEGRATION_FRAMEWORK_ROOT,
          "module10_screenshot_manifest.json",
        ),
      ),
    ]);

  return {
    moduleCatalog,
    releaseFlagMatrix,
    disclosureRegistry,
    screenshotManifest,
  };
}

function normalizeMarkdown(markdown: string) {
  return markdown.replace(/\r\n?/g, "\n");
}

function countLeadingHashes(line: string) {
  const match = line.match(/^(#+)\s+/);
  return match ? match[1].length : 0;
}

export function extractSection(markdown: string, title: string) {
  const lines = normalizeMarkdown(markdown).split("\n");
  const headingIndex = lines.findIndex((line) => {
    const trimmed = line.trim();
    return trimmed === `## ${title}` || trimmed === `### ${title}`;
  });

  if (headingIndex === -1) {
    return "";
  }

  const level = countLeadingHashes(lines[headingIndex]);
  const collected: string[] = [];

  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const lineLevel = countLeadingHashes(line);
    if (lineLevel > 0 && lineLevel <= level) {
      break;
    }
    collected.push(line);
  }

  return collected.join("\n").trim();
}

export function parseKeyValueBullets(section: string) {
  const entries = new Map<string, string>();
  for (const rawLine of normalizeMarkdown(section).split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("- ")) continue;
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;
    const key = line.slice(2, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/`/g, "");
    entries.set(key, value);
  }
  return entries;
}

export function parseBulletList(section: string) {
  return normalizeMarkdown(section)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

export function parseChecklist(section: string) {
  const entries = new Map<string, { type: "boolean" | "text"; value: boolean | string }>();
  for (const rawLine of normalizeMarkdown(section).split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("- ")) continue;
    const withoutBullet = line.slice(2).trim();
    if (withoutBullet.includes("[x]") || withoutBullet.includes("[ ]")) {
      const key = withoutBullet.split("?")[0]?.trim() ?? withoutBullet;
      const value =
        withoutBullet.includes("[x] Yes") ||
        withoutBullet.includes("[x] No") === false && withoutBullet.includes("| [ ] No");
      entries.set(key, { type: "boolean", value });
      continue;
    }

    const separatorIndex = withoutBullet.indexOf(":");
    if (separatorIndex === -1) continue;
    const key = withoutBullet.slice(0, separatorIndex).trim();
    const value = withoutBullet.slice(separatorIndex + 1).trim();
    entries.set(key, { type: "text", value });
  }

  return entries;
}

function parseAnswerChoices(rawChoices: string) {
  const normalized = rawChoices.replace(/\s+/g, " ").trim();
  const matches = normalized.matchAll(/([A-D])\.\s(.+?)(?=(?:\s[A-D]\.\s)|$)/g);
  return Array.from(matches).map((match) => ({
    label: match[1],
    text: match[2].trim(),
  }));
}

function parseCorrectAnswer(rawCorrectAnswer: string) {
  const match = rawCorrectAnswer.match(/^([A-D])\.\s*(.+)$/);
  if (!match) {
    return {
      label: "",
      text: rawCorrectAnswer.trim(),
    };
  }

  return {
    label: match[1],
    text: match[2].trim(),
  };
}

export function parseQuizItems(section: string, lessonSlug: string) {
  const questions = new Map<
    number,
    Partial<{
      prompt: string;
      answerChoices: string;
      correctAnswer: string;
      explanation: string;
      lessonAnchor: string;
    }>
  >();

  for (const rawLine of normalizeMarkdown(section).split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("- Question ")) continue;
    const match = line.match(/^- Question (\d+) ([^:]+):\s*(.*)$/);
    if (!match) continue;

    const questionNumber = Number(match[1]);
    const fieldKey = match[2].trim().toLowerCase();
    const value = match[3].trim();
    const current = questions.get(questionNumber) ?? {};

    if (fieldKey === "prompt") current.prompt = value;
    if (fieldKey === "answer choices") current.answerChoices = value;
    if (fieldKey === "correct answer") current.correctAnswer = value;
    if (fieldKey === "explanation") current.explanation = value;
    if (fieldKey === "lesson anchor") current.lessonAnchor = value;

    questions.set(questionNumber, current);
  }

  return Array.from(questions.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([questionNumber, question]) => ({
      id: `${lessonSlug}-q${questionNumber}`,
      prompt: question.prompt ?? "",
      choices: parseAnswerChoices(question.answerChoices ?? ""),
      correctAnswer: parseCorrectAnswer(question.correctAnswer ?? ""),
      explanation: question.explanation ?? "",
      lessonAnchor: question.lessonAnchor ?? "",
    }))
    .filter((question) => question.prompt && question.choices.length > 0);
}

export function parseFreshness(metadataEntries: Map<string, string>): PacketFreshness | null {
  const classification = metadataEntries.get("Freshness class");
  const lastVerifiedOn = metadataEntries.get("Last verified on");
  const nextReviewOn = metadataEntries.get("Next scheduled review on");

  if (!classification && !lastVerifiedOn && !nextReviewOn) {
    return null;
  }

  const cadenceMatch = classification?.match(/\(Cadence:\s*([^)]+)\)/i);

  return {
    classification: classification?.replace(/\(Cadence:[^)]+\)/i, "").trim() ?? "",
    cadence: cadenceMatch?.[1]?.trim(),
    lastVerifiedOn,
    nextReviewOn,
  };
}

function interpolateTemplate(
  template: string,
  freshness: PacketFreshness | null,
) {
  return template
    .replaceAll("{{lastVerifiedOn}}", freshness?.lastVerifiedOn ?? "not provided")
    .replaceAll("{{nextReviewOn}}", freshness?.nextReviewOn ?? "not provided");
}

export function buildDisclosures(
  moduleSlug: string,
  registry: DisclosureRegistry,
  freshness: PacketFreshness | null,
) {
  const disclosureIds = new Set<string>(["baselineEducation"]);

  if (moduleSlug === "module-6-macro-and-event-awareness") {
    disclosureIds.add("macroFreshness");
  }

  if (moduleSlug === "module-9-crypto-and-defi") {
    disclosureIds.add("cryptoElevatedRisk");
    disclosureIds.add("antiImpersonation");
  }

  if (moduleSlug === "module-10-how-to-use-app") {
    disclosureIds.delete("baselineEducation");
    disclosureIds.add("platformGuide");
    disclosureIds.add("screenshotPending");
  }

  return Array.from(disclosureIds)
    .map((id) => registry[id])
    .filter(Boolean)
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      tone: entry.tone,
      body: interpolateTemplate(entry.bodyTemplate, freshness),
      placements: entry.defaultPlacements,
    }));
}

export function extractMarkdownTitle(markdown: string) {
  const match = normalizeMarkdown(markdown).match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? "Untitled Lesson";
}

export function extractCompanionSummary(markdown: string) {
  const lines = normalizeMarkdown(markdown).split("\n");
  let collected: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (collected.length > 0) break;
      continue;
    }
    if (
      line.startsWith("#") ||
      line.startsWith("|") ||
      line.startsWith("- ") ||
      line.startsWith("*(") ||
      line.startsWith(">") ||
      line.startsWith("```")
    ) {
      if (collected.length > 0) break;
      continue;
    }

    collected.push(line);
  }

  const paragraph = collected.join(" ").replace(/\s+/g, " ").trim();
  if (!paragraph) {
    return "Lesson summary unavailable.";
  }
  return paragraph.length > 220 ? `${paragraph.slice(0, 217).trimEnd()}...` : paragraph;
}

export function trimLessonBodyMarkdown(markdown: string) {
  const normalized = normalizeMarkdown(markdown);
  const quickCheckIndex = normalized.indexOf("\n## Quick Check");
  const sourcesIndex = normalized.indexOf("\n## Verified Source Anchors");

  let cutoff = normalized.length;
  if (quickCheckIndex >= 0) cutoff = Math.min(cutoff, quickCheckIndex);
  if (sourcesIndex >= 0) cutoff = Math.min(cutoff, sourcesIndex);

  return normalized.slice(0, cutoff).trim();
}

export function parseSourceAnchors(markdown: string) {
  const section = extractSection(markdown, "Verified Source Anchors");
  return normalizeMarkdown(section)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .map((line) => {
      const match = line.match(/^(.+?):\s+(https?:\/\/\S+)$/);
      if (!match) {
        return null;
      }
      return {
        label: match[1].trim(),
        url: match[2].trim(),
      };
    })
    .filter((source): source is { label: string; url: string } => Boolean(source));
}

export async function markdownToHtml(markdown: string) {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeSanitize)
    .use(rehypeStringify)
    .process(markdown);

  return String(file);
}

export async function ensureCleanGeneratedRoot() {
  await fs.rm(GENERATED_CONTENT_ROOT, { recursive: true, force: true });
  await fs.mkdir(path.join(GENERATED_CONTENT_ROOT, "modules"), { recursive: true });
  await fs.mkdir(path.join(GENERATED_CONTENT_ROOT, "lessons"), { recursive: true });
}

export function lessonKey(moduleSlug: string, lessonSlug: string) {
  return `${moduleSlug}::${lessonSlug}`;
}

export function lessonHref(track: ScaffoldTrack, lessonSlug: string) {
  return track.trackType === "platformGuide"
    ? `${track.baseRoute}/${lessonSlug}`
    : `${track.baseRoute}/${lessonSlug}`;
}

export function moduleSummaryCategory(track: ScaffoldTrack) {
  if (track.trackType === "coreCurriculum") return "Core Curriculum";
  if (track.trackType === "optionalExtension") return "Optional Extension";
  return "Platform Guide";
}

export async function readMarkdown(relativePath: string) {
  return fs.readFile(path.join(EDUCATION_STAGING_ROOT, relativePath), "utf8");
}
