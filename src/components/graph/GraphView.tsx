import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import { Search, SlidersHorizontal, RotateCcw, Crosshair, GitBranch, Box, FileCode2, Brain, Target, Workflow, Pause, Play } from 'lucide-react'
import { useReducedMotion } from 'framer-motion'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useEdithStore } from '../../store/useEdithStore'
import type { GraphNodeKind, GraphRelation, WorkspaceGraphEdge, WorkspaceGraphNode } from '../../lib/types'

type PositionedNode = WorkspaceGraphNode & { position:[number,number,number] }

const hash=(text:string)=>{
  let h=2166136261
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}
  return Math.abs(h)
}

function buildLayout(nodes:WorkspaceGraphNode[], edges:WorkspaceGraphEdge[], goal:string, activeFiles:string[]){
  const capped=nodes.slice(0,48)
  const clusters=Array.from(new Set(capped.map((n)=>n.cluster))).slice(0,9)
  const clusterCounts=new Map<string,number>()
  const positioned:PositionedNode[]=capped.map((node)=>{
    const ci=Math.max(0,clusters.indexOf(node.cluster))
    const clusterAngle=(ci/Math.max(clusters.length,1))*Math.PI*2-.4
    const clusterCenter=new THREE.Vector3(
      Math.cos(clusterAngle)*2.18,
      Math.sin(clusterAngle)*1.34,
      0,
    )
    const localIndex=clusterCounts.get(node.cluster)||0
    clusterCounts.set(node.cluster,localIndex+1)
    const h=hash(node.id)
    const localAngle=(localIndex*.92)+((h%100)/100)*.42
    const localRadius=node.kind==='folder'?.18:.30+Math.min(localIndex,6)*.075
    const jitter=new THREE.Vector3(
      Math.cos(localAngle)*localRadius,
      Math.sin(localAngle)*localRadius*.82,
      0,
    )
    if(node.kind==='folder')clusterCenter.multiplyScalar(.86)
    const p=clusterCenter.add(jitter)
    return {...node,position:[p.x,p.y,p.z] as [number,number,number]}
  })

  const activeCandidates=activeFiles.map((p)=>positioned.find((n)=>n.path===p||n.id===p)).filter(Boolean) as PositionedNode[]
  const anchors=activeCandidates.length?activeCandidates:positioned.filter((n)=>n.kind==='file').slice(0,4)
  const extras:PositionedNode[]=[{id:'__goal__',label:goal||'EDITH',kind:'goal',cluster:'EDITH',weight:6,position:[0,0,0]}]
  const extraEdges:WorkspaceGraphEdge[]=[
    ...anchors.slice(0,5).map((n,i)=>({id:`goal-active-${i}`,source:'__goal__',target:n.id,relation:'related_to' as const})),
  ]
  return {nodes:[...positioned,...extras],edges:[...edges.slice(0,130),...extraEdges]}
}

function NodeHalo({selected,active,motionEnabled}:{selected:boolean;active:boolean;motionEnabled:boolean}){
  const ref=useRef<THREE.Group>(null)
  useFrame(({clock},delta)=>{
    if(!ref.current)return
    if(motionEnabled){
      ref.current.rotation.z+=delta*(selected?.36:.12)
      ref.current.scale.setScalar(1+Math.sin(clock.getElapsedTime()*1.4)*.025)
    }
  })
  if(!selected&&!active)return null
  return <group ref={ref}>
    <mesh><ringGeometry args={[.19,.198,64]}/><meshBasicMaterial color={selected?'#ef3439':'#b9bbc2'} transparent opacity={selected?.52:.18} side={THREE.DoubleSide}/></mesh>
  </group>
}

