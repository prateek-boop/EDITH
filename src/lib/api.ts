import { activity, fileTree, memories, workspaces } from '../mock/data'
import type { ActivityItem, AuthUser, BackendStatus, FileNode, MemoryItem, ProposalItem, Workspace, WorkspaceGraphEdge, WorkspaceGraphNode } from './types'

const GATEWAY_BASE = 'http://127.0.0.1:8766/api'

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${GATEWAY_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Veliky-Request': 'workbench',
      ...(options.headers || {}),
    },
  })
  if (!res.ok) {
    const errorText = await res.text()
    try {
      const parsed = JSON.parse(errorText)
      throw new Error(parsed.error || `HTTP ${res.status}`)
    } catch {
      throw new Error(errorText || `HTTP ${res.status}`)
    }
  }
  return res.json() as Promise<T>
}

export const edithApi = {
  async getStatus(): Promise<BackendStatus | null> {
    try {
      return await request<BackendStatus>('/health')
    } catch {
      return null
    }
  },

  async getWorkspace(): Promise<Workspace | null> {
    try {
      return await request<Workspace>('/workspace')
    } catch {
      return workspaces[0] || null
    }
  },

  async getWorkspaces(): Promise<Workspace[]> {
    try {
      const current = await this.getWorkspace()
      return current ? [current] : workspaces
    } catch {
      return workspaces
    }
  },

  async getFiles(): Promise<FileNode[]> {
    try {
      const res = await request<{ files: FileNode[] }>('/workspace/files')
      return res.files && res.files.length > 0 ? res.files : fileTree
    } catch {
      return fileTree
    }
  },

  async getWorkspaceFile(path: string): Promise<{ path: string; content: string; size: number } | null> {
    try {
      return await request<{ path: string; content: string; size: number }>(`/workspace/file?path=${encodeURIComponent(path)}`)
    } catch {
      return null
    }
  },

  async saveWorkspaceFile(path: string, content: string): Promise<boolean> {
    try {
      await request('/workspace/file', {
        method: 'POST',
        body: JSON.stringify({ path, content }),
      })
      return true
    } catch {
      return false
    }
  },

  async getMemory(): Promise<MemoryItem[]> {
    try {
      const res = await request<{ items: MemoryItem[] }>('/memory')
      return res.items && res.items.length > 0 ? res.items : memories
    } catch {
      return memories
    }
  },

  async getActivity(): Promise<ActivityItem[]> {
    try {
      const res = await request<{ audit: any[] }>('/audit')
      if (res.audit && res.audit.length > 0) {
        return res.audit.map((item: any, idx: number) => ({
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
      }
      return []
    } catch {
      return []
    }
  },

  async getVaultGraph(): Promise<{ nodes: WorkspaceGraphNode[]; edges: WorkspaceGraphEdge[] } | null> {
    try {
      const data = await request<{ nodes: any[]; edges: any[] }>('/vault/graph')
      const nodes: WorkspaceGraphNode[] = data.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        path: n.path,
        kind: 'file',
        cluster: n.cluster || 'Vault',
        weight: 1,
      }))
      const edges: WorkspaceGraphEdge[] = data.edges.map((e, i) => ({
        id: e.id || `e-${i}`,
        source: e.source,
        target: e.target,
        relation: 'references',
      }))
      return { nodes, edges }
    } catch {
      return null
    }
  },

  async getVaultNotes(): Promise<any[]> {
    try {
      const res = await request<{ items: any[]; total: number }>('/vault/notes')
      return res.items || []
    } catch {
      return []
    }
  },

  async getAuditTrail(): Promise<any[]> {
    try {
      const res = await request<{ audit: any[] }>('/audit')
      return res.audit || []
    } catch {
      return []
    }
  },

  async startJob(objective: string, sourceIds: string[] = [], kind = 'coding', model?: string) {
    return await request<any>('/jobs', {
      method: 'POST',
      body: JSON.stringify({ objective, sourceIds, kind, model }),
    })
  },

  async getJob(id: string) {
    return await request<any>(`/jobs/${id}`)
  },

  async cancelJob(id: string) {
    return await request<any>(`/jobs/${id}/cancel`, {
      method: 'POST',
    })
  },

  async commitProposal(id: string, sha256: string) {
    return await request<any>('/vault/commit', {
      method: 'POST',
      body: JSON.stringify({ id, sha256 }),
    })
  },

  async calculate(formula: string, operands: Record<string, number>) {
    return await request<any>('/calculate', {
      method: 'POST',
      body: JSON.stringify({ formula, operands }),
    })
  },

  async verifyGoogleToken(credential: string, clientId?: string): Promise<{ ok: boolean; sessionToken: string; user: AuthUser }> {
    return await request('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential, clientId }),
    })
  },

  async getAuthSession(sessionToken?: string): Promise<{ ok: boolean; user: AuthUser } | null> {
    try {
      const headers: Record<string, string> = {}
      if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`
      return await request('/auth/session', { headers })
    } catch {
      return null
    }
  },

  async logoutAuth(sessionToken?: string): Promise<void> {
    try {
      const headers: Record<string, string> = {}
      if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`
      await request('/auth/logout', { method: 'POST', headers })
    } catch {
      // Ignore network errors on logout
    }
  },

  async getAuthConfig(): Promise<{ googleClientId?: string }> {
    try {
      return await request('/auth/config')
    } catch {
      return {}
    }
  },

  async pollGoogleOAuth(state: string): Promise<{ ok: boolean; sessionToken?: string; user?: AuthUser; pending?: boolean }> {
    try {
      return await request(`/auth/google/poll?state=${encodeURIComponent(state)}`)
    } catch {
      return { ok: false, pending: true }
    }
  },
}
