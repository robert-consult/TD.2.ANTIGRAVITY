# Adding a Web Screen

> **Diátaxis quadrant:** How-To Guide
> **Sources:** `PROJECT_STRUCTURE.md` §Adding a New Screen, `client/AGENTS.md`

---

## Steps

### 1. Create the Page Component

Create a new file in `client/src/pages/`:

```tsx
// client/src/pages/MyNewPage.tsx
export default function MyNewPage() {
  return <div>My New Page</div>;
}
```

### 2. Register the Route

Add the route in `client/src/App.tsx` inside `AppRoutes`:

```tsx
<Route path="/my-new-page" component={lazy(() => import("./pages/MyNewPage"))} />
```

Wrap in the `AuthenticatedShell` if the page requires authentication.

### 3. Create Data Hooks (if needed)

Add hooks in `client/src/hooks/` using TanStack React Query:

```tsx
// client/src/hooks/use-my-data.ts
export function useMyData() {
  return useQuery({
    queryKey: ["/api/my-data"],
    queryFn: () => fetchWithIdentity("/api/my-data").then(r => r.json()),
  });
}
```

### 4. Add Components

Place new components in `client/src/components/`. Use shadcn/ui primitives from `client/src/components/ui/`.

### 5. Verify

```bash
npm run check    # TypeScript
npm run build    # Production build
npm run e2e      # If changing trading/auth/WS flows
```

---

## Related Pages

- [Client Frontend →](../02_Architecture_Reference/01_Client_Frontend.md)
- [Adding an API Endpoint →](01_Adding_API_Endpoint.md)
- [Definition of Done →](07_Definition_of_Done.md)
