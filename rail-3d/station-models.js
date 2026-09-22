import * as THREE from './vendor/three.module.js';

// Z 向上，以公尺建模。各材質合併網格，柱列與窗格不各佔一次 draw call。
function builder(paletteOverrides={}){
  const root=new THREE.Group(),batches=new Map(),indexedBox=new THREE.BoxGeometry(1,1,1),boxGeometry=indexedBox.toNonIndexed();indexedBox.dispose();
  const palette={stone:'#ad9478',trim:'#eee8d6',window:'#4b4e49',roof:'#ae493e',rib:'#b95749',floor:'#d6ccb6',tile:'#6d6962',inside:'#c7b498',glass:'#8faeb6',metal:'#bcc5c4',green:'#96b477',dark:'#566562',brick:'#b97759',gold:'#ccb57b',...paletteOverrides};
  let ox=0,oy=0,cos=1,sin=0;
  const point=p=>[ox+p[0]*cos-p[1]*sin,oy+p[0]*sin+p[1]*cos,p[2]];
  function frame(x,y,angle){ox=x;oy=y;cos=Math.cos(angle);sin=Math.sin(angle);}
  function batch(key,part){const id=part+'/'+key;if(!batches.has(id))batches.set(id,{part,key,vertices:[]});return batches.get(id).vertices;}
  function box(key,x,y,z,w,d,h,part='shell'){
    const pos=boxGeometry.getAttribute('position'),v=batch(key,part);
    for(let i=0;i<pos.count;i++)v.push(...point([x+pos.getX(i)*w,y+pos.getY(i)*d,z+pos.getZ(i)*h]));
  }
  function tri(key,a,b,c,part='shell'){batch(key,part).push(...point(a),...point(b),...point(c));}
  function quad(key,a,b,c,d,part='shell'){tri(key,a,b,c,part);tri(key,a,c,d,part);}
  function finish(){
    boxGeometry.dispose();
    for(const b of batches.values()){
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(b.vertices,3));g.computeVertexNormals();
      const material=new THREE.MeshLambertMaterial({color:palette[b.key],side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(g,material);mesh.name=b.part+'/'+b.key;mesh.userData.part=b.part;root.add(mesh);
    }
    return root;
  }
  return {box,tri,quad,frame,finish};
}

export function buildTaipeiMain(meta){
  const b=builder(),W=meta.footprintWidthM,D=meta.footprintDepthM,bodyW=W-10,bodyD=D-12;
  b.box('stone',0,0,-.25,W,D,1.5,'base');
  // 大廳保留空間，外殼與室內分件。室內比例僅供透視展示。
  b.box('floor',0,0,.6,bodyW-4,bodyD-4,.3,'interior');
  for(let x=-40;x<=40;x+=8)for(let y=-24;y<=24;y+=8)if((Math.round(x/8)+Math.round(y/8))%2===0)b.box('tile',x,y,.78,7.95,7.95,.05,'interior');
  for(const side of [-1,1]){
    b.box('window',0,side*(bodyD/2-1),11,bodyW-3,1,21);
    b.box('window',side*(bodyW/2-1),0,11,1,bodyD-3,21);
    for(let x=-bodyW/2+3;x<bodyW/2;x+=6.45)b.box('stone',x,side*bodyD/2,11,1.6,2.7,21);
    for(let y=-bodyD/2+3;y<bodyD/2;y+=6.45)b.box('stone',side*bodyW/2,y,11,2.7,1.6,21);
    b.box('stone',0,side*(bodyD/2-6),25.4,bodyW,13,8.5);
    b.box('stone',side*(bodyW/2-6),0,25.4,13,bodyD-26,8.5);
    // 上層深窗帶與細窗格。
    for(const z of [23.5,27]){
      b.box('window',0,side*(bodyD/2+.1),z,bodyW-3,.3,2.5);
      b.box('window',side*(bodyW/2+.1),0,z,.3,bodyD-3,2.5);
      for(let x=-bodyW/2+2;x<bodyW/2;x+=2.5)b.box('stone',x,side*(bodyD/2+.32),z,.28,.3,2.5);
      for(let y=-bodyD/2+2;y<bodyD/2;y+=2.5)b.box('stone',side*(bodyW/2+.32),y,z,.3,.28,2.5);
    }
    for(const x of [-43,0,43]){
      b.box('trim',x,side*(bodyD/2+2.4),5.4,15,6,.7);
      b.box('roof',x,side*(bodyD/2+2.4),6,13.5,5,.5);
    }
    for(const y of [-31,0,31]){
      b.box('trim',side*(bodyW/2+2.4),y,5.4,6,14,.7);
      b.box('roof',side*(bodyW/2+2.4),y,6,5,12.5,.5);
    }
    for(let x=-40;x<=40;x+=16)b.box('inside',x,side*30,10.5,1.3,1.3,19.5,'interior');
  }
  // 四面曲坡包圍中央採光區；並非把屋頂做成實心金字塔。
  const rimW=W*.57,rimD=D*.43;
  function corners(t){const w=rimW+(W-rimW)*t,d=rimD+(D-rimD)*t,z=30+18*Math.pow(1-t,2.4)+.7*Math.pow(t,10);return [[-w/2,-d/2,z],[w/2,-d/2,z],[w/2,d/2,z],[-w/2,d/2,z]];}
  const mix=(a,c,t)=>a.map((v,i)=>v+(c[i]-v)*t);
  for(let side=0;side<4;side++)for(let step=0;step<12;step++){
    const a=corners(step/12),c=corners((step+1)/12),j=(side+1)%4;
    b.quad('roof',a[side],a[j],c[j],c[side]);
    for(let r=1;r<48;r++){
      const u=r/48,v=u+.003;
      const p=[mix(a[side],a[j],u),mix(a[side],a[j],v),mix(c[side],c[j],v),mix(c[side],c[j],u)].map(q=>[q[0],q[1],q[2]+.06]);
      b.quad('rib',...p);
    }
  }
  for(const [w,d,z] of [[W,D,30.4],[rimW,rimD,48]]){
    for(const side of [-1,1]){b.box('trim',0,side*d/2,z,w+1,1.1,1.3);b.box('trim',side*w/2,0,z,1.1,d,1.3);}
  }
  // 中央天井內壁與較低的採光頂，近看可辨識環形屋頂。
  for(const side of [-1,1]){
    b.box('stone',0,side*(rimD/2-.6),40,rimW,1.2,15);
    b.box('stone',side*(rimW/2-.6),0,40,1.2,rimD,15);
  }
  b.box('glass',0,0,32,rimW-3,rimD-3,.3);
  for(let x=-rimW/2+6;x<rimW/2;x+=6)b.box('trim',x,0,32.3,.35,rimD-3,.4);
  for(let y=-rimD/2+6;y<rimD/2;y+=6)b.box('trim',0,y,32.3,rimW-3,.35,.4);
  const root=b.finish();root.name=meta.id;
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,1024,128);ctx.fillStyle='#223e65';ctx.font='bold 91px "PingFang TC",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('臺 北 車 站',512,64);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  for(const side of [-1,1]){
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(29,3.6),new THREE.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.2,side:THREE.DoubleSide}));
    sign.rotation.x=Math.PI/2;sign.rotation.y=side===1?Math.PI:0;sign.position.set(0,side*(bodyD/2+.7),25.25);sign.name='shell/sign';sign.userData.part='shell';root.add(sign);
  }
  root.rotation.z=meta.rotationDeg*Math.PI/180;
  return root;
}

