import { create } from 'zustand'
import type { ActiveView, AgentState, AppStage, AuthUser, ExecutionLogItem, FileNode, PlanStep, Workspace, WorkspaceGraphEdge, WorkspaceGraphNode } from '../lib/types'
import { activity, fileTree, memories, workspaces } from '../mock/data'
import { buildGraphFromTree, buildWorkspaceFromFileList } from '../lib/workspace'

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
  commandHistory: string[]
  profileOpen: boolean
  projectSwitcherOpen: boolean
  isIndexingWorkspace: boolean
  setStage: (stage: AppStage) => void
  setAuthUser: (user: AuthUser) => void
  signOut: () => void
  setActiveView: (view: ActiveView) => void
  selectWorkspace: (workspace: Workspace) => void
  loadLocalWorkspace: (files: FileList) => Promise<void>
  setCurrentWorkspaceById: (id: string) => void
  setSelectedFile: (file: FileNode | null) => void
  setSelectedActivityId: (id: string | null) => void
  setProfileOpen: (open: boolean) => void
  setProjectSwitcherOpen: (open: boolean) => void
  forgetMemory: (id: string) => void
  editMemory: (id: string, title: string) => void
  submitGoal: (goal: string) => void
  approve: () => void
  reject: () => void
  resetAgent: () => void
}

let timers: number[] = []
const clearTimers = () => { timers.forEach(window.clearTimeout); timers = [] }
const stamp = () => new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' })

const updatePlan = (plan: PlanStep[], activeIndex: number, doneThrough = activeIndex - 1) =>
  plan.map((p, i) => ({ ...p, status: i <= doneThrough ? 'done' as const : i === activeIndex ? 'active' as const : 'pending' as const }))

