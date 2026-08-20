import { PanelsTopLeft, Network, Database, Activity } from 'lucide-react'
import { motion } from 'framer-motion'
import { useEdithStore } from '../../store/useEdithStore'
import type { ActiveView } from '../../lib/types'

const items: { id: ActiveView; label: string; icon: typeof PanelsTopLeft }[] = [
  { id:'workspace', label:'Workspace', icon:PanelsTopLeft },
  { id:'graph', label:'Graph', icon:Network },
  { id:'memory', label:'Memory', icon:Database },
  { id:'activity', label:'Activity', icon:Activity },
]

export function Sidebar(){
  const active=useEdithStore((s)=>s.activeView)
  const set=useEdithStore((s)=>s.setActiveView)
  const activeFiles=useEdithStore((s)=>s.activeFiles)
  const state=useEdithStore((s)=>s.agentState)

  return <aside className="sidebar igloo-sidebar">
    <div className="sidebar-divider"><span>Workspace</span></div>

    <nav aria-label="Workspace views">
      {items.map((item)=>{
        const Icon=item.icon
        return <button key={item.id} type="button" aria-current={active===item.id?'page':undefined} aria-label={item.label} className={active===item.id?'nav-item active':'nav-item'} onClick={()=>set(item.id)}>
          {active===item.id&&<motion.i className="nav-active-rail" layoutId="nav-active"/>}
          <span className="nav-icon"><Icon size={17}/></span>
          <span>{item.label}</span>
          {item.id==='graph'&&activeFiles.length>0&&<b className="nav-count">{activeFiles.length}</b>}
        </button>
      })}
    </nav>

    <div className="sidebar-spacer"/>
    <div className={`sidebar-core state-${state}`} aria-label={`EDITH core status: ${state.replace('_',' ')}`}>
      <span className="core-status-orb"><i/></span>
      <span><b>Core status</b><small>{state==='idle'?'ready':state.replace('_',' ')}</small></span>
    </div>
    <div className="sidebar-version">EDITH · spatial 0.4</div>
  </aside>
}
