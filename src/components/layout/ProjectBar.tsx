import { ChevronUp, CircleUserRound, FolderPlus, GitBranch, Cpu } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useEdithStore } from '../../store/useEdithStore'
import { workspaces } from '../../mock/data'

export function ProjectBar(){
  const ws=useEdithStore((s)=>s.currentWorkspace)
  const open=useEdithStore((s)=>s.projectSwitcherOpen)
  const setOpen=useEdithStore((s)=>s.setProjectSwitcherOpen)
  const setProfile=useEdithStore((s)=>s.setProfileOpen)
  const plan=useEdithStore((s)=>s.plan)
  const state=useEdithStore((s)=>s.agentState)
  const done=plan.filter((p)=>p.status==='done').length
  const executionProgress=state==='idle'?ws?.progress??0:Math.round(done/Math.max(plan.length,1)*100)
  const launch=(id:string)=>{window.open(`${window.location.origin}${window.location.pathname}?workspace=${encodeURIComponent(id)}`,'_blank','noopener,noreferrer')}
  const options=ws?.source==='local'?[ws,...workspaces]:workspaces
  return <>
    <AnimatePresence>{open&&<motion.div className="project-popover" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:8}}>
      <div className="popover-title">SWITCH PROJECT <small>opens a new EDITH window</small></div>
      {options.map((w)=><button key={w.id} className="project-option" onClick={()=>w.source==='local'?window.open(window.location.href,'_blank','noopener,noreferrer'):launch(w.id)}><span className={ws?.id===w.id?'status-dot active':'status-dot'}/><span><b>{w.name}</b><em>{w.tech.slice(0,3).join(' · ')}</em></span><small>{w.progress}%</small></button>)}
      <button className="open-new" onClick={()=>useEdithStore.getState().setStage('picker')}><FolderPlus size={14}/>Open New Project</button>
    </motion.div>}</AnimatePresence>
    <footer className="projectbar upgraded">
      <div className="project-ident"><span className="status-dot active"/><div><strong>{ws?.name??'Workspace'}</strong><small>{ws?.source==='local'?<><GitBranch size={11}/>{ws.gitDetected?'Git workspace':'Local workspace'}</>:<><Cpu size={11}/>{ws?.tech?.slice(0,2).join(' · ')}</>}</small></div></div>
      <div className="project-progress"><div className="progress-track"><motion.div animate={{width:`${executionProgress}%`}}/></div><span>{state==='idle'?`${executionProgress}% PROJECT`:`${executionProgress}% EXECUTION`}</span></div>
      <div className="project-end"><button className="switch-btn" onClick={()=>setOpen(!open)}>Switch Project <ChevronUp size={15}/></button><button className="bottom-profile" onClick={()=>setProfile(true)}><CircleUserRound size={18}/></button></div>
    </footer>
  </>
}
