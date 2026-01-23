# App Icons and Splash Screen Generation Guide

## Overview
This guide explains how to generate and configure app icons and splash screens for the TradeQuip Android app.

## Required Icon Sizes (Android)

| Type | Size | Density | Path |
|------|------|---------|------|
| mipmap-mdpi | 48x48 | 1x | `res/mipmap-mdpi/ic_launcher.png` |
| mipmap-hdpi | 72x72 | 1.5x | `res/mipmap-hdpi/ic_launcher.png` |
| mipmap-xhdpi | 96x96 | 2x | `res/mipmap-xhdpi/ic_launcher.png` |
| mipmap-xxhdpi | 144x144 | 3x | `res/mipmap-xxhdpi/ic_launcher.png` |
| mipmap-xxxhdpi | 192x192 | 4x | `res/mipmap-xxxhdpi/ic_launcher.png` |
| Play Store | 512x512 | - | Marketing asset |

## Adaptive Icons (Android 8+)

Create both foreground and background layers:
- `ic_launcher_foreground.png` - Logo/icon artwork
- `ic_launcher_background.png` - Solid color or gradient

## Splash Screen Configuration

Splash screen is configured in `capacitor.config.ts`:

```typescript
plugins: {
  SplashScreen: {
    launchShowDuration: 2000,
    launchAutoHide: true,
    backgroundColor: "#0a1628",  // Dark blue
    showSpinner: true,
    spinnerColor: "#3b82f6",      // Brand blue
    androidScaleType: "CENTER_CROP",
  },
}
```

## Required Splash Screen Assets

| Size | Density | Path |
|------|---------|------|
| 480x800 | mdpi | `res/drawable-mdpi/splash.png` |
| 720x1280 | hdpi | `res/drawable-hdpi/splash.png` |
| 960x1600 | xhdpi | `res/drawable-xhdpi/splash.png` |
| 1440x2560 | xxhdpi | `res/drawable-xxhdpi/splash.png` |
| 1920x3200 | xxxhdpi | `res/drawable-xxxhdpi/splash.png` |

## Quick Generation with Android Studio

1. Open Android Studio
2. Right-click `res` folder → New → Image Asset
3. Select "Launcher Icons (Adaptive and Legacy)"
4. Import your source icon (512x512 or larger)
5. Android Studio generates all sizes automatically

## Using cordova-res (CLI)

```bash
npm install -g cordova-res

# Create resources folder with source images:
# resources/icon.png (1024x1024)
# resources/splash.png (2732x2732)

cordova-res android --skip-config --copy
```

## Play Store Requirements

| Asset | Size | Format |
|-------|------|--------|
| App Icon | 512x512 | PNG (32-bit) |
| Feature Graphic | 1024x500 | PNG or JPEG |
| Screenshots | Various | PNG or JPEG |
| TV Banner (optional) | 1280x720 | PNG |

## Design Guidelines

- **Safe zone**: Keep important content within center 66% for adaptive icons
- **Background**: Use brand color #0a1628 (dark navy)
- **Accent**: Use #3b82f6 (brand blue) for highlights
- **Style**: Minimal, clean, professional fintech aesthetic
