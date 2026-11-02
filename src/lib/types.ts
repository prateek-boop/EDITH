export type ActiveView = 'agent' | 'workspace' | 'graph' | 'memory' | 'activity'
export type AgentState = 'idle' | 'planning' | 'waiting_approval' | 'executing' | 'verifying' | 'success' | 'failed'
export type AppStage = 'auth' | 'picker' | 'initializing' | 'workspace'

export interface AuthUser {
  name: string
  email: string
  picture?: string
  provider: 'google' | 'demo'
  sessionToken?: string
  sub?: string
  verified?: boolean
}

export interface Workspace {
  id: string
  name: string
  path: string
  progress: number
  tech: string[]
  source?: 'mock' | 'local'
  fileCount?: number
  gitDetected?: boolean
}

export interface FileNode {
  name: string
  type: 'file' | 'folder'
  path: string
  children?: FileNode[]
  language?: string
  content?: string
  size?: number
}

export interface PlanStep {
  id: string
  label: string
  status: 'pending' | 'active' | 'done' | 'failed'
}

export interface MemoryItem {
  id: string
  scope: 'Working' | 'Long-Term' | 'Knowledge'
  title: string
  subtitle: string
  stored: string
}

export interface ActivityItem {
  id: string
  time: string
  title: string
  status: 'Verified' | 'Completed' | 'Approved' | 'Failed'
  detail: string
  tool: string
  verification: 'PASSED' | 'FAILED' | 'N/A'
  started: string
  finished: string
}

export type GraphNodeKind = 'file' | 'folder' | 'goal' | 'task' | 'memory'
export type GraphRelation = 'contains' | 'imports' | 'references' | 'depends_on' | 'related_to' | 'used_by'

export interface WorkspaceGraphNode {
  id: string
  label: string
  path?: string
  kind: GraphNodeKind
  language?: string
  cluster: string
  weight?: number
}

export interface WorkspaceGraphEdge {
  id: string
  source: string
  target: string
  relation: GraphRelation
}

export interface ExecutionLogItem {
  id: string
  time: string
  label: string
  detail: string
  status: 'running' | 'done' | 'waiting' | 'error'
  file?: string
}

export interface ProposalItem {
  id: string
  title: string
  path: string
  targetFile?: string
  action?: 'modify_file' | 'create_file' | 'vault_note' | 'report' | string
  summary?: string
  explanation?: string
  content: string
  finalContent?: string
  expectedSha256?: string
  sha256: string
  expiresAt?: number
  status: 'pending' | 'written'
  role?: string
}

export interface BackendStatus {
  connected: boolean
  engine: string
  vaultName: string
  noteCount: number
  role: string
  canWrite: boolean
  mode: 'local-llm' | 'embedded-sovereign' | 'antigravity'
  agyAvailable?: boolean
  agyVersion?: string
  agyModel?: string
  models: Array<{
    role: string
    endpoint: string
    model: string
    connected: boolean
    provider?: string
    version?: string
    availableModels?: string[]
    modelDetails?: Array<{ id: string; name: string; role: string; default?: boolean }>
    error?: string | null
  }>
}