function GraphNode({node,selected,hovered,onSelect,onHover,onMove,onDragChange,dim,active,motionEnabled}:{node:PositionedNode;selected:boolean;hovered:boolean;onSelect:()=>void;onHover:(v:boolean)=>void;onMove:(position:[number,number,number])=>void;onDragChange:(dragging:boolean)=>void;dim:boolean;active:boolean;motionEnabled:boolean}){
  const group=useRef<THREE.Group>(null)
  const dragging=useRef(false)
  const dragged=useRef(false)
  const base=useRef(new THREE.Vector3(...node.position))
  const dragStart=useRef(new THREE.Vector3())
  const plane=useMemo(()=>new THREE.Plane(),[])
  const worldPoint=useMemo(()=>new THREE.Vector3(),[])
  const planeNormal=useMemo(()=>new THREE.Vector3(0,0,1),[])
  const {camera,pointer,raycaster}=useThree()
  const isGoal=node.kind==='goal'

  useEffect(()=>{if(!dragging.current)base.current.set(...node.position)},[node.position])

  useFrame(({clock})=>{
    if(!group.current)return
    if(dragging.current&&group.current.parent){
      plane.set(planeNormal,0).applyMatrix4(group.current.parent.matrixWorld)
      raycaster.setFromCamera(pointer,camera)
      if(raycaster.ray.intersectPlane(plane,worldPoint)){
        const local=group.current.parent.worldToLocal(worldPoint.clone())
        local.z=0
        if(local.distanceTo(dragStart.current)>.025)dragged.current=true
        base.current.copy(local)
        group.current.position.copy(local)
        onMove([local.x,local.y,0])
      }
      return
    }
    const t=clock.getElapsedTime()
    const target=selected?1.40:hovered?1.22:active?1.12:1
    if(!motionEnabled){
      group.current.scale.setScalar(target)
      group.current.position.set(base.current.x,base.current.y,base.current.z)
      return
    }
    const s=THREE.MathUtils.lerp(group.current.scale.x,target,.10)
    group.current.scale.setScalar(s)
    group.current.position.x=base.current.x
    group.current.position.y=base.current.y+Math.sin(t*.42+(hash(node.id)%37))*0.018
  })

  const hot=selected||hovered||active||isGoal
  const nodeColor=isGoal?'#e1262d':hot?'#eeeeef':node.kind==='folder'?'#9b9da4':'#747780'
  const opacity=dim&&!hot?.13:1
  const radius=isGoal?.115:node.kind==='folder'?.075:.048
  const startDrag=(event:ThreeEvent<PointerEvent>)=>{
    event.stopPropagation()
    dragging.current=true
    dragged.current=false
    dragStart.current.copy(base.current)
    ;(event.nativeEvent.target as HTMLElement).setPointerCapture(event.pointerId)
    onDragChange(true)
  }
  const stopDrag=(event:ThreeEvent<PointerEvent>)=>{
    event.stopPropagation()
    dragging.current=false
    ;(event.nativeEvent.target as HTMLElement).releasePointerCapture(event.pointerId)
    onDragChange(false)
  }

  return <group ref={group} position={node.position}>
    <NodeHalo selected={selected} active={active} motionEnabled={motionEnabled}/>
    {isGoal&&<mesh scale={2.4}><sphereGeometry args={[radius,24,24]}/><meshBasicMaterial color="#d51f25" transparent opacity={.055} depthWrite={false}/></mesh>}
    <mesh>
      <sphereGeometry args={[radius,20,20]}/>
      <meshBasicMaterial color={nodeColor} transparent opacity={opacity}/>
    </mesh>
    <mesh onPointerDown={startDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag} onClick={(event)=>{event.stopPropagation();if(dragged.current){dragged.current=false;return}onSelect()}} onPointerOver={(event)=>{event.stopPropagation();onHover(true)}} onPointerOut={()=>{if(!dragging.current)onHover(false)}}>
      <sphereGeometry args={[Math.max(radius*2.2,.13),16,16]}/>
      <meshBasicMaterial transparent opacity={0} depthWrite={false}/>
    </mesh>
    {!dim&&<Html position={[0,radius+.10,0]} center>
      <span className={`graph-node-label ${selected?'selected':hovered?'hovered':'quiet'}`}><i data-kind={node.kind}/>{node.label}</span>
    </Html>}
  </group>
}

