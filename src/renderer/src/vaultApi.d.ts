export type VaultItem = {
  id: string;
  title: string;
  type: 'note' | 'file';
  body: string;
  file_name?: string | null;
  file_stored_name?: string | null;
  file_ext?: string | null;
  extracted_text?: string;
  favorite: boolean;
  created_at: string;
  updated_at: string;
  tags: string[];
  file_path?: string | null;
};

declare global {
  interface Window {
    vaultApi: {
      getPathForFile: (file: File) => string;
      listItems: (args?: { search?: string; tag?: string; type?: string }) => Promise<VaultItem[]>;
      listTags: () => Promise<{ name: string }[]>;
      createNote: (args: { title: string; body?: string; tags?: string[] | string }) => Promise<VaultItem>;
      updateItem: (args: { id: string; title?: string; body?: string; tags?: string[] | string; favorite?: boolean }) => Promise<VaultItem>;
      deleteItem: (id: string) => Promise<{ ok: boolean }>;
      uploadFile: (args: { sourcePath: string; title?: string; body?: string; tags?: string[] | string }) => Promise<VaultItem>;
      openFile: (id: string) => Promise<{ ok: boolean }>;
      exportBackup: () => Promise<{ canceled: boolean; path?: string }>;
      importBackup: () => Promise<{ canceled: boolean; imported?: boolean }>;
    };
  }
}
