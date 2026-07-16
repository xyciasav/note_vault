import React, { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import LinkExtension from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import {
  Archive,
  FileText,
  FolderOpen,
  Image,
  Plus,
  Search,
  Star,
  Upload,
  Download,
  RotateCcw,
  RotateCw,
  Maximize2,
  Trash2,
  Save,
  Settings,
  Eye,
  EyeOff
} from 'lucide-react';
import './styles/app.css';
import type { BackupStats, ImportPreview, ImportProgress, LicenseStatus, VaultItem, VaultMemory, VaultMemoryDetail, VaultMemorySuggestion, VaultRelationship, WatchedFolder, WatchedFolderFile } from './vaultApi';
import type { VaultRelationshipSummary } from './vaultApi';

type TypeFilter = 'all' | 'note' | 'file';
type LibraryContentFilter = 'all' | 'notes' | 'documents' | 'media' | 'audio';
type ItemSort = 'updated' | 'created' | 'title' | 'tags';
type CollectionSort = 'name' | 'recent' | 'count';
type AppView = 'dashboard' | 'mode' | 'notes' | 'collections' | 'relationships' | 'memories' | 'locations' | 'library' | 'search' | 'settings';
type WorkspaceMode = 'note' | 'photo' | 'music';
type TopNavMode = 'dashboard' | WorkspaceMode | 'settings';
type PhotoWorkspaceView = 'library' | 'search';
type PhotoMediaFilter = 'media' | 'image' | 'video';
type BackupFrequency = 'on-close' | 'daily' | 'weekly' | 'never';
type ImportFilter = 'all' | 'ready' | 'duplicates' | 'name-conflicts' | 'images' | 'pdfs';
type SettingsTab = 'general' | 'license' | 'watch' | 'tags' | 'logs';
type SearchViewMode = 'cards' | 'grid';
type SearchSort = 'created' | 'updated' | 'title';
type LibraryViewMode = 'cards' | 'compact' | 'grid';
type DetailTab = 'preview' | 'notes' | 'info';
type NoteEditorMode = 'edit' | 'preview' | 'split';
type ImportIntent = 'auto' | 'note' | 'photo' | 'music';
type VaultCollection = { id: string; name: string; mode?: string; parent_id?: string; created_at?: string; count?: number; child_count?: number; note_count?: number; image_count?: number; video_count?: number; audio_count?: number; document_count?: number };
type OnboardingStep = 'welcome' | 'navigation' | 'connect' | 'start';
type OnboardingStartChoice = 'manual' | 'wizard';
type OnboardingImportChoice = 'files' | 'folder' | 'google' | 'icloud' | 'onenote' | 'notion' | 'later';
type ImportWizardScope = 'journal' | 'photo' | null;
type LocationSummary = {
  location: string;
  latitude?: number;
  longitude?: number;
  count: number;
  examples: { id: string; title: string; fileName?: string | null }[];
};
type MapTile = {
  z: number;
  x: number;
  y: number;
  left: number;
  top: number;
  key: string;
};

type SlashCommand = {
  id: string;
  label: string;
  hint: string;
  insert: string;
  selectOffset?: number;
};

const maxVisibleTagSuggestions = 18;
const libraryPageSize = 250;
const searchPageSize = 250;
const photoPageSize = 96;
const memoryCanvasBaseWidth = 2400;
const memoryCanvasBaseHeight = 1600;
const memoryScrapbookPalette = [
  { name: 'Claret', value: '#b91c1c' },
  { name: 'Copper', value: '#c2410c' },
  { name: 'Honey', value: '#f5d48a' },
  { name: 'Moss', value: '#4d7c0f' },
  { name: 'Sea', value: '#0f766e' },
  { name: 'Denim', value: '#2563eb' },
  { name: 'Plum', value: '#7e22ce' },
  { name: 'Ink', value: '#1f2937' }
];
const onboardingSteps: OnboardingStep[] = ['welcome', 'navigation', 'connect', 'start'];
const imagePreviewExts = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg']);
const videoPreviewExts = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv']);
const audioPreviewExts = new Set(['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.oga', '.opus', '.wma', '.aiff', '.aif']);
const noteImportExts = new Set([
  '.md', '.markdown', '.txt', '.rtf', '.pdf', '.doc', '.docx', '.odt',
  '.csv', '.tsv', '.xls', '.xlsx', '.ppt', '.pptx', '.json', '.xml',
  '.html', '.htm', '.css', '.js', '.ts', '.tsx', '.jsx', '.py', '.ps1',
  '.sh', '.bat', '.ini', '.yml', '.yaml', '.log'
]);

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

function toDateTimeLocal(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function isImageItem(item: VaultItem | null) {
  return Boolean(item?.file_ext && imagePreviewExts.has(item.file_ext.toLowerCase()));
}

function isVideoItem(item: VaultItem | null) {
  return Boolean(item?.file_ext && videoPreviewExts.has(item.file_ext.toLowerCase()));
}

function isAudioItem(item: VaultItem | null) {
  return Boolean(item?.file_ext && audioPreviewExts.has(item.file_ext.toLowerCase()));
}

function importFileExt(file: { sourcePath: string; relativePath?: string; fileName?: string; fileExt?: string }) {
  const existing = file.fileExt || '';
  if (existing) return existing.startsWith('.') ? existing.toLowerCase() : `.${existing.toLowerCase()}`;
  const name = file.fileName || file.relativePath || file.sourcePath || '';
  const cleanName = name.split(/[\\/]/).pop() || name;
  const dotIndex = cleanName.lastIndexOf('.');
  return dotIndex >= 0 ? cleanName.slice(dotIndex).toLowerCase() : '';
}

function classifyImportIntent(file: { sourcePath: string; relativePath?: string; fileName?: string; fileExt?: string }): ImportIntent {
  const ext = importFileExt(file);
  if (imagePreviewExts.has(ext) || videoPreviewExts.has(ext)) return 'photo';
  if (audioPreviewExts.has(ext)) return 'music';
  return 'note';
}

function importIntentAcceptsFile(intent: ImportIntent, file: { sourcePath: string; relativePath?: string; fileName?: string; fileExt?: string }) {
  if (intent === 'auto') return true;
  return classifyImportIntent(file) === intent;
}

function classificationTagsForImport(file: { sourcePath: string; relativePath?: string; fileName?: string; fileExt?: string }) {
  const ext = importFileExt(file);
  if (imagePreviewExts.has(ext)) return ['photo', 'image'];
  if (videoPreviewExts.has(ext)) return ['photo', 'video'];
  if (audioPreviewExts.has(ext)) return ['music', 'audio'];
  if (noteImportExts.has(ext)) return ['notes', 'file'];
  return ['file'];
}

function importIntentLabel(intent: ImportIntent) {
  if (intent === 'photo') return 'photo/video';
  if (intent === 'music') return 'audio';
  if (intent === 'note') return 'note/file';
  return 'vault';
}

function imageRotationStyle(item: VaultItem | null): React.CSSProperties | undefined {
  return isImageItem(item) && item?.image_rotation
    ? { transform: `rotate(${item.image_rotation}deg)` }
    : undefined;
}

function fileMetadataText(item: VaultItem | null) {
  if (!item) return '';
  return [item.body, item.extracted_text]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join('\n\n');
}

function previewNotesText(item: VaultItem | null) {
  if (!item) return '';
  return item.type === 'file' ? (item.body || '') : (item.body || '');
}

function previewReadableText(item: VaultItem | null) {
  if (!item || item.type !== 'file') return '';
  return item.extracted_text || '';
}

const slashCommands: SlashCommand[] = [
  { id: 'h1', label: '/h1 Heading 1', hint: 'Large heading', insert: '# Heading', selectOffset: 2 },
  { id: 'h2', label: '/h2 Heading 2', hint: 'Section heading', insert: '## Heading', selectOffset: 3 },
  { id: 'h3', label: '/h3 Heading 3', hint: 'Small heading', insert: '### Heading', selectOffset: 4 },
  { id: 'bullet', label: '/bullet Bullet list', hint: 'List item', insert: '- List item', selectOffset: 2 },
  { id: 'todo', label: '/todo Checklist', hint: 'Task checkbox', insert: '- [ ] Task', selectOffset: 6 },
  { id: 'quote', label: '/quote Quote', hint: 'Block quote', insert: '> Quote', selectOffset: 2 },
  { id: 'code', label: '/code Code block', hint: 'Fenced code block', insert: '```\ncode\n```', selectOffset: 4 },
  { id: 'divider', label: '/divider Divider', hint: 'Horizontal rule', insert: '---' }
];

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function markdownishToEditorHtml(value: string) {
  if (!value.trim()) return '';
  return value.split(/\n{2,}/).map(block => {
    const lines = block.split('\n');
    const first = lines[0] || '';
    if (first.startsWith('# ')) return `<h1>${escapeHtml(first.slice(2))}</h1>`;
    if (first.startsWith('## ')) return `<h2>${escapeHtml(first.slice(3))}</h2>`;
    if (first.startsWith('### ')) return `<h3>${escapeHtml(first.slice(4))}</h3>`;
    if (first.trim() === '---') return '<hr />';
    if (first.startsWith('> ')) return `<blockquote><p>${escapeHtml(lines.map(line => line.replace(/^> ?/, '')).join('\n'))}</p></blockquote>`;
    if (lines.every(line => /^- \[[ xX]\] /.test(line))) {
      return `<ul data-type="taskList">${lines.map(line => `<li data-type="taskItem" data-checked="${line.slice(3, 4).toLowerCase() === 'x'}"><label><input type="checkbox"${line.slice(3, 4).toLowerCase() === 'x' ? ' checked="checked"' : ''}><span></span></label><div><p>${escapeHtml(line.slice(6))}</p></div></li>`).join('')}</ul>`;
    }
    if (lines.every(line => /^- /.test(line))) {
      return `<ul>${lines.map(line => `<li><p>${escapeHtml(line.slice(2))}</p></li>`).join('')}</ul>`;
    }
    return `<p>${lines.map(escapeHtml).join('<br>')}</p>`;
  }).join('');
}

function textFromRichNode(node: any): string {
  if (!node) return '';
  if (node.type === 'text') {
    let text = node.text || '';
    (node.marks || []).forEach((mark: any) => {
      if (mark.type === 'bold') text = `**${text}**`;
      if (mark.type === 'italic') text = `_${text}_`;
      if (mark.type === 'code') text = `\`${text}\``;
      if (mark.type === 'link') text = `[${text}](${mark.attrs?.href || ''})`;
    });
    return text;
  }
  return (node.content || []).map(textFromRichNode).join('');
}

function richDocToMarkdownish(doc: any): string {
  return (doc?.content || []).map((node: any) => {
    if (node.type === 'paragraph') return textFromRichNode(node);
    if (node.type === 'heading') return `${'#'.repeat(node.attrs?.level || 1)} ${textFromRichNode(node)}`;
    if (node.type === 'blockquote') return textFromRichNode(node).split('\n').map(line => `> ${line}`).join('\n');
    if (node.type === 'codeBlock') return `\`\`\`\n${textFromRichNode(node)}\n\`\`\``;
    if (node.type === 'horizontalRule') return '---';
    if (node.type === 'bulletList') return (node.content || []).map((item: any) => `- ${textFromRichNode(item)}`).join('\n');
    if (node.type === 'orderedList') return (node.content || []).map((item: any, index: number) => `${index + 1}. ${textFromRichNode(item)}`).join('\n');
    if (node.type === 'taskList') return (node.content || []).map((item: any) => `- [${item.attrs?.checked ? 'x' : ' '}] ${textFromRichNode(item)}`).join('\n');
    return textFromRichNode(node);
  }).filter((block: string) => block.trim().length > 0).join('\n\n');
}

function RichNoteEditor({
  value,
  onChange,
  placeholder = 'Start writing... Type / for blocks.',
  editable = true
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  editable?: boolean;
}) {
  const [slashQuery, setSlashQuery] = useState('');
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const slashQueryRef = useRef('');
  const showSlashMenuRef = useRef(false);
  const slashSelectedIndexRef = useRef(0);

  function currentSlashMatch(editorInstance: any) {
    const { from } = editorInstance.state.selection;
    const textBefore = editorInstance.state.doc.textBetween(Math.max(0, from - 40), from, '\n', '\n');
    return textBefore.match(/\/([a-z0-9-]*)$/i);
  }

  function updateRichSlashQuery(editorInstance: any) {
    const match = currentSlashMatch(editorInstance);
    const nextQuery = match ? match[1].toLowerCase() : '';
    slashQueryRef.current = nextQuery;
    showSlashMenuRef.current = Boolean(match);
    slashSelectedIndexRef.current = 0;
    setSlashQuery(nextQuery);
    setShowSlashMenu(Boolean(match));
    setSlashSelectedIndex(0);
    return nextQuery;
  }

  function runRichCommand(editorInstance: any, commandId: string, queryOverride?: string) {
    const query = queryOverride ?? slashQueryRef.current;
    const chain = editorInstance.chain().focus();
    if (query || currentSlashMatch(editorInstance)) {
      const { from } = editorInstance.state.selection;
      chain.deleteRange({ from: Math.max(0, from - query.length - 1), to: from });
    }
    if (commandId === 'h1') chain.toggleHeading({ level: 1 }).run();
    else if (commandId === 'h2') chain.toggleHeading({ level: 2 }).run();
    else if (commandId === 'h3') chain.toggleHeading({ level: 3 }).run();
    else if (commandId === 'todo') chain.toggleTaskList().run();
    else if (commandId === 'quote') chain.toggleBlockquote().run();
    else if (commandId === 'code') chain.toggleCodeBlock().run();
    else if (commandId === 'divider') chain.setHorizontalRule().run();
    else if (commandId === 'bullet') chain.toggleBulletList().run();
    slashQueryRef.current = '';
    showSlashMenuRef.current = false;
    slashSelectedIndexRef.current = 0;
    setSlashQuery('');
    setShowSlashMenu(false);
    setSlashSelectedIndex(0);
  }

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({ link: false }),
      LinkExtension.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder })
    ],
    content: markdownishToEditorHtml(value),
    editorProps: {
      attributes: { class: 'tiptap-editor-surface' },
      handleKeyDown: (_view, event) => {
        if (showSlashMenuRef.current && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          const matches = slashCommands.filter(command => command.id.startsWith(slashQueryRef.current)).slice(0, 6);
          if (!matches.length) return false;
          event.preventDefault();
          const nextIndex = event.key === 'ArrowDown'
            ? (slashSelectedIndexRef.current + 1) % matches.length
            : (slashSelectedIndexRef.current - 1 + matches.length) % matches.length;
          slashSelectedIndexRef.current = nextIndex;
          setSlashSelectedIndex(nextIndex);
          return true;
        }
        if (event.key === 'Tab' && editor?.isActive('listItem')) {
          event.preventDefault();
          if (event.shiftKey) editor.chain().focus().liftListItem('listItem').run();
          else editor.chain().focus().sinkListItem('listItem').run();
          return true;
        }
        if (event.key === 'Tab' && editor?.isActive('taskItem')) {
          event.preventDefault();
          if (event.shiftKey) editor.chain().focus().liftListItem('taskItem').run();
          else editor.chain().focus().sinkListItem('taskItem').run();
          return true;
        }
        if (event.key === 'Tab' && !showSlashMenuRef.current) {
          event.preventDefault();
          editor?.chain().focus().insertContent('  ').run();
          return true;
        }
        if ((event.key !== 'Tab' && event.key !== 'Enter') || !showSlashMenuRef.current) return false;
        const matches = slashCommands.filter(command => command.id.startsWith(slashQueryRef.current)).slice(0, 6);
        if (!matches.length) return false;
        event.preventDefault();
        if (editor) runRichCommand(editor, matches[Math.min(slashSelectedIndexRef.current, matches.length - 1)].id, slashQueryRef.current);
        return true;
      }
    },
    onUpdate: ({ editor }) => {
      onChange(richDocToMarkdownish(editor.getJSON()));
      updateRichSlashQuery(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      updateRichSlashQuery(editor);
    }
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const current = richDocToMarkdownish(editor.getJSON());
    if (current !== value) {
      editor.commands.setContent(markdownishToEditorHtml(value), { emitUpdate: false });
    }
  }, [editor, value]);

  function runBlockCommand(commandId: string) {
    if (!editor) return;
    runRichCommand(editor, commandId, slashQuery);
  }

  function setLink() {
    if (!editor) return;
    const href = window.prompt('Paste the URL');
    if (!href?.trim()) return;
    editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
  }

  const commandMatches = slashCommands.filter(command => command.id.startsWith(slashQuery)).slice(0, 6);

  return (
    <div className="tiptap-editor-wrap">
      <div className="rich-editor-toolbar tiptap-toolbar">
        <button type="button" disabled={!editable} className={editor?.isActive('bold') ? 'active' : ''} onClick={() => editor?.chain().focus().toggleBold().run()}>Bold</button>
        <button type="button" disabled={!editable} className={editor?.isActive('italic') ? 'active' : ''} onClick={() => editor?.chain().focus().toggleItalic().run()}>Italic</button>
        <button type="button" disabled={!editable} className={editor?.isActive('code') ? 'active' : ''} onClick={() => editor?.chain().focus().toggleCode().run()}>Code</button>
        <button type="button" disabled={!editable} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>H1</button>
        <button type="button" disabled={!editable} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
        <button type="button" disabled={!editable} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>H3</button>
        <button type="button" disabled={!editable} onClick={() => editor?.chain().focus().toggleBulletList().run()}>List</button>
        <button type="button" disabled={!editable} onClick={() => editor?.chain().focus().toggleTaskList().run()}>Task</button>
        <button type="button" disabled={!editable} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>Quote</button>
        <button type="button" disabled={!editable} onClick={() => editor?.chain().focus().toggleCodeBlock().run()}>Block</button>
        <button type="button" disabled={!editable} onClick={() => editor?.chain().focus().setHorizontalRule().run()}>Divider</button>
        <button type="button" disabled={!editable} onClick={setLink}>URL</button>
        <span className="quick-note-slash-hint">{editable ? 'Type / for blocks' : 'Click Edit to change notes'}</span>
      </div>
      <div className="tiptap-editor-shell">
        {showSlashMenu && commandMatches.length > 0 && (
          <div className="slash-command-menu quick-note-slash-menu">
            {commandMatches.map((command, index) => (
              <button key={command.id} type="button" className={index === slashSelectedIndex ? 'active' : ''} onMouseDown={event => {
                event.preventDefault();
                runBlockCommand(command.id);
              }}>
                <strong>{command.label}</strong>
                <span>{command.hint}</span>
              </button>
            ))}
          </div>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

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

function LocationPlot({
  locations,
  mapTileBaseUrl,
  isDownloadingMap,
  onDownloadTiles
}: {
  locations: LocationSummary[];
  mapTileBaseUrl: string;
  isDownloadingMap: boolean;
  onDownloadTiles: (tiles: MapTile[]) => void;
}) {
  const points = locations.filter(location =>
    Number.isFinite(location.latitude) && Number.isFinite(location.longitude)
  );
  if (points.length === 0) {
    return (
      <section className="location-map-card location-map-empty">
        <div>
          <span className="dashboard-kicker">Coordinate Map</span>
          <h3>No coordinates to plot yet</h3>
          <p>When imported metadata includes latitude and longitude, Note Vault can plot it locally without loading an online map.</p>
        </div>
      </section>
    );
  }

  const tileSize = 256;
  const mapWidth = 720;
  const mapHeight = 420;
  const lats = points.map(point => point.latitude as number);
  const lngs = points.map(point => point.longitude as number);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latRange = Math.max(0.0001, maxLat - minLat);
  const lngRange = Math.max(0.0001, maxLng - minLng);
  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;
  const zoom = Math.max(2, Math.min(12, Math.floor(Math.log2(270 / Math.max(latRange, lngRange)))));
  const scale = tileSize * (2 ** zoom);
  const project = (lat: number, lng: number) => {
    const sinLat = Math.sin((lat * Math.PI) / 180);
    return {
      x: ((lng + 180) / 360) * scale,
      y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale
    };
  };
  const center = project(centerLat, centerLng);
  const topLeft = { x: center.x - mapWidth / 2, y: center.y - mapHeight / 2 };
  const firstTileX = Math.floor(topLeft.x / tileSize);
  const firstTileY = Math.floor(topLeft.y / tileSize);
  const tileColumns = Math.ceil(mapWidth / tileSize) + 2;
  const tileRows = Math.ceil(mapHeight / tileSize) + 2;
  const worldTileCount = 2 ** zoom;
  const tiles = Array.from({ length: tileColumns * tileRows }, (_value, index) => {
    const column = index % tileColumns;
    const row = Math.floor(index / tileColumns);
    const tileX = firstTileX + column;
    const tileY = firstTileY + row;
    const wrappedX = ((tileX % worldTileCount) + worldTileCount) % worldTileCount;
    if (tileY < 0 || tileY >= worldTileCount) return null;
    return {
      key: `${zoom}-${wrappedX}-${tileY}`,
      z: zoom,
      x: wrappedX,
      y: tileY,
      left: tileX * tileSize - topLeft.x,
      top: tileY * tileSize - topLeft.y
    };
  }).filter(Boolean) as MapTile[];

  return (
    <section className="location-map-card">
      <div>
        <span className="dashboard-kicker">Offline Map</span>
        <h3>Photo places on downloaded map tiles</h3>
        <p>Note Vault only loads local map tiles here. Use the download button when you want to cache the map for these location pins.</p>
        <button className="dashboard-secondary-action location-map-download" type="button" onClick={() => onDownloadTiles(tiles)} disabled={isDownloadingMap}>
          {isDownloadingMap ? 'Downloading map...' : 'Download Offline Map'}
        </button>
      </div>
      <div className="location-tile-map" role="img" aria-label="Imported photo and video map">
        {!mapTileBaseUrl && (
          <div className="location-map-missing">
            Download map tiles to see streets and geography here.
          </div>
        )}
        <div
          className="location-tile-stage"
          style={{ width: mapWidth, height: mapHeight }}
        >
          {mapTileBaseUrl && tiles.map(tile => (
            <img
              key={tile.key}
              src={`${mapTileBaseUrl}${tile.z}/${tile.x}/${tile.y}.png`}
              alt=""
              draggable={false}
              style={{
                left: tile.left,
                top: tile.top,
                width: tileSize,
                height: tileSize
              }}
            />
          ))}
          {points.map((point, index) => {
            const projected = project(point.latitude as number, point.longitude as number);
            const x = projected.x - topLeft.x;
            const y = projected.y - topLeft.y;
            const size = Math.min(42, 22 + Math.log2(point.count + 1) * 6);
          return (
              <span
                key={`${point.location}-${index}`}
                className="location-map-pin"
                style={{ left: x, top: y, width: size, height: size }}
                title={`${point.location} (${point.count} item${point.count === 1 ? '' : 's'})`}
              >
                {point.count}
              </span>
          );
        })}
        </div>
        <small className="location-map-attribution">
          Map tiles © OpenStreetMap contributors
        </small>
      </div>
    </section>
  );
}

function WordWall({
  title,
  words,
  emptyText,
  onWordClick
}: {
  title: string;
  words: { label: string; count: number }[];
  emptyText: string;
  onWordClick?: (label: string) => void;
}) {
  const topWords = [...words]
    .filter(word => word.label && word.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 28);
  const maxCount = Math.max(1, ...topWords.map(word => word.count));

  return (
    <section className="word-wall-card">
      <div className="dashboard-section-label">
        <span>{title}</span>
        <small>Common tags and places get louder visually.</small>
      </div>
      <div className="word-wall">
        {topWords.length === 0 ? (
          <span className="word-wall-empty">{emptyText}</span>
        ) : topWords.map(word => {
          const weight = Math.max(1, Math.ceil((word.count / maxCount) * 5));
          const content = <>
            {word.label}
            <small>{word.count}</small>
          </>;
          return onWordClick ? (
            <button
              key={word.label}
              type="button"
              className={`word-wall-token word-weight-${weight}`}
              onClick={() => onWordClick(word.label)}
            >
              {content}
            </button>
          ) : (
            <span key={word.label} className={`word-wall-token word-weight-${weight}`}>
              {content}
            </span>
          );
        })}
      </div>
    </section>
  );
}

function VideoGridThumbnail({ item }: { item: VaultItem }) {
  return (
    <span className="video-grid-thumb">
      <span className="video-grid-overlay">
        <span className="video-play-glyph">▶</span>
        <small>{item.file_ext?.replace('.', '').toUpperCase() || 'VIDEO'}</small>
      </span>
    </span>
  );
}

function VideoPreviewPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  async function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      await video.play().catch(() => undefined);
    } else {
      video.pause();
    }
    setIsPlaying(!video.paused);
  }

  return (
    <div className="video-preview-shell">
      <video
        ref={videoRef}
        className="search-preview-video"
        src={src}
        controls
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />
      {!isPlaying && (
        <button type="button" className="video-preview-play-button" onClick={togglePlay} aria-label="Play video">
          ▶
        </button>
      )}

    </div>
  );
}

function ImageGridThumbnail({ item }: { item: VaultItem }) {
  return (
    <img
      className="search-result-grid-image"
      src={item.thumbnail_data || ''}
      alt=""
      style={imageRotationStyle(item)}
      loading="lazy"
    />
  );
}

function ModeSlider({
  value,
  onChange,
  className = ''
}: {
  value: TopNavMode;
  onChange: (mode: TopNavMode) => void;
  className?: string;
}) {
  const modes: { value: TopNavMode; label: string }[] = [
    { value: 'dashboard', label: 'Dashboard' },
    { value: 'note', label: 'Notes' },
    { value: 'photo', label: 'Photos' },
    { value: 'music', label: 'Music' },
    { value: 'settings', label: 'Settings' }
  ];

  return (
    <div className={`mode-slider mode-slider-${value} ${className}`} role="tablist" aria-label="Vault mode">
      {modes.map(mode => (
        <button
          key={mode.value}
          className={value === mode.value ? 'active' : ''}
          onClick={() => onChange(mode.value)}
          role="tab"
          aria-selected={value === mode.value}
          type="button"
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}

function renderInlineMarkdown(text: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<>)]+)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  const openLink = (url: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    window.vaultApi.openExternal(url).catch(() => undefined);
  };

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith('**')) nodes.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('_')) nodes.push(<em key={match.index}>{token.slice(1, -1)}</em>);
    else if (token.startsWith('`')) nodes.push(<code key={match.index}>{token.slice(1, -1)}</code>);
    else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      nodes.push(linkMatch
        ? <a key={match.index} href={linkMatch[2]} onClick={openLink(linkMatch[2])}>{linkMatch[1]}</a>
        : <a key={match.index} href={token} onClick={openLink(token)}>{token}</a>
      );
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes.length > 0 ? nodes : text;
}

function isSafePreviewImageUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (/^file:\/\//i.test(trimmed)) return true;
  if (/^data:image\//i.test(trimmed)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
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
    } else if (/^!\[[^\]]*\]\([^)]+\)/.test(line.trim())) {
      const imageMatch = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)/);
      if (imageMatch && isSafePreviewImageUrl(imageMatch[2])) {
        blocks.push(<figure key={index} className="markdown-image-block"><img src={imageMatch[2]} alt={imageMatch[1] || 'Imported image'} /><figcaption>{imageMatch[1]}</figcaption></figure>);
      } else if (imageMatch) {
        blocks.push(
          <p key={index} className="markdown-remote-image-note">
            Remote image blocked for privacy: <a href={imageMatch[2]} onClick={(event) => {
              event.preventDefault();
              window.vaultApi.openExternal(imageMatch[2]).catch(() => undefined);
            }}>{imageMatch[1] || imageMatch[2]}</a>
          </p>
        );
      } else {
        blocks.push(<p key={index}>{renderInlineMarkdown(line)}</p>);
      }
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

function renderInlineMarkdownSnippet(text: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<>)]+)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (token.startsWith('**')) nodes.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('_')) nodes.push(<em key={match.index}>{token.slice(1, -1)}</em>);
    else if (token.startsWith('`')) nodes.push(<code key={match.index}>{token.slice(1, -1)}</code>);
    else nodes.push(<span key={match.index}>{linkMatch ? linkMatch[1] : token.replace(/^https?:\/\//, '')}</span>);
    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes.length > 0 ? nodes : text;
}

function MarkdownCardPreview({ value, title }: { value: string; title?: string }) {
  const titleText = (title || '').trim().toLowerCase();
  const lines = value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !line.startsWith('```'))
    .filter(line => !/^!\[[^\]]*\]\([^)]+\)/.test(line))
    .filter(line => line.trim() !== '---');

  const blocks = lines
    .map((line, index) => {
      if (line.startsWith('#')) {
        const heading = line.replace(/^#{1,6}\s*/, '').trim();
        if (heading.toLowerCase() === titleText) return null;
        return <strong key={index} className="note-card-preview-heading">{renderInlineMarkdownSnippet(heading)}</strong>;
      }
      if (/^- \[[ xX]\] /.test(line)) {
        const checked = line.slice(3, 4).toLowerCase() === 'x';
        return <span key={index} className="note-card-preview-task">{checked ? '✓' : '□'} {renderInlineMarkdownSnippet(line.slice(6))}</span>;
      }
      if (line.startsWith('- ')) {
        return <span key={index}>• {renderInlineMarkdownSnippet(line.slice(2))}</span>;
      }
      if (line.startsWith('> ')) {
        return <em key={index}>{renderInlineMarkdownSnippet(line.slice(2))}</em>;
      }
      return <span key={index}>{renderInlineMarkdownSnippet(line)}</span>;
    })
    .filter(Boolean)
    .slice(0, 5);

  return <div className="note-card-markdown-preview">{blocks.length ? blocks : <span>No note text yet.</span>}</div>;
}

