import { PanelsTopLeft, Network, Database, Activity, Sparkles, MessageCircleMore } from 'lucide-react'
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
    <button className={active==='agent'?'edith-home active':'edith-home'} onClick={()=>set('agent')} aria-label="Return to EDITH">
      <span className="edith-home-orb"><Sparkles size={15}/><i/></span>
      <span className="edith-home-copy"><b>EDITH</b><small>AI workspace · Esc</small></span>
      <MessageCircleMore size={16} className="edith-home-arrow"/>
    </button>

    <div className="sidebar-divider"><span>Workspace tools</span></div>

    <nav>
      {items.map((item)=>{
        const Icon=item.icon
        return <button key={item.id} className={active===item.id?'nav-item active':'nav-item'} onClick={()=>set(item.id)}>
          {active===item.id&&<motion.i className="nav-active-rail" layoutId="nav-active"/>}
          <span className="nav-icon"><Icon size={17}/></span>
          <span>{item.label}</span>
          {item.id==='graph'&&activeFiles.length>0&&<b className="nav-count">{activeFiles.length}</b>}
        </button>
      })}
    </nav>

    <div className="sidebar-spacer"/>
    <button className={`sidebar-core state-${state}`} onClick={()=>set('agent')} title="Return to EDITH agent">
      <span className="core-status-orb"><i/></span>
      <span><b>Core status</b><small>{state==='idle'?'ready':state.replace('_',' ')}</small></span>
      <Sparkles size={13}/>
    </button>
    <div className="sidebar-version">EDITH · spatial 0.4</div>
  </aside>
}
