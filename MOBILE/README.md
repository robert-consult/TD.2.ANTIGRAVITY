# TradeQuip Mobile (Capacitor Android App)

This directory contains the Capacitor-based Android mobile application for TradeQuip trading platform.

## Architecture

The mobile app uses **Remote URL Mode** - it wraps the existing web application rather than bundling static assets. This ensures:
- Single codebase for web and mobile UI
- Cookie-based session authentication works seamlessly
- Real-time WebSocket quotes function identically
- All trading functionality maintained

## Prerequisites

- **Node.js 18+**
- **JDK 17+** (for Android builds)
- **Android Studio** with SDK 34+
- **Android Emulator** or physical device

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Ensure backend is running
# From main repo: npm run dev

# 3. Sync Capacitor (builds web app and syncs to Android)
npm run sync

# 4. Open in Android Studio
npm run open:android

# 5. Or run directly on connected device/emulator
npm run run:android
```

## Environment Variables

Set `CAPACITOR_SERVER_URL` to point to your backend:

```bash
# Development (Android Emulator → localhost)
CAPACITOR_SERVER_URL="http://10.0.2.2:5000"

# Development (Physical device → LAN IP)
CAPACITOR_SERVER_URL="http://192.168.x.x:5000"

# Production
CAPACITOR_SERVER_URL="https://your-production-domain.com"
```

## Project Structure

```
MOBILE/
├── capacitor.config.ts    # Capacitor configuration
├── package.json           # Mobile-specific dependencies
├── android/               # Generated Android project
├── src/
│   └── mobile/
│       ├── components/    # Mobile-optimized UI components
│       ├── hooks/         # Mobile-specific React hooks
│       ├── styles/        # Mobile CSS overrides
│       └── utils/         # Mobile utilities
└── resources/             # App icons, splash screens
```

## Key Differences from Web

| Feature | Web | Mobile |
|---------|-----|--------|
| Navigation | Side + Top nav | Bottom tabs |
| Touch targets | Standard | 48px minimum |
| Status bar | N/A | Native control |
| Keyboard | Browser default | Native keyboard handling |
| Deep links | URL routing | App Links |

## Building for Production

```bash
# Create release build
cd android
./gradlew assembleRelease

# Or create AAB for Play Store
./gradlew bundleRelease
```

## Security Notes

- SSL pinning is configured for production builds
- Session cookies use HttpOnly + Secure flags
- WebView is configured to prevent arbitrary URL loading
- Certificate validation is enforced

## Troubleshooting

### WebView shows blank screen
- Verify backend is running and accessible
- Check `CAPACITOR_SERVER_URL` is correct
- For emulator, use `10.0.2.2` not `localhost`

### Session not persisting
- Ensure cookies are enabled in WebView config
- Verify `COOKIE_SECURE` matches your protocol (http/https)

### Build fails
- Run `npx cap doctor` to check environment
- Ensure JDK 17+ is installed and JAVA_HOME is set
