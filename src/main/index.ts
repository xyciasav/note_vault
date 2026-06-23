import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import https from 'https';
import AdmZip from 'adm-zip';
import { PDFParse } from 'pdf-parse';

const isDev = process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
let db: Database.Database;
let filesDir = '';
let backupsDir = '';
const defaultBackupsDir = () => path.join(app.getPath('userData'), 'backups');
type BackupFrequency = 'on-close' | 'daily' | 'weekly' | 'never';
type VaultSettings = {
  backupDirectory: string;
  backupFrequency: BackupFrequency;
  lastAutoBackupAt?: string;
  skippedReleaseTag?: string;
  lastLaunchedVersion?: string;
};
let vaultSettings: VaultSettings;

function settingsPath() {
  return path.join(app.getPath('userData'), 'vault-settings.json');
}

function loadSettings() {
  const defaults: VaultSettings = {
    backupDirectory: defaultBackupsDir(),
    backupFrequency: 'daily'
  };

  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    vaultSettings = { ...defaults, ...saved };
  } catch {
    vaultSettings = defaults;
  }

  backupsDir = vaultSettings.backupDirectory;
  fs.mkdirSync(backupsDir, { recursive: true });
}

function saveSettings() {
  fs.writeFileSync(settingsPath(), JSON.stringify(vaultSettings, null, 2), 'utf8');
}

function ensureDirs() {
  const userData = app.getPath('userData');
  filesDir = path.join(userData, 'files');
  fs.mkdirSync(filesDir, { recursive: true });
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
      favorite INTEGER DEFAULT 0,
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
  db.prepare(`
    DELETE FROM tags
    WHERE id NOT IN (
      SELECT DISTINCT tag_id FROM item_tags
    )
  `).run();
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
  const searchable = ['.txt', '.md', '.csv', '.json', '.log', '.pdf', '.docx'];
  if (!searchable.includes(safeExt)) return '';

  try {
    const stat = fs.statSync(sourcePath);
    if (stat.size > 20_000_000) return '';
    if (safeExt === '.pdf') {
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

  for (const item of items as any[]) {
    if (!item.file_stored_name) continue;
    const filePath = path.join(filesDir, item.file_stored_name);
    if (fs.existsSync(filePath)) zip.addLocalFile(filePath, 'files');
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
  createRestoreBackup(targetPath);
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
  loadSettings();
  initDb();
  createAutoBackupIfNeeded();
  createWindow();
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

ipcMain.handle('app:getVersion', () => app.getVersion());

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
    SELECT DISTINCT tags.name
    FROM tags
    JOIN item_tags ON item_tags.tag_id = tags.id
    JOIN items ON items.id = item_tags.item_id
    ORDER BY tags.name
  `).all();
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

ipcMain.handle('items:update', (_event, args: { id: string; title?: string; body?: string; tags?: string[] | string; favorite?: boolean; collectionIds?: string[] }) => {
  const existing = getItem(args.id);
  if (!existing) throw new Error('Item not found');

  db.prepare(`
    UPDATE items
    SET title = ?, body = ?, favorite = ?, updated_at = ?
    WHERE id = ?
  `).run(
    args.title ?? existing.title,
    args.body ?? existing.body,
    args.favorite === undefined ? Number(existing.favorite) : Number(args.favorite),
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

  db.prepare(`
    INSERT INTO items (id, title, type, body, file_name, file_stored_name, file_ext, extracted_text, created_at, updated_at)
    VALUES (?, ?, 'file', ?, ?, ?, ?, ?, ?, ?)
  `).run(id, args.title || originalName, args.body || '', originalName, storedName, ext, extracted, ts, ts);

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
        favorite,
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
        @favorite,
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
      insertItem.run({ collection_id: null, file_source_path: null, ...item });
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
