import { useCallback, useContext, useSyncExternalStore } from "react";
import { I18nContext } from "./I18nProvider";
import { getI18nState, subscribeI18n } from "./store";

/**
 * Translate by stable id.
 *
 * The build-time auto-i18n plugin injects calls to this function.
 * If a translation is missing, we fall back to the default text.
 */
export function tr(id: string, defaultText: string): string {
  if (!id) return defaultText;
  const { bundle } = getI18nState();
  const translated = bundle?.strings?.[id];
  return translated ?? defaultText;
}

/**
 * ICU-lite placeholder replacement: "Hello {name}"
 * (intentionally simple; can be swapped for full ICU later).
 */
export function trFmt(
  id: string,
  defaultText: string,
  vars: Record<string, string | number | boolean | null | undefined>,
): string {
  const base = tr(id, defaultText);
  return base.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key: string) => {
    const v = vars?.[key];
    return v === null || v === undefined ? "" : String(v);
  });
}

export function useI18n() {
  return useContext(I18nContext);
}

/**
 * Hook that returns a reactive translation function.
 * Components using this hook will re-render when translations change.
 */
export function useTranslation() {
  const bundle = useSyncExternalStore(
    subscribeI18n,
    () => getI18nState().bundle,
    () => null
  );
  
  const t = useCallback(
    (id: string, defaultText: string) => {
      if (!id) return defaultText;
      const translated = bundle?.strings?.[id];
      return translated ?? defaultText;
    },
    [bundle]
  );
  
  const tFmt = useCallback(
    (id: string, defaultText: string, vars: Record<string, string | number | boolean | null | undefined>) => {
      const base = t(id, defaultText);
      return base.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key: string) => {
        const v = vars?.[key];
        return v === null || v === undefined ? "" : String(v);
      });
    },
    [t]
  );
  
  return { t, tFmt, bundle };
}
