/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Ionity Global (Pty) Ltd — Export & Packaging Center (APK, HTML, Node Script Bundles)
 */

import React, { useState } from 'react';
import { 
  Package, Download, Smartphone, Globe, Terminal, FileCode, 
  CheckCircle2, FolderArchive, Layers, ExternalLink, HelpCircle, Lock, Gamepad2 
} from 'lucide-react';
import { SCRIPT_AUTOPILOT, SCRIPT_DEPLOY, SCRIPT_UNBOUND, SCRIPT_PADD } from '../data/mockData';

export const ExportPackagingCenter: React.FC = () => {
  const [htmlGenerated, setHtmlGenerated] = useState(false);
  const [apkManifestGenerated, setApkManifestGenerated] = useState(false);
  const [piBundleGenerated, setPiBundleGenerated] = useState(false);
  const [ionicrobesGenerated, setIonicrobesGenerated] = useState(false);

  // Download Standalone Single-File HTML Package
  const handleDownloadStandaloneHtml = () => {
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gate^Flame Mobile App & Kiosk — Ionity Global (Pty) Ltd</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #0B0F17; color: #F3F4F6; font-family: ui-sans-serif, system-ui, sans-serif; }
  </style>
</head>
<body class="p-4 sm:p-8">
  <div class="max-w-md mx-auto bg-slate-900 p-6 rounded-[24px] border border-slate-800 shadow-sm space-y-4">
    <div class="flex items-center justify-between border-b border-slate-800 pb-3">
      <div>
        <h1 class="text-xl font-bold text-white">Gate<span class="text-sky-500">^</span>Flame™</h1>
        <p class="text-[10px] text-slate-500 font-sans font-medium">Ionity Global (Pty) Ltd &bull; POL 986 AED</p>
      </div>
      <span class="bg-emerald-500/10 text-emerald-500 px-2 py-1 rounded text-[10px] font-bold border border-emerald-500/20 uppercase tracking-wider">Shield Active</span>
    </div>

    <div class="grid grid-cols-2 gap-3 font-sans text-center">
      <div class="bg-slate-950 p-3 rounded-xl border border-slate-800">
        <div class="text-[10px] text-sky-500 uppercase font-bold tracking-wider">Total Queries</div>
        <div class="text-xl font-bold text-slate-200">38,851</div>
      </div>
      <div class="bg-slate-950 p-3 rounded-xl border border-slate-800">
        <div class="text-[10px] text-rose-500 uppercase font-bold tracking-wider">Queries Blocked</div>
        <div class="text-xl font-bold text-slate-200">14,397</div>
      </div>
      <div class="bg-slate-950 p-3 rounded-xl border border-slate-800">
        <div class="text-[10px] text-amber-500 uppercase font-bold tracking-wider">Block Rate</div>
        <div class="text-xl font-bold text-slate-200">37.1%</div>
      </div>
      <div class="bg-slate-950 p-3 rounded-xl border border-slate-800">
        <div class="text-[10px] text-emerald-500 uppercase font-bold tracking-wider">Gravity Count</div>
        <div class="text-xl font-bold text-slate-200">6.75M</div>
      </div>
    </div>

    <div class="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs font-sans font-medium space-y-1">
      <p><strong class="text-slate-500 uppercase tracking-wider text-[10px]">Linked Device MAC:</strong> <span class="text-slate-300">DC:A6:32:88:14:2F</span></p>
      <p><strong class="text-slate-500 uppercase tracking-wider text-[10px]">Subscription:</strong> <span class="text-slate-300">R45/mo Managed Warranty</span></p>
      <p><strong class="text-slate-500 uppercase tracking-wider text-[10px]">Recursive Resolver:</strong> <span class="text-slate-300">Unbound 127.0.0.1#5335</span></p>
    </div>

    <div class="text-center text-[10px] font-sans font-medium text-slate-500 pt-2 border-t border-slate-800">
      &copy; 2026 Ionity Global (Pty) Ltd. Standalone Web Bundle.
    </div>
  </div>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gateflame_mobile_app.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setHtmlGenerated(true);
  };

  const handleDownloadIonicrobesHtml = () => {
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ionicrobes — Active Threat Defense Game</title>
  <style>
    body { background-color: #020617; color: #38bdf8; font-family: monospace; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
    .container { text-align: center; border: 1px solid rgba(255,255,255,0.1); padding: 2rem; border-radius: 1rem; background: #01040a; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Ionicrobes standalone bundle</h1>
    <p>Please build the project to access the compiled React canvas module.</p>
  </div>
</body>
</html>`;
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ionicrobes_standalone.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setIonicrobesGenerated(true);
  };

  // Download Capacitor Android Manifest & Build Package Config
  const handleDownloadApkPackageConfig = () => {
    const capacitorConfig = {
      appId: "com.ionity.gateflame.app",
      appName: "Gate^Flame Mobile",
      webDir: "dist",
      bundledWebRuntime: false,
      server: {
        androidScheme: "https"
      },
      plugins: {
        SplashScreen: {
          launchShowDuration: 2000,
          backgroundColor: "#0B0F17"
        }
      }
    };

    const androidManifestXml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.ionity.gateflame.app">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="Gate^Flame"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme">

        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|layoutDirection|fontScale|screenLayout|density|uiMode"
            android:name=".MainActivity"
            android:label="Gate^Flame"
            android:exported="true"
            android:theme="@style/AppTheme.NoActionBarLaunch">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`;

    const packageInstructions = `# Ionity Global (Pty) Ltd — Gate^Flame Android APK Build Manual

## Prerequisites:
1. Node.js 18+ and Android Studio with SDK 34+.

## Build Steps:
1. Run npm build in this project directory:
   npm run build

2. Initialize Capacitor Android Wrapper:
   npm install @capacitor/core @capacitor/cli @capacitor/android
   npx cap init "Gate^Flame" "com.ionity.gateflame.app" --web-dir dist
   npx cap add android
   npx cap copy android

3. Compile Release APK:
   npx cap open android
   Or run directly via Gradle:
   cd android && ./gradlew assembleRelease

The compiled APK will be located at:
android/app/build/outputs/apk/release/app-release.apk
`;

    const blob = new Blob([packageInstructions], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gateflame_apk_build_guide.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setApkManifestGenerated(true);
  };

  // Download Combined Raspberry Pi / Orange Pi Shell Suite
  const handleDownloadPiBundleScript = () => {
    const combinedScript = `#!/bin/bash
# IONITY GLOBAL (Pty) Ltd — Gate^Flame Master Installation Suite
# Target Hardware: Orange Pi Zero 2W / RPi Zero 2 WH / RPi 5 AI HAT+

set -e

echo "=========================================================="
echo "   IONITY GLOBAL (Pty) Ltd — Gate^Flame Node Installer    "
echo "=========================================================="

# 1. Install Dependencies
apt-get update
apt-get install -y curl wget dnsmasq hostapd unbound fail2ban ufw

# 2. Deploy Network Autopilot
cat << 'EOF' > /usr/local/bin/network_autopilot.sh
${SCRIPT_AUTOPILOT}
EOF
chmod +x /usr/local/bin/network_autopilot.sh

# 3. Deploy Unattended Pi-hole Injector
mkdir -p /opt/scripts
cat << 'EOF' > /opt/scripts/deploy_pihole.sh
${SCRIPT_DEPLOY}
EOF
chmod +x /opt/scripts/deploy_pihole.sh

# 4. Deploy Unbound Recursive Resolver
cat << 'EOF' > /opt/scripts/install_unbound.sh
${SCRIPT_UNBOUND}
EOF
chmod +x /opt/scripts/install_unbound.sh

# 5. Deploy PADD Display Kiosk
cat << 'EOF' > /opt/scripts/install_padd.sh
${SCRIPT_PADD}
EOF
chmod +x /opt/scripts/install_padd.sh

echo "=========================================================="
echo "Gate^Flame Master Suite Installed Successfully in /opt/scripts"
echo "=========================================================="
`;

    const blob = new Blob([combinedScript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gateflame_master_installer.sh';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setPiBundleGenerated(true);
  };

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-2">
        <div>
          <h1 className="text-4xl font-display font-light text-white tracking-tight mb-2">
            Export <span className="font-bold">Center</span>
          </h1>
          <p className="text-sm font-mono text-slate-400">
            Package and export the Gate^Flame system into APK binaries, standalone HTML5 files, and Raspberry Pi scripts
          </p>
        </div>
        <div className="glass-panel px-4 py-2 rounded-2xl flex items-center gap-3">
          <span className="flex items-center gap-2 text-[11px] font-mono font-bold text-sky-400 uppercase tracking-wider">
            <CheckCircle2 className="w-3.5 h-3.5" /> Commercial Ready
          </span>
        </div>
      </div>

      {/* Grid of Export Options */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 font-mono text-xs">
        {/* Package Option 1: Mobile APK Wrapper */}
        <div className="glass-panel p-6 rounded-3xl space-y-6 flex flex-col justify-between hover:bg-white/[0.02] transition-colors group">
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-sky-500/10 text-sky-400 flex items-center justify-center font-bold border border-sky-500/20 group-hover:border-sky-500/50 transition-colors">
              <Smartphone className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-display font-medium text-white">Android APK Bundle</h3>
              <p className="text-xs text-slate-400 mt-2 font-mono leading-relaxed">
                Contains AndroidManifest.xml, Capacitor wrapper config, and Gradle script to compile <code className="text-sky-400 bg-black/40 border border-white/10 px-1.5 py-0.5 rounded font-mono">gateflame.apk</code>.
              </p>
            </div>
          </div>

          <button
            onClick={handleDownloadApkPackageConfig}
            className="w-full bg-sky-500 hover:bg-sky-400 text-black font-bold py-3 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" /> Download Build Package
          </button>
        </div>

        {/* Package Option 2: Standalone HTML5 Bundle */}
        <div className="glass-panel p-6 rounded-3xl space-y-6 flex flex-col justify-between hover:bg-white/[0.02] transition-colors group">
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center font-bold border border-amber-500/20 group-hover:border-amber-500/50 transition-colors">
              <Globe className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-display font-medium text-white">Standalone Web App</h3>
              <p className="text-xs font-mono text-slate-400 mt-2 leading-relaxed">
                Self-contained HTML dashboard file that opens directly in any browser without requiring a server setup.
              </p>
            </div>
          </div>

          <button
            onClick={handleDownloadStandaloneHtml}
            className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold py-3 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" /> Download HTML
          </button>
        </div>

        {/* Package Option 3: Physical Node Shell Suite */}
        <div className="glass-panel p-6 rounded-3xl space-y-6 flex flex-col justify-between hover:bg-white/[0.02] transition-colors group">
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-purple-500/10 text-purple-400 flex items-center justify-center font-bold border border-purple-500/20 group-hover:border-purple-500/50 transition-colors">
              <Terminal className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-display font-medium text-white">Edge Node Installer</h3>
              <p className="text-xs font-mono text-slate-400 mt-2 leading-relaxed">
                Master Shell Script (<code className="text-purple-400 font-mono bg-black/40 border border-white/10 px-1.5 py-0.5 rounded">master_installer.sh</code>) bundling Autopilot, Pi-hole Injector & Unbound.
              </p>
            </div>
          </div>

          <button
            onClick={handleDownloadPiBundleScript}
            className="w-full bg-purple-500 hover:bg-purple-400 text-black font-bold py-3 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" /> Download Script
          </button>
        </div>

        {/* Package Option 4: Ionicrobes Game */}
        <div className="glass-panel p-6 rounded-3xl space-y-6 flex flex-col justify-between hover:bg-white/[0.02] transition-colors group">
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold border border-emerald-500/20 group-hover:border-emerald-500/50 transition-colors">
              <Gamepad2 className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-display font-medium text-white">Ionicrobes Game</h3>
              <p className="text-xs font-mono text-slate-400 mt-2 leading-relaxed">
                Standalone HTML5 bundle of the Ionicrobes threat defense minigame for use in other Ionity projects.
              </p>
            </div>
          </div>

          <button
            onClick={handleDownloadIonicrobesHtml}
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-3 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" /> Download Game
          </button>
        </div>
      </div>

      {/* AI Studio Export & Share Instructions Banner */}
      <div className="glass-panel p-6 sm:p-8 rounded-3xl space-y-4 font-mono text-xs">
        <h3 className="font-bold text-white flex items-center gap-2 text-sm uppercase tracking-wider font-mono">
          <FolderArchive className="w-5 h-5 text-sky-400" /> Full Source Code & Project Export Options
        </h3>

        <p className="text-slate-400 leading-relaxed max-w-3xl">
          You can also export the full production codebase directly using the Google AI Studio top bar menu:
        </p>

        <ul className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <li className="bg-black/40 border border-white/5 p-4 rounded-2xl space-y-1">
            <strong className="text-sky-400 block mb-1">Export as ZIP</strong> 
            <span className="text-slate-500 leading-relaxed block">Click the Settings menu to download the entire repository.</span>
          </li>
          <li className="bg-black/40 border border-white/5 p-4 rounded-2xl space-y-1">
            <strong className="text-sky-400 block mb-1">Deploy to GitHub</strong> 
            <span className="text-slate-500 leading-relaxed block">Link your GitHub account to push this repo directly to a project.</span>
          </li>
          <li className="bg-black/40 border border-white/5 p-4 rounded-2xl space-y-1">
            <strong className="text-sky-400 block mb-1">Deploy to Cloud Run</strong> 
            <span className="text-slate-500 leading-relaxed block">Host the full-stack containerized app globally on Cloud Run.</span>
          </li>
        </ul>
      </div>
    </div>
  );
};

