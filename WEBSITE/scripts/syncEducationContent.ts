import fs from "node:fs/promises";
import path from "node:path";
import {
  type GeneratedCatalog,
  type GeneratedCatalogCard,
  type GeneratedLessonLink,
  type GeneratedLessonPayload,
  type GeneratedLessonSummary,
  type GeneratedModulePayload,
  type ScaffoldTrack,
  buildDisclosures,
  ensureCleanGeneratedRoot,
  extractCompanionSummary,
  extractMarkdownTitle,
  extractSection,
  GENERATED_CONTENT_ROOT,
  lessonHref,
  lessonKey,
  loadScaffold,
  markdownToHtml,
  moduleSummaryCategory,
  parseBulletList,
  parseChecklist,
  parseFreshness,
  parseKeyValueBullets,
  parseQuizItems,
  parseSourceAnchors,
  readMarkdown,
  trimLessonBodyMarkdown,
} from "./educationContentUtils";

type ModuleIndexRecord = Record<
  string,
  {
    file: string;
    trackType: string;
    catalogGroup: string;
  }
>;

type LessonIndexRecord = Record<
  string,
  {
    file: string;
    moduleSlug: string;
    lessonSlug: string;
    trackType: string;
  }
>;

function buildLessonLink(track: ScaffoldTrack, lessonSlug: string, title: string): GeneratedLessonLink {
  return {
    lessonSlug,
    title,
    href: lessonHref(track, lessonSlug),
  };
}

function createCatalogCard(modulePayload: GeneratedModulePayload): GeneratedCatalogCard {
  return {
    moduleSlug: modulePayload.moduleSlug,
    trackType: modulePayload.trackType,
    catalogGroup: modulePayload.catalogGroup,
    publicTitle: modulePayload.publicTitle,
    cardSummary: modulePayload.cardSummary,
    status: modulePayload.status,
    flags: modulePayload.flags,
    baseRoute: modulePayload.baseRoute,
    lessonCount: modulePayload.lessonCount,
  };
}

