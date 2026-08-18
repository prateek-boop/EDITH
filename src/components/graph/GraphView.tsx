import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, OrbitControls, Sparkles } from '@react-three/drei'
import { Search, SlidersHorizontal, RotateCcw, Crosshair, GitBranch, Box, FileCode2, Brain, Target, Workflow, Pause, Play, Radio } from 'lucide-react'
import { type ReactNode, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useEdithStore } from '../../store/useEdithStore'
import type { GraphNodeKind, GraphRelation, WorkspaceGraphEdge, WorkspaceGraphNode } from '../../lib/types'

type PositionedNode = WorkspaceGraphNode & { position:[number,number,number] }

const hash=(text:string)=>{
  let h=2166136261
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}
  return Math.abs(h)
}

function buildLayout(nodes:WorkspaceGraphNode[], edges:WorkspaceGraphEdge[], goal:string, action:string, activeFiles:string[]){
  const capped=nodes.slice(0,72)
  const clusters=Array.from(new Set(capped.map((n)=>n.cluster))).slice(0,9)
  const clusterCounts=new Map<string,number>()
  const positioned:PositionedNode[]=capped.map((node,index)=>{
    const ci=Math.max(0,clusters.indexOf(node.cluster))
    const clusterAngle=(ci/Math.max(clusters.length,1))*Math.PI*2-.4
    const clusterCenter=new THREE.Vector3(
      Math.cos(clusterAngle)*2.25,
      Math.sin(clusterAngle)*1.30,
      Math.sin(clusterAngle*1.42)*.72,
    )
    const localIndex=clusterCounts.get(node.cluster)||0
    clusterCounts.set(node.cluster,localIndex+1)
    const h=hash(node.id)
    const localAngle=(localIndex*.92)+((h%100)/100)*.42
    const localRadius=node.kind==='folder'?.28:.46+Math.min(localIndex,6)*.075
    const jitter=new THREE.Vector3(
      Math.cos(localAngle)*localRadius,
      Math.sin(localAngle)*localRadius*.82,
      ((((h>>9)%100)/100)-.5)*.72,
    )
    if(node.kind==='folder')clusterCenter.multiplyScalar(.86)
    const p=clusterCenter.add(jitter)
    return {...node,position:[p.x,p.y,p.z] as [number,number,number]}
  })

  const activeCandidates=activeFiles.map((p)=>positioned.find((n)=>n.path===p||n.id===p)).filter(Boolean) as PositionedNode[]
  const anchors=activeCandidates.length?activeCandidates:positioned.filter((n)=>n.kind==='file').slice(0,4)
  const extras:PositionedNode[]=[
    {id:'__goal__',label:goal||'EDITH',kind:'goal',cluster:'EDITH',weight:6,position:[0,.08,.25]},
    {id:'__task__',label:action&&goal?action:'Current task',kind:'task',cluster:'EDITH',weight:4,position:[-.72,-.72,.10]},
    {id:'__memory__',label:'Workspace memory',kind:'memory',cluster:'EDITH',weight:4,position:[.78,-.66,-.12]},
  ]
  const extraEdges:WorkspaceGraphEdge[]=[
    {id:'goal-task',source:'__goal__',target:'__task__',relation:'related_to'},
    {id:'goal-memory',source:'__goal__',target:'__memory__',relation:'used_by'},
    ...anchors.slice(0,7).map((n,i)=>({id:`goal-active-${i}`,source:'__goal__',target:n.id,relation:'related_to' as const})),
  ]
  return {nodes:[...positioned,...extras],edges:[...edges.slice(0,130),...extraEdges]}
}

function NodeHalo({selected,active}:{selected:boolean;active:boolean}){
  const ref=useRef<THREE.Group>(null)
  useFrame(({clock},delta)=>{
    if(!ref.current)return
    ref.current.rotation.y+=delta*(selected?.45:.16)
    ref.current.rotation.x-=delta*(selected?.18:.06)
    ref.current.scale.setScalar(1+Math.sin(clock.getElapsedTime()*1.6)*.035)
  })
  if(!selected&&!active)return null
  return <group ref={ref}>
    <mesh rotation={[Math.PI/2,0,0]}><torusGeometry args={[.225,.006,8,72]}/><meshBasicMaterial color={selected?'#ff4540':'#ffffff'} transparent opacity={selected?.42:.15}/></mesh>
    <mesh rotation={[0,.8,.5]}><torusGeometry args={[.285,.0035,8,72]}/><meshBasicMaterial color="#ff3b36" transparent opacity={selected?.22:.10}/></mesh>
  </group>
}

