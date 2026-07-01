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
import type { BackupStats, ImportPreview, VaultItem, VaultRelationship, WatchedFolder, WatchedFolderFile } from './vaultApi';

type TypeFilter = 'all' | 'note' | 'file';
type ItemSort = 'updated' | 'title' | 'tags';
type CollectionSort = 'name' | 'recent' | 'count';
type AppView = 'dashboard' | 'library' | 'search' | 'settings';
type BackupFrequency = 'on-close' | 'daily' | 'weekly' | 'never';
type ImportFilter = 'all' | 'ready' | 'duplicates' | 'name-conflicts' | 'images' | 'pdfs';
type SettingsTab = 'general' | 'watch' | 'tags' | 'logs';
type SearchViewMode = 'cards' | 'grid';
type LibraryViewMode = 'cards' | 'compact' | 'grid';
type DetailTab = 'preview' | 'notes' | 'relationships' | 'info';
type NoteEditorMode = 'edit' | 'preview' | 'split';

type SlashCommand = {
  id: string;
  label: string;
  hint: string;
  insert: string;
  selectOffset?: number;
};

const maxVisibleTagSuggestions = 18;

type ImportDraft = ImportPreview & {
  importId: string;
  selected: boolean;
  titleDraft: string;
  tagsDraft: string[];
  collectionNameDraft: string;
};

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

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const slashCommands: SlashCommand[] = [
  { id: 'h1', label: '/h1 Heading 1', hint: 'Large heading', insert: '# Heading', selectOffset: 2 },
  { id: 'h2', label: '/h2 Heading 2', hint: 'Section heading', insert: '## Heading', selectOffset: 3 },
  { id: 'todo', label: '/todo Checklist', hint: 'Task checkbox', insert: '- [ ] Task', selectOffset: 6 },
  { id: 'quote', label: '/quote Quote', hint: 'Block quote', insert: '> Quote', selectOffset: 2 },
  { id: 'code', label: '/code Code block', hint: 'Fenced code block', insert: '```\ncode\n```', selectOffset: 4 },
  { id: 'divider', label: '/divider Divider', hint: 'Horizontal rule', insert: '---' },
  { id: 'bullet', label: '/bullet Bullet list', hint: 'List item', insert: '- List item', selectOffset: 2 }
];

function matchTextParts(text: string, query: string) {
  const needle = query.trim();
  if (!needle) return [{ text, match: false }];
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const parts: { text: string; match: boolean }[] = [];
  let cursor = 0;
  let index = lowerText.indexOf(lowerNeedle);

  while (index !== -1) {
    if (index > cursor) parts.push({ text: text.slice(cursor, index), match: false });
    parts.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
    index = lowerText.indexOf(lowerNeedle, cursor);
  }

  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts;
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  return <>
    {matchTextParts(text, query).map((part, index) => part.match
      ? <mark key={index}>{part.text}</mark>
      : <React.Fragment key={index}>{part.text}</React.Fragment>
    )}
  </>;
}

function renderInlineMarkdown(text: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith('**')) nodes.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('_')) nodes.push(<em key={match.index}>{token.slice(1, -1)}</em>);
    else if (token.startsWith('`')) nodes.push(<code key={match.index}>{token.slice(1, -1)}</code>);
    else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      nodes.push(linkMatch
        ? <a key={match.index} href={linkMatch[2]}>{linkMatch[1]}</a>
        : token
      );
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes.length > 0 ? nodes : text;
}

function MarkdownPreview({ value }: { value: string }) {
  const lines = value.split('\n');
  const blocks: React.ReactNode[] = [];
  let codeLines: string[] = [];
  let inCode = false;

  lines.forEach((line, index) => {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        blocks.push(<pre key={`code-${index}`}><code>{codeLines.join('\n')}</code></pre>);
        codeLines = [];
      }
      inCode = !inCode;
      return;
    }

    if (inCode) {
      codeLines.push(line);
      return;
    }

    if (!line.trim()) {
      blocks.push(<div key={index} className="markdown-spacer" />);
    } else if (line.startsWith('# ')) {
      blocks.push(<h1 key={index}>{renderInlineMarkdown(line.slice(2))}</h1>);
    } else if (line.startsWith('## ')) {
      blocks.push(<h2 key={index}>{renderInlineMarkdown(line.slice(3))}</h2>);
    } else if (line.startsWith('### ')) {
      blocks.push(<h3 key={index}>{renderInlineMarkdown(line.slice(4))}</h3>);
    } else if (line.trim() === '---') {
      blocks.push(<hr key={index} />);
    } else if (line.startsWith('> ')) {
      blocks.push(<blockquote key={index}>{renderInlineMarkdown(line.slice(2))}</blockquote>);
    } else if (/^- \[[ xX]\] /.test(line)) {
      blocks.push(
        <label key={index} className="markdown-task">
          <input type="checkbox" checked={line.slice(3, 4).toLowerCase() === 'x'} readOnly />
          <span>{renderInlineMarkdown(line.slice(6))}</span>
        </label>
      );
    } else if (line.startsWith('- ')) {
      blocks.push(<p key={index} className="markdown-list-item">• {renderInlineMarkdown(line.slice(2))}</p>);
    } else {
      blocks.push(<p key={index}>{renderInlineMarkdown(line)}</p>);
    }
  });

  if (inCode && codeLines.length > 0) {
    blocks.push(<pre key="code-open"><code>{codeLines.join('\n')}</code></pre>);
  }

  return <div className="markdown-preview">{blocks.length > 0 ? blocks : <p className="muted-label">Nothing to preview yet.</p>}</div>;
}

function duplicateImportLabel(draft: ImportDraft) {
  if (draft.duplicateKind === 'same-file') return 'Duplicate file';
  if (draft.duplicateKind === 'same-name') return 'Name already exists';
  return 'Import';
}

function duplicateImportDetail(draft: ImportDraft) {
  if (draft.duplicateKind === 'same-file') {
    return `Exact same file already in vault: ${draft.duplicateMatch?.title || draft.duplicateMatch?.fileName || 'existing file'}.`;
  }
  if (draft.duplicateKind === 'same-name') {
    return `Same filename as ${draft.duplicateMatch?.title || draft.duplicateMatch?.fileName || 'an existing file'}, but file contents look different.`;
  }
  return '';
}

