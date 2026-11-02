import { useEffect, useRef, useState, useCallback } from 'react'
import { useMotionPreference } from '../ui/useMotionPreference'
import * as d3 from 'd3-force'
import { ZoomIn, ZoomOut, Crosshair } from 'lucide-react'
import { useEdithStore } from '../../store/useEdithStore'

interface GraphNode extends d3.SimulationNodeDatum {
  id: string
  label: string
  group: string
  linkCount: number
}

interface GraphEdge extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode
  target: string | GraphNode
}

interface Tooltip {
  x: number
  y: number
  node: GraphNode
}

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  onResetCameraRef?: React.MutableRefObject<(() => void) | null>
}

// ── Obsidian-authentic color palette ──
const OBS = {
  bg:           '#0a0a0f',
  bgCenter:     '#111118',
  node:         '#7c3aed',
  nodeHover:    '#a78bfa',
  nodeDim:      'rgba(124, 58, 237, 0.12)',
  edgeBase:     'rgba(124, 58, 237, 0.12)',
  edgeHover:    'rgba(167, 139, 250, 0.55)',
  edgeDim:      'rgba(124, 58, 237, 0.03)',
  textPrimary:  'rgba(235, 235, 245, 0.90)',
  textDim:      'rgba(180, 180, 195, 0.45)',
  particle:     'rgba(167, 139, 250, 0.65)',
}

// ── Per-node animation state for smooth lerp transitions ──
interface NodeRenderState {
  alpha: number
  glowIntensity: number
  targetAlpha: number
  targetGlow: number
}

// ── Edge particle ──
interface Particle {
  edge: GraphEdge
  t: number
  speed: number
  size: number
  alpha: number
}

