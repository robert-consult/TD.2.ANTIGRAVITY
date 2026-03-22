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
- The standard local operator path is `~/.config/tradequip/android-signing/key.properties` with the keystore in the same directory.
- Android release signing will use that default location automatically, or you can override it with `TRADEQUIP_ANDROID_KEY_PROPERTIES` or Gradle property `tradequipAndroidKeyPropertiesPath`.
- Keep the external signing directory `0700` and populated files `0600`.
- Use `key.properties.example` only as a template; do not place populated signing files under `MOBILE/android/`.
- Keep cleartext exceptions limited to local debug workflows.
