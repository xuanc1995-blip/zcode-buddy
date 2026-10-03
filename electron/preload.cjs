'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  getState: () => ipcRenderer.invoke('state:get'),
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  captureAccount: (name) => ipcRenderer.invoke('account:capture', name),
  useAccount: (id) => ipcRenderer.invoke('account:use', id),
  renameAccount: (id, name) => ipcRenderer.invoke('account:rename', { id, name }),
  deleteAccount: (id) => ipcRenderer.invoke('account:delete', id),
  refreshQuota: (target) => ipcRenderer.invoke('quota:refresh', target),
  rollback: () => ipcRenderer.invoke('switch:rollback'),
  launchZCode: () => ipcRenderer.invoke('zcode:launch'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  pollOnce: () => ipcRenderer.invoke('quota:pollOnce'),
  exportData: (passphrase) => ipcRenderer.invoke('data:export', passphrase),
  importData: (passphrase) => ipcRenderer.invoke('data:import', passphrase),
  openPath: (p) => ipcRenderer.invoke('app:openPath', p),
  getVersion: () => ipcRenderer.invoke('app:version'),
  winMinimize: () => ipcRenderer.send('win:minimize'),
  winMaximize: () => ipcRenderer.send('win:maximize'),
  winClose: () => ipcRenderer.send('win:close'),
  on: (channel, cb) => {
    const ok = ['quota:updated', 'state:changed', 'theme:changed', 'win:maximized'];
    if (ok.includes(channel)) ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
});
