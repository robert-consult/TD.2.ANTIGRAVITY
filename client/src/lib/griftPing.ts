import { resolveApiUrl } from "./appUrl";
import { fetchWithIdentity } from "./fetchWithIdentity";

type GriftPingOptions = {
  intervalMs?: number;
};

export function startGriftPing(options?: GriftPingOptions) {
  const intervalMs = Math.max(30_000, Math.min(5 * 60_000, options?.intervalMs ?? 60_000));
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const send = async () => {
    try {
      await fetchWithIdentity(resolveApiUrl("/api/grift/ping"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
    } catch {
      // Ignore ping failures to avoid impacting app flow
    }
  };

  const loop = async () => {
    if (stopped) return;
    await send();
    if (stopped) return;
    timer = setTimeout(loop, intervalMs);
  };

  loop();

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
}
