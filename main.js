const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DATA_FILE = () => path.join(app.getPath('userData'), 'detail-schedule-data.json');
const OLD_DATA_FILENAME = 'hitachi-schedule-data.json'; // this app's pre-rebrand filename, same userData dir
const BACKUP_DIR = () => path.join(app.getPath('userData'), 'schedule-backups');
const MAX_BACKUPS = 60;

function atomicWrite(filePath, contents) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, filePath);
}

function readScheduleData() {
  try {
    const raw = fs.readFileSync(DATA_FILE(), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function writeScheduleData(data) {
  const json = JSON.stringify(data, null, 2);
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  atomicWrite(DATA_FILE(), json);

  // rolling daily backup — one per calendar day, oldest pruned past MAX_BACKUPS
  try {
    fs.mkdirSync(BACKUP_DIR(), { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const backupPath = path.join(BACKUP_DIR(), `schedule-${stamp}.json`);
    if (!fs.existsSync(backupPath)) {
      atomicWrite(backupPath, json);
    }
    const files = fs.readdirSync(BACKUP_DIR())
      .filter(f => f.startsWith('schedule-') && f.endsWith('.json'))
      .sort();
    while (files.length > MAX_BACKUPS) {
      fs.unlinkSync(path.join(BACKUP_DIR(), files.shift()));
    }
  } catch (e) {
    // backups are best-effort, never block the actual save over one failing
  }
}

// ---------------- Team mode persistence (fully separate from single-mode data) ----------------
// Team Schedule is a distinct dataset from the single-employee schedule above —
// its own file, its own backup folder — so nothing here can ever collide with
// or overwrite single-mode data.
const TEAM_DATA_FILE = () => path.join(app.getPath('userData'), 'detail-team-data.json');
const TEAM_BACKUP_DIR = () => path.join(app.getPath('userData'), 'team-schedule-backups');

function readTeamScheduleData() {
  try {
    const raw = fs.readFileSync(TEAM_DATA_FILE(), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function writeTeamScheduleData(data) {
  const json = JSON.stringify(data, null, 2);
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  atomicWrite(TEAM_DATA_FILE(), json);

  try {
    fs.mkdirSync(TEAM_BACKUP_DIR(), { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const backupPath = path.join(TEAM_BACKUP_DIR(), `team-schedule-${stamp}.json`);
    if (!fs.existsSync(backupPath)) {
      atomicWrite(backupPath, json);
    }
    const files = fs.readdirSync(TEAM_BACKUP_DIR())
      .filter(f => f.startsWith('team-schedule-') && f.endsWith('.json'))
      .sort();
    while (files.length > MAX_BACKUPS) {
      fs.unlinkSync(path.join(TEAM_BACKUP_DIR(), files.shift()));
    }
  } catch (e) {
    // backups are best-effort, never block the actual save over one failing
  }
}

// ---------------- Legacy userData migration ----------------
// This app shipped under a previous name before the current rebrand.
// Electron's userData directory is keyed off productName, so a straight
// rename would make a freshly-installed build look at an empty folder and
// appear to have wiped every saved schedule. This runs once on startup: if
// the new location has no data yet but the old install did, it adopts it —
// copy, not move, so the old install (if still present) is untouched.
function legacyUserDataDir() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Hitachi Schedule');
  }
  if (process.platform === 'win32') {
    return path.join(app.getPath('appData'), 'Hitachi Schedule');
  }
  return path.join(os.homedir(), '.config', 'Hitachi Schedule');
}

function migrateLegacyUserDataIfNeeded() {
  try {
    if (fs.existsSync(DATA_FILE())) return; // already has data under the current filename

    // First check: same userData directory, just the old pre-rebrand
    // filename (no app-rename involved, just a filename change). A fresh
    // install has neither file and this is a no-op.
    const sameDirOld = path.join(app.getPath('userData'), OLD_DATA_FILENAME);
    if (fs.existsSync(sameDirOld)) {
      fs.mkdirSync(app.getPath('userData'), { recursive: true });
      fs.copyFileSync(sameDirOld, DATA_FILE());
      return;
    }

    // Second check: an entirely different userData directory from when this
    // app was packaged under its old productName.
    const oldDir = legacyUserDataDir();
    const oldDataFile = path.join(oldDir, OLD_DATA_FILENAME);
    if (!fs.existsSync(oldDataFile)) return; // no legacy install to adopt from

    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.copyFileSync(oldDataFile, DATA_FILE());

    const oldBackupDir = path.join(oldDir, 'schedule-backups');
    if (fs.existsSync(oldBackupDir)) {
      fs.mkdirSync(BACKUP_DIR(), { recursive: true });
      for (const f of fs.readdirSync(oldBackupDir)) {
        fs.copyFileSync(path.join(oldBackupDir, f), path.join(BACKUP_DIR(), f));
      }
    }
  } catch (e) {
    // Best-effort convenience only — never block startup over it.
  }
}

// Defense-in-depth shape check on the IPC boundary itself — the renderer
// already validates before offering a save (see index.html's
// isValidScheduleBackup), but that's renderer-side and this is the actual
// trust boundary. Rejects anything that isn't a plausible schedule object
// instead of writing it to disk unchecked.
function isPlausibleScheduleData(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.people)) return false;
  if (!data.weeks || typeof data.weeks !== 'object' || Array.isArray(data.weeks)) return false;
  return Object.values(data.weeks).every(w =>
    w && Array.isArray(w.shifts)
  );
}

ipcMain.handle('schedule:load', () => readScheduleData());
ipcMain.handle('schedule:save', (event, data) => {
  if (!isPlausibleScheduleData(data)) return false;
  writeScheduleData(data);
  return true;
});

ipcMain.handle('teamSchedule:load', () => readTeamScheduleData());
ipcMain.handle('teamSchedule:save', (event, data) => {
  if (!isPlausibleScheduleData(data)) return false;
  writeTeamScheduleData(data);
  return true;
});

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 1150,
    minWidth: 980,
    minHeight: 640,
    title: 'Detail',
    backgroundColor: '#15171b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Only hand off http/https — refuse file:/custom-scheme URLs from ever
    // reaching shell.openExternal, which would otherwise happily launch
    // local files or other installed apps on the user's behalf.
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  app.setAboutPanelOptions({
    applicationName: 'Detail',
    applicationVersion: require('./package.json').version,
    version: require('./package.json').version,
    copyright: `© ${new Date().getFullYear()} Campaigner Studios. All rights reserved.`
  });

  migrateLegacyUserDataIfNeeded();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
