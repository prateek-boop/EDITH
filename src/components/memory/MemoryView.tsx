import { useEffect, useMemo, useState } from 'react'
import { Brain, Database, BookOpen, Trash2, Pencil, Search, Check, X, Sparkles, Filter } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useEdithStore } from '../../store/useEdithStore'
import { Dialog } from '../ui/Dialog'
import { SearchField } from '../ui/SearchField'
import type { MemoryItem } from '../../lib/types'

type Scope='All'|MemoryItem['scope']
export function MemoryView(){
  const memory=useEdithStore((s)=>s.memory)
  const forget=useEdithStore((s)=>s.forgetMemory)
  const editMemory=useEdithStore((s)=>s.editMemory)
  const fetchNotes=useEdithStore((s)=>s.fetchVaultNotes)
  const [removing,setRemoving]=useState<MemoryItem|null>(null)
  const [editing,setEditing]=useState<string|null>(null),[draft,setDraft]=useState(''),[query,setQuery]=useState(''),[scope,setScope]=useState<Scope>('All')

  useEffect(()=>{
    fetchNotes()
  },[fetchNotes])
  const counts={Working:memory.filter((m)=>m.scope==='Working').length,'Long-Term':memory.filter((m)=>m.scope==='Long-Term').length,Knowledge:memory.filter((m)=>m.scope==='Knowledge').length}
  const visible=useMemo(()=>memory.filter((m)=>(scope==='All'||m.scope===scope)&&(m.title+' '+m.subtitle+' '+m.scope).toLowerCase().includes(query.toLowerCase())),[memory,scope,query])
  const startEdit=(id:string,title:string)=>{setEditing(id);setDraft(title)}
  const save=(id:string)=>{if(draft.trim())editMemory(id,draft.trim());setEditing(null)}
  return <div className="standard-view memory-view">
    <header className="view-head"><div><span className="eyebrow">INSPECTABLE CONTEXT</span><h1>Memory</h1><p>What EDITH is allowed to remember about this workspace.</p></div><SearchField label="Search memory" value={query} onChange={setQuery}/></header>
    <div className="memory-summary upgraded"><motion.button className={scope==='Working'?'active':''} onClick={()=>setScope(scope==='Working'?'All':'Working')} whileHover={{y:-2}}><Brain size={18}/><span>Working Memory</span><strong>{counts.Working}</strong><small>active items</small></motion.button><motion.button className={scope==='Long-Term'?'active':''} onClick={()=>setScope(scope==='Long-Term'?'All':'Long-Term')} whileHover={{y:-2}}><Database size={18}/><span>Long-Term</span><strong>{counts['Long-Term']}</strong><small>memories</small></motion.button><motion.button className={scope==='Knowledge'?'active':''} onClick={()=>setScope(scope==='Knowledge'?'All':'Knowledge')} whileHover={{y:-2}}><BookOpen size={18}/><span>Knowledge</span><strong>{counts.Knowledge}</strong><small>documents</small></motion.button></div>
    <div className="memory-filter-row"><span><Filter size={12}/>{scope==='All'?'All memory':scope}</span><small>{visible.length} visible items</small></div>
    {removing&&<Dialog title="Forget this memory?" onClose={()=>setRemoving(null)}><p>“{removing.title}” will be removed from this session’s memory.</p><div className="vault-dialog-actions"><button data-autofocus onClick={()=>setRemoving(null)}>Cancel</button><button className="danger-action" onClick={()=>{forget(removing.id);setRemoving(null)}}>Forget memory</button></div></Dialog>}
    <section className="memory-list"><div className="section-label">RECENT MEMORY</div><AnimatePresence>{visible.map((m)=><motion.article className="memory-row" key={m.id} layout initial={false} animate={{opacity:1,y:0}} exit={{opacity:0,x:-12}}><div className="memory-kind"><span className={`memory-scope-dot scope-${m.scope.toLowerCase().replace('-','')}`}/>{m.scope}</div><div className="memory-copy">{editing===m.id?<input aria-label="Memory title" className="memory-edit-input" value={draft} onChange={(e)=>setDraft(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)save(m.id);if(e.key==='Escape')setEditing(null)}} autoFocus/>:<strong>{m.title}</strong>}<span>{m.subtitle} · Stored {m.stored}</span></div><div className="memory-actions">{editing===m.id?<><button onClick={()=>save(m.id)}><Check size={14}/>Save</button><button onClick={()=>setEditing(null)}><X size={14}/>Cancel</button></>:<><button onClick={()=>startEdit(m.id,m.title)}><Pencil size={14}/>Edit</button><button onClick={()=>setRemoving(m)}><Trash2 size={14}/>Forget</button></>}</div></motion.article>)}</AnimatePresence>{!visible.length&&<div className="memory-empty"><Sparkles size={18}/><span>No memory matches this filter.</span></div>}</section>
  </div>
}
