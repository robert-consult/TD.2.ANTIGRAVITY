import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: any) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

export function CaptchaTurnstile(props: {
  siteKey: string;
  onToken: (token: string) => void;
  onError?: (message: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!props.siteKey) return;

    const ensureScript = () =>
      new Promise<void>((resolve, reject) => {
        if (window.turnstile) return resolve();
        const existing = document.querySelector("script[data-turnstile]");
        if (existing) {
          const t = setInterval(() => {
            if (window.turnstile) {
              clearInterval(t);
              resolve();
            }
          }, 50);
          setTimeout(() => {
            clearInterval(t);
            if (!window.turnstile) reject(new Error("TURNSTILE_LOAD_TIMEOUT"));
          }, 8000);
          return;
        }
        const s = document.createElement("script");
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
        s.async = true;
        s.defer = true;
        s.setAttribute("data-turnstile", "1");
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("TURNSTILE_LOAD_FAILED"));
        document.head.appendChild(s);
      });

    let cancelled = false;

    (async () => {
      try {
        await ensureScript();
        if (cancelled) return;
        if (!ref.current || !window.turnstile) return;

        widgetId.current = window.turnstile.render(ref.current, {
          sitekey: props.siteKey,
          callback: (token: string) => props.onToken(token),
          "error-callback": () => props.onError?.("TURNSTILE_ERROR"),
          "expired-callback": () => props.onError?.("TURNSTILE_EXPIRED"),
        });
      } catch (e: any) {
        props.onError?.(e?.message ?? "TURNSTILE_INIT_FAILED");
      }
    })();

    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile?.remove) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {}
      }
    };
  }, [props.siteKey]);

  if (!props.siteKey) return null;

  return <div ref={ref} />;
}
