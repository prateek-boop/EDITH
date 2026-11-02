import { RotateCcw, Network, Activity, FileCode2, ArrowRight, CheckCircle2, LoaderCircle, ShieldAlert, Sparkles } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { lazy, Suspense, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ErrorBoundary } from '../ui/ErrorBoundary'
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
  const agentOutput=useEdithStore((s)=>s.agentOutput)
  const activeProposal=useEdithStore((s)=>s.activeProposal)
  const activeFiles=useEdithStore((s)=>s.activeFiles)
  const workspace=useEdithStore((s)=>s.currentWorkspace)
  const graphNodes=useEdithStore((s)=>s.graphNodes)
  const graphEdges=useEdithStore((s)=>s.graphEdges)
  const submit=useEdithStore((s)=>s.submitGoal)
  const setView=useEdithStore((s)=>s.setActiveView)
  const backendStatus=useEdithStore((s)=>s.backendStatus)
  const fetchStatus=useEdithStore((s)=>s.fetchBackendStatus)
  const fetchGraph=useEdithStore((s)=>s.fetchVaultGraph)
  const idle=state==='idle'

  useEffect(()=>{
    fetchStatus()
    fetchGraph()
    const timer = setInterval(fetchStatus, 4000)
    return () => clearInterval(timer)
  }, [fetchStatus, fetchGraph])

  return <div className={`agent-view ${idle?'idle':'working'} state-${state}`}>
    <div className="agent-grid-bg"/>
    <div className={idle?'mobius-layer':'mobius-layer working'} aria-label={`EDITH core visualization: ${state.replace('_',' ')}`}>
      <ErrorBoundary compact><Suspense fallback={<div className="mobius-fallback" aria-hidden="true"/>}><MobiusScene state={state} dimmed={!idle}/></Suspense></ErrorBoundary>
    </div>

    {idle&&<div className="core-readouts" aria-hidden="true">
      <div className="readout left"><span>CONTEXT</span><b>ONLINE</b><small>{workspace?.fileCount??graphNodes.filter((n)=>n.kind==='file').length} files indexed</small></div>
      <div className="readout right"><span>GRAPH</span><b>CONNECTED</b><small>{graphEdges.length} relationships</small></div>
    </div>}

    <AnimatePresence mode="wait">
      {idle ? <motion.div key="idle" className="idle-content" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0,y:-10}}>
        <div className="idle-copy">
          <span className="eyebrow agent-eyebrow"><span className="status-dot active"/> YOUR PROJECT. A NEW PERSPECTIVE.</span>
          <h1>What are we building today?</h1>
          <p>Turn your next goal into a clear path forward.</p>
        </div>
        <CommandInput/>
        <p className="suggestions-label">A PLACE TO START</p><div className="quick-goals">{quickGoals.map((q,i)=><motion.button key={q} onClick={()=>submit(q)} initial={{opacity:0,y:5}} animate={{opacity:1,y:0}} transition={{delay:.08*i}}><span>{i===0?<FileCode2 size={17}/>:i===1?<ShieldAlert size={17}/>:<Network size={17}/>}</span><div><strong>{['Understand this project','Find a better solution','Connect the dots'][i]}</strong><small>{['Inspect the code and surface key risks','Diagnose an issue and propose a fix','Explore the project architecture'][i]}</small></div><ArrowRight size={12}/></motion.button>)}</div>
      </motion.div> : <motion.div key="work" className="execution-overlay" initial={{opacity:0,x:-18}} animate={{opacity:1,x:0}}>
        <p className="simulation-note" style={{ letterSpacing: '0.04em' }}>
          {backendStatus?.connected
            ? `Sovereign Engine Active · Local Loopback · ${backendStatus.mode === 'antigravity' ? `Antigravity AI Engine Connected (${backendStatus.agyModel || 'gemini-3.8-flash-high'})` : backendStatus.mode === 'local-llm' ? 'Local LLM Connected' : 'Embedded Sovereign Engine'}`
            : 'Sovereign AI Engine · Connecting to local loopback gateway…'}
        </p>
        <div className="execution-head"><div><span className="eyebrow">ACTIVE GOAL</span><h1>{goal}</h1><div className={`execution-state state-${state}`}><i/>{state.replace('_',' ')}</div></div><button className="quiet-btn" onClick={reset}><RotateCcw size={14}/>Reset</button></div>
        
        {/* Transparent Execution Activity Strip */}
        <details className="execution-stream-details" open={state === 'planning' || state === 'executing'}>
          <summary className="execution-summary">
            {state === 'success' || state === 'failed' ? <CheckCircle2 size={14} className="action-success"/> : <LoaderCircle size={14} className="spin action-running"/>}
            <span>{state === 'success' ? 'Task completed' : state === 'failed' ? 'Execution stopped' : state === 'waiting_approval' ? 'Waiting for human approval' : (action || 'Processing with Antigravity engine…')} ({logs.length})</span>
          </summary>
          <div className="execution-log-list">{logs.map((log)=><motion.div key={log.id} className={`execution-log ${log.status}`} initial={{opacity:0,x:-6}} animate={{opacity:1,x:0}}>
          <time>{log.time}</time><span className="log-node"/><div><strong>{log.label}</strong><p>{log.detail}</p>{log.file&&<code><FileCode2 size={11}/>{log.file}</code>}</div>
        </motion.div>)}</div>
        </details>

        {/* Visible Agent Response Card */}
        {agentOutput ? (
          <div className="agent-response-card">
            <div className="agent-response-header">
              <span className="agent-response-badge"><Sparkles size={13} style={{ display: 'inline', marginRight: 5, verticalAlign: -1 }}/>EDITH RESPONSE</span>
            </div>
            <div className="markdown-preview agent-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{agentOutput}</ReactMarkdown>
            </div>
          </div>
        ) : null}

        {/* Only show formal multi-step execution plan if an active mutation is proposed or in planning/execution with activeFiles */}
        {(activeProposal || (state !== 'success' && !agentOutput)) && <PlanView/>}

        {state==='waiting_approval'&&<ApprovalCard/>}
        {(state==='verifying'||(state==='success' && (activeProposal || !agentOutput)))&&<VerificationView success={state==='success'}/>} 
        {state==='failed'&&<section className="failed-state"><strong>EXECUTION STOPPED</strong><span>No controlled changes were applied after rejection.</span></section>}
        {state==='success'&&<div className="success-actions"><button onClick={()=>setView('activity')}><Activity size={14}/>Open activity</button><button onClick={()=>setView('graph')}><Network size={14}/>Inspect graph</button></div>}
        <section className="follow-up-composer" style={{ marginTop: "24px", borderBottom: "none" }}><div className="section-label">FOLLOW-UP COMMAND</div><CommandInput compact/></section>
      </motion.div>}
    </AnimatePresence>
  </div>
}
