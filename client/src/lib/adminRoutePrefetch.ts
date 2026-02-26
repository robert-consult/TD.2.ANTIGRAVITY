let adminDashboardPrefetchPromise: Promise<unknown> | null = null;

export function preloadAdminDashboardRoute(): Promise<unknown> {
  if (adminDashboardPrefetchPromise) {
    return adminDashboardPrefetchPromise;
  }

  adminDashboardPrefetchPromise = import("@/pages/AdminDashboard").catch((error) => {
    adminDashboardPrefetchPromise = null;
    throw error;
  });

  return adminDashboardPrefetchPromise;
}
