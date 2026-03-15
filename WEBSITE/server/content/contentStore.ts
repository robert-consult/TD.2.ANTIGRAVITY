import fs from "node:fs";
import path from "node:path";
import type { EducationCatalog, LessonPayload, ModulePayload } from "./types";

type ModuleIndex = {
  generatedOn: string;
  modules: Record<
    string,
    {
      file: string;
      trackType: string;
      catalogGroup: string;
    }
  >;
};

type LessonIndex = {
  generatedOn: string;
  lessons: Record<
    string,
    {
      file: string;
      moduleSlug: string;
      lessonSlug: string;
      trackType: string;
    }
  >;
};

type CacheState = {
  generatedRoot: string;
  versionKey: string;
  catalog: EducationCatalog;
  moduleIndex: ModuleIndex;
  lessonIndex: LessonIndex;
};

let cache: CacheState | null = null;

function getGeneratedRootCandidates() {
  return [
    path.resolve(import.meta.dirname, "generated"),
    path.resolve(import.meta.dirname, "../server/content/generated"),
    path.resolve(import.meta.dirname, "../../server/content/generated"),
  ];
}

function resolveGeneratedRoot() {
  const resolved = getGeneratedRootCandidates().find((candidate) =>
    fs.existsSync(path.join(candidate, "catalog.json")),
  );

  if (!resolved) {
    throw new Error(
      "Generated education content was not found. Run `npm run content:sync` in WEBSITE first.",
    );
  }

  return resolved;
}

function readJsonFile<T>(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function buildVersionKey(generatedRoot: string) {
  const files = [
    "catalog.json",
    "module-index.json",
    "lesson-index.json",
  ].map((fileName) => path.join(generatedRoot, fileName));

  return files
    .map((filePath) => fs.statSync(filePath).mtimeMs)
    .join(":");
}

function getCacheState() {
  const generatedRoot = resolveGeneratedRoot();
  const versionKey = buildVersionKey(generatedRoot);

  if (cache && cache.generatedRoot === generatedRoot && cache.versionKey === versionKey) {
    return cache;
  }

  cache = {
    generatedRoot,
    versionKey,
    catalog: readJsonFile<EducationCatalog>(path.join(generatedRoot, "catalog.json")),
    moduleIndex: readJsonFile<ModuleIndex>(path.join(generatedRoot, "module-index.json")),
    lessonIndex: readJsonFile<LessonIndex>(path.join(generatedRoot, "lesson-index.json")),
  };

  return cache;
}

function readModulePayload(moduleSlug: string) {
  const state = getCacheState();
  const record = state.moduleIndex.modules[moduleSlug];
  if (!record) return null;
  return readJsonFile<ModulePayload>(path.join(state.generatedRoot, record.file));
}

function readLessonPayload(moduleSlug: string, lessonSlug: string) {
  const state = getCacheState();
  const record = state.lessonIndex.lessons[`${moduleSlug}::${lessonSlug}`];
  if (!record) return null;
  return readJsonFile<LessonPayload>(path.join(state.generatedRoot, record.file));
}

export function getEducationCatalog() {
  return getCacheState().catalog;
}

export function getLegacyEducationModuleCards() {
  return getCacheState().catalog.legacyModules;
}

export function getEducationModule(moduleSlug: string) {
  const modulePayload = readModulePayload(moduleSlug);
  if (!modulePayload || modulePayload.trackType === "platformGuide") {
    return null;
  }
  return modulePayload;
}

export function getEducationLesson(moduleSlug: string, lessonSlug: string) {
  const lessonPayload = readLessonPayload(moduleSlug, lessonSlug);
  if (!lessonPayload || lessonPayload.trackType === "platformGuide") {
    return null;
  }
  return lessonPayload;
}

export function getPlatformGuideOverview() {
  return readModulePayload("module-10-how-to-use-app");
}

export function getPlatformGuideLesson(lessonSlug: string) {
  const lessonPayload = readLessonPayload("module-10-how-to-use-app", lessonSlug);
  if (!lessonPayload || lessonPayload.trackType !== "platformGuide") {
    return null;
  }
  return lessonPayload;
}