function buildCurve(a:PositionedNode,b:PositionedNode,index:number){
  const start=new THREE.Vector3(...a.position)
  const end=new THREE.Vector3(...b.position)
  const mid=start.clone().add(end).multiplyScalar(.5)
  const delta=end.clone().sub(start)
  const perpendicular=new THREE.Vector3(-delta.y,delta.x,0).normalize().multiplyScalar(.025+((hash(`${a.id}:${b.id}:${index}`)%100)/100)*.055)
  mid.add(perpendicular)
  mid.z=-.01
  return new THREE.QuadraticBezierCurve3(start,mid,end)
}

function Edge({a,b,edge,hot,dim,index,motionEnabled}:{a:PositionedNode;b:PositionedNode;edge:WorkspaceGraphEdge;hot:boolean;dim:boolean;index:number;motionEnabled:boolean}){
  const curve=useMemo(()=>buildCurve(a,b,index),[a,b,index])
  const pulse=useRef<THREE.Mesh>(null)
  useFrame(({clock})=>{
    if(!pulse.current||!motionEnabled)return
    pulse.current.position.copy(curve.getPointAt((clock.getElapsedTime()*(hot?.16:.055)+index*.071)%1))
  })
  return <>
    <mesh>
      <tubeGeometry args={[curve,18,hot?.0038:.0017,4,false]}/>
      <meshBasicMaterial color={hot?'#d92b31':'#777980'} transparent opacity={dim?.015:hot?.62:.18}/>
    </mesh>
    {hot&&!dim&&motionEnabled&&<mesh ref={pulse}>
      <sphereGeometry args={[.022,10,10]}/><meshBasicMaterial color="#ff5a55"/>
    </mesh>}
  </>
}

function CursorRig({children,motionEnabled}:{children:ReactNode;motionEnabled:boolean}){
  const ref=useRef<THREE.Group>(null)
  useFrame(({pointer})=>{
    if(!ref.current)return
    if(!motionEnabled)return
    const x=-pointer.y*.075
    const y=pointer.x*.095
    ref.current.rotation.x=THREE.MathUtils.lerp(ref.current.rotation.x,x,.055)
    ref.current.rotation.y=THREE.MathUtils.lerp(ref.current.rotation.y,y,.055)
  })
  return <group ref={ref}>{children}</group>
}

