import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'crypto';
import https from 'https';
import AdmZip from 'adm-zip';

class SimpleDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: number[] | string) {
    if (Array.isArray(init)) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = [
        init[0] ?? 1,
        init[1] ?? 0,
        init[2] ?? 0,
        init[3] ?? 1,
        init[4] ?? 0,
        init[5] ?? 0
      ];
    }
  }

  multiplySelf() {
    return this;
  }

  preMultiplySelf() {
    return this;
  }

  translateSelf() {
    return this;
  }

  scaleSelf() {
    return this;
  }

  rotateSelf() {
    return this;
  }

  invertSelf() {
    return this;
  }
}

class SimpleDOMPoint {
  constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
}

class SimpleDOMRect {
  constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
}

class SimpleImageData {
  data: Uint8ClampedArray;

  constructor(public width: number, public height: number) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

(globalThis as any).DOMMatrix ??= SimpleDOMMatrix;
(globalThis as any).DOMPoint ??= SimpleDOMPoint;
(globalThis as any).DOMRect ??= SimpleDOMRect;
(globalThis as any).ImageData ??= SimpleImageData;

const isDev = process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
let db: Database.Database;
let filesDir = '';
let backupsDir = '';
let logsDir = '';
let logPath = '';
const defaultBackupsDir = () => path.join(app.getPath('userData'), 'backups');
const maxBackupFileBytes = 1_900_000_000;
const maxHashFileBytes = 250_000_000;
type BackupFrequency = 'on-close' | 'daily' | 'weekly' | 'never';
type WatchedFolder = {
  id: string;
  path: string;
  enabled: boolean;
  seenFiles: string[];
  created_at: string;
  lastScanAt?: string;
};
type VaultSettings = {
  backupDirectory: string;
  backupFrequency: BackupFrequency;
  watchedFolders: WatchedFolder[];
  lastAutoBackupAt?: string;
  skippedReleaseTag?: string;
  lastLaunchedVersion?: string;
};
let vaultSettings: VaultSettings;

function settingsPath() {
  return path.join(app.getPath('userData'), 'vault-settings.json');
}

function writeLog(message: string, error?: unknown) {
  try {
    if (!logPath) return;
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const detail = error instanceof Error ? ` ${error.stack || error.message}` : error ? ` ${String(error)}` : '';
    fs.appendFileSync(logPath, `[${nowIso()}] ${message}${detail}\n`, 'utf8');
  } catch {
    // Avoid logging failures breaking the app.
  }
}

function loadSettings() {
  const defaults: VaultSettings = {
    backupDirectory: defaultBackupsDir(),
    backupFrequency: 'daily',
    watchedFolders: []
  };

  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    vaultSettings = { ...defaults, ...saved };
  } catch {
    vaultSettings = defaults;
  }

  vaultSettings.watchedFolders = Array.isArray(vaultSettings.watchedFolders)
    ? vaultSettings.watchedFolders.map(folder => ({
      ...folder,
      enabled: folder.enabled !== false,
      seenFiles: Array.isArray(folder.seenFiles) ? folder.seenFiles : []
    }))
    : [];
  backupsDir = vaultSettings.backupDirectory;
  fs.mkdirSync(backupsDir, { recursive: true });
}

function saveSettings() {
  fs.writeFileSync(settingsPath(), JSON.stringify(vaultSettings, null, 2), 'utf8');
}

function ensureDirs() {
  const userData = app.getPath('userData');
  filesDir = path.join(userData, 'files');
  logsDir = path.join(userData, 'logs');
  logPath = path.join(logsDir, 'vault-notes.log');
  fs.mkdirSync(filesDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
}

function initDb() {
  const dbPath = path.join(app.getPath('userData'), 'vault-notes.sqlite');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('note', 'file')),
      body TEXT DEFAULT '',
      file_name TEXT,
      file_stored_name TEXT,
      file_source_path TEXT,
      file_ext TEXT,
      extracted_text TEXT DEFAULT '',
      thumbnail_data TEXT,
      favorite INTEGER DEFAULT 0,
      private INTEGER DEFAULT 0,
      collection_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE
    );

    CREATE TABLE IF NOT EXISTS item_tags (
      item_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (item_id, tag_id),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS item_collections (
      item_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      PRIMARY KEY (item_id, collection_id),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
    );
  `);

  try {
    db.exec('ALTER TABLE items ADD COLUMN collection_id TEXT');
  } catch {
    // Existing databases already have this column after the first migration.
  }

  try {
    db.exec('ALTER TABLE items ADD COLUMN file_source_path TEXT');
  } catch {
    // Existing databases already have this column after the first migration.
  }

  try {
    db.exec('ALTER TABLE items ADD COLUMN thumbnail_data TEXT');
  } catch {
    // Existing databases already have this column after the first migration.
  }

  try {
    db.exec('ALTER TABLE items ADD COLUMN private INTEGER DEFAULT 0');
  } catch {
    // Existing databases already have this column after the first migration.
  }

  db.exec(`
    INSERT OR IGNORE INTO item_collections (item_id, collection_id)
    SELECT items.id, items.collection_id
    FROM items
    JOIN collections ON collections.id = items.collection_id
  `);
}

function nowIso() {
  return new Date().toISOString();
}

function dateStamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function safeFileName(value: string, fallback: string) {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || fallback;
}

function uniqueFileName(name: string, usedNames: Set<string>) {
  const extension = path.extname(name);
  const base = path.basename(name, extension);
  let candidate = name;
  let index = 2;

  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base} (${index})${extension}`;
    index += 1;
  }

  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function splitTags(tags: string[] | string | undefined): string[] {
  if (!tags) return [];
  const arr = Array.isArray(tags) ? tags : tags.split(',');
  return [...new Set(arr.map(t => t.trim()).filter(Boolean))];
}

function setTagsForItem(itemId: string, tagsInput: string[] | string | undefined) {
  const tags = splitTags(tagsInput);
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)');
  const getTag = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE');
  const linkTag = db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)');
  const clear = db.prepare('DELETE FROM item_tags WHERE item_id = ?');

  const trx = db.transaction(() => {
    clear.run(itemId);

    for (const tag of tags) {
      insertTag.run(randomUUID(), tag);
      const row = getTag.get(tag) as { id: string } | undefined;
      if (row) linkTag.run(itemId, row.id);
    }
  });

  trx();
  cleanupUnusedTags();
}

function cleanupUnusedTags() {
  // Keep unused tags so Settings can manage saved tag choices for future items.
}

