import { RotateCcw, TerminalSquare, Network, Activity, FileCode2, ArrowRight, CheckCircle2, LoaderCircle, ShieldAlert } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { lazy, Suspense } from 'react'
import { CommandInput } from './CommandInput'
import { PlanView } from './PlanView'
import { ApprovalCard } from './ApprovalCard'
import { VerificationView } from './VerificationView'
import { useEdithStore } from '../../store/useEdithStore'

const quickGoals=[
  'Inspect this project and explain the highest-risk issue.',
  'Find why the application is failing and propose a verified fix.',
  'Map the architecture and identify the files most relevant to the current task.',
]

const MobiusScene=lazy(()=>import('../mobius/MobiusScene').then((mod)=>({default:mod.MobiusScene})))

export function AgentWorkspace(){
  const state=useEdithStore((s)=>s.agentState)
  const goal=useEdithStore((s)=>s.currentGoal)
  const action=useEdithStore((s)=>s.currentAction)
  const reset=useEdithStore((s)=>s.resetAgent)
  const logs=useEdithStore((s)=>s.executionLog)
  const activeFiles=useEdithStore((s)=>s.activeFiles)
  const workspace=useEdithStore((s)=>s.currentWorkspace)
  const graphNodes=useEdithStore((s)=>s.graphNodes)
  const graphEdges=useEdithStore((s)=>s.graphEdges)
  const submit=useEdithStore((s)=>s.submitGoal)
  const setView=useEdithStore((s)=>s.setActiveView)
  const idle=state==='idle'

  return <div className={`agent-view ${idle?'idle':'working'} state-${state}`}>
    <div className="agent-grid-bg"/>
    <div className={idle?'mobius-layer':'mobius-layer working'} aria-label={`EDITH core visualization: ${state.replace('_',' ')}`}>
      <Suspense fallback={<div className="mobius-fallback" aria-hidden="true"/>}><MobiusScene state={state} dimmed={!idle}/></Suspense>
    </div>

    {idle&&<div className="core-readouts" aria-hidden="true">
      <div className="readout left"><span>CONTEXT</span><b>ONLINE</b><small>{workspace?.fileCount??graphNodes.filter((n)=>n.kind==='file').length} files indexed</small></div>
      <div className="readout right"><span>GRAPH</span><b>CONNECTED</b><small>{graphEdges.length} relationships</small></div>
    </div>}

    <AnimatePresence mode="wait">
      {idle ? <motion.div key="idle" className="idle-content" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0,y:-10}}>
        <div className="idle-copy">
          <motion.span className="eyebrow" initial={{opacity:0,y:4}} animate={{opacity:1,y:0}}>WORKSPACE IS READY</motion.span>
          <h1>What do you want EDITH to accomplish?</h1>
          <p>Give EDITH an outcome. It will understand the workspace, build a plan, execute controlled actions, and verify the result.</p>
        </div>
        <CommandInput/>
        <div className="quick-goals">{quickGoals.map((q,i)=><motion.button key={q} onClick={()=>submit(q)} initial={{opacity:0,y:5}} animate={{opacity:1,y:0}} transition={{delay:.08*i}}><span>{i+1}</span>{q}<ArrowRight size={12}/></motion.button>)}</div>
      </motion.div> : <motion.div key="work" className="execution-overlay" initial={{opacity:0,x:-18}} animate={{opacity:1,x:0}}>
        <div className="execution-head"><div><span className="eyebrow">ACTIVE GOAL</span><h1>{goal}</h1><div className={`execution-state state-${state}`}><i/>{state.replace('_',' ')}</div></div><button className="quiet-btn" onClick={reset}><RotateCcw size={14}/>Reset</button></div>
        <section className="follow-up-composer"><div className="section-label">FOLLOW-UP COMMAND</div><CommandInput compact/></section>
        <PlanView/>
        <section className="current-action"><div className="section-label">CURRENT ACTION</div><div className="action-line"><TerminalSquare size={16}/><span>{action}</span>{state==='success'?<CheckCircle2 size={15} className="action-success"/>:state==='waiting_approval'?<ShieldAlert size={15} className="action-wait"/>:<LoaderCircle size={15} className="spin action-running"/>}</div></section>

        <section className="execution-stream"><div className="section-label">LIVE EXECUTION</div><div className="execution-log-list">{logs.map((log)=><motion.div key={log.id} className={`execution-log ${log.status}`} initial={{opacity:0,x:-6}} animate={{opacity:1,x:0}}>
          <time>{log.time}</time><span className="log-node"/><div><strong>{log.label}</strong><p>{log.detail}</p>{log.file&&<code><FileCode2 size={11}/>{log.file}</code>}</div>
        </motion.div>)}</div></section>

        {state==='waiting_approval'&&<ApprovalCard/>}
        {(state==='verifying'||state==='success')&&<VerificationView success={state==='success'}/>} 
        {state==='failed'&&<section className="failed-state"><strong>EXECUTION STOPPED</strong><span>No controlled changes were applied after rejection.</span></section>}
        {state==='success'&&<div className="success-actions"><button onClick={()=>setView('activity')}><Activity size={14}/>Open activity</button><button onClick={()=>setView('graph')}><Network size={14}/>Inspect graph</button></div>}
      </motion.div>}
    </AnimatePresence>

    {!idle&&<aside className="working-set-rail">
      <div className="working-rail-head"><span className="eyebrow">EDITH WORKING SET</span><Network size={15}/></div>
      <div className="working-rail-core"><span className={`rail-orb state-${state}`}/><b>{state==='waiting_approval'?'PAUSED':state==='success'?'VERIFIED':'ACTIVE'}</b><small>{activeFiles.length||1} context targets</small></div>
      <div className="working-files">{activeFiles.slice(0,6).map((file,i)=><motion.button key={file} onClick={()=>setView('graph')} initial={{opacity:0,x:8}} animate={{opacity:1,x:0}} transition={{delay:i*.06}}><span>{String(i+1).padStart(2,'0')}</span><code>{file}</code><i/></motion.button>)}</div>
      <button className="rail-graph-link" onClick={()=>setView('graph')}>Open spatial graph <ArrowRight size={13}/></button>
    </aside>}
  </div>
}