function GraphNode({node,selected,hovered,onSelect,onHover,dim,active}:{node:PositionedNode;selected:boolean;hovered:boolean;onSelect:()=>void;onHover:(v:boolean)=>void;dim:boolean;active:boolean}){
  const group=useRef<THREE.Group>(null)
  const inner=useRef<THREE.Mesh>(null)
  const isGoal=node.kind==='goal'
  useFrame(({clock})=>{
    if(!group.current)return
    const t=clock.getElapsedTime()
    const target=selected?1.40:hovered?1.22:active?1.12:1
    const s=THREE.MathUtils.lerp(group.current.scale.x,target,.10)
    group.current.scale.setScalar(s)
    group.current.position.y=node.position[1]+Math.sin(t*.42+(hash(node.id)%37))*0.018
    if(inner.current)inner.current.rotation.y=t*(isGoal?.18:.07)
  })

  const hot=selected||hovered||active||isGoal
  const glassOpacity=dim&&!hot?.08:isGoal?.62:.34
  const coreColor=isGoal?'#ff3b36':hot?'#ff4641':node.kind==='folder'?'#b7b7bb':node.kind==='memory'?'#d3d3d6':'#eeeeef'
  const shellScale=isGoal?.25:node.kind==='folder'?.16:.12
  const innerScale=isGoal?.105:node.kind==='folder'?.068:.052

  return <group ref={group} position={node.position}>
    <NodeHalo selected={selected} active={active||isGoal}/>
    {isGoal&&<mesh scale={1.65}><sphereGeometry args={[.20,32,32]}/><meshBasicMaterial color="#ff2b2b" transparent opacity={.035} depthWrite={false}/></mesh>}
    <mesh onClick={(e)=>{e.stopPropagation();onSelect()}} onPointerOver={(e)=>{e.stopPropagation();onHover(true)}} onPointerOut={()=>onHover(false)}>
      <sphereGeometry args={[shellScale,32,32]}/>
      <meshPhysicalMaterial color="#f5f5f5" metalness={.05} roughness={.08} clearcoat={1} clearcoatRoughness={.03} transmission={.18} thickness={.45} transparent opacity={glassOpacity} depthWrite={!dim}/>
    </mesh>
    <mesh ref={inner}>
      <sphereGeometry args={[innerScale,24,24]}/>
      <meshPhysicalMaterial color={coreColor} emissive={hot?'#651215':'#111113'} emissiveIntensity={hot?.42:.05} metalness={.62} roughness={.20} clearcoat={.72}/>
    </mesh>
    {(selected||hovered||active||isGoal)&&<Html position={[0,isGoal?.37:.26,0]} center distanceFactor={7.4}>
      <span className={`graph-node-label ${selected?'selected':''}`}><i data-kind={node.kind}/>{node.label}</span>
    </Html>}
  </group>
}

function buildCurve(a:PositionedNode,b:PositionedNode,index:number){
  const start=new THREE.Vector3(...a.position)
  const end=new THREE.Vector3(...b.position)
  const mid=start.clone().add(end).multiplyScalar(.5)
  const delta=end.clone().sub(start)
  const perpendicular=new THREE.Vector3(-delta.y,delta.x,.2).normalize().multiplyScalar(.08+((hash(`${a.id}:${b.id}:${index}`)%100)/100)*.16)
  mid.add(perpendicular)
  mid.z+=.05+((index%4)-1.5)*.025
  return new THREE.QuadraticBezierCurve3(start,mid,end)
}

function Edge({a,b,edge,hot,dim,index}:{a:PositionedNode;b:PositionedNode;edge:WorkspaceGraphEdge;hot:boolean;dim:boolean;index:number}){
  const curve=useMemo(()=>buildCurve(a,b,index),[a,b,index])
  const pulse=useRef<THREE.Mesh>(null)
  useFrame(({clock})=>{
    if(!pulse.current)return
    pulse.current.position.copy(curve.getPointAt((clock.getElapsedTime()*(hot?.16:.055)+index*.071)%1))
  })
  return <>
    <mesh>
      <tubeGeometry args={[curve,28,hot?.006:.0038,6,false]}/>
      <meshBasicMaterial color={hot?'#ff4540':'#d8d8dc'} transparent opacity={dim?.018:hot?.34:.075}/>
    </mesh>
    {hot&&!dim&&<mesh ref={pulse}>
      <sphereGeometry args={[.022,10,10]}/><meshBasicMaterial color="#ff5a55"/>
    </mesh>}
  </>
}

function SceneMotion({enabled,children}:{enabled:boolean;children:ReactNode}){
  const ref=useRef<THREE.Group>(null)
  useFrame(({clock},delta)=>{
    if(!ref.current)return
    if(enabled)ref.current.rotation.y+=delta*.010
    ref.current.rotation.x=Math.sin(clock.getElapsedTime()*.10)*.018
    const s=1+Math.sin(clock.getElapsedTime()*.24)*.003
    ref.current.scale.setScalar(s)
  })
  return <group ref={ref}>{children}</group>
}

