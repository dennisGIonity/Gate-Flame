/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame desktop console (Electron main)
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 *
 * WHAT THIS IS
 *
 * The same paired-device app that ships on the phone (dist-mobile), in a
 * window. It discovers a Gate^Flame box on the LAN, pairs with a code shown on
 * the wall console, and from then on carries `control` scope like a phone
 * does. It is NOT the appliance's own console: the node grants `kiosk` scope
 * from a loopback socket only, so a desktop on the LAN can never stop a module
 * or change the upstream — by design, the same as a phone (security.py).
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * - No auto-update. The app talks to hardware in someone's house; an update
 *   channel would be a second party in that conversation. Releases are files
 *   on GitHub, built by .github/workflows/release-desktop.yml.
 * - No telemetry, no crash reporter, no analytics. Nothing here opens a
 *   socket to anywhere except the box the person paired with.
 * - No Node integration in the renderer. The web app is the web app.
 */

'use strict';

const { app, BrowserWindow, Menu, shell, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const PRODUCT = 'Gate^Flame';
const BG = '#0b0d12'; // ionity-tokens surface.bg — no white flash before first paint

// Where the built web app lives. Packaged: <resources>/web (extraResources in
// package.json). Development: ../dist-mobile beside this file.
function webRoot() {
  const packaged = path.join(process.resourcesPath || '', 'web');
  if (app.isPackaged && fs.existsSync(path.join(packaged, 'index.html'))) return packaged;
  const dev = path.join(__dirname, '..', 'dist-mobile');
  if (fs.existsSync(path.join(dev, 'index.html'))) return dev;
  return null;
}

function createWindow() {
  nativeTheme.themeSource = 'dark';
  const win = new BrowserWindow({
    width: 480,
    height: 940,
    minWidth: 400,
    minHeight: 700,
    backgroundColor: BG,
    title: PRODUCT,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The app fetches http://<lan-ip>:8080 from a file:// origin. The node
      // answers CORS `*` and gates real authority on scope, not origin, so
      // this is the same posture as the phone's WebView.
      webSecurity: true,
    },
  });

  const root = webRoot();
  if (!root) {
    // Say exactly what is missing rather than show a blank window. The page
    // below is inline so it cannot itself be the thing that is missing.
    win.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          `<body style="margin:0;background:${BG};color:#e7ebf2;font:15px system-ui;display:grid;place-items:center;height:100vh">
           <div style="max-width:32rem;padding:2rem"><h1 style="font-size:1.25rem">${PRODUCT} — web bundle not found</h1>
           <p>This build does not contain <code>web/index.html</code>. Run <code>npm run build:html-mobile</code> in the
           repository root before packaging.</p></div></body>`,
        ),
    );
    return win;
  }

  win.loadFile(path.join(root, 'index.html'));

  // Links to ionity.today etc. open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  return win;
}

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'Console',
      submenu: [
        { role: 'reload' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Open wall console in browser (read-only)…',
          click: () => shell.openExternal('http://gateflame.local:8080/device-kiosk/'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'ionity.today', click: () => shell.openExternal('https://www.ionity.today') },
        { label: 'Privacy notice', click: () => shell.openExternal('https://www.ionity.today/privacy') },
        { label: 'Source (GitHub)', click: () => shell.openExternal('https://github.com/dennisGIonity/Gate-Flame') },
        { type: 'separator' },
        {
          label: `About ${PRODUCT}`,
          click: () =>
            shell.beep() ||
            require('electron').dialog.showMessageBox({
              type: 'info',
              title: `About ${PRODUCT}`,
              message: `${PRODUCT} desktop console ${app.getVersion()}`,
              detail:
                'Ionity Global (Pty) Ltd — AEDI\n' +
                'Built and operated by Dennis Grobler (Wabakipi) · Founded by Johan Wilhelm van Antwerp\n' +
                'Governance: Policy 986 AED · Licence: AED 900\n' +
                '(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM²\n' +
                'Building Tomorrow, Today.',
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// One instance. A second launch focuses the first rather than pairing twice.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
