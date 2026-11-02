import type { FileNode, WorkspaceGraphEdge, WorkspaceGraphNode } from './types'

const TEXT_EXTENSIONS = new Set([
  'ts','tsx','js','jsx','mjs','cjs','py','json','md','txt','yaml','yml','toml','ini','env',
  'html','css','scss','less','sql','java','kt','go','rs','rb','php','cs','cpp','c','h','hpp',
  'sh','bash','zsh','ps1','xml','vue','svelte','astro','prisma','graphql','gql','proto','svg',
  'csv','tsv','conf','cfg','properties','lock','rst','diff','patch','log','json5','jsonc'
])

const COMMON_TEXT_NAMES = new Set([
  'dockerfile', 'makefile', 'procfile', 'license', 'readme', 'gemfile', 'vagrantfile',
  '.gitignore', '.env', '.env.example', '.prettierrc', '.eslintrc', '.babelrc', '.editorconfig',
  '.npmrc', '.nvmrc', '.gitattributes'
])

export function isTextFile(name: string, mime: string = ''): boolean {
  const lower = name.toLowerCase()
  if (COMMON_TEXT_NAMES.has(lower)) return true
  const ext = extensionOf(lower)
  if (ext && TEXT_EXTENSIONS.has(ext)) return true
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript') || mime.includes('xml')) return true
  return false
}

const MAX_TEXT_BYTES = 2_000_000
const MAX_FILES_TO_READ = 600

// In-memory handle registry for local browser files to ensure zero-blank-file guarantee
export const localFileHandleMap = new Map<string, File>()

export async function readLocalFileContent(path: string): Promise<string | null> {
  const file = localFileHandleMap.get(path)
  if (!file) return null
  try {
    return await file.text()
  } catch {
    return null
  }
}

const IGNORED_PARTS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out', '.nuxt', '.output',
  'target', 'bin', 'obj', 'vendor', '.venv', 'venv', 'env', '__pycache__',
  '.runtime', '.cache', '.turbo', '.parcel-cache', '.idea', '.vscode', '.DS_Store'
])

export function isIgnoredPath(relPath: string): boolean {
  const parts = relPath.split('/')
  return parts.some((p) => IGNORED_PARTS.has(p))
}

const extensionOf = (name: string) => name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
const baseName = (path: string) => path.split('/').pop() || path
const dirName = (path: string) => path.includes('/') ? path.split('/').slice(0,-1).join('/') : ''

export function languageFromName(name: string) {
  const ext = extensionOf(name)
  const map: Record<string,string> = {
    ts:'typescript',tsx:'tsx',js:'javascript',jsx:'jsx',mjs:'javascript',cjs:'javascript',py:'python',md:'markdown',json:'json',html:'html',css:'css',scss:'scss',sql:'sql',yml:'yaml',yaml:'yaml',toml:'toml',sh:'shell',bash:'shell',zsh:'shell',ps1:'powershell',java:'java',go:'go',rs:'rust',rb:'ruby',php:'php',cs:'csharp',cpp:'cpp',c:'c',vue:'vue',svelte:'svelte',txt:'text',graphql:'graphql',gql:'graphql',prisma:'prisma',svg:'xml',xml:'xml',csv:'csv'
  }
  return map[ext] || ext || 'text'
}

function insertNode(root: FileNode[], path: string, content: string | undefined, size: number) {
  const parts = path.split('/').filter(Boolean)
  let level = root
  let current = ''
  for (let i = 0; i < parts.length; i++) {
    const name = parts[i]
    current = current ? `${current}/${name}` : name
    const last = i === parts.length - 1
    let existing = level.find((node) => node.name === name && node.type === (last ? 'file' : 'folder'))
    if (!existing) {
      existing = last
        ? { name, type: 'file', path: current, language: languageFromName(name), content, size }
        : { name, type: 'folder', path: current, children: [] }
      level.push(existing)
    }
    if (!last) level = existing.children || (existing.children = [])
  }
}

