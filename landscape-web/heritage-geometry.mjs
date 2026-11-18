// 用描繪的屋緣裁切瓦面，同一份三角面可畫在近景地形或區域地圖。
// ring 為公尺座標（東、北），emit 的座標順序為東、高、南。
import {ShapeUtils, Vector2} from './engine/vendor/three.module.js';

export function drawHeritageHall(part, ring, emit) {
  const {style,height:h,wall,roof}=part;
  const center=ring.reduce(([x,y],[e,n])=>[x+e/ring.length,y+n/ring.length],[0,0]);
  const a=(part.ridge||0)*Math.PI/180, sin=Math.sin(a), cos=Math.cos(a);
  const uv=ring.map(([e,n])=>[(e-center[0])*sin+(n-center[1])*cos,(e-center[0])*cos-(n-center[1])*sin]);
  const min=axis=>Math.min(...uv.map(p=>p[axis])),max=axis=>Math.max(...uv.map(p=>p[axis]));
  const width=(max(0)-min(0))/2,depth=(max(1)-min(1))/2;
  if(width<.18 || depth<.18)return;
  const dx=(max(0)+min(0))/2,dy=(max(1)+min(1))/2;
  const plan=uv.map(([x,y])=>[(x-dx)/width,(y-dy)/depth]);
  function point([x,y],z) {
    const u=x*width+dx,v=y*depth+dy;
    return [center[0]+u*sin+v*cos,z,-(center[1]+u*cos-v*sin)];
  }
  const scale=(poly,k)=>poly.map(([x,y])=>[x*k,y*k]);
  const tint=(hex,k)=>'#'+hex.slice(1).match(/../g).map(v=>Math.min(255,Math.round(parseInt(v,16)*k)).toString(16).padStart(2,'0')).join('');
  const quad=(a,b,c,d,color)=>{emit(a,b,c,color);emit(a,c,d,color);};
  const faces=ShapeUtils.triangulateShape(plan.map(p=>new Vector2(...p)),[]);
  function deck(poly,alt,color) {
    for(const face of faces)emit(...face.map(i=>point(poly[i],alt)),color);
  }
  function walls(poly,base,top,color) {
    poly.forEach((p,i)=>{
      const q=poly[(i+1)%poly.length];
      quad(point(p,base),point(q,base),point(q,top),point(p,top),color);
    });
  }
  function column(p,r,base,top,color) {
    const sides=8,poly=Array.from({length:sides},(_,j)=>[p[0]+r/width*Math.cos(j*2*Math.PI/sides),p[1]+r/depth*Math.sin(j*2*Math.PI/sides)]);
    walls(poly,base,top,color);
  }
  const red=style==='japanese'?'#695548':'#964c3a',stone='#aaa28f';
  if(style==='brick-arches'){
    // 漢口街齋堂三開間拱廊。以弧形下緣構成拱腹，洞口能實際見到後方門廳。
    const band=h*.72,spring=h*.49,halfBay=.265;
    for(const k of [-1,1]){
      for(let bay=0;bay<3;bay++){
        const cx=-2/3+bay*2/3,side=k*.985;
        for(let i=0;i<14;i++){
          const t=Math.PI*i/14,u=Math.PI*(i+1)/14;
          const x=cx-halfBay*Math.cos(t),y=cx-halfBay*Math.cos(u);
          const bottom=spring+(band-spring)*Math.sin(t),next=spring+(band-spring)*Math.sin(u);
          quad(point([x,side],bottom),point([y,side],next),point([y,side],h),point([x,side],h),wall);
          quad(point([x,side],bottom),point([y,side],next),point([y,side-.16*k],next),point([x,side-.16*k],bottom),'#815649');
        }
        for(const sign of [-1,1]){
          const left=cx+sign*halfBay,right=cx+sign/3;
          const post=[[left,side],[right,side],[right,side-.16*k],[left,side-.16*k]];
          walls(post,0,h,wall);
        }
      }
    }
    deck(plan,h,'#9b8a77');walls(plan,h-.13,h+.12,'#c1ad93');
    walls(scale(plan,.99),h+.12,h+.6,wall);return;
  }
  if(style==='brickhouse'){
    const skin=scale(plan,.99);
    walls(skin,0,h,wall);deck(skin,h,roof);walls(plan,h,h+.28,wall);
    for(let bay=0;bay<3;bay++){
      const cx=-2/3+bay*2/3;
      quad(point([cx-.27,1],.16),point([cx+.27,1],.16),point([cx+.27,1],h*.48),point([cx-.27,1],h*.48),'#5f5045');
      for(let j=-1;j<=1;j++){
        const x=cx+j*.18;
        quad(point([x-.06,1],h*.65),point([x+.06,1],h*.65),point([x+.06,1],h*.9),point([x-.06,1],h*.9),'#403d37');
      }
    }
    for(let pier=0;pier<4;pier++){
      const x=-.98+pier*(1.96/3);
      walls([[x-.022,.96],[x+.022,.96],[x+.022,1.025],[x-.022,1.025]],0,h+.38,tint(wall,1.09));
    }
    return;
  }
  const radial=style==='hexagon'||style==='octagon';
  if(radial) {
    const levels=style==='hexagon'?2:1;
    const foot=scale(plan,.66);
    walls(foot,0,.65,stone);walls(foot,.65,h*.54,wall);deck(foot,h*.54,wall);
    function pavilion(k,base,rise) {
      const rim=scale(plan,k),mid=scale(plan,k*.55);
      rim.forEach((p,i)=>{
        const j=(i+1)%rim.length,q=rim[j],m=mid[i],n=mid[j];
        const e=[(p[0]+q[0])/2,(p[1]+q[1])/2],f=[(m[0]+n[0])/2,(m[1]+n[1])/2];
        for(const [p1,p2,m1,m2,l1,l2] of [[p,e,m,f,.32,0],[e,q,f,n,0,.32]]) {
          quad(point(p1,base+l1),point(p2,base+l2),point(m2,base+.35*rise),point(m1,base+.35*rise),roof);
          emit(point(m1,base+.35*rise),point(m2,base+.35*rise),point([0,0],base+rise),tint(roof,1.06));
        }
        column([p[0]*.77,p[1]*.77],.17,levels===2 && k<1?h*.53:.14,base,red);
      });
    }
    if(levels===2) {
      pavilion(1,h*.45,1.25);
      walls(scale(plan,.51),h*.53,h-.19,wall);
      walls(scale(plan,.74),h*.52,h*.62,'#b1aaa0');
    } else walls(foot,h*.54,h-.15,wall);
    pavilion(levels===2?.83:1,h,Math.min(3.8,width*.68));
    const peak=h+Math.min(3.8,width*.68);
    column([0,0],.13,peak-.05,peak+.85,'#a58a57');
    if(style==='hexagon'){
      for(const [low,high,r] of [[0,.14,.21],[.14,.26,.16],[.26,.37,.12],[.37,.49,.16],[.49,.59,.10]])
        column([0,0],r,peak+low,peak+high,'#aa8c60');
    }
    return;
  }

  const shed=style==='canopy',flat=shed||style==='flat';
  const open=/拜亭|四柱|向拜|拱廊陽臺/.test(part.name||'');
  const shrink=flat?.97:.83;
  if(!shed && !open) {
    const core=scale(plan,shrink);
    walls(core,0,.48,stone);walls(core,.48,h-.24,wall);deck(core,h-.24,wall);
    // 各立面依有效長度留下石框、門洞與木窗；窄小街屋只設一開間。
    core.forEach((p,i)=>{
      const q=core[(i+1)%core.length],l=Math.hypot((p[0]-q[0])*width,(p[1]-q[1])*depth);
      if(l<2.5)return;
      const bays=Math.max(1,Math.min(7,Math.floor(l/2.8))),floors=(style==='shophouse'||style==='arcade-hall')?2:1;
      for(let j=0;j<bays;j++)for(let f=0;f<floors;f++){
        const lo=(j+.21)/bays,hi=(j+.79)/bays;
        const at=k=>[(p[0]+k*(q[0]-p[0]))*1.003,(p[1]+k*(q[1]-p[1]))*1.003];
        const bottom=f*h/floors+(j===Math.floor(bays/2)? .28:.91),top=(f+.77)*h/floors;
        quad(point(at(lo),bottom),point(at(hi),bottom),point(at(hi),top),point(at(lo),top),j===Math.floor(bays/2)?'#594238':'#78614e');
        quad(point(at(lo),top),point(at(hi),top),point(at(hi),top+.12),point(at(lo),top+.12),stone);
      }
    });
  }
  if(!flat || shed || open) {
    const porch=scale(plan,.93);
    porch.forEach((p,i)=>{
      const q=porch[(i+1)%porch.length],l=Math.hypot((q[0]-p[0])*width,(q[1]-p[1])*depth);
      const cols=Math.max(1,Math.min(10,Math.round(l/(shed?5:3.6))));
      for(let j=0;j<cols;j++){
        const base=[p[0]+(q[0]-p[0])*j/cols,p[1]+(q[1]-p[1])*j/cols],r=Math.max(.09,Math.min(.26,h*.041));
        column(base,r,0,h-.12,red);column(base,r*1.36,0,.36,stone);
      }
    });
  }
  walls(plan,h-.23,h,flat?roof:tint(roof,.72));
  if(flat) {deck(plan,h,roof);return;}
  // 三角形先裁到坡面網格。凹多邊形的天井、廂房轉角因此不會被跨接。
  function clip(poly,axis,bound,sign) {
    const out=[];
    for(let i=0;i<poly.length;i++){
      const p=poly[i],q=poly[(i+1)%poly.length],d=(p[axis]-bound)*sign,e=(q[axis]-bound)*sign;
      if(d>=0)out.push(p);
      if((d<0)!==(e<0)){const t=d/(d-e);out.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}
    }
    return out;
  }
  const rise=Math.max(.72,Math.min(5.3,depth*(style==='japanese'?.63:.48)));
  const ornate=['traditional','double','hip','shophouse','arcade-hall'].includes(style);
  function roofSurface(k,base,dy) {
    function z([u,v]) {
      const end=Math.abs(u),pitch=Math.abs(v);
      const hips=style==='hip'||style==='japanese'||style==='double';
      const slope=hips?Math.max(pitch,Math.max(0,(end-.66)/.34)):pitch;
      return base+dy*(1-Math.min(1,slope))**1.35+(ornate?.6:.08)*Math.max(0,(end-.68)/.32)**2*(.35+.65*pitch);
    }
    // 山牆止於瓦面下緣；兩坡相遇處的磚牆封閉，不會透出後方街景。
    const skin=scale(plan,k*.91);
    skin.forEach((p,i)=>{
      const q=skin[(i+1)%skin.length];
      for(let j=0;j<8;j++){
        const at=t=>[p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t];
        const lo=at(j/8),hi=at((j+1)/8);
        quad(point(lo,base-.08),point(hi,base-.08),point(hi,z(hi.map(n=>n/k))-.05),point(lo,z(lo.map(n=>n/k))-.05),wall);
      }
    });
    const divisions=Math.max(8,Math.min(38,Math.round(width*2/.8)));
    for(const face of faces){
      const tri=face.map(i=>plan[i]);
      for(let i=0;i<divisions;i++){
        const strip=clip(clip(tri,0,-1+2*i/divisions,1),0,-1+2*(i+1)/divisions,-1);
        if(strip.length<3)continue;
        const color=i%3===0?tint(roof,1.055):roof;
        for(let j=0;j<8;j++){
          const poly=clip(clip(strip,1,-1+j*.25,1),1,-.75+j*.25,-1);
          if(poly.length<3)continue;
          const xyz=poly.map(p=>point([p[0]*k,p[1]*k],z(p)));
          for(let n=1;n<xyz.length-1;n++)emit(xyz[0],xyz[n],xyz[n+1],color);
        }
      }
    }
    if(ornate||style==='japanese'){
      const limit=style==='hip'||style==='japanese'||style==='double'?.68:.96;
      // 脊飾也裁在實際屋脊與屋面相交的線段上。
      const crossings=[];
      plan.forEach((p,i)=>{const q=plan[(i+1)%plan.length];if((p[1]>0)!==(q[1]>0))crossings.push(p[0]-p[1]*(q[0]-p[0])/(q[1]-p[1]));});
      crossings.sort((a,b)=>a-b);
      for(let j=0;j+1<crossings.length;j+=2){
        const x0=Math.max(-limit,crossings[j]),x1=Math.min(limit,crossings[j+1]);if(x1<=x0)continue;
        const profile=t=>base+dy+.06+(ornate?.58:.08)*Math.max(0,Math.abs(2*t-1)*3-2)**2;
        if(part.ridgeMotif==='ceramic' && (style!=='double'||k<1)){
          // 三川脊成對的彩色剪黏輪廓，用兩面厚片表現起伏與朝向中央的龍首。
          for(const side of [-1,1]){
            const path=[[.12,.72],[.17,1.02],[.24,.9],[.32,.56],[.43,.46],[.55,.65],[.62,.91],[.7,.71],[.8,.39]];
            for(let j=0;j<path.length-1;j++){
              const [x,y]=path[j],[xx,yy]=path[j+1];
              const u=(x0+x1)/2+side*(x1-x0)*x/2,v=(x0+x1)/2+side*(x1-x0)*xx/2;
              for(const face of [-1,1]){
                const front=.11*face/depth;
                quad(point([u*k,front],base+dy+y-.14),point([v*k,front],base+dy+yy-.14),point([v*k,front],base+dy+yy+.09),point([u*k,front],base+dy+y+.09),j<2?'#a3824e':'#527c73');
                if(j>1)emit(point([u*k,front],base+dy+y+.07),point([v*k,front],base+dy+yy+.07),point([(u*.7+v*.3)*k,front],base+dy+y+.3),'#a38957');
              }
            }
          }
        }
        for(let n=0;n<12;n++){
          const t=n/12,s=(n+1)/12,u=(x0+(x1-x0)*t)*k,v=(x0+(x1-x0)*s)*k,r=.13/depth;
          for(const side of [-1,1])quad(point([u,r*side],profile(t)),point([v,r*side],profile(s)),point([v,0],profile(s)+.2),point([u,0],profile(t)+.2),part.ridgeColor||(style==='japanese'?'#626561':'#b58e68'));
        }
      }
    }
  }
  if(style==='double') {
    roofSurface(1,h,rise*.72);
    walls(scale(plan,.61),h+rise*.32,h+rise*.76,wall);
    roofSurface(.69,h+rise*.76,rise*.86);
  } else roofSurface(1,h,rise);
}

export function appendHeritageHall(part,ring,elevation,pos,col,nor) {
  const palette=new Map();
  function vertex(a,b,c,hex) {
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
    const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx,len=Math.hypot(x,y,z);
    if(len<1e-6)return;
    const normal=[Math.round(127*x/len),Math.round(127*y/len),Math.round(127*z/len),0];
    let color=palette.get(hex);
    if(!color){
      color=hex.slice(1).match(/../g).map(v=>{const s=parseInt(v,16)/255;return Math.round(255*(s<=.04045?s/12.92:((s+.055)/1.055)**2.4));});
      palette.set(hex,color);
    }
    for(const p of [a,b,c]){
      pos.push(p[0],p[1]+elevation,p[2]);nor.push(...normal);col.push(...color,255);
    }
  }
  drawHeritageHall(part,ring,vertex);
}
