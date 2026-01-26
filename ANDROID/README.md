# TradeQuip ANDROID - Native Trading App

A fully responsive Android-native trading application built with React Native, featuring the TradeQuip premium dark glassmorphism theme.

## Features

- **Authentication**: Sign In, Sign Up with phone verification and social login
- **Dashboard**: Portfolio overview with real-time P&L
- **Quotes**: Live market quotes with Bid/Ask prices
- **Charts**: Candlestick charts with timeframe selection
- **Trade Execution**: Order form with Buy/Sell, Limit/Market orders
- **History**: Trade history with P&L tracking
- **Account**: Settings, security, and profile management
- **Leaderboard**: Top traders with copy trading

## Tech Stack

- **React Native** 0.73.x
- **TypeScript**
- **React Navigation** (Stack + Bottom Tabs)
- **React Query** (Data fetching & caching)
- **Zustand** (State management)
- **React Native Reanimated** (Animations)
- **React Native Linear Gradient** (Glassmorphism effects)
- **Zod + React Hook Form** (Form validation)

## Project Structure

```
ANDROID/
├── src/
│   ├── components/       # Reusable UI components
│   │   ├── cards/        # Card components (GlassCard, etc.)
│   │   ├── Button.tsx
│   │   └── Input.tsx
│   ├── navigation/       # Navigation configuration
│   ├── screens/          # Screen components
│   │   ├── auth/         # Sign In, Sign Up
│   │   └── main/         # Dashboard, Quotes, Charts, etc.
│   ├── hooks/            # Custom React hooks
│   ├── services/         # API services
│   ├── theme/            # Design tokens (colors, typography)
│   └── App.tsx           # Entry point
├── package.json
├── tsconfig.json
└── babel.config.js
```

## Getting Started

### Prerequisites

- Node.js >= 18
- Java JDK 17
- Android Studio with SDK 34
- React Native CLI

### Installation

```bash
cd ANDROID
npm install

# iOS (Mac only)
cd ios && pod install && cd ..

# Start Metro bundler
npm start

# Run on Android
npm run android
```

## Theme Tokens

The app uses a consistent design system based on TradeQuip mockups:

| Token | Value | Usage |
|-------|-------|-------|
| bgPrimary | `#050914` | Main background |
| bgSecondary | `#0e1a35` | Secondary background |
| accent | `#00E5FF` | Primary cyan accent |
| success | `#00E676` | Profit/Buy indicators |
| error | `#FF5252` | Loss/Sell indicators |

## API Integration

The app is pre-configured to connect to the TradeQuip backend:

- `/api/login` - Authentication
- `/api/quotes` - Real-time quotes
- `/api/trades/execute` - Order execution
- `/api/trades/history` - Trade history

WebSocket support is included for real-time price updates.

## Build for Production

```bash
# Generate release APK
cd android
./gradlew assembleRelease

# Output: android/app/build/outputs/apk/release/app-release.apk
```

## License

Proprietary - TradeQuip
