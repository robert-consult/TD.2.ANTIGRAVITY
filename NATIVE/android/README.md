# Native Android Notes

`NATIVE/android/` is the Android-native shell for the React Native app. Platform-specific manifest, Gradle, app-link, and activity work belongs here.

## Owns
- `app/src/main/AndroidManifest.xml`
- `app/src/main/java/com/tradequipnative/*`
- `app/src/main/res/xml/network_security_config.xml`
- Android resources and Gradle settings

## Does Not Own
- Shared React Native screens/hooks/services in `NATIVE/src/`
- iOS shell files

## Main Checks
```bash
cd NATIVE
npm run build:android
```

## Release Notes
- Replace `google-services.json` with the correct operator-managed environment file before release.
- Keep app-link and screenshot-protection changes documented alongside shell edits.
