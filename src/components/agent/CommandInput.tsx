import { useRef, useState } from 'react'
import { ArrowUp, Paperclip, FolderKanban, X, Command, History } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useEdithStore } from '../../store/useEdithStore'

export function CommandInput({compact=false}:{compact?:boolean}){
  const [value,setValue]=useState('')
  const [attachments,setAttachments]=useState<File[]>([])
  const [historyIndex,setHistoryIndex]=useState(-1)
  const state=useEdithStore((s)=>s.agentState)
  const busy=!['idle','success','failed'].includes(state)
  const submit=useEdithStore((s)=>s.submitGoal)
  const history=useEdithStore((s)=>s.commandHistory)
  const fileRef=useRef<HTMLInputElement>(null)
  const send=()=>{const v=value.trim();if(!v||busy)return;submit(v);setValue('');setAttachments([]);setHistoryIndex(-1);setTimeout(()=>document.querySelectorAll('textarea').forEach(t=>t.style.height='auto'), 10)}
  const add=(list:FileList|null)=>{if(list?.length)setAttachments((prev)=>[...prev,...Array.from(list)].slice(0,8))}
  const navigateHistory=(direction:1|-1)=>{
    if(!history.length)return
    const next=Math.max(-1,Math.min(history.length-1,historyIndex+direction))
    setHistoryIndex(next)
    if(next>=0)setValue(history[next]);else setValue('')
  }
  return <motion.div className={`command-box dynamic-command ${compact?'compact-command':''}`} layout onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault();add(e.dataTransfer.files)}}>
    <div className="command-focus-line"/>
    <textarea className="resize-none" aria-label="Goal for EDITH" disabled={busy} style={{resize: 'none'}} value={value} onChange={(e)=>{setValue(e.target.value);e.target.style.height='auto';e.target.style.height=e.target.scrollHeight+'px';}} onKeyDown={(e)=>{
      if(e.nativeEvent.isComposing)return
      if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}
      if(e.key==='ArrowUp'&&e.altKey){e.preventDefault();navigateHistory(1)}
      if(e.key==='ArrowDown'&&e.altKey){e.preventDefault();navigateHistory(-1)}
    }} placeholder={compact?'Ask a follow-up or give EDITH the next goal…':'Describe what you’d like to accomplish…'} rows={1}/>
    <AnimatePresence>{attachments.length>0&&<motion.div className="attachment-chips" initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0,height:0}}>{attachments.map((file,i)=><span key={`${file.name}-${i}`}><Paperclip size={11}/>{file.name}<button aria-label={`Remove ${file.name}`} onClick={()=>setAttachments((x)=>x.filter((_,j)=>j!==i))}><X size={11}/></button></span>)}</motion.div>}</AnimatePresence>
    <div className="command-tools"><div><button type="button" onClick={()=>fileRef.current?.click()}><Paperclip size={15}/> Attach</button><span className="context-chip"><FolderKanban size={13}/> Workspace Context</span>{history.length>0&&<button type="button" className="history-hint" onClick={()=>navigateHistory(1)}><History size={13}/> History</button>}</div><button type="button" className="execute-button" disabled={!value.trim()||busy} onClick={send}>{busy?'Running…':compact?'Send':'Run goal'} <ArrowUp size={15}/></button></div>
    {attachments.length>0&&<p className="attachment-note">Attachments are listed for reference only in this demo.</p>}
    <div className="command-shortcut"><Command size={11}/> Enter to run · Shift+Enter newline · Alt+↑ history</div>
    <input ref={fileRef} type="file" hidden multiple onChange={(e)=>add(e.target.files)}/>
  </motion.div>
}
