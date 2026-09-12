import * as THREE from './vendor/three.module.js';
// 發光角色來自 Blender 原生部件；不按顏色猜測，避免白車殼或駕駛前窗發亮。
export function createTrainLights(cars){
 const cloned=[],rows=[],beams=[];
 const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d'),gradient=ctx.createRadialGradient(32,32,0,32,32,32);
 gradient.addColorStop(0,'rgba(255,255,245,1)');gradient.addColorStop(.13,'rgba(255,249,215,1)');gradient.addColorStop(.32,'rgba(255,229,159,.55)');gradient.addColorStop(1,'rgba(255,225,150,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
 const glowTexture=new THREE.CanvasTexture(canvas);glowTexture.colorSpace=THREE.SRGBColorSpace;
 const glowMaterial=new THREE.SpriteMaterial({map:glowTexture,color:0xffffff,transparent:true,blending:THREE.AdditiveBlending,depthTest:true,depthWrite:false,toneMapped:false});
 for(const [index,c] of cars.entries()){
  c.litMaterials=c.asset.materials.map(m=>{
   const role=m.userData.railLightingRole;
   if(!role)return m;
   const copy=m.clone();cloned.push(copy);rows.push({index,flip:c.flip,role,material:copy});return copy;
  });
  c.body.material=c.litMaterials;
  for(const [role,points] of Object.entries(c.asset.lighting?.headlights||{})){
   if(!points.length)continue;const end=role==='headRear'?-1:1,group=new THREE.Group();group.name='garage-headlight-'+role;group.visible=false;c.body.add(group);
   const center=new THREE.Vector3();for(const point of points){const halo=new THREE.Sprite(glowMaterial);halo.position.set(point[0]+end*.065,point[1],point[2]);halo.scale.setScalar(.55);halo.name='headlight-glow';group.add(halo);center.add(halo.position);}center.multiplyScalar(1/points.length);
   // 一端共用一道有陰影的光束；燈芯仍各自對準 Blender 燈具，避免四盞燈開四份陰影。
   const spot=new THREE.SpotLight('#fff0cb',0,13,Math.PI/7,.75,2);spot.position.copy(center);spot.target.position.set(center.x+end*14,center.y,.1);spot.castShadow=true;spot.shadow.mapSize.set(512,512);spot.shadow.bias=-.0002;spot.shadow.normalBias=.018;spot.shadow.camera.near=.05;
   group.add(spot,spot.target);beams.push({index,flip:c.flip,role,group,spot});
  }
 }
 let key='',snapshot={period:'day',direction:1,windows:0,heads:0,tails:0};
 function update(period='day',direction=1,owned=true){
  direction=direction<0?-1:1;
  const next=[period,direction,owned].join(':');if(next===key)return;key=next;
  const amount=period==='night'?1:period==='sunset'||period==='sunrise'?.35:0;
  const lead=direction>0?0:cars.length-1,tail=direction>0?cars.length-1:0;
  snapshot={period,direction,windows:0,heads:0,tails:0};
  for(const r of rows){
   const end=r.role.endsWith('Rear')?-1:1,worldEnd=end*(r.flip?-1:1);
   const window=r.role==='window',head=r.role.startsWith('head')&&(r.index===lead||cars[r.index].id==='dl38')&&worldEnd===direction;
   const rear=r.role.startsWith('tail')&&r.index===tail&&worldEnd===-direction;
   const on=owned&&amount>0&&(window||head||rear);
   r.material.emissive.set(window?'#ffe6ad':head?'#fff4da':'#ff2614');
   r.material.emissiveIntensity=on?amount*(window?.72:head?2.8:1.5):0;
   if(on)snapshot[window?'windows':head?'heads':'tails']++;
  }
  let activeBeams=0;
  for(const b of beams){const end=b.role==='headRear'?-1:1,on=owned&&amount>0&&(b.index===lead||cars[b.index].id==='dl38')&&end*(b.flip?-1:1)===direction;b.group.visible=on;b.spot.intensity=on?75*amount:0;if(on)activeBeams++;}
  snapshot.beams=activeBeams;
 }
 return{update,get state(){return {...snapshot};},dispose(){for(const b of beams){b.group.removeFromParent();b.spot.dispose();}glowMaterial.dispose();glowTexture.dispose();cloned.forEach(m=>m.dispose());}};
}
