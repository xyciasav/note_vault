import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('vaultApi', {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  listItems: (args?: { search?: string; tag?: string; type?: string; collectionId?: string }) => ipcRenderer.invoke('items:list', args),
  listTags: () => ipcRenderer.invoke('tags:list'),
  listCollections: () => ipcRenderer.invoke('collections:list'),
  createCollection: (name: string) => ipcRenderer.invoke('collections:create', name),
  deleteCollection: (id: string) => ipcRenderer.invoke('collections:delete', id),
  createNote: (args: { title: string; body?: string; tags?: string[] | string; collectionIds?: string[] }) => ipcRenderer.invoke('items:createNote', args),
  updateItem: (args: { id: string; title?: string; body?: string; tags?: string[] | string; favorite?: boolean; collectionIds?: string[] }) => ipcRenderer.invoke('items:update', args),
  deleteItem: (id: string) => ipcRenderer.invoke('items:delete', id),
  uploadFile: (args: { sourcePath: string; title?: string; body?: string; tags?: string[] | string; collectionIds?: string[] }) => ipcRenderer.invoke('items:uploadFile', args),
  openFile: (id: string) => ipcRenderer.invoke('items:openFile', id),
  reindexFiles: () => ipcRenderer.invoke('items:reindexFiles'),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  openBackupFolder: () => ipcRenderer.invoke('backup:openFolder'),
  getBackupSettings: () => ipcRenderer.invoke('backup:getSettings'),
  chooseBackupFolder: () => ipcRenderer.invoke('backup:chooseFolder'),
  setBackupFrequency: (frequency: string) => ipcRenderer.invoke('backup:setFrequency', frequency),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check')
});