function CameraController({focusPosition,focusNonce}:{focusPosition?:[number,number,number];focusNonce:number}){
  const {camera}=useThree()
  const last=useRef(focusNonce)
  const target=useRef<THREE.Vector3|null>(null)
  const look=useRef(new THREE.Vector3())
  useFrame(()=>{
    if(focusPosition&&last.current!==focusNonce){
      last.current=focusNonce
      look.current.set(...focusPosition)
      target.current=new THREE.Vector3(...focusPosition).add(new THREE.Vector3(0,0,2.7))
    }
    if(target.current){
      camera.position.lerp(target.current,.065)
      camera.lookAt(look.current)
      if(camera.position.distanceTo(target.current)<.04)target.current=null
    }
  })
  return null
}

function Scene({nodes,edges,selected,setSelected,hovered,setHovered,focusWorking,query,relation,motionEnabled,focusNonce}:{nodes:PositionedNode[];edges:WorkspaceGraphEdge[];selected:string|null;setSelected:(v:string)=>void;hovered:string|null;setHovered:(v:string|null)=>void;focusWorking:boolean;query:string;relation:'all'|GraphRelation;motionEnabled:boolean;focusNonce:number}){
  const activeFiles=useEdithStore((s)=>s.activeFiles)
  const q=query.trim().toLowerCase()
  const nodeMap=useMemo(()=>new Map(nodes.map((n)=>[n.id,n])),[nodes])
  const selectedNode=selected?nodeMap.get(selected):undefined
  const relevantEdges=edges.filter((e)=>relation==='all'||e.relation===relation).filter((e)=>nodeMap.has(e.source)&&nodeMap.has(e.target))
  const activeSet=new Set([...activeFiles,'__goal__','__task__','__memory__'])
  const connectedSet=useMemo(()=>{
    const set=new Set<string>()
    if(selected){
      set.add(selected)
      relevantEdges.forEach((e)=>{if(e.source===selected)set.add(e.target);if(e.target===selected)set.add(e.source)})
    }
    return set
  },[selected,relevantEdges])

  return <>
    <fog attach="fog" args={['#0d0d0f',5.2,10.8]}/>
    <ambientLight intensity={.58}/>
    <hemisphereLight args={['#ffffff','#121214',1.25]}/>
    <directionalLight position={[4,5,5]} intensity={3.0} color="#ffffff"/>
    <pointLight position={[2.7,.8,3.5]} intensity={3.4} color="#ff3b36" distance={9}/>
    <Sparkles count={36} scale={[9,6,4]} size={.30} speed={motionEnabled?.08:.02} opacity={.10} color="#e1e1e3"/>
    <SceneMotion enabled={motionEnabled}>
      {relevantEdges.map((edge,index)=>{
        const a=nodeMap.get(edge.source)!,b=nodeMap.get(edge.target)!
        const qDim=!!q&&!a.label.toLowerCase().includes(q)&&!b.label.toLowerCase().includes(q)
        const active=activeSet.has(a.path||a.id)||activeSet.has(b.path||b.id)||edge.source==='__goal__'
        const selectedRelated=selected?connectedSet.has(a.id)&&connectedSet.has(b.id):false
        const dim=(focusWorking&&!active&&!selectedRelated)||qDim
        return <Edge key={edge.id} a={a} b={b} edge={edge} hot={active||selectedRelated} dim={dim} index={index}/>
      })}
      {nodes.map((node)=>{
        const match=!!q&&(node.label.toLowerCase().includes(q)||(node.path||'').toLowerCase().includes(q))
        const active=activeSet.has(node.path||node.id)
        const related=selected?connectedSet.has(node.id):false
        const dim=(focusWorking&&!active&&!related)||(!!q&&!match)
        return <GraphNode key={node.id} node={node} selected={selected===node.id} hovered={hovered===node.id} onSelect={()=>setSelected(node.id)} onHover={(v)=>setHovered(v?node.id:null)} dim={dim} active={active}/>
      })}
    </SceneMotion>
    <CameraController focusPosition={selectedNode?.position} focusNonce={focusNonce}/>
    <OrbitControls enableDamping dampingFactor={.07} minDistance={2.2} maxDistance={9.2} rotateSpeed={.48} zoomSpeed={.62}/>
  </>
}

const relationLabels:Array<{id:'all'|GraphRelation;label:string}>=[
  {id:'all',label:'All'},
  {id:'contains',label:'Contains'},
  {id:'imports',label:'Imports'},
  {id:'related_to',label:'Related'},
]

function KindIcon({kind}:{kind:GraphNodeKind}){
  if(kind==='folder')return <Box size={14}/>
  if(kind==='goal')return <Target size={14}/>
  if(kind==='task')return <Workflow size={14}/>
  if(kind==='memory')return <Brain size={14}/>
  return <FileCode2 size={14}/>
}

