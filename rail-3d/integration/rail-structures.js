// 沿既有軌面補示意橋梁／路基，不改列車 XY 或高程。尺寸與橋墩間距不是實測工程資料。
// a[2] 是軌頂高度；道床／橋面頂面固定低 .35 公尺，枕木與鋼軌就疊在那個面上往回長到軌頂。
// 近看才長細節：頂點預算幾乎全花在 z14.5 的廣角(實測台北 25.8 萬、后里 15.3 萬)，
// 而 z18 以上畫面裡的段數只剩幾百，加鋼軌、枕木、護欄與墩帽仍遠低於廣角的量。
import * as THREE from '../vendor/three.module.js';
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
// 洞口尺寸沿用 prototypes/taiwan-3d/rail-occlusion.js 的隧道示意：拱心半徑 3.2 公尺、
// 起拱線在軌頂上 2.6 公尺、洞底在軌頂下 1.2 公尺、石環厚 .7 公尺。那一版是文湖線單線
// 展示做的，這裡只取斷面比例，位置改成沿線每個洞口自己算。
const BORE_R=3.2,SPRING=2.6,BORE_FLOOR=-1.2,RING=.7,ARCH_SEGMENTS=14;
// 洞口面牆：半寬 6.2 公尺、牆頂在軌頂上 7.4（拱背再加 .9 公尺帽石）、厚 1.1 公尺，往洞內 7 公尺洞身，
// 翼牆再往洞外斜出 6 公尺。底緣照洞口面上的地表取樣走，再埋進去 1.2 公尺；地形資料離譜時最多往下 45 公尺。
// 要照地形是因為洞口大多不在地表上：全網 701 個洞口有 310 個軌面高出地表 3 公尺以上，
// 最極端的高鐵三義段高出 15.8 公尺——固定高度的拱圈在那裡就是一塊浮在半空的黑斑。
const PORTAL_HALF_W=6.2,PORTAL_TOP=SPRING+BORE_R+RING+.9,PORTAL_T=1.1,PORTAL_EMBED=1.2,
      PORTAL_DROP_MAX=45,PORTAL_BARREL=7,PORTAL_WING_M=6,PORTAL_WING_FLARE=2.4;
