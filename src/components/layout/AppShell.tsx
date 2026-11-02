import { useEffect, useState, type ReactNode } from 'react'
import { WifiOff } from 'lucide-react'
import { useEdithStore } from '../../store/useEdithStore'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { TopBar } from './TopBar'
import { Sidebar } from './Sidebar'
import { ProjectBar } from './ProjectBar'
import { ProfilePanel } from '../profile/ProfilePanel'
import { HistoryPanel } from '../history/HistoryPanel'

export function AppShell({ children }: { children: ReactNode }) {
  const activeView = useEdithStore((s) => s.activeView)
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return
      const store = useEdithStore.getState()
      if (!store.profileOpen && !store.historyOpen && !store.projectSwitcherOpen) return
      event.preventDefault()
      store.setProfileOpen(false); store.setHistoryOpen(false); store.setProjectSwitcherOpen(false)
    }
    window.addEventListener('online', update); window.addEventListener('offline', update); window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); window.removeEventListener('keydown', escape) }
  }, [])
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to workspace</a><TopBar />
    <div className="body-shell">
      <Sidebar />
      <div className="workspace-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
        <main id="main-content" tabIndex={-1} className="main-workspace">
          {!online && <div className="offline-banner" role="status"><WifiOff size={14}/>You’re offline. Local editing is available; connected services need a connection.</div>}
          <ErrorBoundary key={activeView}>{children}</ErrorBoundary>
        </main>
        <ProjectBar />
      </div>
    </div>
    <HistoryPanel />
    <ProfilePanel />
  </div>
}
