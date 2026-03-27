# Adding an API Endpoint

> **Diátaxis quadrant:** How-To Guide
> **Sources:** `PROJECT_STRUCTURE.md` §Adding a New API Endpoint, `server/routes/AGENTS.md`

---

## Steps

### 1. Define Shared Types

Add Zod schemas and TypeScript types in `shared/`:

```ts
// shared/myFeature.ts
import { z } from "zod";
export const myFeatureSchema = z.object({ name: z.string() });
export type MyFeature = z.infer<typeof myFeatureSchema>;
```

### 2. Create the Route Module

Create a new router file in `server/routes/`:

```ts
// server/routes/myFeature.ts
import { Router } from "express";
import { myFeatureSchema } from "@shared/myFeature";

export const myFeatureRouter = Router();

myFeatureRouter.get("/api/my-feature", async (req, res) => {
  // ... handler
});

myFeatureRouter.post("/api/my-feature", async (req, res) => {
  const parsed = myFeatureSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_PAYLOAD" });
  // ... handler
});
```

### 3. Register the Router

Import and mount in `server/routes.ts`:

```ts
import { myFeatureRouter } from "./routes/myFeature";
app.use(myFeatureRouter);
```

### 4. Add Service Logic (if needed)

Place business logic in `server/services/` rather than in route handlers.

### 5. Apply Middleware

- **Auth-protected:** Wrap with authentication middleware
- **Admin-only:** Use `requireAdmin` middleware
- **Policy-gated:** Use `requirePolicy()` for trading actions
- **Rate-limited:** Add rate limiting for public endpoints

### 6. Verify

```bash
npm run check
npm run build
npm run e2e        # If changing trading/auth/WS flows
npm run db:audit   # If touching DB schema
```

---

## API Contract Rules

> From `server/routes/AGENTS.md`:

- Validate all inputs with Zod — never trust client data
- Parameterize all DB queries — no string interpolation
- Do not leak PII in responses or logs
- Preserve correlation IDs in audit writes

---

## Related Pages

- [Server Backend →](../02_Architecture_Reference/02_Server_Backend.md)
- [Adding a Database Table →](02_Adding_Database_Table.md)
- [Adding a Web Screen →](00_Adding_Web_Screen.md)
- [Definition of Done →](07_Definition_of_Done.md)
