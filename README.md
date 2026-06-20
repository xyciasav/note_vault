# Vault Notes

Vault Notes is a local-first Windows desktop app for keeping notes and files together in a searchable personal vault. It is especially handy for music notes, lesson material, PDFs, tabs, lyrics, and practice resources, but it works for any collection of notes and attachments.

Everything stays on the computer running the app: notes, uploaded files, tags, and backups are stored locally. There is no account, cloud service, or sync requirement.

## Features

- Create, edit, save, favorite, and delete plain-text notes.
- Upload files with the file picker or drag them directly into the app.
- Add reusable tags to notes and files.
- Browse all items or filter the library by notes and files.
- Quickly filter the current library by title, content, filename, tags, and extracted text.
- Use the dedicated search view to combine text, item-type, and multi-tag filters.
- Open an uploaded file in its default desktop application.
- Search the contents of uploaded `.txt`, `.md`, `.csv`, `.json`, and `.log` files (up to 2 MB per file).
- Export the entire vault to a portable `.vaultbackup` archive, including files and metadata.
- Import a backup to restore a vault on the same or another Windows machine.

## Built with

- Electron
- React and Vite
- TypeScript
- SQLite via `better-sqlite3`
- `electron-builder` for the Windows installer

## Requirements

- Windows
- Node.js LTS
- Git
- Visual Studio Build Tools with the **Desktop development with C++** workload

The C++ build tools are required because `better-sqlite3` includes a native dependency. More Windows setup detail is available in [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md).

## Install and run

```powershell
git clone https://github.com/xyciasav/note_vault.git
cd note_vault
npm install
npm run build
npm start
```

## Development

Run the renderer and Electron main-process compiler together:

```powershell
npm run dev
```

Then launch Electron in a second terminal:

```powershell
npm start
```

## Build a Windows installer

```powershell
npm run dist
```

The generated installer is placed in the `release` folder.

## How data is stored

Vault Notes stores its local SQLite database and uploaded files in Electron's `userData` directory. On Windows, this is normally:

```text
C:\Users\YOUR_NAME\AppData\Roaming\Vault Notes
```

The database is named `vault-notes.sqlite`; uploaded files are copied to a `files` subfolder. Deleting an item through the app also deletes its stored uploaded file.

## Backups

Use **Export Backup** in the app to create a `.vaultbackup` ZIP archive. Each archive contains:

- item records and tag relationships as JSON
- metadata for attached files
- copies of every uploaded file

Use **Import Backup** to restore an archive. Import replaces the current local vault, including its existing items and uploaded files, so export a backup before importing if you need to preserve the current state.

## Current limitations

- The app is Windows-focused and only packages a Windows installer.
- File-content search currently supports text-based `.txt`, `.md`, `.csv`, `.json`, and `.log` files; PDF and DOCX text extraction are not included yet.
- Notes use a plain-text editor.
- Backup import replaces the existing vault and does not offer a preview or merge option.

## License

No license has been added to this repository yet.
