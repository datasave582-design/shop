const { app, BrowserWindow, Tray, Menu, shell, dialog, nativeImage } = require('electron');
const path = require('path');

let win = null, tray = null, server = null, quitting = false;

// Business data hamesha ProgramData mein (app update/uninstall se safe).
function dataDir() {
  if (process.env.SHOP_DATA_DIR) return path.resolve(process.env.SHOP_DATA_DIR);
  if (process.platform === 'win32' && process.env.PROGRAMDATA) return path.join(process.env.PROGRAMDATA, 'ShopManagement');
  return path.join(app.getPath('userData'), 'ShopManagementData');
}

if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  app.on('second-instance', showWindow);
  app.whenReady().then(boot).catch(fatal);
}

function fatal(e) {
  dialog.showErrorBox('Shop Management', 'Application start nahi ho saka. Please dobara try karein.\n\n' + (e && e.message ? e.message : e));
  app.exit(1);
}

async function boot() {
  const { startServer } = require(path.join(__dirname, '..', 'server', 'dist', 'index.js'));
  server = await startServer({
    dataDir: dataDir(),
    clientDir: path.join(__dirname, '..', 'client', 'dist'),
    port: 3000,
    host: '127.0.0.1',
    version: app.getVersion(),
  });
  createWindow();
  createTray();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    title: 'Shop Management', autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.loadURL(`http://127.0.0.1:${server.port}`);
  win.once('ready-to-show', () => win.show());
  // External links default browser mein, app window mein nahi.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // X dabane par tray mein chala jaye (server chalta rahe). Exit sirf tray menu se.
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Shop Management');
  const build = () => Menu.buildFromTemplate([
    { label: 'Open Shop Management', click: showWindow },
    { label: `Server chal raha hai (port ${server.port})`, enabled: false },
    { type: 'separator' },
    {
      label: 'Windows ke saath start karein', type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: item => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
    },
    { type: 'separator' },
    { label: 'Exit', click: quit },
  ]);
  tray.setContextMenu(build());
  tray.on('click', showWindow);
  tray.on('right-click', () => tray.setContextMenu(build()));
}

async function quit() {
  quitting = true;
  try { if (server) await server.close(); } catch { /* ignore */ }
  app.quit();
}

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* tray mein chalta rahe */ });