export const useEdithStore = create<EdithStore>((set, get) => ({
  stage: 'auth', authUser: null, activeView: 'agent', agentState: 'idle', currentWorkspace: null,
  currentGoal: '', currentAction: '', plan: initialPlan, selectedFile: null, selectedActivityId: null,
  files: fileTree, memory: memories, activity, graphNodes: fallbackGraph.nodes, graphEdges: fallbackGraph.edges,
  activeFiles: [], executionLog: [], commandHistory: [], profileOpen: false, projectSwitcherOpen: false, isIndexingWorkspace: false,

  setStage: (stage) => set({ stage }),
  setAuthUser: (authUser) => set({ authUser, stage:'picker' }),
  signOut: () => { clearTimers(); set({ authUser:null, stage:'auth', currentWorkspace:null, activeView:'agent', agentState:'idle', currentGoal:'', currentAction:'', activeFiles:[], executionLog:[] }) },
  setActiveView: (activeView) => set({ activeView, profileOpen: false }),
  selectWorkspace: (currentWorkspace) => set({ currentWorkspace, stage: 'initializing', activeView:'agent' }),
  loadLocalWorkspace: async (fileList) => {
    set({ isIndexingWorkspace: true })
    const built = await buildWorkspaceFromFileList(fileList)
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
    set({
      currentWorkspace,
      files: built.files,
      graphNodes: built.graphNodes,
      graphEdges: built.graphEdges,
      selectedFile: null,
      stage: 'initializing',
      activeView: 'agent',
      isIndexingWorkspace: false,
    })
  },
  setCurrentWorkspaceById: (id) => {
    const workspace = workspaces.find((w) => w.id === id) ?? workspaces[0]
    set({ currentWorkspace: workspace, files:fileTree, graphNodes:fallbackGraph.nodes, graphEdges:fallbackGraph.edges, stage: 'workspace' })
  },
  setSelectedFile: (selectedFile) => set({ selectedFile }),
  setSelectedActivityId: (selectedActivityId) => set({ selectedActivityId }),
  setProfileOpen: (profileOpen) => set({ profileOpen, projectSwitcherOpen: false }),
  setProjectSwitcherOpen: (projectSwitcherOpen) => set({ projectSwitcherOpen, profileOpen: false }),
  forgetMemory: (id) => set((s) => ({ memory: s.memory.filter((m) => m.id !== id) })),
  editMemory: (id, title) => set((s) => ({ memory: s.memory.map((m) => m.id === id ? { ...m, title } : m) })),

  resetAgent: () => {
    clearTimers()
    set({
      agentState: 'idle', currentGoal: '', currentAction: '',
      plan: initialPlan.map((p) => ({...p, status:'pending' as const})),
      activeView: 'agent', activeFiles: [], executionLog: [],
    })
  },

  submitGoal: (goal) => {
    clearTimers()
    const candidates = get().graphNodes.filter((n) => n.kind === 'file').map((n) => n.path || n.id)
    const working = candidates.filter((p) => /main|config|requirement|package|app|route|setting/i.test(p)).slice(0,4)
    const activeFiles = working.length ? working : candidates.slice(0,4)
    const log = (label:string, detail:string, status:ExecutionLogItem['status']='running', file?:string): ExecutionLogItem => ({ id:`log-${Date.now()}-${Math.random()}`, time:stamp(), label, detail, status, file })

    set({
      currentGoal: goal,
      agentState: 'planning',
      activeView: 'agent',
      currentAction: 'Constructing a goal-aware workspace context…',
      plan: updatePlan(initialPlan, 0),
      activeFiles: activeFiles.slice(0,1),
      commandHistory: [goal, ...get().commandHistory.filter((x) => x !== goal)].slice(0,12),
      executionLog: [log('Goal accepted', 'Workspace context connected to the execution session', 'done')],
    })

    const phase = (delay: number, fn: () => void) => timers.push(window.setTimeout(fn, delay))
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

  approve: () => {
    clearTimers()
    const currentFiles = get().activeFiles
    const log = (label:string, detail:string, status:ExecutionLogItem['status']='running', file?:string): ExecutionLogItem => ({ id:`log-${Date.now()}-${Math.random()}`, time:stamp(), label, detail, status, file })
    set((s) => ({
      agentState: 'executing',
      currentAction: 'Applying the approved change in a controlled transaction',
      plan: updatePlan(s.plan, 5, 4),
      executionLog: [...s.executionLog.map((x) => x.status === 'waiting' ? {...x,status:'done' as const}:x), log('Approved change', 'Modification applied to the isolated workspace state', 'running', currentFiles[currentFiles.length-1])],
    }))
    const phase = (delay: number, fn: () => void) => timers.push(window.setTimeout(fn, delay))
    phase(850, () => set((s) => ({
      currentAction: 'Running validation and health checks',
      plan: updatePlan(s.plan, 6, 5),
      executionLog: [...s.executionLog.map((x) => x.status === 'running' ? {...x,status:'done' as const}:x), log('Validation', 'Running startup, API, and test verification', 'running')],
    })))
    phase(1700, () => set((s) => ({
      agentState: 'verifying',
      currentAction: 'Cross-checking the result against the original goal',
      executionLog: [...s.executionLog, log('Verification', 'Comparing observed behavior with expected outcome', 'running')],
    })))
    phase(2750, () => set((s) => ({
      agentState: 'success',
      currentAction: 'Verified: the requested outcome is stable',
      plan: s.plan.map((p) => ({...p, status:'done' as const})),
      executionLog: s.executionLog.map((x) => ({...x, status:x.status === 'running' ? 'done' as const : x.status})).concat(log('Verified success', 'Execution completed and verification passed', 'done')),
    })))
  },

  reject: () => {
    clearTimers()
    set((s) => ({
      agentState: 'failed',
      currentAction: 'Action rejected. No workspace files were modified.',
      executionLog: s.executionLog.map((x) => x.status === 'waiting' ? {...x,status:'error' as const}:x),
    }))
  },
}))
