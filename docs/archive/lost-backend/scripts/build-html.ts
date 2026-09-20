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
    console.log(`Building for ${type}...`);
    
    // 1. Run Vite build
    execSync('npx vite build --config vite.standalone.config.ts', { stdio: 'inherit', cwd: rootDir });

    const distDir = path.join(rootDir, 'dist');
    const targetDistDir = path.join(rootDir, `dist-${type}`);

    // 2. Create dist-[type] folder
    if (fs.existsSync(targetDistDir)) {
        fs.rmSync(targetDistDir, { recursive: true, force: true });
    }
    fs.mkdirSync(targetDistDir, { recursive: true });

    // 3. Copy html file and assets
    const htmlFile = path.join(distDir, `${type}.html`);
    const assetsDir = path.join(distDir, 'assets');
    
    fs.copyFileSync(htmlFile, path.join(targetDistDir, `${type}.html`));
    
    if (fs.existsSync(assetsDir)) {
        fs.cpSync(assetsDir, path.join(targetDistDir, 'assets'), { recursive: true });
    }

    // 4. Copy to dist/index.html for Capacitor
    fs.copyFileSync(htmlFile, path.join(distDir, 'index.html'));

    console.log(`Successfully built and assembled HTML for ${type}`);

} catch (e) {
    console.error(`Error building HTML for ${type}:`, e);
    process.exit(1);
}
