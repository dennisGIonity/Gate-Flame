# Gate^Flame Android APK Build Guide
**Ionity Global (Pty) Ltd**

To compile the `gateflame_mobile_app.html` into a native Android application (`app-release.apk`), we utilize **Capacitor** by Ionic.

## Prerequisites
- Node.js (v18+)
- Android Studio with Android SDK installed
- Java JDK 17

## Build Instructions

### Step 1: Initialize Project
If you haven't initialized the mobile wrapper, run the following in your terminal:
```bash
npm install -g @capacitor/cli
npm install @capacitor/core
npm install @capacitor/android
```

### Step 2: Initialize Capacitor
```bash
npx cap init "GateFlame" "com.ionity.gateflame.app" --web-dir dist
```
*Note: Make sure your `gateflame_mobile_app.html` is inside a directory called `dist` and renamed to `index.html` for Capacitor.*

### Step 3: Add Android Platform
```bash
npx cap add android
```

### Step 4: Sync the Web Assets
Whenever you update `gateflame_mobile_app.html`, copy it into your `dist` folder as `index.html` and run:
```bash
npx cap sync android
```

### Step 5: Build in Android Studio
1. Open the project in Android Studio:
   ```bash
   npx cap open android
   ```
2. Wait for Gradle to finish syncing.
3. In the top menu, go to **Build > Generate Signed Bundle / APK**.
4. Choose **APK** and proceed.
5. Create a new Key Store path or use an existing one (e.g., `gateflame-keystore.jks`).
6. Select **release** and click **Finish**.

Your `app-release.apk` will be generated in `android/app/release/`.

You can now distribute this APK to your Android devices.
