type Listener = () => void;

export type I18nBundle = {
  locale: string;
  etag?: string;
  strings: Record<string, string>;
};

export type I18nConfig = {
  enabled: boolean;
  defaultLocale: string;
  supportedLocales: string[];
};

type I18nState = {
  locale: string;
  bundle: I18nBundle | null;
  config: I18nConfig | null;
  version: number;
};

let state: I18nState = {
  locale: "en",
  bundle: null,
  config: null,
  version: 0,
};

const listeners = new Set<Listener>();

export function getI18nState(): I18nState {
  return state;
}

export function subscribeI18n(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setI18nLocale(locale: string) {
  if (!locale) return;
  if (state.locale === locale) return;
  state = { ...state, locale };
  for (const l of listeners) l();
}

export function setI18nBundle(bundle: I18nBundle | null) {
  state = { ...state, bundle, version: state.version + 1 };
  for (const l of listeners) l();
}

export function setI18nConfig(config: I18nConfig | null) {
  state = { ...state, config };
  for (const l of listeners) l();
}