function Scene({nodes,edges,selected,setSelected,hovered,setHovered,onNodeMove,draggingNode,setDraggingNode,focusWorking,query,relation,motionEnabled}:{nodes:PositionedNode[];edges:WorkspaceGraphEdge[];selected:string|null;setSelected:(v:string)=>void;hovered:string|null;setHovered:(v:string|null)=>void;onNodeMove:(id:string,position:[number,number,number])=>void;draggingNode:string|null;setDraggingNode:(id:string|null)=>void;focusWorking:boolean;query:string;relation:'all'|GraphRelation;motionEnabled:boolean}){
  const activeFiles=useEdithStore((s)=>s.activeFiles)
  const q=query.trim().toLowerCase()
  const nodeMap=useMemo(()=>new Map(nodes.map((n)=>[n.id,n])),[nodes])
  const relevantEdges=edges.filter((e)=>relation==='all'||e.relation===relation).filter((e)=>nodeMap.has(e.source)&&nodeMap.has(e.target))
  const activeSet=new Set([...activeFiles,'__goal__'])
  const connectedSet=useMemo(()=>{
    const set=new Set<string>()
    if(selected){
      set.add(selected)
      relevantEdges.forEach((e)=>{if(e.source===selected)set.add(e.target);if(e.target===selected)set.add(e.source)})
    }
    return set
  },[selected,relevantEdges])

  return <>
    <CursorRig motionEnabled={motionEnabled&&!draggingNode}>
      {relevantEdges.map((edge,index)=>{
        const a=nodeMap.get(edge.source)!,b=nodeMap.get(edge.target)!
        const qDim=!!q&&!a.label.toLowerCase().includes(q)&&!b.label.toLowerCase().includes(q)
        const active=activeSet.has(a.path||a.id)||activeSet.has(b.path||b.id)||edge.source==='__goal__'
        const selectedRelated=selected?connectedSet.has(a.id)&&connectedSet.has(b.id):false
        const dim=(focusWorking&&!active&&!selectedRelated)||qDim
        return <Edge key={edge.id} a={a} b={b} edge={edge} hot={active||selectedRelated} dim={dim} index={index} motionEnabled={motionEnabled}/>
      })}
      {nodes.map((node)=>{
        const match=!!q&&(node.label.toLowerCase().includes(q)||(node.path||'').toLowerCase().includes(q))
        const active=activeSet.has(node.path||node.id)
        const related=selected?connectedSet.has(node.id):false
        const dim=(focusWorking&&!active&&!related)||(!!q&&!match)
        return <GraphNode key={node.id} node={node} selected={selected===node.id} hovered={hovered===node.id} onSelect={()=>setSelected(node.id)} onHover={(v)=>setHovered(v?node.id:null)} onMove={(position)=>onNodeMove(node.id,position)} onDragChange={(dragging)=>setDraggingNode(dragging?node.id:null)} dim={dim} active={active} motionEnabled={motionEnabled}/>
      })}
    </CursorRig>
    <OrbitControls enabled={!draggingNode} enableRotate enablePan enableDamping dampingFactor={.08} minZoom={65} maxZoom={210} zoomSpeed={.72} rotateSpeed={.42} minPolarAngle={Math.PI*.34} maxPolarAngle={Math.PI*.66}/>
  </>
}

const relationLabels:Array<{id:'all'|GraphRelation;label:string}>=[
  {id:'all',label:'All'},
  {id:'contains',label:'Contains'},
  {id:'imports',label:'Imports'},
  {id:'references',label:'References'},
  {id:'depends_on',label:'Depends'},
  {id:'related_to',label:'Related'},
  {id:'used_by',label:'Used by'},
]

function KindIcon({kind}:{kind:GraphNodeKind}){
  if(kind==='folder')return <Box size={14}/>
  if(kind==='goal')return <Target size={14}/>
  if(kind==='task')return <Workflow size={14}/>
  if(kind==='memory')return <Brain size={14}/>
  return <FileCode2 size={14}/>
}

