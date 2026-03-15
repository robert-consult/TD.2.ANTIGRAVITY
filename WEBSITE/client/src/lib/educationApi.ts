export const educationApi = {
  catalog: "/api/education/catalog",
  module: (moduleSlug: string) => `/api/education/modules/${moduleSlug}`,
  lesson: (moduleSlug: string, lessonSlug: string) =>
    `/api/education/lessons/${moduleSlug}/${lessonSlug}`,
  platformGuide: "/api/platform-guide",
  platformGuideLesson: (lessonSlug: string) =>
    `/api/platform-guide/lessons/${lessonSlug}`,
};
