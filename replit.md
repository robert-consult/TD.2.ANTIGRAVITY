# TradeQuip - Trading Platform

## Overview
TradeQuip is a full-stack trading platform for forex, metals, and financial instruments, providing real-time quotes, charting, trade execution, and risk management. It incorporates MetaTrader-style margin calculations, detailed trade history analysis, and administrative tools for data and user management. The platform is designed to offer a robust environment for both live trading and performance analysis, with a business vision to provide a secure and comprehensive trading experience.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript (Vite)
- **UI/UX**: Tailwind CSS with shadcn/ui components, Radix UI for accessibility, mobile-first responsive design. Features include advanced toast notifications and TradingView widget integration for charting.
- **State Management**: TanStack React Query
- **Data Display**: TanStack React Table
- **Form Management**: React Hook Form with Zod validation

### Backend
- **Runtime**: Node.js with Express.js REST API
- **Database**: SQLite with Drizzle ORM
- **Authentication**: Express sessions, bcrypt, TOTP-based MFA, tiered access control (CANDIDATE → PERFORMER → SELECTED).
- **Validation**: Zod schemas
- **Background Tasks**: Node-cron for automated jobs.
- **Core Logic**: Custom MetaTrader-style margin calculation engine.
- **Audit System**: Institutional-grade OATS-compliant, SHA-256 hash-chained tamper-evident logging for all significant trading, identity, and admin events.
- **Policy Decision Framework**: Pure functions for tier-based action gating, enforced via Express middleware.
- **Security**: Geo-enriched session tracking, multi-account abuse detection (Grift Detection System) with point-based risk scoring, impossible travel detection, and a comprehensive signal management system for grift investigation.

### Data Storage
- **Primary**: SQLite (better-sqlite3 driver)
- **Schema**: Drizzle ORM (TypeScript-first)
- **Key Entities**: Users, Trades, Symbols, User Settings, Quote data, Trader Journal, Admin Actions, Tier Progression, Email & MFA tokens, KYC/Payout profiles, Identity Audit, and Grift-related tables (identity links, alerts, user risk, linked accounts, signals, cases, observations, admin actions).

### Core Features
- **Trader Journal**: CRUD operations for notes, mood tracking, tagging, and multi-trade linking.
- **Trader Insights**: Analytics on closed trades (P/L by instrument, direction, optimal trading hours/holding times).
- **Admin Impersonation**: Admins can view the platform as another user for support, with audit logging.
- **Close Reason Taxonomy**: Standardized, audit-compliant close reason codes for positions/orders, integrated across backend and frontend.
- **Legal Compliance System**: Hedge-fund-grade jurisdiction-aware legal document assembly with:
  - **Document Precedence**: COUNTRY/{ISO2} > REGION/{regionKey} > DEFAULT/ROW
  - **Coverage Gate**: Signup blocking for jurisdictions without active terms (enforcement toggle)
  - **HMAC-Signed Terms Tokens**: Full HMAC-SHA256 signatures with base64url encoding, 24h expiry
  - **Hash-Chained Acceptances**: SHA-256 tamper-evident ledger for legal acceptance audit
  - **Mandatory Terms Acceptance**: Backend-enforced requirement for all registrations
  - **CAPTCHA Integration**: Cloudflare Turnstile and hCaptcha support with server-side validation
  - **Bootstrap System**: Runtime schema creation + default GLOBAL_MASTER terms seeding on startup
  - **Admin Tools**: Document lifecycle management, acceptance validation, coverage stats
  - **Region Mapping**: EU, LATAM, MENA, APAC, SSA, OCEANIA, NA regions with 200+ country mappings
  - **DB-First Architecture**: 
    - `legalDocuments` - Versioned document storage with SHA-256 content hashing
    - `legalDocPointers` - Active document pointers for zero-downtime updates
    - `legalDocChangeAudit` - Hash-chained tamper-evident audit trail
    - `legalAcceptances` - User acceptance ledger with chain validation
  - **Signup Flow**: Country selection → Terms resolution → Scroll-to-end terms modal → CAPTCHA (if enabled) → Mandatory terms token validation → User creation with country/region → Legal acceptance recording
  - **Key Files**:
    - `server/security/captcha.ts` - CAPTCHA verification (Turnstile/hCaptcha)
    - `server/legal/cryptoUtils.ts` - Token generation/verification
    - `server/legal/legalAcceptanceService.ts` - Ledger insertion with hash-chaining
    - `server/legal/bootstrapDoc1Seed.ts` - Default terms seeding
    - `client/src/components/CaptchaTurnstile.tsx` - Frontend CAPTCHA widget
  - **Admin API Routes** (Dec 2025):
    - `/api/admin/legal-docs-v2/*` - DB-first document management (targets, versions, replace-active, set-active, preview-assemble)
    - `/api/admin/legal-acceptances/*` - Acceptance list, detail, chain validation, CSV export
    - `/api/legal/public-config` - Frontend policy config (captcha enforcement, provider)
  - **Frontend Components**: AdminLegalDocs.tsx (target selector, version history, editor) and AdminLegalAcceptances.tsx (filtered list, detail modal, ledger validation) integrated into AdminLegalPanel

## External Dependencies

### Trading Data
- **1Forge API**: Real-time forex quotes and historical data.
- **TradingView**: Professional charting widgets.

### Development Tools
- **Vite**: Frontend bundling and development server.
- **esbuild**: Backend compilation.

### Database & ORM
- **Drizzle Kit**: Database migrations.
- **Better SQLite3**: High-performance SQLite driver.

### Security
- **Speakeasy**: TOTP-based 2FA.
- **Node-cron**: For scheduled tasks.
- **geoip-lite**: IP to location mapping.
- **@photostructure/tz-lookup**: Latitude/longitude to timezone conversion.
- **UAParser**: Device information parsing.
- **@vvo/tzdb**: Timezone database for meta endpoints.

## Pending Setup (Before Deployment)

### SMS Verification (Twilio) - REQUIRED FOR PRODUCTION
The following secrets need to be added before deploying:
- **TWILIO_ACCOUNT_SID** - Your Twilio Account SID
- **TWILIO_AUTH_TOKEN** - Your Twilio Auth Token  
- **TWILIO_FROM_NUMBER** - Your Twilio phone number (format: +1234567890)

### Email Verification (Resend) - REQUIRED FOR PRODUCTION
- **RESEND_API_KEY** - Your Resend API key for sending verification emails

### Security Notes (Jan 2026)
- Moved hardcoded API keys from `.replit` file to Replit Secrets (FORGE_API_KEY, FORGE_KEY, EMAIL_VERIFY_TOKEN_SECRET)
- **ACTION NEEDED**: Manually remove the hardcoded values from `.replit` file (lines 44-48 in `[userenv.shared]` section) to complete the security fix
- LEGAL_TERMS_HMAC_SECRET has been configured as a secret
