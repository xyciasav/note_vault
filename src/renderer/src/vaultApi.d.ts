export type VaultItem = {
  id: string;
  title: string;
  type: 'note' | 'file';
  body: string;
  file_name?: string | null;
  file_stored_name?: string | null;
  file_source_path?: string | null;
  file_ext?: string | null;
  extracted_text?: string;
  thumbnail_data?: string | null;
  favorite: boolean;
  private: boolean;
  collection_id?: string | null;
  collection_ids: string[];
  collections: { id: string; name: string }[];
  created_at: string;
  updated_at: string;
  tags: string[];
  file_path?: string | null;
};

export type VaultRelationship = {
  source_item_id: string;
  target_item_id: string;
  note: string;
  created_at: string;
  item: VaultItem;
};

export type ImportPreview = {
  sourcePath: string;
  relativePath: string;
  watchedFolderId?: string;
  watchedFolderPath?: string;
  title: string;
  fileName: string;
  fileExt: string;
  size: number;
  suggestedTags: string[];
  suggestedCollectionName: string;
  duplicateName: boolean;
  duplicateKind: 'none' | 'same-name' | 'same-file';
  duplicateMatch?: { id: string; title: string; fileName: string } | null;
  extractedText: string;
  thumbnailData?: string | null;
};

export type WatchedFolder = {
  id: string;
  path: string;
  enabled: boolean;
  created_at: string;
  lastScanAt?: string;
  seenCount: number;
};

export type WatchedFolderFile = {
  sourcePath: string;
  relativePath: string;
  watchedFolderId: string;
  watchedFolderPath: string;
};

export type BackupStats = {
  count: number;
  totalBytes: number;
  retentionCount: number;
};

declare global {
  interface Window {
    vaultApi: {
      getAppVersion: () => Promise<string>;
      getLogs: () => Promise<{ path: string; text: string }>;
      openLogs: () => Promise<{ ok: boolean; path: string }>;
      getDashboardSummary: () => Promise<{ totalItems: number; notes: number; files: number; favorites: number; collections: number; tags: number; recentItems: VaultItem[] }>;
      getPathForFile: (file: File) => string;
      listItems: (args?: { search?: string; tag?: string; type?: string; collectionId?: string }) => Promise<VaultItem[]>;
      listTags: () => Promise<{ id?: string; name: string; count?: number }[]>;
      createTag: (name: string) => Promise<{ id: string; name: string }>;
      renameTag: (oldName: string, newName: string) => Promise<{ ok: boolean }>;
      deleteTag: (name: string) => Promise<{ ok: boolean }>;
      listCollections: () => Promise<{ id: string; name: string; created_at: string; count?: number }[]>;
      createCollection: (name: string) => Promise<{ id: string; name: string; created_at: string }>;
      deleteCollection: (id: string) => Promise<{ ok: boolean }>;
      listRelationships: (itemId: string) => Promise<VaultRelationship[]>;
      addRelationship: (args: { itemId: string; relatedItemId: string; note?: string }) => Promise<VaultRelationship[]>;
      removeRelationship: (args: { itemId: string; relatedItemId: string }) => Promise<VaultRelationship[]>;
      createNote: (args: { title: string; body?: string; tags?: string[] | string; collectionIds?: string[] }) => Promise<VaultItem>;
      updateItem: (args: { id: string; title?: string; body?: string; tags?: string[] | string; favorite?: boolean; private?: boolean; collectionIds?: string[] }) => Promise<VaultItem>;
      deleteItem: (id: string) => Promise<{ ok: boolean }>;
      deleteItems: (ids: string[]) => Promise<{ deleted: number }>;
      addTagsToItems: (ids: string[], tags: string[]) => Promise<{ updated: number }>;
      removeTagsFromItems: (ids: string[], tags: string[]) => Promise<{ updated: number }>;
      addCollectionToItems: (ids: string[], collectionId: string) => Promise<{ updated: number }>;
      previewImport: (files: { sourcePath: string; relativePath?: string }[]) => Promise<ImportPreview[]>;
      uploadFile: (args: { sourcePath: string; title?: string; body?: string; tags?: string[] | string; collectionIds?: string[] }) => Promise<VaultItem>;
      openFile: (id: string) => Promise<{ ok: boolean }>;
      reindexFiles: () => Promise<{ indexed: number }>;
      exportBackup: () => Promise<{ canceled: boolean; path?: string }>;
      openBackupFolder: () => Promise<{ ok: boolean; path: string }>;
      getBackupSettings: () => Promise<{ backupDirectory: string; backupFrequency: 'on-close' | 'daily' | 'weekly' | 'never'; backupRetentionCount: number; allowNewImportTagSuggestions: boolean; backupStats: BackupStats }>;
      chooseBackupFolder: () => Promise<{ canceled: boolean; path?: string; backupDirectory?: string; backupFrequency?: string; backupRetentionCount?: number; allowNewImportTagSuggestions?: boolean; backupStats?: BackupStats }>;
      setBackupFrequency: (frequency: 'on-close' | 'daily' | 'weekly' | 'never') => Promise<{ backupDirectory: string; backupFrequency: string; backupRetentionCount: number; allowNewImportTagSuggestions: boolean; backupStats: BackupStats }>;
      setBackupRetentionCount: (count: number) => Promise<{ backupDirectory: string; backupFrequency: string; backupRetentionCount: number; allowNewImportTagSuggestions: boolean; backupStats: BackupStats; deleted: number }>;
      setImportTagSuggestions: (allowNewTags: boolean) => Promise<{ backupDirectory: string; backupFrequency: string; backupRetentionCount: number; allowNewImportTagSuggestions: boolean; backupStats: BackupStats }>;
      importBackup: () => Promise<{ canceled: boolean; imported?: boolean }>;
      listWatchedFolders: () => Promise<WatchedFolder[]>;
      addWatchedFolder: () => Promise<{ canceled: boolean; folder?: WatchedFolder; alreadyExists?: boolean }>;
      removeWatchedFolder: (id: string) => Promise<{ ok: boolean }>;
      scanWatchedFolders: (args?: { markSeen?: boolean; folderId?: string }) => Promise<WatchedFolderFile[]>;
      markWatchedFilesSeen: (files: { sourcePath: string; watchedFolderId?: string; watchedFolderPath?: string }[]) => Promise<{ ok: boolean }>;
      markWatchedScanHandled: (args?: { folderId?: string }) => Promise<{ ok: boolean; handled: number }>;
      checkForUpdates: () => Promise<{ updateAvailable: boolean; version?: string }>;
    };
  }
}