async function writeJson(filePath: string, payload: unknown) {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const {
    moduleCatalog,
    releaseFlagMatrix,
    disclosureRegistry,
    screenshotManifest,
  } = await loadScaffold();

  await ensureCleanGeneratedRoot();

  const moduleIndex: ModuleIndexRecord = {};
  const lessonIndex: LessonIndexRecord = {};
  const modulePayloads: GeneratedModulePayload[] = [];

  let totalLessons = 0;
  let totalQuizItems = 0;

  for (const track of moduleCatalog.tracks) {
    const releaseInfo = releaseFlagMatrix.tracks[track.moduleSlug] ?? {
      status: track.status,
      flags: track.flags,
    };

    const lessonPayloads: GeneratedLessonPayload[] = [];
    const sidebarLessons = track.lessons.map((lesson) =>
      buildLessonLink(track, lesson.lessonSlug, lesson.publicTitle),
    );

    for (let index = 0; index < track.lessons.length; index += 1) {
      const lesson = track.lessons[index];
      const [packetMarkdown, companionMarkdown] = await Promise.all([
        readMarkdown(lesson.packetFile),
        readMarkdown(lesson.companionLessonFile),
      ]);

      const metadataEntries = parseKeyValueBullets(
        extractSection(packetMarkdown, "Lesson Metadata"),
      );
      const freshness = parseFreshness(metadataEntries);
      const learningOutcomes = parseBulletList(
        extractSection(packetMarkdown, "Lesson Outcome"),
      );
      const complianceChecklistMap = parseChecklist(
        extractSection(packetMarkdown, "Compliance & Risk Disclaimer Checklist"),
      );
      const openQuestions = parseBulletList(
        extractSection(packetMarkdown, "Open Questions"),
      );
      const quizItems = parseQuizItems(
        extractSection(packetMarkdown, "Course Wizard MCQ Mapping"),
        lesson.lessonSlug,
      );

      const bodyMarkdown = trimLessonBodyMarkdown(companionMarkdown);
      const bodyHtml = await markdownToHtml(bodyMarkdown);
      const sources = parseSourceAnchors(companionMarkdown);
      const title = extractMarkdownTitle(companionMarkdown);
      const summary = extractCompanionSummary(bodyMarkdown);

      const previousLesson =
        index > 0
          ? buildLessonLink(
              track,
              track.lessons[index - 1].lessonSlug,
              track.lessons[index - 1].publicTitle,
            )
          : null;
      const nextLesson =
        index < track.lessons.length - 1
          ? buildLessonLink(
              track,
              track.lessons[index + 1].lessonSlug,
              track.lessons[index + 1].publicTitle,
            )
          : null;

      const screenshotPlaceholders =
        track.moduleSlug === screenshotManifest.moduleSlug
          ? screenshotManifest.placeholders
              .filter((placeholder) => placeholder.lessonSlug === lesson.lessonSlug)
              .map((placeholder) => ({
                placeholderId: placeholder.placeholderId,
                surface: placeholder.surface,
                device: placeholder.device,
                expectedLabels: placeholder.expectedLabels,
                sourcePath: placeholder.sourcePath,
                status: placeholder.status,
                altText: placeholder.altText,
              }))
          : undefined;

      const lessonPayload: GeneratedLessonPayload = {
        moduleSlug: track.moduleSlug,
        moduleTitle: track.publicTitle,
        moduleBaseRoute: track.baseRoute,
        moduleFlags: releaseInfo.flags,
        trackType: track.trackType,
        catalogGroup: track.catalogGroup,
        lessonSlug: lesson.lessonSlug,
        title,
        summary,
        bodyHtml,
        learningOutcomes,
        quizItems,
        disclosures: buildDisclosures(
          track.moduleSlug,
          disclosureRegistry,
          freshness,
        ),
        flags: releaseInfo.flags,
        freshness,
        complianceChecklist: Array.from(complianceChecklistMap.entries()).map(
          ([key, entry]) => ({
            key,
            type: entry.type,
            value: entry.value,
          }),
        ),
        openQuestions,
        sources,
        previousLesson,
        nextLesson,
        sidebarLessons,
        screenshotPlaceholders,
      };

      lessonPayloads.push(lessonPayload);
      totalLessons += 1;
      totalQuizItems += lessonPayload.quizItems.length;

      const lessonFileName = `${track.moduleSlug}__${lesson.lessonSlug}.json`;
      const relativeLessonFile = path.join("lessons", lessonFileName);
      lessonIndex[lessonKey(track.moduleSlug, lesson.lessonSlug)] = {
        file: relativeLessonFile,
        moduleSlug: track.moduleSlug,
        lessonSlug: lesson.lessonSlug,
        trackType: track.trackType,
      };
      await writeJson(
        path.join(GENERATED_CONTENT_ROOT, relativeLessonFile),
        lessonPayload,
      );
    }

    const moduleLessons: GeneratedLessonSummary[] = lessonPayloads.map((lessonPayload) => ({
      lessonSlug: lessonPayload.lessonSlug,
      title: lessonPayload.title,
      summary: lessonPayload.summary,
      href: lessonHref(track, lessonPayload.lessonSlug),
    }));

    const moduleFreshness = lessonPayloads[0]?.freshness ?? null;
    const modulePayload: GeneratedModulePayload = {
      moduleSlug: track.moduleSlug,
      trackType: track.trackType,
      catalogGroup: track.catalogGroup,
      publicTitle: track.publicTitle,
      cardSummary: track.cardSummary,
      status: releaseInfo.status,
      flags: releaseInfo.flags,
      baseRoute: track.baseRoute,
      lessonCount: lessonPayloads.length,
      quizItemCount: lessonPayloads.reduce(
        (count, lessonPayload) => count + lessonPayload.quizItems.length,
        0,
      ),
      disclosures: buildDisclosures(
        track.moduleSlug,
        disclosureRegistry,
        moduleFreshness,
      ),
      lessons: moduleLessons,
    };

    modulePayloads.push(modulePayload);

    const relativeModuleFile = path.join("modules", `${track.moduleSlug}.json`);
    moduleIndex[track.moduleSlug] = {
      file: relativeModuleFile,
      trackType: track.trackType,
      catalogGroup: track.catalogGroup,
    };
    await writeJson(
      path.join(GENERATED_CONTENT_ROOT, relativeModuleFile),
      modulePayload,
    );
  }

  const core = modulePayloads
    .filter((payload) => payload.catalogGroup === "core")
    .map(createCatalogCard);
  const optionalExtensions = modulePayloads
    .filter((payload) => payload.catalogGroup === "optionalExtensions")
    .map(createCatalogCard);
  const platformGuidePayload = modulePayloads.find(
    (payload) => payload.catalogGroup === "platformGuide",
  );

  if (!platformGuidePayload) {
    throw new Error("Platform guide payload was not generated.");
  }

  const catalog: GeneratedCatalog = {
    generatedOn: new Date().toISOString(),
    totals: {
      tracks: modulePayloads.length,
      educationTracks: core.length + optionalExtensions.length,
      lessons: totalLessons,
      quizItems: totalQuizItems,
    },
    core,
    optionalExtensions,
    platformGuide: createCatalogCard(platformGuidePayload),
    legacyModules: modulePayloads
      .filter((payload) => payload.trackType !== "platformGuide")
      .map((payload) => ({
        slug: payload.moduleSlug,
        title: payload.publicTitle,
        description: payload.cardSummary,
        category: moduleSummaryCategory({
          moduleSlug: payload.moduleSlug,
          trackType: payload.trackType,
          catalogGroup: payload.catalogGroup,
          publicTitle: payload.publicTitle,
          cardSummary: payload.cardSummary,
          status: payload.status,
          flags: payload.flags,
          baseRoute: payload.baseRoute,
          lessons: [],
        }),
        level: "Beginner" as const,
        url: payload.baseRoute,
      })),
  };

  await Promise.all([
    writeJson(path.join(GENERATED_CONTENT_ROOT, "catalog.json"), catalog),
    writeJson(path.join(GENERATED_CONTENT_ROOT, "module-index.json"), {
      generatedOn: catalog.generatedOn,
      modules: moduleIndex,
    }),
    writeJson(path.join(GENERATED_CONTENT_ROOT, "lesson-index.json"), {
      generatedOn: catalog.generatedOn,
      lessons: lessonIndex,
    }),
  ]);

  console.log(
    `Generated ${modulePayloads.length} tracks, ${totalLessons} lessons, and ${totalQuizItems} quiz items.`,
  );
}

main().catch((error) => {
  console.error("Failed to sync education content.");
  console.error(error);
  process.exit(1);
});
