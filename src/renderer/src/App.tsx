import React, { useEffect, useMemo, useRef, useState } from 'react';
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
type CollectionTreeEntry = { id: string; name: string; created_at: string; items: VaultItem[] };

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
  const [collectionTree, setCollectionTree] = useState<CollectionTreeEntry[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [appView, setAppView] = useState<AppView>('library');

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const [searchText, setSearchText] = useState('');
  const [searchType, setSearchType] = useState<TypeFilter>('all');
  const [searchTags, setSearchTags] = useState<string[]>([]);
  const [searchTagsOnly, setSearchTagsOnly] = useState(false);
  const [searchResults, setSearchResults] = useState<VaultItem[]>([]);
  const [showSearchTypeDropdown, setShowSearchTypeDropdown] = useState(false);
  const [showSearchScopeDropdown, setShowSearchScopeDropdown] = useState(false);
  const [searchCollectionId, setSearchCollectionId] = useState('');
  const [showSearchCollectionDropdown, setShowSearchCollectionDropdown] = useState(false);
  const [searchPreviewItem, setSearchPreviewItem] = useState<VaultItem | null>(null);

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
  const autoEditIdRef = useRef<string | null>(null);
  const [isSelectingItems, setIsSelectingItems] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [showBulkTagPicker, setShowBulkTagPicker] = useState(false);
  const [showBulkCollectionPicker, setShowBulkCollectionPicker] = useState(false);
  const [bulkTags, setBulkTags] = useState<Set<string>>(new Set());
  const [expandedCollectionIds, setExpandedCollectionIds] = useState<Set<string>>(new Set());
  const [backupDirectory, setBackupDirectory] = useState('');
  const [backupFrequency, setBackupFrequency] = useState<BackupFrequency>('daily');
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('vault-notes-theme') !== 'light');
  const [appVersion, setAppVersion] = useState('');
  const itemsListRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return items.find(i => i.id === selectedId) || null;
  }, [items, selectedId]);

  useEffect(() => {
    localStorage.setItem('vault-notes-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    window.vaultApi.getAppVersion().then(setAppVersion).catch(() => undefined);
  }, []);

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

    const loadedCollectionTree = await window.vaultApi.getCollectionTree();
    setCollectionTree(loadedCollectionTree);

    return loadedItems;
  }

  async function runFullSearch() {
  try {
    setStatus('Searching...');

    const results = await window.vaultApi.listItems({
      search: searchTagsOnly ? '' : searchText,
      tag: '',
      type: searchType,
      collectionId: searchCollectionId
    });

    const tagQuery = searchText.trim().toLowerCase();
    const filteredResults = results.filter(item => {
      const matchesTypedTag = !searchTagsOnly || !tagQuery ||
        (item.tags || []).some(tag => tag.toLowerCase().includes(tagQuery));
      const matchesSelectedTags = searchTags.length === 0 || searchTags.every(tag =>
        (item.tags || []).some(itemTag => itemTag.toLowerCase() === tag.toLowerCase())
      );
      return matchesTypedTag && matchesSelectedTags;
    });

    setSearchResults(filteredResults);
    setStatus(`Found ${filteredResults.length} result${filteredResults.length === 1 ? '' : 's'}.`);
  } catch (err: any) {
    setStatus(`Search failed: ${err.message}`);
  }
}

  function clearFullSearch() {
    setSearchText('');
    setSearchTags([]);
    setSearchTagsOnly(false);
    setSearchCollectionId('');
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
    setSearchPreviewItem(item);
  }

  function openSearchItemInLibrary(item: VaultItem) {
    setSelectedCollectionId(null);
    setSearch('');
    setTypeFilter('all');
    setItems(current => [item, ...current.filter(existing => existing.id !== item.id)]);
    setSelectedId(item.id);
    setSearchPreviewItem(null);
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
}, [appView, searchText, searchTags, searchType, searchTagsOnly, searchCollectionId]);

  useEffect(() => {
    if (selected) {
      setDraftTitle(selected.title || '');
      setDraftBody(selected.body || '');
      setDraftTags((selected.tags || []).join(', '));
      setDraftCollectionIds(selected.collection_ids || []);
      const shouldEdit = selected.id === autoEditIdRef.current;
      setIsEditing(shouldEdit);
      if (shouldEdit) autoEditIdRef.current = null;
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

      autoEditIdRef.current = item.id;
      setSelectedId(item.id);
      setDraftTitle(item.title || 'Untitled note');
      setDraftBody('');
      setDraftTags('');
      setDraftCollectionIds(selectedCollectionId ? [selectedCollectionId] : []);

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

      const scrollTop = itemsListRef.current?.scrollTop;
      setItems(current => current.map(item => item.id === updated.id ? updated : item));
      window.vaultApi.listTags()
        .then(tags => setAllTags(tags.map((tag: any) => tag.name)))
        .catch(() => undefined);
      setSelectedId(updated.id);
      if (scrollTop !== undefined) {
        requestAnimationFrame(() => {
          if (itemsListRef.current) itemsListRef.current.scrollTop = scrollTop;
        });
      }

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

    setItems(current => current.map(item => item.id === updated.id ? updated : item));
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

  function selectCollection(collectionId: string | null) {
    setSelectedCollectionId(collectionId);
    setSelectedId(null);
    setIsEditing(false);
  }

  function toggleCollectionTree(collectionId: string) {
    setExpandedCollectionIds(current => {
      const next = new Set(current);
      if (next.has(collectionId)) next.delete(collectionId);
      else next.add(collectionId);
      return next;
    });
  }

  function openCollectionTreeItem(collectionId: string, item: VaultItem) {
    setSelectedCollectionId(collectionId);
    setItems(current => [item, ...current.filter(existing => existing.id !== item.id)]);
    setSelectedId(item.id);
    setIsEditing(false);
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
      autoEditIdRef.current = item.id;
      setSelectedId(item.id);
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

  function toggleItemSelection(id: string) {
    setSelectedItemIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    function navigateItems(event: KeyboardEvent) {
      if (appView !== 'library' || isSelectingItems) return;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (items.length === 0) return;

      event.preventDefault();
      const currentIndex = items.findIndex(item => item.id === selectedId);
      const delta = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1;
      const nextIndex = currentIndex === -1
        ? (delta > 0 ? 0 : items.length - 1)
        : Math.max(0, Math.min(items.length - 1, currentIndex + delta));

      setSelectedId(items[nextIndex].id);
    }

    window.addEventListener('keydown', navigateItems);
    return () => window.removeEventListener('keydown', navigateItems);
  }, [appView, isSelectingItems, items, selectedId]);

  async function deleteSelectedItems() {
    const ids = [...selectedItemIds];
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} selected item${ids.length === 1 ? '' : 's'}?`)) return;
    const result = await window.vaultApi.deleteItems(ids);
    setSelectedItemIds(new Set());
    setSelectedId(null);
    await refresh();
    setStatus(`Deleted ${result.deleted} items.`);
  }

  function toggleBulkTag(tag: string) {
    setBulkTags(current => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  async function addTagsToSelectedItems() {
    const ids = [...selectedItemIds];
    if (ids.length === 0) return;
    const tags = [...bulkTags];
    if (tags.length === 0) return;
    const result = await window.vaultApi.addTagsToItems(ids, tags);
    await refresh();
    setBulkTags(new Set());
    setShowBulkTagPicker(false);
    setStatus(`Added tags to ${result.updated} items.`);
  }

  async function addCollectionToSelectedItems(collectionId: string) {
    const ids = [...selectedItemIds];
    if (ids.length === 0 || !collectionId) return;

    const result = await window.vaultApi.addCollectionToItems(ids, collectionId);
    await refresh();
    const collection = collections.find(entry => entry.id === collectionId);
    setShowBulkCollectionPicker(false);
    setStatus(`Added ${result.updated} items to ${collection?.name || 'the collection'}.`);
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
          <span>Music Notes Vault {appVersion && <small>v{appVersion}</small>}</span>
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
            onClick={() => selectCollection(null)}
          >
            All Collections
          </button>

          <div className="collection-tree">
            {collectionTree.map(collection => {
              const isExpanded = expandedCollectionIds.has(collection.id);
              return <div className="collection-tree-node" key={collection.id}>
                <div className="collection-tree-row">
                  <button
                    type="button"
                    className="collection-tree-toggle"
                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${collection.name}`}
                    onClick={() => toggleCollectionTree(collection.id)}
                  >
                    {isExpanded ? '▾' : '▸'}
                  </button>
                  <button
                    className={`collection-tree-collection ${selectedCollectionId === collection.id ? 'active' : ''}`}
                    onClick={() => selectCollection(collection.id)}
                  >
                    <FolderOpen size={16} />
                    <span>{collection.name}</span>
                    <small>{collection.items.length}</small>
                  </button>
                </div>

                {isExpanded && (
                  <div className="collection-tree-items">
                    {collection.items.length === 0 ? (
                      <span className="collection-tree-empty">Empty collection</span>
                    ) : collection.items.map(item => (
                      <button
                        type="button"
                        key={item.id}
                        className={selectedId === item.id ? 'active' : ''}
                        onClick={() => openCollectionTreeItem(collection.id, item)}
                      >
                        {item.type === 'note' ? <FileText size={14} /> : <FolderOpen size={14} />}
                        <span>{item.title || 'Untitled note'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>;
            })}
          </div>

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

            <div className="bulk-toolbar">
              <button onClick={() => {
                setIsSelectingItems(current => !current);
                setSelectedItemIds(new Set());
                setBulkTags(new Set());
                setShowBulkTagPicker(false);
                setShowBulkCollectionPicker(false);
              }}>
                {isSelectingItems ? 'Cancel Select' : 'Select Items'}
              </button>
              {isSelectingItems && <>
                <span>{selectedItemIds.size} selected</span>
                <button
                  onClick={() => {
                    setShowBulkTagPicker(current => !current);
                    setShowBulkCollectionPicker(false);
                  }}
                  disabled={selectedItemIds.size === 0 || allTags.length === 0}
                >
                  Add Tags
                </button>
                <button
                  onClick={() => {
                    setShowBulkCollectionPicker(current => !current);
                    setShowBulkTagPicker(false);
                  }}
                  disabled={selectedItemIds.size === 0 || collections.length === 0}
                >
                  Add to Collection
                </button>
                <button className="danger" onClick={deleteSelectedItems} disabled={selectedItemIds.size === 0}>Delete</button>
              </>}
            </div>

            {isSelectingItems && showBulkTagPicker && (
              <div className="bulk-action-panel">
                <strong>Choose tags to add</strong>
                <div className="bulk-choice-list">
                  {allTags.map(tag => <label key={tag}>
                    <input type="checkbox" checked={bulkTags.has(tag)} onChange={() => toggleBulkTag(tag)} />
                    <span>#{tag}</span>
                  </label>)}
                </div>
                <div className="bulk-action-footer">
                  <button onClick={() => setShowBulkTagPicker(false)}>Cancel</button>
                  <button className="primary-action" onClick={addTagsToSelectedItems} disabled={bulkTags.size === 0}>
                    Add {bulkTags.size || ''} Tag{bulkTags.size === 1 ? '' : 's'}
                  </button>
                </div>
              </div>
            )}

            {isSelectingItems && showBulkCollectionPicker && (
              <div className="bulk-action-panel">
                <strong>Add selected items to a collection</strong>
                <div className="bulk-choice-list collection-choice-list">
                  {collections.map(collection => <button key={collection.id} onClick={() => addCollectionToSelectedItems(collection.id)}>
                    {collection.name}
                  </button>)}
                </div>
              </div>
            )}

            <div className="items-list" ref={itemsListRef}>
              {items.map(item => (
                <div
                  key={item.id}
                  className={`item-card ${selectedId === item.id ? 'selected' : ''} ${selectedItemIds.has(item.id) ? 'bulk-selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  onMouseDown={event => {
                    if (event.ctrlKey || event.metaKey || event.shiftKey) event.preventDefault();
                  }}
                  onClick={event => {
                    if (event.ctrlKey || event.metaKey || event.shiftKey) {
                      setIsSelectingItems(true);
                      toggleItemSelection(item.id);
                    } else if (isSelectingItems) {
                      toggleItemSelection(item.id);
                    } else {
                      setSelectedId(item.id);
                    }
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      if (isSelectingItems) toggleItemSelection(item.id);
                      else setSelectedId(item.id);
                    }
                  }}
                >
                  <div className="item-card-top">
                    <span className="item-title">
                      {item.favorite ? '★ ' : ''}
                      {item.title || 'Untitled note'}
                    </span>
                    {isSelectingItems && <span className="item-selector">{selectedItemIds.has(item.id) ? '✓' : ''}</span>}
                    <span className="item-type">{item.type}</span>
                  </div>

                  <p>{item.body || item.file_name || 'No notes yet.'}</p>

                  <div className="tag-row">
                    {(item.tags || []).slice(0, 4).map(tag => (
                      <span key={tag}>#{tag}</span>
                    ))}
                  </div>

                  <small>{formatDate(item.updated_at)}</small>
                </div>
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

                  {isEditing && <>
                    <button onClick={saveSelected} disabled={isSaving}>
                      <Save size={16} /> {isSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={cancelEditing}>Cancel</button>
                  </>}

                  <button className="danger" onClick={deleteSelected}>
                    <Trash2 size={16} /> Delete
                  </button>

                  <button onClick={toggleFavorite} disabled={!selected}>
                    <Star size={16} /> {selected?.favorite ? 'Unstar' : 'Star'}
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

                {allTags.length > 0 && (
                  <div className="saved-tags-picker">
                    <span className="muted-label">Saved tags</span>
                    {allTags.map(tag => {
                      const selectedTag = tagStringToArray(draftTags).includes(tag);
                      return <button
                        key={tag}
                        type="button"
                        disabled={!isEditing}
                        className={selectedTag ? 'active' : ''}
                        onClick={() => setDraftTags(current => {
                          const tags = tagStringToArray(current);
                          return (selectedTag ? tags.filter(existing => existing !== tag) : [...tags, tag]).join(', ');
                        })}
                      >
                        #{tag}
                      </button>;
                    })}
                  </div>
                )}

                <label className="field-label">Notes</label>

                <textarea
                  className="body-editor"
                  value={selected?.type === 'file' ? (selected.extracted_text || 'No readable text was found in this file.') : draftBody}
                  onChange={e => {
                    if (selected?.type !== 'file') setDraftBody(e.target.value);
                  }}
                  disabled={!isEditing || selected?.type === 'file'}
                  placeholder="Type lesson notes, theory reminders, chord progressions, song ideas, practice notes, links, or anything you want searchable..."
                />

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
            <div className="search-tag-dropdown-wrap">
              <div className="search-filter-label">Type</div>
              <button
                type="button"
                className="search-tag-dropdown-button"
                onClick={() => {
                  setShowSearchTypeDropdown(current => !current);
                  setShowSearchScopeDropdown(false);
                  setShowSearchTagDropdown(false);
                  setShowSearchCollectionDropdown(false);
                }}
              >
                {searchType === 'all' ? 'All Items' : searchType === 'note' ? 'Notes' : 'Files'}
                <span>▾</span>
              </button>
              {showSearchTypeDropdown && (
                <div className="search-tag-dropdown-panel search-option-panel">
                  {([['all', 'All Items'], ['note', 'Notes'], ['file', 'Files']] as const).map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      className={searchType === value ? 'active' : ''}
                      onClick={() => {
                        setSearchType(value);
                        setShowSearchTypeDropdown(false);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="search-tag-dropdown-wrap">
              <div className="search-filter-label">Search in</div>
              <button
                type="button"
                className="search-tag-dropdown-button"
                onClick={() => {
                  setShowSearchScopeDropdown(current => !current);
                  setShowSearchTypeDropdown(false);
                  setShowSearchTagDropdown(false);
                  setShowSearchCollectionDropdown(false);
                }}
              >
                {searchTagsOnly ? 'Tags Only' : 'Everything'}
                <span>▾</span>
              </button>
              {showSearchScopeDropdown && (
                <div className="search-tag-dropdown-panel search-option-panel">
                  <button
                    type="button"
                    className={!searchTagsOnly ? 'active' : ''}
                    onClick={() => {
                      setSearchTagsOnly(false);
                      setShowSearchScopeDropdown(false);
                    }}
                  >
                    Everything
                  </button>
                  <button
                    type="button"
                    className={searchTagsOnly ? 'active' : ''}
                    onClick={() => {
                      setSearchTagsOnly(true);
                      setShowSearchScopeDropdown(false);
                    }}
                  >
                    Tags Only
                  </button>
                </div>
              )}
            </div>

            <div className="search-tag-dropdown-wrap">
              <div className="search-filter-label">Collection</div>
              <button
                type="button"
                className="search-tag-dropdown-button"
                onClick={() => {
                  setShowSearchCollectionDropdown(current => !current);
                  setShowSearchTypeDropdown(false);
                  setShowSearchScopeDropdown(false);
                  setShowSearchTagDropdown(false);
                }}
              >
                {searchCollectionId
                  ? collections.find(collection => collection.id === searchCollectionId)?.name || 'All Collections'
                  : 'All Collections'}
                <span>▾</span>
              </button>
              {showSearchCollectionDropdown && (
                <div className="search-tag-dropdown-panel search-option-panel">
                  <button
                    type="button"
                    className={!searchCollectionId ? 'active' : ''}
                    onClick={() => {
                      setSearchCollectionId('');
                      setShowSearchCollectionDropdown(false);
                    }}
                  >
                    All Collections
                  </button>
                  {collections.map(collection => (
                    <button
                      type="button"
                      key={collection.id}
                      className={searchCollectionId === collection.id ? 'active' : ''}
                      onClick={() => {
                        setSearchCollectionId(collection.id);
                        setShowSearchCollectionDropdown(false);
                      }}
                    >
                      {collection.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

<div className="search-tag-dropdown-wrap">
  <div className="search-filter-label">Tags</div>

  <button
    type="button"
    className="search-tag-dropdown-button"
    onClick={() => {
      setShowSearchTagDropdown(current => !current);
      setShowSearchTypeDropdown(false);
      setShowSearchScopeDropdown(false);
      setShowSearchCollectionDropdown(false);
    }}
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

          {searchPreviewItem && (
            <div className="search-preview-backdrop" onMouseDown={() => setSearchPreviewItem(null)}>
              <section
                className="search-preview-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={`Preview ${searchPreviewItem.title || 'item'}`}
                onMouseDown={event => event.stopPropagation()}
              >
                <div className="search-preview-header">
                  <div>
                    <span className="item-type">{searchPreviewItem.type}</span>
                    <h2>{searchPreviewItem.title || 'Untitled note'}</h2>
                    <small>Updated {formatDate(searchPreviewItem.updated_at)}</small>
                  </div>
                  <button onClick={() => setSearchPreviewItem(null)}>Close</button>
                </div>
                <div className="tag-row">
                  {(searchPreviewItem.tags || []).map(tag => <span key={tag}>#{tag}</span>)}
                </div>
                <pre className="search-preview-content">
                  {searchPreviewItem.type === 'file'
                    ? searchPreviewItem.extracted_text || 'No readable text was found in this file.'
                    : searchPreviewItem.body || 'No notes yet.'}
                </pre>
                <div className="search-preview-actions">
                  <button
                    className="primary-action"
                    onClick={() => openSearchItemInLibrary(searchPreviewItem)}
                  >
                    Open in Library
                  </button>
                </div>
              </section>
            </div>
          )}

          {status && <div className="status-bar">{status}</div>}
        </main>
      ) : (
        <main className="search-panel settings-panel">
          <div className="search-workspace-header">
            <div>
              <h1>Settings</h1>
              <p>Backup, maintenance, appearance, and updates—kept in one tidy place.</p>
            </div>
          </div>

          <div className="settings-grid">
          <section className="settings-section settings-compact">
            <h2>Appearance</h2>
            <p>Use a darker palette that is easier on the eyes during long writing or practice sessions.</p>
            <label className="theme-toggle">
              <input type="checkbox" checked={isDarkMode} onChange={event => setIsDarkMode(event.target.checked)} />
              <span>Dark Mode</span>
            </label>
          </section>

          <section className="settings-section settings-backup">
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

          <section className="settings-section settings-compact">
            <h2>Updates</h2>
            <p>
              Vault Notes checks GitHub Releases when it opens. When a newer version is available,
              you can open its download page, skip that version, or decide later.
            </p>
            <div className="settings-actions">
              <button onClick={checkForUpdates}>Check for Updates</button>
            </div>
          </section>

          <section className="settings-section settings-compact settings-maintenance">
            <h2>Maintenance</h2>
            <p>
              New uploads are indexed automatically. Rebuild the search index only if you added files
              before this feature or if a file’s text is missing from search.
            </p>
            <div className="settings-actions">
              <button onClick={reindexFiles}>Rebuild Search Index</button>
            </div>
          </section>
          </div>

          {status && <div className="status-bar">{status}</div>}
        </main>
      )}
    </div>
  );
}
