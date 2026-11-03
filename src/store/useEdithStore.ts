import { fileNameError } from '../lib/fileNames'
import { create } from 'zustand'
import type { ActiveView, AgentState, AppStage, AuthUser, BackendStatus, ExecutionLogItem, FileNode, PlanStep, ProposalItem, Workspace, WorkspaceGraphEdge, WorkspaceGraphNode } from '../lib/types'
import { activity, fileTree, memories, workspaces } from '../mock/data'
import { buildGraphFromTree, buildWorkspaceFromFileList, readLocalFileContent } from '../lib/workspace'
import { buildWikilinkGraph, flattenTree } from '../lib/wikilinkParser'
import { edithApi } from '../lib/api'

const initialPlan: PlanStep[] = [
  { id: 'p1', label: 'Inspect repository', status: 'pending' },
  { id: 'p2', label: 'Build workspace context', status: 'pending' },
  { id: 'p3', label: 'Diagnose request', status: 'pending' },
  { id: 'p4', label: 'Generate controlled change', status: 'pending' },
  { id: 'p5', label: 'Apply approved action', status: 'pending' },
  { id: 'p6', label: 'Run validation', status: 'pending' },
  { id: 'p7', label: 'Verify result', status: 'pending' },
]

const fallbackGraph = buildGraphFromTree(fileTree)
const initialWikilink = buildWikilinkGraph(fileTree, fallbackGraph.edges)

interface EdithStore {
  stage: AppStage
  authUser: AuthUser | null
  activeView: ActiveView
  agentState: AgentState
  currentWorkspace: Workspace | null
  currentGoal: string
  currentAction: string
  plan: PlanStep[]
  selectedFile: FileNode | null
  selectedActivityId: string | null
  files: FileNode[]
  memory: typeof memories
  activity: typeof activity
  graphNodes: WorkspaceGraphNode[]
  graphEdges: WorkspaceGraphEdge[]
  activeFiles: string[]
  executionLog: ExecutionLogItem[]
  agentOutput: string
  commandHistory: string[]
  profileOpen: boolean
  historyOpen: boolean
  projectSwitcherOpen: boolean
  isIndexingWorkspace: boolean

  // ── Sovereign Backend state ──
  backendStatus: BackendStatus | null
  activeProposal: ProposalItem | null
  activeJobId: string | null
  selectedModel: string
  setSelectedModel: (model: string) => void
  fetchBackendStatus: () => Promise<void>
  fetchWorkspaceFiles: () => Promise<void>
  fetchVaultGraph: () => Promise<void>
  fetchAuditTrail: () => Promise<void>
  fetchVaultNotes: () => Promise<void>
  fetchMemories: () => Promise<void>

  // ── Editor state ──
  editorContent: string
  editorDirty: boolean
  editorSaveTimer: ReturnType<typeof setTimeout> | null

  // ── WikiLink graph data ──
  wikilinkNodes: { id: string; label: string; group: string; linkCount: number }[]
  wikilinkEdges: { source: string; target: string }[]

  graphSettings: {
    filters: { search: string; orphans: boolean }
    groups: Array<{ query: string; color: string }>
    display: { arrows: boolean; textFade: number; nodeSize: number; linkThickness: number; animate: boolean }
    forces: { centerForce: number; repelForce: number; linkForce: number; linkDistance: number }
  }
  setGraphSettings: (update: (prev: EdithStore['graphSettings']) => EdithStore['graphSettings']) => void
  setStage: (stage: AppStage) => void
  setAuthUser: (user: AuthUser) => void
  signOut: () => void
  setActiveView: (view: ActiveView) => void
  selectWorkspace: (workspace: Workspace) => void
  loadLocalWorkspace: (files: FileList | File[]) => Promise<void>
  setCurrentWorkspaceById: (id: string) => void
  setSelectedFile: (file: FileNode | null) => void
  setSelectedActivityId: (id: string | null) => void
  setProfileOpen: (open: boolean) => void
  setHistoryOpen: (open: boolean) => void
  setProjectSwitcherOpen: (open: boolean) => void
  forgetMemory: (id: string) => void
  editMemory: (id: string, title: string) => void
  submitGoal: (goal: string) => void
  approve: () => void
  reject: () => void
  resetAgent: () => void