export function GraphView(){
  const reducedMotion=useReducedMotion()
  const baseNodes=useEdithStore((s)=>s.graphNodes)
  const baseEdges=useEdithStore((s)=>s.graphEdges)
  const activeFiles=useEdithStore((s)=>s.activeFiles)
  const goal=useEdithStore((s)=>s.currentGoal)
  const workspace=useEdithStore((s)=>s.currentWorkspace)
  const [selected,setSelected]=useState<string|null>(null)
  const [hovered,setHovered]=useState<string|null>(null)
  const [focus,setFocus]=useState(false)
  const [query,setQuery]=useState('')
  const [relation,setRelation]=useState<'all'|GraphRelation>('all')
  const [motionOverride,setMotionOverride]=useState<boolean|null>(null)
  const [draggingNode,setDraggingNode]=useState<string|null>(null)
  const [nodePositions,setNodePositions]=useState<Record<string,[number,number,number]>>({})
  const motionEnabled=motionOverride??!reducedMotion
  const baseLayout=useMemo(()=>buildLayout(baseNodes,baseEdges,goal,activeFiles),[baseNodes,baseEdges,goal,activeFiles])
  const layout=useMemo(()=>({...baseLayout,nodes:baseLayout.nodes.map((node)=>nodePositions[node.id]?{...node,position:nodePositions[node.id]}:node)}),[baseLayout,nodePositions])
  const item=layout.nodes.find((n)=>n.id===selected)
  const connections=item?layout.edges.filter((edge)=>(relation==='all'||edge.relation===relation)&&(edge.source===item.id||edge.target===item.id)).slice(0,6):[]

  return <div className="standard-view graph-view premium-graph-view igloo-graph-view">
    <header className="view-head graph-head">
      <div><span className="eyebrow">WORKSPACE TOPOLOGY</span><h1>Context map</h1><p>{workspace?.name} · {baseNodes.length} nodes · {baseEdges.length} relationships</p></div>
      <div className="graph-tools">
        <div className="compact-search"><Search size={14}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Find a node"/></div>
        <button type="button" aria-pressed={focus} className={focus?'tool-toggle active':'tool-toggle'} onClick={()=>setFocus(!focus)}><SlidersHorizontal size={14}/>Working set</button>
        <button type="button" aria-pressed={motionEnabled} className={motionEnabled?'tool-toggle active':'tool-toggle'} onClick={()=>setMotionOverride(!motionEnabled)}>{motionEnabled?<Pause size={13}/>:<Play size={13}/>}Motion</button>
      </div>
    </header>

    <div className={`graph-stage premium-graph-stage igloo-graph-stage ${draggingNode?'dragging-node':''}`} aria-label="Interactive three-dimensional workspace relationship graph">
      <div className="graph-soft-light"/>
      <Canvas orthographic aria-label="Workspace topology" camera={{position:[0,0,8],zoom:110}} dpr={[1,1.7]} performance={{min:.55}} onPointerMissed={()=>setSelected(null)} gl={{antialias:true,alpha:true,powerPreference:'high-performance'}} onCreated={({gl})=>{gl.toneMapping=THREE.ACESFilmicToneMapping;gl.toneMappingExposure=1.05}}>
        <Scene nodes={layout.nodes} edges={layout.edges} selected={selected} setSelected={setSelected} hovered={hovered} setHovered={setHovered} onNodeMove={(id,position)=>setNodePositions((current)=>({...current,[id]:position}))} draggingNode={draggingNode} setDraggingNode={setDraggingNode} focusWorking={focus} query={query} relation={relation} motionEnabled={motionEnabled}/>
      </Canvas>

      <div className="graph-relation-bar">
        <GitBranch size={12}/><label htmlFor="relation-filter">Show</label><select id="relation-filter" value={relation} onChange={(event)=>setRelation(event.target.value as 'all'|GraphRelation)}>{relationLabels.map((r)=><option key={r.id} value={r.id}>{r.label} relationships</option>)}</select>
      </div>
      <div className="graph-legend dynamic"><span><i className="node-red"/>EDITH</span><span><i/>Workspace</span><span className="graph-hint">Drag a node to move · drag space to rotate · scroll to zoom</span></div>
      <div className="graph-quick-actions">
        <button onClick={()=>setSelected('__goal__')} title="Select EDITH"><Crosshair size={14}/></button>
        <button onClick={()=>{setSelected(null);setQuery('');setRelation('all');setNodePositions({})}} title="Reset graph"><RotateCcw size={14}/></button>
      </div>

      {item&&<div className="graph-detail rich premium-graph-detail igloo-graph-detail">
        <small>Selected</small>
        <div className="graph-detail-title"><span><KindIcon kind={item.kind}/></span><div><strong>{item.label}</strong><em>{item.kind}</em></div></div>
        {item.path&&<code>{item.path}</code>}
        <div className="graph-connection-list"><small>Connections</small>{connections.length?connections.map((edge)=>{
          const otherId=edge.source===item.id?edge.target:edge.source
          const other=layout.nodes.find((n)=>n.id===otherId)
           return <button key={edge.id} onClick={()=>setSelected(otherId)}><span>{edge.relation.replace('_',' ')}</span><b>{other?.label||otherId}</b></button>
        }):<p>No direct relationships in this filter.</p>}</div>
      </div>}
    </div>
  </div>
}
