import { app, BrowserWindow, dialog, ipcMain, nativeImage, safeStorage, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { createCipheriv, createDecipheriv, createHash, createVerify, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual, verify as verifySignature } from 'crypto';
import https from 'https';
import os from 'os';
import AdmZip from 'adm-zip';
import { pipeline } from 'stream/promises';
import { pathToFileURL } from 'url';

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
let mapTilesDir = '';
const defaultBackupsDir = () => path.join(app.getPath('userData'), 'backups');
const maxBackupFileBytes = 25_000_000;
const maxHashFileBytes = 250_000_000;
const defaultListLimit = 750;
const maxListLimit = 2000;
const googlePhotosMediaExts = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff',
  '.heic', '.heif', '.dng', '.cr2', '.cr3', '.nef', '.arw', '.raf',
  '.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm', '.3gp',
  '.mpg', '.mpeg', '.mts', '.m2ts'
]);
const audioExts = ['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.oga', '.opus', '.wma', '.aiff', '.aif'];
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
  backupRetentionCount: number;
  allowNewImportTagSuggestions: boolean;
  backupEncryptionEnabled: boolean;
  backupEncryptionPasswordHash?: string;
  backupEncryptionSalt?: string;
  backupEncryptionPasswordSecret?: string;
  licenseKey?: string;
  activationTokenSecret?: string;
  activatedDeviceId?: string;
  trialStartedAt?: string;
  licenseTrialStartedAt?: string;
  licenseSchemaVersion?: number;
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
    backupRetentionCount: 10,
    allowNewImportTagSuggestions: true,
    backupEncryptionEnabled: false,
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
  vaultSettings.backupRetentionCount = Number.isFinite(Number(vaultSettings.backupRetentionCount))
    ? Math.max(1, Math.min(200, Math.round(Number(vaultSettings.backupRetentionCount))))
    : defaults.backupRetentionCount;
  vaultSettings.allowNewImportTagSuggestions = vaultSettings.allowNewImportTagSuggestions !== false;
  vaultSettings.backupEncryptionEnabled = Boolean(vaultSettings.backupEncryptionEnabled && vaultSettings.backupEncryptionPasswordHash && vaultSettings.backupEncryptionSalt);
  vaultSettings.trialStartedAt = vaultSettings.trialStartedAt || nowIso();
  if (!vaultSettings.licenseSchemaVersion) {
    vaultSettings.licenseTrialStartedAt = vaultSettings.activationTokenSecret
      ? (vaultSettings.licenseTrialStartedAt || vaultSettings.trialStartedAt || nowIso())
      : nowIso();
    vaultSettings.licenseSchemaVersion = 1;
    writeLog(`Initialized license trial window for v${app.getVersion()} upgrade.`);
  }
  vaultSettings.licenseTrialStartedAt = vaultSettings.licenseTrialStartedAt || vaultSettings.trialStartedAt || nowIso();
  backupsDir = vaultSettings.backupDirectory;
  fs.mkdirSync(backupsDir, { recursive: true });
  saveSettings();
}

function saveSettings() {
  fs.writeFileSync(settingsPath(), JSON.stringify(vaultSettings, null, 2), 'utf8');
}

const encryptedBackupMagic = 'NOTEVAULT-ENCRYPTED-BACKUP-v1';
const trialDays = 30;
const activationServerUrl = process.env.NOTE_VAULT_ACTIVATION_URL || 'https://license.xyciasav.com';
const activationPublicKey = (process.env.NOTE_VAULT_ACTIVATION_PUBLIC_KEY || `
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAjLEFr2mKB7fWwMfay9WId7sOJqscIjIRLh1qc1ORPz0=
-----END PUBLIC KEY-----
`).trim();
const activationPublicKeyConfigured = activationPublicKey.includes('BEGIN PUBLIC KEY') && activationPublicKey.includes('END PUBLIC KEY');

function passwordHash(password: string, salt = randomBytes(16).toString('base64')) {
  const hash = pbkdf2Sync(password, Buffer.from(salt, 'base64'), 210_000, 32, 'sha256').toString('base64');
  return { salt, hash };
}

function verifyPassword(password: string, salt?: string, expectedHash?: string) {
  if (!salt || !expectedHash) return false;
  const actual = pbkdf2Sync(password, Buffer.from(salt, 'base64'), 210_000, 32, 'sha256');
  const expected = Buffer.from(expectedHash, 'base64');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function protectSecret(value: string) {
  if (safeStorage.isEncryptionAvailable()) {
    return `safe:${safeStorage.encryptString(value).toString('base64')}`;
  }
  return `plain:${Buffer.from(value, 'utf8').toString('base64')}`;
}

function revealSecret(secret?: string) {
  if (!secret) return '';
  try {
    if (secret.startsWith('safe:')) return safeStorage.decryptString(Buffer.from(secret.slice(5), 'base64'));
    if (secret.startsWith('plain:')) return Buffer.from(secret.slice(6), 'base64').toString('utf8');
  } catch {
    return '';
  }
  return '';
}

function encryptBuffer(buffer: Buffer, password: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, 260_000, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.from(JSON.stringify({
    magic: encryptedBackupMagic,
    kdf: 'pbkdf2-sha256',
    iterations: 260_000,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  }), 'utf8');
}

function decryptBuffer(buffer: Buffer, password: string) {
  const envelope = JSON.parse(buffer.toString('utf8'));
  if (envelope.magic !== encryptedBackupMagic) throw new Error('Not an encrypted Note Vault backup.');
  const key = pbkdf2Sync(password, Buffer.from(envelope.salt, 'base64'), Number(envelope.iterations || 260_000), 32, 'sha256');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
}

function fileLooksEncrypted(filePath: string) {
  try {
    const sample = fs.readFileSync(filePath, 'utf8').slice(0, 128);
    return sample.includes(encryptedBackupMagic);
  } catch {
    return false;
  }
}

function encryptFileSync(sourcePath: string, targetPath: string, password: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, 260_000, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const header = Buffer.from(JSON.stringify({
    magic: encryptedBackupMagic,
    format: 'stream',
    kdf: 'pbkdf2-sha256',
    iterations: 260_000,
    salt: salt.toString('base64'),
    iv: iv.toString('base64')
  }) + '\n', 'utf8');
  const input = fs.openSync(sourcePath, 'r');
  const output = fs.openSync(targetPath, 'w');
  try {
    fs.writeSync(output, header);
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(input, chunk, 0, chunk.length, null)) > 0) {
      const encrypted = cipher.update(chunk.subarray(0, bytesRead));
      if (encrypted.length) fs.writeSync(output, encrypted);
    }
    const final = cipher.final();
    if (final.length) fs.writeSync(output, final);
    fs.writeSync(output, cipher.getAuthTag());
  } finally {
    fs.closeSync(input);
    fs.closeSync(output);
  }
}

function decryptFileSync(sourcePath: string, targetPath: string, password: string) {
  const fd = fs.openSync(sourcePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const probe = Buffer.alloc(Math.min(8192, stat.size));
    const probeBytes = fs.readSync(fd, probe, 0, probe.length, 0);
    const newlineIndex = probe.subarray(0, probeBytes).indexOf(10);
    if (newlineIndex < 0) throw new Error('Encrypted backup header was not found.');
    const header = JSON.parse(probe.subarray(0, newlineIndex).toString('utf8'));
    if (header.magic !== encryptedBackupMagic) throw new Error('Not an encrypted Note Vault backup.');
    const authTag = Buffer.alloc(16);
    fs.readSync(fd, authTag, 0, 16, stat.size - 16);
    const key = pbkdf2Sync(password, Buffer.from(header.salt, 'base64'), Number(header.iterations || 260_000), 32, 'sha256');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'base64'));
    decipher.setAuthTag(authTag);
    const output = fs.openSync(targetPath, 'w');
    try {
      const chunk = Buffer.allocUnsafe(1024 * 1024);
      let position = newlineIndex + 1;
      const encryptedEnd = stat.size - 16;
      while (position < encryptedEnd) {
        const toRead = Math.min(chunk.length, encryptedEnd - position);
        const bytesRead = fs.readSync(fd, chunk, 0, toRead, position);
        if (bytesRead <= 0) break;
        position += bytesRead;
        const decrypted = decipher.update(chunk.subarray(0, bytesRead));
        if (decrypted.length) fs.writeSync(output, decrypted);
      }
      const final = decipher.final();
      if (final.length) fs.writeSync(output, final);
    } finally {
      fs.closeSync(output);
    }
  } finally {
    fs.closeSync(fd);
  }
}

function getDeviceId() {
  const machineSeed = [
    os.hostname(),
    os.userInfo().username,
    process.platform,
    process.arch
  ].join('|');
  return createHash('sha256').update(`note-vault:${machineSeed}`).digest('hex');
}

function decodeBase64UrlJson(value: string) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function verifyRsaSha256(message: string, signatureBase64Url: string) {
  if (!activationPublicKeyConfigured) return false;
  const verify = createVerify('RSA-SHA256');
  verify.update(message);
  verify.end();
  return verify.verify(activationPublicKey, Buffer.from(signatureBase64Url, 'base64url'));
}

function verifyEdDsa(message: string, signatureBase64Url: string) {
  if (!activationPublicKeyConfigured) return false;
  try {
    return verifySignature(
      null,
      Buffer.from(message, 'utf8'),
      activationPublicKey,
      Buffer.from(signatureBase64Url, 'base64url')
    );
  } catch {
    return false;
  }
}

function readActivationToken(token?: string) {
  if (!token) return { valid: false, reason: 'Missing activation token.' };
  try {
    const cleanToken = token.trim();
    if (cleanToken.startsWith('NVACT-')) {
      const [payloadPart, signaturePart] = cleanToken.slice(6).split('.');
      if (!payloadPart || !signaturePart) return { valid: false, reason: 'Activation token is incomplete.' };
      if (!verifyRsaSha256(payloadPart, signaturePart)) return { valid: false, reason: 'Activation token signature is invalid.' };
      return { valid: true, data: decodeBase64UrlJson(payloadPart) };
    }

    const jwtParts = cleanToken.split('.');
    if (jwtParts.length === 3) {
      const [headerPart, payloadPart, signaturePart] = jwtParts;
      const header = decodeBase64UrlJson(headerPart);
      const signedPayload = `${headerPart}.${payloadPart}`;
      if (!header.alg || header.alg === 'RS256') {
        if (!verifyRsaSha256(signedPayload, signaturePart)) return { valid: false, reason: 'Activation token signature is invalid.' };
      } else if (header.alg === 'EdDSA') {
        if (!verifyEdDsa(signedPayload, signaturePart)) {
          return {
            valid: false,
            reason: 'Activation token EdDSA signature is invalid. Make sure Note Vault has the Ed25519 public key used by the license server.'
          };
        }
      } else {
        return { valid: false, reason: `Unsupported activation signature: ${header.alg}.` };
      }
      return { valid: true, data: decodeBase64UrlJson(payloadPart) };
    }
  } catch {
    return { valid: false, reason: 'Activation token payload is invalid.' };
  }
  return { valid: false, reason: 'Activation token format is not supported.' };
}

function validateActivationToken(token?: string) {
  if (!activationPublicKeyConfigured) return { valid: false, reason: 'Activation public key is not configured in this build.' };
  const parsed = readActivationToken(token);
  if (!parsed.valid) return parsed;
  const data = parsed.data as Record<string, any>;
  if (data.app && data.app !== 'note-vault' && data.app !== 'Note Vault') return { valid: false, reason: 'Activation is for another app.' };
  if (data.deviceId && data.deviceId !== getDeviceId()) return { valid: false, reason: 'Activation is locked to another device.' };
  const expiresAt = data.expiresAt || data.exp;
  if (expiresAt) {
    const expiresTime = typeof expiresAt === 'number' ? expiresAt * 1000 : new Date(String(expiresAt)).getTime();
    if (Number.isFinite(expiresTime) && Date.now() > expiresTime) {
      return { valid: false, reason: 'Activation expired.', name: data.name || data.customerName || data.email || '' };
    }
  }
  return {
    valid: true,
    name: data.name || data.customerName || data.email || 'Licensed user',
    expiresAt: typeof expiresAt === 'number' ? new Date(expiresAt * 1000).toISOString() : (expiresAt || ''),
    deviceId: data.deviceId || ''
  };
}

async function postActivationRequest(licenseKey: string) {
  const baseUrl = activationServerUrl.replace(/\/+$/, '');
  const targetUrl = `${baseUrl}/v1/activate`;
  const payload = {
    app: 'note-vault',
    licenseKey,
    deviceId: getDeviceId(),
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }
    const responseMessage = data.message || data.error || data.detail || text || `HTTP ${response.status}`;
    if (!response.ok || data.ok === false) {
      throw new Error(responseMessage);
    }
    const token = data.activationToken || data.activation_token || data.token;
    if (!token) throw new Error('Activation server did not return a signed activation token.');
    return String(token);
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('Activation timed out. Check the license server and try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function getLicenseStatus() {
  const startedAt = vaultSettings.licenseTrialStartedAt || vaultSettings.trialStartedAt || nowIso();
  const trialEndsAt = new Date(new Date(startedAt).getTime() + trialDays * 24 * 60 * 60 * 1000).toISOString();
  const activation: any = validateActivationToken(revealSecret(vaultSettings.activationTokenSecret));
  const trialActive = Date.now() <= new Date(trialEndsAt).getTime();
  return {
    licensed: activation.valid,
    locked: !activation.valid && !trialActive,
    trialStartedAt: startedAt,
    trialEndsAt,
    trialDaysRemaining: Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))),
    licenseName: activation.name || '',
    licenseExpiresAt: activation.expiresAt || '',
    reason: activation.valid ? '' : activation.reason,
    deviceId: getDeviceId(),
    activationServerUrl
  };
}

