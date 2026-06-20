import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import AdmZip from 'adm-zip';

const isDev = process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
let db: Database.Database;
let filesDir = '';

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
      file_ext TEXT,
      extracted_text TEXT DEFAULT '',
      favorite INTEGER DEFAULT 0,
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
  `);
}

function nowIso() {
  return new Date().toISOString();
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

function rowToItem(row: any) {
  const tagRows = db.prepare(`
    SELECT tags.name FROM tags
    JOIN item_tags ON item_tags.tag_id = tags.id
    WHERE item_tags.item_id = ?
    ORDER BY tags.name
  `).all(row.id) as { name: string }[];

  return {
    ...row,
    favorite: Boolean(row.favorite),
    tags: tagRows.map(t => t.name),
    file_path: row.file_stored_name ? path.join(filesDir, row.file_stored_name) : null
  };
}

function getItem(id: string) {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  return row ? rowToItem(row) : null;
}

function extractText(sourcePath: string, ext: string) {
  const safeExt = ext.toLowerCase();
  const searchable = ['.txt', '.md', '.csv', '.json', '.log'];
  if (!searchable.includes(safeExt)) return '';

  try {
    const stat = fs.statSync(sourcePath);
    if (stat.size > 2_000_000) return '';
    return fs.readFileSync(sourcePath, 'utf8').slice(0, 500_000);
  } catch {
    return '';
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 560,
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
  initDb();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('items:list', (_event, args: { search?: string; tag?: string; type?: string } = {}) => {
  const search = (args.search || '').trim().toLowerCase();
  const tag = (args.tag || '').trim();
  const type = (args.type || '').trim();

  let rows = db.prepare('SELECT * FROM items ORDER BY updated_at DESC').all() as any[];
  let items = rows.map(rowToItem);

  if (type && type !== 'all') items = items.filter(item => item.type === type);
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

ipcMain.handle('items:createNote', (_event, args: { title: string; body?: string; tags?: string[] | string }) => {
  const id = randomUUID();
  const ts = nowIso();
  db.prepare(`
    INSERT INTO items (id, title, type, body, created_at, updated_at)
    VALUES (?, ?, 'note', ?, ?, ?)
  `).run(id, args.title || 'Untitled note', args.body || '', ts, ts);
  setTagsForItem(id, args.tags);
  return getItem(id);
});

ipcMain.handle('items:update', (_event, args: { id: string; title?: string; body?: string; tags?: string[] | string; favorite?: boolean }) => {
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

ipcMain.handle('items:uploadFile', (_event, args: { sourcePath: string; title?: string; body?: string; tags?: string[] | string }) => {
  if (!args.sourcePath || !fs.existsSync(args.sourcePath)) throw new Error('File does not exist');

  const originalName = path.basename(args.sourcePath);
  const ext = path.extname(originalName).toLowerCase();
  const storedName = `${randomUUID()}${ext}`;
  const dest = path.join(filesDir, storedName);
  fs.copyFileSync(args.sourcePath, dest);

  const id = randomUUID();
  const ts = nowIso();
  const extracted = extractText(dest, ext);

  db.prepare(`
    INSERT INTO items (id, title, type, body, file_name, file_stored_name, file_ext, extracted_text, created_at, updated_at)
    VALUES (?, ?, 'file', ?, ?, ?, ?, ?, ?, ?)
  `).run(id, args.title || originalName, args.body || '', originalName, storedName, ext, extracted, ts, ts);

  setTagsForItem(id, args.tags);
  return getItem(id);
});

ipcMain.handle('items:openFile', async (_event, id: string) => {
  const item = getItem(id);
  if (!item || !item.file_stored_name) throw new Error('File item not found');
  const target = path.join(filesDir, item.file_stored_name);
  await shell.openPath(target);
  return { ok: true };
});
ipcMain.handle('backup:export', async () => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Export Vault Notes Backup',
    defaultPath: `vault-notes-backup-${new Date().toISOString().slice(0, 10)}.vaultbackup`,
    filters: [
      {
        name: 'Vault Notes Backup',
        extensions: ['vaultbackup', 'zip']
      }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  const items = db.prepare('SELECT * FROM items ORDER BY created_at').all();
  const tags = db.prepare('SELECT * FROM tags ORDER BY name').all();
  const itemTags = db.prepare('SELECT * FROM item_tags').all();

  const backup = {
    app: 'Vault Notes',
    version: 1,
    exported_at: nowIso(),
    items,
    tags,
    item_tags: itemTags
  };

  const zip = new AdmZip();

  zip.addFile(
    'backup.json',
    Buffer.from(JSON.stringify(backup, null, 2), 'utf8')
  );

  for (const item of items as any[]) {
    if (item.file_stored_name) {
      const filePath = path.join(filesDir, item.file_stored_name);

      if (fs.existsSync(filePath)) {
        zip.addLocalFile(filePath, 'files');
      }
    }
  }

  zip.writeZip(result.filePath);

  return {
    canceled: false,
    path: result.filePath
  };
});

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
    db.prepare('DELETE FROM item_tags').run();
    db.prepare('DELETE FROM tags').run();
    db.prepare('DELETE FROM items').run();

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
        file_ext,
        extracted_text,
        favorite,
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
        @file_ext,
        @extracted_text,
        @favorite,
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

    for (const item of backup.items) {
      insertItem.run(item);
    }

    for (const tag of backup.tags) {
      insertTag.run(tag);
    }

    for (const itemTag of backup.item_tags) {
      insertItemTag.run(itemTag);
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
