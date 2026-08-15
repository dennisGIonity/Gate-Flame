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
 * ✅ DECIDED 2026-08-14 by Dennis: `today.ionity.gateflame`.
 *
 * Reverse-DNS of ionity.today — the product's canonical home and the primary
 * web property in Policy 986 AED. The previous value, `org.ionity.gateflame`,
 * was abandoned because `ionity.org` is NOT a domain Ionity controls, so it
 * broke the reverse-DNS contract and could in principle collide with an
 * unrelated publisher.
 *
 * ⚠ THIS IS NOW FROZEN. An Android applicationId can never be changed after
 * the first unit ships — a new id is a different app, so every deployed
 * customer would have to uninstall, reinstall and re-pair (which wipes the
 * node pairing). Changed here, in android/app/build.gradle (applicationId AND
 * namespace), in android/app/src/main/res/values/strings.xml
 * (package_name, custom_url_scheme), and the Java package was moved to
 * android/app/src/main/java/today/ionity/gateflame/MainActivity.java. All five
 * must agree; CI asserts it.
 */
const config: CapacitorConfig = {
  appId: 'today.ionity.gateflame',
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
