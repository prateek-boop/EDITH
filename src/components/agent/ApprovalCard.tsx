import { useState } from 'react'
import { AlertTriangle, ShieldCheck, FileWarning, CheckCircle2, ChevronDown, ChevronUp, FileCode } from 'lucide-react'
import { motion } from 'framer-motion'
import { useEdithStore } from '../../store/useEdithStore'

export function ApprovalCard(){
  const approve=useEdithStore((s)=>s.approve)
  const reject=useEdithStore((s)=>s.reject)
  const activeFiles=useEdithStore((s)=>s.activeFiles)
  const proposal=useEdithStore((s)=>s.activeProposal)
  const [showPreview, setShowPreview]=useState(false)
  const target=proposal?.targetFile || proposal?.path || activeFiles[activeFiles.length-1] || 'workspace configuration'
  const sha=proposal?.sha256 ? `${proposal.sha256.slice(0, 12)}…${proposal.sha256.slice(-8)}` : 'SHA-256 Verified'
  const actionLabel = proposal?.action ? proposal.action.replace('_', ' ').toUpperCase() : 'MUTATION PROPOSAL'

  return <motion.section role="group" aria-labelledby="approval-heading" className="approval-card dynamic-approval" initial={{opacity:0,y:12,scale:.985}} animate={{opacity:1,y:0,scale:1}}>
    <div className="approval-title">
      <span className="approval-icon"><AlertTriangle size={17}/></span>
      <div>
        <b id="approval-heading">SOVEREIGN APPROVAL REQUIRED</b>
        <small>Antigravity generated a verified modification. Execution paused for human authorization.</small>
      </div>
      <span className="action-tag" style={{ marginLeft: 'auto', background: 'rgba(255,107,91,0.15)', color: '#ff6b5b', border: '1px solid rgba(255,107,91,0.3)', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em' }}>
        {actionLabel}
      </span>
    </div>

    <div className="approval-grid">
      <div><small>Target Artifact</small><code><FileWarning size={13}/>{target}</code></div>
      <div><small>Integrity Digest</small><strong className="amber" style={{fontFamily:'monospace',fontSize:'11px'}}>{sha}</strong></div>
    </div>

    <div className="approval-reason">
      <span>{proposal?.summary || 'Governance Policy'}</span>
      <p>{proposal?.explanation || (proposal?.content ? proposal.content.slice(0, 180) + '…' : 'A controlled workspace modification has passed pre-execution sandbox verification and is awaiting your explicit commit signature.')}</p>
    </div>

    {proposal?.content && (
      <div className="approval-diff-preview" style={{ marginTop: '8px' }}>
        <button
          type="button"
          onClick={() => setShowPreview(!showPreview)}
          style={{ background: 'none', border: 'none', color: '#969eac', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '12px', padding: 0 }}
        >
          <FileCode size={13} />
          <span>{showPreview ? 'Hide proposed content' : 'Inspect proposed content'}</span>
          {showPreview ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {showPreview && (
          <pre style={{ maxHeight: '180px', overflow: 'auto', background: '#0a0b0e', border: '1px solid #232730', borderRadius: '6px', padding: '10px', fontSize: '11px', color: '#c9d1d9', marginTop: '6px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {proposal.content}
          </pre>
        )}
      </div>
    )}

    <div className="approval-verification">
      <CheckCircle2 size={14}/>
      <span>Commit will be signed with your role ({proposal?.role || 'engineer'}) and hash-chained to the local audit ledger.</span>
    </div>

    <div className="approval-actions">
      <button className="reject" onClick={reject}>Reject action</button>
      <button className="approve" onClick={approve}><ShieldCheck size={15}/>Approve & continue</button>
    </div>
  </motion.section>
}

