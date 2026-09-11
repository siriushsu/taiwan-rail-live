// 沿既有軌面補示意橋梁／路基，不改列車 XY 或高程。尺寸與橋墩間距不是實測工程資料。
// a[2] 是軌頂高度；道床／橋面頂面固定低 .35 公尺，枕木與鋼軌就疊在那個面上往回長到軌頂。
// 近看才長細節：頂點預算幾乎全花在 z14.5 的廣角(實測台北 25 萬、后里 12.6 萬)，
// 而 z18 以上畫面裡的段數只剩幾百，加鋼軌與枕木仍遠低於廣角的量。
import * as THREE from '../vendor/three.module.js';
const GAUGE=1.435,RAIL_W=.14,RAIL_H=.2,TIE_LEN=2.5,TIE_W=.26,TIE_H=.15,TIE_SPACING=.65;
export function createRailStructures(scene){
  let geometry=new THREE.BufferGeometry();
  const material=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material);
  mesh.frustumCulled=false;mesh.renderOrder=-1;scene.add(mesh);
  const stats={decks:0,piers:0,beds:0,rails:0,ties:0,detail:0,vertices:0,samples:[],buildMs:0};
  function set(segments,piers,detail=0){
    const started=performance.now(),positions=[],colors=[];
    const deck=new THREE.Color('#b2ad9e'),side=new THREE.Color('#989588'),
          ballast=new THREE.Color('#9d978b'),steel=new THREE.Color('#6f6a62'),tie=new THREE.Color('#a8a299');
    stats.decks=stats.piers=stats.beds=stats.rails=stats.ties=0;stats.detail=detail;stats.samples=[];
    function quad(a,b,c,d,color){for(const p of [a,b,c,a,c,d]){positions.push(...p);colors.push(color.r,color.g,color.b);}}
    // 上下底可以不同寬：道碴是梯形斷面，橋面是等寬箱梁。
    function prism(a,b,width,bottomA,bottomB,color,bottomWidth=width){
      const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<1e-5)return;
      const ux=-dy/length,uy=dx/length,nx=ux*width/2,ny=uy*width/2,bx=ux*bottomWidth/2,by=uy*bottomWidth/2;
      const p=[[a[0]+nx,a[1]+ny,a[2]],[a[0]-nx,a[1]-ny,a[2]],[b[0]-nx,b[1]-ny,b[2]],[b[0]+nx,b[1]+ny,b[2]]];
      const q=[[a[0]+bx,a[1]+by,bottomA],[a[0]-bx,a[1]-by,bottomA],[b[0]-bx,b[1]-by,bottomB],[b[0]+bx,b[1]+by,bottomB]];
      quad(...p,color);quad(q[3],q[2],q[1],q[0],side);for(let i=0;i<4;i++){const j=(i+1)%4;quad(p[i],q[i],q[j],p[j],color===ballast?ballast:side);}
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
       quad([cx+ux*half+tx*hw,cy+uy*half+ty*hw,z],[cx-ux*half+tx*hw,cy-uy*half+ty*hw,z],
            [cx-ux*half-tx*hw,cy-uy*half-ty*hw,z],[cx+ux*half-tx*hw,cy+uy*half-ty*hw,z],tie);
       stats.ties++;
      }
    }
    for(const {a,b,groundA,groundB,bridge,transition=false,scale=1} of segments){
      const topA=[a[0],a[1],a[2]-.35*scale],topB=[b[0],b[1],b[2]-.35*scale];
      if(![...a,...b,groundA,groundB,scale].every(Number.isFinite)||Math.min(topA[2]-groundA,topB[2]-groundB)<.05*scale)continue;
      if(bridge){prism(topA,topB,4.2*scale,Math.max(groundA-.3*scale,topA[2]-1.15*scale),Math.max(groundB-.3*scale,topB[2]-1.15*scale),deck);stats.decks++;}
      // 路基改成梯形斷面：頂 3.4 公尺、底 4.6 公尺，這是道碴實際堆出來的樣子，
      // 原本上下等寬 4.2 公尺看起來就是一塊板子。
      else{prism(topA,topB,3.4*scale,transition?Math.max(groundA-.3*scale,topA[2]-1.15*scale):groundA-.3*scale,transition?Math.max(groundB-.3*scale,topB[2]-1.15*scale):groundB-.3*scale,ballast,4.6*scale);stats.beds++;}
      if(detail>=2)ties(topA,topB,topA[2],scale);
      if(detail>=1){const top=a[2]-(detail>=2?.15*scale:.2*scale);rail(topA,topB,GAUGE/2,top,scale);rail(topA,topB,-GAUGE/2,top,scale);}
    }
    for(const {p,ground,angle,scale=1,coordinate,railHeightM,groundM}of piers){
      const top=p[2]-1.5*scale;if(![...p,ground,angle,scale].every(Number.isFinite)||top-ground<.3*scale)continue;
      const dx=Math.cos(angle)*.8*scale,dy=Math.sin(angle)*.8*scale;
      prism([p[0]-dx,p[1]-dy,top],[p[0]+dx,p[1]+dy,top],1.8*scale,ground-.5*scale,ground-.5*scale,deck);stats.piers++;
      if(stats.samples.length<60)stats.samples.push({coordinate,railHeightM,groundM,topM:railHeightM-1.5,baseM:groundM-.5});
    }
    geometry.dispose();geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();mesh.geometry=geometry;stats.vertices=positions.length/3;stats.buildMs=performance.now()-started;
  }
  return {stats,set,setVisible(visible){mesh.visible=visible;},destroy(){scene.remove(mesh);geometry.dispose();material.dispose();}};
}