function setCollectionsForItem(itemId: string, collectionIds: string[] | undefined) {
  if (collectionIds === undefined) return;
  const ids = [...new Set(collectionIds.filter(Boolean))];
  const clear = db.prepare('DELETE FROM item_collections WHERE item_id = ?');
  const link = db.prepare('INSERT OR IGNORE INTO item_collections (item_id, collection_id) VALUES (?, ?)');

  db.transaction(() => {
    clear.run(itemId);
    for (const collectionId of ids) link.run(itemId, collectionId);
  })();
}

function rowToItem(row: any) {
  const tagRows = db.prepare(`
    SELECT tags.name FROM tags
    JOIN item_tags ON item_tags.tag_id = tags.id
    WHERE item_tags.item_id = ?
    ORDER BY tags.name
  `).all(row.id) as { name: string }[];
  const collectionRows = db.prepare(`
    SELECT collections.id, collections.name
    FROM collections
    JOIN item_collections ON item_collections.collection_id = collections.id
    WHERE item_collections.item_id = ?
    ORDER BY collections.name
  `).all(row.id) as { id: string; name: string }[];

  return {
    ...row,
    favorite: Boolean(row.favorite),
    private: Boolean(row.private),
    tags: tagRows.map(t => t.name),
    collection_ids: collectionRows.map(collection => collection.id),
    collections: collectionRows,
    file_path: row.file_source_path || (row.file_stored_name ? path.join(filesDir, row.file_stored_name) : null)
  };
}

function getItem(id: string) {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  return row ? rowToItem(row) : null;
}

async function extractText(sourcePath: string, ext: string) {
  const safeExt = ext.toLowerCase();
  const searchable = [
    '.txt', '.md', '.markdown', '.html', '.htm', '.css', '.scss', '.sass',
    '.js', '.jsx', '.ts', '.tsx', '.json', '.jsonl', '.xml', '.yml', '.yaml',
    '.csv', '.tsv', '.log', '.ini', '.env', '.cfg', '.conf', '.toml',
    '.py', '.rb', '.php', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.go',
    '.rs', '.swift', '.kt', '.kts', '.sql', '.sh', '.bat', '.ps1', '.psm1',
    '.lua', '.r', '.pl', '.vue', '.svelte', '.astro', '.pdf', '.docx'
  ];
  if (!searchable.includes(safeExt)) return '';

  try {
    const stat = fs.statSync(sourcePath);
    if (stat.size > 20_000_000) return '';
    if (safeExt === '.pdf') {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: fs.readFileSync(sourcePath) });
      const result = await parser.getText();
      await parser.destroy();
      return result.text.slice(0, 500_000);
    }
    if (safeExt === '.docx') {
      const documentXml = new AdmZip(sourcePath).getEntry('word/document.xml');
      if (!documentXml) return '';
      return documentXml.getData().toString('utf8')
        .replace(/<w:tab\/>/g, '\t')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .slice(0, 500_000);
    }
    return fs.readFileSync(sourcePath, 'utf8').slice(0, 500_000);
  } catch {
    return '';
  }
}

function tokenizeImportText(value: string) {
  const ignored = new Set([
    'the', 'and', 'for', 'with', 'from', 'this', 'that', 'file', 'notes',
    'music', 'vault', 'copy', 'final', 'draft', 'new', 'old'
  ]);

  return [...new Set(value
    .replace(/\.[^/.\\]+$/, '')
    .split(/[^a-zA-Z0-9]+/)
    .map(part => part.trim().toLowerCase())
    .filter(part => part.length >= 3 && !ignored.has(part))
  )].slice(0, 8);
}

function suggestImportTags(sourcePath: string, relativePath = '') {
  const parts = [
    ...relativePath.split(/[\\/]+/),
    ...path.dirname(sourcePath).split(/[\\/]+/).slice(-2),
    path.basename(sourcePath)
  ];
  return tokenizeImportText(parts.join(' '));
}

function watchedFileSignature(rootPath: string, sourcePath: string) {
  const stat = fs.statSync(sourcePath);
  const relativePath = path.relative(rootPath, sourcePath) || path.basename(sourcePath);
  return `${relativePath.toLowerCase()}|${stat.size}|${Math.round(stat.mtimeMs)}`;
}

function listWatchedFolderFiles(rootPath: string, limit = 10000) {
  const files: { sourcePath: string; relativePath: string; signature: string; mtimeMs: number }[] = [];
  const ignoredDirectories = new Set(['node_modules', '.git', 'dist', 'release', 'win-unpacked']);

  const walk = (currentPath: string) => {
    if (files.length >= limit) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= limit) return;
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = fs.statSync(fullPath);
        files.push({
          sourcePath: fullPath,
          relativePath: path.relative(rootPath, fullPath) || entry.name,
          signature: `${(path.relative(rootPath, fullPath) || entry.name).toLowerCase()}|${stat.size}|${Math.round(stat.mtimeMs)}`,
          mtimeMs: stat.mtimeMs
        });
      } catch {
        // Ignore files that disappear while scanning.
      }
    }
  };

  walk(rootPath);
  return files.sort((left, right) => right.mtimeMs - left.mtimeMs);
}

function scanWatchedFolders(markSeen = false, folderId?: string) {
  const foundFiles: { sourcePath: string; relativePath: string; watchedFolderId: string; watchedFolderPath: string }[] = [];

  for (const folder of vaultSettings.watchedFolders) {
    if (!folder.enabled) continue;
    if (folderId && folder.id !== folderId) continue;
    if (!fs.existsSync(folder.path)) continue;

    const seen = new Set(folder.seenFiles || []);
    const files = listWatchedFolderFiles(folder.path);
    const newFiles = files.filter(file => !seen.has(file.signature));

    foundFiles.push(...newFiles.map(file => ({
      sourcePath: file.sourcePath,
      relativePath: file.relativePath,
      watchedFolderId: folder.id,
      watchedFolderPath: folder.path
    })));

    if (markSeen) {
      const allSeen = new Set([...seen, ...newFiles.map(file => file.signature)]);
      folder.seenFiles = [...allSeen].slice(-5000);
      folder.lastScanAt = nowIso();
    }
  }

  if (markSeen) saveSettings();
  return foundFiles;
}

function markWatchedFolderScanHandled(folderId?: string) {
  let handled = 0;

  for (const folder of vaultSettings.watchedFolders) {
    if (!folder.enabled) continue;
    if (folderId && folder.id !== folderId) continue;
    if (!fs.existsSync(folder.path)) continue;

    const seen = new Set(folder.seenFiles || []);
    const files = listWatchedFolderFiles(folder.path);
    for (const file of files) {
      if (!seen.has(file.signature)) {
        seen.add(file.signature);
        handled += 1;
      }
    }
    folder.seenFiles = [...seen].slice(-20000);
    folder.lastScanAt = nowIso();
  }

  saveSettings();
  return { ok: true, handled };
}