export function GraphCanvas({ nodes, edges, onResetCameraRef }: Props) {
  const reducedMotion = useMotionPreference()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const openFileByPath = useEdithStore((s) => s.openFileByPath)
  const setActiveView = useEdithStore((s) => s.setActiveView)
  const graphSettings = useEdithStore((s) => s.graphSettings)
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)

  // Mutable animation and camera state refs
  const animFrameRef = useRef<number>(0)
  const transformRef = useRef({ x: 0, y: 0, k: 1 })
  const hoveredRef = useRef<string | null>(null)
  const connectedRef = useRef<Set<string>>(new Set())
  const simNodesRef = useRef<GraphNode[]>([])
  const simEdgesRef = useRef<GraphEdge[]>([])
  const particlesRef = useRef<Particle[]>([])
  const dragNodeRef = useRef<GraphNode | null>(null)
  const isDraggingRef = useRef(false)
  const isPanningRef = useRef(false)
  const lastMouseRef = useRef({ x: 0, y: 0 })
  const mouseStartRef = useRef({ x: 0, y: 0 })
  const didDragRef = useRef(false)
  const panStartRef = useRef({ x: 0, y: 0 })
  const panTransformStartRef = useRef({ x: 0, y: 0 })
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null)
  const nodeStatesRef = useRef<Map<string, NodeRenderState>>(new Map())
  const timeRef = useRef(0)
  const sizeRef = useRef({ width: 0, height: 0 })

  const screenToGraph = useCallback((sx: number, sy: number) => {
    const t = transformRef.current
    return { x: (sx - t.x) / t.k, y: (sy - t.y) / t.k }
  }, [])

  const findNode = useCallback((gx: number, gy: number): GraphNode | null => {
    const maxLinks = Math.max(1, ...simNodesRef.current.map(n => n.linkCount))
    const baseScale = graphSettings.display.nodeSize
    const t = transformRef.current
    // Add screen-space hit margin
    const hitMargin = Math.max(6, 12 / t.k)
    for (let i = simNodesRef.current.length - 1; i >= 0; i--) {
      const n = simNodesRef.current[i]
      const r = (2.5 + (n.linkCount / maxLinks) * 6) * baseScale + hitMargin
      const dx = (n.x ?? 0) - gx
      const dy = (n.y ?? 0) - gy
      if (dx * dx + dy * dy <= r * r) return n
    }
    return null
  }, [graphSettings.display.nodeSize])

  const getGroupColor = useCallback((node: GraphNode): string | null => {
    const groups = graphSettings.groups || []
    for (const g of groups) {
      if (!g.query) continue
      const q = g.query.toLowerCase()
      if (node.label.toLowerCase().includes(q) || node.id.toLowerCase().includes(q) || node.group.toLowerCase().includes(q)) {
        return g.color
      }
    }
    return null
  }, [graphSettings.groups])

  // Center / reset camera
  const resetCamera = useCallback(() => {
    const { width, height } = sizeRef.current
    if (width > 0 && height > 0) {
      transformRef.current = { x: width / 2, y: height / 2, k: 1 }
    }
  }, [])

  const zoomIn = useCallback(() => {
    const { width, height } = sizeRef.current
    const cx = width / 2
    const cy = height / 2
    const t = transformRef.current
    const newK = Math.min(8, t.k * 1.3)
    const ratio = newK / t.k
    transformRef.current = {
      x: cx - (cx - t.x) * ratio,
      y: cy - (cy - t.y) * ratio,
      k: newK
    }
  }, [])

  const zoomOut = useCallback(() => {
    const { width, height } = sizeRef.current
    const cx = width / 2
    const cy = height / 2
    const t = transformRef.current
    const newK = Math.max(0.05, t.k / 1.3)
    const ratio = newK / t.k
    transformRef.current = {
      x: cx - (cx - t.x) * ratio,
      y: cy - (cy - t.y) * ratio,
      k: newK
    }
  }, [])

  useEffect(() => {
    if (onResetCameraRef) {
      onResetCameraRef.current = resetCamera
    }
  }, [onResetCameraRef, resetCamera])

  // ── Lerp utility ──
  const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, t)

  // ── Hex color parsing ──
  const hexToRgb = (hex: string): [number, number, number] => {
    let h = hex.replace('#', '').trim()
    if (h.length === 3) h = h.split('').map(c => c + c).join('')
    const num = parseInt(h, 16)
    if (isNaN(num) || h.length < 6) return [124, 58, 237]
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
  }

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    let width = 0
    let height = 0
    let dpr = Math.min(window.devicePixelRatio || 1, 2)

    // ── Setup simulation preserving positions ──
    const existingMap = new Map(simNodesRef.current.map(n => [n.id, n]))
    const simNodes: GraphNode[] = nodes.map(n => {
      const prev = existingMap.get(n.id)
      return {
        ...n,
        x: prev?.x ?? (Math.random() - 0.5) * 60,
        y: prev?.y ?? (Math.random() - 0.5) * 60,
        vx: prev?.vx ?? 0,
        vy: prev?.vy ?? 0,
      }
    })

    // Prepare edges with string source/target for forceLink
    const simEdges: GraphEdge[] = edges.map(e => ({
      source: typeof e.source === 'object' ? (e.source as GraphNode).id : e.source,
      target: typeof e.target === 'object' ? (e.target as GraphNode).id : e.target,
    }))

    simNodesRef.current = simNodes
    simEdgesRef.current = simEdges

    // Initialize node render states
    const states = new Map<string, NodeRenderState>()
    simNodes.forEach(n => {
      const existing = nodeStatesRef.current.get(n.id)
      states.set(n.id, existing || { alpha: 1, glowIntensity: 0.15, targetAlpha: 1, targetGlow: 0.15 })
    })
    nodeStatesRef.current = states

    const simulation = d3.forceSimulation<GraphNode>(simNodes)
      .velocityDecay(0.4)
      .force(
        'link',
        d3.forceLink<GraphNode, GraphEdge>(simEdges)
          .id(d => d.id)
          .distance(graphSettings.forces.linkDistance)
          .strength(graphSettings.forces.linkForce * 0.35)
      )
      .force(
        'charge',
        d3.forceManyBody()
          .strength(-graphSettings.forces.repelForce * 8)
          .distanceMax(600)
          .theta(0.8)
      )
      .force('center', d3.forceCenter(0, 0).strength(graphSettings.forces.centerForce))
      .force('x', d3.forceX(0).strength(graphSettings.forces.centerForce * 0.3))
      .force('y', d3.forceY(0).strength(graphSettings.forces.centerForce * 0.3))
      .force('collision', d3.forceCollide<GraphNode>().radius(d => {
        const maxLinks = Math.max(1, ...simNodes.map(n => n.linkCount))
        return (2.5 + (d.linkCount / maxLinks) * 6) * graphSettings.display.nodeSize + 3
      }))
      .alphaDecay(0.015)
      .alphaMin(0.001)

    simulationRef.current = simulation

    // ── Initialize particles ──
    const initParticles = () => {
      const particles: Particle[] = []
      if (graphSettings.display.animate && !reducedMotion) {
        simEdges.forEach(edge => {
          const count = Math.max(1, Math.floor(Math.random() * 2) + 1)
          for (let i = 0; i < count; i++) {
            particles.push({
              edge,
              t: Math.random(),
              speed: 0.0008 + Math.random() * 0.002,
              size: 0.8 + Math.random() * 1.2,
              alpha: 0.2 + Math.random() * 0.35
            })
          }
        })
      }
      particlesRef.current = particles
    }
    initParticles()

    // ── Resize ──
    const resize = () => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return

      width = rect.width
      height = rect.height
      sizeRef.current = { width, height }
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`

      if (transformRef.current.x === 0 && transformRef.current.y === 0) {
        transformRef.current = { x: width / 2, y: height / 2, k: 1 }
      }
    }

    const ro = new ResizeObserver(() => resize())
    ro.observe(containerRef.current)
    resize()

    // ── Render loop ──
    let lastTime = performance.now()

    const render = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05)
      lastTime = now
      timeRef.current = now / 1000

      if (width <= 0 || height <= 0) {
        animFrameRef.current = requestAnimationFrame(render)
        return
      }

      const t = transformRef.current
      const hovered = hoveredRef.current
      const connected = connectedRef.current
      const maxLinks = Math.max(1, ...simNodes.map(n => n.linkCount))
      const baseScale = graphSettings.display.nodeSize
      const textFade = graphSettings.display.textFade
      const linkThickness = graphSettings.display.linkThickness
      const showArrows = graphSettings.display.arrows
      const lerpSpeed = 8

      // ── Update node render states (smooth transitions) ──
      simNodes.forEach(n => {
        const state = nodeStatesRef.current.get(n.id)
        if (!state) return

        if (hovered) {
          if (n.id === hovered) {
            state.targetAlpha = 1
            state.targetGlow = 0.75
          } else if (connected.has(n.id)) {
            state.targetAlpha = 0.95
            state.targetGlow = 0.4
          } else {
            state.targetAlpha = 0.08
            state.targetGlow = 0
          }
        } else {
          state.targetAlpha = 1
          state.targetGlow = 0.18
        }

        state.alpha = lerp(state.alpha, state.targetAlpha, lerpSpeed * dt)
        state.glowIntensity = lerp(state.glowIntensity, state.targetGlow, lerpSpeed * dt)
      })

      ctx.save()
      ctx.scale(dpr, dpr)

      // ── Background: dark radial gradient ──
      const bgGrad = ctx.createRadialGradient(
        width / 2, height / 2, 0,
        width / 2, height / 2, Math.max(width, height) * 0.65
      )
      bgGrad.addColorStop(0, OBS.bgCenter)
      bgGrad.addColorStop(1, OBS.bg)
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, width, height)

      // Apply camera transform
      ctx.save()
      ctx.translate(t.x, t.y)
      ctx.scale(t.k, t.k)

      // ── Draw edges (quadratic bezier curves) ──
      simEdges.forEach(edge => {
        const src = edge.source as GraphNode
        const tgt = edge.target as GraphNode
        if (typeof src !== 'object' || typeof tgt !== 'object' || src.x == null || src.y == null || tgt.x == null || tgt.y == null) return

        let edgeAlpha: number
        let widthMult = 1
        if (hovered) {
          const srcId = src.id
          const tgtId = tgt.id
          if (srcId === hovered || tgtId === hovered) {
            edgeAlpha = 0.85
            widthMult = 1.6
          } else {
            edgeAlpha = 0.05
            widthMult = 0.6
          }
        } else {
          edgeAlpha = 0.38
          widthMult = 1.0
        }

        const mx = (src.x + tgt.x) / 2
        const my = (src.y + tgt.y) / 2
        const dx = tgt.x - src.x
        const dy = tgt.y - src.y
        const len = Math.sqrt(dx * dx + dy * dy)
        const curvature = 0.06
        const cpx = mx + (-dy) * curvature
        const cpy = my + (dx) * curvature

        ctx.beginPath()
        ctx.moveTo(src.x, src.y)
        ctx.quadraticCurveTo(cpx, cpy, tgt.x, tgt.y)
        ctx.strokeStyle = `rgba(167, 139, 250, ${edgeAlpha})`
        ctx.lineWidth = Math.max(1.1, linkThickness * 0.85 * widthMult)
        ctx.stroke()

        // Arrow heads
        if (showArrows && len > 0) {
          const r = (2.5 + (tgt.linkCount / maxLinks) * 6) * baseScale
          const ux = dx / len
          const uy = dy / len
          const ax = tgt.x - ux * (r + 3)
          const ay = tgt.y - uy * (r + 3)
          const arrowSize = 3.5 * linkThickness

          ctx.save()
          ctx.translate(ax, ay)
          ctx.rotate(Math.atan2(dy, dx))
          ctx.beginPath()
          ctx.moveTo(0, 0)
          ctx.lineTo(-arrowSize, -arrowSize * 0.45)
          ctx.lineTo(-arrowSize, arrowSize * 0.45)
          ctx.closePath()
          ctx.fillStyle = `rgba(167, 139, 250, ${edgeAlpha * 0.85})`
          ctx.fill()
          ctx.restore()
        }
      })

      // ── Draw edge particles ──
      if (graphSettings.display.animate && !reducedMotion) {
        particlesRef.current.forEach(p => {
          const src = p.edge.source as GraphNode
          const tgt = p.edge.target as GraphNode
          if (typeof src !== 'object' || typeof tgt !== 'object' || src.x == null || src.y == null || tgt.x == null || tgt.y == null) return

          if (hovered) {
            const srcId = src.id
            const tgtId = tgt.id
            if (srcId !== hovered && tgtId !== hovered) return
          }

          p.t += p.speed
          if (p.t > 1) p.t -= 1

          const mx = (src.x + tgt.x) / 2
          const my = (src.y + tgt.y) / 2
          const dx = tgt.x - src.x
          const dy = tgt.y - src.y
          const cpx = mx + (-dy) * 0.06
          const cpy = my + (dx) * 0.06

          const it = p.t
          const oneMinusT = 1 - it
          const px = oneMinusT * oneMinusT * src.x + 2 * oneMinusT * it * cpx + it * it * tgt.x
          const py = oneMinusT * oneMinusT * src.y + 2 * oneMinusT * it * cpy + it * it * tgt.y

          const particleAlpha = hovered ? p.alpha * 1.6 : p.alpha * 0.6

          ctx.beginPath()
          ctx.arc(px, py, p.size * (hovered ? 1.3 : 0.8), 0, Math.PI * 2)
          ctx.fillStyle = `rgba(167, 139, 250, ${particleAlpha})`
          ctx.fill()
        })
      }

      // ── Draw nodes ──
      const time = timeRef.current
      simNodes.forEach(n => {
        if (n.x == null || n.y == null) return

        const r = (2.5 + (n.linkCount / maxLinks) * 6) * baseScale
        const groupColor = getGroupColor(n)
        const state = nodeStatesRef.current.get(n.id)
        if (!state) return

        const baseColor = groupColor || OBS.node
        const isHovered = n.id === hovered
        const nodeColor = isHovered ? (groupColor || OBS.nodeHover) : baseColor

        const breathe = 1 + Math.sin(time * 1.5 + n.linkCount * 0.7) * 0.08

        // Node glow
        if (state.glowIntensity > 0.005) {
          const glowRadius = r * (isHovered ? 5.5 : 3.5) * breathe
          const [gr, gg, gb] = hexToRgb(nodeColor.startsWith('#') ? nodeColor : '#7c3aed')
          const glow = ctx.createRadialGradient(n.x, n.y, r * 0.2, n.x, n.y, glowRadius)
          glow.addColorStop(0, `rgba(${gr}, ${gg}, ${gb}, ${state.glowIntensity * 0.65})`)
          glow.addColorStop(0.4, `rgba(${gr}, ${gg}, ${gb}, ${state.glowIntensity * 0.2})`)
          glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
          ctx.beginPath()
          ctx.arc(n.x, n.y, glowRadius, 0, Math.PI * 2)
          ctx.fillStyle = glow
          ctx.fill()
        }

        // Node circle
        ctx.beginPath()
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
        ctx.globalAlpha = state.alpha
        ctx.fillStyle = nodeColor
        ctx.fill()
        ctx.globalAlpha = 1

        // Hover ring
        if (isHovered) {
          ctx.beginPath()
          ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(167, 139, 250, 0.55)'
          ctx.lineWidth = 1.6
          ctx.stroke()
        }
      })

      // ── Draw labels ──
      const minZoomForLabels = 0.3 + textFade * 0.8
      const labelZoomAlpha = Math.max(0, Math.min(1, (t.k - minZoomForLabels) / 0.35))

      simNodes.forEach(n => {
        if (n.x == null || n.y == null) return

        const r = (2.5 + (n.linkCount / maxLinks) * 6) * baseScale
        const isHovered = n.id === hovered
        const isConnected = connected.has(n.id)
        const state = nodeStatesRef.current.get(n.id)
        if (!state) return

        let shouldShow = false
        let alpha = 0

        if (hovered) {
          if (isHovered) {
            shouldShow = true
            alpha = 1
          } else if (isConnected) {
            shouldShow = true
            alpha = 0.9
          }
        } else if (labelZoomAlpha > 0.05) {
          shouldShow = true
          alpha = labelZoomAlpha * state.alpha
        }

        if (!shouldShow) return

        const fontSize = Math.max(9, Math.min(14, 11 / t.k * (isHovered ? 1.15 : 1)))
        ctx.font = `${isHovered ? '600' : '400'} ${fontSize}px Inter, system-ui, -apple-system, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.globalAlpha = alpha

        if (isHovered) {
          ctx.fillStyle = '#ffffff'
        } else if (isConnected) {
          ctx.fillStyle = OBS.textPrimary
        } else {
          ctx.fillStyle = OBS.textDim
        }

        ctx.save()
        ctx.shadowColor = 'rgba(0, 0, 0, 0.9)'
        ctx.shadowBlur = isHovered ? 6 : 3
        ctx.fillText(n.label, n.x, n.y + r + 5)
        ctx.restore()

        ctx.globalAlpha = 1
      })

      ctx.restore() // pop camera transform

      // Vignette overlay
      const vignette = ctx.createRadialGradient(
        width / 2, height / 2, Math.min(width, height) * 0.25,
        width / 2, height / 2, Math.max(width, height) * 0.72
      )
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
      vignette.addColorStop(0.65, 'rgba(0, 0, 0, 0)')
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.45)')
      ctx.fillStyle = vignette
      ctx.fillRect(0, 0, width, height)

      ctx.restore() // pop dpr scale

      animFrameRef.current = requestAnimationFrame(render)
    }

    animFrameRef.current = requestAnimationFrame(render)

    // ── Mouse interactions ──
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      mouseStartRef.current = { x: mx, y: my }
      didDragRef.current = false

      const g = screenToGraph(mx, my)
      const node = findNode(g.x, g.y)

      if (node) {
        dragNodeRef.current = node
        isDraggingRef.current = true
        node.fx = node.x
        node.fy = node.y
        simulation.alphaTarget(0.3).restart()
        canvas.style.cursor = 'grabbing'
      } else {
        isPanningRef.current = true
        panStartRef.current = { x: mx, y: my }
        panTransformStartRef.current = { x: transformRef.current.x, y: transformRef.current.y }
        canvas.style.cursor = 'grabbing'
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      lastMouseRef.current = { x: mx, y: my }

      if (isDraggingRef.current || isPanningRef.current) {
        const dist = Math.hypot(mx - mouseStartRef.current.x, my - mouseStartRef.current.y)
        if (dist > 5) {
          didDragRef.current = true
        }
      }

      if (isDraggingRef.current && dragNodeRef.current) {
        const g = screenToGraph(mx, my)
        dragNodeRef.current.fx = g.x
        dragNodeRef.current.fy = g.y
        return
      }

      if (isPanningRef.current) {
        const dx = mx - panStartRef.current.x
        const dy = my - panStartRef.current.y
        transformRef.current.x = panTransformStartRef.current.x + dx
        transformRef.current.y = panTransformStartRef.current.y + dy
        return
      }

      // Hover detection
      const g = screenToGraph(mx, my)
      const node = findNode(g.x, g.y)

      if (node) {
        hoveredRef.current = node.id
        const newConnected = new Set<string>([node.id])
        simEdges.forEach(edge => {
          const src = typeof edge.source === 'object' ? (edge.source as GraphNode).id : edge.source
          const tgt = typeof edge.target === 'object' ? (edge.target as GraphNode).id : edge.target
          if (src === node.id) newConnected.add(tgt)
          if (tgt === node.id) newConnected.add(src)
        })
        connectedRef.current = newConnected
        canvas.style.cursor = 'pointer'

        setTooltip({
          x: e.clientX - containerRef.current!.getBoundingClientRect().left,
          y: e.clientY - containerRef.current!.getBoundingClientRect().top,
          node
        })
      } else {
        if (hoveredRef.current) {
          hoveredRef.current = null
          connectedRef.current = new Set()
          setTooltip(null)
        }
        canvas.style.cursor = 'grab'
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      const wasDraggingNode = isDraggingRef.current && dragNodeRef.current
      if (wasDraggingNode) {
        dragNodeRef.current!.fx = null
        dragNodeRef.current!.fy = null
        simulation.alphaTarget(0)
        dragNodeRef.current = null
        isDraggingRef.current = false
      }
      isPanningRef.current = false
      canvas.style.cursor = 'grab'

      // If user released without dragging, open the node
      if (!didDragRef.current) {
        const rect = canvas.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        const g = screenToGraph(mx, my)
        const node = findNode(g.x, g.y)
        if (node) {
          openFileByPath(node.id)
          setActiveView('workspace')
        }
      }
    }

    const handleClick = (e: MouseEvent) => {
      e.preventDefault()
    }

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top

      const t = transformRef.current
      const zoom = e.deltaY < 0 ? 1.09 : 1 / 1.09
      const newK = Math.max(0.05, Math.min(8, t.k * zoom))

      const ratio = newK / t.k
      transformRef.current = {
        x: mx - (mx - t.x) * ratio,
        y: my - (my - t.y) * ratio,
        k: newK
      }
    }

    const handleDblClick = (e: MouseEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const g = screenToGraph(mx, my)
      const node = findNode(g.x, g.y)
      if (node) {
        openFileByPath(node.id)
        setActiveView('workspace')
      }
    }

    const handleMouseLeave = () => {
      hoveredRef.current = null
      connectedRef.current = new Set()
      setTooltip(null)
    }

    canvas.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    canvas.addEventListener('click', handleClick)
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    canvas.addEventListener('dblclick', handleDblClick)
    canvas.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      simulation.stop()
      ro.disconnect()
      canvas.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      canvas.removeEventListener('click', handleClick)
      canvas.removeEventListener('wheel', handleWheel)
      canvas.removeEventListener('dblclick', handleDblClick)
      canvas.removeEventListener('mouseleave', handleMouseLeave)
      setTooltip(null)
    }
  }, [nodes, edges, openFileByPath, setActiveView, graphSettings, screenToGraph, findNode, getGroupColor, reducedMotion])

  return (
    <div ref={containerRef} className="graph-canvas-container obsidian-graph-canvas">
      <canvas role="img" aria-label={`Project graph with ${nodes.length} files and ${edges.length} connections. Use the file list to open a node without dragging.`} ref={canvasRef} className="graph-canvas-el" />

      {/* Navigation controls */}
      <div className="obsidian-graph-nav-controls">
        <button
          className="obsidian-graph-nav-btn"
          onClick={zoomIn}
          title="Zoom in"
          type="button"
        >
          <ZoomIn size={15} />
        </button>
        <button
          className="obsidian-graph-nav-btn"
          onClick={zoomOut}
          title="Zoom out"
          type="button"
        >
          <ZoomOut size={15} />
        </button>
        <button
          className="obsidian-graph-nav-btn"
          onClick={resetCamera}
          title="Center view"
          type="button"
        >
          <Crosshair size={15} />
        </button>
      </div>

      {/* Node count badge */}
      <div className="obsidian-graph-badge">
        <i className="obsidian-graph-live-dot" />
        <span>{nodes.length} note{nodes.length !== 1 ? 's' : ''}</span>
        <span className="obsidian-graph-badge-sep">·</span>
        <span>{edges.length} link{edges.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="obsidian-graph-tooltip"
          style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}
        >
          <p className="obsidian-graph-tooltip-title">{tooltip.node.label}</p>
          <p className="obsidian-graph-tooltip-meta">
            {tooltip.node.linkCount} connection{tooltip.node.linkCount !== 1 ? 's' : ''}
          </p>
          <p className="obsidian-graph-tooltip-path">{tooltip.node.id}</p>
        </div>
      )}
    </div>
  )
}
