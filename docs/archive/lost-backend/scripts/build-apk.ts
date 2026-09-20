import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const type = process.argv[2]; // 'mobile' or 'kiosk'

if (!type) {
    console.error('Please specify build type (mobile or kiosk)');
    process.exit(1);
}

try {
    console.log(`Building APK for ${type}...`);
    
    // 1. Copy config
    fs.copyFileSync(
        path.join(rootDir, `capacitor.${type}.config.json`),
        path.join(rootDir, 'capacitor.config.json')
    );

    // 2. Build HTML
    execSync(`npm run build:html-${type}`, { stdio: 'inherit', cwd: rootDir });

    // 3. Sync capacitor
    execSync('npx cap sync android', { stdio: 'inherit', cwd: rootDir });

    // 4. Run gradle build
    const androidDir = path.join(rootDir, 'android');
    const gradlewCmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    
    // Set JAVA_HOME if we are using the local JDK in .jdk21
    const jdkPath = path.join(rootDir, '.jdk21', 'jdk-21.0.4+7');
    const env = { ...process.env };
    if (fs.existsSync(jdkPath)) {
        env.JAVA_HOME = jdkPath;
    }

    execSync(`${gradlewCmd} assembleDebug`, { stdio: 'inherit', cwd: androidDir, env });

    // 5. Copy APK
    const releaseDir = path.join(rootDir, 'release');
    if (!fs.existsSync(releaseDir)) {
        fs.mkdirSync(releaseDir, { recursive: true });
    }

    const outputName = type === 'mobile' ? 'GateFlame-Mobile.apk' : 'GateFlame-Kiosk.apk';
    const apkPath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
    
    fs.copyFileSync(apkPath, path.join(releaseDir, outputName));

    console.log(`Successfully built ${outputName}`);

} catch (e) {
    console.error(`Error building APK for ${type}:`, e);
    process.exit(1);
}
