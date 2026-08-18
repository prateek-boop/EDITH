import type { ReactNode } from 'react'
import { TopBar } from './TopBar'
import { Sidebar } from './Sidebar'
import { ProjectBar } from './ProjectBar'
import { ProfilePanel } from '../profile/ProfilePanel'

export function AppShell({ children }: { children: ReactNode }) {
  return <div className="app-shell">
    <TopBar />
    <div className="body-shell"><Sidebar /><main className="main-workspace">{children}</main></div>
    <ProjectBar />
    <ProfilePanel />
  </div>
}
