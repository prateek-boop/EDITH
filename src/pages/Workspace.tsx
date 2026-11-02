import { lazy, Suspense, useEffect, useRef } from 'react'
import { AppShell } from '../components/layout/AppShell'
import { useEdithStore } from '../store/useEdithStore'

const AgentWorkspace=lazy(()=>import('../components/agent/AgentWorkspace').then((mod)=>({default:mod.AgentWorkspace})))
const FilesView=lazy(()=>import('../components/files/FilesView').then((mod)=>({default:mod.FilesView})))
const MemoryView=lazy(()=>import('../components/memory/MemoryView').then((mod)=>({default:mod.MemoryView})))
const ActivityView=lazy(()=>import('../components/activity/ActivityView').then((mod)=>({default:mod.ActivityView})))
const GraphView=lazy(()=>import('../components/graph/GraphView').then((mod)=>({default:mod.GraphView})))

export function WorkspacePage() {
  const view=useEdithStore((s)=>s.activeView)
  const setView=useEdithStore((s)=>s.setActiveView)
  const initialRoute=useRef(true)

  useEffect(()=>{
    const syncFromUrl=()=>{
      const requestedView=new URLSearchParams(window.location.search).get('view') || 'agent'
      if(requestedView&&['agent','workspace','graph','memory','activity'].includes(requestedView)) setView(requestedView as Parameters<typeof setView>[0])
    }
    syncFromUrl()
    window.addEventListener('popstate',syncFromUrl)
    return()=>window.removeEventListener('popstate',syncFromUrl)
  },[setView])

  useEffect(()=>{
    if(initialRoute.current){initialRoute.current=false;return}
    const url=new URL(window.location.href)
    if(url.searchParams.get('view')===view)return
    url.searchParams.set('view',view)
    window.history.pushState({},'',url)
  },[view])

  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      const store = useEdithStore.getState()
      if(event.key==='Escape' && !event.defaultPrevented && !document.querySelector('dialog[open]') && !store.profileOpen && !store.historyOpen && !store.projectSwitcherOpen && !['INPUT','TEXTAREA'].includes((event.target as HTMLElement)?.tagName) && store.activeView!=='agent') setView('agent')
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