export default function App() {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagRecords, setTagRecords] = useState<{ id?: string; name: string; count?: number }[]>([]);
  const [collections, setCollections] = useState<{ id: string; name: string; created_at?: string; count?: number }[]>([]);
  const [collectionSort, setCollectionSort] = useState<CollectionSort>(() => (localStorage.getItem('vault-notes-collection-sort') as CollectionSort) || 'name');
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [appView, setAppView] = useState<AppView>('dashboard');

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [itemSort, setItemSort] = useState<ItemSort>('updated');
  const [libraryViewMode, setLibraryViewMode] = useState<LibraryViewMode>(() => {
    const saved = localStorage.getItem('vault-notes-library-view');
    return saved === 'compact' || saved === 'grid' || saved === 'cards' ? saved : 'cards';
  });
  const [detailTab, setDetailTab] = useState<DetailTab>('notes');
  const [noteEditorMode, setNoteEditorMode] = useState<NoteEditorMode>('edit');
  const [isDetailFocus, setIsDetailFocus] = useState(() => localStorage.getItem('vault-notes-detail-focus') === 'true');
  const [isListFocus, setIsListFocus] = useState(false);

  const [searchText, setSearchText] = useState('');
  const [searchType, setSearchType] = useState<TypeFilter>('all');
  const [searchTags, setSearchTags] = useState<string[]>([]);
  const [searchTagsOnly, setSearchTagsOnly] = useState(false);
  const [searchUntaggedOnly, setSearchUntaggedOnly] = useState(false);
  const [searchResults, setSearchResults] = useState<VaultItem[]>([]);
  const [searchViewMode, setSearchViewMode] = useState<SearchViewMode>(() => {
    const saved = localStorage.getItem('vault-notes-search-view');
    return saved === 'grid' || saved === 'cards' ? saved : 'cards';
  });
  const [showSearchTypeDropdown, setShowSearchTypeDropdown] = useState(false);
  const [showSearchScopeDropdown, setShowSearchScopeDropdown] = useState(false);
  const [searchCollectionId, setSearchCollectionId] = useState('');
  const [showSearchCollectionDropdown, setShowSearchCollectionDropdown] = useState(false);
  const [searchPreviewItem, setSearchPreviewItem] = useState<VaultItem | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const [importDrafts, setImportDrafts] = useState<ImportDraft[]>([]);
  const [isPreparingImport, setIsPreparingImport] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importFilter, setImportFilter] = useState<ImportFilter>('all');
  const [importBulkTag, setImportBulkTag] = useState('');
  const [importBulkCollection, setImportBulkCollection] = useState('');

  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftTags, setDraftTags] = useState('');
  const [draftCollectionIds, setDraftCollectionIds] = useState<string[]>([]);
  const [draftPrivate, setDraftPrivate] = useState(false);

  const [status, setStatus] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newTagText, setNewTagText] = useState('');
  const [settingsTagText, setSettingsTagText] = useState('');
  const [renamingTag, setRenamingTag] = useState('');
  const [renameTagText, setRenameTagText] = useState('');
  const [selectedSettingsTags, setSelectedSettingsTags] = useState<Set<string>>(new Set());
  const [showEditCollectionPicker, setShowEditCollectionPicker] = useState(false);
  const [showSearchTagDropdown, setShowSearchTagDropdown] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [showNewCollectionInput, setShowNewCollectionInput] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const autoEditIdRef = useRef<string | null>(null);
  const editSessionTouchedRef = useRef(false);
  const itemNavigationRef = useRef(false);
  const lastSelectedIdRef = useRef<string | null>(null);
  const [isSelectingItems, setIsSelectingItems] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [showBulkTagPicker, setShowBulkTagPicker] = useState(false);
  const [showBulkCollectionPicker, setShowBulkCollectionPicker] = useState(false);
  const [bulkTags, setBulkTags] = useState<Set<string>>(new Set());
  const [bulkTagTouched, setBulkTagTouched] = useState<Set<string>>(new Set());
  const [bulkCollections, setBulkCollections] = useState<Set<string>>(new Set());
  const [bulkCollectionTouched, setBulkCollectionTouched] = useState<Set<string>>(new Set());
  const selectionAnchorIdRef = useRef<string | null>(null);
  const [backupDirectory, setBackupDirectory] = useState('');
  const [backupFrequency, setBackupFrequency] = useState<BackupFrequency>('daily');
  const [backupRetentionCount, setBackupRetentionCount] = useState(10);
  const [backupStats, setBackupStats] = useState<BackupStats | null>(null);
  const [allowNewImportTagSuggestions, setAllowNewImportTagSuggestions] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('vault-notes-theme') !== 'light');
  const [appVersion, setAppVersion] = useState('');
  const [logText, setLogText] = useState('');
  const [logPath, setLogPath] = useState('');
  const [watchedFolders, setWatchedFolders] = useState<WatchedFolder[]>([]);
  const watchedAutoScanRef = useRef(false);
  const importDraftsRef = useRef<ImportDraft[]>([]);
  const pendingWatchedReviewFilesRef = useRef<WatchedFolderFile[]>([]);
  const pendingWatchedScanFolderIdRef = useRef<string | undefined>(undefined);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const noteEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const [dashboard, setDashboard] = useState<{ totalItems: number; notes: number; files: number; favorites: number; collections: number; tags: number; recentItems: VaultItem[] } | null>(null);
  const itemsListRef = useRef<HTMLDivElement | null>(null);
  const itemCardRefs = useRef(new Map<string, HTMLDivElement>());
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem('vault-notes-sidebar-width'));
    return Number.isFinite(saved) && saved >= 180 && saved <= 460 ? saved : 260;
  });
  const [listWidth, setListWidth] = useState(() => {
    const saved = Number(localStorage.getItem('vault-notes-list-width'));
    return Number.isFinite(saved) && saved >= 250 && saved <= 1100 ? saved : 370;
  });
  const [resizingPane, setResizingPane] = useState<'sidebar' | 'list' | null>(null);
  const [importProgress, setImportProgress] = useState<{ phase: string; current: number; total: number; fileName?: string } | null>(null);
  const [relationships, setRelationships] = useState<VaultRelationship[]>([]);
  const [relationshipItems, setRelationshipItems] = useState<VaultItem[]>([]);
  const [relatedItemSearch, setRelatedItemSearch] = useState('');
  const [slashQuery, setSlashQuery] = useState('');

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return items.find(i => i.id === selectedId) || null;
  }, [items, selectedId]);
  const isSelectedEditing = Boolean(selectedId) && editingItemId === selectedId;

  const sortedItems = useMemo(() => [...items].sort((left, right) => {
    if (itemSort === 'title') return (left.title || '').localeCompare(right.title || '');
    if (itemSort === 'tags') return ((left.tags || []).join(', ')).localeCompare((right.tags || []).join(', ')) || (left.title || '').localeCompare(right.title || '');
    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  }), [items, itemSort]);

  const sortedCollections = useMemo(() => [...collections].sort((left, right) => {
    if (collectionSort === 'count') return (right.count || 0) - (left.count || 0) || left.name.localeCompare(right.name);
    if (collectionSort === 'recent') return new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime();
    return left.name.localeCompare(right.name);
  }), [collections, collectionSort]);

  const relationshipCandidates = useMemo(() => {
    const relatedIds = new Set(relationships.map(relationship => relationship.item.id));
    const query = relatedItemSearch.trim().toLowerCase();
    return relationshipItems
      .filter(item => item.id !== selectedId && !relatedIds.has(item.id))
      .filter(item => !query || [
        item.title,
        item.file_name,
        ...(item.tags || []),
        ...(item.collections || []).map(collection => collection.name)
      ].join(' ').toLowerCase().includes(query))
      .slice(0, 8);
  }, [relationshipItems, relationships, relatedItemSearch, selectedId]);

  const bulkTagUsage = useMemo(() => {
    const usage = new Map<string, number>();
    items.filter(item => selectedItemIds.has(item.id)).forEach(item => {
      (item.tags || []).forEach(tag => usage.set(tag, (usage.get(tag) || 0) + 1));
    });
    return usage;
  }, [items, selectedItemIds]);

  const bulkTagChoices = useMemo(
    () => [...new Set([...allTags, ...bulkTagUsage.keys()])].sort((a, b) => a.localeCompare(b)),
    [allTags, bulkTagUsage]
  );

  const bulkCollectionUsage = useMemo(() => {
    const usage = new Map<string, number>();
    items.filter(item => selectedItemIds.has(item.id)).forEach(item => {
      (item.collection_ids || []).forEach(collectionId => usage.set(collectionId, (usage.get(collectionId) || 0) + 1));
    });
    return usage;
  }, [items, selectedItemIds]);

  const searchSnippets = useMemo(() => {
    const query = searchText.trim();
    const snippets = new Map<string, { label: string; text: string }>();

    searchResults.forEach(item => {
      if (searchTagsOnly && query) {
        const matchingTag = (item.tags || []).find(tag => tag.toLowerCase().includes(query.toLowerCase()));
        snippets.set(item.id, {
          label: matchingTag ? 'Matched tag' : 'Tags',
          text: matchingTag ? `#${matchingTag}` : (item.tags || []).map(tag => `#${tag}`).join(', ')
        });
        return;
      }

      const fields = [
        { label: 'Title', text: item.title || '' },
        { label: 'Notes', text: item.body || '' },
        { label: 'File name', text: item.file_name || '' },
        { label: 'File text', text: item.extracted_text || '' },
        { label: 'Tags', text: (item.tags || []).map(tag => `#${tag}`).join(', ') }
      ];

      const match = query
        ? fields.find(field => field.text.toLowerCase().includes(query.toLowerCase()))
        : fields.find(field => field.text.trim());

      if (!match) {
        snippets.set(item.id, { label: 'Preview', text: 'No preview text yet.' });
        return;
      }

      const lower = match.text.toLowerCase();
      const index = query ? lower.indexOf(query.toLowerCase()) : 0;
      const start = Math.max(0, index - 70);
      const end = Math.min(match.text.length, (index === -1 ? 0 : index) + Math.max(query.length, 60) + 90);
      const prefix = start > 0 ? '…' : '';
      const suffix = end < match.text.length ? '…' : '';
      snippets.set(item.id, { label: match.label, text: `${prefix}${match.text.slice(start, end).trim()}${suffix}` });
    });

    return snippets;
  }, [searchResults, searchTagsOnly, searchText]);

  const importSummary = useMemo(() => ({
    total: importDrafts.length,
    selected: importDrafts.filter(draft => draft.selected).length,
    exactDuplicates: importDrafts.filter(draft => draft.duplicateKind === 'same-file').length,
    nameConflicts: importDrafts.filter(draft => draft.duplicateKind === 'same-name').length,
    images: importDrafts.filter(draft => ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(draft.fileExt)).length,
    pdfs: importDrafts.filter(draft => draft.fileExt === '.pdf').length
  }), [importDrafts]);

  const filteredImportDrafts = useMemo(() => importDrafts.filter(draft => {
    if (importFilter === 'ready') return draft.duplicateKind === 'none';
    if (importFilter === 'duplicates') return draft.duplicateKind === 'same-file';
    if (importFilter === 'name-conflicts') return draft.duplicateKind === 'same-name';
    if (importFilter === 'images') return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(draft.fileExt);
    if (importFilter === 'pdfs') return draft.fileExt === '.pdf';
    return true;
  }), [importDrafts, importFilter]);

  const settingsTagRecords = useMemo(
    () => tagRecords.length ? tagRecords : allTags.map(name => ({ name, count: 0 })),
    [allTags, tagRecords]
  );

  useEffect(() => {
    localStorage.setItem('vault-notes-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    localStorage.setItem('vault-notes-library-view', libraryViewMode);
  }, [libraryViewMode]);

  useEffect(() => {
    localStorage.setItem('vault-notes-search-view', searchViewMode);
  }, [searchViewMode]);

  useEffect(() => {
    localStorage.setItem('vault-notes-collection-sort', collectionSort);
  }, [collectionSort]);

  useEffect(() => {
    localStorage.setItem('vault-notes-detail-focus', String(isDetailFocus));
  }, [isDetailFocus]);

  useEffect(() => {
    localStorage.setItem('vault-notes-sidebar-width', String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem('vault-notes-list-width', String(listWidth));
  }, [listWidth]);

  useEffect(() => {
    importDraftsRef.current = importDrafts;
  }, [importDrafts]);

  useEffect(() => {
    window.vaultApi.getAppVersion().then(setAppVersion).catch(() => undefined);
    refreshWatchedFolders().catch(err => setStatus(`Could not load watched folders: ${err.message}`));
  }, []);

  useEffect(() => {
    if (watchedAutoScanRef.current || watchedFolders.length === 0 || importDrafts.length > 0) return;
    watchedAutoScanRef.current = true;

    const scanTimer = window.setTimeout(() => {
      if (importDraftsRef.current.length > 0) return;
      scanWatchedFolders(false).catch(err => setStatus(`Watched folder scan failed: ${err.message}`));
    }, 5000);
    return () => window.clearTimeout(scanTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedFolders.length, importDrafts.length]);

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
    setTagRecords(loadedTags);
    setAllTags(loadedTags.map((tag: any) => tag.name));

    const loadedCollections = await window.vaultApi.listCollections();
    setCollections(loadedCollections);

    const dashboardSummary = await window.vaultApi.getDashboardSummary();
    setDashboard(dashboardSummary);

    return loadedItems;
  }

  async function refreshTags() {
    const loadedTags = await window.vaultApi.listTags();
    setTagRecords(loadedTags);
    setAllTags(loadedTags.map((tag: any) => tag.name));
    const dashboardSummary = await window.vaultApi.getDashboardSummary();
    setDashboard(dashboardSummary);
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
      const matchesUntagged = !searchUntaggedOnly || (item.tags || []).length === 0;
      const matchesSelectedTags = searchTags.length === 0 || searchTags.every(tag =>
        (item.tags || []).some(itemTag => itemTag.toLowerCase() === tag.toLowerCase())
      );
      return matchesTypedTag && matchesSelectedTags && matchesUntagged;
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
    setSearchUntaggedOnly(false);
    setSearchTagsOnly(false);
    setSearchCollectionId('');
    setSearchType('all');
    setSearchResults([]);
    setStatus('Search cleared.');
  }

  function toggleSearchTag(tag: string) {
    setSearchUntaggedOnly(false);
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

  async function openSearchItemInLibrary(item: VaultItem) {
    if (!(await confirmSaveDirtyChanges())) return;
    setSelectedCollectionId(null);
    setSearch('');
    setTypeFilter('all');
    setItems(current => [item, ...current.filter(existing => existing.id !== item.id)]);
    setSelectedId(item.id);
    setSearchPreviewItem(null);
    setAppView('library');
  }

  async function openDashboardLibrary(type: TypeFilter = 'all') {
    if (!(await confirmSaveDirtyChanges())) return;
    setSelectedCollectionId(null);
    setTypeFilter(type);
    setAppView('library');
  }

  async function openDashboardItem(item: VaultItem) {
    if (!(await confirmSaveDirtyChanges())) return;
    setSelectedCollectionId(null);
    setTypeFilter('all');
    setItems(current => [item, ...current.filter(existing => existing.id !== item.id)]);
    setSelectedId(item.id);
    setAppView('library');
  }

  async function openSettingsTab(tab: SettingsTab) {
    if (!(await confirmSaveDirtyChanges())) return;
    setSettingsTab(tab);
    setAppView('settings');
  }

  async function openSearchForTag(tag: string) {
    if (!(await confirmSaveDirtyChanges())) return;
    setSearchText('');
    setSearchTags([tag]);
    setSearchUntaggedOnly(false);
    setSearchTagsOnly(false);
    setSearchType('all');
    setSearchCollectionId('');
    setSearchResults([]);
    setAppView('search');
  }

  useEffect(() => {
    refresh().catch(err => setStatus(err.message));
    window.vaultApi.getBackupSettings()
      .then(settings => {
        setBackupDirectory(settings.backupDirectory);
        setBackupFrequency(settings.backupFrequency);
        setBackupRetentionCount(settings.backupRetentionCount);
        setBackupStats(settings.backupStats);
        setAllowNewImportTagSuggestions(settings.allowNewImportTagSuggestions !== false);
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
    if (!selectedId) {
      setRelationships([]);
      setRelationshipItems([]);
      return;
    }

    Promise.all([
      window.vaultApi.listRelationships(selectedId),
      window.vaultApi.listItems({ search: '', tag: '', type: 'all', collectionId: '' })
    ])
      .then(([loadedRelationships, loadedItems]) => {
        setRelationships(loadedRelationships);
        setRelationshipItems(loadedItems);
      })
      .catch(err => setStatus(`Could not load relationships: ${err.message}`));
  }, [selectedId]);

  useEffect(() => {
    if (appView !== 'search') return;

    const timeout = window.setTimeout(() => {
      runFullSearch().catch(err => setStatus(err.message));
    }, 200);

    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, [appView, searchText, searchTags, searchType, searchTagsOnly, searchUntaggedOnly, searchCollectionId]);

  useEffect(() => {
    if (appView === 'settings') {
      refreshLogs();
      refreshTags().catch(err => setStatus(`Could not load tags: ${err.message}`));
      refreshWatchedFolders().catch(err => setStatus(`Could not load watched folders: ${err.message}`));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appView]);

  useEffect(() => {
    if (selected) {
      const selectionChanged = lastSelectedIdRef.current !== selected.id;
      const shouldEdit = selected.id === autoEditIdRef.current;
      if (selectionChanged || shouldEdit) {
        editSessionTouchedRef.current = shouldEdit;
        setDraftTitle(selected.title || '');
        setDraftBody(selected.body || '');
        setDraftTags((selected.tags || []).join(', '));
        setDraftCollectionIds(selected.collection_ids || []);
        setDraftPrivate(Boolean(selected.private));
        setIsEditing(shouldEdit);
        setEditingItemId(shouldEdit ? selected.id : null);
        setDetailTab(selected.type === 'file' ? 'preview' : 'notes');
        if (shouldEdit) autoEditIdRef.current = null;
      }
      lastSelectedIdRef.current = selected.id;
    }

    if (!selectedId) {
      setDraftTitle('');
      setDraftBody('');
      setDraftTags('');
      setDraftCollectionIds([]);
      setDraftPrivate(false);
      editSessionTouchedRef.current = false;
      setIsEditing(false);
      setEditingItemId(null);
      lastSelectedIdRef.current = null;
    }
  }, [selected, selectedId]);

  async function createNote() {
    if (!(await confirmSaveDirtyChanges())) return;
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
      setIsEditing(true);
      setEditingItemId(item.id);
      editSessionTouchedRef.current = true;
      setDraftTitle(item.title || 'Untitled note');
      setDraftBody('');
      setDraftTags('');
      setDraftCollectionIds(selectedCollectionId ? [selectedCollectionId] : []);
      setDraftPrivate(false);

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

  function sortedValues(values: string[]) {
    return [...values].map(value => value.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  function markDraftTouched() {
    if (isSelectedEditing) editSessionTouchedRef.current = true;
  }

  function hasUnsavedChanges() {
    if (!isSelectedEditing || !selected) return false;
    if (editSessionTouchedRef.current) return true;
    const currentTags = sortedValues(selected.tags || []);
    const draftTagValues = sortedValues(tagStringToArray(draftTags));
    const currentCollections = sortedValues(selected.collection_ids || []);
    const draftCollections = sortedValues(draftCollectionIds);

    return (
      (selected.title || '') !== (draftTitle.trim() || 'Untitled note') ||
      (selected.body || '') !== draftBody ||
      currentTags.join('\n') !== draftTagValues.join('\n') ||
      currentCollections.join('\n') !== draftCollections.join('\n') ||
      Boolean(selected.private) !== draftPrivate
    );
  }

  async function saveSelected(options: { keepEditing?: boolean; silent?: boolean } = {}) {
    if (!selectedId) {
      if (!options.silent) setStatus('Nothing selected to save.');
      return;
    }

    try {
      setIsSaving(true);
      if (!options.silent) setStatus('Saving...');

      const updated = await window.vaultApi.updateItem({
        id: selectedId,
        title: draftTitle.trim() || 'Untitled note',
        body: draftBody,
        tags: tagStringToArray(draftTags),
        private: draftPrivate,
        collectionIds: draftCollectionIds
      });

      const scrollTop = itemsListRef.current?.scrollTop;
      setItems(current => current.map(item => item.id === updated.id ? updated : item));
      window.vaultApi.listTags()
        .then(tags => {
          setTagRecords(tags);
          setAllTags(tags.map((tag: any) => tag.name));
        })
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

      setStatus(`${options.silent ? 'Autosaved' : 'Saved'} at ${time}.`);
      editSessionTouchedRef.current = false;
      if (!options.keepEditing) {
        setIsEditing(false);
        setEditingItemId(null);
      }
    } catch (err: any) {
      setStatus(`Save failed: ${err.message}`);
      throw err;
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmSaveDirtyChanges() {
    if (!isSelectedEditing || !selected) return true;
    const dirty = hasUnsavedChanges();
    const shouldSave = confirm(dirty
      ? 'You have unsaved changes. Save them before leaving this note?'
      : 'You are editing this note. Save before leaving?'
    );
    if (shouldSave) {
      await saveSelected();
      return true;
    }
    if (!dirty) {
      setIsEditing(false);
      setEditingItemId(null);
      return true;
    }
    const discard = confirm('Discard unsaved changes and continue?');
    if (discard) {
      setIsEditing(false);
      setEditingItemId(null);
      editSessionTouchedRef.current = false;
    }
    return discard;
  }

  async function selectItem(itemId: string) {
    if (itemId === selectedId) return;
    if (itemNavigationRef.current) return;

    itemNavigationRef.current = true;
    try {
      if (!(await confirmSaveDirtyChanges())) return;
      setSelectedId(itemId);
    } finally {
      itemNavigationRef.current = false;
    }
  }

  async function changeAppView(nextView: AppView) {
    if (nextView === appView) return;
    if (!(await confirmSaveDirtyChanges())) return;
    setAppView(nextView);
  }

  useEffect(() => {
    if (!isSelectedEditing || !selectedId) return;
    const timer = window.setInterval(() => {
      if (!isSaving && hasUnsavedChanges()) {
        saveSelected({ keepEditing: true, silent: true }).catch(() => undefined);
      }
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelectedEditing, isSaving, selectedId, draftTitle, draftBody, draftTags, draftPrivate, draftCollectionIds]);

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

  async function selectCollection(collectionId: string | null) {
    if (!(await confirmSaveDirtyChanges())) return;
    setSelectedCollectionId(collectionId);
    setSelectedId(null);
    setIsEditing(false);
    setEditingItemId(null);
  }

  function beginEditing() {
    editSessionTouchedRef.current = false;
    setEditingItemId(selectedId);
    setIsEditing(true);
  }

  function focusLibraryList() {
    setIsDetailFocus(false);
    setIsListFocus(true);
  }

  function focusDetailPanel() {
    setIsListFocus(false);
    setIsDetailFocus(true);
  }

  function showSplitLibrary() {
    setIsListFocus(false);
    setIsDetailFocus(false);
  }

  function cancelEditing() {
    if (!selected) return;
    setDraftTitle(selected.title || '');
    setDraftBody(selected.body || '');
    setDraftTags((selected.tags || []).join(', '));
    setDraftCollectionIds(selected.collection_ids || []);
    setDraftPrivate(Boolean(selected.private));
    editSessionTouchedRef.current = false;
    setEditingItemId(null);
    setIsEditing(false);
  }

  function collectionNameForDraft(draft: ImportDraft) {
    return draft.collectionNameDraft.trim();
  }

  async function prepareImportEntries(fileInputs: (WatchedFolderFile | { sourcePath: string; relativePath?: string })[], options?: { watchedFolderId?: string }) {
    if (fileInputs.length === 0) {
      throw new Error('Could not read file path from Electron.');
    }

    setIsPreparingImport(true);
    pendingWatchedReviewFilesRef.current = fileInputs.filter((file): file is WatchedFolderFile =>
      'watchedFolderId' in file && Boolean(file.watchedFolderId)
    );
    pendingWatchedScanFolderIdRef.current = options?.watchedFolderId;
    const isWatchedScan = pendingWatchedReviewFilesRef.current.length > 0;
    setImportProgress({
      phase: isWatchedScan ? 'Preparing watched files' : 'Preparing files',
      current: isWatchedScan ? 1 : 0,
      total: isWatchedScan ? 1 : fileInputs.length
    });
    setStatus(isWatchedScan
      ? 'Preparing watched-folder files for review...'
      : `Preparing ${fileInputs.length} file${fileInputs.length === 1 ? '' : 's'} for review...`
    );
    try {
      const previewMeta = new Map(fileInputs.map(file => [file.sourcePath, file]));
      const previews = await window.vaultApi.previewImport(fileInputs);
      setImportProgress({
        phase: 'Ready for review',
        current: isWatchedScan ? 1 : previews.length,
        total: isWatchedScan ? 1 : fileInputs.length
      });
      setImportDrafts(previews.map((preview, index) => ({
        ...preview,
        watchedFolderId: (previewMeta.get(preview.sourcePath) as WatchedFolderFile | undefined)?.watchedFolderId,
        watchedFolderPath: (previewMeta.get(preview.sourcePath) as WatchedFolderFile | undefined)?.watchedFolderPath,
        importId: `${preview.sourcePath}-${index}`,
        selected: preview.duplicateKind !== 'same-file',
        titleDraft: preview.title,
        tagsDraft: [...new Set(preview.suggestedTags.filter(tag =>
          allowNewImportTagSuggestions || allTags.some(existing => existing.toLowerCase() === tag.toLowerCase())
        ))],
        collectionNameDraft: selectedCollectionId
          ? collections.find(collection => collection.id === selectedCollectionId)?.name || ''
          : preview.suggestedCollectionName
      })));
      if (previews.length === 0 && pendingWatchedReviewFilesRef.current.length > 0) {
        await markPendingWatchedFilesHandled();
        setImportProgress(null);
        setStatus('No readable watched-folder files needed review. Marked this scan handled.');
        return;
      }
      setStatus(`Review ${previews.length} file${previews.length === 1 ? '' : 's'} before importing.`);
    } finally {
      setIsPreparingImport(false);
    }
  }

  async function prepareImport(files: File[]) {
    if (files.length === 0) return;

    const fileInputs = files.map(file => ({
      sourcePath: window.vaultApi.getPathForFile(file),
      relativePath: (file as any).webkitRelativePath || file.name
    })).filter(file => file.sourcePath);

    await prepareImportEntries(fileInputs);
  }

  async function uploadDraft(draft: ImportDraft, collectionIds: string[]) {
    const item = await window.vaultApi.uploadFile({
      sourcePath: draft.sourcePath,
      title: draft.titleDraft || draft.fileName,
      body: draft.extractedText || '',
      tags: draft.tagsDraft,
      collectionIds
    });

    return item;
  }

  function updateImportDraft(importId: string, updates: Partial<ImportDraft>) {
    setImportDrafts(current => current.map(draft => draft.importId === importId ? { ...draft, ...updates } : draft));
  }

  function toggleImportTag(importId: string, tag: string) {
    setImportDrafts(current => current.map(draft => {
      if (draft.importId !== importId) return draft;
      const hasTag = draft.tagsDraft.includes(tag);
      return {
        ...draft,
        tagsDraft: hasTag ? draft.tagsDraft.filter(existing => existing !== tag) : [...draft.tagsDraft, tag]
      };
    }));
  }

  function selectVisibleImportDrafts(selected: boolean) {
    const visibleIds = new Set(filteredImportDrafts.map(draft => draft.importId));
    setImportDrafts(current => current.map(draft => visibleIds.has(draft.importId) ? { ...draft, selected } : draft));
  }

  function addTagToSelectedImports() {
    const tag = importBulkTag.trim();
    if (!tag) return;
    setImportDrafts(current => current.map(draft => draft.selected
      ? { ...draft, tagsDraft: [...new Set([...draft.tagsDraft, tag])] }
      : draft
    ));
    setImportBulkTag('');
    setStatus(`Added #${tag} to selected import files.`);
  }

  function applyCollectionToSelectedImports() {
    const collectionName = importBulkCollection.trim();
    if (!collectionName) return;
    setImportDrafts(current => current.map(draft => draft.selected
      ? { ...draft, collectionNameDraft: collectionName }
      : draft
    ));
    setStatus(`Set selected import files to collection "${collectionName}".`);
  }

  async function markPendingWatchedFilesHandled() {
    const files = pendingWatchedReviewFilesRef.current;
    const folderId = pendingWatchedScanFolderIdRef.current;
    if (files.length === 0 && !folderId) return 0;
    pendingWatchedReviewFilesRef.current = [];
    pendingWatchedScanFolderIdRef.current = undefined;
    const result = await window.vaultApi.markWatchedScanHandled({ folderId });
    if (result.handled === 0 && files.length > 0) {
      await window.vaultApi.markWatchedFilesSeen(files);
    }
    await refreshWatchedFolders();
    return result.handled || files.length;
  }

  async function closeImportReview() {
    const handled = await markPendingWatchedFilesHandled();
    setImportDrafts([]);
    setImportProgress(null);
    setStatus(handled > 0
      ? 'Import review dismissed. Watched-folder files from this review will not be shown again.'
      : 'Import review dismissed.'
    );
  }

  async function commitImportDrafts() {
    const selectedDrafts = importDrafts.filter(draft => draft.selected);
    if (selectedDrafts.length === 0) {
      if (pendingWatchedReviewFilesRef.current.length > 0) {
        await markPendingWatchedFilesHandled();
        setImportDrafts([]);
        setImportProgress(null);
        setStatus('Skipped watched-folder files. They will not be shown again.');
        return;
      }
      setStatus('Select at least one file to import.');
      return;
    }

    setIsImporting(true);
    setImportProgress({ phase: 'Importing files', current: 0, total: selectedDrafts.length });
    try {
      const knownCollections = new Map(collections.map(collection => [collection.name.toLowerCase(), collection]));
      const createdCollections = new Map<string, { id: string; name: string }>();
      let lastItem: VaultItem | undefined;

      for (let index = 0; index < selectedDrafts.length; index += 1) {
        const draft = selectedDrafts[index];
        setImportProgress({ phase: 'Importing files', current: index + 1, total: selectedDrafts.length, fileName: draft.fileName });
        setStatus(`Importing ${index + 1} of ${selectedDrafts.length}: ${draft.fileName}`);
        const collectionName = collectionNameForDraft(draft);
        const collectionIds: string[] = [];

        if (collectionName) {
          const key = collectionName.toLowerCase();
          let collection = knownCollections.get(key) || createdCollections.get(key);
          if (!collection) {
            collection = await window.vaultApi.createCollection(collectionName);
            createdCollections.set(key, collection);
          }
          collectionIds.push(collection.id);
        }

        lastItem = await uploadDraft(draft, collectionIds);
      }

      await markPendingWatchedFilesHandled();

      setImportDrafts([]);
      setImportProgress(null);
      setAppView('library');
      await refresh();
      if (lastItem) {
        autoEditIdRef.current = lastItem.id;
        setSelectedId(lastItem.id);
        setIsEditing(true);
        setEditingItemId(lastItem.id);
      }
      setStatus(`Imported ${selectedDrafts.length} file${selectedDrafts.length === 1 ? '' : 's'}.`);
    } catch (err: any) {
      setImportProgress(null);
      setStatus(`Import failed: ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  }

  async function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (!(await confirmSaveDirtyChanges())) {
      e.target.value = '';
      return;
    }

    try {
      await prepareImport(files);
    } catch (err: any) {
      setImportProgress(null);
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

  async function selectItemWithModifiers(itemId: string, event: React.MouseEvent<HTMLDivElement>) {
    const modifier = event.ctrlKey || event.metaKey || event.shiftKey;
    if (!modifier) {
      if (isSelectingItems) {
        toggleItemSelection(itemId);
        selectionAnchorIdRef.current = itemId;
      } else {
        await selectItem(itemId);
        selectionAnchorIdRef.current = itemId;
      }
      return;
    }

    setIsSelectingItems(true);
    if (event.shiftKey) {
      const anchorId = selectionAnchorIdRef.current || selectedId || itemId;
      const start = sortedItems.findIndex(item => item.id === anchorId);
      const end = sortedItems.findIndex(item => item.id === itemId);
      const rangeStart = start === -1 ? end : start;
      const range = sortedItems.slice(Math.min(rangeStart, end), Math.max(rangeStart, end) + 1).map(item => item.id);
      setSelectedItemIds(current => event.ctrlKey || event.metaKey ? new Set([...current, ...range]) : new Set(range));
      if (!selectionAnchorIdRef.current) selectionAnchorIdRef.current = itemId;
    } else {
      toggleItemSelection(itemId);
      selectionAnchorIdRef.current = itemId;
    }
  }

  useEffect(() => {
    function navigateItems(event: KeyboardEvent) {
      if (appView !== 'library' || isSelectingItems) return;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (items.length === 0) return;

      event.preventDefault();
      const currentIndex = sortedItems.findIndex(item => item.id === selectedId);
      const delta = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1;
      const nextIndex = currentIndex === -1
        ? (delta > 0 ? 0 : sortedItems.length - 1)
        : Math.max(0, Math.min(sortedItems.length - 1, currentIndex + delta));

      selectItem(sortedItems[nextIndex].id).catch(() => undefined);
    }

    window.addEventListener('keydown', navigateItems);
    return () => window.removeEventListener('keydown', navigateItems);
  }, [appView, isSelectingItems, sortedItems, selectedId]);

  useEffect(() => {
    if (appView !== 'library' || !selectedId) return;
    requestAnimationFrame(() => {
      itemCardRefs.current.get(selectedId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, [appView, selectedId]);

  useEffect(() => {
    if (!resizingPane) return;
    const onMouseMove = (event: MouseEvent) => {
      if (resizingPane === 'sidebar') setSidebarWidth(Math.max(180, Math.min(460, event.clientX)));
      else {
        const availableWidth = Math.max(320, window.innerWidth - sidebarWidth - 180);
        setListWidth(Math.max(250, Math.min(availableWidth, event.clientX - sidebarWidth)));
      }
    };
    const onMouseUp = () => setResizingPane(null);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [resizingPane, sidebarWidth]);

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
    setBulkTagTouched(current => new Set([...current, tag]));
  }

  async function applyBulkTags() {
    const ids = [...selectedItemIds];
    if (ids.length === 0) return;
    const changedTags = [...bulkTagTouched];
    if (changedTags.length === 0) return;
    const addTags = changedTags.filter(tag => bulkTags.has(tag));
    const removeTags = changedTags.filter(tag => !bulkTags.has(tag));
    if (addTags.length) await window.vaultApi.addTagsToItems(ids, addTags);
    if (removeTags.length) await window.vaultApi.removeTagsFromItems(ids, removeTags);
    await refresh();
    setBulkTags(new Set());
    setBulkTagTouched(new Set());
    setShowBulkTagPicker(false);
    setStatus('Updated tags for selected items.');
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

  function toggleBulkCollection(collectionId: string) {
    setBulkCollections(current => {
      const next = new Set(current);
      if (next.has(collectionId)) next.delete(collectionId);
      else next.add(collectionId);
      return next;
    });
    setBulkCollectionTouched(current => new Set([...current, collectionId]));
  }

  async function applyBulkCollections() {
    const selectedItems = items.filter(item => selectedItemIds.has(item.id));
    if (selectedItems.length === 0 || bulkCollectionTouched.size === 0) return;
    const touched = [...bulkCollectionTouched];

    for (const item of selectedItems) {
      const next = new Set(item.collection_ids || []);
      touched.forEach(collectionId => {
        if (bulkCollections.has(collectionId)) next.add(collectionId);
        else next.delete(collectionId);
      });
      await window.vaultApi.updateItem({ id: item.id, collectionIds: [...next] });
    }

    await refresh();
    setBulkCollections(new Set());
    setBulkCollectionTouched(new Set());
    setShowBulkCollectionPicker(false);
    setStatus('Updated collections for selected items.');
  }

  async function onDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (!(await confirmSaveDirtyChanges())) return;

    try {
      await prepareImport(files);
    } catch (err: any) {
      setImportProgress(null);
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
      if (result.backupRetentionCount) setBackupRetentionCount(result.backupRetentionCount);
      if (result.backupStats) setBackupStats(result.backupStats);
      setStatus(`Backup folder changed: ${result.path}`);
    }
  }

  async function changeBackupFrequency(frequency: BackupFrequency) {
    const result = await window.vaultApi.setBackupFrequency(frequency);
    setBackupFrequency(result.backupFrequency as BackupFrequency);
    setBackupRetentionCount(result.backupRetentionCount);
    setBackupStats(result.backupStats);
    setStatus(`Automatic backups: ${frequency === 'never' ? 'off' : frequency}.`);
  }

  async function changeBackupRetentionCount(count: number) {
    const result = await window.vaultApi.setBackupRetentionCount(count);
    setBackupRetentionCount(result.backupRetentionCount);
    setBackupStats(result.backupStats);
    setStatus(result.deleted > 0
      ? `Backup retention updated. Removed ${result.deleted} old automatic backup${result.deleted === 1 ? '' : 's'}.`
      : `Backup retention updated. Keeping the newest ${result.backupRetentionCount} automatic backup${result.backupRetentionCount === 1 ? '' : 's'}.`
    );
  }

  async function changeImportTagSuggestionMode(allowNewTags: boolean) {
    const result = await window.vaultApi.setImportTagSuggestions(allowNewTags);
    setAllowNewImportTagSuggestions(result.allowNewImportTagSuggestions);
    setStatus(result.allowNewImportTagSuggestions
      ? 'Import review can suggest new tags from file and folder names.'
      : 'Import review will only suggest tags that already exist.'
    );
  }

  async function checkForUpdates() {
    const result = await window.vaultApi.checkForUpdates();
    if (!result.updateAvailable) setStatus('Note Vault is up to date.');
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

  async function refreshLogs() {
    try {
      const logs = await window.vaultApi.getLogs();
      setLogText(logs.text);
      setLogPath(logs.path);
      setStatus('Logs refreshed.');
    } catch (err: any) {
      setStatus(`Could not load logs: ${err.message}`);
    }
  }

  async function openLogsFolder() {
    try {
      const result = await window.vaultApi.openLogs();
      setStatus(`Opened logs folder: ${result.path}`);
    } catch (err: any) {
      setStatus(`Could not open logs: ${err.message}`);
    }
  }

  async function refreshWatchedFolders() {
    const folders = await window.vaultApi.listWatchedFolders();
    setWatchedFolders(folders);
  }

  async function addWatchedFolder() {
    try {
      const result = await window.vaultApi.addWatchedFolder();
      if (result.canceled) return;
      await refreshWatchedFolders();
      setSettingsTab('watch');
      if (result.folder?.id) {
        setStatus(result.alreadyExists ? 'That folder is already watched. Scanning it now...' : 'Watched folder added. Scanning existing files now...');
        await scanWatchedFolders(false, result.folder.id);
      } else {
        setStatus('Watched folder added.');
      }
    } catch (err: any) {
      setStatus(`Could not add watched folder: ${err.message}`);
    }
  }

  async function removeWatchedFolder(id: string) {
    if (!confirm('Remove this watched folder? Files already imported into the vault will stay.')) return;
    try {
      await window.vaultApi.removeWatchedFolder(id);
      await refreshWatchedFolders();
      setStatus('Watched folder removed.');
    } catch (err: any) {
      setStatus(`Could not remove watched folder: ${err.message}`);
    }
  }

  async function reviewWatchedFiles(files: WatchedFolderFile[], sourceLabel = 'watched folders', folderId?: string) {
    if (files.length === 0) {
      setStatus(`No new files found in ${sourceLabel}.`);
      return;
    }

    const scanFolderId = folderId || (files.length > 0 ? files[0].watchedFolderId : undefined);
    await prepareImportEntries(files, { watchedFolderId: scanFolderId });
    setStatus(`Review ${files.length} new file${files.length === 1 ? '' : 's'} from ${sourceLabel}.`);
  }

  async function scanWatchedFolders(auto = false, folderId?: string) {
    try {
      const files = await window.vaultApi.scanWatchedFolders({ markSeen: false, folderId });
      if (files.length === 0) {
        if (!auto) setStatus('No new files found in watched folders.');
        return;
      }

      const shouldReview = auto
        ? confirm(`Note Vault found ${files.length} new file${files.length === 1 ? '' : 's'} in watched folders. Review them now?`)
        : true;

      if (!shouldReview) {
        setStatus(`${files.length} new watched-folder file${files.length === 1 ? '' : 's'} waiting for review.`);
        return;
      }

      await reviewWatchedFiles(files, folderId ? 'this watched folder' : 'watched folders', folderId);
    } catch (err: any) {
      setStatus(`Watched folder scan failed: ${err.message}`);
    }
  }

  async function createSettingsTag() {
    const tag = settingsTagText.trim();
    if (!tag) return;
    try {
      await window.vaultApi.createTag(tag);
      setSettingsTagText('');
      await refreshTags();
      setStatus(`Tag added: #${tag}`);
    } catch (err: any) {
      setStatus(`Could not add tag: ${err.message}`);
    }
  }

  async function saveRenamedTag(oldName: string) {
    const nextName = renameTagText.trim();
    if (!nextName) return;
    try {
      await window.vaultApi.renameTag(oldName, nextName);
      setRenamingTag('');
      setRenameTagText('');
      await refresh();
      setStatus(`Renamed #${oldName} to #${nextName}.`);
    } catch (err: any) {
      setStatus(`Could not rename tag: ${err.message}`);
    }
  }

  async function deleteSettingsTag(tag: string) {
    if (!confirm(`Delete tag "#${tag}" from all items?`)) return;
    try {
      await window.vaultApi.deleteTag(tag);
      setSelectedSettingsTags(current => {
        const next = new Set(current);
        next.delete(tag);
        return next;
      });
      await refresh();
      setStatus(`Deleted tag: #${tag}`);
    } catch (err: any) {
      setStatus(`Could not delete tag: ${err.message}`);
    }
  }

  function toggleSettingsTagSelection(tag: string) {
    setSelectedSettingsTags(current => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  async function deleteSelectedSettingsTags() {
    const tags = [...selectedSettingsTags];
    if (tags.length === 0) return;
    if (!confirm(`Delete ${tags.length} selected tag${tags.length === 1 ? '' : 's'} from all items?`)) return;
    try {
      for (const tag of tags) {
        await window.vaultApi.deleteTag(tag);
      }
      setSelectedSettingsTags(new Set());
      await refresh();
      setStatus(`Deleted ${tags.length} selected tag${tags.length === 1 ? '' : 's'}.`);
    } catch (err: any) {
      setStatus(`Could not delete selected tags: ${err.message}`);
    }
  }

  function updateSlashQuery(value: string, cursor: number | null) {
    if (cursor === null) {
      setSlashQuery('');
      return;
    }
    const lineStart = value.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
    const currentLine = value.slice(lineStart, cursor);
    const match = currentLine.match(/^\/([a-z0-9-]*)$/i);
    setSlashQuery(match ? match[1].toLowerCase() : '');
  }

  function replaceEditorRange(start: number, end: number, insert: string, selectOffset?: number) {
    const nextBody = `${draftBody.slice(0, start)}${insert}${draftBody.slice(end)}`;
    markDraftTouched();
    setDraftBody(nextBody);
    window.requestAnimationFrame(() => {
      const editor = noteEditorRef.current;
      if (!editor) return;
      editor.focus();
      const cursor = start + (selectOffset ?? insert.length);
      editor.setSelectionRange(cursor, cursor);
      updateSlashQuery(nextBody, cursor);
    });
  }

  function insertMarkdown(before: string, after = '', placeholder = 'text') {
    const editor = noteEditorRef.current;
    if (!editor || !isSelectedEditing) return;
    const start = editor.selectionStart ?? draftBody.length;
    const end = editor.selectionEnd ?? start;
    const selectedText = draftBody.slice(start, end) || placeholder;
    replaceEditorRange(start, end, `${before}${selectedText}${after}`, before.length);
  }

  function insertBlock(markup: string, selectOffset?: number) {
    const editor = noteEditorRef.current;
    if (!editor || !isSelectedEditing) return;
    const start = editor.selectionStart ?? draftBody.length;
    const prefix = start > 0 && draftBody[start - 1] !== '\n' ? '\n' : '';
    replaceEditorRange(start, start, `${prefix}${markup}${markup.endsWith('\n') ? '' : '\n'}`, prefix.length + (selectOffset ?? markup.length));
  }

  function runSlashCommand(command: SlashCommand) {
    const editor = noteEditorRef.current;
    if (!editor || !isSelectedEditing) return;
    const cursor = editor.selectionStart ?? draftBody.length;
    const lineStart = draftBody.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
    replaceEditorRange(lineStart, cursor, command.insert, command.selectOffset);
    setSlashQuery('');
  }

  function handleNoteKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!isSelectedEditing) return;
    const visibleCommands = slashCommands.filter(command => command.id.startsWith(slashQuery));
    if (slashQuery && visibleCommands.length > 0 && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault();
      runSlashCommand(visibleCommands[0]);
    }
  }

  async function addRelationship(relatedItemId: string) {
    if (!selectedId) return;
    try {
      const updated = await window.vaultApi.addRelationship({ itemId: selectedId, relatedItemId });
      setRelationships(updated);
      setRelatedItemSearch('');
      setStatus('Relationship added.');
    } catch (err: any) {
      setStatus(`Could not add relationship: ${err.message}`);
    }
  }

  async function removeRelationship(relatedItemId: string) {
    if (!selectedId) return;
    try {
      const updated = await window.vaultApi.removeRelationship({ itemId: selectedId, relatedItemId });
      setRelationships(updated);
      setStatus('Relationship removed.');
    } catch (err: any) {
      setStatus(`Could not remove relationship: ${err.message}`);
    }
  }

  async function importBackup() {
    if (!(await confirmSaveDirtyChanges())) return;
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
      className={`app-shell ${isDarkMode ? 'theme-dark' : ''} ${appView === 'library' && isDetailFocus ? 'detail-focus' : ''} ${appView === 'library' && isListFocus ? 'list-focus' : ''}`}
      style={{ '--sidebar-width': `${sidebarWidth}px`, '--list-width': `${listWidth}px` } as React.CSSProperties}
      onDragOver={e => {
        if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={e => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setIsDragging(false);
      }}
      onDrop={onDrop}
    >
      {isDragging && (
        <div className="drop-overlay">
          Drop files to add them to your vault
        </div>
      )}

      {importProgress && importDrafts.length === 0 && (
        <div className="import-progress-floating">
          <strong>{importProgress.phase}</strong>
          {importProgress.total > 1 && <span>{importProgress.current} of {importProgress.total}</span>}
          {importProgress.fileName && <small>{importProgress.fileName}</small>}
          {importProgress.total > 1 && <progress value={importProgress.current} max={Math.max(1, importProgress.total)} />}
        </div>
      )}

      {importDrafts.length > 0 && (
        <div className="import-review-backdrop">
          <section className="import-review-dialog" role="dialog" aria-modal="true" aria-label="Review import">
            <div className="import-review-header">
              <div>
                <span className="item-type">Import Wizard</span>
                <h2>Review before adding to your vault</h2>
                <p>
                  Suggested tags and collections come from folder names and filenames. Exact duplicate files are skipped by default; same-name files stay selected with a warning.
                </p>
              </div>
              <button onClick={closeImportReview} disabled={isImporting}>Cancel</button>
            </div>

            <div className="import-review-tools">
              <button
                type="button"
                onClick={() => selectVisibleImportDrafts(true)}
              >
                Select Visible
              </button>
              <button
                type="button"
                onClick={() => selectVisibleImportDrafts(false)}
              >
                Deselect Visible
              </button>
              <span>
                {importSummary.selected} selected · {importSummary.total} total · {importSummary.exactDuplicates} exact duplicates · {importSummary.nameConflicts} name conflicts
              </span>
            </div>

            {importProgress && (
              <div className="import-progress-card">
                <div>
                  <strong>{importProgress.phase}</strong>
                  <span>{importProgress.current} of {importProgress.total}</span>
                </div>
                {importProgress.fileName && <small>{importProgress.fileName}</small>}
                <progress value={importProgress.current} max={Math.max(1, importProgress.total)} />
              </div>
            )}

            <div className="import-filter-row">
              {([
                ['all', `All (${importSummary.total})`],
                ['ready', `Ready (${importSummary.total - importSummary.exactDuplicates - importSummary.nameConflicts})`],
                ['duplicates', `Duplicates (${importSummary.exactDuplicates})`],
                ['name-conflicts', `Name Conflicts (${importSummary.nameConflicts})`],
                ['images', `Images (${importSummary.images})`],
                ['pdfs', `PDFs (${importSummary.pdfs})`]
              ] as [ImportFilter, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={importFilter === value ? 'active' : ''}
                  onClick={() => setImportFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="import-bulk-row">
              <label>
                Add tag to selected
                <div>
                  <input
                    value={importBulkTag}
                    onChange={event => setImportBulkTag(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addTagToSelectedImports();
                      }
                    }}
                    placeholder="ideas, project, reference..."
                  />
                  <button type="button" onClick={addTagToSelectedImports}>Add Tag</button>
                </div>
              </label>
              <label>
                Set collection for selected
                <div>
                  <input
                    value={importBulkCollection}
                    onChange={event => setImportBulkCollection(event.target.value)}
                    placeholder="Project or folder name"
                    list="import-collection-suggestions"
                  />
                  <datalist id="import-collection-suggestions">
                    {collections.map(collection => <option key={collection.id} value={collection.name} />)}
                  </datalist>
                  <button type="button" onClick={applyCollectionToSelectedImports}>Apply</button>
                </div>
              </label>
            </div>

            <div className="import-review-list">
              {filteredImportDrafts.map(draft => (
                <article key={draft.importId} className={`import-review-card ${draft.selected ? 'selected' : ''}`}>
                  <div className="import-review-select">
                    <input
                      type="checkbox"
                      checked={draft.selected}
                      onChange={event => updateImportDraft(draft.importId, { selected: event.target.checked })}
                    />
                    <span>{draft.selected ? 'Import' : 'Skip'} · {duplicateImportLabel(draft)}</span>
                    <button
                      type="button"
                      onClick={() => updateImportDraft(draft.importId, { selected: !draft.selected })}
                    >
                      {draft.selected ? 'Skip this file' : 'Import this file'}
                    </button>
                  </div>
                  {duplicateImportDetail(draft) && (
                    <div className={`import-duplicate-note ${draft.duplicateKind === 'same-file' ? 'exact' : 'name-only'}`}>
                      {duplicateImportDetail(draft)}
                    </div>
                  )}

                  <div className="import-review-main">
                    {draft.thumbnailData && <img className="import-review-thumb" src={draft.thumbnailData} alt="" />}
                    <div className="import-review-fields">
                      <input
                        value={draft.titleDraft}
                        onChange={event => updateImportDraft(draft.importId, { titleDraft: event.target.value })}
                        aria-label={`Title for ${draft.fileName}`}
                      />
                      <small>{draft.relativePath} · {formatBytes(draft.size)}</small>
                    </div>
                  </div>

                  <label className="import-review-field">
                    Collection
                    <input
                      value={draft.collectionNameDraft}
                      onChange={event => updateImportDraft(draft.importId, { collectionNameDraft: event.target.value })}
                      placeholder="Optional project/collection"
                    />
                  </label>

                  <div className="import-review-tags">
                    <span>Tags</span>
                    <div>
                      {[...new Set([
                        ...draft.tagsDraft,
                        ...(allowNewImportTagSuggestions
                          ? draft.suggestedTags
                          : draft.suggestedTags.filter(tag => allTags.some(existing => existing.toLowerCase() === tag.toLowerCase()))
                        ),
                        ...allTags
                      ])].slice(0, maxVisibleTagSuggestions).map(tag => (
                        <button
                          key={tag}
                          type="button"
                          className={draft.tagsDraft.includes(tag) ? 'active' : ''}
                          onClick={() => toggleImportTag(draft.importId, tag)}
                        >
                          #{tag}
                        </button>
                      ))}
                    </div>
                    {allTags.length + draft.suggestedTags.length > maxVisibleTagSuggestions && (
                      <small className="muted-label">Showing top {maxVisibleTagSuggestions} tag options.</small>
                    )}
                  </div>

                  {(draft.extractedText || draft.thumbnailData) && (
                    <div className="import-review-preview">
                      {draft.extractedText
                        ? <p>{draft.extractedText.slice(0, 260)}{draft.extractedText.length > 260 ? '…' : ''}</p>
                        : <p>Image thumbnail ready. No readable text found.</p>}
                    </div>
                  )}
                </article>
              ))}
              {filteredImportDrafts.length === 0 && (
                <div className="import-review-empty">No files match this filter.</div>
              )}
            </div>

            <div className="import-review-actions">
              <button onClick={closeImportReview} disabled={isImporting}>Cancel</button>
              <button className="primary-action" onClick={commitImportDrafts} disabled={isImporting || isPreparingImport}>
                {isImporting ? 'Importing...' : 'Import Selected'}
              </button>
            </div>
          </section>
        </div>
      )}

      <aside className="sidebar">
        <div className="brand">
          <Archive size={26} />
          <span>Note Vault {appVersion && <small>v{appVersion}</small>}</span>
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
            className={appView === 'dashboard' ? 'active' : ''}
            onClick={() => changeAppView('dashboard')}
          >
            <Archive size={16} /> Dashboard
          </button>

          <button
            className={appView === 'library' ? 'active' : ''}
            onClick={() => changeAppView('library')}
          >
            Library
          </button>

          <button
            className={appView === 'search' ? 'active' : ''}
            onClick={() => changeAppView('search')}
          >
            <Search size={16} /> Search
          </button>

          <button
            className={appView === 'settings' ? 'active' : ''}
            onClick={() => changeAppView('settings')}
          >
            <Settings size={16} /> Settings
          </button>
        </div>

        {appView === 'library' && <div className="side-section">
          <div className="side-label">Library Views</div>

          <button
            className={typeFilter === 'all' ? 'active' : ''}
            onClick={async () => {
              if (!(await confirmSaveDirtyChanges())) return;
              setTypeFilter('all');
              setAppView('library');
            }}
          >
            All Items
          </button>

          <button
            className={typeFilter === 'note' ? 'active' : ''}
            onClick={async () => {
              if (!(await confirmSaveDirtyChanges())) return;
              setTypeFilter('note');
              setAppView('library');
            }}
          >
            <FileText size={16} /> Notes
          </button>

          <button
            className={typeFilter === 'file' ? 'active' : ''}
            onClick={async () => {
              if (!(await confirmSaveDirtyChanges())) return;
              setTypeFilter('file');
              setAppView('library');
            }}
          >
            <FolderOpen size={16} /> Files
          </button>
        </div>}

        {appView === 'library' && <div className="side-section">
          <div className="side-label">Collections</div>
          <div className="collection-sort-row" aria-label="Sort collections">
            {([
              ['name', 'A-Z'],
              ['recent', 'New'],
              ['count', 'Used']
            ] as [CollectionSort, string][]).map(([sort, label]) => (
              <button
                key={sort}
                type="button"
                className={collectionSort === sort ? 'active' : ''}
                onClick={() => setCollectionSort(sort)}
                title={`Sort collections by ${label}`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            className={selectedCollectionId === null ? 'active' : ''}
            onClick={() => selectCollection(null)}
          >
            All Collections
          </button>

          {sortedCollections.map(collection => (
            <button
              key={collection.id}
              className={selectedCollectionId === collection.id ? 'active' : ''}
              onClick={() => selectCollection(collection.id)}
            >
              <FolderOpen size={16} /> {collection.name}
              {collection.count !== undefined && <small>{collection.count}</small>}
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

      <div className="pane-resizer pane-resizer-sidebar" onMouseDown={() => setResizingPane('sidebar')} />
      {appView === 'library' && !isDetailFocus && !isListFocus && <div className="pane-resizer pane-resizer-list" onMouseDown={() => setResizingPane('list')} />}

      {appView === 'dashboard' ? (
        <main className="dashboard-panel">
          <div className="dashboard-header">
            <div>
              <h1>Vault Dashboard</h1>
              <p>Your notes, files, and collections at a glance.</p>
            </div>
            <button className="dashboard-new-note" onClick={createNote} disabled={isCreating}>
              <Plus size={16} /> {isCreating ? 'Creating...' : 'New Note'}
            </button>
          </div>

          <section className="dashboard-cards">
            <button className="dashboard-card" onClick={() => openDashboardLibrary()}>
              <span>All Items</span><strong>{dashboard?.totalItems ?? 0}</strong><small>Everything in your vault</small>
            </button>
            <button className="dashboard-card" onClick={() => openDashboardLibrary('note')}>
              <span>Notes</span><strong>{dashboard?.notes ?? 0}</strong><small>Ideas, plans, and reference notes</small>
            </button>
            <button className="dashboard-card" onClick={() => openDashboardLibrary('file')}>
              <span>Files</span><strong>{dashboard?.files ?? 0}</strong><small>Uploaded documents and assets</small>
            </button>
            <button className="dashboard-card" onClick={() => openDashboardLibrary()}>
              <span>Collections</span><strong>{dashboard?.collections ?? 0}</strong><small>Projects and groupings</small>
            </button>
            <button className="dashboard-card" onClick={() => openSettingsTab('tags')}>
              <span>Tags</span><strong>{dashboard?.tags ?? 0}</strong><small>Ways to find related ideas</small>
            </button>
            <button className="dashboard-card" onClick={() => openDashboardLibrary()}>
              <span>Favorites</span><strong>{dashboard?.favorites ?? 0}</strong><small>Starred items</small>
            </button>
          </section>

          <section className="dashboard-recent">
            <div className="dashboard-section-header">
              <div><h2>Recently updated</h2><p>Pick up where you left off.</p></div>
              <button onClick={() => openDashboardLibrary()}>Open Library</button>
            </div>
            {dashboard?.recentItems.length ? (
              <div className="dashboard-recent-list">
                {dashboard.recentItems.map(item => (
                  <button key={item.id} onClick={() => openDashboardItem(item)}>
                    {item.thumbnail_data ? <img className="item-thumbnail item-thumbnail-small" src={item.thumbnail_data} alt="" /> : item.type === 'note' ? <FileText size={18} /> : <FolderOpen size={18} />}
                    <span><strong>{item.title || 'Untitled note'}</strong><small>{item.type} · Updated {formatDate(item.updated_at)}</small></span>
                  </button>
                ))}
              </div>
            ) : <div className="dashboard-empty">Create a note or upload a file to start building your vault.</div>}
          </section>

          {status && <div className="status-bar">{status}</div>}
        </main>
      ) : appView === 'library' ? (
        <>
          {!isDetailFocus && <section className="list-panel">
            <div className="list-panel-header">
              <div>
                <span className="list-eyebrow">{activeCollection ? 'Collection' : 'Library'}</span>
                <h2>{activeCollection?.name || (typeFilter === 'note' ? 'Notes' : typeFilter === 'file' ? 'Files' : 'All Items')}</h2>
              </div>
              <button type="button" onClick={isListFocus ? showSplitLibrary : focusLibraryList}>
                {isListFocus ? 'Show Detail' : 'Focus'}
              </button>
            </div>

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
              <label className="sort-control">Sort
                <select value={itemSort} onChange={event => setItemSort(event.target.value as ItemSort)}>
                  <option value="updated">Date updated</option>
                  <option value="title">A–Z</option>
                  <option value="tags">Tags</option>
                </select>
              </label>
            </div>

            <div className="view-mode-toggle" aria-label="Library view mode">
              {([
                ['cards', 'Cards'],
                ['compact', 'Compact'],
                ['grid', 'Grid']
              ] as [LibraryViewMode, string][]).map(([mode, label]) => (
                <button
                  type="button"
                  key={mode}
                  className={libraryViewMode === mode ? 'active' : ''}
                  onClick={() => setLibraryViewMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="bulk-toolbar">
              <button onClick={() => {
                setIsSelectingItems(current => !current);
                setSelectedItemIds(new Set());
                setBulkTags(new Set());
                setBulkTagTouched(new Set());
                setBulkCollections(new Set());
                setBulkCollectionTouched(new Set());
                setShowBulkTagPicker(false);
                setShowBulkCollectionPicker(false);
              }}>
                {isSelectingItems ? 'Cancel Select' : 'Select Items'}
              </button>
              {isSelectingItems && <>
                <span>{selectedItemIds.size} selected</span>
                <button
                  onClick={() => {
                    setBulkTags(new Set(bulkTagUsage.keys()));
                    setBulkTagTouched(new Set());
                    setShowBulkTagPicker(true);
                    setShowBulkCollectionPicker(false);
                  }}
                  disabled={selectedItemIds.size === 0 || allTags.length === 0}
                >
                  Edit Tags
                </button>
                <button
                  onClick={() => {
                    setBulkCollections(new Set(bulkCollectionUsage.keys()));
                    setBulkCollectionTouched(new Set());
                    setShowBulkCollectionPicker(true);
                    setShowBulkTagPicker(false);
                  }}
                  disabled={selectedItemIds.size === 0 || collections.length === 0}
                >
                  Edit Collections
                </button>
                <button className="danger" onClick={deleteSelectedItems} disabled={selectedItemIds.size === 0}>Delete</button>
              </>}
            </div>

            {isSelectingItems && showBulkTagPicker && (
              <div className="bulk-action-panel">
                <strong>Edit tags for selected items</strong>
                <div className="bulk-choice-list">
                  {bulkTagChoices.map(tag => <label key={tag}>
                    <input type="checkbox" checked={bulkTags.has(tag)} onChange={() => toggleBulkTag(tag)} />
                    <span>#{tag}</span>
                    {bulkTagUsage.has(tag) && <small>{bulkTagUsage.get(tag)}/{selectedItemIds.size}</small>}
                  </label>)}
                </div>
                <div className="bulk-action-footer">
                  <button onClick={() => setShowBulkTagPicker(false)}>Cancel</button>
                  <button className="primary-action" onClick={applyBulkTags} disabled={bulkTagTouched.size === 0}>
                    Save Tag Changes
                  </button>
                </div>
              </div>
            )}

            {isSelectingItems && showBulkCollectionPicker && (
              <div className="bulk-action-panel">
                <strong>Edit collections for selected items</strong>
                <div className="bulk-choice-list">
                  {collections.map(collection => <label key={collection.id}>
                    <input type="checkbox" checked={bulkCollections.has(collection.id)} onChange={() => toggleBulkCollection(collection.id)} />
                    <span>{collection.name}</span>
                    {bulkCollectionUsage.has(collection.id) && <small>{bulkCollectionUsage.get(collection.id)}/{selectedItemIds.size}</small>}
                  </label>)}
                </div>
                <div className="bulk-action-footer">
                  <button onClick={() => setShowBulkCollectionPicker(false)}>Cancel</button>
                  <button className="primary-action" onClick={applyBulkCollections} disabled={bulkCollectionTouched.size === 0}>
                    Save Collection Changes
                  </button>
                </div>
              </div>
            )}

            <div className={`items-list items-list-${libraryViewMode}`} ref={itemsListRef}>
              {sortedItems.map(item => (
                <div
                  key={item.id}
                  ref={element => {
                    if (element) itemCardRefs.current.set(item.id, element);
                    else itemCardRefs.current.delete(item.id);
                  }}
                  className={`item-card ${selectedId === item.id ? 'selected' : ''} ${selectedItemIds.has(item.id) ? 'bulk-selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  onMouseDown={event => {
                    if (event.ctrlKey || event.metaKey || event.shiftKey) event.preventDefault();
                  }}
                  onClick={event => {
                    selectItemWithModifiers(item.id, event).catch(() => undefined);
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      if (isSelectingItems) toggleItemSelection(item.id);
                      else selectItem(item.id).catch(() => undefined);
                    }
                  }}
                >
                  <div className="item-card-top">
                    {item.thumbnail_data && <img className="item-thumbnail" src={item.thumbnail_data} alt="" />}
                    <span className="item-title">
                      {item.favorite ? '★ ' : ''}
                      {item.title || 'Untitled note'}
                    </span>
                    <span className="item-type">{item.type}</span>
                  </div>

                  <p>{item.private ? '*****' : item.body || item.file_name || 'No notes yet.'}</p>

                  <div className="tag-row">
                    {(item.tags || []).slice(0, 4).map(tag => (
                      <span key={tag}>#{tag}</span>
                    ))}
                  </div>

                  <small>{formatDate(item.updated_at)}</small>
                </div>
              ))}
            </div>
          </section>}

          {!isListFocus && <main className="detail-panel">
            {!selectedId ? (
              <div className="empty-state">
                <Archive size={52} />
                <h2>Your vault is ready</h2>
                <p>
                  Create a note, upload a file, or drag PDFs, images, docs,
                  screenshots, receipts, and reference files into this window.
                </p>
                {isDetailFocus && (
                  <button className="empty-action" onClick={showSplitLibrary}>
                    Show List
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="detail-toolbar">
                  {isDetailFocus ? (
                    <button onClick={showSplitLibrary}>
                      Show List
                    </button>
                  ) : (
                    <button onClick={focusDetailPanel}>
                      Focus
                    </button>
                  )}

                  <button onClick={beginEditing} disabled={isSelectedEditing}>
                    {isSelectedEditing ? 'Editing' : 'Edit'}
                  </button>

                  {isSelectedEditing && <>
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
                  onChange={e => {
                    markDraftTouched();
                    setDraftTitle(e.target.value);
                  }}
                  placeholder="Untitled note"
                  disabled={!isSelectedEditing}
                />

                <div className="meta-line">
                  <span>{selected?.type === 'file' ? selected.file_name : 'Note'}</span>
                  <span>
                    {selected ? `Updated ${formatDate(selected.updated_at)}` : 'New note'}
                  </span>
                  {selected?.favorite && <span>★ Favorite</span>}
                  {selected?.private && <span>Private</span>}
                </div>

                <div className="detail-tabs" role="tablist" aria-label="Item detail tabs">
                  {([
                    ['preview', selected?.type === 'file' ? 'Preview' : 'Overview'],
                    ['notes', 'Notes'],
                    ['relationships', `Relationships${relationships.length ? ` (${relationships.length})` : ''}`],
                    ['info', 'Info']
                  ] as [DetailTab, string][]).map(([tab, label]) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      className={detailTab === tab ? 'active' : ''}
                      onClick={() => setDetailTab(tab)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {detailTab === 'info' && <>
                <label className="private-toggle">
                  <input
                    type="checkbox"
                    checked={draftPrivate}
                    disabled={!isSelectedEditing}
                    onChange={event => {
                      markDraftTouched();
                      setDraftPrivate(event.target.checked);
                    }}
                  />
                  <span>Private — hide this item’s preview text in the library list</span>
                </label>

                </>}

                {detailTab === 'preview' && selected?.type === 'file' && selected.thumbnail_data && (
                  <div className="detail-file-preview">
                    <img src={selected.thumbnail_data} alt={selected.title || selected.file_name || 'File preview'} />
                  </div>
                )}

                {detailTab === 'preview' && selected?.type === 'file' && !selected.thumbnail_data && (
                  <div className="detail-preview-card">
                    <FolderOpen size={34} />
                    <h3>{selected.file_name || 'Uploaded file'}</h3>
                    <p>No image preview is available for this file type.</p>
                  </div>
                )}

                {detailTab === 'preview' && selected?.type === 'file' && (
                  <>
                    <div className="detail-preview-actions">
                      <button onClick={() => window.vaultApi.openFile(selected.id)}>
                        <FolderOpen size={16} /> Open File
                      </button>
                      <button onClick={() => setDetailTab('notes')}>Edit Notes</button>
                      <button onClick={() => setDetailTab('info')}>Edit Info</button>
                    </div>
                    <label className="field-label">Readable file text</label>
                    <pre className="file-text-preview">
                      {selected.extracted_text || 'No readable text was found in this file.'}
                    </pre>
                  </>
                )}

                {detailTab === 'preview' && selected?.type !== 'file' && (
                  <div className="detail-preview-card">
                    <FileText size={34} />
                    <h3>{draftTitle || 'Untitled note'}</h3>
                    <p>{draftBody || 'No note text yet.'}</p>
                  </div>
                )}

                {detailTab === 'info' && <>
                <label className="field-label">Collections</label>
                <div className="collection-picker">
                  {draftCollectionIds.length === 0 ? <span className="muted-label">No collections yet.</span> : collections
                    .filter(collection => draftCollectionIds.includes(collection.id))
                    .map(collection => <span key={collection.id}>{collection.name}</span>)}
                </div>
                {isSelectedEditing && <div className="saved-tags-picker">
                  <span className="muted-label">Add collections</span>
                  {collections.map(collection => {
                    const selectedCollection = draftCollectionIds.includes(collection.id);
                    return <button key={collection.id} type="button" className={selectedCollection ? 'active' : ''} onClick={() => {
                      markDraftTouched();
                      setDraftCollectionIds(current => (
                        selectedCollection ? current.filter(id => id !== collection.id) : [...current, collection.id]
                      ));
                    }}>{collection.name}</button>;
                  })}
                </div>}
                {false && isSelectedEditing && <div className="edit-tags-wrap">
                  <button type="button" className="edit-tags-button" onClick={() => setShowEditCollectionPicker(current => !current)}>
                    Edit Collections <span>▾</span>
                  </button>
                  {showEditCollectionPicker && <div className="edit-tags-panel">
                    <div className="edit-tags-list">
                      {collections.length === 0 ? <span className="muted-label">Create a collection from the sidebar first.</span> : collections.map(collection => (
                        <label key={collection.id}>
                          <input
                            type="checkbox"
                            checked={draftCollectionIds.includes(collection.id)}
                            onChange={() => {
                              markDraftTouched();
                              setDraftCollectionIds(current => current.includes(collection.id)
                                ? current.filter(id => id !== collection.id)
                                : [...current, collection.id]
                              );
                            }}
                          />
                          <span>{collection.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>}
                </div>}
                <div className="muted-label">An item can belong to more than one project.</div>

                {false && <>
                <label className="field-label">Relationships</label>
                <div className="relationships-panel">
                  {relationships.length === 0 ? (
                    <span className="muted-label">No relationships yet.</span>
                  ) : relationships.map(relationship => (
                    <div className="relationship-row" key={relationship.item.id}>
                      <button type="button" onClick={() => {
                        setSelectedId(relationship.item.id);
                        setDetailTab('info');
                      }}>
                        <span>{relationship.item.title || relationship.item.file_name || 'Untitled item'}</span>
                        <small>{relationship.item.type}{relationship.item.collections?.length ? ` · ${relationship.item.collections.map(collection => collection.name).join(', ')}` : ''}</small>
                      </button>
                      {isSelectedEditing && (
                        <button type="button" className="relationship-remove" onClick={() => removeRelationship(relationship.item.id)}>
                          Remove
                        </button>
                      )}
                    </div>
                  ))}

                  {isSelectedEditing && (
                    <div className="relationship-add">
                      <input
                        value={relatedItemSearch}
                        onChange={event => setRelatedItemSearch(event.target.value)}
                        placeholder="Search vault items to relate..."
                      />
                      <div className="relationship-candidates">
                        {relationshipCandidates.length === 0 ? (
                          <span className="muted-label">No available items match.</span>
                        ) : relationshipCandidates.map(item => (
                          <button key={item.id} type="button" onClick={() => addRelationship(item.id)}>
                            <span>{item.title || item.file_name || 'Untitled item'}</span>
                            <small>{item.type}{item.tags?.length ? ` · ${item.tags.slice(0, 3).map(tag => `#${tag}`).join(' ')}` : ''}</small>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                </>}

                <label className="field-label">Tags</label>

                <div className="tag-editor">
                  {tagStringToArray(draftTags).map(tag => (
                    <span className="tag-chip-editable" key={tag}>
                      #{tag}
                      {isSelectedEditing && <button
                        type="button"
                        title={`Remove ${tag}`}
                        onClick={() => {
                          markDraftTouched();
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
                    disabled={!isSelectedEditing}
                    onChange={e => setNewTagText(e.target.value)}
                    placeholder="Add tag, like work or tax"
                    onKeyDown={e => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      const tag = newTagText.trim();
                      if (!tag) return;
                      markDraftTouched();
                      setDraftTags(current => [...new Set([...tagStringToArray(current), tag])].join(', '));
                      setNewTagText('');
                    }}
                  />
                  <button type="button" disabled={!isSelectedEditing} onClick={() => {
                    const tag = newTagText.trim();
                    if (!tag) return;
                    markDraftTouched();
                    setDraftTags(current => [...new Set([...tagStringToArray(current), tag])].join(', '));
                    setNewTagText('');
                  }}>Add Tag</button>
                </div>

                {allTags.length > 0 && <div className="saved-tags-picker">
                  <span className="muted-label">Saved tags</span>
                  {[...new Set([
                    ...tagStringToArray(draftTags),
                    ...allTags.filter(tag => !tagStringToArray(draftTags).includes(tag)).slice(0, maxVisibleTagSuggestions)
                  ])].map(tag => {
                    const selectedTag = tagStringToArray(draftTags).includes(tag);
                    return <button key={tag} type="button" disabled={!isSelectedEditing} className={selectedTag ? 'active' : ''} onClick={() => {
                      markDraftTouched();
                      setDraftTags(current => {
                        const tags = tagStringToArray(current);
                        return (selectedTag ? tags.filter(existing => existing !== tag) : [...tags, tag]).join(', ');
                      });
                    }}>#{tag}</button>;
                  })}
                  {allTags.length > maxVisibleTagSuggestions && (
                    <span className="muted-label">Showing top {maxVisibleTagSuggestions}. Manage tags in Settings.</span>
                  )}
                </div>}
                </>}

                {detailTab === 'relationships' && <>
                <div className="relationships-header">
                  <div>
                    <h3>Related items</h3>
                    <p>Connect notes, files, references, drafts, assets, or project material inside the local vault.</p>
                  </div>
                </div>
                <div className="relationships-panel">
                  {relationships.length === 0 ? (
                    <div className="detail-preview-card">
                      <FolderOpen size={34} />
                      <h3>No relationships yet</h3>
                      <p>Click Edit, then search for another vault item to connect it here.</p>
                    </div>
                  ) : relationships.map(relationship => (
                    <div className="relationship-row" key={relationship.item.id}>
                      <button type="button" onClick={() => {
                        setSelectedId(relationship.item.id);
                        setDetailTab('relationships');
                      }}>
                        <span>{relationship.item.title || relationship.item.file_name || 'Untitled item'}</span>
                        <small>{relationship.item.type}{relationship.item.collections?.length ? ` · ${relationship.item.collections.map(collection => collection.name).join(', ')}` : ''}</small>
                      </button>
                      {isSelectedEditing && (
                        <button type="button" className="relationship-remove" onClick={() => removeRelationship(relationship.item.id)}>
                          Remove
                        </button>
                      )}
                    </div>
                  ))}

                  {isSelectedEditing && (
                    <div className="relationship-add">
                      <label className="field-label">Add relationship</label>
                      <input
                        value={relatedItemSearch}
                        onChange={event => setRelatedItemSearch(event.target.value)}
                        placeholder="Search vault items to relate..."
                      />
                      <div className="relationship-candidates">
                        {relationshipCandidates.length === 0 ? (
                          <span className="muted-label">No available items match.</span>
                        ) : relationshipCandidates.map(item => (
                          <button key={item.id} type="button" onClick={() => addRelationship(item.id)}>
                            <span>{item.title || item.file_name || 'Untitled item'}</span>
                            <small>{item.type}{item.tags?.length ? ` · ${item.tags.slice(0, 3).map(tag => `#${tag}`).join(' ')}` : ''}</small>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                </>}

                {detailTab === 'notes' && <>
                <label className="field-label">Notes</label>

                <div className="rich-editor-toolbar" aria-label="Note formatting tools">
                  <button type="button" disabled={!isSelectedEditing} onClick={() => insertMarkdown('**', '**', 'bold text')}>Bold</button>
                  <button type="button" disabled={!isSelectedEditing} onClick={() => insertMarkdown('_', '_', 'italic text')}>Italic</button>
                  <button type="button" disabled={!isSelectedEditing} onClick={() => insertBlock('## Heading', 3)}>Heading</button>
                  <button type="button" disabled={!isSelectedEditing} onClick={() => insertBlock('- [ ] Task', 6)}>Todo</button>
                  <button type="button" disabled={!isSelectedEditing} onClick={() => insertBlock('```\ncode\n```', 4)}>Code</button>
                  <button type="button" disabled={!isSelectedEditing} onClick={() => insertBlock('---')}>Divider</button>
                  <span className="editor-mode-toggle">
                    {([
                      ['edit', 'Edit'],
                      ['preview', 'Preview'],
                      ['split', 'Split']
                    ] as [NoteEditorMode, string][]).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        className={noteEditorMode === mode ? 'active' : ''}
                        onClick={() => setNoteEditorMode(mode)}
                      >
                        {label}
                      </button>
                    ))}
                  </span>
                </div>

                <div className={`rich-editor-wrap rich-editor-${noteEditorMode}`}>
                  {isSelectedEditing && slashQuery && (
                    <div className="slash-command-menu">
                      {slashCommands
                        .filter(command => command.id.startsWith(slashQuery))
                        .slice(0, 5)
                        .map(command => (
                          <button key={command.id} type="button" onMouseDown={event => {
                            event.preventDefault();
                            runSlashCommand(command);
                          }}>
                            <strong>{command.label}</strong>
                            <span>{command.hint}</span>
                          </button>
                        ))}
                    </div>
                  )}

                  {noteEditorMode !== 'preview' && (
                    <textarea
                      ref={noteEditorRef}
                      className="body-editor"
                      value={draftBody}
                      onChange={e => {
                        markDraftTouched();
                        setDraftBody(e.target.value);
                        updateSlashQuery(e.target.value, e.target.selectionStart);
                      }}
                      onKeyDown={handleNoteKeyDown}
                      onClick={event => updateSlashQuery(draftBody, event.currentTarget.selectionStart)}
                      onKeyUp={event => updateSlashQuery(draftBody, event.currentTarget.selectionStart)}
                      disabled={!isSelectedEditing}
                      placeholder="Type notes, markdown, code blocks, links, reminders, or try /h1, /todo, /code, /divider..."
                    />
                  )}

                  {noteEditorMode !== 'edit' && (
                    <MarkdownPreview value={draftBody} />
                  )}
                </div>
                {selected?.type === 'file' && (
                  <p className="muted-label">
                    These are your notes about the file. The file's extracted text lives under Preview.
                  </p>
                )}
                </>}

              </>
            )}

            {status && <div className="status-bar">{status}</div>}
          </main>}
        </>
      ) : appView === 'search' ? (
        <main className="search-panel">
          <div className="search-workspace-header">
            <div>
              <h1>Search Vault</h1>
              <p>
                Search by note text, file name, tags, projects, people, tasks, or reference notes.
              </p>
            </div>

            <button onClick={clearFullSearch}>Clear Search</button>
          </div>

          <div className="full-search-box" onMouseDown={() => searchInputRef.current?.focus()}>
            <Search size={22} />
            <input
              ref={searchInputRef}
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              onMouseDown={event => event.stopPropagation()}
              placeholder="Search tasks, projects, people, notes, files..."
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
      ? searchUntaggedOnly ? 'Not Tagged' : 'All Tags'
      : `${searchTags.length} tag${searchTags.length === 1 ? '' : 's'} selected`}
    <span>▾</span>
  </button>

  {showSearchTagDropdown && (
    <div className="search-tag-dropdown-panel">
      <button
        type="button"
        className="tag-clear-button"
        onClick={() => {
          setSearchTags([]);
          setSearchUntaggedOnly(false);
        }}
      >
        Clear tag filters
      </button>

      <label className="search-tag-checkbox-row">
        <input
          type="checkbox"
          checked={searchUntaggedOnly}
          onChange={event => {
            setSearchUntaggedOnly(event.target.checked);
            if (event.target.checked) setSearchTags([]);
          }}
        />
        <span>All not tagged</span>
      </label>

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

            {(searchText || searchTags.length > 0 || searchUntaggedOnly || searchType !== 'all') && (
              <small>
    {searchText && <>Text: “{searchText}” </>}
                {searchTags.length > 0 && (
                  <>Tags: {searchTags.map(tag => `#${tag}`).join(', ')} </>
                )}
                {searchUntaggedOnly && <>Tags: all not tagged </>}
                {searchType !== 'all' && <>Type: {searchType}</>}
              </small>
            )}
          </div>

          <div className="view-mode-toggle search-view-toggle" aria-label="Search view mode">
            {([
              ['cards', 'Cards'],
              ['grid', 'Grid']
            ] as [SearchViewMode, string][]).map(([mode, label]) => (
              <button
                type="button"
                key={mode}
                className={searchViewMode === mode ? 'active' : ''}
                onClick={() => setSearchViewMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={`search-results-grid search-results-${searchViewMode}`}>
            {searchResults.length === 0 ? (
              <div className="empty-state search-empty">
                <Search size={48} />
                <h2>No results yet</h2>
                <p>
                  Try searching a topic, tag, project, person, task, note, or uploaded file name.
                </p>
              </div>
            ) : (
              searchResults.map(item => (
                <button
                  key={item.id}
                  className={`search-result-card ${searchViewMode === 'grid' ? 'search-result-image-card' : ''}`}
                  aria-label={`Open ${item.title || item.file_name || item.type}`}
                  onClick={() => openSearchResult(item)}
                >
                  {searchViewMode === 'grid' ? (
                    item.thumbnail_data ? (
                      <img className="search-result-grid-image" src={item.thumbnail_data} alt="" />
                    ) : (
                      <span className="search-result-grid-placeholder">
                        {item.type === 'note' ? <FileText size={34} /> : <FolderOpen size={34} />}
                      </span>
                    )
                  ) : (
                    <>
                      <div className="item-card-top">
                        {item.thumbnail_data && <img className="item-thumbnail" src={item.thumbnail_data} alt="" />}
                        <span className="item-title">
                          {item.favorite ? '★ ' : ''}
                          <HighlightedText text={item.title || 'Untitled note'} query={searchText} />
                        </span>
                        <span className="item-type">{item.type}</span>
                      </div>

                      <p className="search-snippet">
                        {item.private ? '*****' : <>
                          {searchSnippets.get(item.id) && <strong>{searchSnippets.get(item.id)?.label}: </strong>}
                          <HighlightedText text={searchSnippets.get(item.id)?.text || item.body || item.file_name || 'No notes yet.'} query={searchText} />
                        </>}
                      </p>

                      <div className="tag-row">
                        {(item.tags || []).slice(0, 8).map(tag => (
                          <span key={tag}>#<HighlightedText text={tag} query={searchText} /></span>
                        ))}
                      </div>

                      <small>{formatDate(item.updated_at)}</small>
                    </>
                  )}
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
                {searchPreviewItem.thumbnail_data && (
                  <img className="search-preview-image" src={searchPreviewItem.thumbnail_data} alt={searchPreviewItem.title || 'Preview'} />
                )}
                <div className="search-preview-meta">
                  {searchPreviewItem.file_name && <span>{searchPreviewItem.file_name}</span>}
                  {searchPreviewItem.file_ext && <span>{searchPreviewItem.file_ext.toUpperCase().replace('.', '')}</span>}
                </div>
                <section className="search-preview-section">
                  <h3>{searchPreviewItem.type === 'file' ? 'Notes / imported content' : 'Note'}</h3>
                  <pre className="search-preview-content">
                    <HighlightedText text={searchPreviewItem.body || 'No notes yet.'} query={searchText} />
                  </pre>
                </section>
                {searchPreviewItem.type === 'file' && (
                  <section className="search-preview-section">
                    <h3>Readable file text</h3>
                    <pre className="search-preview-content">
                      <HighlightedText text={searchPreviewItem.extracted_text || 'No readable text was found in this file.'} query={searchText} />
                    </pre>
                  </section>
                )}
                <div className="search-preview-actions">
                  {searchPreviewItem.type === 'file' && (
                    <button onClick={() => window.vaultApi.openFile(searchPreviewItem.id)}>
                      Open File
                    </button>
                  )}
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
        <main className={`search-panel settings-panel settings-tab-${settingsTab}`}>
          <div className="search-workspace-header">
            <div>
              <h1>Settings</h1>
              <p>Backup, maintenance, appearance, and updates—kept in one tidy place.</p>
            </div>
          </div>

          <div className="settings-tabs">
            {([
              ['general', 'General'],
              ['watch', `Watched Folders (${watchedFolders.length})`],
              ['tags', `Tags (${settingsTagRecords.length})`],
              ['logs', 'Logs']
            ] as [SettingsTab, string][]).map(([tab, label]) => (
              <button
                key={tab}
                className={settingsTab === tab ? 'active' : ''}
                onClick={() => setSettingsTab(tab)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="settings-grid">
          <section className="settings-section settings-compact">
            <h2>Appearance</h2>
            <p>Use a darker palette that is easier on the eyes during long writing or organizing sessions.</p>
            <label className="theme-toggle">
              <input type="checkbox" checked={isDarkMode} onChange={event => setIsDarkMode(event.target.checked)} />
              <span>Dark Mode</span>
            </label>
          </section>

          <section className="settings-section settings-compact">
            <h2>Import Suggestions</h2>
            <p>
              Control whether import review can create brand-new tag suggestions from file and folder
              names, or only recommend tags you already saved.
            </p>
            <label className="theme-toggle">
              <input
                type="checkbox"
                checked={allowNewImportTagSuggestions}
                onChange={event => changeImportTagSuggestionMode(event.target.checked)}
              />
              <span>Suggest new tags during import</span>
            </label>
            <p className="settings-note">
              Off means import review only surfaces existing saved tags. You can still manually add tags.
            </p>
          </section>

          <section className="settings-section settings-backup">
            <h2>Backup & Export</h2>
            <p>
              Export creates a normal ZIP with Markdown notes, your original files, and an
              <code> index.html </code> page. You can open it without Note Vault.
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
              <label htmlFor="backup-retention">Automatic backups to keep</label>
              <input
                id="backup-retention"
                type="number"
                min={1}
                max={200}
                value={backupRetentionCount}
                onChange={event => setBackupRetentionCount(Math.max(1, Math.min(200, Number(event.target.value) || 1)))}
                onBlur={event => changeBackupRetentionCount(Number(event.target.value))}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    changeBackupRetentionCount(Number(event.currentTarget.value));
                  }
                }}
              />
              <p className="settings-warning">
                Heads up: backups can use a lot of disk space, especially when large files create
                matching <code> -large-files </code> folders. Note Vault keeps the newest automatic
                backups and removes older automatic backups beyond this number.
              </p>
              <small className="backup-stats">
                {backupStats
                  ? `${backupStats.count} automatic backup${backupStats.count === 1 ? '' : 's'} using about ${formatBytes(backupStats.totalBytes)}.`
                  : 'Backup usage is loading…'}
              </small>
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
              Note Vault checks GitHub Releases when it opens. When a newer version is available,
              you can open its download page, skip that version, or decide later.
            </p>
            <div className="settings-actions">
              <button onClick={checkForUpdates}>Check for Updates</button>
            </div>
          </section>

          <section className="settings-section settings-watch-manager">
            <h2>Watched Folders</h2>
            <p>
              Use local folders like an import inbox. Note Vault scans when a folder is first added,
              then watches for new files to review. Imported files are copied into the vault, so you can
              clean up the original folder afterward.
            </p>
            <div className="settings-actions">
              <button onClick={addWatchedFolder}>
                <FolderOpen size={16} /> Add Watched Folder
              </button>
              <button onClick={() => scanWatchedFolders(false)}>
                Scan All Watched Folders
              </button>
            </div>

            <div className="watched-folder-list">
              {watchedFolders.length === 0 ? (
                <div className="watched-folder-empty">
                  No watched folders yet. Add Downloads, Documents, Screenshots, or a project folder to start.
                </div>
              ) : watchedFolders.map(folder => (
                <div key={folder.id} className="watched-folder-row">
                  <div>
                    <strong>{folder.path}</strong>
                    <small>
                      {folder.seenCount} handled file{folder.seenCount === 1 ? '' : 's'}
                      {folder.lastScanAt ? ` · Last scan ${formatDate(folder.lastScanAt)}` : ' · Not scanned yet'}
                    </small>
                  </div>
                  <button onClick={() => scanWatchedFolders(false, folder.id)}>Scan</button>
                  <button className="danger" onClick={() => removeWatchedFolder(folder.id)}>Remove</button>
                </div>
              ))}
            </div>
          </section>

          <section className="settings-section settings-logs">
            <h2>Logs</h2>
            <p>Use this when something weird happens and you want to see recent app startup or error details.</p>
            <div className="settings-actions">
              <button onClick={refreshLogs}>Refresh Logs</button>
              <button onClick={openLogsFolder}>
                <FolderOpen size={16} /> Open Logs Folder
              </button>
            </div>
            {logPath && <code className="backup-path">{logPath}</code>}
            <pre className="settings-log-output">{logText || 'No logs loaded yet.'}</pre>
          </section>

          <section className="settings-section settings-tags-manager">
            <h2>Tags</h2>
            <p>Add, rename, or delete saved tags. Deleting a tag removes it from every item.</p>
            <div className="tag-manager-add">
              <input
                value={settingsTagText}
                onChange={event => setSettingsTagText(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    createSettingsTag();
                  }
                }}
                placeholder="New tag name"
              />
              <button onClick={createSettingsTag}>Add Tag</button>
            </div>
            <div className="tag-manager-bulk">
              <button
                type="button"
                onClick={() => setSelectedSettingsTags(new Set(settingsTagRecords.map(tag => tag.name)))}
                disabled={settingsTagRecords.length === 0}
              >
                Select All
              </button>
              <button
                type="button"
                onClick={() => setSelectedSettingsTags(new Set())}
                disabled={selectedSettingsTags.size === 0}
              >
                Clear
              </button>
              <button
                type="button"
                className="danger"
                onClick={deleteSelectedSettingsTags}
                disabled={selectedSettingsTags.size === 0}
              >
                Delete Selected{selectedSettingsTags.size > 0 ? ` (${selectedSettingsTags.size})` : ''}
              </button>
            </div>
            <div className="tag-manager-list">
              {settingsTagRecords.length === 0 ? (
                <span className="muted-label">No tags yet.</span>
              ) : settingsTagRecords.map(tag => (
                <div key={tag.name} className="tag-manager-row">
                  {renamingTag === tag.name ? (
                    <>
                      <span className="tag-manager-select-spacer" />
                      <input
                        value={renameTagText}
                        onChange={event => setRenameTagText(event.target.value)}
                        onKeyDown={event => {
                          if (event.key === 'Enter') saveRenamedTag(tag.name);
                          if (event.key === 'Escape') {
                            setRenamingTag('');
                            setRenameTagText('');
                          }
                        }}
                        autoFocus
                      />
                      <button onClick={() => saveRenamedTag(tag.name)}>Save</button>
                      <button onClick={() => {
                        setRenamingTag('');
                        setRenameTagText('');
                      }}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <label className="tag-manager-select" title={`Select ${tag.name}`}>
                        <input
                          type="checkbox"
                          checked={selectedSettingsTags.has(tag.name)}
                          onChange={() => toggleSettingsTagSelection(tag.name)}
                        />
                      </label>
                      <span className="tag-manager-name">#{tag.name}</span>
                      <button
                        type="button"
                        className="tag-manager-count"
                        onClick={() => openSearchForTag(tag.name)}
                        title={`Search items tagged ${tag.name}`}
                      >
                        {tag.count || 0} assigned
                      </button>
                      <button onClick={() => {
                        setRenamingTag(tag.name);
                        setRenameTagText(tag.name);
                      }}>Edit</button>
                      <button className="danger" onClick={() => deleteSettingsTag(tag.name)}>Delete</button>
                    </>
                  )}
                </div>
              ))}
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
