# Vault Notes

A local-first Windows desktop app for notes, uploaded files, tags, search, and backup export/import.

## Setup

```bash
npm install
npm run build
npm start
```

For development, run these in separate terminals:

```bash
npm run dev:renderer
npm run dev:main
npm start
```

## Build Windows installer

```bash
npm run dist
```

The installer will be created in the `release` folder.

## Data location

Vault Notes stores its database and uploaded files inside Electron's `userData` folder.
On Windows this is usually:

```text
C:\Users\YOUR_NAME\AppData\Roaming\Vault Notes
```

## Backup

Use the Export Backup button to create a `.vaultbackup` zip file containing:

- database records as JSON
- uploaded files

Use Import Backup to restore that backup. Current starter behavior replaces the current local database with the imported backup.
