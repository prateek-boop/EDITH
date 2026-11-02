import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, ChevronDown, FileCode2, Folder, FolderOpen, FileText, Search, Plus, FolderPlus, Trash2, Edit3, X, MoreHorizontal } from 'lucide-react'
import { motion } from 'framer-motion'
import type { FileNode } from '../../lib/types'
import { useEdithStore } from '../../store/useEdithStore'
import { fileNameError } from '../../lib/fileNames'
import { Dialog } from '../ui/Dialog'
import { SearchField } from '../ui/SearchField'
import { EditorPane } from '../editor/EditorPane'

// ── Tree filtering ───────────────────────────────────────────────────────────

function filterTree(nodes: FileNode[], query: string): FileNode[] {
  if (!query) return nodes
  const q = query.toLowerCase()
  return nodes.flatMap((node) => {
    if (node.type === 'file') return node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q) ? [node] : []
    const children = filterTree(node.children || [], query)
    return children.length || node.name.toLowerCase().includes(q) ? [{ ...node, children }] : []
  })
}

function countFiles(nodes: FileNode[]): number { return nodes.reduce((sum, n) => sum + (n.type === 'file' ? 1 : countFiles(n.children || [])), 0) }

// ── Context menu ─────────────────────────────────────────────────────────────

interface ContextMenu {
  x: number
  y: number
  node: FileNode
}

// ── Tree node ────────────────────────────────────────────────────────────────

function TreeNode({ node, depth = 0, forceOpen = false, onContextMenu }: {
  node: FileNode
  depth?: number
  forceOpen?: boolean
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void
}) {
  const [open, setOpen] = useState(true)
  const selectedFile = useEdithStore((s) => s.selectedFile)
  const openFileByPath = useEdithStore((s) => s.openFileByPath)
  const isFolder = node.type === 'folder'
  const expanded = forceOpen || open
  const isActive = selectedFile?.path === node.path

  const handleClick = () => {
    if (isFolder) setOpen(!expanded)
    else openFileByPath(node.path)
  }

  return (
    <div className="workspace-tree-node">
      <button
        className={`tree-row ${isActive ? 'selected' : ''}`}
        style={{ paddingLeft: 12 + depth * 17 }}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, node)}
        aria-expanded={isFolder ? expanded : undefined}
        data-path={node.path}
        data-is-dir={String(isFolder)}
      >
        {isFolder ? (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className="tree-spacer" />}
        {isFolder ? (expanded ? <FolderOpen size={14} /> : <Folder size={14} />) : node.language === 'markdown' ? <FileText size={14} /> : <FileCode2 size={14} />}
        <span>{node.name.replace(/\.md$/, '')}</span>
      </button>
      <button className="tree-more" aria-label={`Actions for ${node.name}`} onClick={(e) => onContextMenu(e, node)}><MoreHorizontal size={14}/></button>
      {isFolder && expanded && node.children?.map((c) => (
        <TreeNode node={c} depth={depth + 1} key={c.path} forceOpen={forceOpen} onContextMenu={onContextMenu} />
      ))}
    </div>
  )
}

// ── Main view ────────────────────────────────────────────────────────────────