export function GraphView(){
  const baseNodes=useEdithStore((s)=>s.graphNodes)
  const baseEdges=useEdithStore((s)=>s.graphEdges)
  const activeFiles=useEdithStore((s)=>s.activeFiles)
  const goal=useEdithStore((s)=>s.currentGoal)
  const action=useEdithStore((s)=>s.currentAction)
  const workspace=useEdithStore((s)=>s.currentWorkspace)
  const [selected,setSelected]=useState<string|null>('__goal__')
  const [hovered,setHovered]=useState<string|null>(null)
  const [focus,setFocus]=useState(true)
  const [query,setQuery]=useState('')
  const [relation,setRelation]=useState<'all'|GraphRelation>('all')
  const [motionEnabled,setMotionEnabled]=useState(true)
  const [focusNonce,setFocusNonce]=useState(0)
  const layout=useMemo(()=>buildLayout(baseNodes,baseEdges,goal,action,activeFiles),[baseNodes,baseEdges,goal,action,activeFiles])
  const item=layout.nodes.find((n)=>n.id===selected)
  const connections=item?layout.edges.filter((e)=>e.source===item.id||e.target===item.id).slice(0,6):[]

  return <div className="standard-view graph-view premium-graph-view igloo-graph-view">
    <header className="view-head graph-head">
      <div><span className="eyebrow">SPATIAL CONTEXT</span><h1>Workspace graph</h1><p>{workspace?.name} · {baseNodes.length} nodes · {baseEdges.length} relationships</p></div>
      <div className="graph-tools">
        <div className="compact-search"><Search size={14}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Find a node"/></div>
        <button className={focus?'tool-toggle active':'tool-toggle'} onClick={()=>setFocus(!focus)}><SlidersHorizontal size={14}/>Working set</button>
        <button className={motionEnabled?'tool-toggle active':'tool-toggle'} onClick={()=>setMotionEnabled(!motionEnabled)}>{motionEnabled?<Pause size={13}/>:<Play size={13}/>}Motion</button>
      </div>
    </header>

    <div className="graph-stage premium-graph-stage igloo-graph-stage">
      <div className="graph-soft-light"/>
      <Canvas camera={{position:[0,0,6.6],fov:42}} dpr={[1,1.7]} gl={{antialias:true,alpha:true,powerPreference:'high-performance'}} onCreated={({gl})=>{gl.toneMapping=THREE.ACESFilmicToneMapping;gl.toneMappingExposure=1.05}}>
        <Scene nodes={layout.nodes} edges={layout.edges} selected={selected} setSelected={(id)=>{setSelected(id);setFocusNonce((n)=>n+1)}} hovered={hovered} setHovered={setHovered} focusWorking={focus} query={query} relation={relation} motionEnabled={motionEnabled} focusNonce={focusNonce}/>
      </Canvas>

      <div className="graph-live-badge"><Radio size={12}/><span>Live topology</span><i/></div>
      <div className="graph-relation-bar">
        <span><GitBranch size={12}/>Relations</span>
        {relationLabels.map((r)=><button key={r.id} className={relation===r.id?'active':''} onClick={()=>setRelation(r.id)}>{r.label}</button>)}
      </div>
      <div className="graph-legend dynamic"><span><i className="node-red"/>EDITH context</span><span><i/>Workspace</span><span className="graph-hint">Drag to orbit · scroll to zoom · select a node</span></div>
      <div className="graph-quick-actions">
        <button onClick={()=>{setSelected('__goal__');setFocusNonce((n)=>n+1)}} title="Focus EDITH"><Crosshair size={14}/></button>
        <button onClick={()=>{setSelected('__goal__');setQuery('');setRelation('all');setFocusNonce((n)=>n+1)}} title="Reset"><RotateCcw size={14}/></button>
      </div>

      {item&&<div className="graph-detail rich premium-graph-detail igloo-graph-detail">
        <small>Selected</small>
        <div className="graph-detail-title"><span><KindIcon kind={item.kind}/></span><div><strong>{item.label}</strong><em>{item.kind}</em></div></div>
        {item.path&&<code>{item.path}</code>}
        <div className="graph-connection-list"><small>Connections</small>{connections.length?connections.map((edge)=>{
          const otherId=edge.source===item.id?edge.target:edge.source
          const other=layout.nodes.find((n)=>n.id===otherId)
          return <button key={edge.id} onClick={()=>{setSelected(otherId);setFocusNonce((n)=>n+1)}}><span>{edge.relation.replace('_',' ')}</span><b>{other?.label||otherId}</b></button>
        }):<p>No direct relationships in this filter.</p>}</div>
      </div>}
    </div>
  </div>
}
