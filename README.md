# Note Vault

Note Vault is a local-first desktop app for keeping notes, documents, images, PDFs, screenshots, receipts, reference files, and project resources in one searchable vault.

It is built for a personal knowledge library where notes and files live together with tags, collections, search, previews, and backups.

Everything is stored on the computer running the app. There is no account, cloud service, subscription, or sync requirement.

## What it can do

### Notes and files

- Create, edit, save, favorite, and delete notes.
- Upload one file, many files at once, or an entire folder of files.
- Drag files into the app to add them to the vault.
- Store uploaded files locally inside the app data folder.
- Open uploaded files in their normal desktop application.
- Mark an item as **Private** so preview text is hidden in the library and search lists.
- View image thumbnails for image files in the library, search results, and dashboard.
- Open uploaded file items in edit mode right after import so title, tags, and collections can be cleaned up immediately.

### Organization

- Add reusable tags to notes and files.
- Manage saved tags from Settings: add, rename, delete, and see how many items use each tag.
- Click a tag's assigned count to jump into Search filtered to that tag.
- Use the dashboard Tags card as a shortcut straight into the Settings tag manager.
- Group notes and files into collections or projects.
- Put the same item in more than one collection when it belongs to multiple projects.
- Edit tags and collections on individual items.
- Select multiple items with Windows-style modifier clicks.
- Bulk delete selected items.
- Bulk edit tags across selected items.
- Bulk edit collections across selected items.
- Sort the library by update date, title, or tags.

### Search

- Search across note titles, note bodies, file names, tags, and extracted file text.
- Filter search results by item type: all items, notes, or files.
- Search only tags when you do not want file contents included.
- Filter search results by collection.
- Select multiple tags in the search filter.
- See highlighted search snippets so matches are easier to understand.
- Preview a search result without leaving the Search page.
- Open a search result in the main library when you want to edit it.

### File indexing and previews

Note Vault extracts searchable text from supported files when they are imported.

Supported searchable file types:

- `.txt`
- `.md`
- `.csv`
- `.json`
- `.log`
- `.pdf`
- `.docx`

Image files receive thumbnails for easier browsing. Text-based PDFs are searchable. Scanned image-only PDFs still need OCR before their contents can be searched.

### Import review wizard

When importing multiple files or a folder, Note Vault opens a review step before adding everything.

The import wizard can:

- Show all files before import.
- Skip individual files.
- Import selected files only.
- Suggest tags from file names and folder names.
- Suggest a collection from the top-level folder.
- Show text previews for supported documents.
- Show image thumbnails for image files.
- Warn about possible duplicate names.
- Detect exact duplicate files by file content.
- Filter the review list by ready files, duplicates, name conflicts, images, or PDFs.
- Apply tags or collections to selected import files in bulk.
- Show progress while large imports are being prepared and imported.

### Dashboard

The dashboard loads first and gives a quick overview of the vault.

It shows:

- Total items
- Notes
- Files
- Collections
- Tags
- Favorites
- Recently updated items

Dashboard cards act as shortcuts into the right part of the app. For example, Notes opens the notes view, Files opens the files view, and Tags opens the tag manager in Settings.

### Settings

Settings is split into focused tabs:

- **General** for appearance, backups, updates, and maintenance.
- **Tags** for saved tag management and tag usage counts.
- **Logs** for recent startup and error information.

Settings includes:

- Dark mode toggle.
- Backup/export controls.
- Backup folder selection.
- Automatic backup schedule.
- Manual update check.
- Search index rebuild.
- App logs viewer.
- Open logs folder.
- Saved tag manager.

### Backups and export

Note Vault has two different safety paths:

1. **Readable export**

   **Export Vault** creates a normal ZIP file with:

   ```text
   Note Vault Export/
     Notes/
       Example Note.md
     Files/
       uploaded-file.pdf
     index.html
   ```

   This is meant for humans. Even if the app is not available later, notes can be opened in Notepad, VS Code, Word, or a browser, and uploaded files are included as normal files.

2. **Restore backups**

   Automatic `.vaultbackup` files are created for restoring the vault back into Note Vault.

   If a backup includes very large files, Note Vault keeps the `.vaultbackup` restore file and creates a matching `-large-files` sidecar folder beside it. Keep that sidecar folder with the backup file so restore can bring the large files back too.

   Automatic backups can run:

   - Every time the app closes
   - Once per day
   - Once per week
   - Never

   You can choose the backup folder and open it directly from Settings.

Use **Import Backup** to restore a `.vaultbackup` or compatible backup ZIP. Importing a backup replaces the current local vault, so export first if you need to keep the current data.

### Updates

Note Vault checks the project's GitHub Releases when the app launches. If a newer version is available, the app can prompt the user to:

- Download or open the new release.
- Skip that version.
- Decide later.

After an update, Note Vault can show a "What's New" prompt for the installed version.

### Appearance and usability

- Dark mode is supported and is the default.
- Dark-mode titles, search result cards, and the app brand are tuned for readable contrast.
- The app shows its version near the title.
- Window panes can be resized.
- Column sizing is remembered.
- Custom scrollbars match the app styling.
- Keyboard arrow navigation works through the item list.
- The app keeps the selected item visible while navigating.

## How data is stored

Note Vault stores its local SQLite database, uploaded files, settings, logs, thumbnails, and backups on the local machine.

The main app data folder is normally:

```text
C:\Users\YOUR_NAME\AppData\Roaming\Note Vault
```

Important local data:

- `vault-notes.sqlite` stores item metadata, notes, tags, collections, and extracted text.
- `files/` stores copied uploads.
- `backups/` stores automatic `.vaultbackup` files unless you choose another backup folder.
- `logs/` stores app log files.

Deleting an uploaded file item through the app also deletes the stored copy from the app's local files folder.

## Install and run from source

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

## Build installers

```powershell
npm run dist
```

The generated installer is placed in the `release` folder. Windows installers are built locally; macOS builds are produced by the GitHub Actions macOS workflow.

## Built with

- Electron
- React
- Vite
- TypeScript
- SQLite via `better-sqlite3`
- `pdf-parse` for PDF text extraction
- `adm-zip` for backups, exports, and DOCX text extraction
- `electron-builder` for installers

## Requirements

- Windows or macOS
- Node.js LTS
- Git
- Visual Studio Build Tools with the **Desktop development with C++** workload

The C++ build tools are required because `better-sqlite3` includes a native dependency. More Windows setup detail is available in [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md).

## Current limitations

- There is no built-in cloud sync or multi-computer live sharing.
- Scanned image-only PDFs are not OCR-indexed yet.
- Notes use a plain-text editor.
- Backup import replaces the existing vault and does not currently offer a merge preview.

## License

No license has been added to this repository yet.
