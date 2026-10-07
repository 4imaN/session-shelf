import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('shelfDesktop', {
  login: () => ipcRenderer.invoke('shelf:login'),
  getTheme: () => ipcRenderer.invoke('shelf:get-theme'),
  setTheme: (theme: string) => ipcRenderer.invoke('shelf:set-theme', theme),
});
