export type TrackType = "coreCurriculum" | "optionalExtension" | "platformGuide";
export type CatalogGroup = "core" | "optionalExtensions" | "platformGuide";
export type DisclosureTone = "info" | "warning" | "danger";

export type Disclosure = {
  id: string;
  title: string;
  tone: DisclosureTone;
  body: string;
  placements: string[];
};

export type CatalogCard = {
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

export type EducationCatalog = {
  generatedOn: string;
  totals: {
    tracks: number;
    educationTracks: number;
    lessons: number;
    quizItems: number;
  };
  core: CatalogCard[];
  optionalExtensions: CatalogCard[];
  platformGuide: CatalogCard;
};

export type ModulePayload = {
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
  disclosures: Disclosure[];
  lessons: Array<{
    lessonSlug: string;
    title: string;
    summary: string;
    href: string;
  }>;
};

export type LessonQuizItem = {
  id: string;
  prompt: string;
  choices: Array<{ label: string; text: string }>;
  correctAnswer: { label: string; text: string };
  explanation: string;
  lessonAnchor: string;
};

export type LessonPayload = {
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
  quizItems: LessonQuizItem[];
  disclosures: Disclosure[];
  flags: string[];
  freshness: {
    classification: string;
    cadence?: string;
    lastVerifiedOn?: string;
    nextReviewOn?: string;
  } | null;
  sources: Array<{ label: string; url: string }>;
  previousLesson: {
    lessonSlug: string;
    title: string;
    href: string;
  } | null;
  nextLesson: {
    lessonSlug: string;
    title: string;
    href: string;
  } | null;
  sidebarLessons: Array<{
    lessonSlug: string;
    title: string;
    href: string;
  }>;
  screenshotPlaceholders?: Array<{
    placeholderId: string;
    surface: string;
    device: string;
    expectedLabels: string[];
    sourcePath: string;
    status: string;
    altText: string;
  }>;
};
