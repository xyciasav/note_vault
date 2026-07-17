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
  image_rotation?: number;
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

export type LicenseStatus = {
  licensed: boolean;
  locked: boolean;
  trialStartedAt: string;
  trialEndsAt: string;
  trialDaysRemaining: number;
  licenseName?: string;
  licenseExpiresAt?: string;
  reason?: string;
  deviceId?: string;
  activationServerUrl?: string;
};

export type VaultRelationshipSummary = {
  source_item_id: string;
  target_item_id: string;
  note: string;
  created_at: string;
  source: { id: string; title: string; type: 'note' | 'file'; fileName?: string | null };
  target: { id: string; title: string; type: 'note' | 'file'; fileName?: string | null };
};

export type VaultMemory = {
  id: string;
  title: string;
  description: string;
  theme: string;
  cover_item_id?: string;
  player_x?: number;
  player_y?: number;
  created_at: string;
  updated_at: string;
  item_count: number;
  cover_thumbnail_data?: string | null;
  cover_title?: string;
};

export type VaultMemoryItem = {
  item: VaultItem;
  x: number;
  y: number;
  width: number;
  height: number;
  sort_order: number;
};

export type VaultMemoryDecoration = {
  id: string;
  memory_id: string;
  kind: 'string' | 'arrow' | 'pin' | 'label';
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  color: string;
  created_at: string;
};

export type VaultMemoryDetail = VaultMemory & {
  items: VaultMemoryItem[];
  decorations: VaultMemoryDecoration[];
};

export type VaultMemorySuggestion = {
  id: string;
  title: string;
  itemIds: string[];
  itemCount: number;
  items: VaultItem[];
  reason: string;
};

export type ImportProgress = {
  phase: string;
  current: number;
  total: number;
  fileName?: string;
  imported?: number;
  matchedMetadata?: number;
  skipped?: number;
};

