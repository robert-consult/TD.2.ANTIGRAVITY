# TradeQuip Project Structure

> **Last Updated:** January 2026  
> **Purpose:** Comprehensive guide for navigating and extending the TradeQuip codebase

---

## Quick Reference

| Component | Path | Technology | Dependencies Location |
|-----------|------|------------|----------------------|
| Web Frontend | `client/` | React + Vite | `node_modules/` (root) |
| Backend API | `server/` | Express + Node | `node_modules/` (root) |
| Shared Types | `shared/` | TypeScript | `node_modules/` (root) |
| Capacitor Wrapper | `MOBILE/` | Capacitor + WebView | `MOBILE/node_modules/` |
| Native Apps | `NATIVE/` | React Native | `NATIVE/node_modules/` |
| Database | `db/` | Drizzle + SQLite | N/A |

---

## 📁 Complete Folder Structure

```
TD.2.ANTIGRAVITY/                    ← Root workspace
│
├── 🤖 AGENT GUIDANCE
│   ├── AGENTS.md                    ← Repo-wide agent router (non-negotiables)
│   ├── .agents/                     ← Agent checklists + deep-context map
│   └── security/vuln-db/            ← Repo-local vulnerability DB (YAML)
│
├── 🌐 WEB APPLICATION
│   ├── client/                      ← React frontend (Vite)
│   │   ├── src/
│   │   │   ├── components/          # UI components (shadcn/ui)
│   │   │   ├── hooks/               # React hooks (use-auth, use-trades, etc.)
│   │   │   ├── lib/                 # Utilities (queryClient, identity, etc.)
│   │   │   ├── pages/               # Route pages
│   │   │   └── live/                # WebSocket providers
│   │   └── index.html
│   │
│   ├── server/                      ← Express backend
│   │   ├── routes/                  # API endpoints (/api/auth, /api/trades, etc.)
│   │   ├── middleware/              # Auth, rate limiting, compliance
│   │   ├── services/                # Business logic
│   │   ├── lib/                     # Utilities
│   │   └── index.ts                 # Server entry point
│   │
│   └── shared/                      ← Shared TypeScript types
│       └── schema.ts                # Zod schemas, shared interfaces
│
├── 💾 DATABASE
│   ├── db/                          ← Drizzle ORM
│   │   ├── schema/                  # Table definitions
│   │   ├── migrations/              # SQL migrations
│   │   └── index.ts                 # DB connection
│   ├── trading_app.db               ← SQLite database file
│   └── sessions.db                  ← Session storage
│
├── 📱 MOBILE APPS
│   ├── MOBILE/                      ← Capacitor (WebView wrapper)
│   │   ├── android/                 # Android Gradle project
│   │   ├── docs/                    # Capacitor documentation
│   │   ├── resources/               # App icons, splash
│   │   ├── capacitor.config.ts      # Capacitor configuration
│   │   └── node_modules/            ← MOBILE-specific deps
│   │
│   └── NATIVE/                      ← React Native (true native)
│       ├── android/                 # Android Gradle project
│       ├── ios/                     # Xcode project
│       ├── src/                     # Shared RN code
│       │   ├── components/          # Native UI components
│       │   ├── screens/             # App screens
│       │   ├── hooks/               # Data hooks (aligned with web)
│       │   ├── services/            # API & WebSocket
│       │   ├── navigation/          # React Navigation
│       │   └── theme/               # Design tokens
│       └── node_modules/            ← NATIVE-specific deps
│
├── 🛠️ INFRASTRUCTURE
│   ├── k8s/                         ← Kubernetes manifests
│   ├── scripts/                     ← Build & utility scripts
│   ├── e2e/                         ← Playwright E2E tests
│   └── .github/                     ← GitHub Actions
│
├── 📄 DOCUMENTATION
│   ├── PROJECT_STRUCTURE.md         ← This file
│   ├── README.md                    ← Quick start guide
│   ├── AUDIT_REPORT.md              ← Security audit
│   ├── MIGRATION_REVIEW.md          ← DB migration docs
│   └── design_guidelines.md         ← UI/UX standards
│
├── 📦 CONFIG FILES (Root)
│   ├── package.json                 ← Root dependencies (web app)
│   ├── package-lock.json
│   ├── tsconfig.json                ← TypeScript config
│   ├── vite.config.ts               ← Vite bundler config
│   ├── tailwind.config.cjs          ← Tailwind CSS
│   ├── drizzle.config.ts            ← Database ORM config
│   └── .env                         ← Environment variables
│
└── 📁 OTHER
    ├── attached_assets/             ← Static assets, mockups
    ├── dist/                        ← Built web app (generated)
    ├── data/                        ← Static data files
    └── node_modules/                ← ROOT dependencies
```

---

## 🔧 Dependencies Management

### Root `node_modules/` (Web Application)

**Location:** `TD.2.ANTIGRAVITY/node_modules/`

**Used by:** `client/`, `server/`, `shared/`, `db/`

**Installation:**
```bash
cd TD.2.ANTIGRAVITY
npm install
```

**Adding new dependencies:**
```bash
# Production dependency
npm install <package-name>

# Dev dependency
npm install -D <package-name>
```

