function loadStoreModule() {
  let storeModule: typeof import("../src/i18n/store");
  jest.isolateModules(() => {
    storeModule = require("../src/i18n/store");
  });
  return storeModule!;
}

describe("native i18n store", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("persists locale, config, and cached bundles", () => {
    const {
      FALLBACK_CONFIG,
      getCachedBundle,
      getI18nState,
      setI18nBundle,
      setI18nConfig,
      setI18nLocale,
      t,
    } = loadStoreModule();

    expect(getI18nState().locale).toBeTruthy();
    expect(FALLBACK_CONFIG.supportedLocales).toContain("en");

    setI18nLocale("fr");
    setI18nConfig({
      enabled: true,
      defaultLocale: "en",
      supportedLocales: ["en", "fr"],
    });
    setI18nBundle({
      locale: "fr",
      strings: {
        greeting: "Bonjour",
      },
      etag: "bundle-fr-1",
    });

    expect(getI18nState().locale).toBe("fr");
    expect(getI18nState().config).toEqual({
      enabled: true,
      defaultLocale: "en",
      supportedLocales: ["en", "fr"],
    });
    expect(getCachedBundle("fr")).toEqual({
      locale: "fr",
      strings: {
        greeting: "Bonjour",
      },
      etag: "bundle-fr-1",
    });
    expect(t("greeting", "fallback")).toBe("Bonjour");
    expect(t("missing.key", "fallback")).toBe("fallback");
  });

  it("detects rtl locales using the base language tag", () => {
    const { isRtlLocale } = loadStoreModule();

    expect(isRtlLocale("ar-EG")).toBe(true);
    expect(isRtlLocale("he-IL")).toBe(true);
    expect(isRtlLocale("en-US")).toBe(false);
  });
});
