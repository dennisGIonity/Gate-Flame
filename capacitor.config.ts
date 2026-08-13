import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Gate^Flame — single source of truth for the Capacitor Android build.
 *
 * There is exactly ONE Android artifact: the customer's mobile companion app.
 *
 * The device kiosk is NOT an Android app. It runs as Chromium in --kiosk mode
 * inside the `gateflame-display-kiosk` container on Raspberry Pi OS / Armbian,
 * pointed at KIOSK_URL=http://localhost:8080/device-kiosk. It is built by
 * `npm run build:html-kiosk` and served by the node — it is never packaged as
 * an APK, because the Pi does not run Android.
 *
 * Do not reintroduce capacitor.config.json / capacitor.kiosk.config.json.
 * @capacitor/cli resolves .ts BEFORE .json, so a .json sitting alongside this
 * file is silently ignored — which previously made `build:apk-kiosk` a no-op
 * and gave both "variants" the same package name.
 *
 * versionCode / versionName are NOT set here. They live in
 * android/version.properties, which is the only place they are defined.
 */
/**
 * appId MUST equal `applicationId` in android/app/build.gradle.
 *
 * `org.ionity.gateflame` is chosen because the whole Android side already uses
 * it — the Gradle namespace, the applicationId, and the on-disk Java package
 * android/app/src/main/java/org/ionity/gateflame/MainActivity.java. The three
 * `com.gateflame.*` values in the deleted JSON configs were the outliers.
 *
 * ⚠ DECIDE BEFORE THE FIRST UNIT SHIPS. An Android applicationId can never be
 * changed afterwards — a new id is a different app, so every deployed customer
 * would have to uninstall, reinstall and re-pair. Reverse-DNS convention says
 * this should be a domain Ionity actually controls; ionity.org is not one of
 * them. If you want `today.ionity.gateflame` or `za.co.ionity.gateflame`
 * instead, change it here, in build.gradle, and move the Java package — now,
 * while it costs nothing.
 */
const config: CapacitorConfig = {
  appId: 'org.ionity.gateflame',
  appName: 'Gate^Flame',
  webDir: 'dist-mobile',
  android: {
    // The node is reached over plain HTTP on the LAN (RFC1918 only).
    // Scoped in android/app/src/main/res/xml/network_security_config.xml —
    // NOT via a blanket allowMixedContent, which would permit cleartext to
    // any host on the internet.
    allowMixedContent: false,
    captureInput: true,
  },
};

export default config;
