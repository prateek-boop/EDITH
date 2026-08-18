import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, ChevronDown, FileCode2, Folder, FolderOpen, FileText, Search, Sparkles, Braces, Eye } from 'lucide-react'
import { motion } from 'framer-motion'
import type { FileNode } from '../../lib/types'
import { useEdithStore } from '../../store/useEdithStore'

function filterTree(nodes:FileNode[],query:string):FileNode[]{
  if(!query)return nodes
  const q=query.toLowerCase()
  return nodes.flatMap((node)=>{
    if(node.type==='file')return node.name.toLowerCase().includes(q)||node.path.toLowerCase().includes(q)?[node]:[]
    const children=filterTree(node.children||[],query)
    return children.length||node.name.toLowerCase().includes(q)?[{...node,children}]:[]
  })
}

function countFiles(nodes:FileNode[]):number{return nodes.reduce((sum,n)=>sum+(n.type==='file'?1:countFiles(n.children||[])),0)}
function firstFile(nodes:FileNode[]):FileNode|null{
  for(const node of nodes){
    if(node.type==='file')return node
    const nested=firstFile(node.children||[])
    if(nested)return nested
  }
  return null
}

function TreeNode({node,depth=0,forceOpen=false}:{node:FileNode;depth?:number;forceOpen?:boolean}){
  const [open,setOpen]=useState(true)
  const select=useEdithStore((s)=>s.setSelectedFile)
  const selected=useEdithStore((s)=>s.selectedFile)
  const activeFiles=useEdithStore((s)=>s.activeFiles)
  const isFolder=node.type==='folder'
  const expanded=forceOpen||open
  const active=activeFiles.includes(node.path)
  return <div className="workspace-tree-node"><button className={`tree-row ${selected?.path===node.path?'selected':''} ${active?'edith-active':''}`} style={{paddingLeft:12+depth*17}} onClick={()=>{if(isFolder)setOpen(!expanded);else select(node)}}>
    {isFolder?(expanded?<ChevronDown size={13}/>:<ChevronRight size={13}/>):<span className="tree-spacer"/>}
    {isFolder?(expanded?<FolderOpen size={14}/>:<Folder size={14}/>):node.language==='markdown'?<FileText size={14}/>:<FileCode2 size={14}/>}<span>{node.name}</span>{active&&<i className="active-file-dot"/>}
  </button>{isFolder&&expanded&&node.children?.map((c)=><TreeNode node={c} depth={depth+1} key={c.path} forceOpen={forceOpen}/>)}</div>
}

export function FilesView(){
  const files=useEdithStore((s)=>s.files)
  const selected=useEdithStore((s)=>s.selectedFile)
  const select=useEdithStore((s)=>s.setSelectedFile)
  const activeFiles=useEdithStore((s)=>s.activeFiles)
  const workspace=useEdithStore((s)=>s.currentWorkspace)
  const [query,setQuery]=useState('')
  const filtered=useMemo(()=>filterTree(files,query),[files,query])
  const lineCount=selected?.content?.split('\n').length||0

  useEffect(()=>{
    if(!selected&&files.length)select(firstFile(files))
  },[files,selected,select])

  return <div className="standard-view files-view workspace-view">
    <header className="view-head files-head workspace-head">
      <div><span className="eyebrow">PROJECT EXPLORER</span><h1>Workspace</h1><p>{workspace?.name} · {countFiles(files)} indexed files · files stay scoped to this view</p></div>
      <div className="compact-search workspace-search"><Search size={14}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search workspace"/></div>
    </header>
    <div className="files-grid upgraded workspace-grid">
      <section className="file-tree workspace-explorer">
        <div className="tree-context"><span><Sparkles size={12}/>WORKSPACE</span><small>{workspace?.path||'Local project'} · {activeFiles.length} files in EDITH working set</small></div>
        <div className="workspace-tree-scroll">{filtered.length?filtered.map((n)=><TreeNode node={n} key={n.path} forceOpen={!!query}/>):<div className="tree-empty">No files match “{query}”</div>}</div>
      </section>
      <section className="file-preview workspace-editor">{selected?<motion.div key={selected.path} initial={{opacity:0,y:4}} animate={{opacity:1,y:0}} className="preview-inner">
        <div className="preview-meta"><FileCode2 size={16}/><div><strong>{selected.name}</strong><code>{selected.path}</code></div><div className="preview-stats"><span><Braces size={12}/>{selected.language||'text'}</span><span><Eye size={12}/>{lineCount} lines</span>{activeFiles.includes(selected.path)&&<b><Sparkles size={11}/>EDITH USING</b>}</div></div>
        <div className="editor-tab-row"><span className="editor-tab active"><FileCode2 size={12}/>{selected.name}<i/></span></div>
        <div className="code-preview">{(selected.content||'Preview unavailable for this file.').split('\n').map((line,i)=><div className="code-line" key={i}><span>{i+1}</span><code>{line||' '}</code></div>)}</div>
      </motion.div>:<div className="empty-panel"><FileText size={25}/><strong>Workspace indexed</strong><span>Select a file from the explorer to inspect it. The explorer disappears automatically in Graph, Memory, and Activity.</span></div>}</section>
    </div>
  </div>
}
