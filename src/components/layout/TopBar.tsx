import { CircleUserRound, ChevronRight, Activity as ActivityIcon, History, Minus, Square, X } from 'lucide-react'
import { motion } from 'framer-motion'
import { useEdithStore } from '../../store/useEdithStore'

export function TopBar() {
  const workspace=useEdithStore((s)=>s.currentWorkspace)
  const agentState=useEdithStore((s)=>s.agentState)
  const activeView=useEdithStore((s)=>s.activeView)
  const setActiveView=useEdithStore((s)=>s.setActiveView)
  const setProfileOpen=useEdithStore((s)=>s.setProfileOpen)
  const profileOpen=useEdithStore((s)=>s.profileOpen)
  const historyOpen=useEdithStore((s)=>s.historyOpen)
  const setHistoryOpen=useEdithStore((s)=>s.setHistoryOpen)
  const historyCount=useEdithStore((s)=>s.commandHistory.length)
  const backendStatus=useEdithStore((s)=>s.backendStatus)
  const user=useEdithStore((s)=>s.authUser)
  const ready=agentState==='idle'||agentState==='success'
  const isElectron=typeof window !== 'undefined' && Boolean((window as any).edithDesktop?.isElectron)

  return <header className="topbar upgraded">
    <button type="button" className="edith-logo" onClick={()=>setActiveView('agent')} aria-label="Open EDITH agent" aria-current={activeView==='agent'?'page':undefined}><span>EDITH</span><i/></button>
    <div className="top-project">
      <span>{workspace?.name||'Workspace'}</span><ChevronRight size={12}/><b>{activeView==='agent'?'Agent':activeView.charAt(0).toUpperCase()+activeView.slice(1)}</b>
    </div>
    <div className="top-actions">
      <span className="demo-badge">
        {backendStatus?.connected
          ? (backendStatus.mode === 'antigravity' ? 'Antigravity Intelligence' : backendStatus.mode === 'local-llm' ? 'Local Neural Engine' : 'Sovereign Core')
          : (workspace?.source === 'local' ? 'Local Workspace' : 'Sovereign Workspace')}
      </span>
      <motion.span className={`system-state ${ready?'ready':'busy'} state-${agentState}`} layout><i/>{ready?(agentState==='success'?'TASK COMPLETED':'ENGINE READY'):agentState.replace('_',' ').toUpperCase()}</motion.span>
      <button type="button" className={historyOpen?'history-trigger active':'history-trigger'} onClick={()=>setHistoryOpen(!historyOpen)} aria-label="Open context history" aria-expanded={historyOpen}><History size={15}/><span>History</span>{historyCount>0&&<b>{historyCount}</b>}</button>
      <button className="profile-trigger" onClick={()=>setProfileOpen(!profileOpen)} title="Profile" aria-label="Open profile" aria-expanded={profileOpen}>{user?.picture?<img src={user.picture} alt=""/>:<CircleUserRound size={18}/>}<span>{user?.name?.split(' ')[0]||'Profile'}</span></button>
      {isElectron && (
        <div className="window-controls" style={{ display: 'flex', alignItems: 'center', gap: '3px', marginLeft: '6px' }}>
          <button type="button" className="quiet-btn" onClick={() => (window as any).edithDesktop?.minimize()} aria-label="Minimize window" style={{ padding: '3px 6px', height: '24px' }}>
            <Minus size={13} />
          </button>
          <button type="button" className="quiet-btn" onClick={() => (window as any).edithDesktop?.maximize()} aria-label="Maximize window" style={{ padding: '3px 6px', height: '24px' }}>
            <Square size={11} />
          </button>
          <button type="button" className="quiet-btn" onClick={() => (window as any).edithDesktop?.close()} aria-label="Close window" style={{ padding: '3px 6px', height: '24px' }}>
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  </header>
}
