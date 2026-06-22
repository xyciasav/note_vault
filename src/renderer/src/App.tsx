import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  FileText,
  FolderOpen,
  Plus,
  Search,
  Star,
  Upload,
  Download,
  RotateCcw,
  Trash2,
  Save,
  Settings
} from 'lucide-react';
import './styles/app.css';
import type { VaultItem } from './vaultApi';

type TypeFilter = 'all' | 'note' | 'file';
type AppView = 'library' | 'search' | 'settings';
type BackupFrequency = 'on-close' | 'daily' | 'weekly' | 'never';

function tagStringToArray(value: string) {
  return value
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
}

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

export default function App() {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [collections, setCollections] = useState<{ id: string; name: string }[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [appView, setAppView] = useState<AppView>('library');

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const [searchText, setSearchText] = useState('');
  const [searchType, setSearchType] = useState<TypeFilter>('all');
  const [searchTags, setSearchTags] = useState<string[]>([]);
  const [searchResults, setSearchResults] = useState<VaultItem[]>([]);

  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftTags, setDraftTags] = useState('');
  const [draftCollectionIds, setDraftCollectionIds] = useState<string[]>([]);

  const [status, setStatus] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newTagText, setNewTagText] = useState('');
  const [showSearchTagDropdown, setShowSearchTagDropdown] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [showNewCollectionInput, setShowNewCollectionInput] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [backupDirectory, setBackupDirectory] = useState('');
  const [backupFrequency, setBackupFrequency] = useState<BackupFrequency>('daily');
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('vault-notes-theme') !== 'light');

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return items.find(i => i.id === selectedId) || null;
  }, [items, selectedId]);

  useEffect(() => {
    localStorage.setItem('vault-notes-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  const activeCollection = useMemo(
    () => collections.find(collection => collection.id === selectedCollectionId) || null,
    [collections, selectedCollectionId]
  );

  async function refresh(overrides?: {
    search?: string;
    type?: TypeFilter;
    collectionId?: string | null;
  }) {
    const loadedItems = await window.vaultApi.listItems({
      search: overrides?.search ?? search,
      tag: '',
      type: overrides?.type ?? typeFilter,
      collectionId: overrides?.collectionId ?? selectedCollectionId ?? ''
    });

    setItems(loadedItems);

    const loadedTags = await window.vaultApi.listTags();
    setAllTags(loadedTags.map((tag: any) => tag.name));

    const loadedCollections = await window.vaultApi.listCollections();
    setCollections(loadedCollections);

    return loadedItems;
  }

  async function runFullSearch() {
  try {
    setStatus('Searching...');

    const results = await window.vaultApi.listItems({
      search: searchText,
      tag: '',
      type: searchType
    });

    const filteredResults =
      searchTags.length === 0
        ? results
        : results.filter(item =>
            searchTags.every(tag =>
              (item.tags || []).some(itemTag => itemTag.toLowerCase() === tag.toLowerCase())
            )
          );

    setSearchResults(filteredResults);
    setStatus(`Found ${filteredResults.length} result${filteredResults.length === 1 ? '' : 's'}.`);
  } catch (err: any) {
    setStatus(`Search failed: ${err.message}`);
  }
}

  function clearFullSearch() {
    setSearchText('');
    setSearchTags([]);
    setSearchType('all');
    setSearchResults([]);
    setStatus('Search cleared.');
  }

  function toggleSearchTag(tag: string) {
  setSearchTags(currentTags => {
    if (currentTags.includes(tag)) {
      return currentTags.filter(existingTag => existingTag !== tag);
    }

    return [...currentTags, tag];
  });
}

  function openSearchResult(item: VaultItem) {
    setSelectedId(item.id);
    setAppView('library');
  }

  useEffect(() => {
    refresh().catch(err => setStatus(err.message));
    window.vaultApi.getBackupSettings()
      .then(settings => {
        setBackupDirectory(settings.backupDirectory);
        setBackupFrequency(settings.backupFrequency);
      })
      .catch(err => setStatus(`Could not load backup settings: ${err.message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      refresh().catch(err => setStatus(err.message));
    }, 150);

    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, typeFilter]);

  useEffect(() => {
    refresh().catch(err => setStatus(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCollectionId]);

  useEffect(() => {
    if (appView !== 'search') return;

    const timeout = window.setTimeout(() => {
      runFullSearch().catch(err => setStatus(err.message));
    }, 200);

    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, [appView, searchText, searchTags, searchType]);

  useEffect(() => {
    if (selected) {
      setDraftTitle(selected.title || '');
      setDraftBody(selected.body || '');
      setDraftTags((selected.tags || []).join(', '));
      setDraftCollectionIds(selected.collection_ids || []);
      setIsEditing(false);
    }

    if (!selectedId) {
      setDraftTitle('');
      setDraftBody('');
      setDraftTags('');
      setDraftCollectionIds([]);
    }
  }, [selected, selectedId]);

  async function createNote() {
    try {
      setIsCreating(true);
      setStatus('Creating new note...');

      const item = await window.vaultApi.createNote({
        title: 'Untitled note',
        body: '',
        tags: [],
        collectionIds: selectedCollectionId ? [selectedCollectionId] : []
      });

      if (!item) {
        throw new Error('No note was returned from the database.');
      }

      setAppView('library');
      setSearch('');
      setTypeFilter('all');

      setSelectedId(item.id);
      setDraftTitle(item.title || 'Untitled note');
      setDraftBody('');
      setDraftTags('');
      setDraftCollectionIds(selectedCollectionId ? [selectedCollectionId] : []);
      setIsEditing(true);

      await refresh({
        search: '',
        type: 'all',
        collectionId: selectedCollectionId
      });

      setSelectedId(item.id);
      setStatus('New note created. Start typing.');
    } catch (err: any) {
      setStatus(`Could not create note: ${err.message}`);
    } finally {
      setIsCreating(false);
    }
  }

  async function saveSelected() {
    if (!selectedId) {
      setStatus('Nothing selected to save.');
      return;
    }

    try {
      setIsSaving(true);
      setStatus('Saving...');

      const updated = await window.vaultApi.updateItem({
        id: selectedId,
        title: draftTitle.trim() || 'Untitled note',
        body: draftBody,
        tags: tagStringToArray(draftTags),
        collectionIds: draftCollectionIds
      });

      await refresh();
      setSelectedId(updated.id);

      const time = new Date().toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit'
      });

      setStatus(`Saved at ${time}.`);
      setIsEditing(false);
    } catch (err: any) {
      setStatus(`Save failed: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleFavorite() {
    if (!selected) return;

    const updated = await window.vaultApi.updateItem({
      id: selected.id,
      favorite: !selected.favorite
    });

    await refresh();
    setSelectedId(updated.id);
  }

  async function deleteSelected() {
    if (!selectedId) return;

    const title = selected?.title || draftTitle || 'this note';
    const ok = confirm(`Delete "${title}"?`);

    if (!ok) return;

    await window.vaultApi.deleteItem(selectedId);
    setSelectedId(null);
    await refresh();
    setStatus('Deleted.');
  }

  async function createCollection() {
    if (!newCollectionName.trim()) return;

    try {
      const collection = await window.vaultApi.createCollection(newCollectionName);
      await refresh();
      setSelectedCollectionId(collection.id);
      setNewCollectionName('');
      setShowNewCollectionInput(false);
      setStatus(`Collection created: ${collection.name}`);
    } catch (err: any) {
      setStatus(`Could not create collection: ${err.message}`);
    }
  }

  async function deleteCollection() {
    if (!activeCollection) return;
    const confirmed = confirm(
      `Delete the collection "${activeCollection.name}"? Its notes and files will remain in your vault.`
    );
    if (!confirmed) return;

    await window.vaultApi.deleteCollection(activeCollection.id);
    setSelectedCollectionId(null);
    await refresh();
    setStatus(`Collection deleted: ${activeCollection.name}`);
  }

  function beginEditing() {
    setIsEditing(true);
  }

  function cancelEditing() {
    if (!selected) return;
    setDraftTitle(selected.title || '');
    setDraftBody(selected.body || '');
    setDraftTags((selected.tags || []).join(', '));
    setDraftCollectionIds(selected.collection_ids || []);
    setIsEditing(false);
  }

  async function uploadOne(file: File, refreshAfter = true) {
    const sourcePath = window.vaultApi.getPathForFile(file);

    if (!sourcePath) {
      throw new Error('Could not read file path from Electron.');
    }

    const item = await window.vaultApi.uploadFile({
      sourcePath,
      title: file.name,
      body: '',
      tags: [],
      collectionIds: selectedCollectionId ? [selectedCollectionId] : []
    });

    if (refreshAfter) {
      setAppView('library');
      await refresh();
      setSelectedId(item.id);
      setIsEditing(true);
      setStatus(`Uploaded ${file.name}.`);
    }
    return item;
  }

  async function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    try {
      let lastItem: VaultItem | undefined;
      for (let index = 0; index < files.length; index += 1) {
        setStatus(`Uploading ${index + 1} of ${files.length}: ${files[index].name}`);
        lastItem = await uploadOne(files[index], false);
      }
      setAppView('library');
      await refresh();
      if (lastItem) setSelectedId(lastItem.id);
      setStatus(`Uploaded ${files.length} file${files.length === 1 ? '' : 's'}.`);
    } catch (err: any) {
      setStatus(`Upload failed: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  }

  async function linkFolder() {
    try {
      setStatus('Choose a folder to link...');
      const result = await window.vaultApi.linkFolder(selectedCollectionId ? [selectedCollectionId] : []);
      if (!result.canceled) {
        await refresh();
        setStatus(`Linked ${result.linked} files from ${result.folderName}.`);
      }
    } catch (err: any) {
      setStatus(`Could not link folder: ${err.message}`);
    }
  }

  async function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);

    try {
      for (const file of files) {
        await uploadOne(file);
      }
    } catch (err: any) {
      setStatus(`Upload failed: ${err.message}`);
    }
  }

  async function exportVault() {
    const result = await window.vaultApi.exportBackup();

    if (!result.canceled) {
      setStatus(`Vault exported: ${result.path}`);
    }
  }

  async function openBackupFolder() {
    const result = await window.vaultApi.openBackupFolder();
    setStatus(`Opened backup folder: ${result.path}`);
  }

  async function chooseBackupFolder() {
    const result = await window.vaultApi.chooseBackupFolder();
    if (!result.canceled && result.path) {
      setBackupDirectory(result.path);
      setStatus(`Backup folder changed: ${result.path}`);
    }
  }

  async function changeBackupFrequency(frequency: BackupFrequency) {
    const result = await window.vaultApi.setBackupFrequency(frequency);
    setBackupFrequency(result.backupFrequency as BackupFrequency);
    setStatus(`Automatic backups: ${frequency === 'never' ? 'off' : frequency}.`);
  }

  async function checkForUpdates() {
    const result = await window.vaultApi.checkForUpdates();
    if (!result.updateAvailable) setStatus('Vault Notes is up to date.');
  }

  async function reindexFiles() {
    setStatus('Indexing file text...');
    try {
      const result = await window.vaultApi.reindexFiles();
      await refresh();
      setStatus(`Indexed ${result.indexed} file${result.indexed === 1 ? '' : 's'} for search.`);
    } catch (err: any) {
      setStatus(`Could not index files: ${err.message}`);
    }
  }

  async function importBackup() {
    const ok = confirm('Importing a backup will replace the current local vault. Continue?');

    if (!ok) return;

    const result = await window.vaultApi.importBackup();

    if (!result.canceled) {
      setSelectedId(null);
      await refresh();
      setStatus('Backup restored.');
    }
  }

  return (
    <div
      className={`app-shell ${isDarkMode ? 'theme-dark' : ''}`}
      onDragOver={e => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
    >
      {isDragging && (
        <div className="drop-overlay">
          Drop files to add them to your vault
        </div>
      )}

      <aside className="sidebar">
        <div className="brand">
          <Archive size={26} />
          <span>Music Notes Vault</span>
        </div>

        <button className="primary" onClick={createNote} disabled={isCreating}>
          <Plus size={18} /> {isCreating ? 'Creating...' : 'New Note'}
        </button>

        <label className="upload-button">
          <Upload size={18} /> Upload Files
          <input type="file" multiple onChange={onFileInput} />
        </label>

        <label className="upload-button">
          <FolderOpen size={18} /> Add Folder
          <input type="file" multiple onChange={onFileInput} {...({ webkitdirectory: '', directory: '' } as any)} />
        </label>

        <button className="secondary-action" onClick={linkFolder}>
          <FolderOpen size={18} /> Link Folder
        </button>

        <div className="side-section">
          <div className="side-label">Workspace</div>

          <button
            className={appView === 'library' ? 'active' : ''}
            onClick={() => setAppView('library')}
          >
            Library
          </button>

          <button
            className={appView === 'search' ? 'active' : ''}
            onClick={() => setAppView('search')}
          >
            <Search size={16} /> Search
          </button>

          <button
            className={appView === 'settings' ? 'active' : ''}
            onClick={() => setAppView('settings')}
          >
            <Settings size={16} /> Settings
          </button>
        </div>

        {appView === 'library' && <div className="side-section">
          <div className="side-label">Library Views</div>

          <button
            className={typeFilter === 'all' ? 'active' : ''}
            onClick={() => {
              setTypeFilter('all');
              setAppView('library');
            }}
          >
            All Items
          </button>

          <button
            className={typeFilter === 'note' ? 'active' : ''}
            onClick={() => {
              setTypeFilter('note');
              setAppView('library');
            }}
          >
            <FileText size={16} /> Notes
          </button>

          <button
            className={typeFilter === 'file' ? 'active' : ''}
            onClick={() => {
              setTypeFilter('file');
              setAppView('library');
            }}
          >
            <FolderOpen size={16} /> Files
          </button>
        </div>}

        {appView === 'library' && <div className="side-section">
          <div className="side-label">Collections</div>

          <button
            className={selectedCollectionId === null ? 'active' : ''}
            onClick={() => setSelectedCollectionId(null)}
          >
            All Collections
          </button>

          {collections.map(collection => (
            <button
              key={collection.id}
              className={selectedCollectionId === collection.id ? 'active' : ''}
              onClick={() => setSelectedCollectionId(collection.id)}
            >
              <FolderOpen size={16} /> {collection.name}
            </button>
          ))}

          {showNewCollectionInput ? (
            <div
              className="new-collection-form"
              onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget) && !newCollectionName.trim()) {
                  setShowNewCollectionInput(false);
                }
              }}
            >
              <input
                value={newCollectionName}
                onChange={event => setNewCollectionName(event.target.value)}
                placeholder="Collection name"
                autoFocus
                onKeyDown={event => {
                  if (event.key === 'Enter') createCollection();
                  if (event.key === 'Escape') setShowNewCollectionInput(false);
                }}
              />
              <button onClick={createCollection}>Add</button>
            </div>
          ) : (
            <button onClick={() => setShowNewCollectionInput(true)}>
              <Plus size={16} /> New Collection
            </button>
          )}

          {activeCollection && (
            <button className="danger" onClick={deleteCollection}>
              <Trash2 size={16} /> Delete Collection
            </button>
          )}
        </div>}

      </aside>

      {appView === 'library' ? (
        <>
          <section className="list-panel">
            <div className="search-box">
              <Search size={18} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Quick filter library..."
              />
            </div>

            <div className="result-count">
              {activeCollection ? `${activeCollection.name}: ` : ''}
              {items.length} item{items.length === 1 ? '' : 's'}
            </div>

            <div className="items-list">
              {items.map(item => (
                <button
                  key={item.id}
                  className={`item-card ${selectedId === item.id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(item.id)}
                >
                  <div className="item-card-top">
                    <span className="item-title">
                      {item.favorite ? '★ ' : ''}
                      {item.title || 'Untitled note'}
                    </span>
                    <span className="item-type">{item.type}</span>
                  </div>

                  <p>{item.body || item.file_name || 'No notes yet.'}</p>

                  <div className="tag-row">
                    {(item.tags || []).slice(0, 4).map(tag => (
                      <span key={tag}>#{tag}</span>
                    ))}
                  </div>

                  <small>{formatDate(item.updated_at)}</small>
                </button>
              ))}
            </div>
          </section>

          <main className="detail-panel">
            {!selectedId ? (
              <div className="empty-state">
                <Archive size={52} />
                <h2>Your vault is ready</h2>
                <p>
                  Create a note, upload a file, or drag music sheets, PDFs, tabs,
                  lyrics, and lesson files into this window.
                </p>
              </div>
            ) : (
              <>
                <div className="detail-toolbar">
                  <button onClick={beginEditing} disabled={isEditing}>
                    {isEditing ? 'Editing' : 'Edit'}
                  </button>

                  {selected?.type === 'file' && (
                    <button onClick={() => window.vaultApi.openFile(selected.id)}>
                      <FolderOpen size={16} /> Open File
                    </button>
                  )}
                </div>

                <input
                  className="title-input"
                  value={draftTitle}
                  onChange={e => setDraftTitle(e.target.value)}
                  placeholder="Untitled note"
                  disabled={!isEditing}
                />

                <div className="meta-line">
                  <span>{selected?.type === 'file' ? selected.file_name : 'Note'}</span>
                  <span>
                    {selected ? `Updated ${formatDate(selected.updated_at)}` : 'New note'}
                  </span>
                </div>

                <label className="field-label">Collection</label>
                <div className="collection-picker">
                  {collections.length === 0 ? (
                    <span className="muted-label">Create a collection from the sidebar to group this item.</span>
                  ) : collections.map(collection => (
                    <label key={collection.id}>
                      <input
                        type="checkbox"
                        checked={draftCollectionIds.includes(collection.id)}
                        disabled={!isEditing}
                        onChange={() => setDraftCollectionIds(current =>
                          current.includes(collection.id)
                            ? current.filter(id => id !== collection.id)
                            : [...current, collection.id]
                        )}
                      />
                      {collection.name}
                    </label>
                  ))}
                </div>
                <div className="muted-label">An item can belong to more than one project.</div>

                <label className="field-label">
                  Tags <span className="muted-label">(add tags one at a time)</span>
                </label>

                <div className="tag-editor">
                  {tagStringToArray(draftTags).map(tag => (
                    <span className="tag-chip-editable" key={tag}>
                      #{tag}
                      {isEditing && <button
                        type="button"
                        title={`Remove ${tag}`}
                        onClick={() => {
                          const nextTags = tagStringToArray(draftTags).filter(t => t !== tag);
                          setDraftTags(nextTags.join(', '));
                        }}
                      >
                        ×
                      </button>}
                    </span>
                  ))}

                  {tagStringToArray(draftTags).length === 0 && (
                    <span className="muted-label">No tags yet.</span>
                  )}
                </div>

                <div className="tag-add-row">
                  <input
                    className="tags-input"
                    value={newTagText}
                    disabled={!isEditing}
                    onChange={e => setNewTagText(e.target.value)}
                    placeholder="Add tag, like theory or scales"
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();

                        const tag = newTagText.trim();
                        if (!tag) return;

                        const nextTags = [...new Set([...tagStringToArray(draftTags), tag])];

                        setDraftTags(nextTags.join(', '));
                        setNewTagText('');
                      }
                    }}
                  />

                  <button
                    type="button"
                    disabled={!isEditing}
                    onClick={() => {
                      const tag = newTagText.trim();
                      if (!tag) return;

                      const nextTags = [...new Set([...tagStringToArray(draftTags), tag])];

                      setDraftTags(nextTags.join(', '));
                      setNewTagText('');
                    }}
                  >
                    Add Tag
                  </button>
                </div>

                <label className="field-label">Notes</label>

                <textarea
                  className="body-editor"
                  value={draftBody}
                  onChange={e => setDraftBody(e.target.value)}
                  disabled={!isEditing}
                  placeholder="Type lesson notes, theory reminders, chord progressions, song ideas, practice notes, links, or anything you want searchable..."
                />

                {selected?.type === 'file' && (
                  <div className="file-info">
                    <strong>File attached:</strong> {selected.file_name}
                    <br />
                    <span>
                      Current starter search reads text from TXT, MD, CSV, JSON, and
                      LOG files. PDF/DOCX extraction can be added next.
                    </span>
                  </div>
                )}

                <div className="detail-toolbar detail-toolbar-bottom">
                  {isEditing && (
                    <>
                      <button onClick={saveSelected} disabled={isSaving}>
                        <Save size={16} /> {isSaving ? 'Saving...' : 'Save'}
                      </button>
                      <button onClick={cancelEditing}>Cancel</button>
                    </>
                  )}

                  <button onClick={toggleFavorite} disabled={!selected}>
                    <Star size={16} /> {selected?.favorite ? 'Unstar' : 'Star'}
                  </button>

                  <button className="danger" onClick={deleteSelected}>
                    <Trash2 size={16} /> Delete
                  </button>
                </div>
              </>
            )}

            {status && <div className="status-bar">{status}</div>}
          </main>
        </>
      ) : appView === 'search' ? (
        <main className="search-panel">
          <div className="search-workspace-header">
            <div>
              <h1>Search Vault</h1>
              <p>
                Search by note text, file name, tags, theory topics, songs, or lesson notes.
              </p>
            </div>

            <button onClick={clearFullSearch}>Clear Search</button>
          </div>

          <div className="full-search-box">
            <Search size={22} />
            <input
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="Search chords, scales, song names, notes, files..."
              autoFocus
            />
          </div>

          <div className="search-filters">
            <label>
              Type
              <select
                value={searchType}
                onChange={e => setSearchType(e.target.value as TypeFilter)}
              >
                <option value="all">All Items</option>
                <option value="note">Notes</option>
                <option value="file">Files</option>
              </select>
            </label>

<div className="search-tag-dropdown-wrap">
  <div className="search-filter-label">Tags</div>

  <button
    type="button"
    className="search-tag-dropdown-button"
    onClick={() => setShowSearchTagDropdown(!showSearchTagDropdown)}
  >
    {searchTags.length === 0
      ? 'All Tags'
      : `${searchTags.length} tag${searchTags.length === 1 ? '' : 's'} selected`}
    <span>▾</span>
  </button>

  {showSearchTagDropdown && (
    <div className="search-tag-dropdown-panel">
      <button
        type="button"
        className="tag-clear-button"
        onClick={() => setSearchTags([])}
      >
        Clear tag selection
      </button>

      {allTags.length === 0 ? (
        <div className="tag-picker-empty">No tags yet.</div>
      ) : (
        allTags.map(tag => (
          <label key={tag} className="search-tag-checkbox-row">
            <input
              type="checkbox"
              checked={searchTags.includes(tag)}
              onChange={() => toggleSearchTag(tag)}
            />
            <span>#{tag}</span>
          </label>
        ))
      )}
    </div>
  )}
</div>

            <button onClick={runFullSearch}>Search</button>
          </div>

          <div className="search-results-header">
            <span>
              {searchResults.length} result{searchResults.length === 1 ? '' : 's'}
            </span>

            {(searchText || searchTags.length > 0 || searchType !== 'all') && (
  <small>
    {searchText && <>Text: “{searchText}” </>}
    {searchTags.length > 0 && (
      <>Tags: {searchTags.map(tag => `#${tag}`).join(', ')} </>
    )}
    {searchType !== 'all' && <>Type: {searchType}</>}
  </small>
)}
          </div>

          <div className="search-results-grid">
            {searchResults.length === 0 ? (
              <div className="empty-state search-empty">
                <Search size={48} />
                <h2>No results yet</h2>
                <p>
                  Try searching a topic, tag, song name, chord, scale, or uploaded file name.
                </p>
              </div>
            ) : (
              searchResults.map(item => (
                <button
                  key={item.id}
                  className="search-result-card"
                  onClick={() => openSearchResult(item)}
                >
                  <div className="item-card-top">
                    <span className="item-title">
                      {item.favorite ? '★ ' : ''}
                      {item.title || 'Untitled note'}
                    </span>
                    <span className="item-type">{item.type}</span>
                  </div>

                  <p>{item.body || item.file_name || 'No notes yet.'}</p>

                  <div className="tag-row">
                    {(item.tags || []).slice(0, 8).map(tag => (
                      <span key={tag}>#{tag}</span>
                    ))}
                  </div>

                  <small>{formatDate(item.updated_at)}</small>
                </button>
              ))
            )}
          </div>

          {status && <div className="status-bar">{status}</div>}
        </main>
      ) : (
        <main className="search-panel settings-panel">
          <div className="search-workspace-header">
            <div>
              <h1>Settings</h1>
              <p>Manage your vault data and its automatic backups.</p>
            </div>
          </div>

          <section className="settings-section">
            <h2>Appearance</h2>
            <p>Use a darker palette that is easier on the eyes during long writing or practice sessions.</p>
            <label className="theme-toggle">
              <input type="checkbox" checked={isDarkMode} onChange={event => setIsDarkMode(event.target.checked)} />
              <span>Dark Mode</span>
            </label>
          </section>

          <section className="settings-section">
            <h2>Backup & Export</h2>
            <p>
              Export creates a normal ZIP with Markdown notes, your original files, and an
              <code> index.html </code> page. You can open it without Vault Notes.
            </p>

            <div className="settings-actions">
              <button onClick={exportVault}>
                <Download size={16} /> Export Vault
              </button>
              <button onClick={importBackup}>
                <RotateCcw size={16} /> Import Backup
              </button>
              <button onClick={openBackupFolder}>
                <FolderOpen size={16} /> Open Backup Folder
              </button>
            </div>

            <p className="settings-note">
              Importing a backup replaces the current local vault.
            </p>

            <div className="settings-control">
              <label htmlFor="backup-frequency">Automatic backups</label>
              <select
                id="backup-frequency"
                value={backupFrequency}
                onChange={event => changeBackupFrequency(event.target.value as BackupFrequency)}
              >
                <option value="on-close">Every time the app closes</option>
                <option value="daily">Once per day</option>
                <option value="weekly">Once per week</option>
                <option value="never">Off</option>
              </select>
            </div>

            <div className="settings-control">
              <span>Backup folder</span>
              <code className="backup-path">{backupDirectory || 'Loading…'}</code>
              <button onClick={chooseBackupFolder}>Choose Backup Folder</button>
            </div>
          </section>

          <section className="settings-section">
            <h2>Updates</h2>
            <p>
              Vault Notes checks GitHub Releases when it opens. When a newer version is available,
              you can open its download page, skip that version, or decide later.
            </p>
            <div className="settings-actions">
              <button onClick={checkForUpdates}>Check for Updates</button>
            </div>
          </section>

          <section className="settings-section">
            <h2>Searchable files</h2>
            <p>
              Vault Notes indexes TXT, Markdown, CSV, JSON, LOG, and text-based PDF files so
              their contents can appear in search. Re-index after adding this feature to an existing vault.
            </p>
            <div className="settings-actions">
              <button onClick={reindexFiles}>Re-index Files</button>
            </div>
          </section>

          {status && <div className="status-bar">{status}</div>}
        </main>
      )}
    </div>
  );
}
