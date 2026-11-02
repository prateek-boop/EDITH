import type { FileNode } from './types'

// Matches [[Target]], [[Target#section]], [[Target|alias]], [[Target#section|alias]]
const WIKILINK_REGEX = /\[\[([^\[\]|#]+?)(?:#[^\[\]|]*)?(?:\|[^\[\]]*?)?\]\]/g
// Matches [Label](./path/to/target.ext) markdown links
const MD_LINK_REGEX = /\[[^\]]*\]\(([^)]+?\.(?:md|tsx?|jsx?|py|json|html|css))\)/g

/**
 * Extract all link targets from markdown content.
 * Returns targets deduplicated.
 */
export function extractWikilinks(content: string): string[] {
  const targets: string[] = []
  let match: RegExpExecArray | null

  WIKILINK_REGEX.lastIndex = 0
  while ((match = WIKILINK_REGEX.exec(content)) !== null) {
    const target = match[1].trim()
    if (target) targets.push(target)
  }

  MD_LINK_REGEX.lastIndex = 0
  while ((match = MD_LINK_REGEX.exec(content)) !== null) {
    const raw = match[1].trim()
    // Ignore external URLs
    if (raw && !raw.startsWith('http://') && !raw.startsWith('https://') && !raw.startsWith('#')) {
      const clean = raw.replace(/^(\.\/|\.\.\/)+/, '').split(/[?#]/)[0]
      if (clean) targets.push(clean)
    }
  }

  return [...new Set(targets)]
}

export function basename(path: string, ext?: string): string {
  const name = path.split('/').pop() ?? path
  if (ext && name.endsWith(ext)) return name.slice(0, -ext.length)
  return name
}

export function dirname(path: string): string {
  const parts = path.split('/')
  parts.pop()
  return parts.join('/')
}

/**
 * Resolve a wikilink target to a FileNode.
 * Uses the EDITH FileNode type (type: 'file'|'folder').
 * Shortest path wins (fewest parent directories).
 */
export function resolveWikilink(
  target: string,
  flatFiles: FileNode[]
): FileNode | null {
  const targetLower = target.toLowerCase()
  const hasSlash = targetLower.includes('/')

  const candidates = flatFiles.filter((f) => {
    if (f.type !== 'file') return false
    
    const ext = f.name.includes('.') ? '.' + f.name.split('.').pop() : ''
    const nameWithoutExt = ext ? basename(f.name, ext).toLowerCase() : f.name.toLowerCase()
    const pathWithoutExt = ext ? f.path.substring(0, f.path.length - ext.length).toLowerCase() : f.path.toLowerCase()

    if (hasSlash) {
      return pathWithoutExt === targetLower || pathWithoutExt.endsWith('/' + targetLower) ||
             f.path.toLowerCase() === targetLower || f.path.toLowerCase().endsWith('/' + targetLower)
    }
    
    return nameWithoutExt === targetLower || f.name.toLowerCase() === targetLower
  })

  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  return candidates.reduce((best, current) => {
    const bestDepth = best.path.split('/').length
    const currDepth = current.path.split('/').length
    return currDepth < bestDepth ? current : best
  })
}

/**
 * Flatten a FileNode tree into a flat array.
 */
export function flattenTree(nodes: FileNode[], out: FileNode[] = []): FileNode[] {
  for (const node of nodes) {
    out.push(node)
    if (node.children) flattenTree(node.children, out)
  }
  return out
}

/**
 * Build graph nodes and edges from the vault file tree using wikilinks.
 * Each .md file = node. Each [[wikilink]] = edge.
 */
export function buildWikilinkGraph(files: FileNode[], graphEdges?: { source: string; target: string; relation: string }[]): {
  nodes: { id: string; label: string; group: string; linkCount: number }[]
  edges: { source: string; target: string }[]
  linkMap: Record<string, string[]>
} {
  const flat = flattenTree(files)
  const allFiles = flat.filter((f) => f.type === 'file')

  const linkMap: Record<string, string[]> = {}
  for (const f of allFiles) {
    if (f.content) {
      linkMap[f.path] = extractWikilinks(f.content)
    }
  }

  const edgeSet = new Set<string>()
  const edges: { source: string; target: string }[] = []
  const inboundCount: Record<string, number> = {}
  const outboundCount: Record<string, number> = {}

  // Add explicit wikilinks & markdown links
  for (const [sourcePath, targets] of Object.entries(linkMap)) {
    for (const target of targets) {
      const resolved = resolveWikilink(target, allFiles)
      if (resolved && resolved.path !== sourcePath) {
        const key = `${sourcePath}->${resolved.path}`
        if (!edgeSet.has(key)) {
          edgeSet.add(key)
          edges.push({ source: sourcePath, target: resolved.path })
          inboundCount[resolved.path] = (inboundCount[resolved.path] ?? 0) + 1
          outboundCount[sourcePath] = (outboundCount[sourcePath] ?? 0) + 1
        }
      }
    }
  }

  // Add automatic code imports and structural relationships if provided
  const fileIdSet = new Set(allFiles.map((f) => f.path))
  if (graphEdges) {
    for (const edge of graphEdges) {
      // Connect file to file edges (imports, module, sibling)
      if (fileIdSet.has(edge.source) && fileIdSet.has(edge.target) && edge.source !== edge.target) {
        const key = `${edge.source}->${edge.target}`
        if (!edgeSet.has(key)) {
          edgeSet.add(key)
          edges.push({ source: edge.source, target: edge.target })
          inboundCount[edge.target] = (inboundCount[edge.target] ?? 0) + 1
          outboundCount[edge.source] = (outboundCount[edge.source] ?? 0) + 1
        }
      }
    }
  }

  const nodes = allFiles.map((f) => {
    const isMd = f.name.endsWith('.md')
    return {
      id: f.path,
      label: isMd ? basename(f.name, '.md') : f.name,
      group: dirname(f.path) || 'root',
      linkCount: (inboundCount[f.path] ?? 0) + (outboundCount[f.path] ?? 0),
    }
  })

  // Filter edges to ensure nodes exist
  const nodeIds = new Set(nodes.map((n) => n.id))
  const finalEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))

  return { nodes, edges: finalEdges, linkMap }
}
