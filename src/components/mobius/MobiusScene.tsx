import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Float, Sparkles } from '@react-three/drei'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { AgentState } from '../../lib/types'

const profiles: Record<AgentState,{rotation:number;signal:number;float:number;particles:number}> = {
  idle:{rotation:.055,signal:.050,float:.22,particles:34},
  planning:{rotation:.085,signal:.090,float:.30,particles:46},
  waiting_approval:{rotation:.028,signal:.028,float:.10,particles:22},
  executing:{rotation:.125,signal:.145,float:.38,particles:58},
  verifying:{rotation:.155,signal:.185,float:.42,particles:66},
  success:{rotation:.048,signal:.060,float:.18,particles:36},
  failed:{rotation:.018,signal:.018,float:.07,particles:18},
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

function buildClosedMobius(segments=320,widthSegments=48){
  const halfWidth=.52
  const positions:number[]=[]
  const uvs:number[]=[]
  const indices:number[]=[]

  for(let i=0;i<segments;i++){
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
    const next=(i+1)%segments
    const flips=i===segments-1
    for(let j=0;j<widthSegments;j++){
      const a=i*(widthSegments+1)+j
      const d=i*(widthSegments+1)+j+1
      const nextJ=flips?widthSegments-j:j
      const nextJ1=flips?widthSegments-j-1:j+1
      const b=next*(widthSegments+1)+nextJ
      const c=next*(widthSegments+1)+nextJ1
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

function makeSurfaceCurve(kind:'energy'|'rim'){
  const points:THREE.Vector3[]=[]
  const samples=420
  for(let i=0;i<samples;i++){
    const u=(i/samples)*Math.PI*4
    const v=kind==='rim'?.525:.34*Math.sin(u*.5)
    const p=mobiusPoint(u,v)
    points.push(p.multiplyScalar(kind==='rim'?1.004:1.012))
  }
  return new THREE.CatmullRomCurve3(points,true,'centripetal',.35)
}

function SculpturalStrip({state}:{state:AgentState}){
  const group=useRef<THREE.Group>(null)
  const strip=useRef<THREE.MeshPhysicalMaterial>(null)
  const glass=useRef<THREE.MeshPhysicalMaterial>(null)
  const geometry=useMemo(()=>buildClosedMobius(),[])
  const profile=profiles[state]

  useFrame(({clock,pointer},delta)=>{
    if(!group.current)return
    const t=clock.getElapsedTime()
    group.current.rotation.y+=delta*profile.rotation
    group.current.rotation.x=THREE.MathUtils.lerp(group.current.rotation.x,.42+pointer.y*.08+Math.sin(t*.24)*.025,.035)
    group.current.rotation.z=THREE.MathUtils.lerp(group.current.rotation.z,-.10-pointer.x*.065,.035)
    const breath=1+Math.sin(t*.82)*.006
    group.current.scale.setScalar(breath)
    if(strip.current){
      const target=state==='success'?'#d9e4dc':state==='failed'?'#68686c':'#d7d7d9'
      strip.current.color.lerp(new THREE.Color(target),.035)
      strip.current.emissiveIntensity=state==='executing'||state==='verifying'?.055:.018
    }
    if(glass.current)glass.current.opacity=THREE.MathUtils.lerp(glass.current.opacity,state==='executing'||state==='verifying'?.22:.14,.035)
  })

  return <group ref={group}>
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshPhysicalMaterial
        ref={strip}
        color="#d7d7d9"
        emissive="#3e0c0e"
        emissiveIntensity={.018}
        metalness={.72}
        roughness={.24}
        clearcoat={1}
        clearcoatRoughness={.09}
        sheen={.18}
        sheenColor="#ffffff"
        side={THREE.DoubleSide}
      />
    </mesh>
    <mesh geometry={geometry} scale={1.012}>
      <meshPhysicalMaterial
        ref={glass}
        color="#ffffff"
        metalness={.04}
        roughness={.08}
        clearcoat={1}
        clearcoatRoughness={.04}
        transmission={.08}
        thickness={.25}
        transparent
        opacity={.14}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  </group>
}

function SignalPath({state}:{state:AgentState}){
  const profile=profiles[state]
  const curve=useMemo(()=>makeSurfaceCurve('energy'),[])
  const rimCurve=useMemo(()=>makeSurfaceCurve('rim'),[])
  const packets=useRef<THREE.InstancedMesh>(null)
  const dummy=useMemo(()=>new THREE.Object3D(),[])
  const count=14

  useFrame(({clock})=>{
    if(!packets.current)return
    const t=clock.getElapsedTime()
    for(let i=0;i<count;i++){
      const progress=(t*profile.signal+i/count)%1
      const p=curve.getPointAt(progress)
      const scale=i%4===0?.034:.021
      dummy.position.copy(p)
      dummy.scale.setScalar(scale*(.9+Math.sin(t*2+i)*.1))
      dummy.updateMatrix()
      packets.current.setMatrixAt(i,dummy.matrix)
    }
    packets.current.instanceMatrix.needsUpdate=true
  })

  const signalColor=state==='success'?'#bfe6cb':state==='waiting_approval'?'#f0b85a':state==='failed'?'#7e2225':'#ff3535'
  const intensity=state==='executing'||state==='verifying'?.92:state==='planning'?.70:.54

  return <>
    <mesh>
      <tubeGeometry args={[curve,300,.018,10,true]}/>
      <meshPhysicalMaterial color={signalColor} emissive={signalColor} emissiveIntensity={1.1} metalness={.18} roughness={.16} transparent opacity={intensity}/>
    </mesh>
    <mesh>
      <tubeGeometry args={[rimCurve,360,.008,7,true]}/>
      <meshBasicMaterial color="#ffffff" transparent opacity={.24}/>
    </mesh>
    <instancedMesh ref={packets} args={[undefined,undefined,count]}>
      <sphereGeometry args={[1,12,12]}/>
      <meshBasicMaterial color={signalColor} transparent opacity={.95}/>
    </instancedMesh>
  </>
}

function SoftOrbit({state}:{state:AgentState}){
  const ref=useRef<THREE.Group>(null)
  const speed=profiles[state].rotation
  useFrame(({clock},delta)=>{
    if(!ref.current)return
    ref.current.rotation.z+=delta*speed*.22
    ref.current.rotation.x=.86+Math.sin(clock.getElapsedTime()*.18)*.04
  })
  return <group ref={ref}>
    <mesh rotation={[Math.PI/2,0,0]}>
      <torusGeometry args={[2.52,.006,8,220]}/>
      <meshBasicMaterial color="#ffffff" transparent opacity={.07}/>
    </mesh>
    <mesh rotation={[Math.PI/2,.6,0]}>
      <torusGeometry args={[2.22,.0035,8,220]}/>
      <meshBasicMaterial color="#ff3b30" transparent opacity={.085}/>
    </mesh>
  </group>
}

function CoreAssembly({state}:{state:AgentState}){
  return <Float speed={profiles[state].float} rotationIntensity={.08} floatIntensity={.10} floatingRange={[-.035,.035]}>
    <group>
      <SculpturalStrip state={state}/>
      <SignalPath state={state}/>
      <SoftOrbit state={state}/>
    </group>
  </Float>
}

function CameraEase({dimmed}:{dimmed:boolean}){
  const {camera,pointer}=useThree()
  useFrame(()=>{
    const x=pointer.x*(dimmed?.10:.18)
    const y=pointer.y*(dimmed?.07:.12)
    camera.position.x=THREE.MathUtils.lerp(camera.position.x,x,.025)
    camera.position.y=THREE.MathUtils.lerp(camera.position.y,y,.025)
    camera.lookAt(0,0,0)
  })
  return null
}

export function MobiusScene({state,dimmed=false}:{state:AgentState;dimmed?:boolean}){
  const profile=profiles[state]
  return <div className={dimmed?'mobius-canvas dimmed':'mobius-canvas'} data-state={state}>
    <div className="mobius-ambient" aria-hidden="true"><span/><span/></div>
    <Canvas
      camera={{position:[0,.06,6.45],fov:34}}
      dpr={[1,1.8]}
      gl={{antialias:true,alpha:true,powerPreference:'high-performance'}} onCreated={({gl})=>{gl.toneMapping=THREE.ACESFilmicToneMapping;gl.toneMappingExposure=1.05}}
      shadows
    >
      <CameraEase dimmed={dimmed}/>
      <fog attach="fog" args={['#0c0c0e',6.2,11]}/>
      <ambientLight intensity={.52}/>
      <hemisphereLight args={['#ffffff','#18181b',1.45]}/>
      <directionalLight position={[3.4,4.8,5.5]} intensity={4.2} color="#ffffff" castShadow/>
      <directionalLight position={[-4,-1.5,3]} intensity={1.6} color="#8d8d93"/>
      <pointLight position={[3.2,.4,2.8]} intensity={state==='verifying'?6.5:4.4} color="#ff3934" distance={9}/>
      <CoreAssembly state={state}/>
      <Sparkles count={profile.particles} scale={[5.8,4.3,3.2]} size={.45} speed={profile.float*.45} opacity={dimmed?.08:.18} color="#d6d6d8"/>
      <ContactShadows position={[0,-1.62,0]} opacity={.30} scale={5.4} blur={3.2} far={4.5}/>
    </Canvas>
  </div>
}
