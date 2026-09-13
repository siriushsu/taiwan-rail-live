import * as THREE from '../vendor/three.module.js';
import {createKit,straightPath,smooth} from './new-scene-kit.js';
import {crossingState} from './crossing-cycle.js';
export function createScene(){
 const k=createKit(),{group,mat,block,beam,mesh,props,part}=k,path=straightPath(.36),asphalt=mat('#6c7470'),white=mat('#e5e1cf'),yellow=mat('#dfb943'),dark=mat('#333d40'),concrete=mat('#bab5a3');
 k.slab('#665440',76,46,-1.35,.35,5);k.slab('#b49c75',75.6,45.6,-1,.6,5);k.slab('#95a078',75,45,-.4,.4,5);
 block(asphalt,[6.8,34,.14],[0,0,.07]);for(const x of [-3.8,3.8])block(concrete,[.7,34,.18],[x,0,.09]);
 for(const y of [-12,-9,-6,6,9]){block(yellow,[.06,1.5,.02],[-.10,y,.155]);block(yellow,[.06,1.5,.02],[.10,y,.155]);}
 for(const side of [-1,1]){block(white,[2.65,.20,.02],[-side*1.6,side*4.2,.155]);for(let i=0;i<5;i++)block(white,[.34,1.2,.02],[-2.3+i*.95,side*11,.155]);}
 k.track(path,true);
 for(const y of [-.89,0,.89])block(mat('#656966'),[6.9,.71,.21],[0,y,.20]);
 // 兩側橡膠鋪面之間保留鋼軌與輪緣槽，路面到軌面有平緩坡面。
 for(const side of [-1,1])block(asphalt,[6.8,2,.14],[0,side*2.05,.14],[side*-.06,0,0]);
 // 黃色禁停網線略高於路面，避免共面閃動。
 for(let x=-2.8;x<3;x+=1.05)for(const side of [-1,1])beam(yellow,[x,-3.0,.23],[Math.min(3.2,x+1.5),-1.7,.23],.04);
 for(const x of [-16,-10,10,16])props.townhouse(x,8,.0,{floors:x===10?3:2,width:4,depth:4,tint:Math.abs(x)%5,back:true,ground:'shop',roof:x<0?'tin':'parapet'});
 for(const x of [-19,13])props.farmhouse(x,-9,0,{width:4,depth:3,tint:2});
 for(const x of [-29,-23,22,28])for(const y of [-8,9,24])props.broadleaf(x,y,0,2.6);
 for(let i=0;i<65;i++){const x=-31+k.rand()*62,y=14+k.rand()*12;if(Math.abs(y-18)<2.5)continue;props.bush(x,y,0,.4+k.rand()*.3);}
 for(const [x,y]of [[-5,-9],[5,7],[-14,5],[16,5]])k.lamp(x,y,0,4.1);
 for(const x of [-21,-7,7,21]){props.pole(x,2.3,0,4.3);if(x<21)beam(dark,[x,2.3,4.25],[x+14,2.3,4.25],.025);}
 k.label('慢 慢 等',-10,5.86,2.1,2.5,.6);
 const gates=[],lamps=[],redLights=[];
 for(const side of [-1,1]){
  const x=side*3.25,y=-side*3.1,pole=new THREE.Group();pole.position.set(x,y,.18);group.add(pole);
  part(pole,concrete,[.62,.62,.32],[0,0,.12]);part(pole,dark,[.16,.16,3.0],[0,0,1.6]);
  for(let z=.4;z<2.0;z+=.35)part(pole,yellow,[.175,.175,.17],[0,0,z]);
  // 警示十字、雙面紅燈、鐘罩及獨立緊急按鈕箱。
  for(const angle of [-.65,.65])part(pole,white,[1.3,.09,.17],[0,0,3.0],[0,angle,0]);
  for(const dx of [-.37,.37])for(const face of [-1,1]){part(pole,dark,[.26,.26,.13],[dx,face*.08,2.35],[Math.PI/2,0,0],k.cylinder);const m=mat(dx>0?'#ff3323':'#ff3423',{emissive:'#ff2516',emissiveIntensity:0,roughness:.4});const lamp=part(pole,m,[.18,.18,.035],[dx,face*.225,2.35],[Math.PI/2,0,0],k.cylinder);lamp.castShadow=lamp.receiveShadow=false;lamps.push({m,index:dx>0?1:0});}
  part(pole,dark,[.26,.24,.18],[0,0,2.67],[0,0,0],k.ball);part(pole,mat('#d5b263'),[.35,.25,.46],[0,0,.8]);part(pole,mat('#bb3f2d'),[.10,.04,.10],[0,-.15,.84]);
  const glow=new THREE.PointLight('#ff4631',0,3.5,2);glow.position.set(x,y,2);group.add(glow);redLights.push(glow);
  const pivot=new THREE.Group();pivot.position.z=1.15;pole.add(pivot);const arm=new THREE.Group();arm.rotation.z=side>0?Math.PI:0;pivot.add(arm);
  for(let i=0;i<10;i++)part(arm,i%2?yellow:dark,[.31,.11,.12],[.18+i*.31,0,0]);
  const tip=part(arm,mat('#eee6c8',{emissive:'#ff5830'}),[.12,.14,.15],[3.12,0,0]);k.glowing.push(tip.material);gates.push({pivot,side});
 }
 function vehicle(type,color,x,y,dir=1){const g=new THREE.Group();g.position.set(x,y,.18);g.rotation.z=dir<0?Math.PI:0;group.add(g);const body=mat(color,{metalness:.15,roughness:.4}),glass=mat('#426272',{metalness:.3,roughness:.2}),head=mat('#fff0d1',{emissive:'#ffe0a4'}),tail=mat('#ad3028',{emissive:'#ff3220'});k.glowing.push(head,tail);const bike=type==='scooter',L=bike?1.2:2.7,W=bike?.55:1.35;
  part(g,body,[W,L,bike?.48:.55],[0,0,bike?.48:.6]);part(g,glass,[W*.83,L*.46,bike?.1:.58],[0,-.10,bike?.65:1.13]);if(!bike)part(g,body,[W*.89,L*.50,.08],[0,-.1,1.46]);
  for(const axle of [-1,1])for(const side of bike?[0]:[-1,1])part(g,dark,[.24,.24,.16],[side*W*.48,axle*L*.32,.26],[0,Math.PI/2,0],k.cylinder);
  for(const side of bike?[0]:[-1,1]){part(g,head,[.22,.035,.15],[side*W*.33,L/2+.021,.62]);part(g,tail,[.20,.035,.12],[side*W*.33,-L/2-.021,.58]);}
  if(bike){part(g,mat('#537b84'),[.34,.28,.5],[0,0,1.02]);part(g,mat('#ddd9c5'),[.22,.23,.23],[0,.03,1.48],[0,0,0],k.ball);part(g,dark,[.57,.07,.05],[0,.41,.96]);}else{part(g,white,[.37,.04,.12],[0,L/2+.023,.34]);for(const side of [-1,1])part(g,body,[.12,.19,.10],[side*(W/2+.05),.40,1.06]);}
  let light;if(!bike){light=new THREE.SpotLight('#ffdfa5',0,10,Math.PI/7,.8,2);light.position.set(0,L/2+.1,.65);light.target.position.set(0,L/2+8,-.1);g.add(light,light.target);}
  const carMaterials=new Map(),clips=[new THREE.Plane(new THREE.Vector3(0,1,0),17),new THREE.Plane(new THREE.Vector3(0,-1,0),17)];g.traverse(o=>{if(!o.isMesh)return;if(!carMaterials.has(o.material)){const m=k.ownMaterial(o.material.clone());m.clippingPlanes=clips;m.clipShadows=true;carMaterials.set(o.material,m);}o.material=carMaterials.get(o.material);});k.glowing.push(carMaterials.get(head),carMaterials.get(tail));
  return{g,L,initial:y,dir,light,tail:carMaterials.get(tail)};
 }
 const cars=[vehicle('car','#e6d8b7',1.65,-6.4,1),vehicle('scooter','#7c9b9a',2.4,-9.4,1),vehicle('car','#577c95',1.55,-12,1),vehicle('car','#b75540',-1.65,6.4,-1),vehicle('scooter','#d4b054',-2.35,9.4,-1),vehicle('car','#e5dfcf',-1.6,12,-1)];
 for(const [x,y,c]of [[-4.2,-7,'#d4a655'],[4.2,5.8,'#b9705a'],[-5.2,6,'#728e9d']])k.person(x,y,.18,{color:c,angle:Math.PI/2,hat:true});
 // 日常細節：田畦、矮圍籬、排水溝、街屋門口植栽，保留主線視野。
 for(const x of [-18,-9,9,18]){block(mat('#7c955f'),[6,4,.05],[x,23,.025]);for(let row=0;row<6;row++)block(mat('#a5ad70'),[5.7,.09,.09],[x,21.4+row*.58,.08]);}
 for(const x of [-4.25,4.25]){block(mat('#6d766a'),[.18,25,.035],[x,-2,.025]);for(let y=-13;y<10;y+=.65)block(dark,[.20,.025,.04],[x,y,.05]);}
 for(const side of [-1,1])for(let x=7;x<22;x+=.8){block(concrete,[.08,.08,.65],[side*x,-4,.33]);if(x<21)block(white,[.8,.06,.06],[side*(x+.4),-4,.57]);}
 for(const x of [-17,-14,9,13,18]){block(mat('#95674c'),[.38,.38,.45],[x,5.55,.22]);props.bush(x,5.55,.43,.4);}
 const wire=new THREE.Group();group.add(wire);for(let x=-28;x<=28;x+=14){part(wire,dark,[.1,.1,3.4],[x,1.6,1.7]);part(wire,dark,[.08,1.8,.08],[x,.8,3.35]);}part(wire,dark,[61,.025,.025],[0,0,3.25]);
 k.bake();let state={};return{...k,path,kind:'crossing',focus:[0,5,1],update(time,period,train){const f=k.illumination(period),s=crossingState(train.distance,train.length,path.length,train.speed);for(const {pivot,side}of gates)pivot.rotation.y=side*(1-s.closed)*Math.PI/2;
  for(const l of redLights)l.intensity=s.alarm?(f?2.5:.4):0;const blink=Math.floor(time*2.2)%2;for(const {m,index}of lamps){const on=s.alarm&&blink===index;m.emissiveIntensity=on?3:0;m.color.set(on?'#ff5943':'#551c19');}
  // 車流只在全開後通行；下一次警示前回到入口，所有回繞都在道路邊界。
  const span=38,openStart=3.2,openDuration=(path.length-train.length-7)/train.speed-9.2;
  const openElapsed=s.clear>=openStart?s.clear-openStart:s.clear+path.length/train.speed-openStart;
  cars.forEach((c,i)=>{let y=c.initial;if(!s.alarm&&s.closed===0&&openElapsed<openDuration){const t=Math.max(0,openElapsed-Math.floor(i/3)*.5-(i%3)*1.25),d=t*3.2;const progress=d%span;y=c.initial+c.dir*progress;if(c.dir*y>19)y-=c.dir*span; // 回到邊界後向停止線前進並停等
   if(d>=span)y=c.initial;
  }c.g.position.y=y;c.g.visible=Math.abs(y)<17+c.L/2+.2;c.g.position.z=.18+.12*smooth((2.8-Math.abs(y))/1.4);if(c.light)c.light.intensity=f*16;c.tail.emissiveIntensity=s.alarm?1.1:f*.5;});
  wire.visible=train.id==='emu3000';state={...s,lights:f,vehicles:cars.map(c=>({x:c.g.position.x,y:c.g.position.y,length:c.L,dir:c.dir})),gates:gates.map(g=>g.pivot.rotation.y),flashes:lamps.map(l=>l.m.emissiveIntensity),electrified:wire.visible};},get state(){return state;}};
}