function markWatchedFilesSeen(files: { sourcePath: string; watchedFolderId?: string; watchedFolderPath?: string }[]) {
  let changed = false;
  for (const file of files) {
    const folder = vaultSettings.watchedFolders.find(candidate =>
      candidate.id === file.watchedFolderId ||
      (file.watchedFolderPath && candidate.path === file.watchedFolderPath) ||
      file.sourcePath.toLowerCase().startsWith(`${candidate.path.toLowerCase()}${path.sep}`)
    );
    if (!folder || !fs.existsSync(file.sourcePath)) continue;
    try {
      const signature = watchedFileSignature(folder.path, file.sourcePath);
      const seen = new Set(folder.seenFiles || []);
      if (!seen.has(signature)) {
        seen.add(signature);
        folder.seenFiles = [...seen].slice(-20000);
        changed = true;
      }
      folder.lastScanAt = nowIso();
    } catch {
      // Ignore files that disappear while marking.
    }
  }
  if (changed) saveSettings();
  return { ok: true };
}

function fileHash(sourcePath: string) {
  try {
    const stat = fs.statSync(sourcePath);
    if (stat.size > maxHashFileBytes) {
      return '';
    }
    const hash = createHash('sha256');
    hash.update(fs.readFileSync(sourcePath));
    return hash.digest('hex');
  } catch {
    return '';
  }
}

function createRestoreBackup(targetPath: string) {
  const items = db.prepare('SELECT * FROM items ORDER BY created_at').all();
  const tags = db.prepare('SELECT * FROM tags ORDER BY name').all();
  const itemTags = db.prepare('SELECT * FROM item_tags').all();
  const collections = db.prepare('SELECT * FROM collections ORDER BY name').all();
  const itemCollections = db.prepare('SELECT * FROM item_collections').all();
  const backup = {
    app: 'Vault Notes',
    version: 1,
    exported_at: nowIso(),
    items,
    tags,
    item_tags: itemTags,
    collections,
    item_collections: itemCollections
  };

  const zip = new AdmZip();
  zip.addFile('backup.json', Buffer.from(JSON.stringify(backup, null, 2), 'utf8'));
  const skippedFiles: { item_id: string; file_name: string; reason: string; size?: number }[] = [];

  for (const item of items as any[]) {
    if (!item.file_stored_name) continue;
    const filePath = path.join(filesDir, item.file_stored_name);
    if (!fs.existsSync(filePath)) continue;
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > maxBackupFileBytes) {
        skippedFiles.push({
          item_id: item.id,
          file_name: item.file_name || item.file_stored_name,
          reason: 'File is too large for ZIP backup.',
          size: stat.size
        });
        writeLog(`Backup skipped oversized file: ${item.file_name || item.file_stored_name} (${stat.size} bytes)`);
        continue;
      }
      zip.addLocalFile(filePath, 'files');
    } catch (error) {
      skippedFiles.push({
        item_id: item.id,
        file_name: item.file_name || item.file_stored_name,
        reason: error instanceof Error ? error.message : String(error)
      });
      writeLog(`Backup skipped file: ${item.file_name || item.file_stored_name}`, error);
    }
  }

  if (skippedFiles.length > 0) {
    zip.addFile('backup-skipped-files.json', Buffer.from(JSON.stringify(skippedFiles, null, 2), 'utf8'));
  }

  zip.writeZip(targetPath);
}

function createAutoBackupIfNeeded() {
  if (vaultSettings.backupFrequency === 'never') return null;

  const lastBackup = vaultSettings.lastAutoBackupAt ? new Date(vaultSettings.lastAutoBackupAt) : null;
  const elapsed = lastBackup ? Date.now() - lastBackup.getTime() : Number.POSITIVE_INFINITY;
  const interval = vaultSettings.backupFrequency === 'weekly'
    ? 7 * 24 * 60 * 60 * 1000
    : 24 * 60 * 60 * 1000;

  if (vaultSettings.backupFrequency !== 'on-close' && elapsed < interval) return null;

  fs.mkdirSync(backupsDir, { recursive: true });
  const targetPath = path.join(backupsDir, `vault-notes-auto-${dateStamp()}.vaultbackup`);
  try {
    createRestoreBackup(targetPath);
  } catch (error) {
    writeLog('Automatic backup failed', error);
    return null;
  }
  vaultSettings.lastAutoBackupAt = nowIso();
  saveSettings();
  return targetPath;
}

function compareVersions(left: string, right: string) {
  const parse = (value: string) => value.replace(/^v/i, '').split('.').map(part => Number.parseInt(part, 10) || 0);
  const leftParts = parse(left);
  const rightParts = parse(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }

  return 0;
}

type ReleaseAsset = { name: string; url: string };
type GithubRelease = { tagName: string; url: string; assets: ReleaseAsset[] };