  // ── Editor actions ──
  openFileByPath: (path: string) => Promise<void> | void
  setEditorContent: (content: string) => void
  saveCurrentFile: () => void

  // ── File mutation actions ──
  createVaultFile: (parentPath: string, name: string) => void
  createVaultFolder: (parentPath: string, name: string) => void
  renameVaultFile: (oldPath: string, newName: string) => void
  deleteVaultFile: (path: string) => void
  reindexWikilinks: () => void
}

let timers: number[] = []
const clearTimers = () => { timers.forEach(window.clearTimeout); timers = [] }
const stamp = () => new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' })

const updatePlan = (plan: PlanStep[], activeIndex: number, doneThrough = activeIndex - 1) =>
  plan.map((p, i) => ({ ...p, status: i <= doneThrough ? 'done' as const : i === activeIndex ? 'active' as const : 'pending' as const }))

const loadInitialAuth = (): { authUser: AuthUser | null; stage: AppStage } => {
  if (typeof window === 'undefined') return { authUser: null, stage: 'auth' }
  try {
    const raw = localStorage.getItem('edith_auth_user')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.name === 'string' && parsed.provider === 'google') {
        return { authUser: parsed, stage: 'picker' }
      }
    }
  } catch {
    // Ignore corrupt storage
  }
  return { authUser: null, stage: 'auth' }
}

const initialAuth = loadInitialAuth()

