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
    /**
     * MUST stay true. This was `false` from 2026-08-14 to 2026-08-18, and in
     * that window the app could not reach a node at all — every request died
     * inside the WebView before a socket was opened:
     *
     *   Mixed Content: The page at 'https://localhost/' was loaded over HTTPS,
     *   but requested an insecure resource 'http://192.168.0.13:8080/...'.
     *   This request has been blocked.
     *
     * The comment that used to sit here claimed network_security_config.xml
     * scoped this more narrowly. That was a category error, and it survived
     * review because both things say "cleartext":
     *
     *   - network_security_config governs the PLATFORM's policy — may this app
     *     open an http:// socket at all.
     *   - mixed-content mode governs the WEBVIEW's policy — may a page that
     *     was itself loaded over https:// fetch an http:// subresource.
     *
     * Capacitor serves the app from https://localhost, so every node call is
     * by definition a mixed-content request. No network security config can
     * permit that; only WebSettings.setMixedContentMode can, which is what
     * this flag sets. Setting it false did not narrow the policy — it removed
     * the product's only function.
     *
     * What actually keeps this narrow, given that Android's own config cannot
     * express "RFC1918 only" (see the note in network_security_config.xml on
     * <domain> being a hostname match with no CIDR support):
     *
     *   1. assertPrivateHost() in src/services/apiClient.ts refuses any
     *      cleartext request whose host is not RFC1918, link-local, loopback
     *      or *.local. It runs on EVERY request, before the fetch, and is
     *      covered by the test suite.
     *   2. The node refuses independently: security.py gates every route on an
     *      RFC1918/loopback/link-local SOURCE address, so an off-LAN request
     *      is rejected whatever the handset believes.
     *
     * Two enforcement points, neither of which is this flag. Found by running
     * the APK against a live node, not by reading the docs.
     */
    allowMixedContent: true,
    captureInput: true,
  },
};

export default config;
