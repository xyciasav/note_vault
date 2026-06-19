# Windows setup notes

## Requirements

Install these first:

1. Node.js LTS
2. Git
3. Visual Studio Build Tools with the Desktop development with C++ workload

The C++ build tools are needed because SQLite uses a native dependency.

## First run

Open PowerShell in the project folder:

```powershell
npm install
npm run build
npm start
```

## Make the Windows installer

```powershell
npm run dist
```

Look in the `release` folder for the installer.

## Backups

Inside the app:

- Export Backup creates a `.vaultbackup` file.
- Import Backup restores that file.
- Import currently replaces the current vault, so export before testing imports.

## What works in this starter

- Create notes
- Edit notes
- Upload files
- Drag/drop files
- Tag notes and files
- Search title/body/filename/tags/basic extracted text
- Filter by note/file/tag
- Open uploaded files
- Export/import backup including attached files

## What to add next

- PDF text extraction
- DOCX text extraction
- Rich text editor
- Better full-text search with SQLite FTS5
- Safer backup restore flow with preview
- Auto tags