export async function getFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const files: File[] = []
  const items = Array.from(dataTransfer.items || [])

  async function traverseEntry(entry: any, path: string): Promise<void> {
    if (!entry) return
    if (entry.isFile) {
      return new Promise<void>((resolve) => {
        entry.file((file: File) => {
          try {
            Object.defineProperty(file, 'webkitRelativePath', {
              value: path ? `${path}/${file.name}` : file.name,
              writable: true,
            })
          } catch {
            // Ignore descriptor issues
          }
          files.push(file)
          resolve()
        }, () => resolve())
      })
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      const readAllEntries = async (): Promise<any[]> => {
        const entries: any[] = []
        let done = false
        while (!done) {
          const batch = await new Promise<any[]>((resolve) => {
            reader.readEntries((b: any[]) => resolve(b || []), () => resolve([]))
          })
          if (!batch.length) {
            done = true
          } else {
            entries.push(...batch)
          }
        }
        return entries
      }

      const children = await readAllEntries()
      const nextPath = path ? `${path}/${entry.name}` : entry.name
      for (const child of children) {
        if (!IGNORED_PARTS.has(child.name)) {
          await traverseEntry(child, nextPath)
        }
      }
    }
  }

  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean)
  if (entries.length > 0) {
    for (const entry of entries) {
      await traverseEntry(entry, '')
    }
    return files
  }

  return Array.from(dataTransfer.files)
}

export async function buildWorkspaceFromFileList(files: FileList | File[]) {
  const list = Array.from(files)
  if (!list.length) {
    throw new Error('No files provided')
  }
  const first = list[0] as File & { webkitRelativePath?: string }
  const rootName = first?.webkitRelativePath?.split('/')[0] || 'Local Project'
  const tree: FileNode[] = []

  // 1. Filter out ignored directories immediately to avoid memory spikes
  const normalized = list.map((file) => {
    const f = file as File & { webkitRelativePath?: string }
    const rel = f.webkitRelativePath || f.name
    const withoutRoot = rel.startsWith(`${rootName}/`) ? rel.slice(rootName.length + 1) : rel
    return { file, path: withoutRoot }
  }).filter((entry) => entry.path && !isIgnoredPath(entry.path))

  // Register in-memory file handles for instant on-demand reads
  localFileHandleMap.clear()
  for (const entry of normalized) {
    localFileHandleMap.set(entry.path, entry.file)
  }

  // 2. Select priority files to read content
  const filesToRead = normalized
    .filter(({ file }) => isTextFile(file.name, file.type) && file.size <= MAX_TEXT_BYTES)
    .slice(0, MAX_FILES_TO_READ)

  // 3. Batched async reading with event-loop yields to keep UI 100% fluid
  const contents = new Map<string, string>()
  const BATCH_SIZE = 16
  for (let i = 0; i < filesToRead.length; i += BATCH_SIZE) {
    const batch = filesToRead.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(async ({ file, path }) => {
      try {
        const text = await file.text()
        contents.set(path, text)
      } catch {
        // Ignore unreadable binary or locked file
      }
    }))
    // Yield to keep browser thread responsive
    await new Promise((r) => setTimeout(r, 0))
  }

  // 4. Deterministic tree building without race conditions
  for (const { file, path } of normalized) {
    const content = contents.get(path)
    insertNode(tree, path, content, file.size)
  }

  const sortTree=(nodes:FileNode[])=>{nodes.sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name):a.type==='folder'?-1:1);nodes.forEach((n)=>n.children&&sortTree(n.children))}
  sortTree(tree)

  const allPaths = normalized.map((x) => x.path)
  const packageText = normalized.find((x) => x.path.endsWith('package.json'))
  const tech = detectTech(allPaths, packageText ? await safeText(packageText.file) : '')
  const graph = buildGraphFromTree(tree)

  return {
    name: rootName,
    path: `~/Projects/${rootName}`,
    files: tree,
    graphNodes: graph.nodes,
    graphEdges: graph.edges,
    tech,
    fileCount: normalized.length,
    gitDetected: allPaths.some((p) => p.startsWith('.git/') || p === '.gitignore'),
  }
}

