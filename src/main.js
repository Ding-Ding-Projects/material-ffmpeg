const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1240, minHeight: 700,
    frame: false, backgroundColor: '#101416',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.on('window:minimize', () => win.minimize());
ipcMain.on('window:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.on('window:close', () => win.close());

ipcMain.handle('dialog:openFile', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Media', extensions: ['*'] }] });
  return r.canceled ? null : r.filePaths[0];
});

// Run ffmpeg / ffprobe from PATH (or a configured absolute path), stream progress lines back.
ipcMain.handle('ffmpeg:run', (e, { bin, args, jobId }) => new Promise((resolve) => {
  const p = spawn(bin || 'ffmpeg', args, { windowsHide: true });
  const send = (line) => win && win.webContents.send('ffmpeg:log', { jobId, line });
  p.stderr.on('data', (d) => String(d).split(/\r?\n/).filter(Boolean).forEach(send));
  p.stdout.on('data', (d) => String(d).split(/\r?\n/).filter(Boolean).forEach(send));
  p.on('close', (code) => resolve({ code }));
}));
