# Internationalization (i18n)

> **Diátaxis quadrant:** How-To Guide
> **Sources:** `.agents/deep-context.md` §i18n, `server/i18n/`, `client/src/i18n/`

---

## Architecture

TradeQuip uses a **DB-backed translation pipeline**:

1. **Backend:** `server/i18n/service.ts` manages translation storage, `server/i18n/worker.ts` ingests manifest files
2. **Admin:** `server/routes/adminI18n.ts` provides CRUD for translations
3. **Client:** `client/src/i18n/` consumes translations via i18next, `client/i18n-manifest.json` declares available locales

---

## Adding a New Translation Key

1. Add the key to the default locale in the admin i18n interface
2. Provide translations for all supported locales
3. Use in client code:
   ```tsx
   const { t } = useTranslation();
   return <span>{t("my.new.key")}</span>;
   ```

---

## Migration Tools

| Script | Purpose |
|---|---|
| `scripts/i18nSqliteToPostgres.ts` | One-time: migrate SQLite i18n to PostgreSQL |
| `scripts/i18nRepairLocale.ts` | One-time: repair locale mappings |

---

## Related Pages

- [Client Frontend →](../02_Architecture_Reference/01_Client_Frontend.md)
- [Server Backend →](../02_Architecture_Reference/02_Server_Backend.md)
