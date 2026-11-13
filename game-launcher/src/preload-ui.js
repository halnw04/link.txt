const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  state: () => ipcRenderer.invoke('ui:state'),
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  save: (acc) => ipcRenderer.invoke('acc:save', acc),
  remove: (id) => ipcRenderer.invoke('acc:delete', id),
  show: (id) => ipcRenderer.invoke('acc:show', id),
  pause: (ids, mode) => ipcRenderer.invoke('acc:pause', ids, mode),
  reload: (id, hard) => ipcRenderer.invoke('acc:reload', id, hard),
  restoreMany: (ids) => ipcRenderer.invoke('acc:restoreMany', ids),
});