declare global {
  interface Window {
    vaultApi: {
      getAppVersion: () => Promise<string>;
      getLicenseStatus: () => Promise<LicenseStatus>;
      activateLicense: (key: string) => Promise<LicenseStatus>;
      getLogs: () => Promise<{ path: string; text: string }>;
      openLogs: () => Promise<{ ok: boolean; path: string }>;
      openVaultDataFolder: () => Promise<{ ok: boolean; path: string }>;
      openExternal: (url: string) => Promise<{ ok: boolean }>;
      getDashboardSummary: () => Promise<{ totalItems: number; notes: number; files: number; photos: number; videos: number; audio: number; googlePhotos: number; locations: number; favorites: number; collections: number; tags: number; relationships: number; memories: number; recentItems: VaultItem[] }>;
      getPathForFile: (file: File) => string;
      listItems: (args?: { search?: string; tag?: string; type?: string; collectionId?: string; mediaOnly?: boolean; imageOnly?: boolean; videoOnly?: boolean; audioOnly?: boolean; documentOnly?: boolean; favoriteOnly?: boolean; limit?: number; offset?: number; sort?: string }) => Promise<VaultItem[]>;
      getItem: (id: string) => Promise<VaultItem | null>;
      listTags: () => Promise<{ id?: string; name: string; count?: number }[]>;
      createTag: (name: string) => Promise<{ id: string; name: string }>;
      renameTag: (oldName: string, newName: string) => Promise<{ ok: boolean }>;
      deleteTag: (name: string) => Promise<{ ok: boolean }>;
      listCollections: () => Promise<{ id: string; name: string; mode?: string; parent_id?: string; created_at: string; count?: number; child_count?: number; note_count?: number; image_count?: number; video_count?: number; audio_count?: number; document_count?: number }[]>;
      createCollection: (args: string | { name: string; mode?: string; parentId?: string }) => Promise<{ id: string; name: string; mode?: string; parent_id?: string; created_at: string }>;
      setCollectionParent: (args: { id: string; parentId: string }) => Promise<{ ok: boolean }>;
      deleteCollection: (id: string) => Promise<{ ok: boolean }>;
      listRelationships: (itemId: string) => Promise<VaultRelationship[]>;
      listAllRelationships: () => Promise<VaultRelationshipSummary[]>;
      listMemories: () => Promise<VaultMemory[]>;
      getMemory: (id: string) => Promise<VaultMemoryDetail | null>;
      listMemorySuggestions: () => Promise<VaultMemorySuggestion[]>;
      createMemory: (args: { title: string; description?: string; theme?: string; itemIds?: string[] }) => Promise<VaultMemoryDetail>;
      deleteMemory: (id: string) => Promise<{ ok: boolean }>;
      updateMemory: (args: { id: string; title?: string; description?: string; theme?: string; coverItemId?: string }) => Promise<VaultMemoryDetail>;
      updateMemoryPlayerPosition: (args: { id: string; x: number; y: number }) => Promise<VaultMemoryDetail>;
      addItemToMemory: (args: { memoryId: string; itemId: string }) => Promise<VaultMemoryDetail>;
      removeItemFromMemory: (args: { memoryId: string; itemId: string }) => Promise<VaultMemoryDetail | null>;
      updateMemoryLayout: (args: { memoryId: string; items: { itemId: string; x: number; y: number; width?: number; height?: number }[] }) => Promise<VaultMemoryDetail>;
      addMemoryDecoration: (args: { memoryId: string; kind: string; label?: string; color?: string }) => Promise<VaultMemoryDetail>;
      updateMemoryDecoration: (args: { memoryId: string; id: string; x?: number; y?: number; width?: number; height?: number; rotation?: number; label?: string; color?: string }) => Promise<VaultMemoryDetail>;
      removeMemoryDecoration: (args: { memoryId: string; id: string }) => Promise<VaultMemoryDetail | null>;
      listLocations: () => Promise<{ location: string; latitude?: number; longitude?: number; count: number; examples: { id: string; title: string; fileName?: string | null }[] }[]>;
      getMapTileBaseUrl: () => Promise<string>;
      downloadMapTiles: (tiles: { z: number; x: number; y: number }[]) => Promise<{ downloaded: number; skipped: number; total: number; baseUrl: string }>;
      addRelationship: (args: { itemId: string; relatedItemId: string; note?: string }) => Promise<VaultRelationship[]>;
      removeRelationship: (args: { itemId: string; relatedItemId: string }) => Promise<VaultRelationship[]>;
      createNote: (args: { title: string; body?: string; tags?: string[] | string; collectionIds?: string[] }) => Promise<VaultItem>;
      updateItem: (args: { id: string; title?: string; body?: string; tags?: string[] | string; favorite?: boolean; private?: boolean; imageRotation?: number; createdAt?: string; collectionIds?: string[] }) => Promise<VaultItem>;
      deleteItem: (id: string) => Promise<{ ok: boolean }>;
      deleteItems: (ids: string[]) => Promise<{ deleted: number }>;
      addTagsToItems: (ids: string[], tags: string[]) => Promise<{ updated: number }>;
      removeTagsFromItems: (ids: string[], tags: string[]) => Promise<{ updated: number }>;
      addCollectionToItems: (ids: string[], collectionId: string) => Promise<{ updated: number }>;
      previewImport: (files: { sourcePath: string; relativePath?: string }[]) => Promise<ImportPreview[]>;
      importGooglePhotosTakeout: () => Promise<{ canceled: boolean; imported?: number; matchedMetadata?: number; skipped?: number; duplicateSkipped?: number; zipCount?: number; collectionId?: string; lastItem?: VaultItem | null }>;
      importNotionExport: (args?: { sourceType?: 'zip' | 'folder' }) => Promise<{ canceled: boolean; importedNotes?: number; importedFiles?: number; relationships?: number; duplicateSkipped?: number; collectionCount?: number; lastItem?: VaultItem | null }>;
      repairGooglePhotosMetadata: () => Promise<{ canceled: boolean; zipCount?: number; metadataFiles?: number; metadataKeys?: number; scannedItems?: number; matched?: number; updated?: number; unmatched?: number; matchedExamples?: string[]; unmatchedExamples?: string[]; unmatchedDetails?: string[] }>;
      onGooglePhotosImportProgress: (callback: (progress: ImportProgress) => void) => () => void;
      onBackupImportProgress: (callback: (progress: ImportProgress) => void) => () => void;
      uploadFile: (args: { sourcePath: string; title?: string; body?: string; tags?: string[] | string; collectionIds?: string[] }) => Promise<VaultItem>;
      getMediaUrl: (id: string) => Promise<string>;
      openFile: (id: string) => Promise<{ ok: boolean }>;
      reindexFiles: () => Promise<{ indexed: number }>;
      exportBackup: () => Promise<{ canceled: boolean; path?: string }>;
      openBackupFolder: () => Promise<{ ok: boolean; path: string }>;
      getBackupSettings: () => Promise<{ backupDirectory: string; backupFrequency: 'on-close' | 'daily' | 'weekly' | 'never'; backupRetentionCount: number; startupView: 'dashboard' | 'workbench' | 'note' | 'photo' | 'music'; allowNewImportTagSuggestions: boolean; backupEncryptionEnabled: boolean; backupEncryptionAvailable: boolean; backupStats: BackupStats }>;
      chooseBackupFolder: () => Promise<{ canceled: boolean; path?: string; backupDirectory?: string; backupFrequency?: string; backupRetentionCount?: number; startupView?: 'dashboard' | 'workbench' | 'note' | 'photo' | 'music'; allowNewImportTagSuggestions?: boolean; backupStats?: BackupStats }>;
      setBackupFrequency: (frequency: 'on-close' | 'daily' | 'weekly' | 'never') => Promise<{ backupDirectory: string; backupFrequency: string; backupRetentionCount: number; startupView: 'dashboard' | 'workbench' | 'note' | 'photo' | 'music'; allowNewImportTagSuggestions: boolean; backupStats: BackupStats }>;
      setBackupRetentionCount: (count: number) => Promise<{ backupDirectory: string; backupFrequency: string; backupRetentionCount: number; startupView: 'dashboard' | 'workbench' | 'note' | 'photo' | 'music'; allowNewImportTagSuggestions: boolean; backupStats: BackupStats; deleted: number }>;
      setBackupEncryption: (args: { enabled: boolean; password?: string }) => Promise<{ backupDirectory: string; backupFrequency: string; backupRetentionCount: number; startupView: 'dashboard' | 'workbench' | 'note' | 'photo' | 'music'; allowNewImportTagSuggestions: boolean; backupEncryptionEnabled: boolean; backupEncryptionAvailable: boolean; backupStats: BackupStats }>;
      setImportTagSuggestions: (allowNewTags: boolean) => Promise<{ backupDirectory: string; backupFrequency: string; backupRetentionCount: number; startupView: 'dashboard' | 'workbench' | 'note' | 'photo' | 'music'; allowNewImportTagSuggestions: boolean; backupStats: BackupStats }>;
      setStartupView: (startupView: 'dashboard' | 'workbench' | 'note' | 'photo' | 'music') => Promise<{ backupDirectory: string; backupFrequency: string; backupRetentionCount: number; startupView: 'dashboard' | 'workbench' | 'note' | 'photo' | 'music'; allowNewImportTagSuggestions: boolean; backupStats: BackupStats }>;
      importBackup: (args?: { password?: string }) => Promise<{ canceled: boolean; imported?: boolean }>;
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
