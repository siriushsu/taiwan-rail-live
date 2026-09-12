// 發光角色來自 Blender 原生部件；不按顏色猜測，避免白車殼或駕駛前窗發亮。
export function createTrainLights(cars){
 const cloned=[],rows=[];
 for(const [index,c] of cars.entries()){
  c.litMaterials=c.asset.materials.map(m=>{
   const role=m.userData.railLightingRole;
   if(!role)return m;
   const copy=m.clone();cloned.push(copy);rows.push({index,flip:c.flip,role,material:copy});return copy;
  });
  c.body.material=c.litMaterials;
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
 }
 return{update,get state(){return {...snapshot};},dispose(){cloned.forEach(m=>m.dispose());}};
}
