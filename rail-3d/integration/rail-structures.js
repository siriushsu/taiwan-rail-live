// 沿既有軌面補示意橋梁／路基，不改列車 XY 或高程。尺寸與橋墩間距不是實測工程資料。
// a[2] 是軌頂高度；道床／橋面頂面固定低 .35 公尺，枕木與鋼軌就疊在那個面上往回長到軌頂。
// 近看才長細節：頂點預算幾乎全花在 z14.5 的廣角(實測台北 25.8 萬、后里 15.3 萬)，
// 而 z18 以上畫面裡的段數只剩幾百，加鋼軌、枕木、護欄與墩帽仍遠低於廣角的量。
import * as THREE from '../vendor/three.module.js';
import {portalClearanceVolumes,outsidePortalClearance} from './portal-clearance.js';
const GAUGE=1.435,RAIL_W=.14,RAIL_H=.2,TIE_LEN=2.5,TIE_W=.26,TIE_H=.15,TIE_SPACING=.65;
// 高架橋斷面比例參考高鐵標準高架（雙線橋面約 13 公尺、箱梁深約 3 公尺），縮成「一股道一片橋面」：
// 箱梁頂 5 公尺（含懸臂板，雙線並排時兩片相疊成一片）、底 2.8 公尺、梁深 1.8 公尺。護欄高 .9 厚 .35，
// 只畫在側向 2～6.5 公尺內沒有並行股道的那一側，雙線中間才不會多出一道牆。橋墩 2×2.8 公尺，
// 墩帽 5×1.6×1.2 公尺；護欄與墩帽都是近看（detail>=1）才畫。
const DECK_W=5,GIRDER_BOTTOM_W=2.8,GIRDER_DEPTH=1.8,DECK_DROP=.35,PARAPET_H=.9,PARAPET_W=.35,
      PIER_ALONG=2,PIER_ACROSS=2.8,CAP_ACROSS=5,CAP_ALONG=1.6,CAP_DEPTH=1.2,NEIGHBOR_M=6.5;
