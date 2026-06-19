import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('vaultApi', {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  listItems: (args?: { search?: string; tag?: string; type?: string }) => ipcRenderer.invoke('items:list', args),
  listTags: () => ipcRenderer.invoke('tags:list'),
  createNote: (args: { title: string; body?: string; tags?: string[] | string }) => ipcRenderer.invoke('items:createNote', args),
  updateItem: (args: { id: string; title?: string; body?: string; tags?: string[] | string; favorite?: boolean }) => ipcRenderer.invoke('items:update', args),
  deleteItem: (id: string) => ipcRenderer.invoke('items:delete', id),
  uploadFile: (args: { sourcePath: string; title?: string; body?: string; tags?: string[] | string }) => ipcRenderer.invoke('items:uploadFile', args),
  openFile: (id: string) => ipcRenderer.invoke('items:openFile', id),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  importBackup: () => ipcRenderer.invoke('backup:import')
});