const whatsNewByVersion: Record<string, string[]> = {
  '1.3.0-beta.1': [
    'Watched Folders can monitor local folders and surface new files for review.',
    'New watched-folder files open in the existing import review wizard before anything is added.',
    'This is a prerelease test build and is not offered by the normal updater.'
  ],
  '1.2.41': [
    'The Library now has Cards, Compact, and Grid view modes for the middle item pane.',
    'The item detail pane is organized into Preview, Notes, and Info tabs.',
    'Focus mode can hide the middle list so the selected item has more room.'
  ],
  '1.2.40': [
    'Search result card titles and the app brand now stay readable in dark mode.',
    'Dashboard Tags now opens the Settings Tags tab.',
    'Tag assignment counts can be clicked to search items with that tag.'
  ],
  '1.2.39': [
    'Settings now has separate General, Tags, and Logs tabs.',
    'Tags refresh when Settings opens and fall back to saved tag names if counts are unavailable.',
    'The Search page title now stays white in dark mode.'
  ],
  '1.2.38': [
    'Logs and Tags now get dedicated full-width space in Settings.',
    'The tag manager now shows how many items are assigned to each tag.',
    'Tag cleanup is easier with a wider grid-style tag manager.'
  ],
  '1.2.37': [
    'Large uploads now show clearer progress while files are prepared and imported.',
    'Settings now includes a tag manager for adding, renaming, and deleting saved tags.',
    'Saved tags can exist before they are assigned to items.'
  ],
  '1.2.36': [
    'Settings in light mode now uses light cards again.',
    'Selected items in dark mode have stronger contrast so titles, previews, and tags stay readable.',
    'Items can now be marked Private to mask their preview text in library and search result lists.'
  ],
  '1.2.35': [
    'Import review skip/import controls now target the exact file row more reliably.',
    'Settings now includes a Logs card with recent app startup and error details.',
    'Collection editing is cleaner with simple per-item collection buttons and bulk Edit Collections.'
  ],
  '1.2.34': [
    'The import wizard now shows summary counts for selected files, duplicates, and name conflicts.',
    'Import review can be filtered by ready files, duplicates, name conflicts, images, or PDFs.',
    'Tags and collections can now be applied to all selected import files at once.'
  ],
  '1.2.33': [
    'Import duplicate checks now compare file contents, not just filenames.',
    'Exact duplicate files are skipped by default and explain which vault item they match.',
    'Same-name files with different contents stay selected and show a clearer warning.'
  ],
  '1.2.32': [
    'Search results now show match snippets with highlighted search terms.',
    'File previews are richer, including image previews and readable file text inside the app.',
    'Uploads and folder imports now open a review wizard with suggested tags, collections, duplicate warnings, and preview text.'
  ],
  '1.2.31': [
    'Multi-selected card highlights now remain visible across every item in a selected range.'
  ],
  '1.2.30': [
    'Shift and Ctrl+Shift selection now use a reliable anchor and select the full range of cards between clicks.'
  ],
  '1.2.29': [
    'Multi-selected library cards now use a clean highlight without in-card checkmarks.'
  ],
  '1.2.28': [
    'Fixed the Edit button so note fields remain editable after opening edit mode.'
  ],
  '1.2.27': [
    'Restored the original direct tag controls on individual notes and files.',
    'The unified Edit Tags experience remains available for bulk item changes.'
  ],
  '1.2.26': [
    'Bulk tags now use one Edit Tags picker instead of separate add and remove actions.',
    'Existing tags are shown as checked, with usage counts across the selected items.',
    'Only tag choices you change are applied when saving.'
  ],
  '1.2.25': [
    'Collections now use the same unified edit-picker pattern as tags.',
    'Current collections are shown as a simple summary and can be changed from one matching dropdown.'
  ],
  '1.2.24': [
    'Editing tags is now handled through one unified picker with current tags pre-selected.',
    'The tag picker lets you toggle saved tags or create a new tag without separate add and remove controls.'
  ],
  '1.2.23': [
    'Sidebar and library pane sizes now persist after restarting the app.'
  ],
  '1.2.22': [
    'Bulk tag actions now show tags already used by the selected items.',
    'Remove Tags only offers tags that are actually present on the current selection.',
    'Tag usage counts show how many selected items have each tag.'
  ],
  '1.2.21': [
    'Uploaded files now open ready to edit their title, tags, and collections.',
    'Bulk actions can remove tags as well as add them.',
    'The Library can be sorted by date, title, or tags, and modifier-click selection follows Windows-style ranges.'
  ],
  '1.2.20': [
    'Image uploads now receive local thumbnail previews.',
    'Image thumbnails appear in the Library, Search, and Dashboard recent-items list.',
    'Existing image files are indexed for thumbnails automatically when the app starts.'
  ],
  '1.2.19': [
    'Arrow-key navigation now keeps the active library item in view.',
    'The sidebar and library list can be resized by dragging their dividers.',
    'Scrollbars have been restyled to match the vault interface.'
  ],
  '1.2.18': [
    'Vault Dashboard is now the app’s home screen, with a quick view of your vault.',
    'Open recent notes and files directly from the dashboard.',
    'Dashboard cards provide quick paths into notes, files, search, and collections.'
  ],
  '1.2.17': [
    'Collections return to a simple, focused list.',
    'Vault Notes now shows What’s New after an update, including upgrades from older versions.',
    'Search previews and collection filtering remain available.'
  ]
};

async function showWhatsNewIfUpdated() {
  const currentVersion = app.getVersion();
  const previousVersion = vaultSettings.lastLaunchedVersion;
  const changes = whatsNewByVersion[currentVersion] || ['General improvements and fixes.'];

  if (previousVersion !== currentVersion) {
    await dialog.showMessageBox(mainWindow!, {
      type: 'info',
      title: 'Vault Notes updated',
      message: `You’re now using Vault Notes v${currentVersion}.`,
      detail: `What’s new:\n\n${changes.map(change => `• ${change}`).join('\n')}`,
      buttons: ['Got it'],
      defaultId: 0
    });
  }

  if (previousVersion !== currentVersion) {
    vaultSettings.lastLaunchedVersion = currentVersion;
    saveSettings();
  }
}

const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.ico']);

function createThumbnailData(sourcePath: string, ext: string) {
  if (!imageExtensions.has(ext.toLowerCase())) return null;
  try {
    const image = nativeImage.createFromPath(sourcePath);
    if (image.isEmpty()) return null;
    return image.resize({ width: 320, quality: 'good' }).toDataURL();
  } catch {
    return null;
  }
}

function generateMissingImageThumbnails(limit = 75) {
  const imageItems = db.prepare(`
    SELECT id, file_stored_name, file_source_path, file_ext
    FROM items
    WHERE type = 'file' AND thumbnail_data IS NULL
    LIMIT ?
  `).all(limit) as { id: string; file_stored_name?: string; file_source_path?: string; file_ext?: string }[];
  const update = db.prepare('UPDATE items SET thumbnail_data = ? WHERE id = ?');
  for (const item of imageItems) {
    const sourcePath = item.file_source_path || (item.file_stored_name ? path.join(filesDir, item.file_stored_name) : '');
    if (!sourcePath || !fs.existsSync(sourcePath)) continue;
    const thumbnail = createThumbnailData(sourcePath, item.file_ext || path.extname(sourcePath));
    if (thumbnail) update.run(thumbnail, item.id);
  }
}

function fetchLatestRelease(): Promise<GithubRelease | null> {
  return new Promise(resolve => {
    const request = https.get('https://api.github.com/repos/xyciasav/note_vault/releases/latest', {
      headers: { 'User-Agent': 'Vault-Notes' }
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) return resolve(null);
        try {
          const release = JSON.parse(body);
          const assets = Array.isArray(release.assets)
            ? release.assets.map((asset: any) => ({ name: asset.name, url: asset.browser_download_url }))
            : [];
          resolve(release.tag_name && release.html_url ? { tagName: release.tag_name, url: release.html_url, assets } : null);
        } catch {
          resolve(null);
        }
      });
    });

    request.setTimeout(5000, () => {
      request.destroy();
      resolve(null);
    });
    request.on('error', () => resolve(null));
  });
}

