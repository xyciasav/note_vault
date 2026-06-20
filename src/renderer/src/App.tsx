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
  Save
} from 'lucide-react';
import './styles/app.css';
import type { VaultItem } from './vaultApi';

type TypeFilter = 'all' | 'note' | 'file';
type AppView = 'library' | 'search';

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

  const [status, setStatus] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newTagText, setNewTagText] = useState('');
  const [showSearchTagDropdown, setShowSearchTagDropdown] = useState(false);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return items.find(i => i.id === selectedId) || null;
  }, [items, selectedId]);

  async function refresh(overrides?: {
    search?: string;
    type?: TypeFilter;
  }) {
    const loadedItems = await window.vaultApi.listItems({
      search: overrides?.search ?? search,
      tag: '',
      type: overrides?.type ?? typeFilter
    });

    setItems(loadedItems);

    const loadedTags = await window.vaultApi.listTags();
    setAllTags(loadedTags.map((tag: any) => tag.name));

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
    }

    if (!selectedId) {
      setDraftTitle('');
      setDraftBody('');
      setDraftTags('');
    }
  }, [selected, selectedId]);

  async function createNote() {
    try {
      setIsCreating(true);
      setStatus('Creating new note...');

      const item = await window.vaultApi.createNote({
        title: 'Untitled note',
        body: '',
        tags: []
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

      await refresh({
        search: '',
        type: 'all'
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
        tags: tagStringToArray(draftTags)
      });

      await refresh();
      setSelectedId(updated.id);

      const time = new Date().toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit'
      });

      setStatus(`Saved at ${time}.`);
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

  async function uploadOne(file: File) {
    const sourcePath = window.vaultApi.getPathForFile(file);

    if (!sourcePath) {
      throw new Error('Could not read file path from Electron.');
    }

    const item = await window.vaultApi.uploadFile({
      sourcePath,
      title: file.name,
      body: '',
      tags: []
    });

    setAppView('library');
    await refresh();
    setSelectedId(item.id);
    setStatus(`Uploaded ${file.name}.`);
  }

  async function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    await uploadOne(file);
    e.target.value = '';
  }

  async function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);

    for (const file of files) {
      await uploadOne(file);
    }
  }

  async function exportBackup() {
    const result = await window.vaultApi.exportBackup();

    if (!result.canceled) {
      setStatus(`Backup exported: ${result.path}`);
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
      className="app-shell"
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
          <Upload size={18} /> Upload File
          <input type="file" onChange={onFileInput} />
        </label>

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
        </div>

        <div className="side-section">
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
        </div>

        <div className="backup-box">
          <button onClick={exportBackup}>
            <Download size={16} /> Export Backup
          </button>

          <button onClick={importBackup}>
            <RotateCcw size={16} /> Import Backup
          </button>
        </div>
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
                  <button onClick={saveSelected} disabled={isSaving}>
                    <Save size={16} /> {isSaving ? 'Saving...' : 'Save'}
                  </button>

                  <button onClick={toggleFavorite} disabled={!selected}>
                    <Star size={16} /> {selected?.favorite ? 'Unstar' : 'Star'}
                  </button>

                  {selected?.type === 'file' && (
                    <button onClick={() => window.vaultApi.openFile(selected.id)}>
                      <FolderOpen size={16} /> Open File
                    </button>
                  )}

                  <button className="danger" onClick={deleteSelected}>
                    <Trash2 size={16} /> Delete
                  </button>
                </div>

                <input
                  className="title-input"
                  value={draftTitle}
                  onChange={e => setDraftTitle(e.target.value)}
                  placeholder="Untitled note"
                />

                <div className="meta-line">
                  <span>{selected?.type === 'file' ? selected.file_name : 'Note'}</span>
                  <span>
                    {selected ? `Updated ${formatDate(selected.updated_at)}` : 'New note'}
                  </span>
                </div>

                <label className="field-label">
                  Tags <span className="muted-label">(add tags one at a time)</span>
                </label>

                <div className="tag-editor">
                  {tagStringToArray(draftTags).map(tag => (
                    <span className="tag-chip-editable" key={tag}>
                      #{tag}
                      <button
                        type="button"
                        title={`Remove ${tag}`}
                        onClick={() => {
                          const nextTags = tagStringToArray(draftTags).filter(t => t !== tag);
                          setDraftTags(nextTags.join(', '));
                        }}
                      >
                        ×
                      </button>
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
              </>
            )}

            {status && <div className="status-bar">{status}</div>}
          </main>
        </>
      ) : (
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
      )}
    </div>
  );
}