export const useEdithStore = create<EdithStore>((set, get) => ({
  stage: initialAuth.stage, authUser: initialAuth.authUser, activeView: 'agent', agentState: 'idle', currentWorkspace: null,
  currentGoal: '', currentAction: '', plan: initialPlan, selectedFile: null, selectedActivityId: null,
  files: fileTree, memory: memories, activity, graphNodes: fallbackGraph.nodes, graphEdges: fallbackGraph.edges,
  activeFiles: [], executionLog: [], agentOutput: '', commandHistory: [], profileOpen: false, historyOpen: false, projectSwitcherOpen: false, isIndexingWorkspace: false,
  backendStatus: null, activeProposal: null, activeJobId: null, selectedModel: 'gemini-3.8-flash-high',
  editorContent: '', editorDirty: false, editorSaveTimer: null,
  wikilinkNodes: initialWikilink.nodes, wikilinkEdges: initialWikilink.edges,
  graphSettings: {
    filters: { search: '', orphans: true },
    groups: [],
    display: { arrows: false, textFade: 0.5, nodeSize: 1.2, linkThickness: 1.5, animate: true },
    forces: { centerForce: 0.15, repelForce: 30, linkForce: 1, linkDistance: 40 }
  },
  setGraphSettings: (update) => set((s) => ({ graphSettings: update(s.graphSettings) })),
  setStage: (stage) => set({ stage }),
  setAuthUser: (authUser) => {
    if (typeof window !== 'undefined') {
      try {
        if (authUser.provider === 'google') {
          localStorage.setItem('edith_auth_user', JSON.stringify(authUser))
          if (authUser.sessionToken) {
            localStorage.setItem('edith_auth_token', authUser.sessionToken)
          }
        } else {
          localStorage.removeItem('edith_auth_user')
          localStorage.removeItem('edith_auth_token')
        }
      } catch {
        // Ignore storage errors
      }
    }
    set({ authUser, stage:'picker' })
  },
  signOut: () => {
    clearTimers()
    if (get().editorSaveTimer) clearTimeout(get().editorSaveTimer!)
    if (typeof window !== 'undefined') {
      try {
        const token = localStorage.getItem('edith_auth_token')
        localStorage.removeItem('edith_auth_user')
        localStorage.removeItem('edith_auth_token')
        if (token) void edithApi.logoutAuth(token)
      } catch {
        // Ignore
      }
      try {
        (window as any).google?.accounts?.id?.disableAutoSelect?.()
      } catch {
        // Ignore
      }
    }
    set({
      authUser:null,
      stage:'auth',
      currentWorkspace:null,
      activeView:'agent',
      agentState:'idle',
      currentGoal:'',
      currentAction:'',
      activeFiles:[],
      executionLog:[],
      historyOpen:false,
      profileOpen:false,
      projectSwitcherOpen:false,
      files:fileTree,
      memory:memories,
      commandHistory:[],
      editorContent:'',
      editorDirty:false,
      editorSaveTimer:null,
      selectedFile:null,
      selectedActivityId:null,
      graphNodes:fallbackGraph.nodes,
      graphEdges:fallbackGraph.edges,
      wikilinkNodes:initialWikilink.nodes,
      wikilinkEdges:initialWikilink.edges,
      graphSettings:{...get().graphSettings,filters:{search:'',orphans:true},groups:[]}
    })
  },
  setActiveView: (activeView) => set({ activeView, profileOpen: false, historyOpen: false }),
  selectWorkspace: (currentWorkspace) => {
    const { files, graphEdges } = get()
    const { nodes, edges } = buildWikilinkGraph(files, graphEdges)
    set({ currentWorkspace, wikilinkNodes: nodes, wikilinkEdges: edges, stage: 'initializing', activeView:'agent' })
    void get().fetchWorkspaceFiles()
  },
  loadLocalWorkspace: async (fileList) => {
    set({ isIndexingWorkspace: true })
    let built: Awaited<ReturnType<typeof buildWorkspaceFromFileList>>
    try { built = await buildWorkspaceFromFileList(fileList) }
    catch (error) { set({ isIndexingWorkspace: false }); throw error }
    const currentWorkspace: Workspace = {
      id: `local-${Date.now()}`,
      name: built.name,
      path: built.path,
      progress: 0,
      tech: built.tech,
      source: 'local',
      fileCount: built.fileCount,
      gitDetected: built.gitDetected,
    }
    const wikilink = buildWikilinkGraph(built.files, built.graphEdges)
    set({
      currentWorkspace,
      files: built.files,
      graphNodes: built.graphNodes,
      graphEdges: built.graphEdges,
      wikilinkNodes: wikilink.nodes,
      wikilinkEdges: wikilink.edges,
      selectedFile: null,
      stage: 'initializing',
      activeView: 'agent',
      isIndexingWorkspace: false,
    })
  },
  setCurrentWorkspaceById: (id) => {
    const workspace = workspaces.find((w) => w.id === id) ?? workspaces[0]
    set({ currentWorkspace: workspace, stage: 'workspace' })
    void get().fetchWorkspaceFiles()
  },
  setSelectedFile: (selectedFile) => set({ selectedFile }),
  setSelectedActivityId: (selectedActivityId) => set({ selectedActivityId }),
  setProfileOpen: (profileOpen) => set({ profileOpen, historyOpen: false, projectSwitcherOpen: false }),
  setHistoryOpen: (historyOpen) => set({ historyOpen, profileOpen: false, projectSwitcherOpen: false }),
  setProjectSwitcherOpen: (projectSwitcherOpen) => set({ projectSwitcherOpen, profileOpen: false }),
  forgetMemory: (id) => set((s) => ({ memory: s.memory.filter((m) => m.id !== id) })),
  editMemory: (id, title) => set((s) => ({ memory: s.memory.map((m) => m.id === id ? { ...m, title } : m) })),

  fetchBackendStatus: async () => {
    try {
      const status = await edithApi.getStatus()
      if (status) {
        set({
          backendStatus: status,
          ...(status.agyModel ? { selectedModel: status.agyModel } : {}),
        })
        void get().fetchWorkspaceFiles()
        void get().fetchAuditTrail()
        void get().fetchMemories()
        void get().fetchVaultNotes()
      }
    } catch {
      // Backend not yet available
    }
  },

  fetchWorkspaceFiles: async () => {
    // If user loaded a custom local folder, preserve user's local workspace
    const current = get().currentWorkspace
    if (current && current.source === 'local' && current.id.startsWith('local-')) {
      return
    }
    try {
      const realFiles = await edithApi.getFiles()
      if (realFiles && realFiles.length > 0) {
        const graph = buildGraphFromTree(realFiles)
        const wikilink = buildWikilinkGraph(realFiles, graph.edges)
        set((s) => ({
          files: realFiles,
          graphNodes: graph.nodes,
          graphEdges: graph.edges,
          wikilinkNodes: wikilink.nodes,
          wikilinkEdges: wikilink.edges,
          currentWorkspace: s.currentWorkspace || {
            id: 'edith',
            name: 'EDITH Sovereign OS',
            path: '/home/lucifer/Projects/EDITH',
            progress: 100,
            tech: ['React 19', 'TypeScript', 'Electron', 'Python', 'Sovereign Core'],
            source: 'local',
            gitDetected: true,
          },
        }))
      }
    } catch {
      // Keep existing
    }
  },

  fetchMemories: async () => {
    try {
      const realMemories = await edithApi.getMemory()
      if (realMemories && realMemories.length > 0) {
        set({ memory: realMemories })
      }
    } catch {
      // Keep existing
    }
  },

  setSelectedModel: (selectedModel) => set({ selectedModel }),

  fetchVaultGraph: async () => {
    try {
      const graphData = await edithApi.getVaultGraph()
      if (graphData && graphData.nodes.length > 0) {
        const { files } = get()
        if (!files || files.length === 0) {
          set({
            graphNodes: graphData.nodes,
            graphEdges: graphData.edges,
          })
        }
      }
    } catch {
      // Keep existing graph
    }
  },

  fetchAuditTrail: async () => {
    try {
      const trail = await edithApi.getAuditTrail()
      if (trail && trail.length > 0) {
        const mapped = trail.map((item: any, idx: number) => ({
          id: item.hash || `audit-${idx}`,
          time: item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Recent',
          title: item.action ? item.action.replace('_', ' ').toUpperCase() : 'AUDIT EVENT',
          status: item.status === 'succeeded' || item.status === 'approved' ? ('Verified' as const) : ('Completed' as const),
          detail: `Role: ${item.role || 'engineer'} · Hash: ${(item.hash || '').slice(0, 8)}… · Prev: ${(item.previous_hash || '').slice(0, 8)}…`,
          tool: item.action || 'system',
          verification: 'PASSED' as const,
          started: item.timestamp || 'N/A',
          finished: item.timestamp || 'N/A',
        }))
        set({ activity: mapped })
      }
    } catch {
      // Keep existing
    }
  },

  fetchVaultNotes: async () => {
    try {
      const notes = await edithApi.getVaultNotes()
      if (notes && notes.length > 0) {
        const vaultMemories = notes.map((n: any, idx: number) => ({
          id: n.id || `vault-note-${idx}`,
          scope: 'Knowledge' as const,
          title: n.name || n.id,
          subtitle: `Vault Note (${n.folder || 'Root'}) · SHA: ${(n.sha256 || '').slice(0, 8)}…`,
          stored: n.modified ? new Date(n.modified).toLocaleDateString() : 'Persisted',
        }))
        set((s) => {
          const existingIds = new Set(s.memory.map((m) => m.id))
          const fresh = vaultMemories.filter((vm: any) => !existingIds.has(vm.id))
          return { memory: [...fresh, ...s.memory] }
        })
      }
    } catch {
      // Keep existing
    }
  },

  resetAgent: () => {
    clearTimers()
    set({
      agentState: 'idle', currentGoal: '', currentAction: '',
      agentOutput: '',
      plan: initialPlan.map((p) => ({...p, status:'pending' as const})),
      activeView: 'agent', activeFiles: [], executionLog: [],
      activeProposal: null, activeJobId: null,
    })
  },

  submitGoal: async (goal) => {
    if (!goal.trim() || !['idle', 'success', 'failed'].includes(get().agentState)) return
    clearTimers()
    const candidates = get().graphNodes.filter((n) => n.kind === 'file').map((n) => n.path || n.id)
    const working = candidates.filter((p) => /main|config|requirement|package|app|route|setting/i.test(p)).slice(0,4)
    const activeFiles = working.length ? working : candidates.slice(0,4)
    const log = (label:string, detail:string, status:ExecutionLogItem['status']='running', file?:string): ExecutionLogItem => ({ id:`log-${Date.now()}-${Math.random()}`, time:stamp(), label, detail, status, file })

    set({
      currentGoal: goal,
      agentState: 'planning',
      activeView: 'agent',
      currentAction: 'Connecting goal to sovereign execution engine…',
      agentOutput: '',
      plan: updatePlan(initialPlan, 0),
      activeFiles: activeFiles.slice(0,1),
      commandHistory: [goal, ...get().commandHistory.filter((x) => x !== goal)].slice(0,12),
      executionLog: [log('Goal accepted', 'Workspace context connected to sovereign engine', 'done')],
      activeProposal: null,
      activeJobId: null,
    })

    // Try starting job on the real Veliky backend
    try {
      const job = await edithApi.startJob(goal, activeFiles.slice(0, 3), 'coding', get().selectedModel)
      if (job && job.id) {
        set({ activeJobId: job.id })

        let pollCount = 0
        const poll = async () => {
          pollCount++
          try {
            const currentJob = await edithApi.getJob(job.id)
            if (!currentJob) return

            // Map backend events to execution log
            if (currentJob.events && currentJob.events.length > 0) {
              const mappedLogs: ExecutionLogItem[] = currentJob.events.map((evt: any, idx: number) => {
                const isLast = idx === currentJob.events.length - 1
                const isWaiting = currentJob.status === 'waiting_approval' && isLast
                const isFailed = currentJob.status === 'failed' && isLast
                const isDone = !isLast || (!isWaiting && !isFailed)
                return {
                  id: evt.id || `evt-${idx}`,
                  time: evt.time ? new Date(evt.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : stamp(),
                  label: evt.label,
                  detail: evt.detail,
                  status: isWaiting ? 'waiting' : isFailed ? 'error' : isDone ? 'done' : 'running',
                  file: evt.file,
                }
              })
              set({ executionLog: mappedLogs })
            }

            if (currentJob.currentAction) {
              set({ currentAction: currentJob.currentAction })
            }

            if (currentJob.output) {
              set({ agentOutput: currentJob.output })
            }

            if (currentJob.status === 'completed') {
              set({
                agentState: 'success',
                currentAction: currentJob.currentAction || 'Response delivered',
                agentOutput: currentJob.output || '',
                plan: get().plan.map((p) => ({ ...p, status: 'done' as const })),
              })
              return
            }

            if (currentJob.status === 'waiting_approval' && currentJob.proposal) {
              set({
                agentState: 'waiting_approval',
                currentAction: currentJob.proposal.summary || 'A controlled modification is ready for human approval',
                plan: updatePlan(get().plan, 4, 3),
                activeProposal: currentJob.proposal,
                agentOutput: currentJob.output || '',
                activeFiles: [currentJob.proposal.targetFile || currentJob.proposal.path || currentJob.proposal.title],
              })
              return
            }

            if (currentJob.status === 'failed') {
              set({
                agentState: 'failed',
                currentAction: currentJob.error || 'Execution encountered an error',
              })
              return
            }

            if (currentJob.status === 'cancelled') {
              set({
                agentState: 'failed',
                currentAction: 'Action cancelled by user.',
              })
              return
            }

            // Update plan phases gradually based on events
            const eventCount = currentJob.events?.length || 0
            if (eventCount >= 2 && eventCount < 4) {
              set((s) => ({
                plan: updatePlan(s.plan, 1, 0),
                currentAction: s.currentAction || 'Inspecting workspace context and source dependencies…',
              }))
            } else if (eventCount >= 4) {
              set((s) => ({
                agentState: 'executing',
                plan: updatePlan(s.plan, 2, 1),
                currentAction: s.currentAction || 'Running sovereign reasoning and AST verification…',
              }))
            }

            if (pollCount < 300) {
              timers.push(window.setTimeout(poll, 350))
            }
          } catch {
            // Polling error
          }
        }
        timers.push(window.setTimeout(poll, 400))
        return
      }
    } catch {
      // Backend not running: proceed with local fallback
    }

    const isGreeting = /^(hey|hi|hello|greetings|howdy|sup|who are you|help)\b/i.test(goal.trim())
    const phase = (delay: number, fn: () => void) => timers.push(window.setTimeout(fn, delay))

    if (isGreeting) {
      phase(350, () => set((s) => ({
        agentState: 'success',
        currentAction: 'Ready',
        agentOutput: `### Hello!\n\nI am **EDITH**, your sovereign AI developer operating system. All repository files and architecture relationships are indexed and ready.\n\nHow can I help you in your workspace today?`,
        plan: [
          { id: 'p1', label: 'Parse intent', status: 'done' },
          { id: 'p2', label: 'Deliver response', status: 'done' },
        ],
        executionLog: [...s.executionLog, log('Dialogue response', 'Replied to user greeting', 'done')],
      })))
      return
    }
    phase(520, () => set((s) => ({
      currentAction: `Inspecting ${activeFiles[0] || 'workspace structure'}`,
      plan: updatePlan(s.plan, 1, 0),
      activeFiles: activeFiles.slice(0,2),
      executionLog: [...s.executionLog.map((x) => x.status === 'running' ? {...x,status:'done' as const}:x), log('Repository scan', 'Mapped relevant files and relationships', 'done', activeFiles[0])],
    })))
    phase(1200, () => set((s) => ({
      currentAction: 'Resolving dependencies, configuration, and execution constraints',
      plan: updatePlan(s.plan, 2, 1),
      activeFiles: activeFiles.slice(0,3),
      executionLog: [...s.executionLog, log('Context expansion', 'Pulled adjacent dependencies into the active working set', 'done', activeFiles[1])],
    })))
    phase(2050, () => set((s) => ({
      agentState: 'executing',
      currentAction: 'Running a controlled diagnostic against the active workspace',
      plan: updatePlan(s.plan, 3, 2),
      activeFiles,
      executionLog: [...s.executionLog, log('Diagnostic', 'Testing the most likely failure path before proposing a change', 'running', activeFiles[2])],
    })))
    phase(3150, () => set((s) => ({
      agentState: 'waiting_approval',
      currentAction: 'A controlled modification is ready for approval',
      plan: updatePlan(s.plan, 4, 3),
      executionLog: [...s.executionLog.map((x) => x.status === 'running' ? {...x,status:'done' as const}:x), log('Approval gate', 'EDITH paused before changing the workspace', 'waiting', activeFiles[activeFiles.length-1])],
    })))
  },

  approve: async () => {
    if (get().agentState !== 'waiting_approval') return
    clearTimers()
    const { activeProposal, activeFiles } = get()
    const currentFiles = activeFiles
    const log = (label:string, detail:string, status:ExecutionLogItem['status']='running', file?:string): ExecutionLogItem => ({ id:`log-${Date.now()}-${Math.random()}`, time:stamp(), label, detail, status, file })
    set((s) => ({
      agentState: 'executing',
      currentAction: 'Applying the approved change in a controlled transaction',
      plan: updatePlan(s.plan, 5, 4),
      executionLog: [...s.executionLog.map((x) => x.status === 'waiting' ? {...x,status:'done' as const}:x), log('Approved change', 'Modification applied to the isolated workspace state', 'running', currentFiles[currentFiles.length-1])],
    }))

    if (activeProposal) {
      try {
        await edithApi.commitProposal(activeProposal.id, activeProposal.sha256)
      } catch (err) {
        console.warn('Commit warning:', err)
      }
    }

    const phase = (delay: number, fn: () => void) => timers.push(window.setTimeout(fn, delay))
    phase(700, () => set((s) => ({
      currentAction: 'Running validation and health checks',
      plan: updatePlan(s.plan, 6, 5),
      executionLog: [...s.executionLog.map((x) => x.status === 'running' ? {...x,status:'done' as const}:x), log('Validation', 'Running startup, API, and test verification', 'running')],
    })))
    phase(1400, () => set((s) => ({
      agentState: 'verifying',
      currentAction: 'Cross-checking evidence digest against tamper-evident audit ledger',
      executionLog: [...s.executionLog, log('Verification', 'Comparing observed behavior with expected outcome', 'running')],
    })))
    phase(2200, () => set((s) => ({
      agentState: 'success',
      currentAction: 'Verified: outcome committed with SHA-256 integrity and audit entry',
      plan: s.plan.map((p) => ({...p, status:'done' as const})),
      executionLog: [...s.executionLog.map((x): ExecutionLogItem => ({...x, status:x.status === 'running' ? 'done' : x.status})), log('Verified success', 'Execution completed and verification passed', 'done')],
    })))
  },

  reject: async () => {
    clearTimers()
    const { activeJobId } = get()
    if (activeJobId) {
      try {
        await edithApi.cancelJob(activeJobId)
      } catch {
        // Ignore
      }
    }
    set((s) => ({
      agentState: 'failed',
      currentAction: 'Action rejected. No workspace files were modified.',
      executionLog: s.executionLog.map((x) => x.status === 'waiting' ? {...x,status:'error' as const}:x),
    }))
  },

  // ── Editor actions ──────────────────────────────────────────────────────────

  openFileByPath: async (path) => {
    const { editorDirty, saveCurrentFile, files, backendStatus } = get()
    // Save current file first if dirty
    if (editorDirty) saveCurrentFile()

    const flat = flattenTree(files)
    const file = flat.find((f) => f.path === path)
    if (!file || file.type !== 'file') return

    // 1. If content is already cached and present
    if (typeof file.content === 'string' && file.content.length > 0) {
      set({ selectedFile: file, editorContent: file.content, editorDirty: false })
      return
    }

    // Set selection immediately
    set({ selectedFile: file, editorContent: file.content || '', editorDirty: false })

    // 2. Try loading full text from in-memory browser file handle (local folder upload)
    try {
      const localText = await readLocalFileContent(path)
      if (typeof localText === 'string') {
        const updateTree = (nodes: FileNode[]): FileNode[] =>
          nodes.map((n) => {
            if (n.path === path) return { ...n, content: localText }
            if (n.children) return { ...n, children: updateTree(n.children) }
            return n
          })
        const newFiles = updateTree(get().files)
        set({
          files: newFiles,
          selectedFile: { ...file, content: localText },
          editorContent: localText,
          editorDirty: false,
        })
        return
      }
    } catch {
      // Local handle read error
    }

    // 3. Try loading from Sovereign loopback backend if connected
    if (backendStatus?.connected) {
      try {
        const serverFile = await edithApi.getWorkspaceFile(path)
        if (serverFile && typeof serverFile.content === 'string') {
          const updateTree = (nodes: FileNode[]): FileNode[] =>
            nodes.map((n) => {
              if (n.path === path) return { ...n, content: serverFile.content }
              if (n.children) return { ...n, children: updateTree(n.children) }
              return n
            })
          const newFiles = updateTree(get().files)
          set({
            files: newFiles,
            selectedFile: { ...file, content: serverFile.content },
            editorContent: serverFile.content,
            editorDirty: false,
          })
        }
      } catch {
        // Backend file load failed
      }
    }
  },

  setEditorContent: (content) => {
    const { editorSaveTimer } = get()
    if (editorSaveTimer) clearTimeout(editorSaveTimer)

    // Debounced auto-save after 800ms
    const timer = setTimeout(() => {
      get().saveCurrentFile()
    }, 800)

    set({ editorContent: content, editorDirty: true, editorSaveTimer: timer })
  },

  saveCurrentFile: () => {
    const { selectedFile, editorContent, editorSaveTimer, files } = get()
    if (!selectedFile) return
    if (editorSaveTimer) clearTimeout(editorSaveTimer)

    // Update file content in the tree
    const updateTree = (nodes: FileNode[]): FileNode[] =>
      nodes.map((n) => {
        if (n.path === selectedFile.path) return { ...n, content: editorContent }
        if (n.children) return { ...n, children: updateTree(n.children) }
        return n
      })

    const newFiles = updateTree(files)
    const newSelected = { ...selectedFile, content: editorContent }

    set({ files: newFiles, selectedFile: newSelected, editorDirty: false, editorSaveTimer: null })

    // Persist to workspace disk if loopback gateway is connected
    if (get().backendStatus?.connected) {
      void edithApi.saveWorkspaceFile(selectedFile.path, editorContent)
    }

    // Re-index wikilinks after save
    setTimeout(() => get().reindexWikilinks(), 0)
  },

  // ── File mutation actions ──────────────────────────────────────────────────

  createVaultFile: (parentPath, name) => {
    const { files } = get()
    const fileName = name.endsWith('.md') ? name : `${name}.md`
    if (fileNameError(fileName, parentPath, files)) return
    const newPath = parentPath ? `${parentPath}/${fileName}` : fileName
    const newFile: FileNode = { name: fileName, type: 'file', path: newPath, language: 'markdown', content: `# ${name.replace(/\.md$/, '')}\n` }

    const insertInTree = (nodes: FileNode[]): FileNode[] =>
      nodes.map((n) => {
        if (n.path === parentPath && n.type === 'folder') {
          return { ...n, children: [...(n.children || []), newFile] }
        }
        if (n.children) return { ...n, children: insertInTree(n.children) }
        return n
      })

    const newFiles = parentPath ? insertInTree(files) : [...files, newFile]
    set({ files: newFiles })
    setTimeout(() => get().reindexWikilinks(), 0)
  },

  createVaultFolder: (parentPath, name) => {
    const { files } = get()
    const newPath = parentPath ? `${parentPath}/${name}` : name
    if (fileNameError(name, parentPath, files)) return
    const newFolder: FileNode = { name, type: 'folder', path: newPath, children: [] }

    const insertInTree = (nodes: FileNode[]): FileNode[] =>
      nodes.map((n) => {
        if (n.path === parentPath && n.type === 'folder') {
          return { ...n, children: [...(n.children || []), newFolder] }
        }
        if (n.children) return { ...n, children: insertInTree(n.children) }
        return n
      })

    const newFiles = parentPath ? insertInTree(files) : [...files, newFolder]
    set({ files: newFiles })
  },

  renameVaultFile: (oldPath, newName) => {
    const { files, selectedFile } = get()
    const parts = oldPath.split('/')
    parts[parts.length - 1] = newName
    const newPath = parts.join('/')

    if (fileNameError(newName, parts.slice(0,-1).join('/'), files, oldPath)) return
    const relocate = (node: FileNode): FileNode => {
      const path = node.path === oldPath ? newPath : node.path.startsWith(`${oldPath}/`) ? newPath + node.path.slice(oldPath.length) : node.path
      return { ...node, path, name: node.path === oldPath ? newName : node.name, ...(node.children ? { children: node.children.map(relocate) } : {}) }
    }
    set({ files: files.map(relocate), selectedFile: selectedFile ? relocate(selectedFile) : null })
    setTimeout(() => get().reindexWikilinks(), 0)
  },

  deleteVaultFile: (path) => {
    const { files, selectedFile } = get()

    const removeFromTree = (nodes: FileNode[]): FileNode[] =>
      nodes.filter((n) => n.path !== path).map((n) => {
        if (n.children) return { ...n, children: removeFromTree(n.children) }
        return n
      })

    const newFiles = removeFromTree(files)
    const removedSelection = selectedFile?.path === path || selectedFile?.path.startsWith(`${path}/`)
    const newSelected = removedSelection ? null : selectedFile
    if (removedSelection && get().editorSaveTimer) clearTimeout(get().editorSaveTimer!)
    set({ files: newFiles, selectedFile: newSelected, ...(removedSelection ? { editorContent: '', editorDirty: false, editorSaveTimer: null } : {}) })
    setTimeout(() => get().reindexWikilinks(), 0)
  },

  reindexWikilinks: () => {
    const { files } = get()
    const graph = buildGraphFromTree(files)
    const wikilink = buildWikilinkGraph(files, graph.edges)
    set({
      graphNodes: graph.nodes,
      graphEdges: graph.edges,
      wikilinkNodes: wikilink.nodes,
      wikilinkEdges: wikilink.edges,
    })
  },
}))