async function safeText(file: File) {
  try { return file.size < MAX_TEXT_BYTES ? await file.text() : '' } catch { return '' }
}

function detectTech(paths: string[], packageJson: string) {
  const lower = paths.map((p) => p.toLowerCase())
  const tech = new Set<string>()
  const has = (suffix: string) => lower.some((p) => p.endsWith(suffix))
  if (has('.tsx') || has('.jsx')) tech.add('React')
  if (has('.ts') || has('.tsx')) tech.add('TypeScript')
  if (has('.js') || has('.jsx')) tech.add('JavaScript')
  if (has('.py')) tech.add('Python')
  if (packageJson.includes('next')) tech.add('Next.js')
  if (packageJson.includes('vite')) tech.add('Vite')
  if (packageJson.includes('three')) tech.add('Three.js')
  if (lower.some((p) => p.endsWith('requirements.txt') || p.endsWith('pyproject.toml'))) tech.add('Python')
  if (lower.some((p) => p.includes('fastapi'))) tech.add('FastAPI')
  if (lower.some((p) => p.endsWith('dockerfile') || p.includes('docker-compose'))) tech.add('Docker')
  if (!tech.size) tech.add('Local workspace')
  return Array.from(tech).slice(0,6)
}

export function flatten(nodes: FileNode[], out: FileNode[] = []) {
  for (const node of nodes) {
    out.push(node)
    if (node.children) flatten(node.children, out)
  }
  return out
}

function resolveRelativePath(baseDir: string, relativePath: string): string {
  const parts = baseDir ? baseDir.split('/') : []
  const segments = relativePath.split('/')
  for (const seg of segments) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (parts.length > 0) parts.pop()
    } else {
      parts.push(seg)
    }
  }
  return parts.join('/')
}

function matchCandidatePath(targetNoExt: string, filePaths: Set<string>): string | null {
  const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.py', '.json', '.css', '/index.ts', '/index.tsx', '/index.js', '/index.jsx']
  for (const ext of exts) {
    const check = targetNoExt + ext
    if (filePaths.has(check)) return check
  }
  return null
}

export function resolveImportTarget(importerPath: string, rawImport: string, filePaths: Set<string>): string | null {
  const norm = rawImport.replace(/\\/g, '/')
  const importerDir = dirName(importerPath)

  // 1. JS/TS relative imports: ./ or ../
  if (norm.startsWith('./') || norm.startsWith('../')) {
    const resolved = resolveRelativePath(importerDir, norm)
    const hit = matchCandidatePath(resolved, filePaths)
    if (hit) return hit
  }

  // 2. Python relative imports: .module or ..module
  if (norm.startsWith('.')) {
    const dotMatch = norm.match(/^(\.+)(.*)$/)
    if (dotMatch) {
      const dotCount = dotMatch[1].length
      const rest = dotMatch[2].replace(/\./g, '/')
      const parts = importerDir ? importerDir.split('/') : []
      for (let i = 1; i < dotCount; i++) {
        if (parts.length > 0) parts.pop()
      }
      if (rest) parts.push(rest)
      const hit = matchCandidatePath(parts.join('/'), filePaths)
      if (hit) return hit
    }
  }

  // 3. Path aliases: @/ -> src/ or ~/ -> src/
  if (norm.startsWith('@/') || norm.startsWith('~/')) {
    const aliased = 'src/' + norm.slice(2)
    const hit = matchCandidatePath(aliased, filePaths)
    if (hit) return hit
  }

  // 4. Dot-separated Python module: server.gateway -> server/gateway
  if (norm.includes('.') && !norm.includes('/')) {
    const asPath = norm.replace(/\./g, '/')
    const hit = matchCandidatePath(asPath, filePaths)
    if (hit) return hit
  }

  // 5. Direct root path match
  const direct = matchCandidatePath(norm, filePaths)
  if (direct) return direct

  // 6. Same directory relative (e.g. Python bare import)
  if (importerDir) {
    const inDir = importerDir + '/' + norm
    const hit = matchCandidatePath(inDir, filePaths)
    if (hit) return hit
  }

  return null
}