function downloadReleaseAsset(asset: ReleaseAsset) {
  if (!mainWindow) return;
  const targetPath = path.join(app.getPath('downloads'), safeFileName(asset.name, 'vault-notes-update.exe'));
  const session = mainWindow.webContents.session;

  const onWillDownload = (_event: Electron.Event, item: Electron.DownloadItem, webContents: Electron.WebContents) => {
    if (webContents !== mainWindow?.webContents) return;
    item.setSavePath(targetPath);
    item.once('done', async (_doneEvent, state) => {
      session.removeListener('will-download', onWillDownload);
      if (state === 'completed') {
        await shell.openPath(targetPath);
      } else {
        await dialog.showMessageBox(mainWindow!, { type: 'error', message: 'The update download did not finish.' });
      }
    });
  };

  session.on('will-download', onWillDownload);
  mainWindow.webContents.downloadURL(asset.url);
}

async function checkForUpdates(showCurrent = false) {
  const release = await fetchLatestRelease();
  if (!release || compareVersions(release.tagName, app.getVersion()) <= 0 || (!showCurrent && vaultSettings.skippedReleaseTag === release.tagName)) {
    if (showCurrent) await dialog.showMessageBox(mainWindow!, { type: 'info', message: 'Vault Notes is up to date.' });
    return { updateAvailable: false };
  }

  const result = await dialog.showMessageBox(mainWindow!, {
    type: 'info',
    message: `Vault Notes ${release.tagName} is available. You are using ${app.getVersion()}.`,
    detail: 'Download the update now, skip this version, or decide later.',
    buttons: [release.assets.some(asset => /\.(exe|msi)$/i.test(asset.name)) ? 'Download update' : 'Open download page', 'Skip this version', 'Later'],
    defaultId: 0,
    cancelId: 2
  });

  if (result.response === 0) {
    const installer = release.assets.find(asset => /\.(exe|msi)$/i.test(asset.name));
    if (installer) downloadReleaseAsset(installer);
    else await shell.openExternal(release.url);
  }
  if (result.response === 1) {
    vaultSettings.skippedReleaseTag = release.tagName;
    saveSettings();
  }

  return { updateAvailable: true, version: release.tagName };
}

