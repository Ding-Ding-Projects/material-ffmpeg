'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { MAX_BATCH_FILES, inspectInputs, normalizeTarget, prepareOutputs } = require('./runtime/converter-batch');
const { FileRegistry } = require('./runtime/file-registry');
const { JobManager } = require('./runtime/job-manager');
const { RuntimeService } = require('./runtime/runtime-service');
const { resolveExecutables } = require('./runtime/safe-process');
const { composer: buildComposerArgs } = require('./ui/command-builders');

let mainWindow = null;
let jobs = null;
let shuttingDown = false;
const pendingJobEvents = [];
let pendingQueueStateError = null;
const files = new FileRegistry();

function publishJobEvent(payload) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.send('jobs:event', payload);
    return;
  }
  if (payload?.type === 'state-error') {
    pendingQueueStateError = payload;
    return;
  }
  pendingJobEvents.push(payload);
  if (pendingJobEvents.length > 128) pendingJobEvents.splice(0, pendingJobEvents.length - 128);
}

function flushJobEvents() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (pendingQueueStateError) mainWindow.webContents.send('jobs:event', pendingQueueStateError);
  pendingQueueStateError = null;
  pendingJobEvents.splice(0).forEach((payload) => mainWindow.webContents.send('jobs:event', payload));
}

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
  mainWindow.webContents.once('did-finish-load', flushJobEvents);
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
  trustedHandle('catalog:list', (kind, options) => runtime.list(kind, options));
  trustedHandle('catalog:help', (kind, name, options) => runtime.help(kind, name, options));

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

  trustedHandle('loudnorm:retain-selections', (spec) => {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec) ||
      Object.keys(spec).length !== 2 || !Object.prototype.hasOwnProperty.call(spec, 'inputHandle') ||
      !Object.prototype.hasOwnProperty.call(spec, 'outputHandle')) {
      throw new TypeError('Loudness selection retention requires exactly one input and one output handle.');
    }
    return {
      input: files.retain(spec.inputHandle, 'input'),
      output: files.retain(spec.outputHandle, 'output')
    };
  });
  trustedHandle('converter:select-inputs', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Select up to ${MAX_BATCH_FILES} media files`,
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Media files', extensions: ['*'] }]
    });
    if (result.canceled) return { canceled: true, items: [], rejected: [], selectionLimit: MAX_BATCH_FILES };

    const selectedPaths = result.filePaths.slice(0, MAX_BATCH_FILES);
    const rejected = result.filePaths.slice(MAX_BATCH_FILES).map((filePath) => ({
      name: path.basename(filePath).slice(0, 255),
      error: `The batch selection limit is ${MAX_BATCH_FILES} files.`
    }));
    const handles = [];
    for (const filePath of selectedPaths) {
      try {
        handles.push(files.register(filePath, 'input').handle);
      } catch (error) {
        rejected.push({ name: path.basename(filePath).slice(0, 255), error: String(error.message || error).slice(0, 500) });
      }
    }
    const items = handles.length
      ? await inspectInputs(handles, { fileRegistry: files, inspect: (handle) => runtime.inspect(handle) })
      : [];
    return { canceled: false, items, rejected, selectionLimit: MAX_BATCH_FILES };
  });
  trustedHandle('converter:prepare-outputs', async (spec = {}) => {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec) ||
      Object.keys(spec).some((key) => key !== 'target' && key !== 'inputHandles')) {
      throw new TypeError('Invalid converter output request.');
    }
    const target = normalizeTarget(spec.target);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Choose a folder for ${target.toUpperCase()} outputs`,
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length !== 1) {
      return { canceled: true, target, outputs: [], failures: [] };
    }
    return {
      canceled: false,
      ...prepareOutputs({ directory: result.filePaths[0], target, inputHandles: spec.inputHandles, fileRegistry: files })
    };
  });
  trustedHandle('converter:release-handles', (handles) => {
    if (!Array.isArray(handles) || handles.length > MAX_BATCH_FILES * 2 || handles.some((handle) => typeof handle !== 'string')) {
      throw new TypeError('Invalid converter handle release request.');
    }
    let released = 0;
    for (const handle of [...new Set(handles)]) {
      try {
        if (files.release(handle)) released += 1;
      } catch { }
    }
    return { requested: handles.length, released };
  });

  trustedHandle('probe:inspect', (fileHandle) => runtime.inspect(fileHandle));
  trustedHandle('probe:export', (spec) => runtime.exportProbe(spec));
  trustedHandle('composer:enqueue', (request) => jobs.enqueue(compileComposerJob(request, files)));
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

function compileComposerJob(request, registry) {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
    Object.keys(request).some((key) => key !== 'label' && key !== 'spec')) {
    throw new TypeError('Composer request must contain only a label and structured specification.');
  }
  const args = buildComposerArgs(Object.assign({}, request.spec, { overwrite: true, progress: false }));
  const handleKinds = new Map();
  const registerHandle = (handle, expectedKind) => {
    const description = registry.describe(handle);
    if (description.kind !== expectedKind) throw new TypeError(`Composer ${expectedKind} selection has the wrong handle kind.`);
    handleKinds.set(handle, expectedKind);
  };
  request.spec.inputs.forEach((input) => registerHandle(input.source, 'input'));
  request.spec.outputs.forEach((output) => registerHandle(output.target, 'output'));
  return {
    label: request.label === undefined ? 'Composed command' : request.label,
    args: args.map((argument) => handleKinds.has(argument)
      ? { fileHandle: argument, kind: handleKinds.get(argument) }
      : argument)
  };
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
    publishJobEvent(payload);
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
