import { useEffect, useState } from 'react'
import { X, User, SlidersHorizontal, Monitor, Cpu, Plug, ShieldCheck, LockKeyhole, LogOut, ChevronRight, ChevronLeft, Check, Moon, Gauge, KeyRound } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useEdithStore } from '../../store/useEdithStore'

const rows=[[User,'Account'],[SlidersHorizontal,'Preferences'],[Monitor,'Appearance'],[Cpu,'Models'],[Plug,'Connected Services'],[ShieldCheck,'Permissions'],[LockKeyhole,'Security']] as const
type Section=typeof rows[number][1]

export function ProfilePanel(){
  const open=useEdithStore((s)=>s.profileOpen)
  const set=useEdithStore((s)=>s.setProfileOpen)
  const user=useEdithStore((s)=>s.authUser)
  const signOut=useEdithStore((s)=>s.signOut)
  const backendStatus=useEdithStore((s)=>s.backendStatus)
  const selectedModel=useEdithStore((s)=>s.selectedModel)
  const setSelectedModel=useEdithStore((s)=>s.setSelectedModel)
  const [section,setSection]=useState<Section|null>(null)
  const [reduceMotion,setReduceMotion]=useState(false)
  const [compact,setCompact]=useState(false)
  const [model,setModel]=useState('Automatic')
  useEffect(()=>{document.documentElement.classList.toggle('reduce-motion',reduceMotion);return()=>document.documentElement.classList.remove('reduce-motion')},[reduceMotion])
  useEffect(()=>{document.documentElement.classList.toggle('compact-ui',compact);return()=>document.documentElement.classList.remove('compact-ui')},[compact])

  const detail=section&&<div className="profile-detail">
    <button className="profile-back" onClick={()=>setSection(null)}><ChevronLeft size={14}/>{section}</button>
    {section==='Account'&&<><div className="setting-block"><span>Signed in as</span><b>{user?.name||'EDITH User'}</b><small>{user?.email||'Local demo identity'}</small></div><div className="setting-note"><Check size={13}/>{user?.provider==='google'?'Authenticated via Google Identity Services.':'Identity is used only for the current frontend session.'}</div></>}
    {section==='Preferences'&&<><label className="setting-switch"><span><b>Compact execution</b><small>Reduce vertical spacing in live actions.</small></span><input type="checkbox" checked={compact} onChange={(e)=>setCompact(e.target.checked)}/><i/></label><label className="setting-switch"><span><b>Reduce motion</b><small>Minimize non-essential UI animation.</small></span><input type="checkbox" checked={reduceMotion} onChange={(e)=>setReduceMotion(e.target.checked)}/><i/></label></>}
    {section==='Appearance'&&<><div className="setting-block"><span>Theme</span><b><Moon size={13}/>EDITH Dark</b><small>Graphite surfaces with a restrained coral accent.</small></div><div className="setting-note"><Gauge size={13}/>Desktop density · {compact?'Compact':'Comfortable'}</div></>}
    {section==='Models'&&<div className="setting-block">
      <span>Agent model routing</span>
      {backendStatus?.agyAvailable ? (
        <>
          <b style={{ color: '#7bdcb0', display: 'block', margin: '4px 0' }}>Sovereign Autonomous Engine Active</b>
          <select
            aria-label="Agent model routing"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', background: '#101114', color: '#f1f3f5', border: '1px solid #2b3038' }}
          >
            <option value="gemini-3.8-flash-high">Gemini 3.8 Flash (High Reasoning - Default)</option>
            <option value="gemini-3.8-flash-medium">Gemini 3.8 Flash (Medium)</option>
            <option value="gemini-3.8-flash-low">Gemini 3.8 Flash (Low / Fast)</option>
            <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (Thinking)</option>
            <option value="claude-opus-4-6-thinking">Claude Opus 4.6 (Deep Reasoning)</option>
            <option value="gpt-oss-120b-medium">GPT-OSS 120B (Medium)</option>
          </select>
          <small>Directly orchestrated through Sovereign Kernel v{backendStatus.agyVersion || '1.4'}.</small>
        </>
      ) : (
        <>
          <select aria-label="Agent model routing" value={model} onChange={(e)=>setModel(e.target.value)}>
            <option>Automatic</option>
            <option>Fast</option>
            <option>Reasoning</option>
            <option>Local adapter</option>
          </select>
          <small>{backendStatus?.connected ? 'Local model server connected' : 'Frontend selection only until a model backend is connected.'}</small>
        </>
      )}
    </div>}
    {section==='Connected Services'&&<>
      <div className="service-row">
        <span className={backendStatus?.agyAvailable ? 'status-dot active' : 'status-dot'}/>
        <div>
          <b>Sovereign Autonomous Engine</b>
          <small>{backendStatus?.agyAvailable ? `Connected · Core Kernel v${backendStatus.agyVersion || '1.4'}` : 'Not detected in local environment'}</small>
        </div>
      </div>
      <div className="service-row">
        <span className={user?.provider==='google'?'status-dot active':'status-dot'}/>
        <div>
          <b>Google Identity</b>
          <small>{user?.provider==='google'?(user?.verified?'Connected & Backend Verified':'Connected'):'Not connected'}</small>
        </div>
      </div>
      <div className="service-row">
        <span className="status-dot"/>
        <div><b>GitHub</b><small>Not connected</small></div>
      </div>
    </>}
    {section==='Permissions'&&<><div className="setting-block"><span>Workspace policy</span><b>Approval required</b><small>File-changing actions pause before execution in this prototype.</small></div><div className="setting-note"><ShieldCheck size={13}/>Controlled-action boundary enabled.</div></>}
    {section==='Security'&&<><div className="setting-block"><span>Session</span><b><KeyRound size={13}/>{user?.provider==='google'?(user?.verified?'Sovereign Verified Session':'Google Frontend Session'):'Frontend-only session'}</b><small>{user?.provider==='google'?(user?.verified?'Google identity cryptographically verified on the Sovereign Gateway.':'Google credential decoded in browser session.'):'Production should validate Google credentials and sessions on the backend.'}</small></div></>}
  </div>

  return <AnimatePresence>{open&&<motion.aside aria-label="Profile settings" className="profile-panel" initial={{opacity:0,x:18}} animate={{opacity:1,x:0}} exit={{opacity:0,x:18}}>
    <div className="profile-head"><div>{user?.picture?<img className="avatar image" src={user.picture} alt="Profile"/>:<span className="avatar">{(user?.name||'E').charAt(0).toUpperCase()}</span>}<div><strong>{user?.name||'EDITH User'}</strong><small>{user?.provider==='google'?user.email:'Local demo session'}</small></div></div><button className="icon-button" aria-label="Close profile" onClick={()=>set(false)}><X size={17}/></button></div>
    {section?detail:<><div className="profile-session"><span className="status-dot active"/><div><b>{user?.provider==='google'?'Google session connected':'Demo session'}</b><small>{user?.provider==='google'?'Identity available to the frontend':'Configure Google client ID for live OAuth'}</small></div></div><div className="profile-rows">{rows.map(([Icon,label])=><button key={label} onClick={()=>setSection(label)}><Icon size={16}/><span>{label}</span><ChevronRight size={13}/></button>)}</div><button className="signout" onClick={signOut}><LogOut size={16}/>Sign out</button></>}
  </motion.aside>}</AnimatePresence>
}