function createReadableExport(targetPath: string) {
  const items = db.prepare('SELECT * FROM items ORDER BY created_at').all().map(rowToItem);
  const zip = new AdmZip();
  const root = 'Music Notes Vault Export';
  const usedNoteNames = new Set<string>();
  const usedFileNames = new Set<string>();
  const indexEntries: string[] = [];

  for (const item of items as any[]) {
    if (item.type === 'note') {
      const noteName = uniqueFileName(
        `${safeFileName(item.title || 'Untitled note', 'Untitled note')}.md`,
        usedNoteNames
      );
      const tags = item.tags.length ? item.tags.join(', ') : 'None';
      const markdown = `# ${item.title || 'Untitled note'}\n\n` +
        `- Tags: ${tags}\n` +
        `- Created: ${item.created_at}\n` +
        `- Updated: ${item.updated_at}\n` +
        `- Favorite: ${item.favorite ? 'Yes' : 'No'}\n\n` +
        (item.body || '');
      zip.addFile(`${root}/Notes/${noteName}`, Buffer.from(markdown, 'utf8'));
      indexEntries.push(`<li><a href="Notes/${encodeURIComponent(noteName)}">${escapeHtml(item.title || 'Untitled note')}</a> <small>${escapeHtml(tags)}</small></li>`);
      continue;
    }

    const sourcePath = item.file_source_path || (item.file_stored_name ? path.join(filesDir, item.file_stored_name) : '');
    if (!fs.existsSync(sourcePath)) continue;
    const fileName = uniqueFileName(safeFileName(item.file_name || item.title || 'Uploaded file', 'Uploaded file'), usedFileNames);
    zip.addLocalFile(sourcePath, `${root}/Files`, fileName);
    const tags = item.tags.length ? item.tags.join(', ') : 'None';
    indexEntries.push(`<li><a href="Files/${encodeURIComponent(fileName)}">${escapeHtml(item.title || fileName)}</a> <small>${escapeHtml(tags)}</small></li>`);
  }

  const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Music Notes Vault Export</title>
  <style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.5;color:#1f2937}h1{margin-bottom:0}small{color:#6b7280;margin-left:.5rem}li{margin:.5rem 0}a{color:#2563eb}</style>
</head>
<body>
  <h1>Music Notes Vault Export</h1>
  <p>Created ${escapeHtml(nowIso())}. Notes are in <code>Notes</code>; uploaded files are in <code>Files</code>.</p>
  <ul>${indexEntries.join('')}</ul>
</body>
</html>`;
  zip.addFile(`${root}/index.html`, Buffer.from(indexHtml, 'utf8'));
  zip.writeZip(targetPath);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 980,
    title: 'Vault Notes',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
   mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  ensureDirs();
  writeLog(`Vault Notes starting v${app.getVersion()}`);
  loadSettings();
  initDb();
  createWindow();
  setTimeout(() => {
    createAutoBackupIfNeeded();
  }, 12_000);
  setTimeout(() => {
    try {
      generateMissingImageThumbnails();
    } catch (error) {
      writeLog('Background thumbnail generation failed', error);
    }
  }, 4_000);
  mainWindow?.once('ready-to-show', async () => {
    await showWhatsNewIfUpdated().catch(() => undefined);
    checkForUpdates().catch(() => undefined);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (db) createAutoBackupIfNeeded();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', error => {
  writeLog('Uncaught exception', error);
});

process.on('unhandledRejection', reason => {
  writeLog('Unhandled promise rejection', reason);
});

ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:getLogs', () => {
  if (!logPath || !fs.existsSync(logPath)) return { path: logPath, text: 'No logs yet.' };
  return { path: logPath, text: fs.readFileSync(logPath, 'utf8').slice(-80_000) };
});

ipcMain.handle('app:openLogs', async () => {
  fs.mkdirSync(logsDir, { recursive: true });
  const error = await shell.openPath(logsDir);
  if (error) throw new Error(error);
  return { ok: true, path: logsDir };
});

ipcMain.handle('dashboard:summary', () => {
  const count = (where = '', params: unknown[] = []) =>
    (db.prepare(`SELECT COUNT(*) AS total FROM items ${where}`).get(...params) as { total: number }).total;

  return {
    totalItems: count(),
    notes: count("WHERE type = 'note'"),
    files: count("WHERE type = 'file'"),
    favorites: count('WHERE favorite = 1'),
    collections: (db.prepare('SELECT COUNT(*) AS total FROM collections').get() as { total: number }).total,
    tags: (db.prepare('SELECT COUNT(*) AS total FROM tags').get() as { total: number }).total,
    recentItems: (db.prepare('SELECT * FROM items ORDER BY updated_at DESC LIMIT 6').all() as any[]).map(rowToItem)
  };
});

ipcMain.handle('items:list', (_event, args: { search?: string; tag?: string; type?: string; collectionId?: string } = {}) => {
  const search = (args.search || '').trim().toLowerCase();
  const tag = (args.tag || '').trim();
  const type = (args.type || '').trim();
  const collectionId = (args.collectionId || '').trim();

  let rows = db.prepare('SELECT * FROM items ORDER BY updated_at DESC').all() as any[];
  let items = rows.map(rowToItem);

  if (type && type !== 'all') items = items.filter(item => item.type === type);
  if (collectionId) items = items.filter(item => item.collection_ids.includes(collectionId));
  if (tag) items = items.filter(item => item.tags.some((t: string) => t.toLowerCase() === tag.toLowerCase()));
  if (search) {
    items = items.filter(item => {
      const haystack = [
        item.title,
        item.body,
        item.file_name,
        item.extracted_text,
        ...(item.tags || [])
      ].join(' ').toLowerCase();
      return haystack.includes(search);
    });
  }

  return items;
});

ipcMain.handle('tags:list', () => {
  return db.prepare(`
    SELECT tags.id, tags.name, COUNT(item_tags.item_id) AS count
    FROM tags
    LEFT JOIN item_tags ON item_tags.tag_id = tags.id
    GROUP BY tags.id, tags.name
    ORDER BY tags.name
  `).all();
});

ipcMain.handle('tags:create', (_event, name: string) => {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error('Tag name is required');
  db.prepare('INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)').run(randomUUID(), trimmedName);
  return db.prepare('SELECT id, name FROM tags WHERE name = ? COLLATE NOCASE').get(trimmedName);
});

ipcMain.handle('tags:rename', (_event, args: { oldName: string; newName: string }) => {
  const oldName = args.oldName.trim();
  const newName = args.newName.trim();
  if (!oldName || !newName) throw new Error('Both tag names are required');
  const oldTag = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(oldName) as { id: string } | undefined;
  if (!oldTag) throw new Error('Tag not found');
  const existing = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(newName) as { id: string } | undefined;

  db.transaction(() => {
    if (existing && existing.id !== oldTag.id) {
      db.prepare('UPDATE OR IGNORE item_tags SET tag_id = ? WHERE tag_id = ?').run(existing.id, oldTag.id);
      db.prepare('DELETE FROM tags WHERE id = ?').run(oldTag.id);
    } else {
      db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(newName, oldTag.id);
    }
  })();

  cleanupUnusedTags();
  return { ok: true };
});

ipcMain.handle('tags:delete', (_event, name: string) => {
  const trimmedName = name.trim();
  const tag = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(trimmedName) as { id: string } | undefined;
  if (!tag) return { ok: true };
  db.transaction(() => {
    db.prepare('DELETE FROM item_tags WHERE tag_id = ?').run(tag.id);
    db.prepare('DELETE FROM tags WHERE id = ?').run(tag.id);
  })();
  return { ok: true };
});

ipcMain.handle('collections:list', () => {
  return db.prepare('SELECT * FROM collections ORDER BY name').all();
});

ipcMain.handle('collections:create', (_event, name: string) => {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error('Collection name is required');
  const collection = { id: randomUUID(), name: trimmedName, created_at: nowIso() };
  db.prepare('INSERT INTO collections (id, name, created_at) VALUES (@id, @name, @created_at)').run(collection);
  return collection;
});

ipcMain.handle('collections:delete', (_event, id: string) => {
  db.prepare('DELETE FROM item_collections WHERE collection_id = ?').run(id);
  db.prepare('UPDATE items SET collection_id = NULL WHERE collection_id = ?').run(id);
  db.prepare('DELETE FROM collections WHERE id = ?').run(id);
  return { ok: true };
});

ipcMain.handle('items:createNote', (_event, args: { title: string; body?: string; tags?: string[] | string; collectionIds?: string[] }) => {
  const id = randomUUID();
  const ts = nowIso();
  db.prepare(`
    INSERT INTO items (id, title, type, body, created_at, updated_at)
    VALUES (?, ?, 'note', ?, ?, ?)
  `).run(id, args.title || 'Untitled note', args.body || '', ts, ts);
  setTagsForItem(id, args.tags);
  setCollectionsForItem(id, args.collectionIds);
  return getItem(id);
});

ipcMain.handle('items:update', (_event, args: { id: string; title?: string; body?: string; tags?: string[] | string; favorite?: boolean; private?: boolean; collectionIds?: string[] }) => {
  const existing = getItem(args.id);
  if (!existing) throw new Error('Item not found');

  db.prepare(`
    UPDATE items
    SET title = ?, body = ?, favorite = ?, private = ?, updated_at = ?
    WHERE id = ?
  `).run(
    args.title ?? existing.title,
    args.body ?? existing.body,
    args.favorite === undefined ? Number(existing.favorite) : Number(args.favorite),
    args.private === undefined ? Number(existing.private) : Number(args.private),
    nowIso(),
    args.id
  );

  if (args.tags !== undefined) setTagsForItem(args.id, args.tags);
  setCollectionsForItem(args.id, args.collectionIds);
  return getItem(args.id);
});

ipcMain.handle('items:delete', (_event, id: string) => {
  const item = getItem(id);
  if (!item) return { ok: true };
  if (item.file_stored_name) {
    const target = path.join(filesDir, item.file_stored_name);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
  db.prepare('DELETE FROM items WHERE id = ?').run(id);
  cleanupUnusedTags();
  return { ok: true };
});

ipcMain.handle('items:deleteMany', (_event, ids: string[]) => {
  const deleteItem = db.prepare('DELETE FROM items WHERE id = ?');
  const removeLinks = db.prepare('DELETE FROM item_collections WHERE item_id = ?');
  const removeTags = db.prepare('DELETE FROM item_tags WHERE item_id = ?');

  const transaction = db.transaction(() => {
    for (const id of ids) {
      const item = getItem(id);
      if (!item) continue;
      if (item.file_stored_name) {
        const target = path.join(filesDir, item.file_stored_name);
        if (fs.existsSync(target)) fs.unlinkSync(target);
      }
      removeLinks.run(id);
      removeTags.run(id);
      deleteItem.run(id);
    }
  });

  transaction();
  cleanupUnusedTags();
  return { deleted: ids.length };
});

ipcMain.handle('items:addTags', (_event, ids: string[], tags: string[] | string) => {
  for (const id of ids) {
    const item = getItem(id);
    if (!item) continue;
    setTagsForItem(id, [...item.tags, ...splitTags(tags)]);
  }
  return { updated: ids.length };
});

ipcMain.handle('items:removeTags', (_event, ids: string[], tags: string[] | string) => {
  const tagsToRemove = new Set(splitTags(tags).map(tag => tag.toLowerCase()));
  let updated = 0;
  for (const id of ids) {
    const item = getItem(id);
    if (!item) continue;
    setTagsForItem(id, item.tags.filter((tag: string) => !tagsToRemove.has(tag.toLowerCase())));
    updated += 1;
  }
  cleanupUnusedTags();
  return { updated };
});

ipcMain.handle('items:addCollection', (_event, ids: string[], collectionId: string) => {
  const collection = db.prepare('SELECT id FROM collections WHERE id = ?').get(collectionId);
  if (!collection) throw new Error('Collection not found');

  let updated = 0;
  for (const id of ids) {
    const item = getItem(id);
    if (!item) continue;
    setCollectionsForItem(id, [...item.collection_ids, collectionId]);
    updated += 1;
  }
  return { updated };
});

ipcMain.handle('items:previewImport', async (_event, files: { sourcePath: string; relativePath?: string }[]) => {
  const existingFiles = db.prepare(`
    SELECT id, title, file_name, file_stored_name, file_source_path, file_ext
    FROM items
    WHERE type = 'file' AND file_name IS NOT NULL
  `).all() as { id: string; title: string; file_name: string; file_stored_name?: string; file_source_path?: string; file_ext?: string }[];

  const existingByName = new Map<string, typeof existingFiles>();

  for (const existing of existingFiles) {
    const nameKey = existing.file_name.toLowerCase();
    existingByName.set(nameKey, [...(existingByName.get(nameKey) || []), existing]);
  }

  const previews = [];
  const incomingFiles = files.slice(0, 500);
  const useExactHashCheck = incomingFiles.length <= 25;
  for (const file of incomingFiles) {
    if (!file.sourcePath || !fs.existsSync(file.sourcePath)) continue;
    const stat = fs.statSync(file.sourcePath);
    if (!stat.isFile()) continue;

    const originalName = path.basename(file.sourcePath);
    const ext = path.extname(originalName).toLowerCase();
    const relativePath = file.relativePath || originalName;
    const sameNameMatches = existingByName.get(originalName.toLowerCase()) || [];
    const incomingHash = useExactHashCheck ? fileHash(file.sourcePath) : '';
    const sameFileMatches = incomingHash ? sameNameMatches.filter(existing => {
      const existingPath = existing.file_source_path || (existing.file_stored_name ? path.join(filesDir, existing.file_stored_name) : '');
      return existingPath && fs.existsSync(existingPath) && fileHash(existingPath) === incomingHash;
    }) : [];
    const duplicateKind = sameFileMatches.length > 0
      ? 'same-file'
      : sameNameMatches.length > 0 ? 'same-name' : 'none';
    const duplicateMatch = sameFileMatches[0] || sameNameMatches[0] || null;
    const topFolder = relativePath.includes('/') || relativePath.includes('\\')
      ? relativePath.split(/[\\/]+/).filter(Boolean)[0]
      : '';
    const extractedText = await extractText(file.sourcePath, ext);

    previews.push({
      sourcePath: file.sourcePath,
      relativePath,
      title: originalName.replace(/\.[^/.]+$/, ''),
      fileName: originalName,
      fileExt: ext,
      size: stat.size,
      suggestedTags: suggestImportTags(file.sourcePath, relativePath),
      suggestedCollectionName: topFolder || '',
      duplicateName: sameNameMatches.length > 0,
      duplicateKind,
      duplicateMatch: duplicateMatch ? {
        id: duplicateMatch.id,
        title: duplicateMatch.title,
        fileName: duplicateMatch.file_name
      } : null,
      extractedText: extractedText.slice(0, 2000),
      thumbnailData: createThumbnailData(file.sourcePath, ext)
    });
  }

  return previews;
});

ipcMain.handle('items:uploadFile', async (_event, args: { sourcePath: string; title?: string; body?: string; tags?: string[] | string; collectionIds?: string[] }) => {
  if (!args.sourcePath || !fs.existsSync(args.sourcePath)) throw new Error('File does not exist');

  const originalName = path.basename(args.sourcePath);
  const ext = path.extname(originalName).toLowerCase();
  const storedName = `${randomUUID()}${ext}`;
  const dest = path.join(filesDir, storedName);
  fs.copyFileSync(args.sourcePath, dest);

  const id = randomUUID();
  const ts = nowIso();
  const extracted = await extractText(dest, ext);
  const thumbnail = createThumbnailData(dest, ext);

  db.prepare(`
    INSERT INTO items (id, title, type, body, file_name, file_stored_name, file_ext, extracted_text, thumbnail_data, created_at, updated_at)
    VALUES (?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, args.title || originalName, args.body || '', originalName, storedName, ext, extracted, thumbnail, ts, ts);

  setTagsForItem(id, args.tags);
  setCollectionsForItem(id, args.collectionIds);
  return getItem(id);
});

