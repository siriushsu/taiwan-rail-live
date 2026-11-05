// 台南車站：1936 年的兩層洗石子站房（二樓曾是鐵路飯店），站前是圓環與鳳凰木，左邊是成大榕園的老榕樹。
// 不是實際街廓的重建：圓環與榕園都拉近到廣場兩旁。
import {createStage,themes} from './station-stage.js';

export const THEMES=themes('#e9eae2','#f3d3b2','#121b2a');

export function createScene(parts){
 const s=createStage({seed:20462,trees:[['delonix',.65],['ficus',.35]]}),{k}=s;
 const {THREE,M,mat,geo,mesh,block,instance,rand,groundZ,props,cylinder,disc,pool}=k;
 const Tb=4.4,Ta=8.8;
 k.keepClear((x,y)=>Math.abs(x)<17&&y>-15&&y<Ta+2.6||y>0&&y<Ta+2.6);
 const t=s.tracks([Tb,Ta]);
 s.station(parts,{scale:.38,y:-7.6});

 const isl=s.platform(Ta,{length:40}),side=s.platform(Tb,{length:40,width:2});
 s.canopy(isl,{from:-17,to:17,color:'#7a6b58'});s.furnish(isl,{name:'臺南'});s.furnish(side,{stairs:false,bench:7});
 s.trackFence(Ta+2.1);

 // 站前：廣場、圓環（草地、噴水池、繞一圈的馬路），外面是中山路。
 s.label('臺南車站',0,-13.6,groundZ+2.28,3.4,.44,{bg:'#e6dfc9',fg:'#5a4a2a',depth:.05});
 s.plaza(0,-15,34,2.6);
 const asphalt=mat('#6b6d68'),lawn=mat('#7fa35e'),pool2=mat('#6f9fae',{roughness:.2,metalness:.2}),rim=mat('#d9d3c4'),C={x:0,y:-17.4,r:3.1};
 const ring=mesh(geo(new THREE.RingGeometry(C.r-.05,C.r+1.5,48)),asphalt,[C.x,C.y,groundZ+.03]);ring.castShadow=false;
 const grass=mesh(geo(new THREE.CircleGeometry(C.r,48)),lawn,[C.x,C.y,groundZ+.05]);grass.castShadow=false;
 instance(cylinder,rim,[C.x,C.y,groundZ+.14],[2.5,2.5,.18]);instance(cylinder,pool2,[C.x,C.y,groundZ+.2],[2.2,2.2,.1]);instance(cylinder,rim,[C.x,C.y,groundZ+.5],[.26,.26,.7]);instance(cylinder,pool2,[C.x,C.y,groundZ+.88],[.5,.5,.08]);
 for(let i=0;i<12;i++){const a=i*Math.PI/6;props.bush(C.x+Math.cos(a)*2.72,C.y+Math.sin(a)*2.72,groundZ+.04,.32);}
 s.road(-18.6,{width:2.4,cars:[[-25,-1],[-12,1],[13,-1],[25,1]]});
 for(const x of [-14,14])s.lamp(x,-15.8,{arm:-1});
 for(let x=-21;x<=-9;x+=2.1)k.car(x,-14.6,{taxi:true,kind:'sedan',yaw:Math.PI});
 s.scooters(9,14.6,-14.4);s.bikes(17.6,-14.4,6);
 k.addLight('entrance',0,-13.4,groundZ+2.2,1.3,7);k.addLight('rotary',C.x,C.y,groundZ+2.6,1,7);

 // 左：榕園，一片草地、三棵大榕樹、樹下石椅。右：騎樓街屋。
 s.plaza(-24.4,-7.2,14,9.6,{color:'#94a678',grid:9});
 for(const [x,y,h] of [[-29.4,-9,3.6],[-22.6,-5,3.9],[-20.4,-10.4,3.2],[-28,-3.8,3.3]])props.broadleaf(x,y,groundZ,h);
 for(const [x,y] of [[-25,-8],[-24,-3.6]]){block(mat('#b9b3a4'),[1.1,.3,.2],[x,y,groundZ+.12]);}
 s.shops(16.4,31.4,-9.2,{floors:[3,4,3,5]});
 k.tower(13.4,-3.2,{w:3.2,d:3,h:5.6,kind:'home'});

 // 站後：巷道、老街屋，遠處一排矮樹。
 s.road(12.6,{width:1.9,cars:[[-16,-1],[9,1]]});
 s.shops(-30,-4,16,{floors:[2,3,2],width:2.7,ground:'shop'});s.shops(6,28,16.2,{floors:[2,2,3],width:2.7,ground:'shop'});
 s.treeRow(-30,30,19,4.6,1.7);

 return s.finish({tracks:t,label:'台南車站',themes:THEMES,anchors:{station:[0,-13,groundZ+3],platform:[0,(isl.y0+isl.y1)/2,isl.z],rotary:[C.x,C.y,groundZ]}});
}
