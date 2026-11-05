// 嘉義車站：1933 年的鋼筋混凝土站房（門廊四根落地大柱），站邊留著老水塔，阿里山林鐵的紅色小車就從這裡出發。
// 不是實際配線的重建：林鐵小車停在站後一段窄軌上。
import {createStage,themes} from './station-stage.js';

export const THEMES=themes('#e8ebe6','#f2d4b6','#111b2a');

export function createScene(parts){
 const s=createStage({seed:20464,trees:[['koelreuteria',.4],['terminalia',.35],['delonix',.25]]}),{k}=s;
 const {M,mat,block,instance,rand,groundZ,props,cylinder,pool}=k;
 const Tb=2.2,Ta=6.6;
 k.keepClear((x,y)=>y>-13&&y<Ta+4.6);
 const t=s.tracks([Tb,Ta]);
 s.station(parts,{scale:.38,y:-6.6});

 const isl=s.platform(Ta,{length:40}),side=s.platform(Tb,{length:40,width:1.8});
 s.canopy(isl,{from:-17,to:17,color:'#677f6b'});s.furnish(isl,{name:'嘉義'});s.furnish(side,{stairs:false,bench:7});

 // 老水塔：四腳鋼筋混凝土架，頂上圓桶。
 const W={x:15.6,y:-3.4},con=mat('#bdb6a6',{roughness:.9}),tank=mat('#c8c2b2');
 for(const a of [-1,1])for(const b of [-1,1])block(con,[.24,.24,4.2],[W.x+a*.8,W.y+b*.8,groundZ+2.1]);
 for(const z of [1.5,2.9]){block(con,[1.8,.12,.12],[W.x,W.y-.8,groundZ+z]);block(con,[1.8,.12,.12],[W.x,W.y+.8,groundZ+z]);block(con,[.12,1.8,.12],[W.x-.8,W.y,groundZ+z]);block(con,[.12,1.8,.12],[W.x+.8,W.y,groundZ+z]);}
 instance(cylinder,tank,[W.x,W.y,groundZ+5],[2.6,2.6,1.7]);instance(cylinder,con,[W.x,W.y,groundZ+5.9],[2.8,2.8,.12]);instance(cylinder,con,[W.x,W.y,groundZ+4.2],[2.8,2.8,.12]);

 // 站後的窄軌與林鐵小車（紅車身、白頂、柴油機車在前）：只停著，不會開。
 const yN=Ta+3.2,steel=mat('#7c7f80',{metalness:.5,roughness:.4}),sleeper=mat('#6d5a46'),red=mat('#b4372b',{roughness:.5}),cream=mat('#efe5cf'),roofM=mat('#d9d3c4'),dark=mat('#2f3336');
 block(mat('#a39d90',{roughness:.95}),[60,1.3,.05],[0,yN,groundZ+.025]);
 for(const s2 of [-.22,.22])block(steel,[60,.05,.06],[0,yN+s2,groundZ+.13]);
 for(let x=-29.6;x<30;x+=.46)block(sleeper,[.12,.72,.05],[x,yN,groundZ+.075]);
 [-3,.4,3.8].forEach(x=>{block(red,[3.1,.86,.72],[x,yN,groundZ+.68]);block(cream,[3.12,.88,.12],[x,yN,groundZ+.76]);block(roofM,[3.1,.92,.08],[x,yN,groundZ+1.09]);for(let i=-3;i<=3;i++)for(const b of [-.44,.44])block(M.glass,[.28,.02,.2],[x+i*.42,yN+b,groundZ+.82]);block(dark,[2.6,.5,.14],[x,yN,groundZ+.25]);});
 block(mat('#c8352a',{roughness:.45}),[2,.8,.56],[-6.1,yN,groundZ+.6]);block(mat('#f0c845'),[2.02,.82,.08],[-6.1,yN,groundZ+.62]);block(red,[.9,.84,.5],[-6.6,yN,groundZ+1.1]);block(M.glass,[.6,.86,.24],[-6.6,yN,groundZ+1.16]);block(dark,[1.6,.5,.14],[-6.1,yN,groundZ+.25]);
 s.label('阿里山森林鐵路',-14,yN+1.2,groundZ+1.4,2.8,.46,{bg:'#7f2a23',fg:'#f7ecd0',facing:Math.PI,depth:.05});for(const a of [-1.3,1.3])block(M.steel,[.06,.06,1.2],[-14+a,yN+1.2,groundZ+.6]);

 // 站前：廣場、中山路，遠處噴水圓環的噴水池。
 s.label('嘉義車站',0,-13.1,groundZ+1.9,2.6,.42,{bg:'#f2efe6',fg:'#20508f',depth:.05});
 s.plaza(0,-14.4,44,3.8);
 for(const x of [-15,-5,5,15])s.planter(x,-15.4,2.6);
 for(let x=-22;x<=-14;x+=2.1)k.car(x,-13.4,{taxi:true,kind:'sedan'});
 s.scooters(13,19,-13.2);s.bikes(23,-13.2,6);
 s.road(-17.8,{width:2.6});s.crosswalk(-2,-17.8);s.signal(0,-16.1);
 for(const x of [-20,-8,8,20])s.lamp(x,-16,{arm:-1});
 k.addLight('entrance',0,-13.4,groundZ+2.3,1.3,7);k.addLight('plaza',-14,-14.2,groundZ+2.6,1,7);
 s.shops(-31.2,-14.6,-8,{floors:[3,4,3,4,5]});s.shops(19,31.4,-8,{floors:[4,3,5,3]});
 s.treeRow(-30,30,-19.3,4.6,1.9);

 // 站後：矮街屋與樹，再過去就是往阿里山的方向。
 s.road(13,{width:1.9,cars:[[-20,1],[2,-1],[19,1]]});
 s.shops(-30,-8,16.4,{floors:[2,2,3],ground:'shop'});s.shops(8,29,16.6,{floors:[2,3,2],ground:'shop'});
 s.treeRow(-28,28,19,4,1.7);

 return s.finish({tracks:t,label:'嘉義車站',themes:THEMES,anchors:{station:[0,-12,groundZ+3],platform:[0,(isl.y0+isl.y1)/2,isl.z],forest:[0,yN,groundZ+1]}});
}
