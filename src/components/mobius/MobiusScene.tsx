import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Float } from '@react-three/drei'
import { useMotionPreference } from '../ui/useMotionPreference'
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import type { AgentState } from '../../lib/types'

const profiles: Record<AgentState,{rotation:number;float:number}> = {
  idle:{rotation:.14,float:.42},
  planning:{rotation:.18,float:.50},
  waiting_approval:{rotation:.020,float:.08},
  executing:{rotation:.22,float:.58},
  verifying:{rotation:.26,float:.66},
  success:{rotation:.10,float:.32},
  failed:{rotation:.012,float:.05},
}

type PointerTarget=MutableRefObject<{x:number;y:number;targetX:number;targetY:number;active:number;targetActive:number}>

function useWindowPointerTarget(){
  const target=useRef({x:0,y:0,targetX:0,targetY:0,active:0,targetActive:0})

  useEffect(()=>{
    const update=(event:PointerEvent)=>{
      const width=Math.max(window.innerWidth,1)
      const height=Math.max(window.innerHeight,1)
      target.current.targetX=(event.clientX/width)*2-1
      target.current.targetY=-(event.clientY/height)*2+1
      target.current.targetActive=1
    }
    const settle=()=>{target.current.targetActive=0}
    const tick=()=>{
      target.current.x=THREE.MathUtils.lerp(target.current.x,target.current.targetX,.16)
      target.current.y=THREE.MathUtils.lerp(target.current.y,target.current.targetY,.16)
      target.current.active=THREE.MathUtils.lerp(target.current.active,target.current.targetActive,.11)
      frame=window.requestAnimationFrame(tick)
    }
    let frame=window.requestAnimationFrame(tick)

    window.addEventListener('pointermove',update,{passive:true})
    window.addEventListener('pointerover',update,{passive:true})
    window.addEventListener('pointerleave',settle)
    window.addEventListener('blur',settle)
    document.addEventListener('visibilitychange',settle)
    return()=>{
      window.cancelAnimationFrame(frame)
      window.removeEventListener('pointermove',update)
      window.removeEventListener('pointerover',update)
      window.removeEventListener('pointerleave',settle)
      window.removeEventListener('blur',settle)
      document.removeEventListener('visibilitychange',settle)
    }
  },[])

  return target
}

function mobiusPoint(u:number,v:number,radius=1.72){
  const half=u*.5
  const radial=radius+v*Math.cos(half)
  return new THREE.Vector3(
    radial*Math.cos(u),
    v*Math.sin(half),
    radial*Math.sin(u),
  )
}

function buildClosedMobius(segments=320,widthSegments=48,halfWidth=.52){
  const positions:number[]=[]
  const uvs:number[]=[]
  const indices:number[]=[]

  for(let i=0;i<=segments;i++){
    const t=i/segments
    const u=t*Math.PI*2
    for(let j=0;j<=widthSegments;j++){
      const s=j/widthSegments
      const p=mobiusPoint(u,-halfWidth+s*halfWidth*2)
      positions.push(p.x,p.y,p.z)
      uvs.push(t,s)
    }
  }

  for(let i=0;i<segments;i++){
    const next=i+1
    for(let j=0;j<widthSegments;j++){
      const a=i*(widthSegments+1)+j
      const d=i*(widthSegments+1)+j+1
      const b=next*(widthSegments+1)+j
      const c=next*(widthSegments+1)+j+1
      indices.push(a,b,d,b,c,d)
    }
  }

  const g=new THREE.BufferGeometry()
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2))
  g.setIndex(indices)
  g.computeVertexNormals()
  return g
}

function SculpturalStrip({state,pointerTarget}:{state:AgentState;pointerTarget:PointerTarget}){
  const strip=useRef<THREE.MeshPhysicalMaterial>(null)
  const geometry=useMemo(()=>buildClosedMobius(360,56),[])

  useFrame(()=>{
    const pointer=pointerTarget.current
    if(strip.current){
      const target=state==='success'?'#9eaaa2':state==='failed'?'#3d3d40':'#77787d'
      strip.current.color.lerp(new THREE.Color(target),.04)
      const baseEmissive=state==='executing'||state==='verifying'?.045:state==='planning'?.030:.012
      strip.current.emissiveIntensity=baseEmissive+pointer.active*.018
    }
  })

  return <mesh geometry={geometry} castShadow>
      <meshPhysicalMaterial
        ref={strip}
        color="#77787d"
        emissive="#4f080a"
        emissiveIntensity={.012}
        metalness={.72}
        roughness={.26}
        clearcoat={.65}
        clearcoatRoughness={.14}
        iridescence={.07}
        iridescenceIOR={1.18}
        sheen={.08}
        sheenColor="#e10600"
        sheenRoughness={.45}
        flatShading
        side={THREE.DoubleSide}
      />
    </mesh>
}