// 算繪端沿洞口面橫向取樣地表的位置（公尺），與這裡的內插同一組刻度。
export const PORTAL_FACE_U=[-7,-3.5,0,3.5,7];
export function createRailStructures(scene){
  let geometry=new THREE.BufferGeometry();
  const material=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material);
  mesh.frustumCulled=false;mesh.renderOrder=-1;scene.add(mesh);
  const stats={decks:0,piers:0,caps:0,parapets:0,beds:0,rails:0,ties:0,portals:0,detail:0,vertices:0,samples:[],buildMs:0};
  function set(segments,piers,detail=0,portals=[]){
    const started=performance.now(),positions=[],colors=[];
    const deck=new THREE.Color('#b2ad9e'),side=new THREE.Color('#989588'),
          ballast=new THREE.Color('#9d978b'),steel=new THREE.Color('#6f6a62'),tie=new THREE.Color('#a8a299'),
          stone=new THREE.Color('#d4c8ad'),lining=new THREE.Color('#344b52'),parapet=new THREE.Color('#cfcab9'),
          // 填方邊坡自己一個色：道碴色畫到坡腳時，整座土堆會變成比地表暗三成的實心塊。
          // 坡面退到接近地表的淺色、只留道碴頂面那條深色，看到的才是一條軌道而不是一道土牆。
          bank=new THREE.Color('#c6c0b1');
    stats.decks=stats.piers=stats.caps=stats.parapets=stats.beds=stats.rails=stats.ties=stats.portals=0;stats.detail=detail;stats.samples=[];
    function quad(a,b,c,d,color){for(const p of [a,b,c,a,c,d]){positions.push(...p);colors.push(color.r,color.g,color.b);}}
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
    function rail(a,b,offset,top,scale){
      const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<1e-5)return;
      const ux=-dy/length,uy=dx/length,cx=ux*offset*scale,cy=uy*offset*scale,hx=ux*RAIL_W*scale/2,hy=uy*RAIL_W*scale/2;
      const base=top-RAIL_H*scale;
      const p=[[a[0]+cx+hx,a[1]+cy+hy,top],[a[0]+cx-hx,a[1]+cy-hy,top],[b[0]+cx-hx,b[1]+cy-hy,top],[b[0]+cx+hx,b[1]+cy+hy,top]];
      quad(...p,steel);
      quad(p[0],[p[0][0],p[0][1],base],[p[3][0],p[3][1],base],p[3],steel);
      quad(p[2],[p[2][0],p[2][1],base],[p[1][0],p[1][1],base],p[1],steel);
      stats.rails++;
    }
    // 枕木只畫頂面：它嵌在道碴裡，側面本來就看不見，省下三分之二的頂點。
    function ties(a,b,top,scale){
      const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<1e-5)return;
      const tx=dx/length,ty=dy/length,ux=-ty,uy=tx,step=TIE_SPACING*scale;
      const half=TIE_LEN*scale/2,hw=TIE_W*scale/2,z=top+.01*scale;
      for(let d=step/2;d<length;d+=step){
       const cx=a[0]+tx*d,cy=a[1]+ty*d;
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
      if(detail>=1){const top=a[2]-(detail>=2?.15*scale:.2*scale);rail(topA,topB,GAUGE/2,top,scale);rail(topA,topB,-GAUGE/2,top,scale);}
    });
    // 洞口：面牆嵌進山坡、開口是一段暗色洞身。面牆底緣照現場地形走——地表低於軌面就往下長成
    // 擋土牆，接住山坡；地表高於軌面就只露出拱背。軌道本來就在洞口戛然而止，補上這個之後才
    // 看得出來是「進洞」而不是「線畫到一半沒了」。
    function portal({p,angle,scale=1,ground}){
      if(![...p,angle,scale].every(Number.isFinite))return;
      const tx=Math.cos(angle),ty=Math.sin(angle),ux=-ty,uy=tx;
      // 洞口面座標：u 橫向公尺、z 相對軌頂公尺、d 沿洞內方向公尺。
      const at=(u,z,d=0)=>[p[0]+(ux*u+tx*d)*scale,p[1]+(uy*u+ty*d)*scale,p[2]+z*scale];
      const samples=(ground||[]).map(z=>Number.isFinite(z)?(z-p[2])/scale:null),finite=samples.filter(z=>z!==null);
      const groundAt=u=>{
        if(!finite.length)return BORE_FLOOR;
        const t=Math.max(0,Math.min(1,(u-PORTAL_FACE_U[0])/(PORTAL_FACE_U[PORTAL_FACE_U.length-1]-PORTAL_FACE_U[0])))*(samples.length-1);
        const i=Math.min(samples.length-2,Math.floor(t)),f=t-i;
        return (samples[i]??finite[0])*(1-f)+(samples[i+1]??finite[finite.length-1])*f;
      };
      const bottomAt=u=>Math.max(-PORTAL_DROP_MAX,Math.min(BORE_FLOOR,groundAt(u)-PORTAL_EMBED));
      const archAt=u=>Math.abs(u)<BORE_R?SPRING+Math.sqrt(BORE_R*BORE_R-u*u):SPRING;
      // 面牆分成三段掃：拱外兩側整片落到地面，拱的範圍只補拱背與洞底以下，中間留成洞口。
      const edges=[-PORTAL_HALF_W,-BORE_R,BORE_R,PORTAL_HALF_W];
      for(let e=0;e<3;e++){const n=e===1?ARCH_SEGMENTS:3;
        for(let i=0;i<n;i++){
          const u0=edges[e]+(edges[e+1]-edges[e])*i/n,u1=edges[e]+(edges[e+1]-edges[e])*(i+1)/n,b0=bottomAt(u0),b1=bottomAt(u1);
          if(e!==1){quad(at(u0,b0),at(u1,b1),at(u1,PORTAL_TOP),at(u0,PORTAL_TOP),stone);continue;}
          quad(at(u0,archAt(u0)),at(u1,archAt(u1)),at(u1,PORTAL_TOP),at(u0,PORTAL_TOP),stone);
          if(b0<BORE_FLOOR-.01||b1<BORE_FLOOR-.01)quad(at(u0,b0),at(u1,b1),at(u1,BORE_FLOOR),at(u0,BORE_FLOOR),deck);
        }}
      // 牆頂與兩側收邊：有厚度才不像一張貼在山坡上的紙。
      quad(at(-PORTAL_HALF_W,PORTAL_TOP),at(PORTAL_HALF_W,PORTAL_TOP),at(PORTAL_HALF_W,PORTAL_TOP,PORTAL_T),at(-PORTAL_HALF_W,PORTAL_TOP,PORTAL_T),side);
      for(const sign of [1,-1]){const u=sign*PORTAL_HALF_W,b=bottomAt(u);
        quad(at(u,b),at(u,PORTAL_TOP),at(u,PORTAL_TOP,PORTAL_T),at(u,b,PORTAL_T),side);}
      // 拱環凸出面牆一點，洞口才有邊框而不是一塊黑斑。
      for(let i=0;i<ARCH_SEGMENTS;i++){
        const a=i*Math.PI/ARCH_SEGMENTS,b=(i+1)*Math.PI/ARCH_SEGMENTS,r=BORE_R+RING;
        quad(at(BORE_R*Math.cos(a),SPRING+BORE_R*Math.sin(a),-.15),at(r*Math.cos(a),SPRING+r*Math.sin(a),-.15),
             at(r*Math.cos(b),SPRING+r*Math.sin(b),-.15),at(BORE_R*Math.cos(b),SPRING+BORE_R*Math.sin(b),-.15),side);
      }
      // 洞身：往山裡一小段暗色圓筒加底板與端牆，正面看進去是個洞，不是一片黑色圓餅。
      for(let i=0;i<ARCH_SEGMENTS;i++){
        const a=i*Math.PI/ARCH_SEGMENTS,b=(i+1)*Math.PI/ARCH_SEGMENTS,
              ca=BORE_R*Math.cos(a),sa=SPRING+BORE_R*Math.sin(a),cb=BORE_R*Math.cos(b),sb=SPRING+BORE_R*Math.sin(b);
        quad(at(ca,sa,0),at(cb,sb,0),at(cb,sb,PORTAL_BARREL),at(ca,sa,PORTAL_BARREL),lining);
        quad(at(0,SPRING,PORTAL_BARREL),at(ca,sa,PORTAL_BARREL),at(cb,sb,PORTAL_BARREL),at(0,SPRING,PORTAL_BARREL),lining);
      }
      quad(at(-BORE_R,BORE_FLOOR,0),at(BORE_R,BORE_FLOOR,0),at(BORE_R,BORE_FLOOR,PORTAL_BARREL),at(-BORE_R,BORE_FLOOR,PORTAL_BARREL),lining);
      quad(at(-BORE_R,SPRING,PORTAL_BARREL),at(BORE_R,SPRING,PORTAL_BARREL),at(BORE_R,BORE_FLOOR,PORTAL_BARREL),at(-BORE_R,BORE_FLOOR,PORTAL_BARREL),lining);
      // 翼牆：面牆兩側往洞外斜出去，接住路基與邊坡。
      for(const sign of [1,-1]){
        const u0=sign*PORTAL_HALF_W,u1=sign*(PORTAL_HALF_W+PORTAL_WING_FLARE),b=bottomAt(u0);
        quad(at(u0,b),at(u0,PORTAL_TOP),at(u1,SPRING,-PORTAL_WING_M),at(u1,b,-PORTAL_WING_M),deck);
      }
      stats.portals++;
    }
    if(detail>=1)for(const item of portals)portal(item);

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
    geometry.dispose();geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();mesh.geometry=geometry;stats.vertices=positions.length/3;stats.buildMs=performance.now()-started;
  }
  return {stats,set,setVisible(visible){mesh.visible=visible;},destroy(){scene.remove(mesh);geometry.dispose();material.dispose();}};
}
