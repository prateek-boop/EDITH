import type { ActivityItem, FileNode, MemoryItem, Workspace } from '../lib/types'

// Default active workspace configuration
export const workspaces: Workspace[] = [
  {
    id: 'edith',
    name: 'EDITH Sovereign OS',
    path: '/home/lucifer/Projects/EDITH',
    progress: 100,
    tech: ['React 19', 'TypeScript', 'Electron', 'Python', 'Google Antigravity'],
    source: 'local',
    gitDetected: true,
  },
]

// Initial workspace file tree skeleton (hydrated dynamically from the Sovereign Gateway)
export const fileTree: FileNode[] = [
  {
    name: 'src',
    type: 'folder',
    path: 'src',
    children: [
      {
        name: 'App.tsx',
        type: 'file',
        path: 'src/App.tsx',
        language: 'tsx',
        content: '// EDITH Sovereign OS Entry Point\n',
      },
    ],
  },
  {
    name: 'backend',
    type: 'folder',
    path: 'backend',
    children: [
      {
        name: 'api',
        type: 'folder',
        path: 'backend/api',
        children: [
          {
            name: 'routes.py',
            type: 'file',
            path: 'backend/api/routes.py',
            language: 'python',
            content: '# Sovereign API Routes\n',
          },
        ],
      },
      {
        name: 'config.py',
        type: 'file',
        path: 'backend/config.py',
        language: 'python',
        content: '# Gateway Configuration\n',
      },
    ],
  },
  {
    name: 'package.json',
    type: 'file',
    path: 'package.json',
    language: 'json',
    content: '{\n  "name": "edith-frontend",\n  "version": "0.4.0"\n}\n',
  },
  {
    name: 'README.md',
    type: 'file',
    path: 'README.md',
    language: 'markdown',
    content: '# EDITH — Sovereign Personal AI Operating System\n',
  },
]

// Initial sovereign memories
export const memories: MemoryItem[] = [
  {
    id: 'm1',
    scope: 'Knowledge',
    title: 'EDITH Sovereign Architecture',
    subtitle: 'Two-phase human approval with cryptographic SHA-256 commit verification',
    stored: 'Active Policy',
  },
  {
    id: 'm2',
    scope: 'Long-Term',
    title: 'Google Antigravity Intelligence',
    subtitle: 'Autonomous reasoning, code mutation, and tool orchestration via agy CLI',
    stored: 'Model Routing',
  },
  {
    id: 'm3',
    scope: 'Working',
    title: 'Local Loopback Gateway Active',
    subtitle: 'Zero cloud telemetry · Port 8766 loopback sandbox',
    stored: 'Active Session',
  },
]

// Initial activity log (hydrated from hash-chained audit.jsonl)
export const activity: ActivityItem[] = []