function SignalPath({state,pointerTarget}:{state:AgentState;pointerTarget:PointerTarget}){
  const geometry=useMemo(()=>buildClosedMobius(360,4,.018),[])
  const signal=useRef<THREE.MeshBasicMaterial>(null)
  const signalColor=state==='success'?'#bfe6cb':state==='waiting_approval'?'#f0b85a':state==='failed'?'#7e2225':'#ff3535'
  const intensity=state==='executing'||state==='verifying'?.88:state==='planning'?.62:.42

  useFrame(()=>{
    const pointer=pointerTarget.current
    if(signal.current)signal.current.opacity=THREE.MathUtils.lerp(signal.current.opacity,intensity+pointer.active*.10,.08)
  })

  return <mesh geometry={geometry} renderOrder={2}>
    <meshBasicMaterial ref={signal} color={signalColor} transparent opacity={intensity} polygonOffset polygonOffsetFactor={-2} side={THREE.DoubleSide}/>
  </mesh>
}

function StripRig({state,pointerTarget}:{state:AgentState;pointerTarget:PointerTarget}){
  const group=useRef<THREE.Group>(null)
  const profile=profiles[state]
  useFrame(({clock},delta)=>{
    if(!group.current)return
    const t=clock.getElapsedTime()
    const pointer=pointerTarget.current
    group.current.rotation.y+=delta*(profile.rotation+Math.abs(pointer.x)*.09+pointer.active*.045)
    group.current.rotation.x=THREE.MathUtils.lerp(group.current.rotation.x,.46+pointer.y*.36+Math.sin(t*.32)*.035,.09)
    group.current.rotation.z=THREE.MathUtils.lerp(group.current.rotation.z,-.08+pointer.x*.30,.09)
    const breath=1+Math.sin(t*1.05)*.012+pointer.active*.022
    group.current.scale.setScalar(breath)
  })
  return <group ref={group} rotation={[.46,1.45,-.08]}>
    <SculpturalStrip state={state} pointerTarget={pointerTarget}/>
    <SignalPath state={state} pointerTarget={pointerTarget}/>
  </group>
}

function CoreAssembly({state,pointerTarget}:{state:AgentState;pointerTarget:PointerTarget}){
  return <Float speed={profiles[state].float} rotationIntensity={.10} floatIntensity={.16} floatingRange={[-.06,.06]}>
    <group position={[0,.18,0]} scale={.96}>
      <mesh scale={.72}>
        <sphereGeometry args={[.72,48,48]}/>
        <meshBasicMaterial color="#c91318" transparent opacity={.025} depthWrite={false}/>
      </mesh>
      <StripRig state={state} pointerTarget={pointerTarget}/>
    </group>
  </Float>
}

function CameraEase({dimmed,pointerTarget}:{dimmed:boolean;pointerTarget:PointerTarget}){
  const {camera}=useThree()
  useFrame(()=>{
    const pointer=pointerTarget.current
    const x=pointer.x*(dimmed?.16:.38)
    const y=pointer.y*(dimmed?.10:.26)
    camera.position.x=THREE.MathUtils.lerp(camera.position.x,x,.025)
    camera.position.y=THREE.MathUtils.lerp(camera.position.y,y,.025)
    camera.position.z=THREE.MathUtils.lerp(camera.position.z,(dimmed?7.05:7.25)-pointer.active*.22,.018)
    camera.lookAt(0,.12,0)
  })
  return null
}

export function MobiusScene({state,dimmed=false}:{state:AgentState;dimmed?:boolean}){
  const pointerTarget=useWindowPointerTarget()
  const reducedMotion=useMotionPreference()
  return <div className={dimmed?'mobius-canvas dimmed':'mobius-canvas'} data-state={state}>
    <div className="mobius-ambient" aria-hidden="true"><span/><span/></div>
    <Canvas
      fallback={<div className="core-unavailable"><span className="static-core">∞</span><small>Workspace ready</small></div>}
      role="img"
      aria-label={`Animated Mobius strip showing EDITH ${state.replace('_',' ')} state`}
      frameloop={reducedMotion?'demand':'always'}
      camera={{position:[0,.08,7.0],fov:32}}
      dpr={[1,1.8]}
      performance={{min:.55}}
      gl={{antialias:true,alpha:true,powerPreference:'high-performance'}} onCreated={({gl})=>{gl.toneMapping=THREE.ACESFilmicToneMapping;gl.toneMappingExposure=1.05}}
      shadows
    >
      <CameraEase dimmed={dimmed} pointerTarget={pointerTarget}/>
      <fog attach="fog" args={['#09090b',6.5,10]}/>
      <ambientLight intensity={.28}/>
      <hemisphereLight args={['#f5f5f5','#09090b',1.1]}/>
      <directionalLight position={[3.8,5.2,5.5]} intensity={3.6} color="#ffffff" castShadow/>
      <directionalLight position={[-4,-2,2]} intensity={1.2} color="#4c4d52"/>
      <pointLight position={[2.5,.2,2.8]} intensity={state==='verifying'?4.8:3.2} color="#d61d22" distance={8}/>
      <CoreAssembly state={state} pointerTarget={pointerTarget}/>
    </Canvas>
  </div>
}