export function setStationInspection(root,value){
  root.traverse(mesh=>{if(!mesh.isMesh||mesh.userData.part!=='shell')return;const m=mesh.material;
    if(m.userData.normalTransparent===undefined)m.userData.normalTransparent=m.transparent;
    m.transparent=value||m.userData.normalTransparent;m.opacity=value?.18:1;m.depthWrite=!value;m.needsUpdate=true;
  });
}

export function disposeStation(root){const geometries=new Set(),materials=new Set(),textures=new Set();root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material){materials.add(o.material);if(o.material.map)textures.add(o.material.map);}});for(const t of textures)t.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();}

// 共用構件沿各站已核對的輪廓生成；外觀高度與室內配置均是展示參數。
export function buildStation(meta,footprint){
  const b=builder(),signs=[];
  function surface(key,rings,height,part='shell',detail=false){
    const vectors=rings.map(r=>r.slice(0,-1).map(p=>new THREE.Vector2(...p))),all=vectors.flat();
    const faces=THREE.ShapeUtils.triangulateShape(vectors[0],vectors.slice(1));
    function triangle(a,c,d,level=0){
      if(detail&&level<12){const pairs=[[a,c,d],[c,d,a],[d,a,c]].sort((u,v)=>v[0].distanceToSquared(v[1])-u[0].distanceToSquared(u[1]));
        if(pairs[0][0].distanceToSquared(pairs[0][1])>400){const [p,q,r]=pairs[0],m=p.clone().add(q).multiplyScalar(.5);triangle(p,m,r,level+1);triangle(m,q,r,level+1);return;}}
      b.tri(key,...[a,c,d].map(p=>[p.x,p.y,height(p.x,p.y)]),part);
    }
    for(const f of faces)triangle(...f.map(i=>all[i]));
  }
  function inside(p,rings){let result=false;for(const ring of rings){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],c=ring[j];if((a[1]>p[1])!==(c[1]>p[1])&&p[0]<(c[0]-a[0])*(p[1]-a[1])/(c[1]-a[1])+a[0])hit=!hit;}if(hit)result=!result;}return result;}
  for(const part of meta.components){
    const f=footprint.features.find(f=>f.properties.component===part.id);if(!f)continue;
    const theta=part.rotationDeg*Math.PI/180,c=Math.cos(theta),s=Math.sin(theta),scale=111320*Math.cos(part.anchor[1]*Math.PI/180);
    const rings=f.geometry.coordinates.map(r=>r.map(([lng,lat])=>{const x=(lng-part.anchor[0])*scale,y=(lat-part.anchor[1])*111320;return [x*c+y*s,-x*s+y*c];}));
    const dx=(part.anchor[0]-meta.anchor[0])*111320*Math.cos(meta.anchor[1]*Math.PI/180),dy=(part.anchor[1]-meta.anchor[1])*111320;
    b.frame(dx,dy,theta);
    const W=part.widthM,D=part.depthM,H=part.displayHeightM,base=part.baseM||0,type=part.type;
    const roof=type==='cloud'?'green':type==='historic'?'roof':'metal';
    const rise=part.roofRiseM??(['flat','tower','canopy'].includes(type)?0:Math.min(8,H*.22)),eave=H-rise;
    const z=(x,y)=>{
      if(type==='vault')return eave+rise*Math.sqrt(Math.max(0,1-Math.pow(y/(D*.51),2)));
      if(type==='umbrella')return eave+rise*(1-Math.max(Math.abs(((x/W*3+3.5)%1)*2-1),Math.abs(((y/D*2+3)%1)*2-1)));
      if(type==='slope')return eave+rise*(.5+y/D);
      if(type==='historic')return eave+rise*Math.max(0,1-Math.max(Math.abs(x)/(W*.5),Math.abs(y)/(D*.5)));
      if(type==='cloud')return H-2+2*Math.cos(x/W*Math.PI*2)*Math.cos(y/D*Math.PI*2);
      return H;
    };
    const open=['canopy','cloud','umbrella'].includes(type);
    if(!open){surface('stone',rings,()=>base+.1,'base');surface('floor',rings,()=>base+.5,'interior');}
    surface(roof,rings,z,'shell',true);
    // 同一輪廓做外緣、窗帶、柱列；不加一個填滿天井的矩形底座。
    for(const ring of rings)for(let i=0;i<ring.length-1;i++){
      const a=ring[i],d=ring[i+1],length=Math.hypot(d[0]-a[0],d[1]-a[1]);
      const P=(p,h)=>[p[0],p[1],h];
      b.quad('trim',P(a,z(...a)),P(d,z(...d)),P(d,z(...d)-1),P(a,z(...a)-1));
      if(!open){b.quad(type==='historic'?'brick':'glass',P(a,base+1),P(d,base+1),P(d,z(...d)-1.2),P(a,z(...a)-1.2));
        b.quad('trim',P(a,base+1),P(d,base+1),P(d,base+1.7),P(a,base+1.7));
        if(type==='tower')for(let h=base+5;h<H-2;h+=4)b.quad('trim',P(a,h),P(d,h),P(d,h+.35),P(a,h+.35));
      }
      for(let k=0;k<Math.floor(length/12);k++){const t=(k+.5)/Math.floor(length/12),x=a[0]+(d[0]-a[0])*t,y=a[1]+(d[1]-a[1])*t;
        if(!open){const h=z(x,y)-1.2;b.box('trim',x,y,(h+base)/2,.65,.65,h-base);}
      }
    }
    // 大廳家具與結構只供半透明檢視；沒有把虛構軌道放進現役站區。
    if(type!=='tower')for(let x=-W/2+15;x<W/2;x+=22)for(let y=-D/2+12;y<D/2;y+=22)if(inside([x,y],rings)){
      b.box('inside',x,y,(eave+base)/2,1.1,1.1,eave-base,'interior');
      if(type==='cloud')for(const side of [-1,1]){b.quad('trim',[x-1,y,eave*.6],[x+1,y,eave*.6],[x+side*5+1,y,H-1],[x+side*5-1,y,H-1]);b.quad('trim',[x,y-1,eave*.6],[x,y+1,eave*.6],[x,y+side*5+1,H-1],[x,y+side*5-1,H-1]);}
      else {b.box('gold',x+3,y,base+1.4,4,1.4,.7,'interior');b.box('tile',x+3,y,base+.8,.8,1.1,1.1,'interior');}
    }
    // 金屬曲頂的橫向肋帶，沿真實輪廓裁切；形狀及節距為簡化。
    if(!['tower','historic','cloud'].includes(type))for(let x=-W/2+6;x<W/2;x+=10)for(let y=-D/2;y<D/2;y+=5){const y2=Math.min(y+5,D/2);if([[x-.25,y],[x+.25,y],[x+.25,y2],[x-.25,y2]].every(p=>inside(p,rings)))b.quad('trim',[x-.25,y,z(x,y)+.12],[x+.25,y,z(x,y)+.12],[x+.25,y2,z(x,y2)+.12],[x-.25,y2,z(x,y2)+.12]);}
    if(type==='flat'&&inside([0,0],rings)){b.box('glass',0,0,H+.25,W*.35,D*.3,.35);for(let x=-W*.17;x<W*.18;x+=5)b.box('trim',x,0,H+.5,.3,D*.3,.5);}
    if(type==='historic'&&part.clock){b.box('brick',0,-D*.25,H-1,Math.min(10,W*.2),Math.min(8,D*.6),8);b.box('trim',0,-D*.25,H+3.2,Math.min(12,W*.25),Math.min(10,D*.7),1);}
    if(part.sign!==false&&!open&&type!=='tower')signs.push({name:part.name,position:[dx,dy],theta,y:-D/2-.25,z:Math.max(base+3,eave-3.2),width:Math.min(35,W*.65)});
  }
  const root=b.finish();root.name=meta.id;
  for(const sign of signs){const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;const ctx=canvas.getContext('2d');ctx.fillStyle='#24483e';ctx.font='bold 82px "PingFang TC",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(sign.name,512,64,1000);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(sign.width,3.2),new THREE.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.1,side:THREE.DoubleSide}));mesh.rotation.set(Math.PI/2,0,0);const holder=new THREE.Group();holder.rotation.z=sign.theta;holder.position.set(...sign.position,0);mesh.position.set(0,sign.y,sign.z);mesh.userData.part='shell';mesh.name='shell/sign';holder.add(mesh);root.add(holder);
  }
  return root;
}

export {builder as createModelBuilder};