function ensureDirs() {
  const userData = app.getPath('userData');
  filesDir = path.join(userData, 'files');
  mapTilesDir = path.join(userData, 'map-tiles');
  logsDir = path.join(userData, 'logs');
  logPath = path.join(logsDir, 'vault-notes.log');
  fs.mkdirSync(filesDir, { recursive: true });
  fs.mkdirSync(mapTilesDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
}

function createPreUpgradeSafetyBackupIfNeeded() {
  const currentVersion = app.getVersion();
  const userData = app.getPath('userData');
  const dbPath = path.join(userData, 'vault-notes.sqlite');
  const settingsFile = settingsPath();
  if (!fs.existsSync(dbPath) && !fs.existsSync(settingsFile) && !fs.existsSync(path.join(userData, 'files'))) return;

  let savedSettings: Partial<VaultSettings> = {};
  try {
    savedSettings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch {
    savedSettings = {};
  }

  const previousVersion = savedSettings.lastLaunchedVersion || '';
  if (previousVersion === currentVersion) return;

  const backupRoot = savedSettings.backupDirectory || defaultBackupsDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const previousLabel = previousVersion ? `from-v${previousVersion}` : 'from-unknown-version';
  const targetDir = path.join(backupRoot, `pre-upgrade-v${currentVersion}-${previousLabel}-${stamp}`);
  fs.mkdirSync(targetDir, { recursive: true });

  const copyIfExists = (sourcePath: string, destinationName: string) => {
    if (!fs.existsSync(sourcePath)) return;
    const destinationPath = path.join(targetDir, destinationName);
    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
      fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true });
    } else {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  };

  try {
    copyIfExists(settingsFile, 'vault-settings.json');
    copyIfExists(dbPath, 'vault-notes.sqlite');
    copyIfExists(`${dbPath}-wal`, 'vault-notes.sqlite-wal');
    copyIfExists(`${dbPath}-shm`, 'vault-notes.sqlite-shm');
    copyIfExists(path.join(userData, 'files'), 'files');
    copyIfExists(path.join(userData, 'logs'), 'logs');
    fs.writeFileSync(path.join(targetDir, 'README.txt'), [
      `Note Vault created this raw safety backup before launching v${currentVersion}.`,
      previousVersion ? `Previous app version recorded in settings: v${previousVersion}.` : 'Previous app version was not recorded in settings.',
      '',
      'This is not a normal restore backup. It is a protective copy of the local vault data before upgrade/migration.',
      'Keep it until you confirm the upgraded app opens and your vault looks correct.'
    ].join('\n'), 'utf8');
    writeLog(`Created pre-upgrade safety backup at ${targetDir}`);
  } catch (error) {
    writeLog('Could not create pre-upgrade safety backup', error);
  }
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
      image_rotation INTEGER DEFAULT 0,
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
      mode TEXT DEFAULT '',
      parent_id TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS item_collections (
      item_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      PRIMARY KEY (item_id, collection_id),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS item_relationships (
      source_item_id TEXT NOT NULL,
      target_item_id TEXT NOT NULL,
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      PRIMARY KEY (source_item_id, target_item_id),
      FOREIGN KEY (source_item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (target_item_id) REFERENCES items(id) ON DELETE CASCADE,
      CHECK (source_item_id <> target_item_id)
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      theme TEXT DEFAULT 'cozy',
      cover_item_id TEXT,
      player_x INTEGER DEFAULT 40,
      player_y INTEGER DEFAULT 40,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (cover_item_id) REFERENCES items(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS memory_items (
      memory_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      x INTEGER DEFAULT 40,
      y INTEGER DEFAULT 40,
      width INTEGER DEFAULT 260,
      height INTEGER DEFAULT 190,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (memory_id, item_id),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_decorations (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT DEFAULT '',
      x INTEGER DEFAULT 80,
      y INTEGER DEFAULT 80,
      width INTEGER DEFAULT 180,
      height INTEGER DEFAULT 24,
      rotation INTEGER DEFAULT 0,
      color TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
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

  try {
    db.exec('ALTER TABLE items ADD COLUMN image_rotation INTEGER DEFAULT 0');
  } catch {
    // Existing databases already have this column after the first migration.
  }

  try {
    db.exec("ALTER TABLE collections ADD COLUMN mode TEXT DEFAULT ''");
  } catch {
    // Existing databases already have this column after the first migration.
  }

  try {
    db.exec("ALTER TABLE collections ADD COLUMN parent_id TEXT DEFAULT ''");
  } catch {
    // Existing databases already have this column after the first migration.
  }

  try {
    db.exec('ALTER TABLE memories ADD COLUMN player_x INTEGER DEFAULT 40');
  } catch {
    // Existing databases already have this column after the first migration.
  }

  try {
    db.exec('ALTER TABLE memories ADD COLUMN player_y INTEGER DEFAULT 40');
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

function safeUniqueStoredName(ext: string) {
  let storedName = `${randomUUID()}${ext}`;
  while (fs.existsSync(path.join(filesDir, storedName))) {
    storedName = `${randomUUID()}${ext}`;
  }
  return storedName;
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

function ensureCollection(name: string, mode = '', parentId = '') {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error('Collection name is required');
  const safeMode = ['note', 'photo', 'music'].includes(mode) ? mode : '';
  const safeParentId = parentId.trim();
  if (safeParentId) {
    const parent = db.prepare('SELECT id FROM collections WHERE id = ?').get(safeParentId);
    if (!parent) throw new Error('Parent collection not found');
  }
  const existing = db.prepare('SELECT id, name, mode, parent_id, created_at FROM collections WHERE name = ? COLLATE NOCASE').get(trimmedName) as { id: string; name: string; mode?: string; parent_id?: string; created_at: string } | undefined;
  if (existing && safeMode && !existing.mode) {
    db.prepare('UPDATE collections SET mode = ? WHERE id = ?').run(safeMode, existing.id);
    return { ...existing, mode: safeMode };
  }
  if (existing && safeParentId && !existing.parent_id) {
    db.prepare('UPDATE collections SET parent_id = ? WHERE id = ?').run(safeParentId, existing.id);
    return { ...existing, parent_id: safeParentId };
  }
  if (existing) return existing;

  const collection = { id: randomUUID(), name: trimmedName, mode: safeMode, parent_id: safeParentId, created_at: nowIso() };
  db.prepare('INSERT INTO collections (id, name, mode, parent_id, created_at) VALUES (@id, @name, @mode, @parent_id, @created_at)').run(collection);
  return collection;
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
    image_rotation: Number(row.image_rotation) || 0,
    tags: tagRows.map(t => t.name),
    collection_ids: collectionRows.map(collection => collection.id),
    collections: collectionRows,
    file_path: row.file_source_path || (row.file_stored_name ? path.join(filesDir, row.file_stored_name) : null)
  };
}

function compactItem(item: any) {
  return {
    ...item,
    body: item.body && item.body.length > 2500 ? `${item.body.slice(0, 2500)}...` : item.body,
    extracted_text: item.extracted_text && item.extracted_text.length > 2500 ? `${item.extracted_text.slice(0, 2500)}...` : item.extracted_text
  };
}

function getItem(id: string) {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  return row ? rowToItem(row) : null;
}

function getAvailableBytes(targetPath: string) {
  try {
    const stat = fs.statfsSync(targetPath);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function formatByteCount(value: number) {
  if (!Number.isFinite(value)) return 'unknown';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function normalizeArchivePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(Boolean).join('/');
}

function decodeArchivePath(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanNotionName(value: string) {
  const withoutExt = value.replace(/\.[^/.]+$/, '');
  return withoutExt
    .replace(/\s+[0-9a-f]{32}$/i, '')
    .replace(/\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, '')
    .replace(/\s+/g, ' ')
    .trim() || withoutExt || 'Untitled';
}

function relativeCollectionNames(relativePath: string) {
  const parts = normalizeArchivePath(relativePath).split('/').filter(Boolean);
  return parts.slice(0, -1).map(part => cleanNotionName(part));
}

function resolveMarkdownTarget(markdownPath: string, target: string) {
  const cleanTarget = decodeArchivePath(target.split('#')[0].split('?')[0]);
  if (!cleanTarget || /^(https?:|mailto:|file:|vault-file:)/i.test(cleanTarget)) return '';
  const base = path.posix.dirname(normalizeArchivePath(markdownPath));
  return normalizeArchivePath(path.posix.normalize(path.posix.join(base, cleanTarget)));
}

function addRelationshipBetween(sourceItemId: string, targetItemId: string, note: string) {
  if (!sourceItemId || !targetItemId || sourceItemId === targetItemId) return;
  const [source, target] = relationshipPair(sourceItemId, targetItemId);
  db.prepare(`
    INSERT OR IGNORE INTO item_relationships (source_item_id, target_item_id, note, created_at)
    VALUES (?, ?, ?, ?)
  `).run(source, target, note, nowIso());
}

type NotionImportEntry = {
  relativePath: string;
  data: Buffer;
};

function readNotionExportEntries(sourcePath: string): NotionImportEntry[] {
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    const entries: NotionImportEntry[] = [];
    const walk = (dir: string, base = '') => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = normalizeArchivePath(path.posix.join(base, entry.name));
        if (entry.isDirectory()) walk(fullPath, relativePath);
        else if (entry.isFile()) entries.push({ relativePath, data: fs.readFileSync(fullPath) });
      }
    };
    walk(sourcePath);
    return entries;
  }

  if (path.extname(sourcePath).toLowerCase() !== '.zip') {
    throw new Error('Choose a Notion export ZIP or an extracted Notion export folder.');
  }

  const zip = new AdmZip(sourcePath);
  return zip.getEntries()
    .filter(entry => !entry.isDirectory)
    .map(entry => ({
      relativePath: normalizeArchivePath(entry.entryName),
      data: entry.getData()
    }));
}

function extractMarkdownLinks(markdown: string) {
  const links: { label: string; target: string; image: boolean }[] = [];
  const pattern = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    links.push({ image: match[1] === '!', label: match[2] || '', target: match[3] || '' });
  }
  return links;
}

function downloadMapTile(url: string, targetPath: string) {
  return new Promise<void>((resolve, reject) => {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const file = fs.createWriteStream(targetPath);
    const request = https.get(url, {
      headers: {
        'User-Agent': `Note Vault/${app.getVersion()} offline-map-cache`
      }
    }, response => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.rmSync(targetPath, { force: true });
        downloadMapTile(response.headers.location, targetPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.rmSync(targetPath, { force: true });
        reject(new Error(`Map tile download failed with status ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    });

    request.on('error', error => {
      file.close();
      fs.rmSync(targetPath, { force: true });
      reject(error);
    });
  });
}

function hasDownloadedMapTiles() {
  if (!mapTilesDir || !fs.existsSync(mapTilesDir)) return false;
  const stack = [mapTilesDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(entryPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) return true;
    }
  }
  return false;
}

async function estimateGooglePhotosImportBytes(zipPaths: string[], sendProgress?: (payload: {
  phase: string;
  current: number;
  total: number;
  fileName?: string;
}) => void) {
  const unzipper = await import('unzipper') as any;
  let mediaFiles = 0;
  let estimatedBytes = 0;

  for (let index = 0; index < zipPaths.length; index += 1) {
    const zipPath = zipPaths[index];
    sendProgress?.({
      phase: 'Checking import size',
      current: index + 1,
      total: zipPaths.length,
      fileName: path.basename(zipPath)
    });
    const zipDirectory = await unzipper.Open.file(zipPath);
    for (const entry of zipDirectory.files || []) {
      if (entry.type === 'Directory') continue;
      const originalName = path.basename(entry.path || entry.entryName || '');
      const ext = path.extname(originalName).toLowerCase();
      if (!googlePhotosMediaExts.has(ext)) continue;
      mediaFiles += 1;
      estimatedBytes += Number(entry.uncompressedSize || entry.vars?.uncompressedSize || entry.size || 0);
    }
  }

  return { mediaFiles, estimatedBytes };
}

function relationshipPair(leftId: string, rightId: string) {
  if (leftId === rightId) throw new Error('Choose a different item to relate.');
  return [leftId, rightId].sort((left, right) => left.localeCompare(right));
}

function listRelationshipsForItem(itemId: string) {
  const rows = db.prepare(`
    SELECT
      relationships.source_item_id,
      relationships.target_item_id,
      relationships.note,
      relationships.created_at,
      related.*
    FROM item_relationships relationships
    JOIN items related
      ON related.id = CASE
        WHEN relationships.source_item_id = ? THEN relationships.target_item_id
        ELSE relationships.source_item_id
      END
    WHERE relationships.source_item_id = ? OR relationships.target_item_id = ?
    ORDER BY related.title COLLATE NOCASE
  `).all(itemId, itemId, itemId) as any[];

  return rows.map(row => ({
    source_item_id: row.source_item_id,
    target_item_id: row.target_item_id,
    note: row.note || '',
    created_at: row.created_at,
    item: rowToItem(row)
  }));
}

function listAllRelationships() {
  const rows = db.prepare(`
    SELECT
      relationships.source_item_id,
      relationships.target_item_id,
      relationships.note,
      relationships.created_at,
      source.title AS source_title,
      source.type AS source_type,
      source.file_name AS source_file_name,
      target.title AS target_title,
      target.type AS target_type,
      target.file_name AS target_file_name
    FROM item_relationships relationships
    JOIN items source ON source.id = relationships.source_item_id
    JOIN items target ON target.id = relationships.target_item_id
    ORDER BY relationships.created_at DESC
  `).all() as any[];

  return rows.map(row => ({
    source_item_id: row.source_item_id,
    target_item_id: row.target_item_id,
    note: row.note || '',
    created_at: row.created_at,
    source: { id: row.source_item_id, title: row.source_title, type: row.source_type, fileName: row.source_file_name },
    target: { id: row.target_item_id, title: row.target_title, type: row.target_type, fileName: row.target_file_name }
  }));
}

function rowToMemory(row: any) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    theme: row.theme || 'cozy',
    cover_item_id: row.cover_item_id || '',
    player_x: Number(row.player_x ?? 40),
    player_y: Number(row.player_y ?? 40),
    created_at: row.created_at,
    updated_at: row.updated_at,
    item_count: Number(row.item_count || 0),
    cover_thumbnail_data: row.cover_thumbnail_data || null,
    cover_title: row.cover_title || ''
  };
}

function listMemories() {
  return (db.prepare(`
    SELECT
      memories.*,
      COUNT(memory_items.item_id) AS item_count,
      cover.thumbnail_data AS cover_thumbnail_data,
      cover.title AS cover_title
    FROM memories
    LEFT JOIN memory_items ON memory_items.memory_id = memories.id
    LEFT JOIN items cover ON cover.id = memories.cover_item_id
    GROUP BY memories.id
    ORDER BY memories.updated_at DESC
  `).all() as any[]).map(rowToMemory);
}

function getMemory(memoryId: string) {
  const row = db.prepare(`
    SELECT
      memories.*,
      COUNT(memory_items.item_id) AS item_count,
      cover.thumbnail_data AS cover_thumbnail_data,
      cover.title AS cover_title
    FROM memories
    LEFT JOIN memory_items ON memory_items.memory_id = memories.id
    LEFT JOIN items cover ON cover.id = memories.cover_item_id
    WHERE memories.id = ?
    GROUP BY memories.id
  `).get(memoryId) as any | undefined;
  if (!row) return null;
  const items = (db.prepare(`
    SELECT
      memory_items.x,
      memory_items.y,
      memory_items.width,
      memory_items.height,
      memory_items.sort_order,
      memory_items.created_at AS memory_item_created_at,
      items.*
    FROM memory_items
    JOIN items ON items.id = memory_items.item_id
    WHERE memory_items.memory_id = ?
    ORDER BY memory_items.sort_order, memory_items.created_at
  `).all(memoryId) as any[]).map(itemRow => ({
    item: compactItem(rowToItem(itemRow)),
    x: Number(itemRow.x || 40),
    y: Number(itemRow.y || 40),
    width: Number(itemRow.width || 260),
    height: Number(itemRow.height || 190),
    sort_order: Number(itemRow.sort_order || 0)
  }));
  const decorations = (db.prepare(`
    SELECT * FROM memory_decorations
    WHERE memory_id = ?
    ORDER BY created_at
  `).all(memoryId) as any[]).map(decoration => ({
    id: decoration.id,
    memory_id: decoration.memory_id,
    kind: decoration.kind,
    label: decoration.label || '',
    x: Number(decoration.x || 80),
    y: Number(decoration.y || 80),
    width: Number(decoration.width || 180),
    height: Number(decoration.height || 24),
    rotation: Number(decoration.rotation || 0),
    color: decoration.color || '',
    created_at: decoration.created_at
  }));
  return { ...rowToMemory(row), items, decorations };
}

function listMemorySuggestions() {
  const relationships = db.prepare('SELECT source_item_id, target_item_id FROM item_relationships').all() as { source_item_id: string; target_item_id: string }[];
  const graph = new Map<string, Set<string>>();
  for (const relationship of relationships) {
    if (!graph.has(relationship.source_item_id)) graph.set(relationship.source_item_id, new Set());
    if (!graph.has(relationship.target_item_id)) graph.set(relationship.target_item_id, new Set());
    graph.get(relationship.source_item_id)?.add(relationship.target_item_id);
    graph.get(relationship.target_item_id)?.add(relationship.source_item_id);
  }

  const seen = new Set<string>();
  const suggestions: any[] = [];
  for (const id of graph.keys()) {
    if (seen.has(id)) continue;
    const stack = [id];
    const ids: string[] = [];
    seen.add(id);
    while (stack.length) {
      const current = stack.pop()!;
      ids.push(current);
      for (const next of graph.get(current) || []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    if (ids.length < 3) continue;
    const placeholders = ids.map(() => '?').join(', ');
    const items = (db.prepare(`
      SELECT * FROM items
      WHERE id IN (${placeholders})
      ORDER BY updated_at DESC
      LIMIT 8
    `).all(...ids) as any[]).map(row => compactItem(rowToItem(row)));
    if (items.length < 3) continue;
    suggestions.push({
      id: ids.sort().join(':'),
      title: items[0]?.title || items[0]?.file_name || 'Related memory',
      itemIds: ids,
      itemCount: ids.length,
      items,
      reason: `${ids.length} related items are already connected.`
    });
  }
  return suggestions.sort((left, right) => right.itemCount - left.itemCount).slice(0, 8);
}

const offlinePlaces = [
  { name: 'New York City, NY', latitude: 40.7128, longitude: -74.0060 },
  { name: 'Philadelphia, PA', latitude: 39.9526, longitude: -75.1652 },
  { name: 'Washington, DC', latitude: 38.9072, longitude: -77.0369 },
  { name: 'Boston, MA', latitude: 42.3601, longitude: -71.0589 },
  { name: 'Los Angeles, CA', latitude: 34.0522, longitude: -118.2437 },
  { name: 'Anaheim, CA', latitude: 33.8366, longitude: -117.9143 },
  { name: 'San Diego, CA', latitude: 32.7157, longitude: -117.1611 },
  { name: 'San Francisco, CA', latitude: 37.7749, longitude: -122.4194 },
  { name: 'Las Vegas, NV', latitude: 36.1699, longitude: -115.1398 },
  { name: 'Phoenix, AZ', latitude: 33.4484, longitude: -112.0740 },
  { name: 'Denver, CO', latitude: 39.7392, longitude: -104.9903 },
  { name: 'Chicago, IL', latitude: 41.8781, longitude: -87.6298 },
  { name: 'Nashville, TN', latitude: 36.1627, longitude: -86.7816 },
  { name: 'Atlanta, GA', latitude: 33.7490, longitude: -84.3880 },
  { name: 'Orlando, FL', latitude: 28.5383, longitude: -81.3792 },
  { name: 'Miami, FL', latitude: 25.7617, longitude: -80.1918 },
  { name: 'Dallas, TX', latitude: 32.7767, longitude: -96.7970 },
  { name: 'Houston, TX', latitude: 29.7604, longitude: -95.3698 },
  { name: 'Austin, TX', latitude: 30.2672, longitude: -97.7431 },
  { name: 'Seattle, WA', latitude: 47.6062, longitude: -122.3321 },
  { name: 'Portland, OR', latitude: 45.5152, longitude: -122.6784 },
  { name: 'Toronto, ON', latitude: 43.6532, longitude: -79.3832 },
  { name: 'London, UK', latitude: 51.5072, longitude: -0.1276 },
  { name: 'Paris, France', latitude: 48.8566, longitude: 2.3522 }
];

function distanceMiles(leftLat: number, leftLon: number, rightLat: number, rightLon: number) {
  const toRad = (value: number) => value * Math.PI / 180;
  const earthMiles = 3958.8;
  const dLat = toRad(rightLat - leftLat);
  const dLon = toRad(rightLon - leftLon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(leftLat)) * Math.cos(toRad(rightLat)) * Math.sin(dLon / 2) ** 2;
  return earthMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function friendlyCoordinateLocation(latitude: number, longitude: number) {
  const nearest = offlinePlaces
    .map(place => ({ ...place, distance: distanceMiles(latitude, longitude, place.latitude, place.longitude) }))
    .sort((left, right) => left.distance - right.distance)[0];

  if (nearest && nearest.distance <= 60) {
    return `Near ${nearest.name}`;
  }

  return `Near ${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
}

function listLocationSummaries() {
  const rows = db.prepare(`
    SELECT id, title, file_name, body, extracted_text
    FROM items
    WHERE body LIKE '%Location:%' OR extracted_text LIKE '%Location:%' OR body LIKE '%Coordinates:%' OR extracted_text LIKE '%Coordinates:%'
    ORDER BY created_at DESC
  `).all() as { id: string; title: string; file_name?: string; body?: string; extracted_text?: string }[];
  const grouped = new Map<string, { location: string; latitude?: number; longitude?: number; count: number; examples: { id: string; title: string; fileName?: string | null }[] }>();

  for (const row of rows) {
    const metadataText = `${row.body || ''}\n${row.extracted_text || ''}`;
    const locationMatch = metadataText.match(/^Location:\s*(.+)$/m);
    const coordinatesMatch = metadataText.match(/^Coordinates:\s*(.+)$/m);
    const rawLocation = locationMatch?.[1]?.trim() || coordinatesMatch?.[1]?.trim() || '';
    if (!rawLocation) continue;
    const coordMatch = (coordinatesMatch?.[1] || rawLocation).match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    const latitude = coordMatch ? Number(coordMatch[1]) : undefined;
    const longitude = coordMatch ? Number(coordMatch[2]) : undefined;
    const location = latitude !== undefined && longitude !== undefined && /^-?\d/.test(rawLocation)
      ? friendlyCoordinateLocation(latitude, longitude)
      : rawLocation;
    const existing = grouped.get(location) || { location, latitude, longitude, count: 0, examples: [] };
    existing.count += 1;
    if (existing.examples.length < 4) {
      existing.examples.push({ id: row.id, title: row.title, fileName: row.file_name || null });
    }
    grouped.set(location, existing);
  }

  return [...grouped.values()].sort((left, right) => right.count - left.count || left.location.localeCompare(right.location));
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
    'vault', 'copy', 'final', 'draft', 'new', 'old'
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

function normalizeTakeoutStem(name: string) {
  let stem = path.parse(path.basename(name).toLowerCase()).name.replace(/_/g, ' ').trim();
  for (const pattern of [
    /\s*\(\d+\)$/i,
    /\s*-\s*edited$/i,
    /\s*_edited$/i,
    /\s*~\d+$/i,
    /\s*-\d{3}$/i
  ]) {
    stem = stem.replace(pattern, '').trim();
  }
  return stem.replace(/\s+/g, ' ').replace(/[\s-]+/g, '');
}

function takeoutMatchKeys(name: string) {
  const base = path.basename(name).toLowerCase();
  const stem = path.parse(base).name;
  const variants = new Set<string>([
    base,
    stem,
    normalizeTakeoutStem(base)
  ]);

  for (const suffix of [
    '.supplemental-metadata',
    '.supplemental-met',
    '.supplementalmetadata',
    '-supplemental-metadata',
    '-supplemental-met',
    '-supplementalmetadata'
  ]) {
    if (stem.endsWith(suffix)) {
      const trimmed = stem.slice(0, -suffix.length);
      variants.add(trimmed);
      variants.add(normalizeTakeoutStem(trimmed));
    }
  }

  if (stem.endsWith('.mp')) {
    variants.add(stem.slice(0, -3));
    variants.add(normalizeTakeoutStem(stem.slice(0, -3)));
  }

  const withoutEdited = stem.replace(/[-_ ]edited$/i, '');
  variants.add(withoutEdited);
  variants.add(normalizeTakeoutStem(withoutEdited));

  return [...variants].filter(Boolean);
}

function takeoutJsonSidecarNames(entryPath: string) {
  const base = path.basename(entryPath);
  const names = new Set<string>();
  if (!base.toLowerCase().endsWith('.json')) return names;

  const withoutJson = base.slice(0, -5);
  names.add(withoutJson);
  names.add(withoutJson.replace(/\.supplemental-metadata$/i, ''));
  names.add(withoutJson.replace(/\.supplemental-met$/i, ''));
  names.add(withoutJson.replace(/\.supplementalmetadata$/i, ''));
  return names;
}

function parseTakeoutTimestamp(data: any) {
  const fromKey = (key: string) => {
    const value = data?.[key]?.timestamp;
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
    if (Number.isFinite(value)) return Number(value);
    return null;
  };
  return fromKey('photoTakenTime') ?? fromKey('creationTime');
}

async function buildGooglePhotosJsonIndex(zipEntries: any[], onProgress?: (message: string) => void) {
  const index = new Map<string, any>();
  let scanned = 0;

  for (const entry of zipEntries) {
    const entryPath = entry.path || entry.entryName || '';
    if (!entryPath || entry.type === 'Directory' || path.extname(entryPath).toLowerCase() !== '.json') continue;
    try {
      const buffer = await entry.buffer();
      const data = JSON.parse(buffer.toString('utf8'));
      if (!data?.title || typeof data.title !== 'string') continue;
      const timestamp = parseTakeoutTimestamp(data);
      const record = { ...data, timestamp, sourceEntryPath: entryPath };
      const sidecarNames = [...takeoutJsonSidecarNames(entryPath)];
      const keys = [
        ...takeoutMatchKeys(data.title),
        ...sidecarNames.flatMap(takeoutMatchKeys)
      ].filter(Boolean);
      for (const key of keys) {
        const existing = index.get(key);
        if (!existing || (timestamp && (!existing.timestamp || timestamp < existing.timestamp))) {
          index.set(key, record);
        }
      }
      scanned += 1;
      if (scanned % 250 === 0) onProgress?.(`Indexed ${scanned.toLocaleString()} metadata files...`);
    } catch {
      // Ignore malformed Takeout JSON sidecars.
    }
  }

  return index;
}

async function streamZipEntryToFile(entry: any, dest: string) {
  await pipeline(entry.stream(), fs.createWriteStream(dest));
}

async function readZipEntryText(entry: any) {
  const chunks: Buffer[] = [];
  for await (const chunk of entry.stream()) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function googlePhotosMetadataBody(metadata: any, sourceZip: string) {
  const lines = ['Imported from Google Photos Takeout.'];
  if (metadata?.timestamp) lines.push(`Taken: ${new Date(metadata.timestamp * 1000).toLocaleString()}`);
  if (metadata?.description) lines.push(`Description: ${metadata.description}`);
  if (metadata?.url) lines.push(`Google Photos URL: ${metadata.url}`);
  if (metadata?.geoData && (metadata.geoData.latitude || metadata.geoData.longitude)) {
    const latitude = Number(metadata.geoData.latitude);
    const longitude = Number(metadata.geoData.longitude);
    lines.push(`Location: ${friendlyCoordinateLocation(latitude, longitude)}`);
    lines.push(`Coordinates: ${latitude}, ${longitude}`);
  }
  if (metadata?.title) lines.push(`Original title: ${metadata.title}`);
  lines.push(`Source ZIP: ${sourceZip}`);
  return lines.join('\n');
}

async function chooseTakeoutZipFolder() {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Choose Google Photos Takeout folder',
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true as const, zipPaths: [] as string[] };

  const takeoutDir = result.filePaths[0];
  const zipPaths: string[] = [];
  const walk = (currentPath: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) {
        zipPaths.push(fullPath);
      }
    }
  };
  walk(takeoutDir);
  zipPaths.sort((left, right) => left.localeCompare(right));

  if (zipPaths.length === 0) throw new Error('No .zip files were found in that folder.');
  return { canceled: false as const, zipPaths };
}

async function buildGooglePhotosMetadataIndex(zipPaths: string[], sendProgress?: (payload: {
  phase: string;
  current: number;
  total: number;
  fileName?: string;
  imported?: number;
  matchedMetadata?: number;
  skipped?: number;
}) => void) {
  const unzipper = await import('unzipper') as any;
  const metadataIndex = new Map<string, any>();
  const metadataRecords: any[] = [];
  let jsonFiles = 0;

  for (let zipIndex = 0; zipIndex < zipPaths.length; zipIndex += 1) {
    const zipPath = zipPaths[zipIndex];
    const zipName = path.basename(zipPath);
    sendProgress?.({ phase: 'Reading ZIP directory', current: zipIndex + 1, total: zipPaths.length, fileName: zipName });
    const zipDirectory = await unzipper.Open.file(zipPath);
    const zipEntries = zipDirectory.files || [];
    const zipIndexMap = await buildGooglePhotosJsonIndex(zipEntries, message => {
      sendProgress?.({ phase: message, current: zipIndex + 1, total: zipPaths.length, fileName: zipName });
    });

    for (const [key, value] of zipIndexMap) {
      const record = { ...value, sourceZip: zipName };
      metadataRecords.push(record);
      const existing = metadataIndex.get(key);
      if (!existing || (record.timestamp && (!existing.timestamp || record.timestamp < existing.timestamp))) {
        metadataIndex.set(key, record);
      }
    }
    jsonFiles += zipEntries.filter((entry: any) => {
      const entryPath = entry.path || entry.entryName || '';
      return entry.type !== 'Directory' && path.extname(entryPath).toLowerCase() === '.json';
    }).length;
  }

  return { metadataIndex, metadataRecords, jsonFiles };
}

function lookupGooglePhotosMetadata(metadataIndex: Map<string, any>, fileName: string) {
  for (const key of takeoutMatchKeys(fileName)) {
    const match = metadataIndex.get(key);
    if (match) return match;
  }
  return null;
}

function closestGooglePhotosMetadataCandidates(metadataRecords: any[], fileName: string) {
  const wantedKeys = takeoutMatchKeys(fileName);
  const wantedStem = normalizeTakeoutStem(fileName);
  const scored = metadataRecords.map(record => {
    const title = String(record?.title || '');
    const sourceEntryPath = String(record?.sourceEntryPath || '');
    const candidateKeys = [
      ...takeoutMatchKeys(title),
      ...takeoutMatchKeys(sourceEntryPath)
    ];
    let score = 0;
    for (const wanted of wantedKeys) {
      for (const candidate of candidateKeys) {
        if (!wanted || !candidate) continue;
        if (wanted === candidate) score = Math.max(score, 100);
        else if (candidate.includes(wanted) || wanted.includes(candidate)) score = Math.max(score, 80);
        else if (wantedStem && candidate.includes(wantedStem.slice(0, Math.min(14, wantedStem.length)))) score = Math.max(score, 45);
        else {
          let common = 0;
          while (common < wanted.length && common < candidate.length && wanted[common] === candidate[common]) common += 1;
          score = Math.max(score, common);
        }
      }
    }
    return { score, title, sourceEntryPath, sourceZip: record?.sourceZip || '' };
  })
    .filter(candidate => candidate.score >= 8)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);

  return scored.map(candidate => `${candidate.title || '(no title)'}${candidate.sourceEntryPath ? ` [${candidate.sourceEntryPath}]` : ''}${candidate.sourceZip ? ` from ${candidate.sourceZip}` : ''}`);
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
        folder.seenFiles = [...allSeen].slice(-20000);
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

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function updateCrc32(crc: number, buffer: Buffer) {
  let value = crc;
  for (const byte of buffer) {
    value = crc32Table[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return value >>> 0;
}

function crc32(buffer: Buffer) {
  return (updateCrc32(0xffffffff, buffer) ^ 0xffffffff) >>> 0;
}

function zipDateTime(date = new Date()) {
  return {
    time: ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f),
    date: (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f)
  };
}

type ZipCentralEntry = {
  name: string;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
};

class StoreZipWriter {
  private fd: number;
  private offset = 0;
  private entries: ZipCentralEntry[] = [];

  constructor(private targetPath: string) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    this.fd = fs.openSync(targetPath, 'w');
  }

  private write(buffer: Buffer) {
    fs.writeSync(this.fd, buffer, 0, buffer.length);
    this.offset += buffer.length;
  }

  private writeLocalHeader(name: string, crc: number, size: number, modified = new Date()) {
    if (size > 0xffffffff) throw new Error(`Backup ZIP entry is too large: ${name}`);
    const encodedName = Buffer.from(name.replace(/\\/g, '/'), 'utf8');
    const { time, date } = zipDateTime(modified);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc >>> 0, 14);
    header.writeUInt32LE(size >>> 0, 18);
    header.writeUInt32LE(size >>> 0, 22);
    header.writeUInt16LE(encodedName.length, 26);
    header.writeUInt16LE(0, 28);
    const entryOffset = this.offset;
    this.write(header);
    this.write(encodedName);
    this.entries.push({ name: encodedName.toString('utf8'), crc, size, offset: entryOffset, time, date });
  }

  addBuffer(name: string, buffer: Buffer) {
    this.writeLocalHeader(name, crc32(buffer), buffer.length);
    this.write(buffer);
  }

  addFile(sourcePath: string, name: string) {
    const stat = fs.statSync(sourcePath);
    let crc = 0xffffffff;
    const readBuffer = Buffer.allocUnsafe(1024 * 1024);
    const readFd = fs.openSync(sourcePath, 'r');
    try {
      let bytesRead = 0;
      do {
        bytesRead = fs.readSync(readFd, readBuffer, 0, readBuffer.length, null);
        if (bytesRead > 0) crc = updateCrc32(crc, readBuffer.subarray(0, bytesRead));
      } while (bytesRead > 0);
    } finally {
      fs.closeSync(readFd);
    }

    this.writeLocalHeader(name, (crc ^ 0xffffffff) >>> 0, stat.size, stat.mtime);

    const writeBuffer = Buffer.allocUnsafe(1024 * 1024);
    const writeFd = fs.openSync(sourcePath, 'r');
    try {
      let bytesRead = 0;
      do {
        bytesRead = fs.readSync(writeFd, writeBuffer, 0, writeBuffer.length, null);
        if (bytesRead > 0) this.write(writeBuffer.subarray(0, bytesRead));
      } while (bytesRead > 0);
    } finally {
      fs.closeSync(writeFd);
    }
  }

  close() {
    const centralStart = this.offset;
    for (const entry of this.entries) {
      const encodedName = Buffer.from(entry.name, 'utf8');
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(0x0800, 8);
      header.writeUInt16LE(0, 10);
      header.writeUInt16LE(entry.time, 12);
      header.writeUInt16LE(entry.date, 14);
      header.writeUInt32LE(entry.crc >>> 0, 16);
      header.writeUInt32LE(entry.size >>> 0, 20);
      header.writeUInt32LE(entry.size >>> 0, 24);
      header.writeUInt16LE(encodedName.length, 28);
      header.writeUInt16LE(0, 30);
      header.writeUInt16LE(0, 32);
      header.writeUInt16LE(0, 34);
      header.writeUInt16LE(0, 36);
      header.writeUInt32LE(0, 38);
      header.writeUInt32LE(entry.offset >>> 0, 42);
      this.write(header);
      this.write(encodedName);
    }

    const centralSize = this.offset - centralStart;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(centralSize >>> 0, 12);
    end.writeUInt32LE(centralStart >>> 0, 16);
    end.writeUInt16LE(0, 20);
    this.write(end);
    fs.closeSync(this.fd);
  }
}

function createRestoreBackupPlain(targetPath: string, options: { externalizeLargeFiles?: boolean } = { externalizeLargeFiles: true }) {
  const items = db.prepare('SELECT * FROM items ORDER BY created_at').all();
  const tags = db.prepare('SELECT * FROM tags ORDER BY name').all();
  const itemTags = db.prepare('SELECT * FROM item_tags').all();
  const collections = db.prepare('SELECT * FROM collections ORDER BY name').all();
  const itemCollections = db.prepare('SELECT * FROM item_collections').all();
  const itemRelationships = db.prepare('SELECT * FROM item_relationships').all();
  const memories = db.prepare('SELECT * FROM memories ORDER BY created_at').all();
  const memoryItems = db.prepare('SELECT * FROM memory_items').all();
  const memoryDecorations = db.prepare('SELECT * FROM memory_decorations').all();
  const backup = {
    app: 'Note Vault',
    version: 1,
    exported_at: nowIso(),
    items,
    tags,
    item_tags: itemTags,
    collections,
    item_collections: itemCollections,
    item_relationships: itemRelationships,
    memories,
    memory_items: memoryItems,
    memory_decorations: memoryDecorations
  };

  const zip = new StoreZipWriter(targetPath);
  zip.addBuffer('backup.json', Buffer.from(JSON.stringify(backup, null, 2), 'utf8'));
  const externalFiles: { item_id: string; file_name: string; stored_name: string; relative_path: string; size: number }[] = [];
  const skippedFiles: { item_id: string; file_name: string; reason: string; size?: number }[] = [];
  const sidecarDir = backupSidecarDir(targetPath);
  const sidecarFilesDir = path.join(sidecarDir, 'files');

  for (const item of items as any[]) {
    if (!item.file_stored_name) continue;
    const filePath = path.join(filesDir, item.file_stored_name);
    if (!fs.existsSync(filePath)) continue;
    try {
      const stat = fs.statSync(filePath);
      if (options.externalizeLargeFiles !== false && stat.size > maxBackupFileBytes) {
        fs.mkdirSync(sidecarFilesDir, { recursive: true });
        fs.copyFileSync(filePath, path.join(sidecarFilesDir, item.file_stored_name));
        externalFiles.push({
          item_id: item.id,
          file_name: item.file_name || item.file_stored_name,
          stored_name: item.file_stored_name,
          relative_path: `files/${item.file_stored_name}`,
          size: stat.size
        });
        writeLog(`Backup stored oversized file outside ZIP: ${item.file_name || item.file_stored_name} (${stat.size} bytes)`);
        continue;
      }
      zip.addFile(filePath, `files/${item.file_stored_name}`);
    } catch (error) {
      skippedFiles.push({
        item_id: item.id,
        file_name: item.file_name || item.file_stored_name,
        reason: error instanceof Error ? error.message : String(error)
      });
      writeLog(`Backup skipped file: ${item.file_name || item.file_stored_name}`, error);
    }
  }

  if (externalFiles.length > 0) {
    const manifest = {
      note: 'Large files are stored next to this backup in the matching -large-files folder.',
      files: externalFiles
    };
    zip.addBuffer('backup-external-files.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
    fs.writeFileSync(path.join(sidecarDir, 'backup-external-files.json'), JSON.stringify({
      backup: path.basename(targetPath),
      ...manifest
    }, null, 2), 'utf8');
  }

  if (skippedFiles.length > 0) {
    zip.addBuffer('backup-skipped-files.json', Buffer.from(JSON.stringify(skippedFiles, null, 2), 'utf8'));
  }

  zip.close();
}

function createRestoreBackup(targetPath: string) {
  if (!vaultSettings.backupEncryptionEnabled) {
    createRestoreBackupPlain(targetPath);
    return;
  }
  const password = revealSecret(vaultSettings.backupEncryptionPasswordSecret);
  if (password && verifyPassword(password, vaultSettings.backupEncryptionSalt, vaultSettings.backupEncryptionPasswordHash)) {
    const tempPath = `${targetPath}.plain.tmp`;
    createRestoreBackupPlain(tempPath, { externalizeLargeFiles: false });
    encryptFileSync(tempPath, targetPath, password);
    fs.rmSync(tempPath, { force: true });
    return;
  }
  throw new Error('Backup encryption is enabled but no backup password is available for automatic backups. Re-save the backup password in Settings.');
}

function backupSidecarDir(backupPath: string) {
  return backupPath.replace(/\.(vaultbackup|zip)$/i, '') + '-large-files';
}

function isPathInside(parentPath: string, candidatePath: string) {
  const resolvedParent = path.resolve(parentPath);
  const resolvedCandidate = path.resolve(candidatePath);
  const relative = path.relative(resolvedParent, resolvedCandidate);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function folderSize(folderPath: string) {
  let total = 0;
  const walk = (currentPath: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      try {
        if (entry.isDirectory()) walk(fullPath);
        else if (entry.isFile()) total += fs.statSync(fullPath).size;
      } catch {
        // Ignore files that disappear while calculating size.
      }
    }
  };
  if (fs.existsSync(folderPath)) walk(folderPath);
  return total;
}

function listAutoBackups() {
  if (!fs.existsSync(backupsDir)) return [];
  return fs.readdirSync(backupsDir)
    .filter(name => /^vault-notes-auto-.*\.vaultbackup$/i.test(name))
    .map(name => {
      const backupPath = path.join(backupsDir, name);
      const sidecarPath = backupSidecarDir(backupPath);
      const stat = fs.statSync(backupPath);
      const sidecarSize = folderSize(sidecarPath);
      return {
        name,
        path: backupPath,
        sidecarPath,
        createdAt: stat.mtimeMs,
        size: stat.size + sidecarSize,
        hasSidecar: sidecarSize > 0
      };
    })
    .sort((left, right) => right.createdAt - left.createdAt);
}

function getBackupStats() {
  const backups = listAutoBackups();
  return {
    count: backups.length,
    totalBytes: backups.reduce((sum, backup) => sum + backup.size, 0),
    retentionCount: vaultSettings.backupRetentionCount
  };
}

function pruneOldAutoBackups() {
  const keep = Math.max(1, Math.min(200, vaultSettings.backupRetentionCount || 10));
  const backups = listAutoBackups();
  const toDelete = backups.slice(keep);
  for (const backup of toDelete) {
    try {
      if (fs.existsSync(backup.path)) fs.unlinkSync(backup.path);
      if (fs.existsSync(backup.sidecarPath)) fs.rmSync(backup.sidecarPath, { recursive: true, force: true });
      writeLog(`Pruned old automatic backup: ${backup.name}`);
    } catch (error) {
      writeLog(`Could not prune old automatic backup: ${backup.name}`, error);
    }
  }
  return { deleted: toDelete.length, ...getBackupStats() };
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
  const encryptedLabel = vaultSettings.backupEncryptionEnabled ? 'encrypted-' : '';
  const targetPath = path.join(backupsDir, `vault-notes-auto-${encryptedLabel}${dateStamp()}.vaultbackup`);
  try {
    createRestoreBackup(targetPath);
  } catch (error) {
    writeLog('Automatic backup failed', error);
    return null;
  }
  vaultSettings.lastAutoBackupAt = nowIso();
  saveSettings();
  pruneOldAutoBackups();
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
  '2.0.0': [
    'A new Dashboard, Notes, Photos, Music, and Settings mode layout makes the vault easier to browse.',
    'Memories add a scrapbook-style canvas for connecting notes, photos, files, and music.',
    'Music mode now focuses on audio files, playback, recent tracks, and music collections.',
    'Photo mode has a larger visual browsing experience with safer local-first previews.',
    'Licensing, encrypted backups, importers, relationships, sub-collections, and rich note editing have been expanded.',
    'Before the upgraded app migrates your vault, Note Vault creates a raw pre-upgrade safety backup in your backup folder.'
  ],
  '1.3.0': [
    'Watched Folders can monitor local folders and surface new files for review.',
    'Relationships can connect notes, files, collections, and related vault items.',
    'The notes editor now includes richer Markdown preview and split editing modes.',
    'Import review, tags, collections, backups, search, thumbnails, and the dashboard have all been expanded for larger vaults.'
  ],
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
    'Note Vault now shows What’s New after an update, including upgrades from older versions.',
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
      title: 'Note Vault updated',
      message: `You’re now using Note Vault v${currentVersion}.`,
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
  const lowerExt = ext.toLowerCase();
  if (!imageExtensions.has(lowerExt)) return null;
  try {
    const image = nativeImage.createFromPath(sourcePath);
    if (image.isEmpty()) {
      if (lowerExt === '.webp') {
        const buffer = fs.readFileSync(sourcePath);
        return `data:image/webp;base64,${buffer.toString('base64')}`;
      }
      return null;
    }
    return image.resize({ width: 320, quality: 'good' }).toDataURL();
  } catch {
    return null;
  }
}

function readJpegOrientationRotation(sourcePath: string, ext: string) {
  if (!['.jpg', '.jpeg'].includes(ext.toLowerCase())) return 0;
  try {
    const buffer = fs.readFileSync(sourcePath).subarray(0, 256 * 1024);
    if (buffer.length < 4 || buffer.readUInt16BE(0) !== 0xffd8) return 0;
    let offset = 2;
    while (offset + 4 < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const size = buffer.readUInt16BE(offset + 2);
      if (size < 2 || offset + 2 + size > buffer.length) break;
      if (marker === 0xe1 && buffer.toString('ascii', offset + 4, offset + 10) === 'Exif\0\0') {
        const tiff = offset + 10;
        const endian = buffer.toString('ascii', tiff, tiff + 2);
        const little = endian === 'II';
        const read16 = (position: number) => little ? buffer.readUInt16LE(position) : buffer.readUInt16BE(position);
        const read32 = (position: number) => little ? buffer.readUInt32LE(position) : buffer.readUInt32BE(position);
        if (read16(tiff + 2) !== 42) return 0;
        const ifdOffset = tiff + read32(tiff + 4);
        if (ifdOffset < 0 || ifdOffset + 2 > buffer.length) return 0;
        const entries = read16(ifdOffset);
        for (let index = 0; index < entries; index += 1) {
          const entry = ifdOffset + 2 + index * 12;
          if (entry + 12 > buffer.length) break;
          if (read16(entry) !== 0x0112) continue;
          const orientation = read16(entry + 8);
          if (orientation === 3) return 180;
          if (orientation === 6) return 90;
          if (orientation === 8) return 270;
          return 0;
        }
        return 0;
      }
      offset += 2 + size;
    }
  } catch {
    return 0;
  }
  return 0;
}

function generateMissingImageThumbnails(limit = 500) {
  const imageItems = db.prepare(`
    SELECT id, file_stored_name, file_source_path, file_ext, image_rotation
    FROM items
    WHERE type = 'file'
      AND (thumbnail_data IS NULL OR (LOWER(file_ext) IN ('.jpg', '.jpeg') AND COALESCE(image_rotation, 0) = 0))
    LIMIT ?
  `).all(limit) as { id: string; file_stored_name?: string; file_source_path?: string; file_ext?: string; image_rotation?: number }[];
  const update = db.prepare('UPDATE items SET thumbnail_data = COALESCE(?, thumbnail_data), image_rotation = ? WHERE id = ?');
  for (const item of imageItems) {
    const sourcePath = item.file_source_path || (item.file_stored_name ? path.join(filesDir, item.file_stored_name) : '');
    if (!sourcePath || !fs.existsSync(sourcePath)) continue;
    const thumbnail = createThumbnailData(sourcePath, item.file_ext || path.extname(sourcePath));
    const rotation = readJpegOrientationRotation(sourcePath, item.file_ext || path.extname(sourcePath)) || Number(item.image_rotation || 0);
    if (thumbnail || rotation !== Number(item.image_rotation || 0)) update.run(thumbnail, rotation, item.id);
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
    if (showCurrent) await dialog.showMessageBox(mainWindow!, { type: 'info', message: 'Note Vault is up to date.' });
    return { updateAvailable: false };
  }

  const result = await dialog.showMessageBox(mainWindow!, {
    type: 'info',
    message: `Note Vault ${release.tagName} is available. You are using ${app.getVersion()}.`,
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
  const root = 'Note Vault Export';
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
  <title>Note Vault Export</title>
  <style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.5;color:#1f2937}h1{margin-bottom:0}small{color:#6b7280;margin-left:.5rem}li{margin:.5rem 0}a{color:#2563eb}</style>
</head>
<body>
  <h1>Note Vault Export</h1>
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
    title: 'Note Vault',
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
  writeLog(`Note Vault starting v${app.getVersion()}`);
  createPreUpgradeSafetyBackupIfNeeded();
  loadSettings();
  initDb();
  createWindow();
  setTimeout(() => {
    createAutoBackupIfNeeded();
  }, 60_000);
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
ipcMain.handle('license:status', () => getLicenseStatus());
ipcMain.handle('license:activate', async (_event, key: string) => {
  const cleanKey = String(key || '').trim();
  if (!cleanKey) throw new Error('Enter a license key to activate Note Vault.');
  if (!activationPublicKeyConfigured) throw new Error('Activation public key is not configured in this build.');
  const token = await postActivationRequest(cleanKey);
  const activation = validateActivationToken(token);
  if (!activation.valid) throw new Error(activation.reason || 'Activation token could not be verified.');
  vaultSettings.licenseKey = cleanKey;
  vaultSettings.activationTokenSecret = protectSecret(token);
  vaultSettings.activatedDeviceId = getDeviceId();
  saveSettings();
  writeLog(`License activated for device ${vaultSettings.activatedDeviceId}`);
  return getLicenseStatus();
});
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

ipcMain.handle('app:openVaultDataFolder', async () => {
  const vaultDataDir = app.getPath('userData');
  fs.mkdirSync(vaultDataDir, { recursive: true });
  const error = await shell.openPath(vaultDataDir);
  if (error) throw new Error(error);
  return { ok: true, path: vaultDataDir };
});

ipcMain.handle('app:openExternal', async (_event, url: string) => {
  const trimmedUrl = String(url || '').trim();
  if (!/^https?:\/\//i.test(trimmedUrl)) throw new Error('Only http and https links can be opened.');
  await shell.openExternal(trimmedUrl);
  return { ok: true };
});

ipcMain.handle('items:getMediaUrl', (_event, id: string) => {
  const item = getItem(id);
  if (!item || item.type !== 'file' || (!item.file_stored_name && !item.file_source_path)) {
    throw new Error('File item not found');
  }
  const target = item.file_source_path || path.join(filesDir, item.file_stored_name);
  if (!target || !fs.existsSync(target)) throw new Error('Media file does not exist');
  return pathToFileURL(target).toString();
});

ipcMain.handle('dashboard:summary', () => {
  const count = (where = '', params: unknown[] = []) =>
    (db.prepare(`SELECT COUNT(*) AS total FROM items ${where}`).get(...params) as { total: number }).total;
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
  const videoExts = ['.mp4', '.webm', '.mov', '.m4v', '.ogv'];
  const extPlaceholders = (values: string[]) => values.map(() => '?').join(', ');
  const nonDocumentExts = [...imageExts, ...videoExts, ...audioExts];

  return {
    totalItems: count(),
    notes: count("WHERE type = 'note'"),
    files: count(`WHERE type = 'file' AND (file_ext IS NULL OR LOWER(file_ext) NOT IN (${extPlaceholders(nonDocumentExts)}))`, nonDocumentExts),
    photos: count(`WHERE type = 'file' AND LOWER(file_ext) IN (${extPlaceholders(imageExts)})`, imageExts),
    videos: count(`WHERE type = 'file' AND LOWER(file_ext) IN (${extPlaceholders(videoExts)})`, videoExts),
    audio: count(`WHERE type = 'file' AND LOWER(file_ext) IN (${extPlaceholders(audioExts)})`, audioExts),
    googlePhotos: (db.prepare(`
      SELECT COUNT(DISTINCT items.id) AS total
      FROM items
      LEFT JOIN item_tags ON item_tags.item_id = items.id
      LEFT JOIN tags ON tags.id = item_tags.tag_id
      LEFT JOIN item_collections ON item_collections.item_id = items.id
      LEFT JOIN collections ON collections.id = item_collections.collection_id
      WHERE LOWER(tags.name) IN ('google-photos', 'google-takeout')
        OR LOWER(collections.name) = 'google photos'
        OR items.body LIKE 'Imported from Google Photos Takeout.%'
        OR items.body LIKE '%Source ZIP:%'
        OR items.extracted_text LIKE 'Imported from Google Photos Takeout.%'
        OR items.extracted_text LIKE '%Source ZIP:%'
    `).get() as { total: number }).total,
    locations: count("WHERE body LIKE '%Location:%' OR extracted_text LIKE '%Location:%' OR body LIKE '%Coordinates:%' OR extracted_text LIKE '%Coordinates:%'"),
    favorites: count('WHERE favorite = 1'),
    collections: (db.prepare('SELECT COUNT(*) AS total FROM collections').get() as { total: number }).total,
    tags: (db.prepare('SELECT COUNT(*) AS total FROM tags').get() as { total: number }).total,
    relationships: (db.prepare('SELECT COUNT(*) AS total FROM item_relationships').get() as { total: number }).total,
    memories: (db.prepare('SELECT COUNT(*) AS total FROM memories').get() as { total: number }).total,
    recentItems: (db.prepare('SELECT * FROM items ORDER BY updated_at DESC LIMIT 6').all() as any[]).map(row => compactItem(rowToItem(row)))
  };
});

ipcMain.handle('items:list', (_event, args: { search?: string; tag?: string; type?: string; collectionId?: string; mediaOnly?: boolean; imageOnly?: boolean; videoOnly?: boolean; audioOnly?: boolean; documentOnly?: boolean; favoriteOnly?: boolean; limit?: number; offset?: number; sort?: string } = {}) => {
  const search = (args.search || '').trim().toLowerCase();
  const tag = (args.tag || '').trim();
  const type = (args.type || '').trim();
  const collectionId = (args.collectionId || '').trim();
  const mediaOnly = args.mediaOnly === true;
  const imageOnly = args.imageOnly === true;
  const videoOnly = args.videoOnly === true;
  const audioOnly = args.audioOnly === true;
  const documentOnly = args.documentOnly === true;
  const favoriteOnly = args.favoriteOnly === true;
  const limit = Math.max(1, Math.min(maxListLimit, Math.round(Number(args.limit) || defaultListLimit)));
  const offset = Math.max(0, Math.round(Number(args.offset) || 0));
  const sort = (args.sort || 'updated').trim();

  const orderBy = sort === 'created'
    ? 'created_at DESC'
    : sort === 'title'
      ? 'title COLLATE NOCASE ASC'
      : 'updated_at DESC';
  const conditions: string[] = [];
  const params: unknown[] = [];
  const placeholders = (values: string[]) => values.map(() => '?').join(', ');
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
  const videoExts = ['.mp4', '.webm', '.mov', '.m4v', '.ogv'];
  const mediaExts = [...imageExts, ...videoExts];
  const excludedJournalFileExts = [...mediaExts, ...audioExts];

  if (type && type !== 'all') {
    conditions.push('items.type = ?');
    params.push(type);
  }

  if (mediaOnly) {
    conditions.push(`items.type = 'file' AND LOWER(items.file_ext) IN (${placeholders(mediaExts)})`);
    params.push(...mediaExts);
  }

  if (imageOnly) {
    conditions.push(`items.type = 'file' AND LOWER(items.file_ext) IN (${placeholders(imageExts)})`);
    params.push(...imageExts);
  }

  if (videoOnly) {
    conditions.push(`items.type = 'file' AND LOWER(items.file_ext) IN (${placeholders(videoExts)})`);
    params.push(...videoExts);
  }

  if (audioOnly) {
    conditions.push(`items.type = 'file' AND LOWER(items.file_ext) IN (${placeholders(audioExts)})`);
    params.push(...audioExts);
  }

  if (documentOnly) {
    conditions.push(`items.type = 'file' AND (items.file_ext IS NULL OR LOWER(items.file_ext) NOT IN (${placeholders(excludedJournalFileExts)}))`);
    params.push(...excludedJournalFileExts);
  }

  if (collectionId) {
    conditions.push('items.id IN (SELECT item_id FROM item_collections WHERE collection_id = ?)');
    params.push(collectionId);
  }

  if (favoriteOnly) {
    conditions.push('items.favorite = 1');
  }

  if (tag) {
    conditions.push(`
      items.id IN (
        SELECT item_tags.item_id
        FROM item_tags
        JOIN tags ON tags.id = item_tags.tag_id
        WHERE LOWER(tags.name) = LOWER(?)
      )
    `);
    params.push(tag);
  }

  if (search) {
    const like = `%${search}%`;
    conditions.push(`
      (
        LOWER(items.title) LIKE ?
        OR LOWER(items.body) LIKE ?
        OR LOWER(items.file_name) LIKE ?
        OR LOWER(items.extracted_text) LIKE ?
        OR items.id IN (
          SELECT item_tags.item_id
          FROM item_tags
          JOIN tags ON tags.id = item_tags.tag_id
          WHERE LOWER(tags.name) LIKE ?
        )
      )
    `);
    params.push(like, like, like, like, like);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT items.*
    FROM items
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];

  return rows.map(rowToItem).map(compactItem);
});

ipcMain.handle('items:get', (_event, id: string) => {
  return getItem(id);
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
  return db.prepare(`
    SELECT
      collections.*,
      COUNT(item_collections.item_id) AS count,
      SUM(CASE WHEN items.type = 'note' THEN 1 ELSE 0 END) AS note_count,
      SUM(CASE WHEN items.type = 'file' AND LOWER(items.file_ext) IN ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg') THEN 1 ELSE 0 END) AS image_count,
      SUM(CASE WHEN items.type = 'file' AND LOWER(items.file_ext) IN ('.mp4', '.webm', '.mov', '.m4v', '.ogv') THEN 1 ELSE 0 END) AS video_count,
      SUM(CASE WHEN items.type = 'file' AND LOWER(items.file_ext) IN (${audioExts.map(() => '?').join(', ')}) THEN 1 ELSE 0 END) AS audio_count,
      SUM(CASE WHEN items.type = 'file' AND (items.file_ext IS NULL OR LOWER(items.file_ext) NOT IN ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.mp4', '.webm', '.mov', '.m4v', '.ogv', ${audioExts.map(() => '?').join(', ')})) THEN 1 ELSE 0 END) AS document_count,
      (SELECT COUNT(*) FROM collections child WHERE child.parent_id = collections.id) AS child_count
    FROM collections
    LEFT JOIN item_collections ON item_collections.collection_id = collections.id
    LEFT JOIN items ON items.id = item_collections.item_id
    GROUP BY collections.id, collections.name, collections.mode, collections.parent_id, collections.created_at
    ORDER BY collections.name COLLATE NOCASE
  `).all(...audioExts, ...audioExts);
});

ipcMain.handle('collections:create', (_event, args: string | { name: string; mode?: string; parentId?: string }) => {
  const name = typeof args === 'string' ? args : args.name;
  const mode = typeof args === 'string' ? '' : args.mode || '';
  const parentId = typeof args === 'string' ? '' : args.parentId || '';
  return ensureCollection(name, mode, parentId);
});

ipcMain.handle('collections:setParent', (_event, args: { id: string; parentId: string }) => {
  const id = String(args?.id || '');
  const parentId = String(args?.parentId || '');
  if (!id || !parentId) throw new Error('Choose a collection and a parent collection.');
  if (id === parentId) throw new Error('A collection cannot be inside itself.');

  const collection = db.prepare('SELECT id, mode FROM collections WHERE id = ?').get(id) as { id: string; mode?: string } | undefined;
  const parent = db.prepare('SELECT id, mode, parent_id FROM collections WHERE id = ?').get(parentId) as { id: string; mode?: string; parent_id?: string } | undefined;
  if (!collection || !parent) throw new Error('Collection not found.');
  if ((collection.mode || '') !== (parent.mode || '')) throw new Error('Sub-collections need to stay in the same workspace.');

  let currentParent = parent.parent_id || '';
  while (currentParent) {
    if (currentParent === id) throw new Error('That would create a collection loop.');
    const next = db.prepare('SELECT parent_id FROM collections WHERE id = ?').get(currentParent) as { parent_id?: string } | undefined;
    currentParent = next?.parent_id || '';
  }

  db.prepare('UPDATE collections SET parent_id = ? WHERE id = ?').run(parentId, id);
  return { ok: true };
});

ipcMain.handle('collections:delete', (_event, id: string) => {
  const usage = db.prepare('SELECT COUNT(*) AS total FROM item_collections WHERE collection_id = ?').get(id) as { total: number };
  if ((usage?.total || 0) > 0) {
    throw new Error('Collection is not empty. Remove items from the collection before deleting it.');
  }
  const childUsage = db.prepare('SELECT COUNT(*) AS total FROM collections WHERE parent_id = ?').get(id) as { total: number };
  if ((childUsage?.total || 0) > 0) {
    throw new Error('Collection has sub-collections. Delete or move those first.');
  }
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

ipcMain.handle('items:update', (_event, args: { id: string; title?: string; body?: string; tags?: string[] | string; favorite?: boolean; private?: boolean; imageRotation?: number; createdAt?: string; collectionIds?: string[] }) => {
  const existing = getItem(args.id);
  if (!existing) throw new Error('Item not found');

  db.prepare(`
    UPDATE items
    SET title = ?, body = ?, favorite = ?, private = ?, image_rotation = ?, created_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    args.title ?? existing.title,
    args.body ?? existing.body,
    args.favorite === undefined ? Number(existing.favorite) : Number(args.favorite),
    args.private === undefined ? Number(existing.private) : Number(args.private),
    args.imageRotation === undefined ? Number(existing.image_rotation || 0) : ((Math.round(args.imageRotation / 90) * 90) % 360 + 360) % 360,
    args.createdAt && !Number.isNaN(new Date(args.createdAt).getTime()) ? new Date(args.createdAt).toISOString() : existing.created_at,
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
  db.prepare('DELETE FROM item_relationships WHERE source_item_id = ? OR target_item_id = ?').run(id, id);
  db.prepare('DELETE FROM items WHERE id = ?').run(id);
  cleanupUnusedTags();
  return { ok: true };
});

ipcMain.handle('items:deleteMany', (_event, ids: string[]) => {
  const deleteItem = db.prepare('DELETE FROM items WHERE id = ?');
  const removeRelationships = db.prepare('DELETE FROM item_relationships WHERE source_item_id = ? OR target_item_id = ?');
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
      removeRelationships.run(id, id);
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

ipcMain.handle('relationships:list', (_event, itemId: string) => {
  if (!itemId) return [];
  return listRelationshipsForItem(itemId);
});

ipcMain.handle('relationships:listAll', () => {
  return listAllRelationships();
});

ipcMain.handle('locations:list', () => {
  return listLocationSummaries();
});

ipcMain.handle('locations:getMapTileBaseUrl', () => {
  fs.mkdirSync(mapTilesDir, { recursive: true });
  return hasDownloadedMapTiles() ? pathToFileURL(mapTilesDir).href.replace(/\/?$/, '/') : '';
});

ipcMain.handle('locations:downloadMapTiles', async (_event, tiles: { z: number; x: number; y: number }[]) => {
  fs.mkdirSync(mapTilesDir, { recursive: true });
  const uniqueTiles = Array.from(new Map(
    (tiles || [])
      .filter(tile =>
        Number.isInteger(tile.z) && Number.isInteger(tile.x) && Number.isInteger(tile.y) &&
        tile.z >= 0 && tile.z <= 18 && tile.x >= 0 && tile.y >= 0
      )
      .map(tile => [`${tile.z}/${tile.x}/${tile.y}`, tile])
  ).values()).slice(0, 80);

  let downloaded = 0;
  let skipped = 0;
  for (const tile of uniqueTiles) {
    const targetPath = path.join(mapTilesDir, String(tile.z), String(tile.x), `${tile.y}.png`);
    if (fs.existsSync(targetPath)) {
      skipped += 1;
      continue;
    }
    const url = `https://basemaps.cartocdn.com/rastertiles/voyager/${tile.z}/${tile.x}/${tile.y}.png`;
    await downloadMapTile(url, targetPath);
    downloaded += 1;
  }

  return {
    downloaded,
    skipped,
    total: uniqueTiles.length,
    baseUrl: pathToFileURL(mapTilesDir).href.replace(/\/?$/, '/')
  };
});

ipcMain.handle('relationships:add', (_event, args: { itemId: string; relatedItemId: string; note?: string }) => {
  const [sourceItemId, targetItemId] = relationshipPair(args.itemId, args.relatedItemId);
  const source = getItem(sourceItemId);
  const target = getItem(targetItemId);
  if (!source || !target) throw new Error('Both related items must exist.');

  db.prepare(`
    INSERT OR IGNORE INTO item_relationships (source_item_id, target_item_id, note, created_at)
    VALUES (?, ?, ?, ?)
  `).run(sourceItemId, targetItemId, args.note || '', nowIso());

  return listRelationshipsForItem(args.itemId);
});

ipcMain.handle('relationships:remove', (_event, args: { itemId: string; relatedItemId: string }) => {
  const [sourceItemId, targetItemId] = relationshipPair(args.itemId, args.relatedItemId);
  db.prepare('DELETE FROM item_relationships WHERE source_item_id = ? AND target_item_id = ?').run(sourceItemId, targetItemId);
  return listRelationshipsForItem(args.itemId);
});

ipcMain.handle('memories:list', () => {
  return listMemories();
});

ipcMain.handle('memories:get', (_event, id: string) => {
  return getMemory(id);
});

ipcMain.handle('memories:suggestions', () => {
  return listMemorySuggestions();
});

ipcMain.handle('memories:create', (_event, args: { title: string; description?: string; theme?: string; itemIds?: string[] }) => {
  const title = (args.title || '').trim() || 'Untitled Memory';
  const ts = nowIso();
  const id = randomUUID();
  const itemIds = [...new Set((args.itemIds || []).filter(Boolean))];
  const coverItemId = itemIds[0] || null;
  db.transaction(() => {
    db.prepare(`
      INSERT INTO memories (id, title, description, theme, cover_item_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, title, args.description || '', args.theme || 'cozy', coverItemId, ts, ts);
    const insertItem = db.prepare(`
      INSERT OR IGNORE INTO memory_items (memory_id, item_id, x, y, width, height, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    itemIds.forEach((itemId, index) => {
      insertItem.run(id, itemId, 40 + (index % 3) * 290, 40 + Math.floor(index / 3) * 230, 260, 190, index, ts);
    });
  })();
  return getMemory(id);
});

ipcMain.handle('memories:delete', (_event, id: string) => {
  const memory = getMemory(id);
  if (!memory) return { ok: true };
  db.prepare('DELETE FROM memory_decorations WHERE memory_id = ?').run(id);
  db.prepare('DELETE FROM memory_items WHERE memory_id = ?').run(id);
  db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  return { ok: true };
});

ipcMain.handle('memories:update', (_event, args: { id: string; title?: string; description?: string; theme?: string; coverItemId?: string }) => {
  const memory = getMemory(args.id);
  if (!memory) throw new Error('Memory not found.');
  db.prepare(`
    UPDATE memories
    SET title = ?, description = ?, theme = ?, cover_item_id = ?, updated_at = ?
    WHERE id = ?
  `).run(
    ((args.title ?? memory.title) || 'Untitled Memory').trim() || 'Untitled Memory',
    (args.description ?? memory.description) || '',
    (args.theme ?? memory.theme) || 'cozy',
    (args.coverItemId ?? memory.cover_item_id) || null,
    nowIso(),
    args.id
  );
  return getMemory(args.id);
});

ipcMain.handle('memories:updatePlayerPosition', (_event, args: { id: string; x: number; y: number }) => {
  const memory = getMemory(args.id);
  if (!memory) throw new Error('Memory not found.');
  db.prepare('UPDATE memories SET player_x = ?, player_y = ?, updated_at = ? WHERE id = ?').run(
    Math.max(0, Math.round(Number(args.x) || 0)),
    Math.max(0, Math.round(Number(args.y) || 0)),
    nowIso(),
    args.id
  );
  return getMemory(args.id);
});

ipcMain.handle('memories:addItem', (_event, args: { memoryId: string; itemId: string }) => {
  const memory = getMemory(args.memoryId);
  if (!memory) throw new Error('Memory not found.');
  const item = getItem(args.itemId);
  if (!item) throw new Error('Item not found.');
  const ts = nowIso();
  const nextOrder = (db.prepare('SELECT COUNT(*) AS total FROM memory_items WHERE memory_id = ?').get(args.memoryId) as { total: number }).total;
  db.prepare(`
    INSERT OR IGNORE INTO memory_items (memory_id, item_id, x, y, width, height, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(args.memoryId, args.itemId, 40 + (nextOrder % 3) * 290, 40 + Math.floor(nextOrder / 3) * 230, 260, 190, nextOrder, ts);
  db.prepare('UPDATE memories SET updated_at = ?, cover_item_id = COALESCE(cover_item_id, ?) WHERE id = ?').run(ts, args.itemId, args.memoryId);
  return getMemory(args.memoryId);
});

ipcMain.handle('memories:removeItem', (_event, args: { memoryId: string; itemId: string }) => {
  db.prepare('DELETE FROM memory_items WHERE memory_id = ? AND item_id = ?').run(args.memoryId, args.itemId);
  db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run(nowIso(), args.memoryId);
  return getMemory(args.memoryId);
});

ipcMain.handle('memories:updateLayout', (_event, args: { memoryId: string; items: { itemId: string; x: number; y: number; width?: number; height?: number }[] }) => {
  const update = db.prepare('UPDATE memory_items SET x = ?, y = ?, width = ?, height = ? WHERE memory_id = ? AND item_id = ?');
  db.transaction(() => {
    for (const item of args.items || []) {
      update.run(
        Math.max(0, Math.round(Number(item.x) || 0)),
        Math.max(0, Math.round(Number(item.y) || 0)),
        Math.max(160, Math.round(Number(item.width) || 260)),
        Math.max(120, Math.round(Number(item.height) || 190)),
        args.memoryId,
        item.itemId
      );
    }
    db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run(nowIso(), args.memoryId);
  })();
  return getMemory(args.memoryId);
});

ipcMain.handle('memories:addDecoration', (_event, args: { memoryId: string; kind: string; label?: string; color?: string }) => {
  const memory = getMemory(args.memoryId);
  if (!memory) throw new Error('Memory not found.');
  const kind = ['string', 'arrow', 'pin', 'label'].includes(args.kind) ? args.kind : 'string';
  const ts = nowIso();
  const id = randomUUID();
  const defaults: Record<string, { width: number; height: number; rotation: number; color: string; label: string }> = {
    string: { width: 220, height: 22, rotation: -8, color: '#b91c1c', label: '' },
    arrow: { width: 160, height: 36, rotation: 0, color: '#2563eb', label: '' },
    pin: { width: 42, height: 42, rotation: 0, color: '#d97706', label: '' },
    label: { width: 190, height: 78, rotation: -2, color: '#f5d48a', label: args.label || 'note' }
  };
  const preset = defaults[kind];
  const count = Number((db.prepare('SELECT COUNT(*) AS total FROM memory_decorations WHERE memory_id = ?').get(args.memoryId) as { total: number }).total || 0);
  db.prepare(`
    INSERT INTO memory_decorations (id, memory_id, kind, label, x, y, width, height, rotation, color, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, args.memoryId, kind, preset.label, 80 + (count % 4) * 70, 80 + (count % 3) * 55, preset.width, preset.height, preset.rotation, args.color || preset.color, ts);
  db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run(ts, args.memoryId);
  return getMemory(args.memoryId);
});

ipcMain.handle('memories:updateDecoration', (_event, args: { memoryId: string; id: string; x?: number; y?: number; width?: number; height?: number; rotation?: number; label?: string; color?: string }) => {
  const existing = db.prepare('SELECT * FROM memory_decorations WHERE memory_id = ? AND id = ?').get(args.memoryId, args.id) as any | undefined;
  if (!existing) throw new Error('Decoration not found.');
  db.prepare(`
    UPDATE memory_decorations
    SET x = ?, y = ?, width = ?, height = ?, rotation = ?, label = ?, color = ?
    WHERE memory_id = ? AND id = ?
  `).run(
    Math.max(0, Math.round(Number(args.x ?? existing.x) || 0)),
    Math.max(0, Math.round(Number(args.y ?? existing.y) || 0)),
    Math.max(24, Math.round(Number(args.width ?? existing.width) || 180)),
    Math.max(16, Math.round(Number(args.height ?? existing.height) || 24)),
    Math.round(Number(args.rotation ?? existing.rotation) || 0),
    args.label ?? existing.label ?? '',
    args.color ?? existing.color ?? '',
    args.memoryId,
    args.id
  );
  db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run(nowIso(), args.memoryId);
  return getMemory(args.memoryId);
});

ipcMain.handle('memories:removeDecoration', (_event, args: { memoryId: string; id: string }) => {
  db.prepare('DELETE FROM memory_decorations WHERE memory_id = ? AND id = ?').run(args.memoryId, args.id);
  db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run(nowIso(), args.memoryId);
  return getMemory(args.memoryId);
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
  const storedName = safeUniqueStoredName(ext);
  const dest = path.join(filesDir, storedName);
  fs.copyFileSync(args.sourcePath, dest);

  const id = randomUUID();
  const ts = nowIso();
  const extracted = await extractText(dest, ext);
  const thumbnail = createThumbnailData(dest, ext);
  const imageRotation = readJpegOrientationRotation(dest, ext);

  db.prepare(`
    INSERT INTO items (id, title, type, body, file_name, file_stored_name, file_ext, extracted_text, thumbnail_data, image_rotation, created_at, updated_at)
    VALUES (?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, args.title || originalName, args.body || '', originalName, storedName, ext, extracted, thumbnail, imageRotation, ts, ts);

  setTagsForItem(id, args.tags);
  setCollectionsForItem(id, args.collectionIds);
  return getItem(id);
});

ipcMain.handle('items:importNotionExport', async (_event, args: { sourceType?: 'zip' | 'folder' } = {}) => {
  const sourceType = args.sourceType === 'folder' ? 'folder' : 'zip';
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: sourceType === 'folder' ? 'Choose extracted Notion export folder' : 'Choose Notion export ZIP',
    properties: sourceType === 'folder' ? ['openDirectory'] : ['openFile'],
    filters: sourceType === 'folder'
      ? undefined
      : [
          { name: 'Notion export ZIP', extensions: ['zip'] },
          { name: 'All files', extensions: ['*'] }
        ]
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true as const };

  const sourcePath = result.filePaths[0];
  const entries = readNotionExportEntries(sourcePath);
  const markdownEntries = entries.filter(entry => path.extname(entry.relativePath).toLowerCase() === '.md');
  if (markdownEntries.length === 0) {
    throw new Error('No Markdown pages were found. Export Notion as Markdown & CSV, then choose the ZIP or extracted folder.');
  }

  const importRoot = ensureCollection('Notion Import', 'note');
  const collectionCache = new Map<string, string>([[importRoot.name.toLowerCase(), importRoot.id]]);
  const getCollectionId = (name: string, mode = 'note') => {
    const cleanName = cleanNotionName(name);
    const key = `${mode}:${cleanName.toLowerCase()}`;
    const cached = collectionCache.get(key);
    if (cached) return cached;
    const collection = ensureCollection(cleanName, mode);
    collectionCache.set(key, collection.id);
    return collection.id;
  };

  const noteByPath = new Map<string, string>();
  const assetByPath = new Map<string, { id: string; fileUrl: string; title: string }>();
  const existingNotionRows = db.prepare(`
    SELECT id, title, type, body, file_name, file_stored_name
    FROM items
    WHERE body LIKE '%Imported from Notion export.%Source:%'
  `).all() as { id: string; title: string; type: string; body?: string; file_name?: string; file_stored_name?: string }[];
  const existingNotionBySource = new Map<string, typeof existingNotionRows[number]>();
  for (const row of existingNotionRows) {
    const sourceMatch = (row.body || '').match(/Source:\s*(.+)\s*$/m);
    if (sourceMatch?.[1]) {
      existingNotionBySource.set(normalizeArchivePath(sourceMatch[1].trim()), row);
    }
  }
  const insertedFile = db.prepare(`
    INSERT INTO items (id, title, type, body, file_name, file_stored_name, file_ext, extracted_text, thumbnail_data, image_rotation, created_at, updated_at)
    VALUES (?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertedNote = db.prepare(`
    INSERT INTO items (id, title, type, body, created_at, updated_at)
    VALUES (?, ?, 'note', ?, ?, ?)
  `);

  let importedNotes = 0;
  let importedFiles = 0;
  let relationships = 0;
  let duplicateSkipped = 0;
  let lastItemId = '';

  const nonMarkdownEntries = entries.filter(entry => path.extname(entry.relativePath).toLowerCase() !== '.md');
  for (const entry of nonMarkdownEntries) {
    const sourceKey = normalizeArchivePath(entry.relativePath);
    const originalName = path.basename(entry.relativePath);
    const ext = path.extname(originalName).toLowerCase();
    const title = cleanNotionName(originalName);
    const existing = existingNotionBySource.get(sourceKey);
    if (existing) {
      if (existing.type === 'file' && existing.file_stored_name) {
        const existingPath = path.join(filesDir, existing.file_stored_name);
        assetByPath.set(sourceKey, {
          id: existing.id,
          fileUrl: fs.existsSync(existingPath) ? pathToFileURL(existingPath).href : '',
          title: existing.title || title
        });
      }
      duplicateSkipped += 1;
      continue;
    }
    const storedName = safeUniqueStoredName(ext);
    const dest = path.join(filesDir, storedName);
    fs.writeFileSync(dest, entry.data);

    const id = randomUUID();
    const ts = nowIso();
    const extracted = await extractText(dest, ext);
    const thumbnail = createThumbnailData(dest, ext);
    const imageRotation = readJpegOrientationRotation(dest, ext);
    const body = `Imported from Notion export.\nSource: ${entry.relativePath}`;

    insertedFile.run(id, title, body, originalName, storedName, ext, extracted, thumbnail, imageRotation, ts, ts);
    setTagsForItem(id, ['notion-import', 'notion-asset']);
    const collectionIds = [importRoot.id, ...relativeCollectionNames(entry.relativePath).map(name => getCollectionId(name))];
    setCollectionsForItem(id, [...new Set(collectionIds)]);
    assetByPath.set(sourceKey, { id, fileUrl: pathToFileURL(dest).href, title });
    importedFiles += 1;
    lastItemId = id;
  }

  for (const entry of markdownEntries) {
    const sourceKey = normalizeArchivePath(entry.relativePath);
    const title = cleanNotionName(path.basename(entry.relativePath));
    let body = entry.data.toString('utf8');
    body = body.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full, label, target) => {
      const resolved = resolveMarkdownTarget(entry.relativePath, target);
      const asset = resolved ? assetByPath.get(resolved) : null;
      return asset ? `![${label || asset.title}](${asset.fileUrl})` : full;
    });
    body = `${body.trim()}\n\n---\nImported from Notion export.\nSource: ${entry.relativePath}`.trim();
    const existing = existingNotionBySource.get(sourceKey);
    if (existing) {
      noteByPath.set(sourceKey, existing.id);
      duplicateSkipped += 1;
      continue;
    }

    const id = randomUUID();
    const ts = nowIso();
    insertedNote.run(id, title, body, ts, ts);
    setTagsForItem(id, ['notion-import', 'notion-page']);
    const collectionIds = [importRoot.id, ...relativeCollectionNames(entry.relativePath).map(name => getCollectionId(name))];
    setCollectionsForItem(id, [...new Set(collectionIds)]);
    noteByPath.set(sourceKey, id);
    importedNotes += 1;
    lastItemId = id;
  }

  for (const entry of markdownEntries) {
    const noteId = noteByPath.get(normalizeArchivePath(entry.relativePath));
    if (!noteId) continue;
    const markdown = entry.data.toString('utf8');
    for (const link of extractMarkdownLinks(markdown)) {
      const resolved = resolveMarkdownTarget(entry.relativePath, link.target);
      if (!resolved) continue;
      const linkedNoteId = noteByPath.get(resolved);
      if (linkedNoteId) {
        addRelationshipBetween(noteId, linkedNoteId, 'Imported Notion page link');
        relationships += 1;
        continue;
      }
      const asset = assetByPath.get(resolved);
      if (asset) {
        addRelationshipBetween(noteId, asset.id, link.image ? 'Imported Notion embedded file' : 'Imported Notion file link');
        relationships += 1;
      }
    }

    const parentPageCandidate = `${path.posix.dirname(normalizeArchivePath(entry.relativePath))}.md`;
    const parentNoteId = noteByPath.get(parentPageCandidate);
    if (parentNoteId && parentNoteId !== noteId) {
      addRelationshipBetween(parentNoteId, noteId, 'Imported Notion parent page');
      relationships += 1;
    }
  }

  for (const [assetPath, asset] of assetByPath) {
    const parentPageCandidate = `${path.posix.dirname(assetPath)}.md`;
    const parentNoteId = noteByPath.get(parentPageCandidate);
    if (parentNoteId) {
      addRelationshipBetween(parentNoteId, asset.id, 'Imported Notion page asset');
      relationships += 1;
    }
  }

  return {
    canceled: false as const,
    importedNotes,
    importedFiles,
    relationships,
    duplicateSkipped,
    collectionCount: collectionCache.size,
    lastItem: lastItemId ? getItem(lastItemId) : null
  };
});

ipcMain.handle('items:importGooglePhotosTakeout', async () => {
  const sendProgress = (payload: {
    phase: string;
    current: number;
    total: number;
    fileName?: string;
    imported?: number;
    matchedMetadata?: number;
    skipped?: number;
  }) => {
    mainWindow?.webContents.send('googlePhotosImport:progress', payload);
  };

  const choice = await chooseTakeoutZipFolder();
  if (choice.canceled) return { canceled: true };
  const zipPaths = choice.zipPaths;

  sendProgress({ phase: 'Checking available disk space', current: 0, total: zipPaths.length });
  const importEstimate = await estimateGooglePhotosImportBytes(zipPaths, sendProgress);
  const availableBytes = getAvailableBytes(filesDir);
  const safetyBuffer = Math.max(1_000_000_000, Math.ceil(importEstimate.estimatedBytes * 0.1));
  const requiredBytes = importEstimate.estimatedBytes + safetyBuffer;
  if (availableBytes < requiredBytes) {
    throw new Error(
      `Not enough disk space to import Google Photos. Estimated media size is ${formatByteCount(importEstimate.estimatedBytes)} ` +
      `for ${importEstimate.mediaFiles.toLocaleString()} files, plus a ${formatByteCount(safetyBuffer)} safety buffer. ` +
      `Available space is ${formatByteCount(availableBytes)}. Free up space or import a smaller Takeout folder.`
    );
  }

  const collection = ensureCollection('Google Photos');
  const insertItem = db.prepare(`
    INSERT INTO items (id, title, type, body, file_name, file_stored_name, file_ext, extracted_text, thumbnail_data, image_rotation, created_at, updated_at)
    VALUES (?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let imported = 0;
  let matchedMetadata = 0;
  let skipped = 0;
  let duplicateSkipped = 0;
  let lastItemId = '';
  const existingGooglePhotoNames = new Set((db.prepare(`
    SELECT DISTINCT items.file_name
    FROM items
    JOIN item_tags ON item_tags.item_id = items.id
    JOIN tags ON tags.id = item_tags.tag_id
    WHERE tags.name = 'google-photos' AND items.file_name IS NOT NULL
  `).all() as { file_name: string }[]).map(row => row.file_name.toLowerCase()));
  sendProgress({ phase: 'Opening Google Takeout ZIPs', current: 0, total: zipPaths.length });

  for (let zipIndex = 0; zipIndex < zipPaths.length; zipIndex += 1) {
    const zipPath = zipPaths[zipIndex];
    const zipName = path.basename(zipPath);
    try {
      const unzipper = await import('unzipper') as any;
      sendProgress({ phase: 'Reading ZIP directory', current: zipIndex + 1, total: zipPaths.length, fileName: zipName, imported, matchedMetadata, skipped });
      const zipDirectory = await unzipper.Open.file(zipPath);
      const zipEntries = zipDirectory.files || [];
      const mediaEntries = zipEntries.filter((entry: any) => {
        if (entry.type === 'Directory') return false;
        const originalName = path.basename(entry.path || entry.entryName || '');
        return googlePhotosMediaExts.has(path.extname(originalName).toLowerCase());
      });
      sendProgress({ phase: 'Indexing photo metadata', current: 0, total: mediaEntries.length, fileName: zipName, imported, matchedMetadata, skipped });
      const jsonIndex = await buildGooglePhotosJsonIndex(zipEntries, message => {
        sendProgress({ phase: message, current: 0, total: mediaEntries.length, fileName: zipName, imported, matchedMetadata, skipped });
      });

      for (let mediaIndex = 0; mediaIndex < mediaEntries.length; mediaIndex += 1) {
        const entry = mediaEntries[mediaIndex];
        if (entry.type === 'Directory') continue;
        const entryPath = entry.path || entry.entryName || '';
        const originalName = path.basename(entryPath);
        const ext = path.extname(originalName).toLowerCase();
        if (!googlePhotosMediaExts.has(ext)) continue;

        try {
          if (existingGooglePhotoNames.has(originalName.toLowerCase())) {
            duplicateSkipped += 1;
            skipped += 1;
            continue;
          }
          sendProgress({
            phase: `Importing ZIP ${zipIndex + 1} of ${zipPaths.length}`,
            current: mediaIndex + 1,
            total: mediaEntries.length,
            fileName: originalName,
            imported,
            matchedMetadata,
            skipped
          });
          const metadata = lookupGooglePhotosMetadata(jsonIndex, originalName);
          const storedName = safeUniqueStoredName(ext);
          const dest = path.join(filesDir, storedName);
          await streamZipEntryToFile(entry, dest);

          const timestamp = metadata?.timestamp;
          const itemDate = timestamp ? new Date(timestamp * 1000).toISOString() : nowIso();
          if (timestamp) {
            try {
              fs.utimesSync(dest, timestamp, timestamp);
            } catch {
              // File mtime is helpful but not required for a good import.
            }
          }

          const id = randomUUID();
          const metadataText = googlePhotosMetadataBody(metadata, path.basename(zipPath));
          const body = '';
          const extracted = [
            metadataText,
            metadata?.description || '',
            metadata?.title || originalName,
            metadata?.url || ''
          ].filter(Boolean).join('\n');
          const thumbnail = createThumbnailData(dest, ext);
          const imageRotation = readJpegOrientationRotation(dest, ext);

          insertItem.run(
            id,
            path.parse(originalName).name,
            body,
            originalName,
            storedName,
            ext,
            extracted.slice(0, 500_000),
            thumbnail,
            imageRotation,
            itemDate,
            itemDate
          );
          setTagsForItem(id, ['photo', 'google-photos', 'google-takeout']);
          setCollectionsForItem(id, [collection.id]);
          imported += 1;
          if (metadata) matchedMetadata += 1;
          existingGooglePhotoNames.add(originalName.toLowerCase());
          lastItemId = id;
        } catch (error) {
          skipped += 1;
          writeLog(`Google Photos import skipped ${originalName}`, error);
        }
      }
    } catch (error) {
      skipped += 1;
      writeLog(`Google Photos import failed on ${path.basename(zipPath)}`, error);
    }
  }

  sendProgress({ phase: 'Google Photos import complete', current: imported, total: imported, imported, matchedMetadata, skipped });

  return {
    canceled: false,
    imported,
    matchedMetadata,
    skipped,
    duplicateSkipped,
    zipCount: zipPaths.length,
    collectionId: collection.id,
    lastItem: lastItemId ? getItem(lastItemId) : null
  };
});

ipcMain.handle('items:repairGooglePhotosMetadata', async () => {
  const sendProgress = (payload: {
    phase: string;
    current: number;
    total: number;
    fileName?: string;
    imported?: number;
    matchedMetadata?: number;
    skipped?: number;
  }) => {
    mainWindow?.webContents.send('googlePhotosImport:progress', payload);
  };

  const choice = await chooseTakeoutZipFolder();
  if (choice.canceled) return { canceled: true };

  sendProgress({ phase: 'Building Google Photos metadata index', current: 0, total: choice.zipPaths.length });
  const { metadataIndex, metadataRecords, jsonFiles } = await buildGooglePhotosMetadataIndex(choice.zipPaths, sendProgress);

  const rawRows = db.prepare(`
    SELECT DISTINCT items.*
    FROM items
    JOIN item_tags ON item_tags.item_id = items.id
    JOIN tags ON tags.id = item_tags.tag_id
    WHERE tags.name = 'google-photos'
    ORDER BY items.created_at DESC
  `).all() as any[];
  const seenFileNames = new Set<string>();
  const rows = rawRows.filter(row => {
    const key = String(row.file_name || row.title || row.id).toLowerCase();
    if (seenFileNames.has(key)) return false;
    seenFileNames.add(key);
    return true;
  });

  const update = db.prepare(`
    UPDATE items
    SET body = ?, extracted_text = ?, created_at = ?, updated_at = ?
    WHERE id = ?
  `);

  let matched = 0;
  let updated = 0;
  const matchedExamples: string[] = [];
  const unmatchedExamples: string[] = [];
  const unmatchedDetails: string[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const fileName = row.file_name || row.title || '';
    sendProgress({
      phase: 'Repairing Google Photos metadata',
      current: index + 1,
      total: rows.length,
      fileName,
      matchedMetadata: matched,
      skipped: unmatchedExamples.length
    });

    const metadata = lookupGooglePhotosMetadata(metadataIndex, fileName);
    if (!metadata) {
      if (unmatchedExamples.length < 12 && !unmatchedExamples.includes(fileName)) unmatchedExamples.push(fileName);
      if (unmatchedDetails.length < 8) {
        const candidates = closestGooglePhotosMetadataCandidates(metadataRecords, fileName);
        unmatchedDetails.push(candidates.length
          ? `${fileName} -> closest JSON: ${candidates.join(' | ')}`
          : `${fileName} -> no close JSON title/sidecar found in selected ZIPs`
        );
      }
      continue;
    }

    matched += 1;
    if (matchedExamples.length < 8 && !matchedExamples.includes(fileName)) matchedExamples.push(fileName);
    const previousBody = row.body || '';
    const sourceZip = metadata.sourceZip
      || previousBody.match(/Source ZIP: (.+)/)?.[1]
      || row.extracted_text?.match(/Source ZIP: (.+)/)?.[1]
      || 'Google Takeout';
    const metadataText = googlePhotosMetadataBody(metadata, sourceZip);
    const body = previousBody.startsWith('Imported from Google Photos Takeout.') ? '' : previousBody;
    const extracted = [
      metadataText,
      metadata?.description || '',
      metadata?.title || fileName,
      metadata?.url || ''
    ].filter(Boolean).join('\n').slice(0, 500_000);
    const itemDate = metadata?.timestamp ? new Date(metadata.timestamp * 1000).toISOString() : row.created_at;

    if (row.body !== body || row.extracted_text !== extracted || row.created_at !== itemDate) {
      update.run(body, extracted, itemDate, row.updated_at || nowIso(), row.id);
      updated += 1;
    }
  }

  sendProgress({
    phase: 'Google Photos metadata repair complete',
    current: rows.length,
    total: rows.length,
    matchedMetadata: matched,
    skipped: rows.length - matched
  });

  return {
    canceled: false,
    zipCount: choice.zipPaths.length,
    metadataFiles: jsonFiles,
    metadataKeys: metadataIndex.size,
    scannedItems: rows.length,
    matched,
    updated,
    unmatched: rows.length - matched,
    matchedExamples,
    unmatchedExamples,
    unmatchedDetails
  };
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
    defaultPath: `note-vault-export-${dateStamp()}.zip`,
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
  backupFrequency: vaultSettings.backupFrequency,
  backupRetentionCount: vaultSettings.backupRetentionCount,
  allowNewImportTagSuggestions: vaultSettings.allowNewImportTagSuggestions,
  backupEncryptionEnabled: vaultSettings.backupEncryptionEnabled,
  backupEncryptionAvailable: safeStorage.isEncryptionAvailable(),
  backupStats: getBackupStats()
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
  return {
    canceled: false,
    path: backupsDir,
    backupDirectory: backupsDir,
    backupFrequency: vaultSettings.backupFrequency,
    backupRetentionCount: vaultSettings.backupRetentionCount,
    allowNewImportTagSuggestions: vaultSettings.allowNewImportTagSuggestions,
    backupEncryptionEnabled: vaultSettings.backupEncryptionEnabled,
    backupEncryptionAvailable: safeStorage.isEncryptionAvailable(),
    backupStats: getBackupStats()
  };
});

ipcMain.handle('backup:setFrequency', (_event, frequency: BackupFrequency) => {
  if (!['on-close', 'daily', 'weekly', 'never'].includes(frequency)) throw new Error('Invalid backup frequency');
  vaultSettings.backupFrequency = frequency;
  saveSettings();
  return {
    backupDirectory: backupsDir,
    backupFrequency: frequency,
    backupRetentionCount: vaultSettings.backupRetentionCount,
    allowNewImportTagSuggestions: vaultSettings.allowNewImportTagSuggestions,
    backupEncryptionEnabled: vaultSettings.backupEncryptionEnabled,
    backupEncryptionAvailable: safeStorage.isEncryptionAvailable(),
    backupStats: getBackupStats()
  };
});

ipcMain.handle('backup:setRetentionCount', (_event, count: number) => {
  const nextCount = Math.max(1, Math.min(200, Math.round(Number(count) || 10)));
  vaultSettings.backupRetentionCount = nextCount;
  saveSettings();
  const pruneResult = pruneOldAutoBackups();
  return {
    backupDirectory: backupsDir,
    backupFrequency: vaultSettings.backupFrequency,
    backupRetentionCount: vaultSettings.backupRetentionCount,
    allowNewImportTagSuggestions: vaultSettings.allowNewImportTagSuggestions,
    backupEncryptionEnabled: vaultSettings.backupEncryptionEnabled,
    backupEncryptionAvailable: safeStorage.isEncryptionAvailable(),
    backupStats: {
      count: pruneResult.count,
      totalBytes: pruneResult.totalBytes,
      retentionCount: vaultSettings.backupRetentionCount
    },
    deleted: pruneResult.deleted
  };
});

ipcMain.handle('settings:setImportTagSuggestions', (_event, allowNewTags: boolean) => {
  vaultSettings.allowNewImportTagSuggestions = Boolean(allowNewTags);
  saveSettings();
  return {
    backupDirectory: backupsDir,
    backupFrequency: vaultSettings.backupFrequency,
    backupRetentionCount: vaultSettings.backupRetentionCount,
    allowNewImportTagSuggestions: vaultSettings.allowNewImportTagSuggestions,
    backupEncryptionEnabled: vaultSettings.backupEncryptionEnabled,
    backupEncryptionAvailable: safeStorage.isEncryptionAvailable(),
    backupStats: getBackupStats()
  };
});

ipcMain.handle('backup:setEncryption', (_event, args: { enabled: boolean; password?: string }) => {
  if (!args.enabled) {
    if (vaultSettings.backupEncryptionEnabled) {
      const password = String(args.password || '');
      if (!password || !verifyPassword(password, vaultSettings.backupEncryptionSalt, vaultSettings.backupEncryptionPasswordHash)) {
        throw new Error('Enter the current backup password to turn off encrypted backups.');
      }
    }
    vaultSettings.backupEncryptionEnabled = false;
    vaultSettings.backupEncryptionPasswordHash = undefined;
    vaultSettings.backupEncryptionSalt = undefined;
    vaultSettings.backupEncryptionPasswordSecret = undefined;
  } else {
    const password = String(args.password || '');
    if (password.length < 8) throw new Error('Backup password must be at least 8 characters.');
    const hashed = passwordHash(password);
    vaultSettings.backupEncryptionEnabled = true;
    vaultSettings.backupEncryptionPasswordHash = hashed.hash;
    vaultSettings.backupEncryptionSalt = hashed.salt;
    vaultSettings.backupEncryptionPasswordSecret = protectSecret(password);
  }
  saveSettings();
  return {
    backupDirectory: backupsDir,
    backupFrequency: vaultSettings.backupFrequency,
    backupRetentionCount: vaultSettings.backupRetentionCount,
    allowNewImportTagSuggestions: vaultSettings.allowNewImportTagSuggestions,
    backupEncryptionEnabled: vaultSettings.backupEncryptionEnabled,
    backupEncryptionAvailable: safeStorage.isEncryptionAvailable(),
    backupStats: getBackupStats()
  };
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

ipcMain.handle('backup:import', async (_event, args: { password?: string } = {}) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Import Note Vault Backup',
    properties: ['openFile'],
    filters: [{ name: 'Note Vault Backup', extensions: ['vaultbackup', 'zip'] }]
  });

  if (result.canceled || !result.filePaths[0]) return { canceled: true };

  const backupPath = result.filePaths[0];
  let workingBackupPath = backupPath;
  let tempDecryptedPath = '';
  if (fileLooksEncrypted(backupPath)) {
    const password = String(args.password || '');
    if (!password) throw new Error('This backup is encrypted. Enter the backup password to import it.');
    try {
      tempDecryptedPath = path.join(app.getPath('temp'), `note-vault-restore-${randomUUID()}.vaultbackup`);
      decryptFileSync(backupPath, tempDecryptedPath, password);
      workingBackupPath = tempDecryptedPath;
    } catch {
      throw new Error('Could not decrypt backup. Check the password and try again.');
    }
  }
  const sendProgress = (payload: {
    phase: string;
    current: number;
    total: number;
    fileName?: string;
    imported?: number;
  }) => {
    mainWindow?.webContents.send('backupImport:progress', payload);
  };

  sendProgress({ phase: 'Opening backup', current: 0, total: 1, fileName: path.basename(backupPath) });
  const unzipper = await import('unzipper') as any;
  const zipDirectory = await unzipper.Open.file(workingBackupPath);
  const zipEntries = zipDirectory.files || [];
  const backupEntry = zipEntries.find((entry: any) => entry.path === 'backup.json' || entry.entryName === 'backup.json');

  if (!backupEntry) {
    throw new Error('Invalid backup: missing backup.json');
  }

  sendProgress({ phase: 'Reading backup catalog', current: 0, total: 1, fileName: 'backup.json' });
  const backup = JSON.parse(await readZipEntryText(backupEntry));

  if (!backup.items || !backup.tags || !backup.item_tags) {
    throw new Error('Invalid backup file');
  }

  sendProgress({
    phase: 'Restoring vault records',
    current: 0,
    total: Number(backup.items?.length || 0) + Number(backup.tags?.length || 0) + Number(backup.collections?.length || 0)
  });

  const trx = db.transaction(() => {
    db.prepare('DELETE FROM memory_decorations').run();
    db.prepare('DELETE FROM memory_items').run();
    db.prepare('DELETE FROM memories').run();
    db.prepare('DELETE FROM item_relationships').run();
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
        image_rotation,
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
        @image_rotation,
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
      INSERT INTO collections (id, name, mode, parent_id, created_at)
      VALUES (@id, @name, @mode, @parent_id, @created_at)
    `);

    const insertItemCollection = db.prepare(`
      INSERT INTO item_collections (item_id, collection_id)
      VALUES (@item_id, @collection_id)
    `);

    const insertRelationship = db.prepare(`
      INSERT OR IGNORE INTO item_relationships (source_item_id, target_item_id, note, created_at)
      VALUES (@source_item_id, @target_item_id, @note, @created_at)
    `);

    const insertMemory = db.prepare(`
      INSERT INTO memories (id, title, description, theme, cover_item_id, player_x, player_y, created_at, updated_at)
      VALUES (@id, @title, @description, @theme, @cover_item_id, @player_x, @player_y, @created_at, @updated_at)
    `);

    const insertMemoryItem = db.prepare(`
      INSERT OR IGNORE INTO memory_items (memory_id, item_id, x, y, width, height, sort_order, created_at)
      VALUES (@memory_id, @item_id, @x, @y, @width, @height, @sort_order, @created_at)
    `);

    const insertMemoryDecoration = db.prepare(`
      INSERT OR IGNORE INTO memory_decorations (id, memory_id, kind, label, x, y, width, height, rotation, color, created_at)
      VALUES (@id, @memory_id, @kind, @label, @x, @y, @width, @height, @rotation, @color, @created_at)
    `);

    for (const collection of backup.collections || []) {
      insertCollection.run({ mode: '', parent_id: '', ...collection });
    }

    for (const item of backup.items) {
      insertItem.run({
        collection_id: null,
        thumbnail_data: null,
        image_rotation: 0,
        private: 0,
        ...item,
        file_source_path: null,
        file_stored_name: item.file_stored_name ? path.basename(String(item.file_stored_name)) : null
      });
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

    for (const relationship of backup.item_relationships || []) {
      insertRelationship.run({ note: '', created_at: nowIso(), ...relationship });
    }

    for (const memory of backup.memories || []) {
      insertMemory.run({ description: '', theme: 'cozy', cover_item_id: null, player_x: 40, player_y: 40, updated_at: memory.created_at || nowIso(), ...memory });
    }

    for (const memoryItem of backup.memory_items || []) {
      insertMemoryItem.run({ x: 40, y: 40, width: 260, height: 190, sort_order: 0, created_at: nowIso(), ...memoryItem });
    }

    for (const decoration of backup.memory_decorations || []) {
      insertMemoryDecoration.run({ label: '', x: 80, y: 80, width: 180, height: 24, rotation: 0, color: '', created_at: nowIso(), ...decoration });
    }
  });

  trx();

  const fileEntries = zipEntries.filter((entry: any) =>
    (entry.path || entry.entryName || '').startsWith('files/') && entry.type !== 'Directory'
  );

  let copiedFiles = 0;
  for (const entry of fileEntries) {
    const entryName = entry.path || entry.entryName;
    const fileName = path.basename(entryName);
    copiedFiles += 1;
    sendProgress({
      phase: 'Restoring files from backup',
      current: copiedFiles,
      total: fileEntries.length,
      fileName
    });
    await streamZipEntryToFile(entry, path.join(filesDir, fileName));
  }

  const externalManifestEntry = zipEntries.find((entry: any) => entry.path === 'backup-external-files.json' || entry.entryName === 'backup-external-files.json');
  if (externalManifestEntry) {
    const sidecarDir = backupSidecarDir(backupPath);
    const externalManifest = JSON.parse(await readZipEntryText(externalManifestEntry));
    let externalCopied = 0;
    for (const externalFile of externalManifest.files || []) {
      const relativePath = String(externalFile.relative_path || '').replace(/^[/\\]+/, '');
      const sourcePath = path.resolve(sidecarDir, relativePath);
      const destName = path.basename(externalFile.stored_name || relativePath);
      externalCopied += 1;
      sendProgress({
        phase: 'Restoring large files',
        current: externalCopied,
        total: externalManifest.files?.length || 0,
        fileName: externalFile.file_name || destName
      });
      if (!destName || !isPathInside(sidecarDir, sourcePath) || !fs.existsSync(sourcePath)) {
        writeLog(`Backup restore missing external large file: ${externalFile.file_name || relativePath}`);
        continue;
      }
      await fs.promises.copyFile(sourcePath, path.join(filesDir, destName));
    }
  }

  sendProgress({ phase: 'Finalizing backup restore', current: 1, total: 1 });
  cleanupUnusedTags();

  sendProgress({ phase: 'Backup restore complete', current: 1, total: 1 });
  if (tempDecryptedPath) {
    try { fs.rmSync(tempDecryptedPath, { force: true }); } catch {}
  }
  return { canceled: false, imported: true };
});
