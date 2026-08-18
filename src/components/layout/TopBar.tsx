import { CircleUserRound, ChevronRight, Activity as ActivityIcon, ArrowLeft, Sparkles } from 'lucide-react'
import { motion } from 'framer-motion'
import { useEdithStore } from '../../store/useEdithStore'

export function TopBar() {
  const workspace=useEdithStore((s)=>s.currentWorkspace)
  const agentState=useEdithStore((s)=>s.agentState)
  const activeView=useEdithStore((s)=>s.activeView)
  const setActiveView=useEdithStore((s)=>s.setActiveView)
  const setProfileOpen=useEdithStore((s)=>s.setProfileOpen)
  const profileOpen=useEdithStore((s)=>s.profileOpen)
  const user=useEdithStore((s)=>s.authUser)
  const ready=agentState==='idle'||agentState==='success'

  return <header className="topbar upgraded">
    <button className="edith-logo" onClick={()=>setActiveView('agent')} title="Return to EDITH"><span>EDITH</span><i/></button>
    <div className="top-project">
      {activeView!=='agent'&&<button className="agent-return" onClick={()=>setActiveView('agent')}><ArrowLeft size={13}/><Sparkles size={12}/>Back to EDITH</button>}
      <span>{workspace?.name||'Workspace'}</span><ChevronRight size={12}/><b>{activeView==='agent'?'Agent':activeView.charAt(0).toUpperCase()+activeView.slice(1)}</b>
    </div>
    <div className="top-actions">
      <motion.span className={`system-state ${ready?'ready':'busy'} state-${agentState}`} layout><ActivityIcon size={12}/><i/>{ready?(agentState==='success'?'VERIFIED':'READY'):agentState.replace('_',' ').toUpperCase()}</motion.span>
      <button className="profile-trigger" onClick={()=>setProfileOpen(!profileOpen)} title="Profile">{user?.picture?<img src={user.picture} alt=""/>:<CircleUserRound size={18}/>}<span>{user?.name?.split(' ')[0]||'Profile'}</span></button>
    </div>
  </header>
}
