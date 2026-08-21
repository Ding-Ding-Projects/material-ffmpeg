'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', Object.freeze({
  window: Object.freeze({
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close')
  }),
  runtime: Object.freeze({
    status: () => ipcRenderer.invoke('runtime:status'),
    catalog: () => ipcRenderer.invoke('runtime:catalog')
  }),
  files: Object.freeze({
    open: (options) => ipcRenderer.invoke('files:open', options),
    save: (options) => ipcRenderer.invoke('files:save', options)
  }),
  catalog: Object.freeze({
    list: (kind) => ipcRenderer.invoke('catalog:list', kind),
    help: (kind, name) => ipcRenderer.invoke('catalog:help', kind, name)
  }),
  probe: Object.freeze({
    inspect: (fileHandle) => ipcRenderer.invoke('probe:inspect', fileHandle),
    export: (spec) => ipcRenderer.invoke('probe:export', spec)
  }),
  loudnorm: Object.freeze({
    retainSelections: (spec) => ipcRenderer.invoke('loudnorm:retain-selections', spec)
  }),
  composer: Object.freeze({
    enqueue: (request) => ipcRenderer.invoke('composer:enqueue', request)
  }),
  jobs: Object.freeze({
    enqueue: (spec) => ipcRenderer.invoke('jobs:enqueue', spec),
    list: () => ipcRenderer.invoke('jobs:list'),
    setConcurrency: (value) => ipcRenderer.invoke('jobs:set-concurrency', value),
    pause: (id) => ipcRenderer.invoke('jobs:pause', id),
    resume: (id) => ipcRenderer.invoke('jobs:resume', id),
    cancel: (id) => ipcRenderer.invoke('jobs:cancel', id),
    reorder: (ids) => ipcRenderer.invoke('jobs:reorder', ids),
    clear: (ids) => ipcRenderer.invoke('jobs:clear', ids),
    onEvent: (callback) => {
      if (typeof callback !== 'function') throw new TypeError('Job event listener must be a function.');
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('jobs:event', listener);
      return () => ipcRenderer.removeListener('jobs:event', listener);
    }
  })
}));
