export interface TimezoneInfo {
  name: string;
  countryCode: string;
  countryName: string;
  alternativeName: string;
  mainCities: string[];
  rawOffsetInMinutes: number;
  abbreviation: string;
  rawFormat: string;
  label: string;
  currentOffsetMinutes: number;
}

export interface LanguageInfo {
  code: string;
  name: string;
  nativeName: string;
  rtl?: boolean;
}
