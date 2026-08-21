'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { FileRegistry } = require('./runtime/file-registry');
const { JobManager } = require('./runtime/job-manager');
const { RuntimeService } = require('./runtime/runtime-service');
const { resolveExecutables } = require('./runtime/safe-process');

let mainWindow = null;
let jobs = null;
let shuttingDown = false;
const files = new FileRegistry();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    backgroundColor: '#101416',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  const allowedUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== allowedUrl) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function assertTrustedSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('Untrusted IPC sender.');
  }
}

function trustedHandle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event);
    return handler(...args);
  });
}

function trustedOn(channel, handler) {
  ipcMain.on(channel, (event, ...args) => {
    assertTrustedSender(event);
    handler(...args);
  });
}

function registerIpc(runtime) {
  trustedOn('window:minimize', () => mainWindow?.minimize());
  trustedOn('window:maximize', () => mainWindow && (mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()));
  trustedOn('window:close', () => mainWindow?.close());

  trustedHandle('runtime:status', () => runtime.status());
  trustedHandle('runtime:catalog', () => runtime.catalog());
  trustedHandle('catalog:list', (kind) => runtime.list(kind));
  trustedHandle('catalog:help', (kind, name) => runtime.help(kind, name));

  trustedHandle('files:open', async (options = {}) => {
    const multiple = Boolean(options && options.multiple);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select media files',
      properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: 'Media files', extensions: ['*'] }]
    });
    if (result.canceled) return multiple ? [] : null;
    const handles = result.filePaths.map((filePath) => files.register(filePath, 'input'));
    return multiple ? handles : handles[0];
  });
  trustedHandle('files:save', async (options = {}) => {
    const suggestedName = safeSuggestedName(options && options.suggestedName);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Choose output file',
      defaultPath: suggestedName,
      filters: normalizeDialogFilters(options && options.filters)
    });
    return result.canceled || !result.filePath ? null : files.register(result.filePath, 'output');
  });

  trustedHandle('probe:inspect', (fileHandle) => runtime.inspect(fileHandle));
  trustedHandle('probe:export', (spec) => runtime.exportProbe(spec));
  trustedHandle('jobs:enqueue', (spec) => jobs.enqueue(spec));
  trustedHandle('jobs:list', () => jobs.list());
  trustedHandle('jobs:set-concurrency', (value) => jobs.setConcurrency(value));
  trustedHandle('jobs:pause', (id) => jobs.pause(id));
  trustedHandle('jobs:resume', (id) => jobs.resume(id));
  trustedHandle('jobs:cancel', (id) => jobs.cancel(id));
  trustedHandle('jobs:reorder', (ids) => jobs.reorder(ids));
  trustedHandle('jobs:clear', (ids) => jobs.clear(ids));
}

function safeSuggestedName(value) {
  if (value === undefined) return 'output.mp4';
  if (typeof value !== 'string' || !value.trim() || value.length > 240 || /[\\/:*?"<>|\0\r\n]/.test(value)) {
    throw new TypeError('Suggested output name is invalid.');
  }
  return value.trim();
}

function normalizeDialogFilters(value) {
  if (value === undefined) return [{ name: 'All files', extensions: ['*'] }];
  if (!Array.isArray(value) || value.length > 12) throw new TypeError('Invalid save filters.');
  return value.map((filter) => {
    if (!filter || typeof filter.name !== 'string' || !filter.name.trim() || filter.name.length > 80 ||
      !Array.isArray(filter.extensions) || filter.extensions.length === 0 || filter.extensions.length > 20 ||
      filter.extensions.some((extension) => typeof extension !== 'string' || !/^(?:\*|[a-z0-9]{1,12})$/i.test(extension))) {
      throw new TypeError('Invalid save filter.');
    }
    return { name: filter.name.trim(), extensions: [...filter.extensions] };
  });
}

app.whenReady().then(() => {
  const executables = resolveExecutables(app);
  const runtime = new RuntimeService({ executables, fileRegistry: files });
  jobs = new JobManager({
    ffmpegPath: executables.ffmpeg,
    fileRegistry: files,
    stateDirectory: app.getPath('userData'),
    concurrency: 2
  });
  jobs.on('event', (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('jobs:event', payload);
  });
  jobs.initialize();
  registerIpc(runtime);
  createWindow();
});

app.on('before-quit', () => {
  if (shuttingDown) return;
  shuttingDown = true;
  jobs?.shutdown();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