ipcMain.handle('items:openFile', async (_event, id: string) => {
  const item = getItem(id);
  if (!item || (!item.file_stored_name && !item.file_source_path)) throw new Error('File item not found');
  const target = item.file_source_path || path.join(filesDir, item.file_stored_name);
  await shell.openPath(target);
  return { ok: true };
});

ipcMain.handle('items:reindexFiles', async () => {
  const fileItems = db.prepare(`
    SELECT id, file_stored_name, file_source_path, file_ext
    FROM items
    WHERE type = 'file' AND (file_stored_name IS NOT NULL OR file_source_path IS NOT NULL)
  `).all() as { id: string; file_stored_name?: string; file_source_path?: string; file_ext: string }[];
  const update = db.prepare('UPDATE items SET extracted_text = ?, updated_at = ? WHERE id = ?');

  let indexed = 0;
  for (const item of fileItems) {
    const sourcePath = item.file_source_path || (item.file_stored_name ? path.join(filesDir, item.file_stored_name) : '');
    if (!fs.existsSync(sourcePath)) continue;
    const extracted = await extractText(sourcePath, item.file_ext || path.extname(sourcePath));
    update.run(extracted, nowIso(), item.id);
    indexed += 1;
  }

  return { indexed };
});
ipcMain.handle('backup:export', async () => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Export Vault',
    defaultPath: `music-notes-vault-export-${dateStamp()}.zip`,
    filters: [{ name: 'ZIP archive', extensions: ['zip'] }]
  });

  if (result.canceled || !result.filePath) return { canceled: true };
  createReadableExport(result.filePath);
  return { canceled: false, path: result.filePath };
});

