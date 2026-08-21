const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close')
  },
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  runFfmpeg: (opts) => ipcRenderer.invoke('ffmpeg:run', opts),
  onLog: (cb) => ipcRenderer.on('ffmpeg:log', (_e, payload) => cb(payload))
});
