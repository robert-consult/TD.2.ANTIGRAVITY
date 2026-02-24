import { beforeEach, describe, expect, it } from "vitest";
import {
  readStoredLocale,
  readStoredLocaleForUser,
  shouldApplyStoredUserLocaleOverride,
  shouldPreferStoredUserLocale,
  writeStoredLocale,
  writeStoredLocaleForUser,
} from "@/i18n/localeStorage";

describe("localeStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores global and account-scoped locales independently", () => {
    writeStoredLocale("pt");
    writeStoredLocaleForUser(101, "pt");
    writeStoredLocaleForUser(202, "en");

    expect(readStoredLocale()).toBe("pt");
    expect(readStoredLocaleForUser(101)).toBe("pt");
    expect(readStoredLocaleForUser(202)).toBe("en");
  });

  it("ignores invalid account ids when reading account-scoped locales", () => {
    writeStoredLocaleForUser(101, "pt");

    expect(readStoredLocaleForUser(0)).toBeNull();
    expect(readStoredLocaleForUser(-1)).toBeNull();
    expect(readStoredLocaleForUser("")).toBeNull();
  });

  it("only prefers stored locale when server locale is default or missing", () => {
    expect(shouldPreferStoredUserLocale("en", "pt", "en")).toBe(true);
    expect(shouldPreferStoredUserLocale(undefined, "pt", "en")).toBe(true);
    expect(shouldPreferStoredUserLocale("pt", "en", "en")).toBe(false);
    expect(shouldPreferStoredUserLocale("en", "", "en")).toBe(false);
  });

  it("does not override when current locale already matches server locale", () => {
    expect(shouldApplyStoredUserLocaleOverride("en", "es", "en", "en")).toBe(false);
    expect(shouldApplyStoredUserLocaleOverride("en", "es", "en", "es")).toBe(true);
    expect(shouldApplyStoredUserLocaleOverride(undefined, "es", "en", "es")).toBe(true);
  });
});