**Key packages:**
- `react`, `react-dom` - Frontend framework
- `express` - Backend server
- `drizzle-orm` - Database ORM
- `@tanstack/react-query` - Data fetching
- `zod` - Schema validation
- `tailwindcss` - Styling

---

### MOBILE `node_modules/` (Capacitor)

**Location:** `TD.2.ANTIGRAVITY/MOBILE/node_modules/`

**Used by:** Capacitor Android/iOS wrapper

**Installation:**
```bash
cd TD.2.ANTIGRAVITY/MOBILE
npm install
```

**Adding dependencies:**
```bash
cd MOBILE
npm install <package-name>

# After adding Capacitor plugins:
npx cap sync
```

**Key packages:**
- `@capacitor/core` - Capacitor runtime
- `@capacitor/cli` - Build tools
- `native-run` - Device deployment

---

### NATIVE `node_modules/` (React Native)

**Location:** `TD.2.ANTIGRAVITY/NATIVE/node_modules/`

**Used by:** React Native Android/iOS apps

**Installation:**
```bash
cd TD.2.ANTIGRAVITY/NATIVE
npm install

# iOS only (macOS):
cd ios && pod install
```

**Adding dependencies:**
```bash
cd NATIVE
npm install <package-name>

# If package has native code:
cd android && ./gradlew clean
cd ios && pod install
```

**Key packages:**
- `react-native` - Native framework
- `@react-navigation/*` - Navigation
- `react-native-mmkv` - Secure storage
- `zustand` - State management
- `axios` - HTTP client

---

## 📝 Best Practices for Future Additions

### Adding a New Screen (Web)

1. Create page in `client/src/pages/`
2. Add route in `client/src/App.tsx`
3. Create any needed components in `client/src/components/`

### Adding a New Screen (Native)

1. Create screen in `NATIVE/src/screens/`
2. Add to navigator in `NATIVE/src/navigation/`
3. Use existing hooks from `NATIVE/src/hooks/`

### Adding a New API Endpoint

1. Create route in `server/routes/`
2. Add business logic in `server/services/`
3. Update shared types in `shared/schema.ts`
4. Add corresponding hook in:
   - `client/src/hooks/` (web)
   - `NATIVE/src/hooks/` (native)

### Adding a Database Table

1. Define schema in `db/schema/`
2. Generate migration: `npm run db:generate`
3. Apply migration: `npm run db:migrate`

### Adding a New Mobile Feature

| Type | Where to Add |
|------|--------------|
| Capacitor plugin | `MOBILE/`, then `npx cap sync` |
| Native module | `NATIVE/android/` or `NATIVE/ios/` |
| Shared UI component | `NATIVE/src/components/` |

---

## 🚀 Build Commands

### Web Application
```bash
# Development
npm run dev

# Production build
npm run build

# Start production
npm run start
```

### MOBILE (Capacitor)
```bash
cd MOBILE

# Sync web build to native
npx cap sync android

# Build APK
./build-release.sh

# Or manually
cd android && ./gradlew assembleRelease
```

### NATIVE (React Native)
```bash
cd NATIVE

# Development
npm run android    # or: npm run ios

# Release APK
cd android && ./gradlew assembleRelease

# Release AAB (Play Store)
cd android && ./gradlew bundleRelease
```

---

## 📋 Environment Variables

**Location:** `TD.2.ANTIGRAVITY/.env`

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | SQLite/PostgreSQL connection |
| `SESSION_SECRET` | Express session encryption |
| `ADMIN_PASSWORD` | Admin access |
| `TP_*` | Trading platform configs |

**For NATIVE app:** Configure API URL in `NATIVE/src/services/api.ts`

---

## 🔄 Syncing Changes

### When Web App Changes Affect MOBILE:
```bash
npm run build              # Build web app
cd MOBILE && npx cap sync  # Sync to Capacitor
```

### When API Changes Affect NATIVE:
1. Update endpoint in `server/routes/`
2. Update hook in `NATIVE/src/hooks/`
3. Update service in `NATIVE/src/services/api.ts`

---

## 📁 Folder Creation Guidelines

When adding new folders:

1. **Use UPPERCASE** for major project modules (e.g., `NATIVE/`, `MOBILE/`)
2. **Use lowercase** for code directories (e.g., `hooks/`, `components/`)
3. **Create README.md** in new major folders
4. **Add to this document** under the appropriate section
5. **Separate node_modules** for independent build systems

---

## 🔐 Security Notes

| Folder | Contains Secrets | Git Ignored |
|--------|------------------|-------------|
| `.env` | Yes | ✅ |
| `MOBILE/android/key.properties` | Yes | ✅ |
| `*.keystore` | Yes | ✅ |
| `node_modules/` | No | ✅ |
| `dist/` | No | ✅ |

---

## 📞 Quick Reference Commands

```bash
# Start everything (development)
npm run dev

# Database operations
npm run db:generate    # Generate migrations
npm run db:migrate     # Apply migrations
npm run db:studio      # Open Drizzle Studio

# Mobile builds
cd MOBILE && ./build-release.sh     # Capacitor APK
cd NATIVE && npm run android        # React Native debug

# Tests
npm run test           # Unit tests
npm run e2e            # Playwright E2E
```
