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
  favorite: boolean;
  collection_id?: string | null;
  collection_ids: string[];
  collections: { id: string; name: string }[];
  created_at: string;
  updated_at: string;
  tags: string[];
  file_path?: string | null;
};

declare global {
  interface Window {
    vaultApi: {
      getAppVersion: () => Promise<string>;
      getPathForFile: (file: File) => string;
      listItems: (args?: { search?: string; tag?: string; type?: string; collectionId?: string }) => Promise<VaultItem[]>;
      listTags: () => Promise<{ name: string }[]>;
      listCollections: () => Promise<{ id: string; name: string; created_at: string }[]>;
      createCollection: (name: string) => Promise<{ id: string; name: string; created_at: string }>;
      deleteCollection: (id: string) => Promise<{ ok: boolean }>;
      createNote: (args: { title: string; body?: string; tags?: string[] | string; collectionIds?: string[] }) => Promise<VaultItem>;
      updateItem: (args: { id: string; title?: string; body?: string; tags?: string[] | string; favorite?: boolean; collectionIds?: string[] }) => Promise<VaultItem>;
      deleteItem: (id: string) => Promise<{ ok: boolean }>;
      uploadFile: (args: { sourcePath: string; title?: string; body?: string; tags?: string[] | string; collectionIds?: string[] }) => Promise<VaultItem>;
      linkFolder: (collectionIds?: string[]) => Promise<{ canceled: boolean; linked: number; folderPath?: string; folderName?: string }>;
      openFile: (id: string) => Promise<{ ok: boolean }>;
      reindexFiles: () => Promise<{ indexed: number }>;
      exportBackup: () => Promise<{ canceled: boolean; path?: string }>;
      openBackupFolder: () => Promise<{ ok: boolean; path: string }>;
      getBackupSettings: () => Promise<{ backupDirectory: string; backupFrequency: 'on-close' | 'daily' | 'weekly' | 'never' }>;
      chooseBackupFolder: () => Promise<{ canceled: boolean; path?: string }>;
      setBackupFrequency: (frequency: 'on-close' | 'daily' | 'weekly' | 'never') => Promise<{ backupDirectory: string; backupFrequency: string }>;
      importBackup: () => Promise<{ canceled: boolean; imported?: boolean }>;
      checkForUpdates: () => Promise<{ updateAvailable: boolean; version?: string }>;
    };
  }
}
