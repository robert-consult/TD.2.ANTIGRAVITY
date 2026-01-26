# TradeQuip NATIVE - Native Trading App (Android + iOS)

A fully native Android trading application built with React Native, featuring the TradeQuip premium dark glassmorphism theme with real API integration.

## Architecture

```
ANDROID/                     ← Source code (this folder)
├── src/
│   ├── components/          # Reusable UI components
│   ├── hooks/               # React Query + WebSocket hooks
│   ├── navigation/          # Tab navigator
│   ├── screens/             # All app screens
│   ├── services/            # API & WebSocket services
│   └── theme/               # Design tokens
└── init-native.sh           # Setup script

ANDROID_NATIVE/              ← Generated RN project (after running init-native.sh)
├── android/                 # Android build files
├── ios/                     # iOS build files
└── src/                     # Copied from ANDROID/src
```

## Features

| Screen | API Integration |
|--------|----------------|
| **Sign In** | `POST /api/auth/login` with identity headers |
| **Sign Up** | `POST /api/auth/register` with bot-proof |
| **Dashboard** | Account summary + open positions |
| **Quotes** | Live prices via WebSocket |
| **Charts** | Symbol data + OHLC |
| **Trade** | Order execution with margin check |
| **History** | Positions, Pending, Closed trades |
| **Account** | User profile + settings |

## API Alignment

The native app uses the **same API endpoints** as the web app:

```typescript
// Authentication
POST /api/auth/login
POST /api/auth/register
POST /api/auth/logout
GET  /api/auth/current-user

// Trading
GET  /api/trades           # All trades (history)
GET  /api/trades/open      # Open positions
GET  /api/trades/pending   # Pending orders
POST /api/trades           # Create trade
POST /api/trades/:id/close # Close position

// Quotes & Symbols
GET  /api/config/symbols
GET  /api/quotes

// Account
GET  /api/account/summary
```

### Security Features

- **Identity Headers**: Device ID, fingerprint, platform
- **Bot-Proof Challenge**: 428 response handling
- **Secure Storage**: MMKV for tokens
- **WebSocket Auth**: Token in connection URL

## Quick Start

### 1. Initialize React Native Project

```bash
cd /home/bcodex/TD.2.ANTIGRAVITY/ANDROID
chmod +x init-native.sh
./init-native.sh
```

This will:
- Check prerequisites (Node, Java, Android SDK)
- Create React Native project at `ANDROID_NATIVE/`
- Copy all source files
- Install all dependencies

### 2. Configure API URL

Edit `ANDROID_NATIVE/src/services/api.ts`:

```typescript
const API_BASE_URL = __DEV__
  ? 'http://localhost:5000'  // Development
  : 'https://your-production-domain.com';  // Production
```

### 3. Run Development Build

```bash
cd /home/bcodex/TD.2.ANTIGRAVITY/ANDROID_NATIVE

# Start Metro bundler
npm start

# In another terminal, run on Android
npm run android

# Or with adb port forwarding for local API:
adb reverse tcp:5000 tcp:5000
npm run android
```

### 4. Build Release APK

```bash
cd /home/bcodex/TD.2.ANTIGRAVITY/ANDROID_NATIVE/android

# Generate release APK
./gradlew assembleRelease

# Output: app/build/outputs/apk/release/app-release.apk
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@react-navigation/*` | Tab + Stack navigation |
| `@tanstack/react-query` | Data fetching & caching |
| `zustand` | Auth state management |
| `react-native-mmkv` | Secure token storage |
| `react-native-reanimated` | Smooth animations |
| `react-native-linear-gradient` | Glassmorphism effects |
| `axios` | HTTP client with interceptors |
| `zod` + `react-hook-form` | Form validation |

## Theme Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `bgPrimary` | `#050914` | Main background |
| `bgSecondary` | `#0e1a35` | Secondary background |
| `accent` | `#00E5FF` | Primary cyan accent |
| `success` | `#00E676` | Profit/Buy indicators |
| `error` | `#FF5252` | Loss/Sell indicators |

## Screens Preview

| Dashboard | Trade | Quotes |
|-----------|-------|--------|
| Portfolio stats | Order form | Live prices |
| P&L display | Buy/Sell FABs | Bid/Ask buttons |
| Positions list | Margin check | Search/filter |

## File Structure

```
src/
├── App.tsx                 # Entry point with auth flow
├── components/
│   ├── Button.tsx          # Styled button variants
│   ├── Input.tsx           # Form input with validation
│   └── cards/GlassCard.tsx # Glassmorphism container
├── hooks/
│   ├── useAuth.ts          # Authentication state
│   ├── useTrades.ts        # Trade operations
│   ├── useQuotes.ts        # Live quotes
│   └── useAccountSummary.ts # Portfolio data
├── navigation/
│   └── MainTabNavigator.tsx # Bottom tab bar
├── screens/
│   ├── auth/
│   │   ├── SignInScreen.tsx
│   │   └── SignUpScreen.tsx
│   └── main/
│       ├── DashboardScreen.tsx
│       ├── QuotesScreen.tsx
│       ├── ChartsScreen.tsx
│       ├── TradeScreen.tsx
│       ├── HistoryScreen.tsx
│       └── AccountScreen.tsx
├── services/
│   ├── api.ts              # Axios with interceptors
│   └── websocket.ts        # WS client with reconnect
└── theme/
    ├── colors.ts
    ├── typography.ts
    └── spacing.ts
```

## iOS Support

The same codebase supports iOS. After running `init-native.sh`:

```bash
cd ANDROID_NATIVE
npx pod-install  # Install iOS dependencies
npm run ios
```

## License

Proprietary - TradeQuip