ipcMain.handle('backup:openFolder', async () => {
  const error = await shell.openPath(backupsDir);
  if (error) throw new Error(error);
  return { ok: true, path: backupsDir };
});

ipcMain.handle('backup:getSettings', () => ({
  backupDirectory: backupsDir,
  backupFrequency: vaultSettings.backupFrequency
}));

ipcMain.handle('backup:chooseFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Choose Backup Folder',
    defaultPath: backupsDir,
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  backupsDir = result.filePaths[0];
  fs.mkdirSync(backupsDir, { recursive: true });
  vaultSettings.backupDirectory = backupsDir;
  vaultSettings.lastAutoBackupAt = undefined;
  saveSettings();
  return { canceled: false, path: backupsDir };
});

ipcMain.handle('backup:setFrequency', (_event, frequency: BackupFrequency) => {
  if (!['on-close', 'daily', 'weekly', 'never'].includes(frequency)) throw new Error('Invalid backup frequency');
  vaultSettings.backupFrequency = frequency;
  saveSettings();
  return { backupDirectory: backupsDir, backupFrequency: frequency };
});

ipcMain.handle('watched:list', () => vaultSettings.watchedFolders.map(folder => ({
  id: folder.id,
  path: folder.path,
  enabled: folder.enabled,
  created_at: folder.created_at,
  lastScanAt: folder.lastScanAt,
  seenCount: folder.seenFiles?.length || 0
})));

ipcMain.handle('watched:addFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Choose Folder to Watch',
    properties: ['openDirectory']
  });

  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const selectedPath = result.filePaths[0];
  const existing = vaultSettings.watchedFolders.find(folder => folder.path.toLowerCase() === selectedPath.toLowerCase());
  if (existing) return { canceled: false, folder: existing, alreadyExists: true };

  const folder: WatchedFolder = {
    id: randomUUID(),
    path: selectedPath,
    enabled: true,
    seenFiles: [],
    created_at: nowIso()
  };
  vaultSettings.watchedFolders.push(folder);
  saveSettings();
  return { canceled: false, folder, alreadyExists: false };
});

ipcMain.handle('watched:removeFolder', (_event, id: string) => {
  vaultSettings.watchedFolders = vaultSettings.watchedFolders.filter(folder => folder.id !== id);
  saveSettings();
  return { ok: true };
});

ipcMain.handle('watched:scan', (_event, args: { markSeen?: boolean; folderId?: string } = {}) => {
  return scanWatchedFolders(Boolean(args.markSeen), args.folderId);
});

ipcMain.handle('watched:markSeen', (_event, files: { sourcePath: string; watchedFolderId?: string; watchedFolderPath?: string }[]) => {
  return markWatchedFilesSeen(files);
});

ipcMain.handle('watched:markScanHandled', (_event, args: { folderId?: string } = {}) => {
  return markWatchedFolderScanHandled(args.folderId);
});

ipcMain.handle('updates:check', () => checkForUpdates(true));

ipcMain.handle('backup:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Import Vault Notes Backup',
    properties: ['openFile'],
    filters: [{ name: 'Vault Notes Backup', extensions: ['vaultbackup', 'zip'] }]
  });

  if (result.canceled || !result.filePaths[0]) return { canceled: true };

  const zip = new AdmZip(result.filePaths[0]);
  const backupEntry = zip.getEntry('backup.json');

  if (!backupEntry) {
    throw new Error('Invalid backup: missing backup.json');
  }

  const backup = JSON.parse(backupEntry.getData().toString('utf8'));

  if (!backup.items || !backup.tags || !backup.item_tags) {
    throw new Error('Invalid backup file');
  }

  const trx = db.transaction(() => {
    db.prepare('DELETE FROM item_collections').run();
    db.prepare('DELETE FROM item_tags').run();
    db.prepare('DELETE FROM tags').run();
    db.prepare('DELETE FROM items').run();
    db.prepare('DELETE FROM collections').run();

    for (const file of fs.readdirSync(filesDir)) {
      fs.unlinkSync(path.join(filesDir, file));
    }

    const insertItem = db.prepare(`
      INSERT INTO items (
        id,
        title,
        type,
        body,
        file_name,
        file_stored_name,
        file_source_path,
        file_ext,
        extracted_text,
        thumbnail_data,
        favorite,
        private,
        collection_id,
        created_at,
        updated_at
      )
      VALUES (
        @id,
        @title,
        @type,
        @body,
        @file_name,
        @file_stored_name,
        @file_source_path,
        @file_ext,
        @extracted_text,
        @thumbnail_data,
        @favorite,
        @private,
        @collection_id,
        @created_at,
        @updated_at
      )
    `);

    const insertTag = db.prepare(`
      INSERT INTO tags (id, name)
      VALUES (@id, @name)
    `);

    const insertItemTag = db.prepare(`
      INSERT INTO item_tags (item_id, tag_id)
      VALUES (@item_id, @tag_id)
    `);

    const insertCollection = db.prepare(`
      INSERT INTO collections (id, name, created_at)
      VALUES (@id, @name, @created_at)
    `);

    const insertItemCollection = db.prepare(`
      INSERT INTO item_collections (item_id, collection_id)
      VALUES (@item_id, @collection_id)
    `);

    for (const collection of backup.collections || []) {
      insertCollection.run(collection);
    }

    for (const item of backup.items) {
      insertItem.run({ collection_id: null, file_source_path: null, thumbnail_data: null, private: 0, ...item });
    }

    for (const tag of backup.tags) {
      insertTag.run(tag);
    }

    for (const itemTag of backup.item_tags) {
      insertItemTag.run(itemTag);
    }

    const collectionLinks = backup.item_collections || backup.items
      .filter((item: any) => item.collection_id)
      .map((item: any) => ({ item_id: item.id, collection_id: item.collection_id }));
    for (const itemCollection of collectionLinks) {
      insertItemCollection.run(itemCollection);
    }
  });

  trx();

  const fileEntries = zip.getEntries().filter(
    entry => entry.entryName.startsWith('files/') && !entry.isDirectory
  );

  for (const entry of fileEntries) {
    const fileName = path.basename(entry.entryName);
    fs.writeFileSync(path.join(filesDir, fileName), entry.getData());
  }

  cleanupUnusedTags();

  return { canceled: false, imported: true };
});
