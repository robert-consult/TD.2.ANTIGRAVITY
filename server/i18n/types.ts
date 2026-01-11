export type I18nConfig = {
  enabled: boolean;
  defaultLocale: string;
  supportedLocales: string[];
  autoTranslate: boolean;
  llmEnabled: boolean;
  llmProvider: string;
  llmModel: string;
  llmMaxBatchSize: number;
  llmMaxAttempts: number;
};

export type I18nManifestEntry = {
  id: string;
  defaultText: string;
  file: string;
  line?: number;
  column?: number;
  kind: "JSXText" | "JSXAttr" | "ObjectProp" | "JSXExpr";
  propName?: string;
};

export type I18nManifestFile = {
  schema: number;
  generatedAt: number;
  version: string;
  entries: I18nManifestEntry[];
};

export type I18nBundle = {
  locale: string;
  strings: Record<string, string>;
};