export function buildGraphFromTree(tree: FileNode[]) {
  const flat = flatten(tree)
  const visible = flat.filter((n) => !n.path.split('/').some((part) => ['node_modules','.git','dist','build','.next','venv','.venv','__pycache__','.runtime','test-results','.system_generated'].includes(part))).slice(0,500)
  const nodes: WorkspaceGraphNode[] = visible.map((node) => ({
    id: node.path,
    label: node.name,
    path: node.path,
    kind: node.type,
    language: node.language,
    cluster: node.path.split('/')[0] || 'root',
    weight: node.type === 'folder' ? Math.min(5, (node.children?.length || 1) + 1) : 1,
  }))
  const ids = new Set(nodes.map((n) => n.id))
  const filePaths = new Set(nodes.filter(n => n.kind === 'file').map(n => n.path || n.id))
  const edges: WorkspaceGraphEdge[] = []
  const edgeSet = new Set<string>()

  // Folder contains edges
  for (const node of visible) {
    if (node.path.includes('/')) {
      const parent = dirName(node.path)
      if (ids.has(parent)) {
        const id = `contains:${parent}->${node.path}`
        edgeSet.add(id)
        edges.push({ id, source: parent, target: node.path, relation: 'contains' })
      }
    }
  }

  // Code AST import edges
  const files = visible.filter((n) => n.type === 'file' && n.content)
  for (const file of files) {
    const imports = extractImports(file.content || '')
    for (const imp of imports.slice(0, 25)) {
      const target = resolveImportTarget(file.path, imp, filePaths)
      if (target && target !== file.path) {
        const id = `imports:${file.path}->${target}`
        if (!edgeSet.has(id)) {
          edgeSet.add(id)
          edges.push({ id, source: file.path, target, relation: 'imports' })
        }
      }
    }
  }

  // Module / directory sibling edges for structural cohesion
  const dirMap = new Map<string, string[]>()
  for (const node of visible) {
    if (node.type === 'file') {
      const dir = dirName(node.path)
      if (!dirMap.has(dir)) dirMap.set(dir, [])
      dirMap.get(dir)!.push(node.path)
    }
  }
  for (const [, dirFiles] of dirMap.entries()) {
    if (dirFiles.length > 1) {
      for (let i = 0; i < dirFiles.length - 1; i++) {
        const s = dirFiles[i]
        const t = dirFiles[i + 1]
        const id = `related_to:${s}->${t}`
        if (!edgeSet.has(id)) {
          edgeSet.add(id)
          edges.push({ id, source: s, target: t, relation: 'related_to' })
        }
      }
    }
  }

  edges.forEach(e => {
    const s = nodes.find(n => n.id === e.source)
    const t = nodes.find(n => n.id === e.target)
    if (s) s.weight = (s.weight || 1) + 0.3
    if (t) t.weight = (t.weight || 1) + 0.3
  })

  return { nodes, edges: edges.slice(0, 1000) }
}

export function extractImports(content: string): string[] {
  const found = new Set<string>()
  const patterns = [
    /(?:import|export)\s+(?:[\w*\s{},]*\s+from\s+)?['\"]([^'\"]+)['\"]/g,
    /import\(\s*['\"]([^'\"]+)['\"]\s*\)/g,
    /require\(\s*['\"]([^'\"]+)['\"]\s*\)/g,
    /^\s*from\s+([.\w]+)\s+import/gm,
    /^\s*import\s+([.\w]+)/gm,
    /@import\s+['\"]([^'\"]+)['\"]/g,
  ]
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    for (const match of content.matchAll(pattern)) {
      if (match[1]) {
        const raw = match[1].trim()
        if (raw) found.add(raw)
      }
    }
  }
  return Array.from(found)
}
