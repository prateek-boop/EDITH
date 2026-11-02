import { useMemo, useEffect, useRef } from 'react'
import { useEdithStore } from '../../store/useEdithStore'
import { GraphCanvas } from './GraphCanvas'
import { GraphSettings } from './GraphSettings'

export function GraphView() {
  const wikilinkNodes = useEdithStore((s) => s.wikilinkNodes)
  const wikilinkEdges = useEdithStore((s) => s.wikilinkEdges)
  const reindexWikilinks = useEdithStore((s) => s.reindexWikilinks)
  const graphSettings = useEdithStore((s) => s.graphSettings)
  const resetCameraRef = useRef<(() => void) | null>(null)

  // Index wikilinks on mount if not already indexed
  useEffect(() => {
    if (wikilinkNodes.length === 0) reindexWikilinks()
  }, [wikilinkNodes.length, reindexWikilinks])

  // Apply search filter and orphan filter
  const filteredNodes = useMemo(() => {
    let nodes = wikilinkNodes
    const q = graphSettings.filters.search.trim().toLowerCase()
    if (q) {
      nodes = nodes.filter(
        (n) => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)
      )
    }
    if (!graphSettings.filters.orphans) {
      const linked = new Set<string>()
      wikilinkEdges.forEach((e) => {
        linked.add(e.source)
        linked.add(e.target)
      })
      nodes = nodes.filter((n) => linked.has(n.id))
    }
    return nodes
  }, [wikilinkNodes, wikilinkEdges, graphSettings.filters])

  const filteredEdges = useMemo(() => {
    const nodeIds = new Set(filteredNodes.map((n) => n.id))
    return wikilinkEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
  }, [filteredNodes, wikilinkEdges])

  return (
    <div
      className="obsidian-graph-view standard-view graph-view"
      style={{ flex: 1, padding: 0, display: 'flex', flexDirection: 'column', height: '100%', width: '100%', position: 'relative', overflow: 'hidden' }}
    >
      <div
        className="obsidian-graph-stage graph-stage"
        style={{ flex: 1, position: 'relative', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden' }}
      >
        <details className="graph-file-list"><summary>Browse {filteredNodes.length} files</summary><div>{filteredNodes.slice(0,200).map(node=><button key={node.id} onClick={()=>{useEdithStore.getState().openFileByPath(node.id);useEdithStore.getState().setActiveView('workspace')}}>{node.label}<small>{node.linkCount} links</small></button>)}{filteredNodes.length>200&&<p>Search to narrow these results.</p>}</div></details>
        <GraphSettings onResetCamera={() => resetCameraRef.current?.()} />
        {filteredNodes.length === 0 ? (
          <div className="obsidian-graph-empty">
            <div className="obsidian-graph-empty-icon">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <circle cx="18" cy="18" r="4" fill="rgba(168,130,255,0.3)" />
                <circle cx="32" cy="14" r="3" fill="rgba(168,130,255,0.2)" />
                <circle cx="26" cy="30" r="3.5" fill="rgba(168,130,255,0.25)" />
                <circle cx="14" cy="34" r="2.5" fill="rgba(168,130,255,0.15)" />
                <circle cx="38" cy="32" r="2" fill="rgba(168,130,255,0.15)" />
                <line x1="18" y1="18" x2="32" y2="14" stroke="rgba(168,130,255,0.15)" strokeWidth="1" />
                <line x1="18" y1="18" x2="26" y2="30" stroke="rgba(168,130,255,0.15)" strokeWidth="1" />
                <line x1="32" y1="14" x2="26" y2="30" stroke="rgba(168,130,255,0.15)" strokeWidth="1" />
                <line x1="14" y1="34" x2="26" y2="30" stroke="rgba(168,130,255,0.15)" strokeWidth="1" />
              </svg>
            </div>
            <strong>No notes in graph</strong>
            <span>Add markdown files with [[WikiLinks]] or workspace files to visualize connections.</span>
          </div>
        ) : (
          <GraphCanvas
            nodes={filteredNodes}
            edges={filteredEdges}
            onResetCameraRef={resetCameraRef}
          />
        )}
      </div>
    </div>
  )
}