export function FilesView() {
  const files = useEdithStore((s) => s.files)
  const selectedFile = useEdithStore((s) => s.selectedFile)
  const workspace = useEdithStore((s) => s.currentWorkspace)
  const createVaultFile = useEdithStore((s) => s.createVaultFile)
  const createVaultFolder = useEdithStore((s) => s.createVaultFolder)
  const renameVaultFile = useEdithStore((s) => s.renameVaultFile)
  const deleteVaultFile = useEdithStore((s) => s.deleteVaultFile)
  const openFileByPath = useEdithStore((s) => s.openFileByPath)
  const reindexWikilinks = useEdithStore((s) => s.reindexWikilinks)

  const [nameError, setNameError] = useState('')
  const [deleting, setDeleting] = useState<FileNode | null>(null)
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => filterTree(files, query), [files, query])

  // ── Context menu state ──
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [renaming, setRenaming] = useState<FileNode | null>(null)
  const [newName, setNewName] = useState('')
  const [creatingIn, setCreatingIn] = useState<string | null>(null)
  const [createName, setCreateName] = useState('')
  const [createType, setCreateType] = useState<'file' | 'folder'>('file')

  useEffect(() => {
    if (!contextMenu) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setContextMenu(null) } }
    const outside = (event: PointerEvent) => { if (!(event.target as Element).closest('.vault-context-menu')) setContextMenu(null) }
    document.addEventListener('keydown', close); document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('pointerdown', outside) }
  }, [contextMenu])

  // Auto-select first file
  useEffect(() => {
    if (!selectedFile && files.length) {
      const findFirst = (nodes: FileNode[]): FileNode | null => {
        for (const n of nodes) {
          if (n.type === 'file') return n
          const nested = findFirst(n.children || [])
          if (nested) return nested
        }
        return null
      }
      const first = findFirst(files)
      if (first) openFileByPath(first.path)
    }
  }, [files, selectedFile, openFileByPath])

  // Index wikilinks on mount
  useEffect(() => { reindexWikilinks() }, [reindexWikilinks])

  // ── Context menu handlers ──
  const handleContextMenu = (e: React.MouseEvent, node: FileNode) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, node })
  }

  const closeMenu = () => setContextMenu(null)

  const handleDelete = () => {
    if (!contextMenu) return
    setDeleting(contextMenu.node)
    closeMenu()
  }

  const handleStartRename = () => {
    if (!contextMenu) return
    setNameError('')
    setRenaming(contextMenu.node)
    setNewName(contextMenu.node.name)
    closeMenu()
  }

  const handleRename = () => {
    if (!renaming || !newName.trim()) return
    const error = fileNameError(newName.trim(), renaming.path.split('/').slice(0,-1).join('/'), files, renaming.path)
    if (error) { setNameError(error); return }
    renameVaultFile(renaming.path, newName.trim())
    setRenaming(null)
  }

  const targetDir = (node: FileNode) =>
    node.type === 'folder' ? node.path : node.path.substring(0, node.path.lastIndexOf('/'))

  const handleStartCreate = (type: 'file' | 'folder') => {
    if (!contextMenu) return
    setNameError('')
    setCreatingIn(targetDir(contextMenu.node))
    setCreateType(type)
    setCreateName('')
    closeMenu()
  }

  const handleCreate = () => {
    if (creatingIn === null || !createName.trim()) return
    const name = createName.trim()
    const error = fileNameError(createType === 'file' && !name.endsWith('.md') ? `${name}.md` : name, creatingIn, files)
    if (error) { setNameError(error); return }
    if (createType === 'file') createVaultFile(creatingIn, createName.trim())
    else createVaultFolder(creatingIn, createName.trim())
    setCreatingIn(null)
  }

  return (
    <div className="standard-view files-view workspace-view" style={{ padding: 0, height: '100%', flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="files-grid upgraded workspace-grid" style={{ flex: 1, height: '100%', gap: 0, gridTemplateColumns: '260px minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)' }}>
        <section className="file-tree workspace-explorer" onClick={contextMenu ? closeMenu : undefined} style={{ background: 'var(--surface-bg, #1e1e1e)', borderRight: '1px solid var(--surface-border)', padding: '10px 0', height: '100%' }}>
          <div className="tree-context" style={{ padding: '0 10px', marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '8px', height: 'auto' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)' }}><FileText size={12} style={{marginRight: '4px', verticalAlign: '-2px'}}/>FILES</span>
            <SearchField label="Search files" value={query} onChange={setQuery}/><button className="new-note-action" onClick={() => { setNameError(''); setCreatingIn(files[0]?.type === 'folder' ? files[0].path : ''); setCreateType('file'); setCreateName('') }}><Plus size={14}/>New note</button>
          </div>
          <div className="workspace-tree-scroll" style={{ padding: '0 10px' }}>
            {filtered.length ? filtered.map((n) => (
              <TreeNode node={n} key={n.path} forceOpen={!!query} onContextMenu={handleContextMenu} />
            )) : <div className="tree-empty">No files match "{query}"</div>}
          </div>
        </section>
        <section className="file-preview workspace-editor" style={{ background: 'var(--surface-bg, #1e1e1e)', padding: 0, borderRadius: 0, border: 'none', minWidth: 0, height: '100%' }}>
          {selectedFile ? (
            <motion.div key={selectedFile.path} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="preview-inner" style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
              <EditorPane />
            </motion.div>
          ) : (
            <div className="empty-panel">
              <FileText size={25} />
              <strong>Workspace indexed</strong>
              <span>Select a file from the explorer to edit it.</span>
            </div>
          )}
        </section>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="vault-context-menu" style={{ left: Math.min(contextMenu.x, window.innerWidth - 180), top: Math.min(contextMenu.y, window.innerHeight - 200) }}>
          <button onClick={() => handleStartCreate('file')}><Plus size={12} /> New note</button>
          <button onClick={() => handleStartCreate('folder')}><FolderPlus size={12} /> New folder</button>
          <div className="ctx-divider" />
          <button onClick={handleStartRename}><Edit3 size={12} /> Rename</button>
          <button className="ctx-danger" onClick={handleDelete}><Trash2 size={12} /> Delete</button>
        </div>
      )}

      {deleting && <Dialog title={`Delete ${deleting.name}?`} onClose={() => setDeleting(null)}><p>This removes {deleting.type === 'folder' ? 'this folder and its contents' : 'this file'} from the current session. Your device files are unchanged.</p><div className="vault-dialog-actions"><button data-autofocus onClick={() => setDeleting(null)}>Cancel</button><button className="danger-action" onClick={() => { deleteVaultFile(deleting.path); setDeleting(null) }}>Delete {deleting.type}</button></div></Dialog>}
      {/* Create dialog */}
      {creatingIn !== null && (
        <Dialog title={`New ${createType}`} onClose={() => setCreatingIn(null)}>
            <input
              data-autofocus
              aria-label={`New ${createType} name`}
              placeholder={`${createType === 'file' ? 'Note' : 'Folder'} name...`}
              className="vault-dialog-input"
              value={createName}
              aria-invalid={!!nameError}
              aria-describedby={nameError ? 'file-name-error' : undefined}
              onChange={(e) => { setCreateName(e.target.value); setNameError('') }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleCreate(); if (e.key === 'Escape') setCreatingIn(null) }}
            />
            {nameError && <p id="file-name-error" className="form-error" role="alert">{nameError}</p>}
            <div className="vault-dialog-actions">
              <button onClick={() => setCreatingIn(null)}>Cancel</button>
              <button className="primary" disabled={!createName.trim()} onClick={handleCreate}>Create</button>
            </div>
        </Dialog>
      )}

      {/* Rename dialog */}
      {renaming && (
        <Dialog title="Rename" onClose={() => setRenaming(null)}>
            <input
              data-autofocus
              className="vault-dialog-input"
              aria-label="New name"
              value={newName}
              aria-invalid={!!nameError}
              aria-describedby={nameError ? 'file-name-error' : undefined}
              onChange={(e) => { setNewName(e.target.value); setNameError('') }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleRename(); if (e.key === 'Escape') setRenaming(null) }}
            />
            {nameError && <p id="file-name-error" className="form-error" role="alert">{nameError}</p>}
            <div className="vault-dialog-actions">
              <button onClick={() => setRenaming(null)}>Cancel</button>
              <button className="primary" onClick={handleRename}>Rename</button>
            </div>
        </Dialog>
      )}
    </div>
  )
}