// 路基：道碴梯形斷面頂 3.4 公尺、底 4.6 公尺，離地愈高底愈寬，底寬有上限。
// 邊坡 1:1、上限 14 公尺（原本 1.5:1、上限 30）：全網平面軌道有 15.5% 的取樣點軌面高出地表 3 公尺以上，
// 舊比例在那裡畫出 13～30 公尺寬的土堆——比軌距寬近十倍，整個畫面只看得到那塊土，看不到車。
// 高填方本來就不會放成自然邊坡，實務上是擋土牆或橋梁，所以收窄之後反而比較像真的。
const BED_TOP_W=3.4,BED_BOTTOM_W=4.6,FILL_SLOPE=1,BED_BOTTOM_MAX=14;
// 高填方改畫成高架橋。路基底寬在離地 4.7 公尺就頂到 14 公尺上限，再高兩側就不再放坡，
// 整段長成一面垂直的土牆——跨谷的短段會從軌面一路拉到谷底，畫面上只剩那塊土。
// 2026-09-12 裁示：真的是高的軌道，確認過就讓它高，只是不要變成像是一道牆。
// 門檻取求解器自己的高架淨空 CLEAR=6（scripts/lib/outdoor_rail_grade.mjs:10）：那條線以上，
// 求解器本來就是照橋面在算高度，畫法跟著同一個數字走，不另立新常數。
// 判斷逐取樣點做（結構段每 5 公尺一段），不是逐條 way——逐 way 判會把整條線一起改，
// 實測會多畫 11 倍的長度。橋墩在 map3d.js 用同一個門檻補上，兩邊共用這個匯出值。
export const VIADUCT_LIFT_M=6;
// 開口按相鄰股道合併；造型尺寸是展示比例，沒有改寫軌道座標或高程。
const BORE_R=3.2,BORE_FLOOR=-1.2,RING=.65,ARCH_SEGMENTS=20;
const PORTAL_T=1.2,PORTAL_EMBED=.8,PORTAL_DROP_MAX=45;
import {PORTAL_DEPTH,PORTAL_WING} from './tunnel-portals.js';
export function createRailStructures(scene){
  let geometry=new THREE.BufferGeometry();
  const material=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material);
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float railGlow; varying float vRailGlow;').replace('#include <begin_vertex>','#include <begin_vertex>\nvRailGlow=railGlow;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vRailGlow;').replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(1.,.74,.38)*vRailGlow;');
  };
  mesh.frustumCulled=false;mesh.layers.enable(2);mesh.renderOrder=-1;scene.add(mesh);
  const stats={decks:0,piers:0,caps:0,parapets:0,beds:0,rails:0,ties:0,portals:0,portalTracks:0,portalSamples:[],detail:0,vertices:0,samples:[],buildMs:0};
  function set(segments,piers,detail=0,portals=[]){
    const started=performance.now(),positions=[],colors=[],glows=[];
    const deck=new THREE.Color('#b2ad9e'),side=new THREE.Color('#989588'),
          ballast=new THREE.Color('#9d978b'),steel=new THREE.Color('#6f6a62'),tie=new THREE.Color('#a8a299'),
          lining=new THREE.Color('#344b52'),parapet=new THREE.Color('#cfcab9'),
          // 填方邊坡自己一個色：道碴色畫到坡腳時，整座土堆會變成比地表暗三成的實心塊。
          // 坡面退到接近地表的淺色、只留道碴頂面那條深色，看到的才是一條軌道而不是一道土牆。
          bank=new THREE.Color('#c6c0b1');
    stats.decks=stats.piers=stats.caps=stats.parapets=stats.beds=stats.rails=stats.ties=stats.portals=0;stats.detail=detail;stats.samples=[];stats.portalTracks=0;stats.portalSamples=[];
    let portalMasks=null,portalEmission=0;
    function quad(a,b,c,d,color){
      const polygons=portalMasks?outsidePortalClearance([a,b,c,d],portalMasks):[[a,b,c,d]];
      for(const poly of polygons)for(let i=1;i<poly.length-1;i++)for(const p of [poly[0],poly[i],poly[i+1]]){positions.push(...p);colors.push(color.r,color.g,color.b);glows.push(portalEmission);}
    }
    // 上下底可以不同寬：道碴是梯形斷面，箱梁上寬下窄。
    function prism(a,b,width,bottomA,bottomB,color,bottomWidth=width,flank=null){
      const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<1e-5)return;
      const ux=-dy/length,uy=dx/length,nx=ux*width/2,ny=uy*width/2,bx=ux*bottomWidth/2,by=uy*bottomWidth/2;
      const p=[[a[0]+nx,a[1]+ny,a[2]],[a[0]-nx,a[1]-ny,a[2]],[b[0]-nx,b[1]-ny,b[2]],[b[0]+nx,b[1]+ny,b[2]]];
      const q=[[a[0]+bx,a[1]+by,bottomA],[a[0]-bx,a[1]-by,bottomA],[b[0]-bx,b[1]-by,bottomB],[b[0]+bx,b[1]+by,bottomB]];
      const flankColor=flank||(color===ballast?ballast:side);
      quad(...p,color);quad(q[3],q[2],q[1],q[0],side);for(let i=0;i<4;i++){const j=(i+1)%4;quad(p[i],q[i],q[j],p[j],flankColor);}
    }
    // 一條鋼軌：頂面加兩個側面。斜上方看過去底面永遠看不到，不畫。
    function rail(a,b,offset,top,scale,endTop=top){
      const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<1e-5)return;
      const ux=-dy/length,uy=dx/length,cx=ux*offset*scale,cy=uy*offset*scale,hx=ux*RAIL_W*scale/2,hy=uy*RAIL_W*scale/2;
      const base=top-RAIL_H*scale,endBase=endTop-RAIL_H*scale;
      const p=[[a[0]+cx+hx,a[1]+cy+hy,top],[a[0]+cx-hx,a[1]+cy-hy,top],[b[0]+cx-hx,b[1]+cy-hy,endTop],[b[0]+cx+hx,b[1]+cy+hy,endTop]];
      quad(...p,steel);
      quad(p[0],[p[0][0],p[0][1],base],[p[3][0],p[3][1],endBase],p[3],steel);
      quad(p[2],[p[2][0],p[2][1],endBase],[p[1][0],p[1][1],base],p[1],steel);
      stats.rails++;
    }
    // 枕木只畫頂面：它嵌在道碴裡，側面本來就看不見，省下三分之二的頂點。
    function ties(a,b,top,scale){
      const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<1e-5)return;
      const tx=dx/length,ty=dy/length,ux=-ty,uy=tx,step=TIE_SPACING*scale;
      const half=TIE_LEN*scale/2,hw=TIE_W*scale/2;
      for(let d=step/2;d<length;d+=step){
       const cx=a[0]+tx*d,cy=a[1]+ty*d,z=top+(b[2]-a[2])*d/length+.01*scale;
       // 繞向要跟 prism 頂面一致（先沿 -u 再沿 +t），否則法線朝下、枕木會被算成背光的深色。
       quad([cx+ux*half-tx*hw,cy+uy*half-ty*hw,z],[cx-ux*half-tx*hw,cy-uy*half-ty*hw,z],
            [cx-ux*half+tx*hw,cy-uy*half+ty*hw,z],[cx+ux*half+tx*hw,cy+uy*half+ty*hw,z],tie);
       stats.ties++;
      }
    }
    // 並行股道偵測：雙線高架的兩片橋面各自畫護欄，中間會多出一道牆。段中點丟進空間格，
    // 只在側向 2～6.5 公尺內沒有同向高架段的那一側畫護欄。
    const CELL=12,cell=new Map(),mids=segments.map(({a,b})=>[(a[0]+b[0])/2,(a[1]+b[1])/2]);
    if(detail>=1)segments.forEach((s,i)=>{if(!s.bridge)return;const m=mids[i],k=Math.floor(m[0]/CELL)+','+Math.floor(m[1]/CELL);if(!cell.has(k))cell.set(k,[]);cell.get(k).push(i);});
    function neighbor(i,sign,scale){
      const s=segments[i],m=mids[i],dx=s.b[0]-s.a[0],dy=s.b[1]-s.a[1],len=Math.hypot(dx,dy);if(len<1e-5)return false;
      const tx=dx/len,ty=dy/len,ux=-ty,uy=tx,cx=Math.floor(m[0]/CELL),cy=Math.floor(m[1]/CELL);
      for(let gx=cx-1;gx<=cx+1;gx++)for(let gy=cy-1;gy<=cy+1;gy++)for(const j of cell.get(gx+','+gy)||[]){
        if(j===i)continue;const o=segments[j],n=mids[j],ex=n[0]-m[0],ey=n[1]-m[1],lat=(ex*ux+ey*uy)*sign,along=ex*tx+ey*ty;
        if(lat<2*scale||lat>NEIGHBOR_M*scale||Math.abs(along)>10*scale)continue;
        const odx=o.b[0]-o.a[0],ody=o.b[1]-o.a[1],ol=Math.hypot(odx,ody);if(ol<1e-5||Math.abs((odx*tx+ody*ty)/ol)<.9)continue;
        return true;}
      return false;
    }
    segments.forEach(({a,b,groundA,groundB,bridge,transition=false,scale=1},i)=>{
      const topA=[a[0],a[1],a[2]-DECK_DROP*scale],topB=[b[0],b[1],b[2]-DECK_DROP*scale];
      if(![...a,...b,groundA,groundB,scale].every(Number.isFinite)||Math.min(topA[2]-groundA,topB[2]-groundB)<.05*scale)return;
      // 逐段判：軌面離地超過 VIADUCT_LIFT_M 的填方段照高架橋畫（林口走廊的過渡段除外，它另有畫法）。
      const railLift=Math.max(0,Math.min(a[2]-groundA,b[2]-groundB));
      if(bridge||(!transition&&railLift>=VIADUCT_LIFT_M*scale)){
        prism(topA,topB,DECK_W*scale,Math.max(groundA-.3*scale,topA[2]-GIRDER_DEPTH*scale),Math.max(groundB-.3*scale,topB[2]-GIRDER_DEPTH*scale),deck,GIRDER_BOTTOM_W*scale);stats.decks++;
        if(detail>=1){const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len>1e-5){const ux=-dy/len,uy=dx/len,e=(DECK_W-PARAPET_W)/2*scale;
          for(const sign of [1,-1]){if(neighbor(i,sign,scale))continue;
            prism([a[0]+ux*e*sign,a[1]+uy*e*sign,topA[2]+PARAPET_H*scale],[b[0]+ux*e*sign,b[1]+uy*e*sign,topB[2]+PARAPET_H*scale],PARAPET_W*scale,topA[2],topB[2],parapet);stats.parapets++;}}}
      }else{
        // 路基：離地愈高底愈寬（填方邊坡）；林口走廊的過渡段沿舊做法畫成薄板。
        const lift=Math.max(0,Math.min(topA[2]-groundA,topB[2]-groundB)),bottomW=Math.min(BED_BOTTOM_MAX*scale,BED_BOTTOM_W*scale+2*FILL_SLOPE*lift);
        prism(topA,topB,BED_TOP_W*scale,transition?Math.max(groundA-.3*scale,topA[2]-1.15*scale):groundA-.3*scale,transition?Math.max(groundB-.3*scale,topB[2]-1.15*scale):groundB-.3*scale,ballast,transition?BED_BOTTOM_W*scale:bottomW,bank);stats.beds++;
      }
      if(detail>=2)ties(topA,topB,topA[2],scale);
      if(detail>=1){const top=a[2]-(detail>=2?.15*scale:.2*scale);rail(topA,topB,GAUGE/2,top,scale,top+b[2]-a[2]);rail(topA,topB,-GAUGE/2,top,scale,top+b[2]-a[2]);}
    });
    // 外牆、拱圈、洞身共用同一個中空斷面；洞內不能封底，兩股道之間也不能補牆。
    function portal({p,angle,scale=1,ground,halfWidth=BORE_R,spring=2.8,grade=0,members=[],system}){
      if(![...p,angle,scale,halfWidth,spring].every(Number.isFinite))return;
      const tx=Math.cos(angle),ty=Math.sin(angle),ux=-ty,uy=tx,outer=halfWidth+2,top=spring+BORE_R+1.3;
      const at=(u,z,d=0)=>[p[0]+(ux*u+tx*d)*scale,p[1]+(uy*u+ty*d)*scale,p[2]+(z+grade*d)*scale];
      const samples=(ground||[]).map(z=>Number.isFinite(z)?(z-p[2])/scale:null),finite=samples.filter(z=>z!==null);
      const bottom=u=>{
        if(samples.length<2||!finite.length)return BORE_FLOOR;
        const t=Math.max(0,Math.min(1,(u/(outer+2)+1)/2))*(samples.length-1),i=Math.min(samples.length-2,Math.floor(t)),f=t-i;
        const g=(samples[i]??finite[0])*(1-f)+(samples[i+1]??finite.at(-1))*f;
        return Math.max(-PORTAL_DROP_MAX,Math.min(BORE_FLOOR,g-PORTAL_EMBED));
      };
      const block=(u0,u1,z0,z1,d0,d1,c)=>{
        const a=at(u0,z0,d0),b=at(u1,z0,d0),c1=at(u1,z1,d0),d=at(u0,z1,d0),e=at(u0,z0,d1),f=at(u1,z0,d1),g=at(u1,z1,d1),h=at(u0,z1,d1);
        quad(a,b,c1,d,c);quad(f,e,h,g,c);quad(d,c1,g,h,c);quad(a,e,f,b,c);quad(a,d,h,e,c);quad(b,f,g,c1,c);
      };
      const pale=new THREE.Color('#c6c8bd'),trim=new THREE.Color('#e1decd'),joint=new THREE.Color('#89948c'),dark=new THREE.Color('#243237');
      // 面牆從每個側邊獨立接地，中間只留軌面以下的橋台，橋面可以直接穿過開口。
      for(const sign of [-1,1]){
        const u=sign*halfWidth,v=sign*outer,b0=bottom(u),b1=bottom(v);
        quad(at(u,b0),at(v,b1),at(v,top),at(u,top),pale);
        quad(at(v,b1),at(v,b1,PORTAL_T),at(v,top,PORTAL_T),at(v,top),side);
        block(Math.min(u,v),Math.max(u,v),top-.22,top+.12,-.18,PORTAL_T+.18,trim);
        // 拱腳與內側壁具厚度，維修步道只放在開口最外側。
        block(sign>0?u:u-RING,sign>0?u+RING:u,BORE_FLOOR,spring,-.28,.12,trim);
        quad(at(u,BORE_FLOOR),at(u,spring),at(u,spring,PORTAL_DEPTH),at(u,BORE_FLOOR,PORTAL_DEPTH),lining);
        block(sign>0?u-.38:u,sign>0?u:u+.38,-.9,-.5,0,PORTAL_DEPTH,side);
        // 翼牆漸降到橋面護欄，厚度 .45m；不把高牆橫切到並排股道上。
        const u1=sign*(outer+2),tip=.6,b=bottom(u1),th=.45*sign;
        quad(at(v,b1),at(v,top-.22),at(u1,tip,-PORTAL_WING),at(u1,b,-PORTAL_WING),pale);
        quad(at(v+th,b1,0),at(u1+th,b,-PORTAL_WING),at(u1+th,tip,-PORTAL_WING),at(v+th,top-.22,0),side);
        quad(at(v,top-.22),at(v+th,top-.22),at(u1+th,tip,-PORTAL_WING),at(u1,tip,-PORTAL_WING),trim);
        quad(at(u1,b,-PORTAL_WING),at(u1,tip,-PORTAL_WING),at(u1+th,tip,-PORTAL_WING),at(u1+th,b,-PORTAL_WING),side);
        if(detail>=2){
          // 排水槽、面牆分縫與側壁燈帶；同一網格內加色，不另開燈光或貼圖。
          for(let z=1;z<top-.5;z+=1.5)block(Math.min(u+sign*.75,v),Math.max(u+sign*.75,v),z,z+.045,-.012,.012,joint);
          portalEmission=1;for(const d of [1.8,5.8,9.8])block(sign>0?u-.035:u,sign>0?u:u+.035,2.2,2.32,d,d+1.1,new THREE.Color('#eee0ae'));portalEmission=0;
        }
      }
      // 以橢圓拱保持雙線開口高度，不因股道合併而長成過高的半圓。
      for(let i=0;i<ARCH_SEGMENTS;i++){
        const a=i*Math.PI/ARCH_SEGMENTS,b=(i+1)*Math.PI/ARCH_SEGMENTS;
        const point=(t,ring=0,d=0)=>at((halfWidth+ring)*Math.cos(t),spring+(BORE_R+ring)*Math.sin(t),d);
        quad(point(a),point(b),at(halfWidth*Math.cos(b),top),at(halfWidth*Math.cos(a),top),pale);
        quad(point(a,0,-.28),point(a,RING,-.28),point(b,RING,-.28),point(b,0,-.28),i%2?trim:pale);
        quad(point(a,0,-.28),point(b,0,-.28),point(b,0,.12),point(a,0,.12),side);
        quad(point(a,RING,-.28),point(a,RING,.12),point(b,RING,.12),point(b,RING,-.28),trim);
        // 洞身分層轉暗，末端完全打通，行車不會撞上「黑色圓餅」。
        for(const [d0,d1,c] of [[0,3,lining],[3,7,dark],[7,PORTAL_DEPTH,dark]])quad(point(a,0,d0),point(b,0,d0),point(b,0,d1),point(a,0,d1),c);
        quad(point(a,.75,PORTAL_T),point(a,.75,PORTAL_DEPTH),point(b,.75,PORTAL_DEPTH),point(b,.75,PORTAL_T),pale);
        quad(point(a,0,PORTAL_DEPTH),point(b,0,PORTAL_DEPTH),point(b,.75,PORTAL_DEPTH),point(a,.75,PORTAL_DEPTH),side);
      }
      quad(at(-halfWidth,top),at(halfWidth,top),at(halfWidth,top,PORTAL_T),at(-halfWidth,top,PORTAL_T),trim);
      quad(at(-halfWidth,BORE_FLOOR),at(halfWidth,BORE_FLOOR),at(halfWidth,BORE_FLOOR,PORTAL_DEPTH),at(-halfWidth,BORE_FLOOR,PORTAL_DEPTH),lining);
      // 只在洞底以下封橋台，軌面、橋梁箱梁及列車的通道保持暢通。
      const base=Math.min(bottom(-halfWidth),bottom(halfWidth));
      if(base<BORE_FLOOR-.05)block(-halfWidth,halfWidth,base,BORE_FLOOR,0,PORTAL_T,side);
      // 洞口內的道床與鋼軌沿每股道實際取樣接續，不用共用拱門中心線替代兩股軌道。
      for(const member of members)for(let i=1;i<(member.samples?.length||0);i++){
        const a=member.samples[i-1],b=member.samples[i],k=member.scale||scale,aa=[a[0],a[1],a[2]-DECK_DROP*k],bb=[b[0],b[1],b[2]-DECK_DROP*k];
        prism(aa,bb,BED_TOP_W*k,a[2]-.95*k,b[2]-.95*k,ballast);
        for(const offset of [-GAUGE/2,GAUGE/2])rail(aa,bb,offset,a[2]-.15*k,k,b[2]-.15*k);
        if(detail>=2)ties(aa,bb,aa[2],k);
      }
      stats.portals++;stats.portalTracks+=members.length||1;
      stats.portalSamples.push({p,angle,scale,halfWidth,spring,grade,system,tracks:members.length||1,coordinate:members[0]?.coordinate});
    }
    if(detail>=1){const masks=portalClearanceVolumes(portals);
      for(const item of portals){const reach=(item.halfWidth+PORTAL_DEPTH+PORTAL_WING+6)*item.scale;
        portalMasks=masks.filter(m=>m.box[0]<item.p[0]+reach&&m.box[3]>item.p[0]-reach&&m.box[1]<item.p[1]+reach&&m.box[4]>item.p[1]-reach);portal(item);}
      portalMasks=null;
    }

    // 橋墩：墩頂接在箱梁底；近看多一顆墩帽，墩身再往下接地。
    for(const {p,ground,angle,scale=1,coordinate,railHeightM,groundM}of piers){
      const girderBottom=p[2]-(DECK_DROP+GIRDER_DEPTH)*scale,top=detail>=1?girderBottom-CAP_DEPTH*scale:girderBottom;
      if(![...p,ground,angle,scale].every(Number.isFinite)||top-ground<.3*scale)continue;
      const dx=Math.cos(angle),dy=Math.sin(angle);
      if(detail>=1){const h=CAP_ALONG/2*scale;prism([p[0]-dx*h,p[1]-dy*h,girderBottom],[p[0]+dx*h,p[1]+dy*h,girderBottom],CAP_ACROSS*scale,top,top,side);stats.caps++;}
      const h=PIER_ALONG/2*scale;
      prism([p[0]-dx*h,p[1]-dy*h,top],[p[0]+dx*h,p[1]+dy*h,top],PIER_ACROSS*scale,ground-.5*scale,ground-.5*scale,deck);stats.piers++;
      if(stats.samples.length<60)stats.samples.push({coordinate,railHeightM,groundM,topM:railHeightM-(DECK_DROP+GIRDER_DEPTH)-(detail>=1?CAP_DEPTH:0),baseM:groundM-.5});
    }
    geometry.dispose();geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('railGlow',new THREE.Float32BufferAttribute(glows,1));geometry.computeVertexNormals();mesh.geometry=geometry;stats.vertices=positions.length/3;stats.buildMs=performance.now()-started;
  }
  return {stats,set,setVisible(visible){mesh.visible=visible;},destroy(){scene.remove(mesh);geometry.dispose();material.dispose();}};
}