function markdownToReadableSnippet(value: string, maxLength = 180) {
  const cleaned = value
    .replace(/```[\s\S]*?```/g, match => match.replace(/```/g, '').trim())
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/^- \[[ xX]\]\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^---+$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength).trim()}…` : cleaned;
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
  const [collections, setCollections] = useState<VaultCollection[]>([]);
  const [collectionSort, setCollectionSort] = useState<CollectionSort>(() => (localStorage.getItem('vault-notes-collection-sort') as CollectionSort) || 'name');
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [collectionPageParentId, setCollectionPageParentId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(() => {
    const saved = localStorage.getItem('vault-notes-workspace-mode');
    return saved === 'photo' || saved === 'music' || saved === 'note' ? saved : 'note';
  });
  const [appView, setAppView] = useState<AppView>('dashboard');

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [libraryContentFilter, setLibraryContentFilter] = useState<LibraryContentFilter>('all');
  const [showLibraryContentFilter, setShowLibraryContentFilter] = useState(false);
  const [libraryFavoriteOnly, setLibraryFavoriteOnly] = useState(false);
  const [itemSort, setItemSort] = useState<ItemSort>('updated');
  const [libraryViewMode, setLibraryViewMode] = useState<LibraryViewMode>(() => {
    const saved = localStorage.getItem('vault-notes-library-view');
    return saved === 'compact' || saved === 'grid' || saved === 'cards' ? saved : 'cards';
  });
  const [detailTab, setDetailTab] = useState<DetailTab>('preview');
  const [noteEditorMode, setNoteEditorMode] = useState<NoteEditorMode>('edit');
  const [isDetailFocus, setIsDetailFocus] = useState(() => localStorage.getItem('vault-notes-detail-focus') === 'true');
  const [isListFocus, setIsListFocus] = useState(false);
  const [fullscreenSelector, setFullscreenSelector] = useState('');

  const [searchText, setSearchText] = useState('');
  const [searchType, setSearchType] = useState<TypeFilter>('all');
  const [searchSort, setSearchSort] = useState<SearchSort>('created');
  const [photoWorkspaceView, setPhotoWorkspaceView] = useState<PhotoWorkspaceView>('library');
  const [photoMediaFilter, setPhotoMediaFilter] = useState<PhotoMediaFilter>('media');
  const [searchTags, setSearchTags] = useState<string[]>([]);
  const [searchTagsOnly, setSearchTagsOnly] = useState(false);
  const [searchUntaggedOnly, setSearchUntaggedOnly] = useState(false);
  const [searchResults, setSearchResults] = useState<VaultItem[]>([]);
  const [libraryPage, setLibraryPage] = useState(0);
  const [searchPage, setSearchPage] = useState(0);
  const [libraryHasNextPage, setLibraryHasNextPage] = useState(false);
  const [searchHasNextPage, setSearchHasNextPage] = useState(false);
  const [searchViewMode, setSearchViewMode] = useState<SearchViewMode>(() => {
    const saved = localStorage.getItem('vault-notes-search-view');
    return saved === 'grid' || saved === 'cards' ? saved : 'cards';
  });
  const [showSearchTypeDropdown, setShowSearchTypeDropdown] = useState(false);
  const [showSearchScopeDropdown, setShowSearchScopeDropdown] = useState(false);
  const [searchCollectionId, setSearchCollectionId] = useState('');
  const [showSearchCollectionDropdown, setShowSearchCollectionDropdown] = useState(false);
  const [searchPreviewItem, setSearchPreviewItem] = useState<VaultItem | null>(null);
  const [searchPreviewMediaUrl, setSearchPreviewMediaUrl] = useState('');
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
  const [draftCreatedAt, setDraftCreatedAt] = useState('');
  const [quickNoteTitle, setQuickNoteTitle] = useState('');
  const [quickNoteBody, setQuickNoteBody] = useState('');
  const [quickNoteCollectionId, setQuickNoteCollectionId] = useState('');
  const [quickNoteTags, setQuickNoteTags] = useState<string[]>([]);
  const [quickNoteTagsOpen, setQuickNoteTagsOpen] = useState(false);
  const [modeRecentFiles, setModeRecentFiles] = useState<VaultItem[]>([]);
  const [modeRecentMedia, setModeRecentMedia] = useState<VaultItem[]>([]);
  const [featuredPhotoId, setFeaturedPhotoId] = useState('');
  const [featuredPhotoMediaUrl, setFeaturedPhotoMediaUrl] = useState('');
  const [isSavingQuickNote, setIsSavingQuickNote] = useState(false);

  const [status, setStatus] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isImportingPhotos, setIsImportingPhotos] = useState(false);
  const [isRepairingPhotos, setIsRepairingPhotos] = useState(false);
  const [photoRepairResult, setPhotoRepairResult] = useState<{
    zipCount?: number;
    metadataFiles?: number;
    metadataKeys?: number;
    scannedItems?: number;
    matched?: number;
    updated?: number;
    unmatched?: number;
    matchedExamples?: string[];
    unmatchedExamples?: string[];
    unmatchedDetails?: string[];
  } | null>(null);
  const [newTagText, setNewTagText] = useState('');
  const [settingsTagText, setSettingsTagText] = useState('');
  const [renamingTag, setRenamingTag] = useState('');
  const [renameTagText, setRenameTagText] = useState('');
  const [selectedSettingsTags, setSelectedSettingsTags] = useState<Set<string>>(new Set());
  const [showEditCollectionPicker, setShowEditCollectionPicker] = useState(false);
  const [showSearchTagDropdown, setShowSearchTagDropdown] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [subCollectionAttachId, setSubCollectionAttachId] = useState('');
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
  const [backupEncryptionEnabled, setBackupEncryptionEnabled] = useState(false);
  const [backupEncryptionSaved, setBackupEncryptionSaved] = useState(false);
  const [backupEncryptionPassword, setBackupEncryptionPassword] = useState('');
  const [showBackupEncryptionPassword, setShowBackupEncryptionPassword] = useState(false);
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('vault-notes-theme') !== 'light');
  const [showOnboarding, setShowOnboarding] = useState(() => localStorage.getItem('vault-notes-onboarding-complete') !== 'true');
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingStartChoice, setOnboardingStartChoice] = useState<OnboardingStartChoice>('manual');
  const [onboardingImportChoice, setOnboardingImportChoice] = useState<OnboardingImportChoice>('files');
  const [starterImportPrompt, setStarterImportPrompt] = useState<OnboardingImportChoice | null>(null);
  const [importWizardScope, setImportWizardScope] = useState<ImportWizardScope>(null);
  const [starterReturnScope, setStarterReturnScope] = useState<ImportWizardScope>(null);
  const [completedImportChoices, setCompletedImportChoices] = useState<Set<OnboardingImportChoice>>(new Set());
  const [appVersion, setAppVersion] = useState('');
  const [logText, setLogText] = useState('');
  const [logPath, setLogPath] = useState('');
  const [watchedFolders, setWatchedFolders] = useState<WatchedFolder[]>([]);
  const watchedAutoScanRef = useRef(false);
  const importDraftsRef = useRef<ImportDraft[]>([]);
  const pendingWatchedReviewFilesRef = useRef<WatchedFolderFile[]>([]);
  const pendingWatchedScanFolderIdRef = useRef<string | undefined>(undefined);
  const pendingImportIntentRef = useRef<ImportIntent>('auto');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const noteEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const quickNoteTagPickerRef = useRef<HTMLDetailsElement | null>(null);
  const onboardingFilesInputRef = useRef<HTMLInputElement | null>(null);
  const onboardingFolderInputRef = useRef<HTMLInputElement | null>(null);
  const memoryCanvasRef = useRef<HTMLElement | null>(null);
  const memoryCanvasZoomRef = useRef(1);
  const [dashboard, setDashboard] = useState<{ totalItems: number; notes: number; files: number; photos: number; videos: number; audio: number; googlePhotos: number; locations: number; favorites: number; collections: number; tags: number; relationships: number; memories: number; recentItems: VaultItem[] } | null>(null);
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
  const [photoImportProgress, setPhotoImportProgress] = useState<ImportProgress | null>(null);
  const [relationships, setRelationships] = useState<VaultRelationship[]>([]);
  const [allRelationships, setAllRelationships] = useState<VaultRelationshipSummary[]>([]);
  const [relationshipPageView, setRelationshipPageView] = useState<'hubs' | 'manage'>('hubs');
  const [memories, setMemories] = useState<VaultMemory[]>([]);
  const [activeMemory, setActiveMemory] = useState<VaultMemoryDetail | null>(null);
  const [memorySuggestions, setMemorySuggestions] = useState<VaultMemorySuggestion[]>([]);
  const [newMemoryTitle, setNewMemoryTitle] = useState('');
  const [newMemoryDescription, setNewMemoryDescription] = useState('');
  const [memoryItemSearch, setMemoryItemSearch] = useState('');
  const [memorySearchResults, setMemorySearchResults] = useState<VaultItem[]>([]);
  const [memoryCanvasZoom, setMemoryCanvasZoom] = useState(1);
  const [selectedMemoryItemIds, setSelectedMemoryItemIds] = useState<Set<string>>(new Set());
  const [selectedMemoryDecorationIds, setSelectedMemoryDecorationIds] = useState<Set<string>>(new Set());
  const [memoryDecorationColor, setMemoryDecorationColor] = useState(memoryScrapbookPalette[0].value);
  const [memorySelectionBox, setMemorySelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const [draggingMemoryItem, setDraggingMemoryItem] = useState<{ itemId: string; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [resizingMemoryItem, setResizingMemoryItem] = useState<{ itemId: string; startX: number; startY: number; originWidth: number; originHeight: number; aspectRatio?: number } | null>(null);
  const [draggingMemoryDecoration, setDraggingMemoryDecoration] = useState<{ id: string; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [resizingMemoryDecoration, setResizingMemoryDecoration] = useState<{ id: string; startX: number; startY: number; originWidth: number; originHeight: number } | null>(null);
  const [draggingMemoryPlayer, setDraggingMemoryPlayer] = useState<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [panningMemoryCanvas, setPanningMemoryCanvas] = useState<{ startX: number; startY: number; originScrollLeft: number; originScrollTop: number } | null>(null);
  const [locationSummaries, setLocationSummaries] = useState<LocationSummary[]>([]);
  const [mapTileBaseUrl, setMapTileBaseUrl] = useState('');
  const [isDownloadingMap, setIsDownloadingMap] = useState(false);
  const [musicItems, setMusicItems] = useState<VaultItem[]>([]);
  const [currentAudioItem, setCurrentAudioItem] = useState<VaultItem | null>(null);
  const [currentAudioUrl, setCurrentAudioUrl] = useState('');
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioPlayStats, setAudioPlayStats] = useState<Record<string, { plays: number; lastPlayed: string }>>(() => {
    try {
      return JSON.parse(localStorage.getItem('vault-notes-audio-play-stats') || '{}');
    } catch {
      return {};
    }
  });
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const selectedItemFullCacheRef = useRef(new Map<string, VaultItem>());
  const [journalNotes, setJournalNotes] = useState<VaultItem[]>([]);
  const [relationshipItems, setRelationshipItems] = useState<VaultItem[]>([]);
  const [relatedItemSearch, setRelatedItemSearch] = useState('');
  const [slashQuery, setSlashQuery] = useState('');
  const [noteSlashMenuOpen, setNoteSlashMenuOpen] = useState(false);
  const [noteSlashSelectedIndex, setNoteSlashSelectedIndex] = useState(0);
  const [selectedMediaUrl, setSelectedMediaUrl] = useState('');

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return items.find(i => i.id === selectedId) || null;
  }, [items, selectedId]);
  const isSelectedEditing = Boolean(selectedId) && editingItemId === selectedId;

  useEffect(() => {
    if (!selectedId) return;
    const selectedListItem = items.find(item => item.id === selectedId);
    const cached = selectedItemFullCacheRef.current.get(selectedId);
    if (cached) {
      setItems(current => current.map(item => item.id === cached.id ? cached : item));
      return;
    }
    const needsFullItem = !selectedListItem ||
      (selectedListItem.body || '').endsWith('...') ||
      (selectedListItem.extracted_text || '').endsWith('...');
    if (!needsFullItem) return;

    let canceled = false;
    window.vaultApi.getItem(selectedId)
      .then(fullItem => {
        if (canceled || !fullItem) return;
        selectedItemFullCacheRef.current.set(fullItem.id, fullItem);
        setItems(current => current.map(item => item.id === fullItem.id ? fullItem : item));
      })
      .catch(() => undefined);
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    let canceled = false;
    setSelectedMediaUrl('');
    if (!selected || selected.type !== 'file' || (!isImageItem(selected) && !isVideoItem(selected) && !isAudioItem(selected))) return;

    window.vaultApi.getMediaUrl(selected.id)
      .then(url => {
        if (!canceled) setSelectedMediaUrl(url);
      })
      .catch(() => {
        if (!canceled) setSelectedMediaUrl('');
      });

    return () => {
      canceled = true;
    };
  }, [selected?.id, selected?.file_ext]);

  useEffect(() => {
    let canceled = false;
    setSearchPreviewMediaUrl('');
    if (!searchPreviewItem || searchPreviewItem.type !== 'file' || (!isImageItem(searchPreviewItem) && !isVideoItem(searchPreviewItem) && !isAudioItem(searchPreviewItem))) return;

    window.vaultApi.getMediaUrl(searchPreviewItem.id)
      .then(url => {
        if (!canceled) setSearchPreviewMediaUrl(url);
      })
      .catch(() => {
        if (!canceled) setSearchPreviewMediaUrl('');
      });

    return () => {
      canceled = true;
    };
  }, [searchPreviewItem?.id, searchPreviewItem?.file_ext]);

  const sortedItems = useMemo(() => [...items].sort((left, right) => {
    if (itemSort === 'title') return (left.title || '').localeCompare(right.title || '');
    if (itemSort === 'tags') return ((left.tags || []).join(', ')).localeCompare((right.tags || []).join(', ')) || (left.title || '').localeCompare(right.title || '');
    if (itemSort === 'created') return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  }), [items, itemSort]);

  const sortedCollections = useMemo(() => [...collections].sort((left, right) => {
    if (collectionSort === 'count') return (right.count || 0) - (left.count || 0) || left.name.localeCompare(right.name);
    if (collectionSort === 'recent') return new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime();
    return left.name.localeCompare(right.name);
  }), [collections, collectionSort]);

  const visibleCollections = useMemo(() => sortedCollections.filter(collection => {
    const mode = collection.mode || '';
    if (collection.parent_id) return false;
    if (workspaceMode === 'music') return mode === 'music';
    if (workspaceMode === 'photo') return mode === 'photo' || Number(collection.image_count || 0) + Number(collection.video_count || 0) > 0;
    return mode === '' || mode === 'note' || Number(collection.note_count || 0) + Number(collection.document_count || 0) > 0;
  }), [sortedCollections, workspaceMode]);

  const collectionPageParent = useMemo(
    () => collectionPageParentId ? collections.find(collection => collection.id === collectionPageParentId) || null : null,
    [collectionPageParentId, collections]
  );

  const collectionPageCollections = useMemo(() => sortedCollections.filter(collection => {
    const mode = collection.mode || '';
    const parentMatches = collectionPageParentId ? collection.parent_id === collectionPageParentId : !collection.parent_id;
    if (!parentMatches) return false;
    if (workspaceMode === 'music') return mode === 'music';
    if (workspaceMode === 'photo') return mode === 'photo' || Number(collection.image_count || 0) + Number(collection.video_count || 0) > 0;
    return mode === '' || mode === 'note' || Number(collection.note_count || 0) + Number(collection.document_count || 0) > 0;
  }), [collectionPageParentId, sortedCollections, workspaceMode]);

  const noteItems = appView === 'notes' ? journalNotes : items.filter(item => item.type === 'note');

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
    if (!status) return;
    const longRunning = /^(Choose|Review|Importing|Uploading|Downloading|Indexing|Searching|Starting|Repairing|Scanning|Preparing|Copying|Waiting)/i.test(status);
    if (longRunning) return;
    const timer = window.setTimeout(() => {
      setStatus(current => current === status ? '' : current);
    }, 6500);
    return () => window.clearTimeout(timer);
  }, [status]);

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
    localStorage.setItem('vault-notes-workspace-mode', workspaceMode);
  }, [workspaceMode]);

  useEffect(() => {
    localStorage.setItem('vault-notes-audio-play-stats', JSON.stringify(audioPlayStats));
  }, [audioPlayStats]);

  useEffect(() => {
    if (appView !== 'library') return;
    refresh({ page: 0, includeMetadata: false }).catch(err => setStatus(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemSort]);

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
    window.vaultApi.getMapTileBaseUrl().then(setMapTileBaseUrl).catch(() => undefined);
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

  useEffect(() => {
    if (workspaceMode !== 'music') return;
    refreshMusicItems().catch(err => setStatus(`Could not load music files: ${err.message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceMode]);

  useEffect(() => {
    memoryCanvasZoomRef.current = memoryCanvasZoom;
  }, [memoryCanvasZoom]);

  const activeCollection = useMemo(
    () => collections.find(collection => collection.id === selectedCollectionId) || null,
    [collections, selectedCollectionId]
  );

  const canShowLibraryContentFilter = appView === 'library'
    && showLibraryContentFilter
    && workspaceMode === 'note'
    && !selectedCollectionId
    && !libraryFavoriteOnly;

  const activeCollectionParent = useMemo(
    () => activeCollection?.parent_id ? collections.find(collection => collection.id === activeCollection.parent_id) || null : null,
    [activeCollection, collections]
  );

  const noteRecentFiles = useMemo(
    () => modeRecentFiles
      .filter(item => item.type === 'file' && !isImageItem(item) && !isVideoItem(item) && !isAudioItem(item))
      .slice(0, 6),
    [modeRecentFiles]
  );

  const recentMediaItems = useMemo(
    () => modeRecentMedia
      .filter(item => item.type === 'file' && (isImageItem(item) || isVideoItem(item)))
      .slice(0, 8),
    [modeRecentMedia]
  );

  const featuredPhotoItem = useMemo(
    () => recentMediaItems.find(item => item.id === featuredPhotoId) || recentMediaItems.find(item => isImageItem(item)) || recentMediaItems[0] || null,
    [featuredPhotoId, recentMediaItems]
  );

  useEffect(() => {
    let canceled = false;
    setFeaturedPhotoMediaUrl('');
    if (!featuredPhotoItem || featuredPhotoItem.type !== 'file' || !isImageItem(featuredPhotoItem)) return;

    window.vaultApi.getMediaUrl(featuredPhotoItem.id)
      .then(url => {
        if (!canceled) setFeaturedPhotoMediaUrl(url);
      })
      .catch(() => {
        if (!canceled) setFeaturedPhotoMediaUrl('');
      });

    return () => {
      canceled = true;
    };
  }, [featuredPhotoItem?.id, featuredPhotoItem?.file_ext]);

  const activeMusicChildCollections = useMemo(() => {
    if (!activeCollection || workspaceMode !== 'music') return [];
    return sortedCollections.filter(collection =>
      (collection.mode || '') === 'music' &&
      collection.parent_id === activeCollection.id
    );
  }, [activeCollection, sortedCollections, workspaceMode]);

  const showingMusicSubCollectionLanding = workspaceMode === 'music' && Boolean(activeCollection) && activeMusicChildCollections.length > 0;

  const attachableMusicSubCollections = useMemo(() => {
    const parent = collectionPageParent || activeCollection;
    if (!parent || workspaceMode !== 'music') return [];
    return sortedCollections.filter(collection =>
      collection.id !== parent.id &&
      (collection.mode || '') === 'music' &&
      !collection.parent_id
    );
  }, [activeCollection, collectionPageParent, sortedCollections, workspaceMode]);

  const tagWordWall = useMemo(
    () => tagRecords.map(tag => ({ label: tag.name, count: Number(tag.count || 0) })),
    [tagRecords]
  );

  const recentlyPlayedMusicItems = useMemo(
    () => musicItems
      .filter(item => audioPlayStats[item.id]?.lastPlayed)
      .sort((left, right) =>
        new Date(audioPlayStats[right.id]?.lastPlayed || 0).getTime() -
        new Date(audioPlayStats[left.id]?.lastPlayed || 0).getTime()
      )
      .slice(0, 8),
    [musicItems, audioPlayStats]
  );

  const activeMemoryAudioItems = useMemo(
    () => activeMemory?.items.map(memoryItem => memoryItem.item).filter(item => isAudioItem(item)) || [],
    [activeMemory]
  );

  const activeMemoryVisualItems = useMemo(
    () => activeMemory?.items.filter(memoryItem => !isAudioItem(memoryItem.item)) || [],
    [activeMemory]
  );

  const selectedMemoryCount = selectedMemoryItemIds.size + selectedMemoryDecorationIds.size;

  const relationshipHubs = useMemo(() => {
    const hubs = new Map<string, {
      item: VaultRelationshipSummary['source'];
      count: number;
      related: VaultRelationshipSummary['target'][];
      latest: string;
    }>();

    allRelationships.forEach(relationship => {
      const pairs = [
        { item: relationship.source, related: relationship.target },
        { item: relationship.target, related: relationship.source }
      ];
      pairs.forEach(pair => {
        const current = hubs.get(pair.item.id) || {
          item: pair.item,
          count: 0,
          related: [],
          latest: relationship.created_at
        };
        current.count += 1;
        current.latest = new Date(relationship.created_at).getTime() > new Date(current.latest).getTime()
          ? relationship.created_at
          : current.latest;
        if (!current.related.some(item => item.id === pair.related.id)) current.related.push(pair.related);
        hubs.set(pair.item.id, current);
      });
    });

    return [...hubs.values()]
      .sort((left, right) => right.count - left.count || new Date(right.latest).getTime() - new Date(left.latest).getTime());
  }, [allRelationships]);

  function libraryContentArgs(filter: LibraryContentFilter, fallbackType: TypeFilter) {
    if (workspaceMode === 'music') return { type: 'file' as TypeFilter, audioOnly: true };
    if (filter === 'notes') return { type: 'note' as TypeFilter };
    if (filter === 'documents') return { type: 'file' as TypeFilter, documentOnly: true };
    if (filter === 'media') return { type: 'file' as TypeFilter, mediaOnly: true };
    if (filter === 'audio') return { type: 'file' as TypeFilter, audioOnly: true };
    return {
      type: fallbackType,
      documentOnly: workspaceMode === 'note' && fallbackType === 'file'
    };
  }

  async function refresh(overrides?: {
    search?: string;
    type?: TypeFilter;
    collectionId?: string | null;
    page?: number;
    includeMetadata?: boolean;
    contentFilter?: LibraryContentFilter;
  }) {
    const page = overrides?.page ?? libraryPage;
    const includeMetadata = overrides?.includeMetadata !== false;
    const effectiveContentFilter = canShowLibraryContentFilter
      ? (overrides?.contentFilter ?? libraryContentFilter)
      : workspaceMode === 'music' && appView === 'library'
        ? 'audio'
        : 'all';
    const contentArgs = libraryContentArgs(
      effectiveContentFilter,
      overrides?.type ?? typeFilter
    );
    const loadedItems = await window.vaultApi.listItems({
      search: overrides?.search ?? search,
      tag: '',
      type: contentArgs.type,
      collectionId: overrides?.collectionId ?? selectedCollectionId ?? '',
      audioOnly: contentArgs.audioOnly,
      mediaOnly: contentArgs.mediaOnly,
      documentOnly: contentArgs.documentOnly,
      favoriteOnly: libraryFavoriteOnly,
      limit: libraryPageSize,
      offset: page * libraryPageSize,
      sort: itemSort
    });

    setItems(loadedItems);
    setLibraryPage(page);
    setLibraryHasNextPage(loadedItems.length >= libraryPageSize);
    if (status.startsWith('Showing page ')) setStatus('');

    if (includeMetadata) {
      const loadedTags = await window.vaultApi.listTags();
      setTagRecords(loadedTags);
      setAllTags(loadedTags.map((tag: any) => tag.name));

      const loadedCollections = await window.vaultApi.listCollections();
      setCollections(loadedCollections);

      const dashboardSummary = await window.vaultApi.getDashboardSummary();
      setDashboard(dashboardSummary);
    }

    return loadedItems;
  }

  async function refreshTags() {
    const loadedTags = await window.vaultApi.listTags();
    setTagRecords(loadedTags);
    setAllTags(loadedTags.map((tag: any) => tag.name));
    const dashboardSummary = await window.vaultApi.getDashboardSummary();
    setDashboard(dashboardSummary);
  }

  async function refreshDashboardSummary() {
    const dashboardSummary = await window.vaultApi.getDashboardSummary();
    setDashboard(dashboardSummary);
  }

  async function refreshAllRelationships() {
    const loadedRelationships = await window.vaultApi.listAllRelationships();
    setAllRelationships(loadedRelationships);
  }

  async function refreshMemories() {
    const [loadedMemories, loadedSuggestions] = await Promise.all([
      window.vaultApi.listMemories(),
      window.vaultApi.listMemorySuggestions()
    ]);
    setMemories(loadedMemories);
    setMemorySuggestions(loadedSuggestions);
    if (activeMemory) {
      const refreshed = await window.vaultApi.getMemory(activeMemory.id);
      setActiveMemory(refreshed);
    }
    await refreshDashboardSummary();
  }

  async function openMemory(memoryId: string) {
    const memory = await window.vaultApi.getMemory(memoryId);
    setActiveMemory(memory);
    setAppView('memories');
  }

  async function createMemoryFromDraft() {
    const memory = await window.vaultApi.createMemory({
      title: newMemoryTitle.trim() || 'Untitled Memory',
      description: newMemoryDescription.trim(),
      theme: 'cozy'
    });
    setNewMemoryTitle('');
    setNewMemoryDescription('');
    setActiveMemory(memory);
    await refreshMemories();
    setStatus('Memory created.');
  }

  async function createMemoryFromSuggestion(suggestion: VaultMemorySuggestion) {
    const memory = await window.vaultApi.createMemory({
      title: suggestion.title,
      description: suggestion.reason,
      theme: 'cozy',
      itemIds: suggestion.itemIds
    });
    setActiveMemory(memory);
    await refreshMemories();
    setStatus(`Memory created from ${suggestion.itemCount} related items.`);
  }

  async function deleteMemory(memoryId: string, title: string) {
    if (!confirm(`Delete the memory "${title}"? The original vault items will stay in your vault.`)) return;
    await window.vaultApi.deleteMemory(memoryId);
    if (activeMemory?.id === memoryId) setActiveMemory(null);
    await refreshMemories();
    setStatus('Memory deleted.');
  }

  async function renameMemory(memory: VaultMemory | VaultMemoryDetail) {
    const nextTitle = window.prompt('Memory name', memory.title || 'Untitled Memory');
    if (nextTitle === null) return;
    const cleanTitle = nextTitle.trim();
    if (!cleanTitle) {
      setStatus('Memory name cannot be blank.');
      return;
    }
    const updated = await window.vaultApi.updateMemory({ id: memory.id, title: cleanTitle });
    if (activeMemory?.id === memory.id) setActiveMemory(updated);
    await refreshMemories();
    setStatus('Memory renamed.');
  }

  async function addItemToActiveMemory(itemId: string) {
    if (!activeMemory) return;
    const memory = await window.vaultApi.addItemToMemory({ memoryId: activeMemory.id, itemId });
    setActiveMemory(memory);
    setMemoryItemSearch('');
    setMemorySearchResults([]);
    await refreshMemories();
  }

  async function removeItemFromActiveMemory(itemId: string) {
    if (!activeMemory) return;
    const memory = await window.vaultApi.removeItemFromMemory({ memoryId: activeMemory.id, itemId });
    setActiveMemory(memory);
    await refreshMemories();
  }

  async function saveMemoryItemPosition(itemId: string, x: number, y: number) {
    if (!activeMemory) return;
    const nextItems = activeMemory.items.map(memoryItem =>
      memoryItem.item.id === itemId ? { ...memoryItem, x, y } : memoryItem
    );
    setActiveMemory({ ...activeMemory, items: nextItems });
    const memory = await window.vaultApi.updateMemoryLayout({
      memoryId: activeMemory.id,
      items: nextItems.map(memoryItem => ({
        itemId: memoryItem.item.id,
        x: memoryItem.x,
        y: memoryItem.y,
        width: memoryItem.width,
        height: memoryItem.height
      }))
    });
    setActiveMemory(memory);
  }

  function beginMemoryItemDrag(event: React.MouseEvent, memoryItem: { item: VaultItem; x: number; y: number }) {
    event.preventDefault();
    setDraggingMemoryItem({
      itemId: memoryItem.item.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: memoryItem.x,
      originY: memoryItem.y
    });
  }

  function zoomMemoryCanvas(canvas: HTMLElement, clientX: number, clientY: number, deltaY: number) {
    const rect = canvas.getBoundingClientRect();
    const pointerX = clientX - rect.left;
    const pointerY = clientY - rect.top;

    setMemoryCanvasZoom(currentZoom => {
      const zoomDelta = deltaY > 0 ? -0.08 : 0.08;
      const nextZoom = Math.max(0.35, Math.min(2.4, Number((currentZoom + zoomDelta).toFixed(2))));
      if (nextZoom === currentZoom) return currentZoom;

      const boardX = (canvas.scrollLeft + pointerX) / currentZoom;
      const boardY = (canvas.scrollTop + pointerY) / currentZoom;
      window.requestAnimationFrame(() => {
        canvas.scrollLeft = Math.max(0, boardX * nextZoom - pointerX);
        canvas.scrollTop = Math.max(0, boardY * nextZoom - pointerY);
      });
      return nextZoom;
    });
  }

  useEffect(() => {
    if (!activeMemory || selectedMemoryCount === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      event.preventDefault();
      deleteSelectedMemoryPieces().catch(err => setStatus(err.message));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMemory?.id, selectedMemoryCount, selectedMemoryItemIds, selectedMemoryDecorationIds]);

  function resetMemoryCanvasZoom() {
    setMemoryCanvasZoom(1);
  }

  function memoryPointerToBoard(event: React.MouseEvent) {
    const canvas = memoryCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (canvas.scrollLeft + event.clientX - rect.left) / memoryCanvasZoomRef.current,
      y: (canvas.scrollTop + event.clientY - rect.top) / memoryCanvasZoomRef.current
    };
  }

  function beginMemoryCanvasPan(event: React.MouseEvent) {
    if (event.button !== 0 && event.button !== 1) return;
    const canvas = memoryCanvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    event.stopPropagation();
    clearMemorySelection();
    setPanningMemoryCanvas({
      startX: event.clientX,
      startY: event.clientY,
      originScrollLeft: canvas.scrollLeft,
      originScrollTop: canvas.scrollTop
    });
  }

  function beginMemoryCanvasSelection(event: React.MouseEvent) {
    if (event.button !== 0) return;
    const point = memoryPointerToBoard(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    clearMemorySelection();
    setMemorySelectionBox({ startX: point.x, startY: point.y, currentX: point.x, currentY: point.y });
  }

  function updateMemoryCanvasSelection(event: React.MouseEvent) {
    if (!memorySelectionBox) return;
    const point = memoryPointerToBoard(event);
    if (!point) return;
    event.preventDefault();
    setMemorySelectionBox(current => current ? { ...current, currentX: point.x, currentY: point.y } : current);
  }

  function endMemoryCanvasSelection() {
    if (!memorySelectionBox || !activeMemory) return;
    const left = Math.min(memorySelectionBox.startX, memorySelectionBox.currentX);
    const right = Math.max(memorySelectionBox.startX, memorySelectionBox.currentX);
    const top = Math.min(memorySelectionBox.startY, memorySelectionBox.currentY);
    const bottom = Math.max(memorySelectionBox.startY, memorySelectionBox.currentY);
    const hasArea = Math.abs(right - left) > 6 && Math.abs(bottom - top) > 6;
    if (!hasArea) {
      setMemorySelectionBox(null);
      return;
    }
    const intersects = (x: number, y: number, width: number, height: number) =>
      x < right && x + width > left && y < bottom && y + height > top;
    setSelectedMemoryItemIds(new Set(activeMemoryVisualItems
      .filter(memoryItem => intersects(memoryItem.x, memoryItem.y, memoryItem.width, memoryItem.height))
      .map(memoryItem => memoryItem.item.id)));
    setSelectedMemoryDecorationIds(new Set(activeMemory.decorations
      .filter(decoration => intersects(decoration.x, decoration.y, decoration.width, decoration.height))
      .map(decoration => decoration.id)));
    setMemorySelectionBox(null);
  }

  function panMemoryCanvas(event: React.MouseEvent) {
    if (!panningMemoryCanvas) return;
    const canvas = memoryCanvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    canvas.scrollLeft = Math.max(0, panningMemoryCanvas.originScrollLeft - (event.clientX - panningMemoryCanvas.startX));
    canvas.scrollTop = Math.max(0, panningMemoryCanvas.originScrollTop - (event.clientY - panningMemoryCanvas.startY));
  }

  function endMemoryCanvasPan() {
    if (panningMemoryCanvas) setPanningMemoryCanvas(null);
  }

  function moveMemoryItem(event: React.MouseEvent) {
    if (!draggingMemoryItem || !activeMemory || resizingMemoryItem) return;
    const nextX = Math.max(0, draggingMemoryItem.originX + (event.clientX - draggingMemoryItem.startX) / memoryCanvasZoom);
    const nextY = Math.max(0, draggingMemoryItem.originY + (event.clientY - draggingMemoryItem.startY) / memoryCanvasZoom);
    setActiveMemory({
      ...activeMemory,
      items: activeMemory.items.map(memoryItem =>
        memoryItem.item.id === draggingMemoryItem.itemId
          ? { ...memoryItem, x: nextX, y: nextY }
          : memoryItem
      )
    });
  }

  function endMemoryItemDrag() {
    if (!draggingMemoryItem || !activeMemory) return;
    const movedItem = activeMemory.items.find(memoryItem => memoryItem.item.id === draggingMemoryItem.itemId);
    setDraggingMemoryItem(null);
    if (movedItem) {
      saveMemoryItemPosition(movedItem.item.id, movedItem.x, movedItem.y).catch(err => setStatus(`Could not save memory layout: ${err.message}`));
    }
  }

  function beginMemoryItemResize(event: React.MouseEvent, memoryItem: { item: VaultItem; width: number; height: number }) {
    event.preventDefault();
    event.stopPropagation();
    setResizingMemoryItem({
      itemId: memoryItem.item.id,
      startX: event.clientX,
      startY: event.clientY,
      originWidth: memoryItem.width,
      originHeight: memoryItem.height,
      aspectRatio: isImageItem(memoryItem.item) && memoryItem.height > 0 ? memoryItem.width / memoryItem.height : undefined
    });
  }

  function resizeMemoryItem(event: React.MouseEvent) {
    if (!resizingMemoryItem || !activeMemory) return;
    const deltaX = (event.clientX - resizingMemoryItem.startX) / memoryCanvasZoom;
    const deltaY = (event.clientY - resizingMemoryItem.startY) / memoryCanvasZoom;
    let nextWidth = Math.max(150, resizingMemoryItem.originWidth + deltaX);
    let nextHeight = Math.max(110, resizingMemoryItem.originHeight + deltaY);
    if (resizingMemoryItem.aspectRatio) {
      const sizeDelta = Math.max(deltaX, deltaY * resizingMemoryItem.aspectRatio);
      nextWidth = Math.max(150, resizingMemoryItem.originWidth + sizeDelta);
      nextHeight = Math.max(110, nextWidth / resizingMemoryItem.aspectRatio);
    }
    setActiveMemory({
      ...activeMemory,
      items: activeMemory.items.map(memoryItem =>
        memoryItem.item.id === resizingMemoryItem.itemId
          ? { ...memoryItem, width: nextWidth, height: nextHeight }
          : memoryItem
      )
    });
  }

  function endMemoryItemResize() {
    if (!resizingMemoryItem || !activeMemory) return;
    const resizedItem = activeMemory.items.find(memoryItem => memoryItem.item.id === resizingMemoryItem.itemId);
    setResizingMemoryItem(null);
    if (resizedItem) {
      window.vaultApi.updateMemoryLayout({
        memoryId: activeMemory.id,
        items: activeMemory.items.map(memoryItem => ({
          itemId: memoryItem.item.id,
          x: memoryItem.x,
          y: memoryItem.y,
          width: memoryItem.width,
          height: memoryItem.height
        }))
      }).then(setActiveMemory).catch(err => setStatus(`Could not save memory card size: ${err.message}`));
    }
  }

  async function addMemoryDecoration(kind: 'string' | 'arrow' | 'pin' | 'label') {
    if (!activeMemory) return;
    const memory = await window.vaultApi.addMemoryDecoration({ memoryId: activeMemory.id, kind, label: kind === 'label' ? 'caption' : '', color: memoryDecorationColor });
    setActiveMemory(memory);
    await refreshMemories();
  }

  async function applyMemoryDecorationColor(color: string) {
    setMemoryDecorationColor(color);
    if (!activeMemory || selectedMemoryDecorationIds.size === 0) return;
    let memory: VaultMemoryDetail | null = activeMemory;
    for (const id of selectedMemoryDecorationIds) {
      const decoration = memory?.decorations.find(entry => entry.id === id);
      if (!decoration) continue;
      memory = await window.vaultApi.updateMemoryDecoration({
        memoryId: activeMemory.id,
        id,
        x: decoration.x,
        y: decoration.y,
        width: decoration.width,
        height: decoration.height,
        rotation: decoration.rotation,
        label: decoration.label,
        color
      });
    }
    if (memory) setActiveMemory(memory);
  }

  async function removeMemoryDecoration(id: string) {
    if (!activeMemory) return;
    const memory = await window.vaultApi.removeMemoryDecoration({ memoryId: activeMemory.id, id });
    setActiveMemory(memory);
    await refreshMemories();
  }

  function selectMemoryItem(event: React.MouseEvent, itemId: string) {
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    setSelectedMemoryDecorationIds(additive ? current => current : new Set());
    setSelectedMemoryItemIds(current => {
      if (!additive) return new Set([itemId]);
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function selectMemoryDecoration(event: React.MouseEvent, decorationId: string) {
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    setSelectedMemoryItemIds(additive ? current => current : new Set());
    setSelectedMemoryDecorationIds(current => {
      if (!additive) return new Set([decorationId]);
      const next = new Set(current);
      if (next.has(decorationId)) next.delete(decorationId);
      else next.add(decorationId);
      return next;
    });
  }

  function clearMemorySelection() {
    setSelectedMemoryItemIds(new Set());
    setSelectedMemoryDecorationIds(new Set());
  }

  async function deleteSelectedMemoryPieces() {
    if (!activeMemory || selectedMemoryCount === 0) return;
    const count = selectedMemoryCount;
    if (!confirm(`Remove ${count} selected pinboard piece${count === 1 ? '' : 's'} from this memory? Original vault items will stay saved.`)) return;
    let memory: VaultMemoryDetail | null = activeMemory;
    for (const itemId of selectedMemoryItemIds) {
      memory = await window.vaultApi.removeItemFromMemory({ memoryId: activeMemory.id, itemId });
    }
    for (const id of selectedMemoryDecorationIds) {
      memory = await window.vaultApi.removeMemoryDecoration({ memoryId: activeMemory.id, id });
    }
    clearMemorySelection();
    if (memory) setActiveMemory(memory);
    await refreshMemories();
    setStatus(`Removed ${count} pinboard piece${count === 1 ? '' : 's'}.`);
  }

  function beginMemoryDecorationDrag(event: React.MouseEvent, decoration: { id: string; x: number; y: number }) {
    event.preventDefault();
    event.stopPropagation();
    setDraggingMemoryDecoration({
      id: decoration.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: decoration.x,
      originY: decoration.y
    });
  }

  function moveMemoryDecoration(event: React.MouseEvent) {
    if (!draggingMemoryDecoration || !activeMemory || resizingMemoryDecoration) return;
    const nextX = Math.max(0, draggingMemoryDecoration.originX + (event.clientX - draggingMemoryDecoration.startX) / memoryCanvasZoom);
    const nextY = Math.max(0, draggingMemoryDecoration.originY + (event.clientY - draggingMemoryDecoration.startY) / memoryCanvasZoom);
    setActiveMemory({
      ...activeMemory,
      decorations: activeMemory.decorations.map(decoration =>
        decoration.id === draggingMemoryDecoration.id
          ? { ...decoration, x: nextX, y: nextY }
          : decoration
      )
    });
  }

  function endMemoryDecorationDrag() {
    if (!draggingMemoryDecoration || !activeMemory) return;
    const decoration = activeMemory.decorations.find(entry => entry.id === draggingMemoryDecoration.id);
    setDraggingMemoryDecoration(null);
    if (decoration) {
      window.vaultApi.updateMemoryDecoration({
        memoryId: activeMemory.id,
        id: decoration.id,
        x: decoration.x,
        y: decoration.y,
        width: decoration.width,
        height: decoration.height,
        rotation: decoration.rotation,
        label: decoration.label,
        color: decoration.color
      }).then(setActiveMemory).catch(err => setStatus(`Could not save scrapbook item: ${err.message}`));
    }
  }

  function beginMemoryDecorationResize(event: React.MouseEvent, decoration: { id: string; width: number; height: number }) {
    event.preventDefault();
    event.stopPropagation();
    setResizingMemoryDecoration({
      id: decoration.id,
      startX: event.clientX,
      startY: event.clientY,
      originWidth: decoration.width,
      originHeight: decoration.height
    });
  }

  function resizeMemoryDecoration(event: React.MouseEvent) {
    if (!resizingMemoryDecoration || !activeMemory) return;
    const nextWidth = Math.max(28, resizingMemoryDecoration.originWidth + (event.clientX - resizingMemoryDecoration.startX) / memoryCanvasZoom);
    const nextHeight = Math.max(18, resizingMemoryDecoration.originHeight + (event.clientY - resizingMemoryDecoration.startY) / memoryCanvasZoom);
    setActiveMemory({
      ...activeMemory,
      decorations: activeMemory.decorations.map(decoration =>
        decoration.id === resizingMemoryDecoration.id
          ? { ...decoration, width: nextWidth, height: nextHeight }
          : decoration
      )
    });
  }

  function endMemoryDecorationResize() {
    if (!resizingMemoryDecoration || !activeMemory) return;
    const decoration = activeMemory.decorations.find(entry => entry.id === resizingMemoryDecoration.id);
    setResizingMemoryDecoration(null);
    if (decoration) {
      window.vaultApi.updateMemoryDecoration({
        memoryId: activeMemory.id,
        id: decoration.id,
        x: decoration.x,
        y: decoration.y,
        width: decoration.width,
        height: decoration.height,
        rotation: decoration.rotation,
        label: decoration.label,
        color: decoration.color
      }).then(setActiveMemory).catch(err => setStatus(`Could not save scrapbook size: ${err.message}`));
    }
  }

  function editMemoryDecorationLabel(decoration: { id: string; label: string; x: number; y: number; width: number; height: number; rotation: number; color: string; kind: string }) {
    if (!activeMemory || decoration.kind !== 'label') return;
    const label = window.prompt('Label text', decoration.label || 'caption');
    if (label === null) return;
    window.vaultApi.updateMemoryDecoration({
      memoryId: activeMemory.id,
      id: decoration.id,
      x: decoration.x,
      y: decoration.y,
      width: decoration.width,
      height: decoration.height,
      rotation: decoration.rotation,
      label: label.trim() || 'caption',
      color: decoration.color
    }).then(setActiveMemory).catch(err => setStatus(`Could not update label: ${err.message}`));
  }

  async function removeRelationshipThread(relationship: VaultRelationshipSummary) {
    if (!confirm('Remove this relationship? The items themselves will stay in your vault.')) return;
    await window.vaultApi.removeRelationship({
      itemId: relationship.source.id,
      relatedItemId: relationship.target.id
    });
    await refreshAllRelationships();
    await refreshDashboardSummary();
    if (selectedId) {
      window.vaultApi.listRelationships(selectedId)
        .then(setRelationships)
        .catch(err => setStatus(`Could not load relationships: ${err.message}`));
    }
    setStatus('Relationship removed.');
  }

  function beginMemoryPlayerDrag(event: React.MouseEvent) {
    if (!activeMemory) return;
    event.preventDefault();
    event.stopPropagation();
    setDraggingMemoryPlayer({
      startX: event.clientX,
      startY: event.clientY,
      originX: activeMemory.player_x ?? 40,
      originY: activeMemory.player_y ?? 40
    });
  }

  function moveMemoryPlayer(event: React.MouseEvent) {
    if (!draggingMemoryPlayer || !activeMemory) return;
    const nextX = Math.max(0, draggingMemoryPlayer.originX + (event.clientX - draggingMemoryPlayer.startX) / memoryCanvasZoom);
    const nextY = Math.max(0, draggingMemoryPlayer.originY + (event.clientY - draggingMemoryPlayer.startY) / memoryCanvasZoom);
    setActiveMemory({ ...activeMemory, player_x: nextX, player_y: nextY });
  }

  function endMemoryPlayerDrag() {
    if (!draggingMemoryPlayer || !activeMemory) return;
    const nextX = activeMemory.player_x ?? 40;
    const nextY = activeMemory.player_y ?? 40;
    setDraggingMemoryPlayer(null);
    window.vaultApi.updateMemoryPlayerPosition({ id: activeMemory.id, x: nextX, y: nextY })
      .then(setActiveMemory)
      .catch(err => setStatus(`Could not save music player position: ${err.message}`));
  }

  async function refreshMusicItems(page = 0) {
    const loadedAudio = await window.vaultApi.listItems({
      search: '',
      type: 'file',
      collectionId: '',
      audioOnly: true,
      limit: 100,
      offset: page * 100,
      sort: 'updated'
    });
    setMusicItems(loadedAudio);
    return loadedAudio;
  }

  function currentAudioPlaylist() {
    if (!currentAudioItem) return [...musicItems].filter(item => isAudioItem(item));

    const currentCollectionIds = new Set(currentAudioItem.collection_ids || []);
    return [...musicItems]
      .filter(item => isAudioItem(item))
      .filter(item => currentCollectionIds.size === 0 || (item.collection_ids || []).some(collectionId => currentCollectionIds.has(collectionId)))
      .sort((left, right) => (left.title || left.file_name || '').localeCompare(right.title || right.file_name || ''));
  }

  async function playAudioItem(item: VaultItem, options?: { autoStart?: boolean }) {
    if (!isAudioItem(item)) {
      setStatus('That file is not a playable audio type yet.');
      return;
    }

    const filePath = item.file_path || '';
    if (!filePath) {
      setStatus('Could not find the audio file on disk.');
      return;
    }

    const url = `file:///${filePath.replace(/\\/g, '/')}`;
    audioPlayerRef.current?.pause();
    setCurrentAudioItem(item);
    setCurrentAudioUrl(url);
    setIsAudioPlaying(false);
    setAudioProgress(0);
    setAudioDuration(0);
    const displayTitle = item.title || item.file_name || 'Audio';
    setStatus(options?.autoStart ? `Playing ${displayTitle}.` : `${displayTitle} loaded. Press Play to start.`);

    if (options?.autoStart) {
      window.setTimeout(() => {
        audioPlayerRef.current?.play()
          .then(() => {
            setIsAudioPlaying(true);
            setStatus(`Playing ${displayTitle}.`);
          })
          .catch(() => setStatus('Audio is loaded. Press Play to start.'));
      }, 0);
    }
  }

  async function playNextAudioItem() {
    if (!currentAudioItem) {
      setIsAudioPlaying(false);
      return;
    }

    const playlist = currentAudioPlaylist();
    const currentIndex = playlist.findIndex(item => item.id === currentAudioItem.id);
    const nextItem = currentIndex >= 0 ? playlist[currentIndex + 1] : null;

    if (nextItem) {
      await playAudioItem(nextItem, { autoStart: true });
    } else {
      setIsAudioPlaying(false);
      setStatus('Album or music list finished.');
    }
  }

  async function playPreviousAudioItem() {
    if (!currentAudioItem) return;

    const playlist = currentAudioPlaylist();
    const currentIndex = playlist.findIndex(item => item.id === currentAudioItem.id);
    const previousItem = currentIndex > 0 ? playlist[currentIndex - 1] : null;

    if (previousItem) {
      await playAudioItem(previousItem, { autoStart: isAudioPlaying });
    } else {
      scrubAudio(0);
      setStatus('Already at the first track in this list.');
    }
  }

  function recordCurrentAudioPlay() {
    if (!currentAudioItem) return;
    setAudioPlayStats(current => ({
      ...current,
      [currentAudioItem.id]: {
        plays: (current[currentAudioItem.id]?.plays || 0) + 1,
        lastPlayed: new Date().toISOString()
      }
    }));
  }

  function toggleAudioPlayback() {
    const player = audioPlayerRef.current;
    if (!player || !currentAudioUrl) return;
    if (player.paused) {
      player.play()
        .then(() => setIsAudioPlaying(true))
        .catch(() => setStatus('Could not start audio playback.'));
    } else {
      player.pause();
      setIsAudioPlaying(false);
    }
  }

  function pauseAppAudioPlayer() {
    audioPlayerRef.current?.pause();
    setIsAudioPlaying(false);
  }

  function scrubAudio(value: number) {
    const player = audioPlayerRef.current;
    if (!player || !Number.isFinite(audioDuration) || audioDuration <= 0) return;
    player.currentTime = value;
    setAudioProgress(value);
  }

  async function downloadOfflineMapTiles(tiles: MapTile[]) {
    if (tiles.length === 0) {
      setStatus('No map tiles needed yet.');
      return;
    }

    setIsDownloadingMap(true);
    setStatus(`Downloading ${tiles.length} map tile${tiles.length === 1 ? '' : 's'} for offline use...`);
    try {
      const result = await window.vaultApi.downloadMapTiles(tiles.map(tile => ({
        z: tile.z,
        x: tile.x,
        y: tile.y
      })));
      setMapTileBaseUrl(result.baseUrl);
      setStatus(`Offline map ready. Downloaded ${result.downloaded}, already had ${result.skipped}.`);
    } catch (err: any) {
      setStatus(`Map download failed: ${err.message}`);
    } finally {
      setIsDownloadingMap(false);
    }
  }

  async function openMusicLibrary() {
    if (!(await confirmSaveDirtyChanges())) return;
    setWorkspaceMode('music');
    setTypeFilter('file');
    setLibraryContentFilter('audio');
    setShowLibraryContentFilter(false);
    setLibraryFavoriteOnly(false);
    setSearch('');
    setSelectedCollectionId(null);
    setLibraryPage(0);
    const loadedAudio = await window.vaultApi.listItems({
      search: '',
      type: 'file',
      collectionId: '',
      audioOnly: true,
      limit: libraryPageSize,
      offset: 0,
      sort: itemSort
    });
    setItems(loadedAudio);
    setLibraryHasNextPage(loadedAudio.length >= libraryPageSize);
    setAppView('library');
  }

  async function runFullSearch(page = searchPage, searchOverride?: string, forceGlobal = false) {
  try {
    setStatus('Searching...');
    const currentPageSize = !forceGlobal && workspaceMode === 'photo' ? photoPageSize : searchPageSize;
    const effectiveSearchText = searchOverride ?? searchText;

    const results = await window.vaultApi.listItems({
      search: searchTagsOnly ? '' : effectiveSearchText,
      tag: '',
      type: searchType,
      collectionId: searchCollectionId,
      mediaOnly: !forceGlobal && workspaceMode === 'photo' && photoMediaFilter === 'media',
      imageOnly: !forceGlobal && workspaceMode === 'photo' && photoMediaFilter === 'image',
      videoOnly: !forceGlobal && workspaceMode === 'photo' && photoMediaFilter === 'video',
      audioOnly: !forceGlobal && workspaceMode === 'music',
      limit: currentPageSize,
      offset: page * currentPageSize,
      sort: searchSort
    });

    const tagQuery = effectiveSearchText.trim().toLowerCase();
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
    setSearchPage(page);
    setSearchHasNextPage(results.length >= currentPageSize);
    setStatus('');
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
    setSearchType(workspaceMode === 'photo' ? 'file' : 'all');
    setSearchResults([]);
    setStatus(workspaceMode === 'photo' ? 'Photo search cleared.' : 'Search cleared.');
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
    window.vaultApi.getItem(item.id)
      .then(fullItem => {
        if (fullItem) setSearchPreviewItem(current => current?.id === fullItem.id ? fullItem : current);
      })
      .catch(() => undefined);
  }

  async function openSearchItemInLibrary(item: VaultItem) {
    if (!(await confirmSaveDirtyChanges())) return;
    setSelectedCollectionId(null);
    setSearch('');
    setTypeFilter('all');
    setLibraryFavoriteOnly(false);
    setItems(current => [item, ...current.filter(existing => existing.id !== item.id)]);
    setSelectedId(item.id);
    setSearchPreviewItem(null);
    setAppView('library');
  }

  async function openDashboardLibrary(type: TypeFilter = 'all') {
    if (!(await confirmSaveDirtyChanges())) return;
    const loadedItems = await window.vaultApi.listItems({
      search: '',
      tag: '',
      type,
      collectionId: '',
      audioOnly: false,
      mediaOnly: false,
      documentOnly: type === 'file',
      limit: libraryPageSize,
      offset: 0,
      sort: itemSort
    });
    setWorkspaceMode('note');
    setSelectedCollectionId(null);
    setTypeFilter(type);
    setLibraryContentFilter('all');
    setShowLibraryContentFilter(type === 'all');
    setLibraryFavoriteOnly(false);
    setSearch('');
    setItems(loadedItems);
    setLibraryPage(0);
    setLibraryHasNextPage(loadedItems.length >= libraryPageSize);
    setSelectedId(loadedItems[0]?.id || null);
    setAppView('library');
  }

  async function openFavoritesLibrary() {
    if (!(await confirmSaveDirtyChanges())) return;
    const loadedItems = await window.vaultApi.listItems({
      search: '',
      tag: '',
      type: 'all',
      collectionId: '',
      favoriteOnly: true,
      limit: libraryPageSize,
      offset: 0,
      sort: itemSort
    });
    setWorkspaceMode('note');
    setSelectedCollectionId(null);
    setTypeFilter('all');
    setLibraryContentFilter('all');
    setShowLibraryContentFilter(false);
    setLibraryFavoriteOnly(true);
    setSearch('');
    setItems(loadedItems);
    setLibraryPage(0);
    setLibraryHasNextPage(loadedItems.length >= libraryPageSize);
    setSelectedId(loadedItems[0]?.id || null);
    setAppView('library');
  }

  async function openCollectionLibrary(collectionId: string) {
    if (!(await confirmSaveDirtyChanges())) return;
    const collection = collections.find(entry => entry.id === collectionId);
    setSelectedCollectionId(collectionId);
    setSelectedId(null);
    setTypeFilter(workspaceMode === 'music' ? 'file' : 'all');
    setLibraryContentFilter(workspaceMode === 'music' ? 'audio' : 'all');
    setShowLibraryContentFilter(false);
    setLibraryFavoriteOnly(false);
    setSearch('');
    if (collection?.mode === 'music') setWorkspaceMode('music');
    if (collection?.mode === 'photo') setWorkspaceMode('photo');
    setAppView('library');
  }

  async function openCollectionCard(collection: VaultCollection) {
    if ((collection.child_count || 0) > 0) {
      if (!(await confirmSaveDirtyChanges())) return;
      setCollectionPageParentId(collection.id);
      setSelectedCollectionId(null);
      setSelectedId(null);
      setSearch('');
      setAppView('collections');
      return;
    }

    await openCollectionLibrary(collection.id);
  }

  async function backCollectionPage() {
    if (collectionPageParent?.parent_id) {
      setCollectionPageParentId(collectionPageParent.parent_id);
      return;
    }
    if (collectionPageParentId) {
      setCollectionPageParentId(null);
      return;
    }
    await changeAppView('mode');
  }

  async function backToCollections() {
    if (!(await confirmSaveDirtyChanges())) return;
    if (activeCollectionParent) {
      setSelectedCollectionId(activeCollectionParent.id);
      setSelectedId(null);
      setSearch('');
      setAppView('library');
      return;
    }
    setSelectedCollectionId(null);
    setSelectedId(null);
    setAppView('collections');
  }

  function openImportWizard(scope: Exclude<ImportWizardScope, null>) {
    setCompletedImportChoices(new Set());
    setImportWizardScope(scope);
  }

  function focusedImportIntent() {
    if (workspaceMode === 'photo') return 'photo';
    if (workspaceMode === 'music') return 'music';
    return 'note';
  }

  function openFolderPicker(intent: ImportIntent = focusedImportIntent()) {
    pendingImportIntentRef.current = intent;
    window.setTimeout(() => onboardingFolderInputRef.current?.click(), 50);
  }

  function chooseImportPrompt(prompt: OnboardingImportChoice, returnScope: ImportWizardScope = importWizardScope) {
    setCompletedImportChoices(current => new Set(current).add(prompt));
    if (prompt === 'files') {
      pendingImportIntentRef.current = returnScope === 'photo' ? 'photo' : returnScope === 'journal' ? 'note' : 'auto';
      window.setTimeout(() => onboardingFilesInputRef.current?.click(), 50);
      return;
    }
    if (prompt === 'folder') {
      pendingImportIntentRef.current = returnScope === 'photo' ? 'photo' : returnScope === 'journal' ? 'note' : 'auto';
      window.setTimeout(() => onboardingFolderInputRef.current?.click(), 50);
      return;
    }
    if (prompt === 'google') {
      window.setTimeout(() => importGooglePhotosTakeout().catch(err => setStatus(err.message)), 50);
      return;
    }
    setStarterReturnScope(returnScope);
    setStarterImportPrompt(prompt);
  }

  async function openJournalTags() {
    if (!(await confirmSaveDirtyChanges())) return;
    setSettingsTab('tags');
    setAppView('settings');
  }

  async function openRelationshipItem(itemId: string) {
    if (!(await confirmSaveDirtyChanges())) return;
    const item = await window.vaultApi.getItem(itemId);
    if (!item) {
      setStatus('Could not open related item.');
      return;
    }
    setItems(current => [item, ...current.filter(existing => existing.id !== item.id)]);
    setSelectedCollectionId(null);
    setTypeFilter('all');
    setLibraryFavoriteOnly(false);
    setSelectedId(item.id);
    setAppView('library');
  }

  async function openDashboardItem(item: VaultItem) {
    if (!(await confirmSaveDirtyChanges())) return;
    setSelectedCollectionId(null);
    setTypeFilter('all');
    setLibraryFavoriteOnly(false);
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

  async function openPhotoView(options: { skipConfirm?: boolean; mediaFilter?: PhotoMediaFilter } = {}) {
    if (!options.skipConfirm && !(await confirmSaveDirtyChanges())) return;
    const mediaFilter = options.mediaFilter || 'media';
    setWorkspaceMode('photo');
    setPhotoWorkspaceView('library');
    setPhotoMediaFilter(mediaFilter);
    setSearchText('');
    setSearchTags([]);
    setSearchUntaggedOnly(false);
    setSearchTagsOnly(false);
    setSearchType('file');
    setSearchCollectionId('');
    setSearchViewMode('grid');
    setSearchSort('created');
    setSearchResults([]);
    setAppView('search');
    try {
      const photoResults = await window.vaultApi.listItems({
        search: '',
        type: 'file',
        collectionId: '',
        mediaOnly: mediaFilter === 'media',
        imageOnly: mediaFilter === 'image',
        videoOnly: mediaFilter === 'video',
        limit: photoPageSize,
        offset: 0,
        sort: 'created'
      });
      setSearchResults(photoResults);
      setSearchPage(0);
      setSearchHasNextPage(photoResults.length >= photoPageSize);
      setStatus('');
    } catch (err: any) {
      setStatus(`Could not load Photo View: ${err.message}`);
    }
  }

  async function openPhotoSearch(options: { skipConfirm?: boolean } = {}) {
    if (!options.skipConfirm && !(await confirmSaveDirtyChanges())) return;
    setWorkspaceMode('photo');
    setPhotoWorkspaceView('search');
    setPhotoMediaFilter('media');
    setSearchTags([]);
    setSearchUntaggedOnly(false);
    setSearchTagsOnly(false);
    setSearchType('file');
    setSearchCollectionId('');
    setSearchViewMode('grid');
    setSearchSort('created');
    setAppView('search');
    window.setTimeout(() => searchInputRef.current?.focus(), 50);
  }

  async function runDashboardSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchText.trim();
    if (!(await confirmSaveDirtyChanges())) return;
    setWorkspaceMode('note');
    setPhotoWorkspaceView('search');
    setPhotoMediaFilter('media');
    setSearchTags([]);
    setSearchUntaggedOnly(false);
    setSearchTagsOnly(false);
    setSearchType('all');
    setSearchCollectionId('');
    setSearchViewMode('cards');
    setAppView('search');
    if (query) {
      setStatus(`Searching for "${query}"...`);
    }
    window.setTimeout(() => runFullSearch(0, query, true).catch(err => setStatus(err.message)), 0);
  }

  function toggleFullscreen(selector: string) {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => undefined);
      return;
    }
    const element = document.querySelector(selector) as HTMLElement | null;
    element?.requestFullscreen?.()
      .then(() => setFullscreenSelector(selector))
      .catch(() => undefined);
  }

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) setFullscreenSelector('');
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    refresh().catch(err => setStatus(err.message));
    window.vaultApi.getBackupSettings()
      .then(settings => {
        setBackupDirectory(settings.backupDirectory);
        setBackupFrequency(settings.backupFrequency);
        setBackupRetentionCount(settings.backupRetentionCount);
        setBackupStats(settings.backupStats);
        setAllowNewImportTagSuggestions(settings.allowNewImportTagSuggestions !== false);
        setBackupEncryptionEnabled(Boolean(settings.backupEncryptionEnabled));
        setBackupEncryptionSaved(Boolean(settings.backupEncryptionEnabled));
      })
      .catch(err => setStatus(`Could not load backup settings: ${err.message}`));
    window.vaultApi.getLicenseStatus()
      .then(setLicenseStatus)
      .catch(err => setStatus(`Could not load license status: ${err.message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return window.vaultApi.onGooglePhotosImportProgress(progress => {
      setPhotoImportProgress(progress);
      setStatus(`${progress.phase}${progress.fileName ? `: ${progress.fileName}` : ''}`);
    });
  }, []);

  useEffect(() => {
    return window.vaultApi.onBackupImportProgress(progress => {
      setImportProgress(progress);
      setStatus(`${progress.phase}${progress.fileName ? `: ${progress.fileName}` : ''}`);
    });
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      refresh({ page: 0, includeMetadata: false }).catch(err => setStatus(err.message));
    }, 150);

    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, typeFilter, libraryContentFilter, libraryFavoriteOnly, showLibraryContentFilter, workspaceMode]);

  useEffect(() => {
    refresh({ page: 0, includeMetadata: false }).catch(err => setStatus(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCollectionId]);

  useEffect(() => {
    if (!selectedId) {
      setRelationships([]);
      return;
    }

    window.vaultApi.listRelationships(selectedId)
      .then(setRelationships)
      .catch(err => setStatus(`Could not load relationships: ${err.message}`));
  }, [selectedId]);

  useEffect(() => {
    if (detailTab !== 'info' || !isSelectedEditing || relationshipItems.length > 0) return;
    window.vaultApi.listItems({ search: '', tag: '', type: 'all', collectionId: '', limit: 250, offset: 0 })
      .then(setRelationshipItems)
      .catch(err => setStatus(`Could not load relationship candidates: ${err.message}`));
  }, [detailTab, isSelectedEditing, relationshipItems.length]);

  useEffect(() => {
    if (appView !== 'search') return;

    const timeout = window.setTimeout(() => {
      runFullSearch().catch(err => setStatus(err.message));
    }, 200);

    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, [appView, searchText, searchTags, searchType, searchTagsOnly, searchUntaggedOnly, searchCollectionId, photoMediaFilter]);

  useEffect(() => {
    if (appView === 'settings') {
      refreshLogs();
      refreshTags().catch(err => setStatus(`Could not load tags: ${err.message}`));
      refreshWatchedFolders().catch(err => setStatus(`Could not load watched folders: ${err.message}`));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appView]);

  useEffect(() => {
    if (appView !== 'relationships') return;
    window.vaultApi.listAllRelationships()
      .then(setAllRelationships)
      .catch(err => setStatus(`Could not load relationships: ${err.message}`));
    refreshDashboardSummary().catch(err => setStatus(`Could not refresh relationship count: ${err.message}`));
  }, [appView]);

  useEffect(() => {
    if (appView !== 'memories') return;
    refreshMemories().catch(err => setStatus(`Could not load memories: ${err.message}`));
  }, [appView]);

  useEffect(() => {
    if (appView !== 'memories' || !memoryItemSearch.trim()) {
      setMemorySearchResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      window.vaultApi.listItems({ search: memoryItemSearch, limit: 12 })
        .then(setMemorySearchResults)
        .catch(err => setStatus(`Could not search vault items: ${err.message}`));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [appView, memoryItemSearch]);

  useEffect(() => {
    if (appView !== 'locations') return;
    window.vaultApi.listLocations()
      .then(setLocationSummaries)
      .catch(err => setStatus(`Could not load locations: ${err.message}`));
  }, [appView]);

  useEffect(() => {
    if (appView !== 'notes') return;
    window.vaultApi.listItems({ search: '', type: 'note', collectionId: '', limit: libraryPageSize, offset: 0, sort: 'updated' })
      .then(setJournalNotes)
      .catch(err => setStatus(`Could not load notes: ${err.message}`));
  }, [appView]);

  useEffect(() => {
    if (appView !== 'mode') return;

    if (workspaceMode === 'note') {
      window.vaultApi.listItems({
        search: '',
        type: 'file',
        collectionId: '',
        documentOnly: true,
        limit: 8,
        offset: 0,
        sort: 'updated'
      })
        .then(setModeRecentFiles)
        .catch(err => setStatus(`Could not load recent files: ${err.message}`));
    }

    if (workspaceMode === 'photo') {
      window.vaultApi.listItems({
        search: '',
        type: 'file',
        collectionId: '',
        mediaOnly: true,
        limit: 12,
        offset: 0,
        sort: 'updated'
      })
        .then(setModeRecentMedia)
        .catch(err => setStatus(`Could not load recent media: ${err.message}`));
    }
  }, [appView, workspaceMode]);

  useEffect(() => {
    if (!quickNoteTagsOpen) return;

    function onPointerDown(event: MouseEvent) {
      const picker = quickNoteTagPickerRef.current;
      if (picker && !picker.contains(event.target as Node)) {
        setQuickNoteTagsOpen(false);
      }
    }

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [quickNoteTagsOpen]);

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
        setDraftCreatedAt(toDateTimeLocal(selected.created_at));
        setIsEditing(shouldEdit);
        setEditingItemId(shouldEdit ? selected.id : null);
        setDetailTab(shouldEdit ? 'notes' : 'preview');
        setNoteEditorMode(shouldEdit ? 'edit' : 'preview');
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
      setDraftCreatedAt('');
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
      setItems(current => [item, ...current.filter(existing => existing.id !== item.id)]);

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
      setDraftCreatedAt(toDateTimeLocal(item.created_at));

      refresh({
        search: '',
        type: 'all',
        collectionId: selectedCollectionId
      }).catch(err => setStatus(`Created note, but refresh failed: ${err.message}`));

      setSelectedId(item.id);
      setStatus('New note created. Start typing.');
    } catch (err: any) {
      setStatus(`Could not create note: ${err.message}`);
    } finally {
      setIsCreating(false);
    }
  }

  async function saveQuickNote() {
    const title = quickNoteTitle.trim() || 'Untitled note';
    const body = quickNoteBody.trim();
    if (!body && !quickNoteTitle.trim()) {
      setStatus('Write something before saving a quick note.');
      return;
    }

    try {
      setIsSavingQuickNote(true);
      const item = await window.vaultApi.createNote({
        title,
        body,
        tags: quickNoteTags,
        collectionIds: quickNoteCollectionId ? [quickNoteCollectionId] : []
      });
      setItems(current => [item, ...current.filter(existing => existing.id !== item.id)]);
      setQuickNoteTitle('');
      setQuickNoteBody('');
      setQuickNoteCollectionId('');
      setQuickNoteTags([]);
      setStatus('Quick note saved.');
      refresh().catch(err => setStatus(`Quick note saved, but refresh failed: ${err.message}`));
    } catch (err: any) {
      setStatus(`Could not save quick note: ${err.message}`);
    } finally {
      setIsSavingQuickNote(false);
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
      Boolean(selected.private) !== draftPrivate ||
      toDateTimeLocal(selected.created_at) !== draftCreatedAt
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
        createdAt: fromDateTimeLocal(draftCreatedAt) || selected?.created_at,
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
    if (nextView === 'collections') setCollectionPageParentId(null);
    setAppView(nextView);
  }

  async function changeWorkspaceMode(nextMode: WorkspaceMode) {
    if (nextMode === workspaceMode && appView === 'mode') return;
    if (!(await confirmSaveDirtyChanges())) return;
    setWorkspaceMode(nextMode);
    setCollectionPageParentId(null);
    setShowLibraryContentFilter(false);
    setLibraryContentFilter('all');
    setLibraryFavoriteOnly(false);
    setAppView('mode');
    setSearchPreviewItem(null);
  }

  async function changeTopNavMode(nextMode: TopNavMode) {
    if (nextMode === 'dashboard') {
      await changeAppView('dashboard');
      setSearchPreviewItem(null);
      return;
    }
    if (nextMode === 'settings') {
      await changeAppView('settings');
      setSearchPreviewItem(null);
      return;
    }

    await changeWorkspaceMode(nextMode);
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
  }, [isSelectedEditing, isSaving, selectedId, draftTitle, draftBody, draftTags, draftPrivate, draftCreatedAt, draftCollectionIds]);

  async function toggleFavorite() {
    if (!selected) return;

    const updated = await window.vaultApi.updateItem({
      id: selected.id,
      favorite: !selected.favorite
    });

    setItems(current => libraryFavoriteOnly && !updated.favorite
      ? current.filter(item => item.id !== updated.id)
      : current.map(item => item.id === updated.id ? updated : item)
    );
    setSelectedId(libraryFavoriteOnly && !updated.favorite ? null : updated.id);
    await refreshDashboardSummary();
    setStatus(updated.favorite ? 'Added to Starred.' : 'Removed from Starred.');
  }

  async function rotateImage(item: VaultItem, delta: number) {
    if (!isImageItem(item)) return;
    const nextRotation = (((Number(item.image_rotation || 0) + delta) % 360) + 360) % 360;
    const updated = await window.vaultApi.updateItem({
      id: item.id,
      imageRotation: nextRotation
    });

    setItems(current => current.map(item => item.id === updated.id ? updated : item));
    setSelectedId(updated.id);
    if (searchPreviewItem?.id === updated.id) setSearchPreviewItem(updated);
    setStatus(`Rotated image to ${nextRotation}°.`);
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
    const collectionName = newCollectionName.trim();
    if (!collectionName) return;

    try {
      const parentId = appView === 'collections' && collectionPageParentId
        ? collectionPageParentId
        : appView === 'library' && activeCollection
          ? activeCollection.id
          : undefined;
      const collection = await window.vaultApi.createCollection({ name: collectionName, mode: workspaceMode, parentId });
      await refresh();
      if (!parentId && appView !== 'collections') setSelectedCollectionId(collection.id);
      setNewCollectionName('');
      setShowNewCollectionInput(false);
      setStatus(parentId ? `Sub-collection created: ${collection.name}` : `Collection created: ${collection.name}`);
    } catch (err: any) {
      setStatus(`Could not create collection: ${err.message}`);
    }
  }

  async function attachExistingSubCollection() {
    const parent = collectionPageParent || activeCollection;
    if (!parent || !subCollectionAttachId) return;

    try {
      await window.vaultApi.setCollectionParent({ id: subCollectionAttachId, parentId: parent.id });
      const attached = collections.find(collection => collection.id === subCollectionAttachId);
      setSubCollectionAttachId('');
      await refresh();
      setStatus(`${attached?.name || 'Collection'} attached under ${parent.name}.`);
    } catch (err: any) {
      setStatus(`Could not attach sub-collection: ${err.message}`);
    }
  }

  async function deleteCollection() {
    if (!activeCollection) return;
    if ((activeCollection.count || 0) > 0) {
      setStatus(`Cannot delete "${activeCollection.name}" because it still has ${activeCollection.count} item${activeCollection.count === 1 ? '' : 's'}.`);
      return;
    }
    if ((activeCollection.child_count || 0) > 0) {
      setStatus(`Cannot delete "${activeCollection.name}" because it still has ${activeCollection.child_count} sub-collection${activeCollection.child_count === 1 ? '' : 's'}.`);
      return;
    }
    const confirmed = confirm(
      `Delete the collection "${activeCollection.name}"? Its notes and files will remain in your vault.`
    );
    if (!confirmed) return;

    await window.vaultApi.deleteCollection(activeCollection.id);
    setSelectedCollectionId(null);
    await refresh();
    setStatus(`Collection deleted: ${activeCollection.name}`);
  }

  async function deleteCollectionCard(collection: VaultCollection) {
    const itemCount = collection.count || 0;
    if (itemCount > 0) {
      setStatus(`Cannot delete "${collection.name}" because it still has ${itemCount} item${itemCount === 1 ? '' : 's'}.`);
      return;
    }
    const childCount = collection.child_count || 0;
    if (childCount > 0) {
      setStatus(`Cannot delete "${collection.name}" because it still has ${childCount} sub-collection${childCount === 1 ? '' : 's'}.`);
      return;
    }

    const confirmed = confirm(`Delete the empty collection "${collection.name}"?`);
    if (!confirmed) return;

    try {
      await window.vaultApi.deleteCollection(collection.id);
      if (selectedCollectionId === collection.id) {
        setSelectedCollectionId(null);
      }
      await refresh();
      setStatus(`Collection deleted: ${collection.name}`);
    } catch (err: any) {
      setStatus(`Could not delete collection: ${err.message}`);
    }
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

  async function prepareImportEntries(fileInputs: (WatchedFolderFile | { sourcePath: string; relativePath?: string })[], options?: { watchedFolderId?: string; intent?: ImportIntent }) {
    const intent = options?.intent || 'auto';
    const originalCount = fileInputs.length;
    const acceptedInputs = fileInputs.filter(file => importIntentAcceptsFile(intent, file));
    const skippedCount = originalCount - acceptedInputs.length;

    if (acceptedInputs.length === 0) {
      if (originalCount > 0 && intent !== 'auto') {
        throw new Error(`No ${importIntentLabel(intent)} files were found in that selection.`);
      }
      throw new Error('Could not read file path from Electron.');
    }

    setIsPreparingImport(true);
    pendingWatchedReviewFilesRef.current = acceptedInputs.filter((file): file is WatchedFolderFile =>
      'watchedFolderId' in file && Boolean(file.watchedFolderId)
    );
    pendingWatchedScanFolderIdRef.current = options?.watchedFolderId;
    const isWatchedScan = pendingWatchedReviewFilesRef.current.length > 0;
    setImportProgress({
      phase: isWatchedScan ? 'Preparing watched files' : 'Preparing files',
      current: isWatchedScan ? 1 : 0,
      total: isWatchedScan ? 1 : acceptedInputs.length
    });
    setStatus(isWatchedScan
      ? 'Preparing watched-folder files for review...'
      : `Preparing ${acceptedInputs.length} ${importIntentLabel(intent)} file${acceptedInputs.length === 1 ? '' : 's'} for review${skippedCount ? ` (${skippedCount} skipped)` : ''}...`
    );
    try {
      const previewMeta = new Map(acceptedInputs.map(file => [file.sourcePath, file]));
      const previews = await window.vaultApi.previewImport(acceptedInputs);
      setImportProgress({
        phase: 'Ready for review',
        current: isWatchedScan ? 1 : previews.length,
        total: isWatchedScan ? 1 : acceptedInputs.length
      });
      setImportDrafts(previews.map((preview, index) => ({
        ...preview,
        watchedFolderId: (previewMeta.get(preview.sourcePath) as WatchedFolderFile | undefined)?.watchedFolderId,
        watchedFolderPath: (previewMeta.get(preview.sourcePath) as WatchedFolderFile | undefined)?.watchedFolderPath,
        importId: `${preview.sourcePath}-${index}`,
        selected: preview.duplicateKind !== 'same-file',
        titleDraft: preview.title,
        tagsDraft: [...new Set([
          ...classificationTagsForImport(preview),
          ...preview.suggestedTags.filter(tag =>
            allowNewImportTagSuggestions || allTags.some(existing => existing.toLowerCase() === tag.toLowerCase())
          )
        ])],
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
      setStatus(`Review ${previews.length} file${previews.length === 1 ? '' : 's'} before importing${skippedCount ? `. Skipped ${skippedCount} unrelated file${skippedCount === 1 ? '' : 's'}` : ''}.`);
    } finally {
      setIsPreparingImport(false);
    }
  }

  async function prepareImport(files: File[], intent: ImportIntent = 'auto') {
    if (files.length === 0) return;

    const fileInputs = files.map(file => ({
      sourcePath: window.vaultApi.getPathForFile(file),
      relativePath: (file as any).webkitRelativePath || file.name
    })).filter(file => file.sourcePath);

    await prepareImportEntries(fileInputs, { intent });
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

  async function linkImportedMusicBatch(importedItems: VaultItem[]) {
    const audioItems = importedItems.filter(item => isAudioItem(item));
    if (audioItems.length < 2) return 0;

    let relationshipsCreated = 0;
    for (let index = 0; index < audioItems.length - 1; index += 1) {
      const currentTrack = audioItems[index];
      const nextTrack = audioItems[index + 1];
      try {
        await window.vaultApi.addRelationship({
          itemId: currentTrack.id,
          relatedItemId: nextTrack.id,
          note: 'Imported together in music batch'
        });
        relationshipsCreated += 1;
      } catch (err) {
        console.warn('Unable to link imported music tracks', err);
      }
    }

    return relationshipsCreated;
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
      const importedItems: VaultItem[] = [];

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
            collection = await window.vaultApi.createCollection({ name: collectionName, mode: workspaceMode });
            createdCollections.set(key, collection);
          }
          collectionIds.push(collection.id);
        }

        lastItem = await uploadDraft(draft, collectionIds);
        importedItems.push(lastItem);
      }

      setImportProgress({ phase: 'Linking related music', current: selectedDrafts.length, total: selectedDrafts.length });
      const musicRelationshipsCreated = await linkImportedMusicBatch(importedItems);

      await markPendingWatchedFilesHandled();

      setImportDrafts([]);
      setImportProgress(null);
      setAppView('library');
      await refresh();
      if (musicRelationshipsCreated > 0) {
        await window.vaultApi.listAllRelationships().then(setAllRelationships);
      }
      if (lastItem) {
        setSelectedId(lastItem.id);
        if (lastItem.type === 'note') {
          autoEditIdRef.current = lastItem.id;
          setIsEditing(true);
          setEditingItemId(lastItem.id);
        } else {
          autoEditIdRef.current = null;
          setIsEditing(false);
          setEditingItemId(null);
          setDetailTab('preview');
          setNoteEditorMode('preview');
        }
      }
      setStatus(
        `Imported ${selectedDrafts.length} file${selectedDrafts.length === 1 ? '' : 's'}.` +
        (musicRelationshipsCreated > 0 ? ` Linked ${musicRelationshipsCreated} music relationship${musicRelationshipsCreated === 1 ? '' : 's'}.` : '')
      );
    } catch (err: any) {
      setImportProgress(null);
      setStatus(`Import failed: ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  }

  async function onFileInput(e: React.ChangeEvent<HTMLInputElement>, explicitIntent?: ImportIntent) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (!(await confirmSaveDirtyChanges())) {
      e.target.value = '';
      return;
    }

    try {
      const intent = explicitIntent || pendingImportIntentRef.current || 'auto';
      pendingImportIntentRef.current = 'auto';
      await prepareImport(files, intent);
    } catch (err: any) {
      setImportProgress(null);
      setStatus(`Upload failed: ${err.message}`);
    } finally {
      pendingImportIntentRef.current = 'auto';
      e.target.value = '';
    }
  }

  async function importGooglePhotosTakeout() {
    if (!(await confirmSaveDirtyChanges())) return;
    setIsImportingPhotos(true);
    setPhotoImportProgress({ phase: 'Starting Google Photos import', current: 0, total: 1 });
    setStatus('Choose the folder that contains your Google Takeout .zip files...');
    try {
      const result = await window.vaultApi.importGooglePhotosTakeout();
      if (result.canceled) {
        setStatus('Google Photos import canceled.');
        return;
      }

      await refresh();
      await refreshTags();
      setSearchText('');
      setSearchTags([]);
      setSearchUntaggedOnly(false);
      setSearchTagsOnly(false);
      setSearchType('file');
      setSearchCollectionId(result.collectionId || '');
      setSearchViewMode('grid');
      setAppView('search');
      setSearchPreviewItem(null);

      setStatus(
        `Imported ${result.imported || 0} Google Photos file${result.imported === 1 ? '' : 's'} from ${result.zipCount || 0} ZIP${result.zipCount === 1 ? '' : 's'}. ` +
        `${result.matchedMetadata || 0} matched metadata sidecar${result.matchedMetadata === 1 ? '' : 's'}${result.skipped ? `, ${result.skipped} skipped` : ''}.`
      );
      const photoResults = await window.vaultApi.listItems({ search: '', type: 'file', collectionId: result.collectionId || '', mediaOnly: true, limit: photoPageSize, offset: 0, sort: 'created' });
      setSearchResults(photoResults);
      setSearchPage(0);
      setSearchHasNextPage(photoResults.length >= photoPageSize);
      setPhotoImportProgress(null);
    } catch (err: any) {
      setStatus(`Google Photos import failed: ${err.message}`);
    } finally {
      setIsImportingPhotos(false);
      window.setTimeout(() => setPhotoImportProgress(null), 2500);
    }
  }

  async function importNotionExport(sourceType: 'zip' | 'folder' = 'zip') {
    if (!(await confirmSaveDirtyChanges())) return;
    setImportProgress({ phase: 'Starting Notion import', current: 0, total: 1 });
    setStatus(sourceType === 'folder' ? 'Choose an extracted Notion export folder...' : 'Choose a Notion export ZIP...');
    try {
      const result = await window.vaultApi.importNotionExport({ sourceType });
      if (result.canceled) {
        setStatus('Notion import canceled.');
        return;
      }

      await refresh();
      await refreshTags();
      await window.vaultApi.listAllRelationships().then(setAllRelationships);
      setWorkspaceMode('note');
      setAppView('notes');
      if (result.lastItem?.id) {
        setSelectedId(result.lastItem.id);
      }
      setStatus(
        `Imported ${result.importedNotes || 0} Notion page${result.importedNotes === 1 ? '' : 's'}, ` +
        `${result.importedFiles || 0} asset${result.importedFiles === 1 ? '' : 's'}, and ` +
        `${result.relationships || 0} relationship${result.relationships === 1 ? '' : 's'}` +
        `${result.duplicateSkipped ? ` (${result.duplicateSkipped} duplicate${result.duplicateSkipped === 1 ? '' : 's'} skipped)` : ''}.`
      );
    } catch (err: any) {
      setStatus(`Notion import failed: ${err.message}`);
    } finally {
      window.setTimeout(() => setImportProgress(null), 2000);
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
      let delta = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1;
      if (libraryViewMode === 'grid') {
        const gridCards = Array.from(itemsListRef.current?.querySelectorAll<HTMLElement>('.item-card') || []);
        const firstTop = gridCards[0]?.offsetTop ?? 0;
        const columnCount = Math.max(1, gridCards.filter(card => Math.abs(card.offsetTop - firstTop) < 4).length);
        if (event.key === 'ArrowUp') delta = -columnCount;
        else if (event.key === 'ArrowDown') delta = columnCount;
        else if (event.key === 'ArrowLeft') delta = -1;
        else if (event.key === 'ArrowRight') delta = 1;
      }
      const nextIndex = currentIndex === -1
        ? (delta > 0 ? 0 : sortedItems.length - 1)
        : Math.max(0, Math.min(sortedItems.length - 1, currentIndex + delta));

      selectItem(sortedItems[nextIndex].id).catch(() => undefined);
    }

    window.addEventListener('keydown', navigateItems);
    return () => window.removeEventListener('keydown', navigateItems);
  }, [appView, isSelectingItems, libraryViewMode, sortedItems, selectedId]);

  useEffect(() => {
    if (appView !== 'library' || !selectedId) return;
    requestAnimationFrame(() => {
      const selectedCard = itemCardRefs.current.get(selectedId);
      selectedCard?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      selectedCard?.focus({ preventScroll: true });
    });
  }, [appView, selectedId]);

  useEffect(() => {
    if (!resizingPane) return;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    const onMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      if (resizingPane === 'sidebar') setSidebarWidth(Math.max(180, Math.min(460, event.clientX)));
      else {
        const availableWidth = Math.max(320, window.innerWidth - 180);
        setListWidth(Math.max(250, Math.min(availableWidth, event.clientX)));
      }
    };
    const onMouseUp = () => setResizingPane(null);
    const onCancelResize = () => setResizingPane(null);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', onCancelResize);
    document.addEventListener('mouseleave', onCancelResize);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onCancelResize);
      document.removeEventListener('mouseleave', onCancelResize);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
    };
  }, [resizingPane]);

  async function deleteSelectedItems() {
    const ids = [...selectedItemIds];
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} selected item${ids.length === 1 ? '' : 's'}?`)) return;
    const result = await window.vaultApi.deleteItems(ids);
    exitBulkSelectionMode();
    setSelectedId(null);
    await refresh();
    setStatus(`Deleted ${result.deleted} items.`);
  }

  function exitBulkSelectionMode() {
    setSelectedItemIds(new Set());
    setBulkTags(new Set());
    setBulkTagTouched(new Set());
    setBulkCollections(new Set());
    setBulkCollectionTouched(new Set());
    setShowBulkTagPicker(false);
    setShowBulkCollectionPicker(false);
    setIsSelectingItems(false);
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
    exitBulkSelectionMode();
    setStatus('Updated tags for selected items.');
  }

  async function addCollectionToSelectedItems(collectionId: string) {
    const ids = [...selectedItemIds];
    if (ids.length === 0 || !collectionId) return;

    const result = await window.vaultApi.addCollectionToItems(ids, collectionId);
    await refresh();
    const collection = collections.find(entry => entry.id === collectionId);
    exitBulkSelectionMode();
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
    exitBulkSelectionMode();
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

  async function openVaultDataFolder() {
    const result = await window.vaultApi.openVaultDataFolder();
    setStatus(`Opened vault data folder: ${result.path}`);
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

  async function saveBackupEncryption(enabled: boolean) {
    const password = backupEncryptionPassword;
    if (enabled && password.length < 8) {
      setStatus('Backup password must be at least 8 characters.');
      return;
    }
    if (!enabled && backupEncryptionSaved && !password) {
      setStatus('Enter your current backup password before turning encrypted backups off.');
      return;
    }
    const result = await window.vaultApi.setBackupEncryption({ enabled, password });
    setBackupEncryptionEnabled(result.backupEncryptionEnabled);
    setBackupEncryptionSaved(result.backupEncryptionEnabled);
    setBackupEncryptionPassword('');
    setStatus(result.backupEncryptionEnabled
      ? 'Encrypted backups are on. Future automatic restore backups require this password to import.'
      : 'Encrypted backups are off.'
    );
  }

  async function activateLicense() {
    try {
      const result = await window.vaultApi.activateLicense(licenseKeyInput);
      setLicenseStatus(result);
      setLicenseKeyInput('');
      setStatus(`License activated${result.licenseName ? ` for ${result.licenseName}` : ''}.`);
    } catch (err: any) {
      setStatus(`License failed: ${err.message}`);
    }
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

  async function repairGooglePhotosMetadata() {
    if (!(await confirmSaveDirtyChanges())) return;
    setIsRepairingPhotos(true);
    setPhotoRepairResult(null);
    setPhotoImportProgress({ phase: 'Starting Google Photos metadata repair', current: 0, total: 1 });
    setStatus('Choose the same folder that contains your Google Takeout .zip files...');
    try {
      const result = await window.vaultApi.repairGooglePhotosMetadata();
      if (result.canceled) {
        setStatus('Google Photos metadata repair canceled.');
        return;
      }

      setPhotoRepairResult(result);
      await refresh();
      setStatus(
        `Metadata repair scanned ${result.scannedItems || 0} Google Photos item${result.scannedItems === 1 ? '' : 's'}; ` +
        `matched ${result.matched || 0}, updated ${result.updated || 0}, unmatched ${result.unmatched || 0}.`
      );
    } catch (err: any) {
      setStatus(`Google Photos metadata repair failed: ${err.message}`);
    } finally {
      setIsRepairingPhotos(false);
      window.setTimeout(() => setPhotoImportProgress(null), 2500);
    }
  }

  function updateSlashQuery(value: string, cursor: number | null) {
    if (cursor === null) {
      setSlashQuery('');
      setNoteSlashMenuOpen(false);
      setNoteSlashSelectedIndex(0);
      return;
    }
    const lineStart = value.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
    const currentLine = value.slice(lineStart, cursor);
    const match = currentLine.match(/^\/([a-z0-9-]*)$/i);
    setSlashQuery(match ? match[1].toLowerCase() : '');
    setNoteSlashMenuOpen(Boolean(match));
    setNoteSlashSelectedIndex(0);
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

  function insertLink() {
    if (!isSelectedEditing) return;

    const url = window.prompt('Paste the URL');
    if (!url?.trim()) return;

    const editor = noteEditorRef.current;
    const start = editor?.selectionStart ?? draftBody.length;
    const end = editor?.selectionEnd ?? start;
    const selectedText = draftBody.slice(start, end);
    const label = selectedText || window.prompt('Link text', url.trim()) || url.trim();
    const insert = `[${label.trim() || url.trim()}](${url.trim()})`;

    if (noteEditorMode === 'preview') {
      setNoteEditorMode('edit');
    }

    replaceEditorRange(start, end, insert, insert.length);
  }

  function runSlashCommand(command: SlashCommand) {
    const editor = noteEditorRef.current;
    if (!editor || !isSelectedEditing) return;
    const cursor = editor.selectionStart ?? draftBody.length;
    const lineStart = draftBody.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
    replaceEditorRange(lineStart, cursor, command.insert, command.selectOffset);
    setSlashQuery('');
    setNoteSlashMenuOpen(false);
    setNoteSlashSelectedIndex(0);
  }

  function handleNoteKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!isSelectedEditing) return;
    const visibleCommands = slashCommands.filter(command => command.id.startsWith(slashQuery)).slice(0, 6);
    if (noteSlashMenuOpen && visibleCommands.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setNoteSlashSelectedIndex(current => event.key === 'ArrowDown'
        ? (current + 1) % visibleCommands.length
        : (current - 1 + visibleCommands.length) % visibleCommands.length
      );
      return;
    }
    if (noteSlashMenuOpen && visibleCommands.length > 0 && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault();
      runSlashCommand(visibleCommands[Math.min(noteSlashSelectedIndex, visibleCommands.length - 1)]);
    }
  }

  async function addRelationship(relatedItemId: string) {
    if (!selectedId) return;
    try {
      const updated = await window.vaultApi.addRelationship({ itemId: selectedId, relatedItemId });
      setRelationships(updated);
      await refreshDashboardSummary();
      if (appView === 'relationships') {
        setAllRelationships(await window.vaultApi.listAllRelationships());
      }
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
      await refreshDashboardSummary();
      if (appView === 'relationships') {
        setAllRelationships(await window.vaultApi.listAllRelationships());
      }
      setStatus('Relationship removed.');
    } catch (err: any) {
      setStatus(`Could not remove relationship: ${err.message}`);
    }
  }

  async function importBackup() {
    if (!(await confirmSaveDirtyChanges())) return;
    const ok = confirm('Importing a backup will replace the current local vault. Continue?');

    if (!ok) return;

    setImportProgress({ phase: 'Waiting for backup selection', current: 0, total: 1 });
    setStatus('Choose a backup to import.');

    try {
      let result = await window.vaultApi.importBackup();
      if (!result.canceled) {
        // handled below
      }

      if (!result.canceled) {
        setSelectedId(null);
        setImportProgress({ phase: 'Refreshing restored vault', current: 1, total: 1 });
        await refresh();
        setStatus('Backup restored.');
        window.setTimeout(() => setImportProgress(null), 2500);
      } else {
        setImportProgress(null);
        setStatus('Backup import canceled.');
      }
    } catch (err: any) {
      if (String(err.message || '').includes('encrypted')) {
        const password = prompt('This backup is encrypted. Enter the backup password:');
        if (password) {
          try {
            const result = await window.vaultApi.importBackup({ password });
            if (!result.canceled) {
              setSelectedId(null);
              setImportProgress({ phase: 'Refreshing restored vault', current: 1, total: 1 });
              await refresh();
              setStatus('Encrypted backup restored.');
              window.setTimeout(() => setImportProgress(null), 2500);
              return;
            }
          } catch (retryErr: any) {
            setImportProgress(null);
            setStatus(`Backup import failed: ${retryErr.message}`);
            return;
          }
        }
      }
      setImportProgress(null);
      setStatus(`Backup import failed: ${err.message}`);
    }
  }

  function finishOnboarding(message = 'Welcome guide closed. You can reopen it from Settings anytime.') {
    localStorage.setItem('vault-notes-onboarding-complete', 'true');
    setShowOnboarding(false);
    setStatus(message);
  }

  function reopenOnboarding() {
    setOnboardingStep(0);
    setShowOnboarding(true);
  }

  function onboardingNext() {
    setOnboardingStep(step => Math.min(onboardingSteps.length - 1, step + 1));
  }

  function onboardingBack() {
    setOnboardingStep(step => Math.max(0, step - 1));
  }

  function completeOnboarding() {
    localStorage.setItem('vault-notes-onboarding-complete', 'true');
    setShowOnboarding(false);

    if (onboardingStartChoice === 'manual') {
      setAppView('dashboard');
      setStatus('Welcome guide complete. Start from the Dashboard whenever you are ready.');
      return;
    }

    if (onboardingImportChoice === 'google' || onboardingImportChoice === 'icloud') {
      setWorkspaceMode('photo');
      setAppView('mode');
      setCompletedImportChoices(new Set());
      setImportWizardScope('photo');
      setStatus('Choose photo imports to run. You can run more than one, then click Done.');
      window.setTimeout(() => chooseImportPrompt(onboardingImportChoice, 'photo'), 100);
      return;
    }
    if (onboardingImportChoice === 'files' || onboardingImportChoice === 'folder' || onboardingImportChoice === 'onenote' || onboardingImportChoice === 'notion') {
      setWorkspaceMode('note');
      setAppView('mode');
      setCompletedImportChoices(new Set());
      setImportWizardScope('journal');
      setStatus('Choose notes imports to run. You can run more than one, then click Done.');
      window.setTimeout(() => chooseImportPrompt(onboardingImportChoice, 'journal'), 100);
      return;
    }

    setStatus('Welcome guide complete.');
  }

  const currentOnboardingStep = onboardingSteps[onboardingStep];
  const starterImportDetails = starterImportPrompt === 'notion'
    ? {
        label: 'Notion',
        title: 'Import from Notion',
        body: 'Export from Notion as Markdown & CSV, then choose the ZIP or extracted folder. Note Vault will import Markdown pages as notes, images/files as vault files, create collections from the page tree, and create relationships from Notion page links and embedded assets.',
        fileButton: 'Select Notion ZIP',
        folderButton: 'Select extracted Notion folder'
      }
    : starterImportPrompt === 'onenote'
      ? {
          label: 'OneNote',
          title: 'Import from OneNote',
          body: 'Choose OneNote exported notebooks, sections, PDFs, packages, or an exported folder. Note Vault will treat them as local files and send them through import review.',
          fileButton: 'Select OneNote files',
          folderButton: 'Select OneNote export folder'
        }
      : starterImportPrompt === 'icloud'
        ? {
            label: 'iCloud',
            title: 'Import from iCloud Photos',
            body: 'Choose downloaded iCloud media files or an exported iCloud Photos folder. This stays local and uses the standard import review before anything is added.',
            fileButton: 'Select iCloud media files',
            folderButton: 'Select iCloud Photos folder'
          }
        : starterImportPrompt === 'google'
          ? {
              label: 'Google Photos',
              title: 'Import from Google Photos',
              body: 'Choose Google Takeout ZIPs. Note Vault will import photos and videos, preserve metadata when available, and keep everything local.',
              fileButton: 'Select Google Takeout ZIPs',
              folderButton: undefined
            }
          : null;
  const showSidebarDrilldown = false;

  return (
    <div
      className={`app-shell ${isDarkMode ? 'theme-dark' : ''} ${appView === 'library' && isDetailFocus ? 'detail-focus' : ''} ${appView === 'library' && isListFocus ? 'list-focus' : ''} ${resizingPane ? 'is-resizing' : ''}`}
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

      {licenseStatus?.locked && (
        <div className="onboarding-backdrop">
          <section className="onboarding-dialog starter-import-dialog locked-license-dialog" role="dialog" aria-modal="true" aria-label="Note Vault license required">
            <div className="onboarding-step">
              <span className="dashboard-kicker">License required</span>
              <h2>Your 30-day Note Vault trial has ended.</h2>
              <p>
                Enter a license key to unlock the app. Your vault stays local, nothing is deleted,
                and you can still export or open your data below.
              </p>
              <div className="settings-control">
                <label htmlFor="locked-license-key">License key</label>
                <input id="locked-license-key" value={licenseKeyInput} onChange={event => setLicenseKeyInput(event.target.value)} placeholder="Paste license key..." />
                <button type="button" onClick={activateLicense}>Unlock Note Vault</button>
              </div>
              <div className="locked-export-panel">
                <div>
                  <strong>Your data is still yours</strong>
                  <small>
                    Export a readable ZIP, open existing restore backups, or open the local vault folder.
                    These options remain available even after the trial ends.
                  </small>
                </div>
                <div className="locked-export-actions">
                  <button type="button" onClick={exportVault}>Export Readable ZIP</button>
                  <button type="button" onClick={openBackupFolder}>Open Backup Folder</button>
                  <button type="button" onClick={openVaultDataFolder}>Open Vault Data Folder</button>
                </div>
              </div>
              {status && <div className="locked-status">{status}</div>}
            </div>
          </section>
        </div>
      )}

      {showOnboarding && (
        <div className="onboarding-backdrop">
          <section className="onboarding-dialog" role="dialog" aria-modal="true" aria-label="Welcome to Note Vault">
            <div className="onboarding-progress">
              {onboardingSteps.map((step, index) => (
                <span
                  key={step}
                  className={index === onboardingStep ? 'active' : index < onboardingStep ? 'complete' : ''}
                  aria-label={`Step ${index + 1}`}
                />
              ))}
            </div>

            {currentOnboardingStep === 'welcome' && (
              <div className="onboarding-step">
                <span className="dashboard-kicker">Welcome</span>
                <h2>Build a private vault for notes, files, photos, audio, and the relationships between them.</h2>
                <p>
                  Note Vault is local-first. It is meant to help you keep lyrics, ideas, references,
                  memories, samples, photos, documents, and project material together without needing
                  the internet to browse your own stuff.
                </p>
                <div className="onboarding-mini-grid">
                  <div><strong>Notes</strong><small>Write notes, lyrics, thoughts, plans, and research.</small></div>
                  <div><strong>Photos</strong><small>Browse images/videos and import Google Photos Takeout.</small></div>
                  <div><strong>Music</strong><small>Keep audio, samples, demos, and track notes close by.</small></div>
                </div>
              </div>
            )}

            {currentOnboardingStep === 'navigation' && (
              <div className="onboarding-step">
                <span className="dashboard-kicker">How to move around</span>
                <h2>Use the top switcher first, then drill into the cards.</h2>
                <p>
                  Dashboard is the big overview. Notes, Photos, and Music each have their own focused
                  dashboard with actions that belong to that mode. Home and Settings stay in the top-right.
                </p>
                <div className="onboarding-mini-grid">
                  <div><strong>1. Pick a mode</strong><small>Dashboard, Notes, Photos, or Music stays at the top.</small></div>
                  <div><strong>2. Choose a card</strong><small>Cards open the work area for browsing, searching, importing, or organizing.</small></div>
                  <div><strong>3. Use Settings later</strong><small>Backups, watched folders, logs, tags, and this guide live there.</small></div>
                </div>
              </div>
            )}

            {currentOnboardingStep === 'start' && (
              <div className="onboarding-step">
                <span className="dashboard-kicker">Ready to start</span>
                <h2>How do you want to start?</h2>
                <p>
                  Manual lets you land on the Dashboard and explore at your own pace. Wizard starts a
                  guided upload or import path right after this screen.
                </p>
                <div className="onboarding-start-grid">
                  <button
                    type="button"
                    className={onboardingStartChoice === 'manual' ? 'selected' : ''}
                    onClick={() => setOnboardingStartChoice('manual')}
                  >
                    <strong>Manual</strong>
                    <small>Open the Dashboard and start whenever you are ready.</small>
                  </button>
                  <button
                    type="button"
                    className={onboardingStartChoice === 'wizard' ? 'selected' : ''}
                    onClick={() => setOnboardingStartChoice('wizard')}
                  >
                    <strong>Wizard</strong>
                    <small>Pick a guided setup path for files, folders, or imports.</small>
                  </button>
                </div>
                {onboardingStartChoice === 'wizard' && (
                  <>
                    <p className="onboarding-subcopy">What do you want the wizard to start with?</p>
                <div className="onboarding-choice-grid">
                  <button
                    type="button"
                    className={onboardingImportChoice === 'files' ? 'selected' : ''}
                    onClick={() => setOnboardingImportChoice('files')}
                  >
                    <span className="onboarding-brand-badge">Local</span>
                    <strong>Upload files</strong>
                    <small>Choose one or many files from your computer.</small>
                  </button>
                  <button
                    type="button"
                    className={onboardingImportChoice === 'folder' ? 'selected' : ''}
                    onClick={() => setOnboardingImportChoice('folder')}
                  >
                    <span className="onboarding-brand-badge">Folder</span>
                    <strong>Upload a folder</strong>
                    <small>Bring in a folder structure and review before saving.</small>
                  </button>
                  <button
                    type="button"
                    className={onboardingImportChoice === 'google' ? 'selected' : ''}
                    onClick={() => setOnboardingImportChoice('google')}
                  >
                    <span className="onboarding-brand-badge">Google</span>
                    <strong>Google Takeout</strong>
                    <small>Import Google Photos ZIPs with metadata when available.</small>
                  </button>
                  <button
                    type="button"
                    className={onboardingImportChoice === 'icloud' ? 'selected' : ''}
                    onClick={() => setOnboardingImportChoice('icloud')}
                  >
                    <span className="onboarding-brand-badge">iCloud</span>
                    <strong>iCloud Photos</strong>
                    <small>Choose exported/downloaded iCloud photo folders or media files.</small>
                  </button>
                  <button
                    type="button"
                    className={onboardingImportChoice === 'onenote' ? 'selected' : ''}
                    onClick={() => setOnboardingImportChoice('onenote')}
                  >
                    <span className="onboarding-brand-badge">OneNote</span>
                    <strong>OneNote</strong>
                    <small>Import exported notebooks, PDFs, packages, or copied note files.</small>
                  </button>
                  <button
                    type="button"
                    className={onboardingImportChoice === 'notion' ? 'selected' : ''}
                    onClick={() => setOnboardingImportChoice('notion')}
                  >
                    <span className="onboarding-brand-badge">Notion</span>
                    <strong>Notion</strong>
                    <small>Import Notion export ZIPs, Markdown, CSV, or exported folders.</small>
                  </button>
                </div>
                  </>
                )}
              </div>
            )}

            {currentOnboardingStep === 'connect' && (
              <div className="onboarding-step">
                <span className="dashboard-kicker">Make it useful later</span>
                <h2>Tags, collections, and relationships are how the vault becomes more than a folder.</h2>
                <p>
                  Tags describe what something is. Collections group things into projects, albums, ideas,
                  or folders. Relationships connect two items directly — like a lyric note to a demo track,
                  or a photo to the story behind it.
                </p>
                <div className="onboarding-mini-grid">
                  <div><strong>Tags</strong><small>Searchable labels like #lyrics, #license, #concert.</small></div>
                  <div><strong>Collections</strong><small>Bundles for projects, topics, albums, or trips.</small></div>
                  <div><strong>Relationships</strong><small>Direct links between notes, files, photos, and audio.</small></div>
                </div>
              </div>
            )}

            <div className="onboarding-footer">
              <button type="button" className="ghost-button" onClick={() => finishOnboarding('Welcome guide skipped.')}>Skip for now</button>
              <div>
                {onboardingStep > 0 && <button type="button" className="ghost-button" onClick={onboardingBack}>Back</button>}
                {onboardingStep < onboardingSteps.length - 1 ? (
                  <button type="button" onClick={onboardingNext}>Next</button>
                ) : (
                  <button type="button" onClick={completeOnboarding}>Done</button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {importWizardScope && (
        <div className="onboarding-backdrop">
          <section className="onboarding-dialog starter-import-dialog import-wizard-dialog" role="dialog" aria-modal="true" aria-label={`${importWizardScope === 'journal' ? 'Notes' : 'Photo'} import wizard`}>
            <div className="onboarding-step">
              <span className="dashboard-kicker">{importWizardScope === 'journal' ? 'Notes' : 'Photo'} Import Wizard</span>
              <h2>{importWizardScope === 'journal' ? 'Bring in notes and documents' : 'Bring in photos and videos'}</h2>
              <p>
                {importWizardScope === 'journal'
                  ? 'Choose how you want to add writing, references, notebooks, or exported workspaces.'
                  : 'Choose a photo source. Everything stays local and goes through Note Vault import/review.'}
              </p>
              <div className="onboarding-choice-grid import-wizard-choice-grid">
                {importWizardScope === 'journal' ? (
                  <>
                    <button type="button" className={completedImportChoices.has('notion') ? 'completed' : ''} onClick={() => chooseImportPrompt('notion')}>
                      <span className="onboarding-brand-badge">Notion</span>
                      <strong>Notion export</strong>
                      <small>Import ZIPs or extracted folders with pages, assets, and relationships.</small>
                    </button>
                    <button type="button" className={completedImportChoices.has('onenote') ? 'completed' : ''} onClick={() => chooseImportPrompt('onenote')}>
                      <span className="onboarding-brand-badge">OneNote</span>
                      <strong>OneNote notebook</strong>
                      <small>Import .onepkg, .one, PDFs, or exported OneNote folders.</small>
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className={completedImportChoices.has('google') ? 'completed' : ''} onClick={() => chooseImportPrompt('google')}>
                      <span className="onboarding-brand-badge">Google</span>
                      <strong>Google Takeout</strong>
                      <small>Import Google Photos ZIPs with metadata when available.</small>
                    </button>
                    <button type="button" className={completedImportChoices.has('icloud') ? 'completed' : ''} onClick={() => chooseImportPrompt('icloud')}>
                      <span className="onboarding-brand-badge">iCloud</span>
                      <strong>iCloud Photos</strong>
                      <small>Choose downloaded iCloud media files or an exported folder.</small>
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="onboarding-footer">
              <button type="button" className="ghost-button" onClick={() => {
                setImportWizardScope(null);
                setCompletedImportChoices(new Set());
                setStatus('Import wizard closed.');
              }}>
                Cancel
              </button>
              <div>
                <button type="button" onClick={() => {
                  setImportWizardScope(null);
                  setCompletedImportChoices(new Set());
                  setStatus('Import wizard complete.');
                }}>
                  Done
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {starterImportDetails && (
        <div className="onboarding-backdrop">
          <section className="onboarding-dialog starter-import-dialog" role="dialog" aria-modal="true" aria-label={starterImportDetails.title}>
            <div className="onboarding-step">
              <span className="dashboard-kicker">{starterImportDetails.label} Import</span>
              <h2>{starterImportDetails.title}</h2>
              <p>{starterImportDetails.body}</p>
              <div className="onboarding-start-grid">
                <button
                  type="button"
                  disabled={isPreparingImport}
                  onClick={() => {
                    setStarterImportPrompt(null);
                    if (starterImportPrompt === 'notion') {
                      window.setTimeout(() => importNotionExport('zip').catch(err => setStatus(err.message)), 50);
                    } else if (starterImportPrompt === 'google') {
                      window.setTimeout(() => importGooglePhotosTakeout().catch(err => setStatus(err.message)), 50);
                    } else {
                      pendingImportIntentRef.current = starterReturnScope === 'photo' ? 'photo' : starterReturnScope === 'journal' ? 'note' : 'auto';
                      window.setTimeout(() => onboardingFilesInputRef.current?.click(), 50);
                    }
                  }}
                >
                  <strong>{starterImportDetails.fileButton}</strong>
                  <small>{starterImportPrompt === 'notion'
                    ? 'Choose the Notion export ZIP. Note Vault will preserve page structure, assets, and relationships.'
                    : starterImportPrompt === 'google'
                      ? 'Choose one or more Google Takeout ZIPs from Google Photos.'
                    : 'Use this for ZIPs, Markdown, CSV, PDFs, packages, images, audio, videos, or loose exported files.'}</small>
                </button>
                {starterImportDetails.folderButton && (
                  <button
                    type="button"
                    disabled={isPreparingImport}
                    onClick={() => {
                      if (starterImportPrompt === 'notion') {
                        setStarterImportPrompt(null);
                        window.setTimeout(() => importNotionExport('folder').catch(err => setStatus(err.message)), 50);
                      } else {
                        setStarterImportPrompt(null);
                        pendingImportIntentRef.current = starterReturnScope === 'photo' ? 'photo' : starterReturnScope === 'journal' ? 'note' : 'auto';
                        window.setTimeout(() => onboardingFolderInputRef.current?.click(), 50);
                      }
                    }}
                  >
                    <strong>{starterImportDetails.folderButton}</strong>
                    <small>Use this when the export is already extracted into a folder.</small>
                  </button>
                )}
              </div>
            </div>
            <div className="onboarding-footer">
              <div>
                {starterReturnScope && (
                  <button type="button" className="ghost-button" onClick={() => {
                    setStarterImportPrompt(null);
                    setImportWizardScope(starterReturnScope);
                    setStarterReturnScope(null);
                    setStatus('Back to import choices.');
                  }}>
                    Back
                  </button>
                )}
                <button type="button" className="ghost-button" disabled={isPreparingImport} onClick={() => {
                  setStarterImportPrompt(null);
                  setStarterReturnScope(null);
                  setStatus(`${starterImportDetails.label} import canceled.`);
                }}>
                  Cancel
                </button>
              </div>
              <div>
                <button type="button" disabled={isPreparingImport} onClick={() => {
                  setStarterImportPrompt(null);
                  setStarterReturnScope(null);
                  setImportWizardScope(null);
                  setAppView('dashboard');
                  setStatus('You can start an import later from the Dashboard.');
                }}>
                  Start manually later
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      <input
        ref={onboardingFilesInputRef}
        type="file"
        multiple
        className="hidden-file-input"
        onChange={onFileInput}
      />
      <input
        ref={onboardingFolderInputRef}
        type="file"
        multiple
        className="hidden-file-input"
        onChange={onFileInput}
        {...({ webkitdirectory: '', directory: '' } as any)}
      />

      {importProgress && importDrafts.length === 0 && (
        <div className="import-progress-floating">
          <strong>{importProgress.phase}</strong>
          {importProgress.total > 1 && <span>{importProgress.current} of {importProgress.total}</span>}
          {importProgress.fileName && <small>{importProgress.fileName}</small>}
          {importProgress.total > 1
            ? <progress value={importProgress.current} max={Math.max(1, importProgress.total)} />
            : <progress />}
          {importProgress.total <= 1 && (
            <small>Keep Note Vault open. Large-folder imports can take a few minutes.</small>
          )}
        </div>
      )}

      {photoImportProgress && (
        <div className="import-progress-floating google-photos-progress">
          <strong>{photoImportProgress.phase}</strong>
          {photoImportProgress.total > 0 && (
            <span>{photoImportProgress.current} of {photoImportProgress.total}</span>
          )}
          {photoImportProgress.fileName && <small>{photoImportProgress.fileName}</small>}
          {photoImportProgress.total > 0 && (
            <progress value={photoImportProgress.current} max={Math.max(1, photoImportProgress.total)} />
          )}
          <small>
            Imported {photoImportProgress.imported || 0}
            {' '}• Metadata matches {photoImportProgress.matchedMetadata || 0}
            {photoImportProgress.skipped ? ` • Skipped ${photoImportProgress.skipped}` : ''}
          </small>
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

      {false && <aside className="sidebar">
        <div className="brand">
          <Archive size={26} />
          <span>Note Vault {appVersion && <small>v{appVersion}</small>}</span>
        </div>

        <div className="sidebar-scroll">
        <div className="side-section home-section">
          <button className={appView === 'dashboard' ? 'active' : ''} onClick={() => changeAppView('dashboard')}>
            <Archive size={16} /> Home Dashboard
          </button>
        </div>

        {showSidebarDrilldown && workspaceMode === 'note' && (
          <div className="side-section sidebar-actions">
            <div className="side-label">Create & Import</div>

            <button className="primary" onClick={createNote} disabled={isCreating}>
              <Plus size={18} /> {isCreating ? 'Creating...' : 'New Note'}
            </button>

            <label className="upload-button">
              <Upload size={18} /> Upload Files
              <input type="file" multiple onChange={event => onFileInput(event, 'note')} />
            </label>

            <label className="upload-button">
              <FolderOpen size={18} /> Add Folder
              <input type="file" multiple onChange={event => onFileInput(event, 'note')} {...({ webkitdirectory: '', directory: '' } as any)} />
            </label>
          </div>
        )}

        {showSidebarDrilldown && workspaceMode === 'photo' && (
          <div className="side-section sidebar-actions">
            <div className="side-label">Photo Import</div>
            <button className="primary" onClick={() => openPhotoView()} disabled={isImportingPhotos}>
              <Image size={18} /> Open Photo Library
            </button>
            <button className="upload-button" onClick={importGooglePhotosTakeout} disabled={isImportingPhotos}>
              <Image size={18} /> {isImportingPhotos ? 'Importing Photos...' : 'Import Google Photos'}
            </button>
            <label className="upload-button">
              <Upload size={18} /> Upload Photos
              <input type="file" multiple accept="image/*,video/*" onChange={event => onFileInput(event, 'photo')} />
            </label>
          </div>
        )}

        {showSidebarDrilldown && workspaceMode === 'music' && (
          <div className="side-section sidebar-actions mode-empty-card">
            <div className="side-label">Music Workspace</div>
            <p>For audio, MP3s, set notes, samples, playlists, and DJ-style helper tools once this section grows out.</p>
          </div>
        )}

        {showSidebarDrilldown && workspaceMode === 'note' && (
          <div className="side-section sidebar-nav">
            <div className="side-label">Note Workspace</div>

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
          </div>
        )}

        {showSidebarDrilldown && workspaceMode === 'photo' && (
          <div className="side-section sidebar-nav">
            <div className="side-label">Photo Workspace</div>
            <button
              className={appView === 'search' && photoWorkspaceView === 'library' && searchViewMode === 'grid' && searchTags.includes('photo') ? 'active' : ''}
              onClick={() => openPhotoView()}
            >
              <Image size={16} /> Photo Library
            </button>
            <button
              className={appView === 'search' && photoWorkspaceView === 'search' ? 'active' : ''}
              onClick={() => openPhotoSearch()}
            >
              <Search size={16} /> Photo Search
            </button>
          </div>
        )}

        {showSidebarDrilldown && workspaceMode === 'note' && appView === 'library' && <div className="side-section">
          <div className="side-label">Library Views</div>

          <button
            className={typeFilter === 'all' && !libraryFavoriteOnly ? 'active' : ''}
            onClick={async () => {
              if (!(await confirmSaveDirtyChanges())) return;
              setTypeFilter('all');
              setLibraryContentFilter('all');
              setShowLibraryContentFilter(false);
              setLibraryFavoriteOnly(false);
              setAppView('library');
            }}
          >
            All Items
          </button>

          <button
            className={libraryFavoriteOnly ? 'active' : ''}
            onClick={() => openFavoritesLibrary().catch(err => setStatus(err.message))}
          >
            <Star size={16} /> Starred
          </button>

          <button
            className={typeFilter === 'note' && !libraryFavoriteOnly ? 'active' : ''}
            onClick={async () => {
              if (!(await confirmSaveDirtyChanges())) return;
              setTypeFilter('note');
              setLibraryContentFilter('notes');
              setShowLibraryContentFilter(false);
              setLibraryFavoriteOnly(false);
              setAppView('library');
            }}
          >
            <FileText size={16} /> Notes
          </button>

          <button
            className={typeFilter === 'file' && !libraryFavoriteOnly ? 'active' : ''}
            onClick={async () => {
              if (!(await confirmSaveDirtyChanges())) return;
              setTypeFilter('file');
              setLibraryContentFilter('documents');
              setShowLibraryContentFilter(false);
              setLibraryFavoriteOnly(false);
              setAppView('library');
            }}
          >
            <FolderOpen size={16} /> Files
          </button>
        </div>}

        {showSidebarDrilldown && workspaceMode === 'note' && appView === 'library' && <div className="side-section">
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
              <button onMouseDown={event => event.preventDefault()} onClick={createCollection}>Add</button>
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

        </div>

        <div className="sidebar-bottom">
          <button
            className={appView === 'settings' ? 'active' : ''}
            onClick={() => changeAppView('settings')}
          >
            <Settings size={16} /> Settings
          </button>
        </div>

      </aside>}

      {appView === 'library' && !isDetailFocus && !isListFocus && <div className="pane-resizer pane-resizer-list" onMouseDown={event => {
        event.preventDefault();
        setResizingPane('list');
      }} />}

      <header className="app-mode-header">
        <div className="app-mode-title">
          <span className="dashboard-kicker">Private, local-first, yours</span>
          <h1>
            Note Vault
            {appVersion && <span className="app-version-badge">v{appVersion}</span>}
          </h1>
          <p>
            {appView === 'dashboard'
              ? 'Your whole local vault: notes, media, files, collections, and connections.'
              : appView === 'settings'
              ? 'Backups, imports, tags, logs, watched folders, updates, and app preferences.'
              : workspaceMode === 'photo'
              ? 'Browse, search, and connect your photos and videos.'
              : workspaceMode === 'music'
              ? 'Collect audio, playlists, samples, set notes, and play tracks while you work.'
              : 'Write notes, save your files, and connect the relationships around them.'}
          </p>
        </div>
        <ModeSlider value={appView === 'dashboard' || appView === 'memories' || appView === 'relationships' || appView === 'locations' ? 'dashboard' : appView === 'settings' ? 'settings' : workspaceMode} onChange={mode => { changeTopNavMode(mode).catch(() => undefined); }} className="hero-mode-slider app-header-mode-slider" />
      </header>

      {false && workspaceMode === 'music' && appView !== 'settings' ? (
        <main className="dashboard-panel mode-placeholder-panel">
          <div className="dashboard-header">
            <div>
              <span className="dashboard-kicker">Music Mode</span>
              <h1>Music vault</h1>
              <p>
                Music Mode is separated now so MP3s, samples, playlists, set notes, audio references, and future DJ-helper tools can live in their own workflow.
              </p>
            </div>
          </div>
          <section className="dashboard-cards mode-action-cards">
            {workspaceMode === 'note' && <>
              <button className="dashboard-card" onClick={createNote}>
                <span>Create</span><strong>Note</strong><small>Write a new entry, thought, plan, or idea.</small>
              </button>
              <button className="dashboard-card" onClick={() => changeAppView('library')}>
                <span>Browse</span><strong>{dashboard?.notes ?? 0}</strong><small>Open your notes library and edit saved entries.</small>
              </button>
              <button className="dashboard-card" onClick={() => changeAppView('search')}>
                <span>Find</span><strong>Search</strong><small>Search note text, tags, collections, and attached files.</small>
              </button>
              <button className="dashboard-card" onClick={() => openDashboardLibrary('file')}>
                <span>Keep</span><strong>{dashboard?.files ?? 0}</strong><small>Upload documents, references, keepsakes, and files.</small>
              </button>
              <button className="dashboard-card" onClick={() => openSettingsTab('tags')}>
                <span>Organize</span><strong>{dashboard?.tags ?? 0}</strong><small>Manage tags that connect related ideas.</small>
              </button>
              <button className="dashboard-card dashboard-card-warm" onClick={() => openDashboardLibrary()}>
                <span>Connected Relationships</span><strong>∞</strong><small>Use relationships to tie entries, photos, files, and collections together.</small>
              </button>
            </>}

            {workspaceMode === 'photo' && <>
              <button className="dashboard-card" onClick={() => openPhotoView({ mediaFilter: 'image' })}>
                <span>Photo Library</span><strong>{dashboard?.photos ?? 0}</strong><small>Open the visual photo library without loading every image at once.</small>
              </button>
              <button className="dashboard-card" onClick={() => openPhotoView({ mediaFilter: 'video' })}>
                <span>Videos</span><strong>{dashboard?.videos ?? 0}</strong><small>Browse movie clips and visual media in the vault.</small>
              </button>
              <button className="dashboard-card" onClick={() => openPhotoSearch()}>
                <span>Find</span><strong>Search</strong><small>Search photos by tag, filename, collection, or notes.</small>
              </button>
              <button className="dashboard-card" onClick={importGooglePhotosTakeout} disabled={isImportingPhotos}>
                <span>Import Wizard</span><strong>{dashboard?.googlePhotos ?? 0}</strong><small>Bring in Google Photos ZIPs with metadata. iCloud can plug in later.</small>
              </button>
              <label className="dashboard-card dashboard-upload-card">
                <span>Add</span><strong>Upload</strong><small>Add images or videos from your computer.</small>
                <input type="file" multiple accept="image/*,video/*" onChange={event => onFileInput(event, 'photo')} />
              </label>
              <button className="dashboard-card" onClick={() => openPhotoSearch()}>
                <span>Locations Found</span><strong>{dashboard?.locations ?? 0}</strong><small>Photos/videos with location metadata text available.</small>
              </button>
              <button className="dashboard-card dashboard-card-warm" onClick={() => openDashboardLibrary()}>
                <span>Relationships</span><strong>{dashboard?.relationships ?? 0}</strong><small>Use collections and relationships to connect your vault.</small>
              </button>
            </>}

            {workspaceMode === 'music' && <>
              <div className="dashboard-card static-card">
                <span>Coming next</span><strong>Audio</strong><small>MP3 previews, samples, playlists, and DJ-helper notes.</small>
              </div>
              <div className="dashboard-card static-card">
                <span>Collect</span><strong>Sets</strong><small>BPM, key, mood, tags, and playlist planning can live here.</small>
              </div>
              <button className="dashboard-card dashboard-card-warm" onClick={() => openDashboardLibrary('file')}>
                <span>For now</span><strong>Files</strong><small>Store audio files from the regular vault while Music grows up.</small>
              </button>
            </>}
          </section>

          <section className="dashboard-cards legacy-dashboard-cards">
            <div className="dashboard-card static-card">
              <span>Coming next</span>
              <strong>Audio</strong>
              <small>MP3 previews, playlists, BPM/key notes, samples, and DJ-style set helpers can plug into this mode cleanly.</small>
            </div>
            <div className="dashboard-card static-card">
              <span>For now</span>
              <strong>Use Note Mode</strong>
              <small>Upload audio files or music notes from Note Mode until the dedicated music tools come back.</small>
            </div>
          </section>
        </main>
      ) : appView === 'dashboard' ? (
        <main className="dashboard-panel">
          <div className="content-frame-heading">
            <div>
              <span className="dashboard-kicker">
                Home Dashboard
                {appVersion && <span className="dashboard-version-badge">v{appVersion}</span>}
              </span>
              <h2>Your whole vault at a glance</h2>
              <p>Notes, photos, files, collections, relationships, and recent work in one place.</p>
            </div>
            <div className="dashboard-hero-actions">
              <button className="dashboard-new-note" onClick={createNote} disabled={isCreating}>
                <Plus size={16} /> {isCreating ? 'Creating...' : 'New Note'}
              </button>
            </div>
          </div>

          <form className="dashboard-search-bar" onSubmit={runDashboardSearch}>
            <Search size={18} />
            <input
              value={searchText}
              onChange={event => setSearchText(event.target.value)}
              placeholder="Search notes, lyrics, samples, files, photos, tags..."
            />
            <button type="submit">Search</button>
          </form>

          <div className="dashboard-section-label">
            <span>Vault stats</span>
            <small>Counts across everything saved locally.</small>
          </div>
          <section className="dashboard-cards vault-overview-cards dashboard-stats-grid">
            <button className="dashboard-card stat-card" onClick={() => openDashboardLibrary()}>
              <span className="card-emoji">🧰</span><span>All Items</span><strong>{dashboard?.totalItems ?? 0}</strong><small>Everything in your vault</small>
            </button>
            <button className="dashboard-card stat-card" onClick={() => openFavoritesLibrary()}>
              <span className="card-emoji">⭐</span><span>Starred</span><strong>{dashboard?.favorites ?? 0}</strong><small>Favorite items you marked for quick access</small>
            </button>
            <button className="dashboard-card stat-card" onClick={() => { setWorkspaceMode('note'); setAppView('notes'); }}>
              <span className="card-emoji">✍️</span><span>Notes</span><strong>{dashboard?.notes ?? 0}</strong><small>Notes, entries, plans, and reflections</small>
            </button>
            <button className="dashboard-card stat-card" onClick={() => openPhotoView({ mediaFilter: 'image' })}>
              <span className="card-emoji">📷</span><span>Photos</span><strong>{dashboard?.photos ?? 0}</strong><small>Images saved in the vault</small>
            </button>
            <button className="dashboard-card stat-card" onClick={() => openPhotoView({ mediaFilter: 'video' })}>
              <span className="card-emoji">🎞️</span><span>Videos</span><strong>{dashboard?.videos ?? 0}</strong><small>Movie clips and visual media</small>
            </button>
            <button className="dashboard-card stat-card" onClick={() => { setWorkspaceMode('music'); openMusicLibrary().catch(() => undefined); }}>
              <span className="card-emoji">🎧</span><span>Audio</span><strong>{dashboard?.audio ?? 0}</strong><small>Tracks, samples, and voice clips</small>
            </button>
            <button className="dashboard-card stat-card" onClick={() => changeAppView('relationships')}>
              <span className="card-emoji">🧵</span><span>Relationships</span><strong>{dashboard?.relationships ?? 0}</strong><small>Connections between saved items</small>
            </button>
            <button className="dashboard-card stat-card" onClick={() => { setActiveMemory(null); changeAppView('memories'); }}>
              <span className="card-emoji">✨</span><span>Memories</span><strong>{dashboard?.memories ?? 0}</strong><small>Private scrapbook pages built from connected items</small>
            </button>
          </section>

          {false && <section className="dashboard-cards dashboard-workspace-grid">
            <button className="dashboard-card action-card" onClick={() => { setWorkspaceMode('note'); setAppView('mode'); }}>
              <span>Notes Workspace</span><strong>{dashboard?.notes ?? 0}</strong><small>Create notes, browse entries, search text, and organize writing.</small>
            </button>
            <button className="dashboard-card action-card" onClick={() => { setWorkspaceMode('photo'); setAppView('mode'); }}>
              <span>Photo Workspace</span><strong>{(dashboard?.photos ?? 0) + (dashboard?.videos ?? 0)}</strong><small>Browse media, import takeouts, review metadata, and build relationships.</small>
            </button>
            <button className="dashboard-card action-card" onClick={() => { setWorkspaceMode('music'); setAppView('mode'); }}>
              <span className="card-emoji">🎵</span><span>Music Workspace</span><strong>Play</strong><small>Audio files, set notes, samples, playlists, and music helpers.</small>
            </button>
          </section>}

          <div className="dashboard-section-label">
            <span>Quick actions</span>
            <small>Common actions are here; switch modes from the top when you want a focused workspace.</small>
          </div>
          <section className="dashboard-cards dashboard-action-grid">
            <button className="dashboard-card action-card" onClick={createNote} disabled={isCreating}>
              <span>Create</span><strong>New Note</strong><small>Capture lyrics, thoughts, theory, plans, or anything else.</small>
            </button>
            <label className="dashboard-card action-card dashboard-upload-card">
              <span>Add</span><strong>Upload Something</strong><small>Add anything. Note Vault will tag photos, audio, and files by type.</small><input type="file" multiple onChange={event => onFileInput(event, 'auto')} />
            </label>
            <button className="dashboard-card action-card" onClick={() => openFolderPicker('auto')}>
              <span>Add</span><strong>Add Folder</strong><small>Bring in a mixed folder. Photos, music, and files get marked automatically.</small>
            </button>
            <button className="dashboard-card action-card" onClick={() => changeAppView('relationships')}>
              <span>Connect</span><strong>Relationships</strong><small>Open linked notes, photos, files, and audio threads.</small>
            </button>
            <button className="dashboard-card action-card dashboard-card-warm" onClick={() => { setActiveMemory(null); changeAppView('memories'); }}>
              <span>Build</span><strong>Memories</strong><small>Arrange photos, notes, files, and audio into a private scrapbook page.</small>
            </button>
            <button className="dashboard-card action-card" onClick={() => changeAppView('collections')}>
              <span>Organize</span><strong>Collections</strong><small>Jump into projects, groups, sets, albums, or bundles.</small>
            </button>
          </section>

          <div className="dashboard-section-label">
            <span>Continue</span>
            <small>Pick up recent work or recently played audio.</small>
          </div>

          {recentlyPlayedMusicItems.length > 0 && (
            <section className="dashboard-recent dashboard-recent-audio">
              <div className="dashboard-section-header">
                <div><h2>Continue</h2><p>Pick up a sample, track, demo, or voice note.</p></div>
                <button onClick={openMusicLibrary}>Open Audio</button>
              </div>
              <div className="dashboard-recent-list">
                {recentlyPlayedMusicItems.slice(0, 4).map(item => (
                  <button key={item.id} onClick={() => playAudioItem(item)}>
                    <span className="music-cover-placeholder">♪</span>
                    <span>
                      <strong>{item.title || item.file_name || 'Untitled track'}</strong>
                      <small>{(audioPlayStats[item.id]?.plays || 0)} play{(audioPlayStats[item.id]?.plays || 0) === 1 ? '' : 's'} · {item.file_ext?.replace('.', '').toUpperCase() || 'AUDIO'}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="dashboard-recent">
            <div className="dashboard-section-header">
              <div><h2>Recently updated</h2><p>Pick up where you left off.</p></div>
              <button onClick={() => openDashboardLibrary()}>Open Library</button>
            </div>
            {dashboard?.recentItems.length ? (
              <div className="dashboard-recent-list">
                {dashboard.recentItems.map(item => (
                  <button key={item.id} onClick={() => openDashboardItem(item)}>
                    {item.thumbnail_data ? <img className="item-thumbnail item-thumbnail-small" src={item.thumbnail_data} alt="" style={imageRotationStyle(item)} /> : item.type === 'note' ? <FileText size={18} /> : <FolderOpen size={18} />}
                    <span><strong>{item.title || 'Untitled note'}</strong><small>{item.type} · Updated {formatDate(item.updated_at)}</small></span>
                  </button>
                ))}
              </div>
            ) : <div className="dashboard-empty">Create a note or upload a file to start building your vault.</div>}
          </section>

          {status && <div className="status-bar">{status}</div>}
        </main>
      ) : appView === 'mode' ? (
        <main className="dashboard-panel mode-dashboard-panel">
          <div className="content-frame-heading">
            <div>
              <span className="dashboard-kicker">{workspaceMode === 'photo' ? 'Photo Workspace' : workspaceMode === 'music' ? 'Music Workspace' : 'Notes Workspace'}</span>
              <h2>{workspaceMode === 'photo' ? 'Photos, videos, metadata, and relationship building' : workspaceMode === 'music' ? 'Audio, samples, playlists, and set notes' : 'Write, organize, and connect your notes'}</h2>
              <p>{workspaceMode === 'photo' ? 'Only photo and video tools belong here.' : workspaceMode === 'music' ? 'Play tracks in the background while you use the vault, and organize music with tags, collections, and relationships.' : 'A focused writing workspace for notes, files, tags, collections, and relationships.'}</p>
            </div>
            <div className="dashboard-hero-actions">
              <button className="dashboard-secondary-action" onClick={() => changeAppView('dashboard')}>Home Dashboard</button>
            </div>
          </div>

          {workspaceMode === 'note' && <section className="notes-workspace-layout">
            <div className="dashboard-section-label"><span>Notes stats</span><small>What is in the writing side of the vault.</small></div>
            <section className="dashboard-cards dashboard-stats-grid">
              <button className="dashboard-card stat-card" onClick={() => changeAppView('notes')}><span>Notes</span><strong>{dashboard?.notes ?? 0}</strong><small>Entries and saved notes</small></button>
              <button className="dashboard-card stat-card" onClick={() => openDashboardLibrary('file')}><span>Files</span><strong>{dashboard?.files ?? 0}</strong><small>Attached documents and references</small></button>
              <button className="dashboard-card stat-card" onClick={() => changeAppView('collections')}><span>Collections</span><strong>{dashboard?.collections ?? 0}</strong><small>Projects and note bundles</small></button>
              <button className="dashboard-card stat-card" onClick={openJournalTags}><span>Tags</span><strong>{dashboard?.tags ?? 0}</strong><small>Saved tag vocabulary</small></button>
              <button className="dashboard-card stat-card" onClick={() => openFavoritesLibrary()}><span>Starred</span><strong>{dashboard?.favorites ?? 0}</strong><small>Items marked for quick access</small></button>
              <button className="dashboard-card stat-card" onClick={() => changeAppView('relationships')}><span>Relationships</span><strong>{dashboard?.relationships ?? 0}</strong><small>Connections between notes and files</small></button>
            </section>
            <div className="dashboard-section-label"><span>Notes actions</span><small>Work with notes and files.</small></div>
            <section className="dashboard-cards dashboard-action-grid">
              <button className="dashboard-card action-card" onClick={() => changeAppView('search')}><span>Find</span><strong>Search</strong><small>Search text, tags, collections, and files.</small></button>
              <button className="dashboard-card action-card" onClick={() => openImportWizard('journal')}><span>Import</span><strong>Import Wizard</strong><small>Bring in Notion exports or OneNote notebooks.</small></button>
              <label className="dashboard-card action-card dashboard-upload-card"><span>Add</span><strong>Upload Files</strong><small>Add notes, PDFs, docs, code, text, or references.</small><input type="file" multiple onChange={event => onFileInput(event, 'note')} /></label>
              <button className="dashboard-card action-card" onClick={() => openFolderPicker('note')}><span>Add</span><strong>Add Folder</strong><small>Add a folder of notes, docs, code, PDFs, or references.</small></button>
            </section>
            <section className="quick-note-panel">
              <div className="dashboard-section-label quick-note-label"><span>Quick note</span><small>Write and save without opening the full library.</small></div>
              <input
                className="quick-note-title"
                value={quickNoteTitle}
                onChange={event => setQuickNoteTitle(event.target.value)}
                placeholder="Quick note title..."
              />
              <RichNoteEditor
                value={quickNoteBody}
                onChange={setQuickNoteBody}
                placeholder="Start writing here... Type / for headings, tasks, quotes, code, lists, and dividers."
              />
              <div className="quick-note-actions">
                <select value={quickNoteCollectionId} onChange={event => setQuickNoteCollectionId(event.target.value)}>
                  <option value="">No collection</option>
                  {collections.map(collection => (
                    <option key={collection.id} value={collection.id}>{collection.name}</option>
                  ))}
                </select>
                <details
                  ref={quickNoteTagPickerRef}
                  className="quick-note-tag-picker"
                  open={quickNoteTagsOpen}
                  onToggle={event => setQuickNoteTagsOpen(event.currentTarget.open)}
                >
                  <summary>{quickNoteTags.length ? `Tags (${quickNoteTags.length})` : 'Tags'}</summary>
                  <div>
                    {allTags.length === 0 ? (
                      <small>No saved tags yet.</small>
                    ) : allTags.map(tag => (
                      <label key={tag}>
                        <input
                          type="checkbox"
                          checked={quickNoteTags.includes(tag)}
                          onChange={() => setQuickNoteTags(current =>
                            current.includes(tag)
                              ? current.filter(existing => existing !== tag)
                              : [...current, tag].sort((a, b) => a.localeCompare(b))
                          )}
                        />
                        <span>#{tag}</span>
                      </label>
                    ))}
                  </div>
                </details>
                <button type="button" onClick={saveQuickNote} disabled={isSavingQuickNote}>
                  {isSavingQuickNote ? 'Saving...' : 'Save Quick Note'}
                </button>
              </div>
            </section>
            <section className="dashboard-recent notes-recent-files-panel">
              <div className="dashboard-recent-header">
                <div><h2>Recently accessed files</h2><p>References and documents from the note side of the vault.</p></div>
                <button onClick={() => openDashboardLibrary('file')}>Open Files</button>
              </div>
              {noteRecentFiles.length ? (
                <div className="dashboard-recent-list notes-recent-file-list">
                  {noteRecentFiles.map(item => (
                    <button key={item.id} onClick={() => openDashboardItem(item)}>
                      <FolderOpen size={18} />
                      <span><strong>{item.title || item.file_name || 'Untitled file'}</strong><small>{item.file_ext || 'file'} · Updated {formatDate(item.updated_at)}</small></span>
                    </button>
                  ))}
                </div>
              ) : <div className="dashboard-empty">No recent note-side files yet.</div>}
            </section>
          </section>}

          {workspaceMode === 'photo' && <section className="photo-workspace-layout">
            <section className="photo-mode-stage">
              <div className="dashboard-section-label"><span>Recently added</span><small>Photo mode starts with the media, not the controls.</small></div>
              <button type="button" className="photo-feature-card" onClick={() => featuredPhotoItem ? openDashboardItem(featuredPhotoItem) : openPhotoView()}>
                {featuredPhotoItem?.thumbnail_data || featuredPhotoMediaUrl ? (
                  <img src={featuredPhotoMediaUrl || featuredPhotoItem.thumbnail_data || ''} alt={featuredPhotoItem.title || featuredPhotoItem.file_name || 'Recent photo'} style={imageRotationStyle(featuredPhotoItem)} />
                ) : (
                  <span className="photo-feature-empty">Open Photo Library</span>
                )}
                <span className="photo-feature-caption">
                  <strong>{featuredPhotoItem?.title || featuredPhotoItem?.file_name || 'Browse your photos and videos'}</strong>
                  <small>{featuredPhotoItem ? `Updated ${formatDate(featuredPhotoItem.updated_at)}` : 'Add or import media to start the slideshow feel.'}</small>
                </span>
              </button>
              <div className="photo-strip">
                {recentMediaItems.length ? recentMediaItems.map(item => (
                  <button key={item.id} type="button" onClick={() => setFeaturedPhotoId(item.id)} className={featuredPhotoItem?.id === item.id ? 'active' : ''}>
                    {item.thumbnail_data ? <img src={item.thumbnail_data} alt="" style={imageRotationStyle(item)} /> : <span>{isVideoItem(item) ? '▶' : 'IMG'}</span>}
                  </button>
                )) : (
                  <button type="button" onClick={() => openPhotoView()}><span>Open Library</span></button>
                )}
              </div>
            </section>
            <div className="dashboard-section-label"><span>Photo stats</span><small>Media and metadata counts.</small></div>
            <section className="dashboard-cards dashboard-stats-grid">
              <button className="dashboard-card stat-card" onClick={() => openPhotoView({ mediaFilter: 'image' })}><span>Photos</span><strong>{dashboard?.photos ?? 0}</strong><small>Image files only</small></button>
              <button className="dashboard-card stat-card" onClick={() => openPhotoView({ mediaFilter: 'video' })}><span>Videos</span><strong>{dashboard?.videos ?? 0}</strong><small>Video files only</small></button>
              <button className="dashboard-card stat-card" onClick={() => changeAppView('locations')}><span>Locations Found</span><strong>{dashboard?.locations ?? 0}</strong><small>Open grouped location metadata</small></button>
            </section>
            <div className="dashboard-section-label"><span>Photo actions</span><small>Browse, import, and organize media.</small></div>
            <section className="dashboard-cards dashboard-action-grid">
              <button className="dashboard-card action-card" onClick={() => openPhotoView()}><span>Browse</span><strong>Media Library</strong><small>Show only photos and videos, paged for performance.</small></button>
              <button className="dashboard-card action-card" onClick={() => openPhotoSearch()}><span>Find</span><strong>Photo Search</strong><small>Search media by text, tags, collections, or filename.</small></button>
              <button className="dashboard-card action-card" onClick={() => openImportWizard('photo')} disabled={isImportingPhotos}><span>Import</span><strong>Import Wizard</strong><small>Choose Google Takeout, iCloud media, or local photo folders.</small></button>
              <label className="dashboard-card action-card dashboard-upload-card"><span>Add</span><strong>Upload Media</strong><small>Add image and video files from your computer.</small><input type="file" multiple accept="image/*,video/*" onChange={event => onFileInput(event, 'photo')} /></label>
              <button className="dashboard-card action-card" onClick={() => openFolderPicker('photo')}><span>Add</span><strong>Add Folder</strong><small>Add a folder of photos/videos and review before saving.</small></button>
            </section>
            <div className="dashboard-section-label"><span>Photo organization</span><small>Ways to connect media.</small></div>
            <section className="dashboard-cards dashboard-link-grid">
              <button className="dashboard-card dashboard-card-warm" onClick={() => changeAppView('collections')}><span>Albums</span><strong>Photo Collections</strong><small>Create photo-only albums and organize imported media.</small></button>
              <button className="dashboard-card dashboard-card-warm" onClick={() => changeAppView('locations')}><span>Locations</span><strong>{dashboard?.locations ?? 0}</strong><small>Review grouped location metadata from imported media.</small></button>
              <button className="dashboard-card dashboard-card-warm" onClick={() => changeAppView('relationships')}><span>Relationships</span><strong>{dashboard?.relationships ?? 0}</strong><small>Connect photos with notes, files, and collections.</small></button>
            </section>
          </section>}

          {workspaceMode === 'music' && <>
            <div className="dashboard-section-label"><span>Music stats</span><small>Audio files saved locally.</small></div>
            <section className="dashboard-cards dashboard-stats-grid">
              <button className="dashboard-card stat-card" onClick={openMusicLibrary}><span className="card-emoji">🎧</span><span>Audio</span><strong>{dashboard?.audio ?? 0}</strong><small>MP3, WAV, FLAC, M4A, OGG, and more</small></button>
              <button className="dashboard-card stat-card" onClick={() => changeAppView('collections')}><span className="card-emoji">💿</span><span>Albums / Projects</span><strong>{dashboard?.collections ?? 0}</strong><small>Use collections for albums, song projects, sets, crates, and sample packs</small></button>
              <button className="dashboard-card stat-card" onClick={() => changeAppView('relationships')}><span className="card-emoji">🔗</span><span>Relationships</span><strong>{dashboard?.relationships ?? 0}</strong><small>Connect tracks with notes, gigs, or photos</small></button>
            </section>
            <div className="dashboard-section-label"><span>Music actions</span><small>Bring in music and play it while working.</small></div>
            <section className="dashboard-cards dashboard-action-grid">
              <button className="dashboard-card action-card" onClick={() => openFolderPicker('music')}><span>Add</span><strong>Add Folder</strong><small>Add a folder of tracks, samples, demos, or audio clips.</small></button>
              <label className="dashboard-card action-card dashboard-upload-card"><span className="card-emoji">⬆️</span><span>Add</span><strong>Upload Audio</strong><small>Add tracks, samples, demos, WAVs, MP3s, FLACs, or voice clips.</small><input type="file" multiple accept="audio/*,.flac,.m4a,.ogg,.opus,.wma,.aiff,.aif" onChange={event => onFileInput(event, 'music')} /></label>
              <button className="dashboard-card action-card" onClick={openMusicLibrary}><span className="card-emoji">🎚️</span><span>Browse</span><strong>Music Library</strong><small>Open playable audio files only.</small></button>
              <button className="dashboard-card action-card" onClick={() => { setSearchType('file'); setAppView('search'); }}><span className="card-emoji">🔎</span><span>Find</span><strong>Music Search</strong><small>Search tracks by title, tags, notes, or filename.</small></button>
            </section>
            <section className="music-player-panel">
              <div className="dashboard-section-label"><span>Music player</span><small>Current track only. Playback keeps running while you move around the app.</small></div>
              {currentAudioItem ? (
                <div className="music-current-card">
                  <span className="music-cover-placeholder">♪</span>
                  <div>
                    <span className="dashboard-kicker">Now playing</span>
                    <strong>{currentAudioItem.title || currentAudioItem.file_name || 'Untitled track'}</strong>
                    <small>{currentAudioItem.file_ext?.replace('.', '').toUpperCase() || 'AUDIO'} · {(audioPlayStats[currentAudioItem.id]?.plays || 0)} play{(audioPlayStats[currentAudioItem.id]?.plays || 0) === 1 ? '' : 's'}</small>
                  </div>
                  <button type="button" className="dashboard-secondary-action" onClick={toggleAudioPlayback}>
                    {isAudioPlaying ? 'Pause' : 'Play'}
                  </button>
                </div>
              ) : musicItems.length === 0 ? (
                <div className="dashboard-empty">Upload audio files to start using Music Mode.</div>
              ) : (
                <div className="dashboard-empty">Pick a track from Browse Music Library or Recently Played to start the player.</div>
              )}
            </section>
            <section className="music-player-panel">
              <div className="dashboard-section-label"><span>Recently played</span><small>Tracks played during this session.</small></div>
              {recentlyPlayedMusicItems.length === 0 ? (
                <div className="dashboard-empty">No recently played tracks yet.</div>
              ) : (
                <div className="music-track-grid">
                  {recentlyPlayedMusicItems.map(item => (
                    <button key={item.id} className={`music-track-card ${currentAudioItem?.id === item.id ? 'active' : ''}`} onClick={() => playAudioItem(item)}>
                      <span className="music-cover-placeholder">♪</span>
                      <span>
                        <strong>{item.title || item.file_name || 'Untitled track'}</strong>
                        <small className="music-track-stats">
                          {(audioPlayStats[item.id]?.plays || 0)} play{(audioPlayStats[item.id]?.plays || 0) === 1 ? '' : 's'}
                          {audioPlayStats[item.id]?.lastPlayed ? ` · Last ${formatDate(audioPlayStats[item.id].lastPlayed)}` : ' · Not played yet'}
                        </small>
                        <small>{item.file_ext?.replace('.', '').toUpperCase() || 'AUDIO'} · {item.tags?.slice(0, 3).join(', ') || 'No tags yet'}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </>}

          {status && <div className="status-bar">{status}</div>}
        </main>
      ) : appView === 'notes' ? (
        <main className="dashboard-panel journal-subpage-panel">
          <div className="content-frame-heading">
            <div>
              <span className="dashboard-kicker">Notes</span>
              <h2>Notes you created</h2>
              <p>A clean note-only list. Open one when you need the full editor.</p>
            </div>
            <div className="dashboard-hero-actions">
              <button className="dashboard-secondary-action" onClick={() => changeAppView('mode')}>Back to Notes</button>
            </div>
          </div>

          <section className="dashboard-cards note-card-grid">
            {noteItems.length === 0 ? (
              <div className="dashboard-card static-card">
                <span>No notes yet</span>
                <strong>Use Quick Note</strong>
                <small>Create your first note from the Notes dashboard.</small>
              </div>
            ) : noteItems.map(item => (
              <button key={item.id} className="dashboard-card note-list-card" onClick={() => openDashboardItem(item)}>
                <span>Note</span>
                <strong>{item.title || 'Untitled note'}</strong>
                <small>Updated {formatDate(item.updated_at)}</small>
                {item.private ? (
                  <p>*****</p>
                ) : item.body ? (
                  <MarkdownCardPreview value={item.body} title={item.title} />
                ) : null}
              </button>
            ))}
          </section>

          {status && <div className="status-bar">{status}</div>}
        </main>
      ) : appView === 'collections' ? (
        <main className="dashboard-panel journal-subpage-panel">
          <div className="content-frame-heading">
            <div>
              <span className="dashboard-kicker">{collectionPageParent ? 'Sub Collections' : workspaceMode === 'music' ? 'Music Collections' : workspaceMode === 'photo' ? 'Photo Collections' : 'Notes Collections'}</span>
              <h2>{collectionPageParent ? collectionPageParent.name : workspaceMode === 'music' ? 'Albums, crates, sets, and audio groups' : workspaceMode === 'photo' ? 'Albums, trips, people, and relationship groups' : 'Projects, bundles, and grouped notes'}</h2>
              <p>{collectionPageParent ? `Collections attached under ${collectionPageParent.name}.` : workspaceMode === 'music' ? 'Only collections marked for music or containing audio are shown here.' : workspaceMode === 'photo' ? 'Only photo/video collections are shown here.' : 'Create a collection, then open it to see the notes and files inside.'}</p>
            </div>
            <div className="dashboard-hero-actions">
              <button className="dashboard-secondary-action" onClick={() => backCollectionPage().catch(err => setStatus(err.message))}>
                {collectionPageParent ? 'Back to Collections' : 'Back to Notes'}
              </button>
            </div>
          </div>

          <section className="collection-create-panel">
            {collectionPageParent && (
              <div className="collection-create-help">
                <strong>Add albums under {collectionPageParent.name}</strong>
                <small>Create a new album/project here, or attach an existing top-level music collection as an album.</small>
              </div>
            )}
            <div className="collection-create-row">
              <input
                value={newCollectionName}
                onChange={event => setNewCollectionName(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') createCollection();
                }}
                placeholder={collectionPageParent ? `New album/project under ${collectionPageParent.name}...` : workspaceMode === 'music' ? 'New album, project, set, crate, or sample pack...' : 'New collection name...'}
              />
              <button onMouseDown={event => event.preventDefault()} onClick={createCollection}>
                {collectionPageParent ? 'Create Album Here' : workspaceMode === 'music' ? 'Create Album / Project' : 'Create Collection'}
              </button>
            </div>
            {collectionPageParent && attachableMusicSubCollections.length > 0 && (
              <div className="collection-create-row collection-attach-row">
                <select value={subCollectionAttachId} onChange={event => setSubCollectionAttachId(event.target.value)}>
                  <option value="">Attach existing album/project...</option>
                  {attachableMusicSubCollections.map(collection => (
                    <option key={collection.id} value={collection.id}>
                      {collection.name}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={attachExistingSubCollection} disabled={!subCollectionAttachId}>
                  Attach to {collectionPageParent.name}
                </button>
              </div>
            )}
          </section>

          {workspaceMode === 'music' && !collectionPageParent && (
            <section className="music-organization-note">
              <strong>Suggested music structure</strong>
              <span>Use collections as the album/project layer. Name them like “Artist / Album” to group albums under an artist or project. Tags still work best for genre, instrument, mood, status, gig, or collaborator names.</span>
            </section>
          )}

          <section className="dashboard-cards collection-card-grid">
            {!collectionPageParent && <button className="dashboard-card action-card" onClick={() => openDashboardLibrary()}>
              <span>All Collections</span><strong>Library</strong><small>Open the full library without a collection filter.</small>
            </button>}
            {collectionPageCollections.map(collection => (
              <div
                key={collection.id}
                className="dashboard-card collection-card"
                role="button"
                tabIndex={0}
                onClick={() => openCollectionCard(collection).catch(err => setStatus(err.message))}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openCollectionCard(collection).catch(err => setStatus(err.message));
                  }
                }}
              >
                <button
                  type="button"
                  className="collection-card-trash"
                  aria-label={`Delete collection ${collection.name}`}
                  title={(collection.count || 0) > 0 ? 'Collection must be empty before deleting' : 'Delete empty collection'}
                  onClick={event => {
                    event.stopPropagation();
                    deleteCollectionCard(collection).catch(err => setStatus(err.message));
                  }}
                >
                  🗑
                </button>
                <span>{collection.child_count ? 'Sub collections' : collection.mode === 'music' ? 'Music collection' : collection.mode === 'photo' ? 'Photo collection' : 'Collection'}</span>
                <strong>{collection.name}</strong>
                <small>{collection.child_count ? `${collection.child_count} sub-collection${collection.child_count === 1 ? '' : 's'}` : `${collection.count || 0} item${collection.count === 1 ? '' : 's'} - Open collection library`}</small>
              </div>
            ))}
            {collectionPageCollections.length === 0 && (
              <div className="dashboard-card static-card">
                <span>No collections yet</span>
                <strong>Create one above</strong>
                <small>{collectionPageParent ? `Add albums or sub-projects under ${collectionPageParent.name}.` : workspaceMode === 'music' ? 'Music collections are best for albums, sets, crates, samples, or song ideas.' : 'Collections are best for projects, topics, people, places, or bundles.'}</small>
              </div>
            )}
          </section>

          {status && <div className="status-bar">{status}</div>}
        </main>
      ) : appView === 'memories' ? (
        <main className="dashboard-panel journal-subpage-panel memories-panel">
          {!activeMemory ? (
            <>
              <div className="content-frame-heading">
                <div>
                  <span className="dashboard-kicker">Memories</span>
                  <h2>Private scrapbook pages</h2>
                  <p>Create a page, or let Note Vault suggest one when several related items already belong together.</p>
                </div>
                <div className="dashboard-hero-actions">
                  <button className="dashboard-secondary-action" onClick={() => changeAppView('dashboard')}>Home Dashboard</button>
                </div>
              </div>

              <section className="memory-create-panel">
                <div>
                  <span className="dashboard-kicker">Create Memory</span>
                  <h3>Start with a blank canvas</h3>
                  <p>Add photos, notes, audio, and files after it is created.</p>
                </div>
                <input value={newMemoryTitle} onChange={event => setNewMemoryTitle(event.target.value)} placeholder="Memory title..." />
                <input value={newMemoryDescription} onChange={event => setNewMemoryDescription(event.target.value)} placeholder="Optional description..." />
                <button className="dashboard-new-note" type="button" onClick={() => createMemoryFromDraft().catch(err => setStatus(err.message))}>Create Memory</button>
              </section>

              <div className="dashboard-section-label">
                <span>Suggested Memories</span>
                <small>Built from clusters of 3+ related vault items.</small>
              </div>
              <section className="dashboard-cards memory-suggestion-grid">
                {memorySuggestions.length ? memorySuggestions.map(suggestion => (
                  <article key={suggestion.id} className="dashboard-card memory-suggestion-card">
                    <span>Suggested</span>
                    <strong>{suggestion.title}</strong>
                    <small>{suggestion.reason}</small>
                    <div className="memory-suggestion-strip">
                      {suggestion.items.slice(0, 5).map(item => (
                        <span key={item.id}>
                          {item.thumbnail_data ? <img src={item.thumbnail_data} alt="" style={imageRotationStyle(item)} /> : item.type === 'note' ? <FileText size={18} /> : <FolderOpen size={18} />}
                        </span>
                      ))}
                    </div>
                    <button type="button" className="memory-suggestion-action" onClick={() => createMemoryFromSuggestion(suggestion).catch(err => setStatus(err.message))}>Create from these</button>
                  </article>
                )) : (
                  <div className="dashboard-card static-card">
                    <span>No suggestions yet</span>
                    <strong>Build relationships</strong>
                    <small>Once 3 or more items are connected, Note Vault can suggest a Memory here.</small>
                  </div>
                )}
              </section>

              <div className="dashboard-section-label">
                <span>Your Memories</span>
                <small>Open one to arrange its page.</small>
              </div>
              <section className="dashboard-cards memory-list-grid">
                {memories.length ? memories.map(memory => (
                  <article key={memory.id} className="dashboard-card memory-list-card">
                    <button
                      type="button"
                      className="memory-delete-button"
                      onMouseDown={event => event.stopPropagation()}
                      onClick={event => {
                        event.stopPropagation();
                        deleteMemory(memory.id, memory.title).catch(err => setStatus(err.message));
                      }}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className="memory-rename-button"
                      onMouseDown={event => event.stopPropagation()}
                      onClick={event => {
                        event.stopPropagation();
                        renameMemory(memory).catch(err => setStatus(err.message));
                      }}
                    >
                      Rename
                    </button>
                    <button type="button" className="memory-list-card-open" onClick={() => openMemory(memory.id).catch(err => setStatus(err.message))}>
                    {memory.cover_thumbnail_data ? <img src={memory.cover_thumbnail_data} alt="" /> : <span className="memory-card-placeholder">Memory</span>}
                    <strong>{memory.title}</strong>
                    <small>{memory.item_count} item{memory.item_count === 1 ? '' : 's'} · Updated {formatDate(memory.updated_at)}</small>
                    </button>
                  </article>
                )) : (
                  <div className="dashboard-card static-card">
                    <span>No memories yet</span>
                    <strong>Create your first one</strong>
                    <small>This is where the scrapbook-style pages will live.</small>
                  </div>
                )}
              </section>
            </>
          ) : (
            <>
              <div className="content-frame-heading">
                <div>
                  <span className="dashboard-kicker">Memory Canvas</span>
                  <h2>{activeMemory.title}</h2>
                  <p>{activeMemory.description || 'Drag pieces around to arrange the page. Everything stays local.'}</p>
                </div>
                <div className="dashboard-hero-actions">
                  <button className="dashboard-secondary-action" onClick={() => setActiveMemory(null)}>Back to Memories</button>
                  <button className="dashboard-secondary-action" onClick={() => renameMemory(activeMemory).catch(err => setStatus(err.message))}>Rename</button>
                  <button className="dashboard-secondary-action" onClick={() => openDashboardLibrary()}>Open Library</button>
                  <button className="dashboard-secondary-action danger-action" onClick={() => deleteMemory(activeMemory.id, activeMemory.title).catch(err => setStatus(err.message))}>Delete Memory</button>
                </div>
              </div>

              <section className="memory-add-panel">
                <input value={memoryItemSearch} onChange={event => setMemoryItemSearch(event.target.value)} placeholder="Search vault items to add..." />
                <div className="memory-scrapbook-toolbar">
                  <span>Scrapbook</span>
                  <button type="button" onClick={() => addMemoryDecoration('string').catch(err => setStatus(err.message))}>Red String</button>
                  <button type="button" onClick={() => addMemoryDecoration('arrow').catch(err => setStatus(err.message))}>Arrow</button>
                  <button type="button" onClick={() => addMemoryDecoration('pin').catch(err => setStatus(err.message))}>Pin</button>
                  <button type="button" onClick={() => addMemoryDecoration('label').catch(err => setStatus(err.message))}>Label</button>
                  <div className="memory-color-palette" aria-label="Scrapbook color">
                    {memoryScrapbookPalette.map(color => (
                      <button
                        key={color.value}
                        type="button"
                        className={memoryDecorationColor === color.value ? 'active' : ''}
                        title={selectedMemoryDecorationIds.size > 0 ? `Apply ${color.name}` : `Use ${color.name} for new pieces`}
                        aria-label={selectedMemoryDecorationIds.size > 0 ? `Apply ${color.name}` : `Use ${color.name}`}
                        style={{ ['--swatch-color' as any]: color.value }}
                        onClick={() => applyMemoryDecorationColor(color.value).catch(err => setStatus(err.message))}
                      />
                    ))}
                  </div>
                  {selectedMemoryCount > 0 && (
                    <button type="button" className="danger-action" onClick={() => deleteSelectedMemoryPieces().catch(err => setStatus(err.message))}>
                      Delete selected ({selectedMemoryCount})
                    </button>
                  )}
                </div>
                {memorySearchResults.length > 0 && (
                  <div className="memory-search-results">
                    {memorySearchResults.map(item => (
                      <button key={item.id} type="button" onClick={() => addItemToActiveMemory(item.id).catch(err => setStatus(err.message))}>
                        {item.thumbnail_data ? <img src={item.thumbnail_data} alt="" style={imageRotationStyle(item)} /> : item.type === 'note' ? <FileText size={16} /> : <FolderOpen size={16} />}
                        <span>{item.title || item.file_name || 'Untitled'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section
                ref={memoryCanvasRef}
                className={`memory-canvas memory-theme-${activeMemory.theme || 'cozy'} ${draggingMemoryItem || draggingMemoryDecoration || draggingMemoryPlayer ? 'is-dragging' : ''} ${panningMemoryCanvas ? 'is-panning' : ''} ${resizingMemoryItem || resizingMemoryDecoration ? 'is-resizing' : ''}`}
                onWheelCapture={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (memoryCanvasRef.current) {
                    zoomMemoryCanvas(memoryCanvasRef.current, event.clientX, event.clientY, event.deltaY);
                  }
                }}
                onMouseMove={event => {
                  panMemoryCanvas(event);
                  updateMemoryCanvasSelection(event);
                  moveMemoryItem(event);
                  moveMemoryDecoration(event);
                  moveMemoryPlayer(event);
                  resizeMemoryItem(event);
                  resizeMemoryDecoration(event);
                }}
                onMouseUp={() => {
                  endMemoryItemDrag();
                  endMemoryDecorationDrag();
                  endMemoryPlayerDrag();
                  endMemoryItemResize();
                  endMemoryDecorationResize();
                  endMemoryCanvasSelection();
                  endMemoryCanvasPan();
                }}
                onMouseLeave={() => {
                  endMemoryItemDrag();
                  endMemoryDecorationDrag();
                  endMemoryPlayerDrag();
                  endMemoryItemResize();
                  endMemoryDecorationResize();
                  endMemoryCanvasSelection();
                  endMemoryCanvasPan();
                }}
              >
                <div className="memory-zoom-hud" onWheel={event => event.stopPropagation()}>
                  <span>{Math.round(memoryCanvasZoom * 100)}%</span>
                  <button type="button" onClick={() => setMemoryCanvasZoom(zoom => Math.max(0.35, Number((zoom - 0.1).toFixed(2))))}>−</button>
                  <button type="button" onClick={resetMemoryCanvasZoom}>Reset</button>
                  <button type="button" onClick={() => setMemoryCanvasZoom(zoom => Math.min(2.4, Number((zoom + 0.1).toFixed(2))))}>+</button>
                </div>
                <div
                  className="memory-canvas-zoom-space"
                  style={{ width: memoryCanvasBaseWidth * memoryCanvasZoom, height: memoryCanvasBaseHeight * memoryCanvasZoom }}
                >
                  <div
                    className="memory-canvas-board"
                    style={{ width: memoryCanvasBaseWidth, height: memoryCanvasBaseHeight, transform: `scale(${memoryCanvasZoom})` }}
                    onMouseDown={event => {
                      if (event.target !== event.currentTarget) return;
                      if (event.altKey || event.button === 1) beginMemoryCanvasPan(event);
                      else beginMemoryCanvasSelection(event);
                    }}
                  >
                {memorySelectionBox && (
                  <div
                    className="memory-selection-box"
                    style={{
                      left: Math.min(memorySelectionBox.startX, memorySelectionBox.currentX),
                      top: Math.min(memorySelectionBox.startY, memorySelectionBox.currentY),
                      width: Math.abs(memorySelectionBox.currentX - memorySelectionBox.startX),
                      height: Math.abs(memorySelectionBox.currentY - memorySelectionBox.startY)
                    }}
                  />
                )}
                {activeMemoryAudioItems.length > 0 && (
                  <aside
                    className="memory-floating-player"
                    style={{ left: activeMemory.player_x ?? 40, top: activeMemory.player_y ?? 40 }}
                    onMouseDown={beginMemoryPlayerDrag}
                  >
                    <span className="dashboard-kicker">Memory Mix</span>
                    <strong>{activeMemoryAudioItems.length} track{activeMemoryAudioItems.length === 1 ? '' : 's'}</strong>
                    <div className="memory-player-track-list">
                      {activeMemoryAudioItems.slice(0, 6).map(item => (
                        <button key={item.id} type="button" onMouseDown={event => event.stopPropagation()} onClick={() => playAudioItem(item)}>
                          <span>♪</span>
                          <small>{item.title || item.file_name || 'Untitled track'}</small>
                        </button>
                      ))}
                    </div>
                  </aside>
                )}
                {activeMemory.decorations.map(decoration => (
                  <div
                    key={decoration.id}
                    className={`memory-decoration memory-decoration-${decoration.kind} ${selectedMemoryDecorationIds.has(decoration.id) ? 'selected' : ''}`}
                    style={{
                      left: decoration.x,
                      top: decoration.y,
                      width: decoration.width,
                      height: decoration.height,
                      transform: `rotate(${decoration.rotation}deg)`,
                      ['--memory-decoration-color' as any]: decoration.color || undefined
                    }}
                    onMouseDown={event => {
                      selectMemoryDecoration(event, decoration.id);
                      beginMemoryDecorationDrag(event, decoration);
                    }}
                    onDoubleClick={() => editMemoryDecorationLabel(decoration)}
                  >
                    <button
                      type="button"
                      className="memory-decoration-remove"
                      onMouseDown={event => event.stopPropagation()}
                      onClick={event => {
                        event.stopPropagation();
                        removeMemoryDecoration(decoration.id).catch(err => setStatus(err.message));
                      }}
                    >
                      ×
                    </button>
                    {decoration.kind === 'arrow' && <span className="memory-arrow-head">➜</span>}
                    {decoration.kind === 'pin' && <span className="memory-pin-head">📌</span>}
                    {decoration.kind === 'label' && (
                      <button
                        type="button"
                        className="memory-label-text"
                        title="Click to edit"
                        onMouseDown={event => event.stopPropagation()}
                        onClick={event => {
                          event.stopPropagation();
                          editMemoryDecorationLabel(decoration);
                        }}
                      >
                        {decoration.label || 'caption'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="memory-decoration-resize"
                      aria-label="Resize scrapbook item"
                      onMouseDown={event => beginMemoryDecorationResize(event, decoration)}
                    />
                  </div>
                ))}
                {activeMemoryVisualItems.length === 0 ? (
                  <div className="memory-empty-canvas">
                    <strong>{activeMemoryAudioItems.length > 0 ? 'Music is ready in Memory Mix' : 'Blank canvas'}</strong>
                    <small>{activeMemoryAudioItems.length > 0 ? 'Add photos, notes, or files when you want visual scrapbook pieces.' : 'Search above to add photos, notes, files, or anything else visual in the vault.'}</small>
                  </div>
                ) : activeMemoryVisualItems.map(memoryItem => (
                  <article
                    key={memoryItem.item.id}
                    className={`memory-canvas-card ${isImageItem(memoryItem.item) ? 'memory-photo-card' : ''} ${selectedMemoryItemIds.has(memoryItem.item.id) ? 'selected' : ''}`}
                    style={{ left: memoryItem.x, top: memoryItem.y, width: memoryItem.width, height: memoryItem.height }}
                    onMouseDown={event => {
                      selectMemoryItem(event, memoryItem.item.id);
                      beginMemoryItemDrag(event, memoryItem);
                    }}
                  >
                    <button
                      type="button"
                      className="memory-open-item"
                      onMouseDown={event => event.stopPropagation()}
                      onClick={event => {
                        event.stopPropagation();
                        openDashboardItem(memoryItem.item);
                      }}
                    >
                      {memoryItem.item.type === 'note' ? 'Edit' : 'Open'}
                    </button>
                    <button
                      type="button"
                      className="memory-remove-item"
                      onMouseDown={event => event.stopPropagation()}
                      onClick={event => {
                        event.stopPropagation();
                        removeItemFromActiveMemory(memoryItem.item.id).catch(err => setStatus(err.message));
                      }}
                    >
                      ×
                    </button>
                    {memoryItem.item.thumbnail_data ? (
                      <img
                        src={memoryItem.item.thumbnail_data}
                        alt=""
                        draggable={false}
                        onDragStart={event => event.preventDefault()}
                        style={imageRotationStyle(memoryItem.item)}
                      />
                    ) : isAudioItem(memoryItem.item) ? (
                      <span className="memory-audio-icon">♪</span>
                    ) : memoryItem.item.type === 'note' ? (
                      <FileText size={28} />
                    ) : (
                      <FolderOpen size={28} />
                    )}
                    {!isImageItem(memoryItem.item) && <strong>{memoryItem.item.title || memoryItem.item.file_name || 'Untitled'}</strong>}
                    {!isImageItem(memoryItem.item) && memoryItem.item.body && !memoryItem.item.private && <small>{memoryItem.item.body.slice(0, 120)}</small>}
                    {isAudioItem(memoryItem.item) && <button type="button" onMouseDown={event => event.stopPropagation()} onClick={() => playAudioItem(memoryItem.item)}>Play</button>}
                    <button
                      type="button"
                      className="memory-resize-handle"
                      aria-label="Resize memory item"
                      onMouseDown={event => beginMemoryItemResize(event, memoryItem)}
                    />
                  </article>
                ))}
                  </div>
                </div>
              </section>
            </>
          )}

          {status && <div className="status-bar">{status}</div>}
        </main>
      ) : appView === 'locations' ? (
        <main className="dashboard-panel journal-subpage-panel">
          <div className="content-frame-heading">
            <div>
              <span className="dashboard-kicker">Photo Locations</span>
              <h2>Locations found in metadata</h2>
              <p>Grouped location strings pulled from imported photo/video metadata.</p>
            </div>
            <div className="dashboard-hero-actions">
              <button className="dashboard-secondary-action" onClick={() => changeAppView('mode')}>Back to Photos</button>
            </div>
          </div>

          <LocationPlot
            locations={locationSummaries}
            mapTileBaseUrl={mapTileBaseUrl}
            isDownloadingMap={isDownloadingMap}
            onDownloadTiles={downloadOfflineMapTiles}
          />

          <section className="dashboard-cards location-card-grid">
            {locationSummaries.length === 0 ? (
              <div className="dashboard-card static-card">
                <span>No locations yet</span>
                <strong>Import metadata</strong>
                <small>Locations appear when imported media includes location metadata.</small>
              </div>
            ) : locationSummaries.map(location => (
              <article key={location.location} className="dashboard-card location-card">
                <span>Location</span>
                <strong>{location.location}</strong>
                <small>{location.count} item{location.count === 1 ? '' : 's'}</small>
                <div className="location-examples">
                  {location.examples.map(example => (
                    <button key={example.id} onClick={() => openRelationshipItem(example.id)}>
                      {example.title || example.fileName || 'Untitled'}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </section>

          {status && <div className="status-bar">{status}</div>}
        </main>
      ) : appView === 'relationships' ? (
        <main className="dashboard-panel journal-subpage-panel">
          <div className="content-frame-heading">
            <div>
              <span className="dashboard-kicker">Relationships</span>
              <h2>Connected items across your vault</h2>
              <p>Relationships link notes, photos, files, and music so connected ideas stay together.</p>
            </div>
            <div className="dashboard-hero-actions">
              <button className="dashboard-secondary-action" onClick={() => changeAppView('mode')}>Back to Notes</button>
              <button className="dashboard-secondary-action" onClick={() => openDashboardLibrary()}>Open Library</button>
            </div>
          </div>

          <section className="memory-hero-grid">
            <div className="memory-hero-card">
              <span>Relationship threads</span>
              <strong>{allRelationships.length}</strong>
              <small>Every connection you create becomes a thread you can follow later.</small>
            </div>
            <div className="memory-hero-card">
              <span>Connected hubs</span>
              <strong>{relationshipHubs.length}</strong>
              <small>Items with the most connections rise to the top so you can follow an idea quickly.</small>
            </div>
            <div className="memory-hero-card memory-hero-card-warm">
              <span>How to build one</span>
              <strong>Open an item → Relationships</strong>
              <small>Connect a note to a photo, a song to a note, or a file to a collection idea.</small>
            </div>
          </section>

          <div className="relationship-view-toggle">
            <button type="button" className={relationshipPageView === 'hubs' ? 'active' : ''} onClick={() => setRelationshipPageView('hubs')}>Hub view</button>
            <button type="button" className={relationshipPageView === 'manage' ? 'active' : ''} onClick={() => setRelationshipPageView('manage')}>Manage table</button>
          </div>

          {relationshipPageView === 'hubs' && relationshipHubs.length > 0 && (
            <>
              <div className="dashboard-section-label relationships-section-label">
                <span>Relationship hubs</span>
                <small>Every connected item as a hub, sorted by strongest connection count.</small>
              </div>
              <section className="relationship-hub-grid">
                {relationshipHubs.map(hub => (
                  <article key={hub.item.id} className="relationship-hub-card">
                    <div>
                      <span className="relationship-type-pill">{hub.item.type}</span>
                      <h3>{hub.item.title || hub.item.fileName || 'Untitled'}</h3>
                      <p>{hub.count} connection{hub.count === 1 ? '' : 's'} · Updated {formatDate(hub.latest)}</p>
                    </div>
                    <div className="relationship-hub-links">
                      {hub.related.slice(0, 4).map(item => (
                        <button key={item.id} type="button" onClick={() => openRelationshipItem(item.id)}>
                          {item.title || item.fileName || 'Untitled'}
                        </button>
                      ))}
                    </div>
                    <button type="button" className="relationship-open-hub" onClick={() => openRelationshipItem(hub.item.id)}>
                      Open hub
                    </button>
                  </article>
                ))}
              </section>
            </>
          )}

          {relationshipPageView === 'hubs' && relationshipHubs.length === 0 && (
            <section className="relationship-hub-grid">
              <div className="dashboard-card static-card">
                <span>No relationships yet</span>
                <strong>Connect two things</strong>
                <small>Use the Relationships tab on an item to connect it to another note, file, photo, or song.</small>
              </div>
            </section>
          )}

          {relationshipPageView === 'manage' && (
            <>
              <div className="dashboard-section-label relationships-section-label">
                <span>Manage relationships</span>
                <small>Table view for reviewing and removing individual relationship threads.</small>
              </div>
              <section className="relationship-manage-table">
                {allRelationships.length === 0 ? (
                  <div className="dashboard-card static-card">
                    <span>No relationships yet</span>
                    <strong>Nothing to manage</strong>
                    <small>Create relationships from an item’s Relationships tab first.</small>
                  </div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Related item</th>
                        <th>Note</th>
                        <th>Created</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...allRelationships]
                        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
                        .map(relationship => (
                          <tr key={`${relationship.source_item_id}-${relationship.target_item_id}`}>
                            <td>
                              <button type="button" onClick={() => openRelationshipItem(relationship.source.id)}>
                                <span>{relationship.source.type}</span>
                                {relationship.source.title || relationship.source.fileName || 'Untitled'}
                              </button>
                            </td>
                            <td>
                              <button type="button" onClick={() => openRelationshipItem(relationship.target.id)}>
                                <span>{relationship.target.type}</span>
                                {relationship.target.title || relationship.target.fileName || 'Untitled'}
                              </button>
                            </td>
                            <td>{relationship.note || '—'}</td>
                            <td>{formatDate(relationship.created_at)}</td>
                            <td>
                              <button type="button" className="relationship-remove-table" onClick={() => removeRelationshipThread(relationship).catch(err => setStatus(err.message))}>
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}

          {status && <div className="status-bar">{status}</div>}
        </main>
      ) : appView === 'library' ? (
        <>
          {!isDetailFocus && <section className="list-panel">
            <div className="list-panel-header">
              <div>
                <span className="list-eyebrow">{libraryFavoriteOnly ? 'Starred' : activeCollection ? 'Collection' : 'Library'}</span>
                <h2>{libraryFavoriteOnly ? 'Starred Items' : activeCollection?.name || (typeFilter === 'note' ? 'Notes' : typeFilter === 'file' ? 'Files' : 'All Items')}</h2>
              </div>
              <div className="list-panel-header-actions">
                {activeCollection && (
                  <button type="button" onClick={() => backToCollections().catch(err => setStatus(err.message))}>
                    Back to Collections
                  </button>
                )}
                <button type="button" onClick={isListFocus ? showSplitLibrary : focusLibraryList}>
                  {isListFocus ? 'Show Detail' : 'Focus'}
                </button>
              </div>
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
              {libraryFavoriteOnly ? 'Starred: ' : activeCollection ? `${activeCollection.name}: ` : ''}
              {items.length} item{items.length === 1 ? '' : 's'}
              <label className="sort-control">Sort
                <select value={itemSort} onChange={event => setItemSort(event.target.value as ItemSort)}>
                  <option value="updated">Date updated</option>
                  <option value="created">Date taken</option>
                  <option value="title">A–Z</option>
                  <option value="tags">Tags</option>
                </select>
              </label>
            </div>

            {activeMusicChildCollections.length > 0 && (
              <section className="music-child-collection-panel">
                <div className="dashboard-section-label">
                  <span>Albums / projects</span>
                  <small>Collections under {activeCollection?.name}. Pick one to see its tracks and notes.</small>
                </div>
                <div className="music-child-collection-grid">
                  {activeMusicChildCollections.map(collection => (
                    <button key={collection.id} type="button" onClick={() => openCollectionLibrary(collection.id).catch(err => setStatus(err.message))}>
                      <span>{collection.name}</span>
                      <strong>{collection.count || 0}</strong>
                      <small>{collection.count === 1 ? 'item' : 'items'}</small>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {workspaceMode === 'music' && activeCollection && (
              <section className="subcollection-create-panel">
                <div className="subcollection-create-group">
                  <input
                    value={newCollectionName}
                    onChange={event => setNewCollectionName(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') createCollection();
                    }}
                    placeholder={`New album/project under ${activeCollection.name}...`}
                  />
                  <button type="button" onMouseDown={event => event.preventDefault()} onClick={createCollection}>
                    Add Sub-Collection
                  </button>
                </div>
                {attachableMusicSubCollections.length > 0 && (
                  <div className="subcollection-create-group">
                    <select value={subCollectionAttachId} onChange={event => setSubCollectionAttachId(event.target.value)}>
                      <option value="">Attach existing album/project...</option>
                      {attachableMusicSubCollections.map(collection => (
                        <option key={collection.id} value={collection.id}>
                          {collection.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={attachExistingSubCollection} disabled={!subCollectionAttachId}>
                      Attach Existing
                    </button>
                  </div>
                )}
              </section>
            )}

            {!showingMusicSubCollectionLanding && <>
            <div className="pagination-row">
              <button disabled={libraryPage === 0} onClick={() => refresh({ page: Math.max(0, libraryPage - 1) })}>Previous</button>
              <span>Page {libraryPage + 1}</span>
              <button disabled={!libraryHasNextPage} onClick={() => refresh({ page: libraryPage + 1 })}>Next</button>
            </div>

            {canShowLibraryContentFilter && <div className="library-content-filter" aria-label="Filter library content">
              {([
                ['all', 'Everything'],
                ['notes', 'Notes'],
                ['documents', 'Docs'],
                ['media', 'Photos/Videos'],
                ['audio', 'Audio']
              ] as [LibraryContentFilter, string][]).map(([filter, label]) => (
                <button
                  key={filter}
                  type="button"
                  className={libraryContentFilter === filter ? 'active' : ''}
                  onClick={() => {
                    setLibraryContentFilter(filter);
                    if (filter === 'notes') setTypeFilter('note');
                    else if (filter === 'documents' || filter === 'media' || filter === 'audio') setTypeFilter('file');
                    else setTypeFilter('all');
                  }}
                >
                  {label}
                </button>
              ))}
            </div>}

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
                  aria-current={selectedId === item.id ? 'true' : undefined}
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
                    {item.thumbnail_data && <img className="item-thumbnail" src={item.thumbnail_data} alt="" style={imageRotationStyle(item)} />}
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
            </>}
          </section>}

          {!isListFocus && !showingMusicSubCollectionLanding && <main className="detail-panel">
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
                    ['preview', 'Preview'],
                    ['notes', 'Note'],
                    ['info', `Info${relationships.length ? ` (${relationships.length})` : ''}`]
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

                <label className="field-label">Date taken / created</label>
                <input
                  className="compact-date-input"
                  type="datetime-local"
                  value={draftCreatedAt}
                  disabled={!isSelectedEditing}
                  onChange={event => {
                    markDraftTouched();
                    setDraftCreatedAt(event.target.value);
                  }}
                />

                </>}

                {detailTab === 'preview' && selected?.type === 'file' && isImageItem(selected) && (
                  <div className="detail-file-preview media-preview-large detail-media-preview">
                    <div className="media-preview-toolbar">
                      <span>{selected.file_name || selected.title}</span>
                      <button type="button" onClick={() => toggleFullscreen('.detail-media-preview')}>
                        <Maximize2 size={15} /> Fullscreen
                      </button>
                      <button type="button" onClick={() => rotateImage(selected, -90)}>
                        <RotateCcw size={15} /> Rotate Left
                      </button>
                      <button type="button" onClick={() => rotateImage(selected, 90)}>
                        <RotateCw size={15} /> Rotate Right
                      </button>
                    </div>
                    <img
                      src={selectedMediaUrl || selected.thumbnail_data || ''}
                      alt={selected.title || selected.file_name || 'File preview'}
                      style={{ transform: `rotate(${selected.image_rotation || 0}deg)` }}
                    />
                  </div>
                )}

                {detailTab === 'preview' && selected?.type === 'file' && isVideoItem(selected) && (
                  <div className="detail-file-preview media-preview-large detail-media-preview">
                    <div className="media-preview-toolbar">
                      <span>{selected.file_name || selected.title}</span>
                      <button type="button" onClick={() => toggleFullscreen('.detail-media-preview')}>
                        <Maximize2 size={15} /> Fullscreen
                      </button>
                    </div>
                    {selectedMediaUrl ? (
                      <video src={selectedMediaUrl} controls preload="metadata" />
                    ) : (
                      <div className="detail-preview-card">
                        <FolderOpen size={34} />
                        <h3>{selected.file_name || 'Video file'}</h3>
                        <p>Video preview is loading.</p>
                      </div>
                    )}
                  </div>
                )}

                {detailTab === 'preview' && selected?.type === 'file' && isAudioItem(selected) && (
                  <div className="detail-file-preview audio-preview-card">
                    <div className="music-cover-placeholder music-cover-large">♪</div>
                    <div>
                      <span className="dashboard-kicker">Audio Preview</span>
                      <h3>{selected.title || selected.file_name || 'Audio file'}</h3>
                      <p>Play this track here, or start it in the bottom player and keep browsing.</p>
                      {selectedMediaUrl ? <audio src={selectedMediaUrl} controls preload="metadata" onPlay={pauseAppAudioPlayer} /> : <small>Audio preview is loading.</small>}
                      <div className="detail-preview-actions">
                        <button type="button" onClick={() => playAudioItem(selected)}>Play in App Player</button>
                      </div>
                    </div>
                  </div>
                )}

                {detailTab === 'preview' && selected?.type === 'file' && !isImageItem(selected) && !isVideoItem(selected) && !isAudioItem(selected) && !selected.thumbnail_data && (
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
                      <button onClick={() => setDetailTab('notes')}>Note</button>
                      <button onClick={() => setDetailTab('info')}>Info</button>
                    </div>
                    <label className="field-label">
                      {selected.tags?.includes('google-photos') ? 'Google Photos metadata' : 'Readable file text and metadata'}
                    </label>
                    {fileMetadataText(selected) ? (
                      <MarkdownPreview value={fileMetadataText(selected)} />
                    ) : (
                      <div className="detail-preview-card">
                        <FileText size={34} />
                        <h3>No readable text yet</h3>
                        <p>No readable text or metadata was found in this file.</p>
                      </div>
                    )}
                  </>
                )}

                {detailTab === 'preview' && selected?.type !== 'file' && (
                  <MarkdownPreview value={draftBody || 'No note text yet.'} />
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

                <>
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

                </>

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

                {false && <>
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

                <RichNoteEditor
                  value={draftBody}
                  editable={isSelectedEditing}
                  placeholder="Type notes, markdown, code blocks, links, reminders, or try /h1, /h3, /bullet, /todo..."
                  onChange={value => {
                    markDraftTouched();
                    setDraftBody(value);
                  }}
                />
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
              <h1>{workspaceMode === 'photo' ? 'Photo Library' : 'Search Vault'}</h1>
              <p>
                {workspaceMode === 'photo' && photoWorkspaceView === 'library'
                  ? 'A warm, browse-first place for photos and videos by date.'
                  : workspaceMode === 'photo'
                  ? 'Search photos and videos by words, tags, collections, or filename.'
                  : 'Search by note text, file name, tags, projects, people, tasks, or reference notes.'}
              </p>
            </div>

            <div className="search-header-actions">
              <button onClick={() => changeAppView('mode')}>{workspaceMode === 'photo' ? 'Photo Dashboard' : workspaceMode === 'music' ? 'Music Dashboard' : 'Notes Dashboard'}</button>
              <button onClick={() => changeAppView('dashboard')}>Home</button>
              <button onClick={clearFullSearch}>{workspaceMode === 'photo' ? 'Clear Photo Search' : 'Clear Search'}</button>
            </div>
          </div>

          {workspaceMode === 'photo' && photoWorkspaceView === 'library' && (
            <div className="photo-library-welcome">
              <div>
                <strong>Browse your saved moments</strong>
                <span>Sort by date, open previews, or jump into search when you want to find something specific.</span>
              </div>
              <button onClick={() => openPhotoSearch({ skipConfirm: true })}>
                <Search size={16} /> Search Photos
              </button>
            </div>
          )}

          {(workspaceMode !== 'photo' || photoWorkspaceView === 'search') && <div className="full-search-box" onMouseDown={() => searchInputRef.current?.focus()}>
            <Search size={22} />
            <input
              ref={searchInputRef}
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              onMouseDown={event => event.stopPropagation()}
              placeholder="Search tasks, projects, people, notes, files..."
              autoFocus
            />
          </div>}

          {(workspaceMode !== 'photo' || photoWorkspaceView === 'search') && <div className="search-filters">
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

            <label className="search-sort-control">
              <span>Sort</span>
              <select value={searchSort} onChange={event => setSearchSort(event.target.value as SearchSort)}>
                <option value="created">Date taken</option>
                <option value="updated">Recently updated</option>
                <option value="title">A-Z</option>
              </select>
            </label>

            <button onClick={() => runFullSearch(0)}>Search</button>
          </div>}

          {workspaceMode === 'photo' && photoWorkspaceView === 'library' && (
            <div className="photo-browse-controls">
              <label className="search-sort-control">
                <span>Sort photos</span>
                <select value={searchSort} onChange={event => {
                  setSearchSort(event.target.value as SearchSort);
                  window.setTimeout(() => runFullSearch(0), 0);
                }}>
                  <option value="created">Date taken</option>
                  <option value="updated">Recently updated</option>
                  <option value="title">A-Z</option>
                </select>
              </label>
            </div>
          )}

          <div className="search-results-header">
            <span>
              {searchResults.length} result{searchResults.length === 1 ? '' : 's'}
            </span>

            {(workspaceMode !== 'photo' || photoWorkspaceView === 'search') && (searchText || searchTags.length > 0 || searchUntaggedOnly || searchType !== 'all') && (
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

          <div className="pagination-row search-pagination-row">
            <button disabled={searchPage === 0} onClick={() => runFullSearch(Math.max(0, searchPage - 1))}>Previous</button>
            <span>Page {searchPage + 1}</span>
            <button disabled={!searchHasNextPage} onClick={() => runFullSearch(searchPage + 1)}>Next</button>
          </div>

          <div className={`search-results-grid search-results-${searchViewMode} ${workspaceMode === 'photo' && photoWorkspaceView === 'library' ? 'photo-library-results-grid' : ''}`}>
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
                    item.thumbnail_data && isImageItem(item) ? (
                      <>
                        <ImageGridThumbnail item={item} />
                        <span className="photo-date-badge">{formatDate(item.created_at)}</span>
                      </>
                    ) : (
                      <span className={`search-result-grid-placeholder ${isVideoItem(item) ? 'video-thumb-placeholder' : isAudioItem(item) ? 'audio-thumb-placeholder' : ''}`}>
                        {item.type === 'note' ? (
                          <FileText size={34} />
                        ) : isVideoItem(item) ? (
                          <>
                            <VideoGridThumbnail item={item} />
                            <span className="photo-date-badge">{formatDate(item.created_at)}</span>
                          </>
                        ) : isAudioItem(item) ? (
                          <span className="music-cover-placeholder">♪</span>
                        ) : (
                          <FolderOpen size={34} />
                        )}
                      </span>
                    )
                  ) : (
                    <>
                      <div className="item-card-top">
                        {item.thumbnail_data && <img className="item-thumbnail" src={item.thumbnail_data} alt="" style={imageRotationStyle(item)} />}
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
            <div
              className={`search-preview-backdrop ${workspaceMode === 'photo' && photoWorkspaceView === 'library' && isImageItem(searchPreviewItem) ? 'photo-library-preview-backdrop' : ''}`}
              onMouseDown={() => setSearchPreviewItem(null)}
            >
              <section
                className={`search-preview-dialog ${isImageItem(searchPreviewItem) ? 'search-preview-dialog-media' : ''} ${workspaceMode === 'photo' && photoWorkspaceView === 'library' && isImageItem(searchPreviewItem) ? 'photo-library-preview-dialog' : ''}`}
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
                {isImageItem(searchPreviewItem) && (searchPreviewMediaUrl || searchPreviewItem.thumbnail_data) && (
                  <div className={`search-preview-media-wrap search-preview-media ${workspaceMode === 'photo' && photoWorkspaceView === 'library' ? 'photo-library-preview-media' : ''}`}>
                    <div className="media-preview-toolbar">
                      <span>{searchPreviewItem.file_name || searchPreviewItem.title}</span>
                      <button type="button" onClick={() => toggleFullscreen(workspaceMode === 'photo' && photoWorkspaceView === 'library' ? '.photo-library-preview-media' : '.search-preview-media')}>
                        <Maximize2 size={15} /> {fullscreenSelector === '.photo-library-preview-media' ? 'Exit fullscreen' : 'Fullscreen'}
                      </button>
                      <button type="button" onClick={() => rotateImage(searchPreviewItem, -90)}>
                        <RotateCcw size={15} /> Rotate Left
                      </button>
                      <button type="button" onClick={() => rotateImage(searchPreviewItem, 90)}>
                        <RotateCw size={15} /> Rotate Right
                      </button>
                    </div>
                    <img
                      className="search-preview-image"
                      src={searchPreviewMediaUrl || searchPreviewItem.thumbnail_data || ''}
                      alt={searchPreviewItem.title || 'Preview'}
                      style={{ transform: `rotate(${searchPreviewItem.image_rotation || 0}deg)` }}
                    />
                  </div>
                )}
                {isVideoItem(searchPreviewItem) && (
                  <div className="search-preview-media-wrap search-preview-media">
                    <div className="media-preview-toolbar">
                      <span>{searchPreviewItem.file_name || searchPreviewItem.title}</span>
                      <button type="button" onClick={() => toggleFullscreen('.search-preview-media')}>
                        <Maximize2 size={15} /> Fullscreen
                      </button>
                    </div>
                    {searchPreviewMediaUrl ? (
                      <VideoPreviewPlayer src={searchPreviewMediaUrl} />
                    ) : (
                      <div className="detail-preview-card">
                        <FolderOpen size={34} />
                        <h3>{searchPreviewItem.file_name || 'Video file'}</h3>
                        <p>Video preview is loading.</p>
                      </div>
                    )}
                  </div>
                )}
                {isAudioItem(searchPreviewItem) && (
                  <div className="search-preview-media-wrap audio-preview-card">
                    <div className="music-cover-placeholder music-cover-large">♪</div>
                    <div>
                      <span className="dashboard-kicker">Audio Preview</span>
                      <h3>{searchPreviewItem.title || searchPreviewItem.file_name || 'Audio file'}</h3>
                      {searchPreviewMediaUrl ? <audio src={searchPreviewMediaUrl} controls preload="metadata" onPlay={pauseAppAudioPlayer} /> : <small>Audio preview is loading.</small>}
                      <div className="detail-preview-actions">
                        <button type="button" onClick={() => playAudioItem(searchPreviewItem)}>Play in App Player</button>
                      </div>
                    </div>
                  </div>
                )}
                <div className="search-preview-meta">
                  {searchPreviewItem.file_name && <span>{searchPreviewItem.file_name}</span>}
                  {searchPreviewItem.file_ext && <span>{searchPreviewItem.file_ext.toUpperCase().replace('.', '')}</span>}
                </div>
                {(searchPreviewItem.tags?.includes('google-photos') ? fileMetadataText(searchPreviewItem) : previewNotesText(searchPreviewItem)) && (
                  <section className="search-preview-section">
                    <h3>{searchPreviewItem.type === 'file' && searchPreviewItem.tags?.includes('google-photos') ? 'Google Photos metadata' : searchPreviewItem.type === 'file' ? 'Notes / imported content' : 'Note'}</h3>
                    <pre className="search-preview-content">
                      <HighlightedText text={searchPreviewItem.tags?.includes('google-photos') ? fileMetadataText(searchPreviewItem) : previewNotesText(searchPreviewItem)} query={searchText} />
                    </pre>
                  </section>
                )}
                {searchPreviewItem.type === 'file' && !searchPreviewItem.tags?.includes('google-photos') && previewReadableText(searchPreviewItem) && previewReadableText(searchPreviewItem) !== previewNotesText(searchPreviewItem) && (
                  <section className="search-preview-section search-preview-section-secondary">
                    <h3>Readable file text</h3>
                    <pre className="search-preview-content">
                      <HighlightedText text={previewReadableText(searchPreviewItem)} query={searchText} />
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
            <div className="search-header-actions">
              {settingsTab === 'tags' && (
                <button type="button" onClick={() => changeAppView('mode')}>Back to Notes</button>
              )}
              <button type="button" onClick={() => changeAppView('dashboard')}>Home Dashboard</button>
            </div>
          </div>

          <div className="settings-tabs">
            {([
              ['general', 'General'],
              ['license', 'License'],
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
            <h2>Welcome Guide</h2>
            <p>Replay the first-time setup tour to explain modes, navigation, imports, collections, tags, and relationships.</p>
            <div className="settings-actions">
              <button type="button" onClick={reopenOnboarding}>Show Welcome Guide</button>
            </div>
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

          <section className="settings-section settings-license">
            <h2>License</h2>
            <p>
              Note Vault includes a 30-day trial. After the trial, the app locks until a valid license
              key is activated online once. After activation, the signed device license is stored locally
              so the app can keep working offline.
            </p>
            <div className="metadata-repair-summary">
              <strong>{licenseStatus?.licensed ? 'Licensed' : licenseStatus?.locked ? 'Trial expired' : 'Trial active'}</strong>
              <div>
                <span>{licenseStatus?.licensed ? `Licensed to: ${licenseStatus.licenseName || 'User'}` : `${licenseStatus?.trialDaysRemaining ?? 30} trial day${licenseStatus?.trialDaysRemaining === 1 ? '' : 's'} remaining`}</span>
                {licenseStatus?.licensed && <span>Device activated</span>}
                {!licenseStatus?.licensed && licenseStatus?.trialEndsAt && <span>Trial ends: {new Date(licenseStatus.trialEndsAt).toLocaleDateString()}</span>}
                {licenseStatus?.licensed && licenseStatus?.licenseExpiresAt && <span>License expires: {new Date(licenseStatus.licenseExpiresAt).toLocaleDateString()}</span>}
              </div>
            </div>
            <div className="settings-control">
              <label htmlFor="license-key">License key</label>
              <input id="license-key" value={licenseKeyInput} onChange={event => setLicenseKeyInput(event.target.value)} placeholder="Paste license key..." />
              <button type="button" onClick={activateLicense}>Activate License</button>
            </div>
            <p className="settings-note">
              Activation checks {licenseStatus?.activationServerUrl || 'your license server'} and locks this install to device
              {licenseStatus?.deviceId ? ` ${licenseStatus.deviceId.slice(0, 12)}...` : ' fingerprint'}.
            </p>
          </section>

          <section className="settings-section settings-google-photos">
            <h2>Google Photos</h2>
            <p>
              Repair metadata for photos already imported from Google Takeout. Choose the same folder
              that contains your Takeout ZIP files; Note Vault will scan the JSON sidecars and update
              existing Google Photos vault items without importing duplicates.
            </p>
            <div className="settings-actions">
              <button onClick={repairGooglePhotosMetadata} disabled={isRepairingPhotos || isImportingPhotos}>
                <Image size={16} /> {isRepairingPhotos ? 'Repairing Metadata...' : 'Repair Google Photos Metadata'}
              </button>
            </div>
            {photoRepairResult && (
              <div className="metadata-repair-summary">
                <strong>Last repair summary</strong>
                <div>
                  <span>ZIPs: {photoRepairResult.zipCount || 0}</span>
                  <span>JSON files: {photoRepairResult.metadataFiles || 0}</span>
                  <span>Items scanned: {photoRepairResult.scannedItems || 0}</span>
                  <span>Matched: {photoRepairResult.matched || 0}</span>
                  <span>Updated: {photoRepairResult.updated || 0}</span>
                  <span>Unmatched: {photoRepairResult.unmatched || 0}</span>
                </div>
                {(photoRepairResult.matchedExamples?.length || 0) > 0 && (
                  <small>Matched examples: {photoRepairResult.matchedExamples?.join(', ')}</small>
                )}
                {(photoRepairResult.unmatchedExamples?.length || 0) > 0 && (
                  <small>Unmatched examples: {photoRepairResult.unmatchedExamples?.join(', ')}</small>
                )}
                {(photoRepairResult.unmatchedDetails?.length || 0) > 0 && (
                  <div className="metadata-debug-list">
                    <strong>Unmatched diagnostics</strong>
                    {photoRepairResult.unmatchedDetails?.map(detail => <small key={detail}>{detail}</small>)}
                  </div>
                )}
              </div>
            )}
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
              <label htmlFor="backup-encryption-password">Encrypted automatic backups</label>
              <label className="theme-toggle">
                <input
                  type="checkbox"
                  checked={backupEncryptionEnabled}
                  onChange={event => {
                    if (!event.target.checked && backupEncryptionSaved) {
                      setStatus('Enter your current backup password, then click Turn Off Password Protection.');
                      return;
                    }
                    setBackupEncryptionEnabled(event.target.checked);
                  }}
                />
                <span>Password protect future restore backups</span>
              </label>
              {backupEncryptionEnabled && (
                <>
                  <div className="password-input-row">
                    <input
                      id="backup-encryption-password"
                      type={showBackupEncryptionPassword ? 'text' : 'password'}
                      value={backupEncryptionPassword}
                      onChange={event => setBackupEncryptionPassword(event.target.value)}
                      placeholder={backupEncryptionSaved ? 'Current or new backup password' : 'Backup password, 8+ characters'}
                    />
                    <button
                      type="button"
                      className="password-eye-button"
                      onClick={() => setShowBackupEncryptionPassword(value => !value)}
                      aria-label={showBackupEncryptionPassword ? 'Hide backup password' : 'Show backup password'}
                      title={showBackupEncryptionPassword ? 'Hide password' : 'Show password'}
                    >
                      {showBackupEncryptionPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <div className="settings-button-row">
                    <button type="button" onClick={() => saveBackupEncryption(true)}>
                      {backupEncryptionSaved ? 'Update Backup Password' : 'Save Backup Password'}
                    </button>
                    {backupEncryptionSaved && (
                      <button type="button" className="danger-soft" onClick={() => saveBackupEncryption(false)}>
                        Turn Off Password Protection
                      </button>
                    )}
                  </div>
                </>
              )}
              <p className="settings-warning">
                Save this password somewhere safe. Encrypted backups cannot be imported without it.
              </p>
            </div>

            <div className="settings-control">
              <span>Backup folder</span>
              <code className="backup-path">{backupDirectory || 'Loading…'}</code>
              <button onClick={chooseBackupFolder}>Choose Backup Folder</button>
            </div>
          </section>

          <section className="settings-section settings-compact settings-updates">
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

          </div>

          {status && <div className="status-bar">{status}</div>}
        </main>
      )}

      {currentAudioItem && (
        <aside className="now-playing-bar" aria-label="Now playing">
          <audio
            ref={audioPlayerRef}
            src={currentAudioUrl}
            className="now-playing-audio"
            onPlay={() => {
              setIsAudioPlaying(true);
              recordCurrentAudioPlay();
            }}
            onPause={() => setIsAudioPlaying(false)}
            onEnded={() => playNextAudioItem().catch(() => setIsAudioPlaying(false))}
            onLoadedMetadata={event => setAudioDuration(event.currentTarget.duration || 0)}
            onTimeUpdate={event => setAudioProgress(event.currentTarget.currentTime || 0)}
          />
          <button type="button" className="now-playing-skip" onClick={() => playPreviousAudioItem().catch(err => setStatus(err.message))} aria-label="Previous track">
            Prev
          </button>
          <button type="button" className="now-playing-play" onClick={toggleAudioPlayback}>
            {isAudioPlaying ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="now-playing-skip" onClick={() => playNextAudioItem().catch(err => setStatus(err.message))} aria-label="Next track">
            Next
          </button>
          <div className="now-playing-title">
            <span>Now playing</span>
            <strong>{currentAudioItem.title || currentAudioItem.file_name || 'Untitled track'}</strong>
          </div>
          <div className="now-playing-scrubber">
            <input
              type="range"
              min="0"
              max={Math.max(0, audioDuration || 0)}
              step="0.1"
              value={Math.min(audioProgress, audioDuration || audioProgress || 0)}
              onChange={event => scrubAudio(Number(event.target.value))}
              aria-label="Track progress"
            />
            <span>{Math.floor(audioProgress / 60)}:{String(Math.floor(audioProgress % 60)).padStart(2, '0')}</span>
          </div>
          <button type="button" onClick={() => openDashboardItem(currentAudioItem)}>Open</button>
          <button type="button" onClick={() => {
            audioPlayerRef.current?.pause();
            setCurrentAudioItem(null);
            setCurrentAudioUrl('');
            setIsAudioPlaying(false);
          }}>Close</button>
        </aside>
      )}
    </div>
  );
}
