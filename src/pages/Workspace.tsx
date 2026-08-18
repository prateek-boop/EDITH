import { lazy, Suspense, useEffect } from 'react'
import { AppShell } from '../components/layout/AppShell'
import { AgentWorkspace } from '../components/agent/AgentWorkspace'
import { FilesView } from '../components/files/FilesView'
import { MemoryView } from '../components/memory/MemoryView'
import { ActivityView } from '../components/activity/ActivityView'
import { useEdithStore } from '../store/useEdithStore'

const GraphView=lazy(()=>import('../components/graph/GraphView').then((mod)=>({default:mod.GraphView})))

export function WorkspacePage() {
  const view=useEdithStore((s)=>s.activeView)
  const setView=useEdithStore((s)=>s.setActiveView)

  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&useEdithStore.getState().activeView!=='agent') setView('agent')
    }
    window.addEventListener('keydown',onKey)
    return()=>window.removeEventListener('keydown',onKey)
  },[setView])

  return <AppShell>
    <Suspense fallback={<div className="view-loader">Loading workspace view…</div>}>
      {view==='agent'&&<AgentWorkspace/>}
      {view==='workspace'&&<FilesView/>}
      {view==='graph'&&<GraphView/>}
      {view==='memory'&&<MemoryView/>}
      {view==='activity'&&<ActivityView/>}
    </Suspense>
  </AppShell>
}
