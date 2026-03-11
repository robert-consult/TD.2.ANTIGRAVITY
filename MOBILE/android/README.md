# Android Wrapper Notes

`MOBILE/android/` is the Android-specific Capacitor wrapper project. Keep Android wrapper work here instead of mixing shell changes into shared docs or iOS files.

## Owns
- `app/src/main/AndroidManifest.xml`
- `app/src/main/java/com/tradequip/app/MainActivity.java`
- `app/src/main/res/xml/network_security_config.xml`
- Android splash/icon resources
- Gradle config for the wrapper shell

## Does Not Own
- Trader/support UI
- Shared wrapper bridge logic in `MOBILE/src/mobile/`
- iOS wrapper settings

## Main Checks
```bash
cd MOBILE
npm run doctor
npm run build:android:release
```

## Release Notes
- Treat `key.properties` and any keystore files as operator material.
- Keep cleartext exceptions limited to local debug workflows.
