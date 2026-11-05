// 台中舊站：1917 年的紅磚站房與鐘塔，後方是 2016 年高架化的新站（白色大拱頂），舊軌道留成綠空鐵道的步道。
// 不是實際線形的重建；新站的拱頂只取印象。
import {createStage,themes} from './station-stage.js';

export const THEMES=themes('#e6ebec','#f1d5ba','#111a2a');

export function createScene(parts){
 const s=createStage({seed:20463,trees:[['terminalia',.5],['koelreuteria',.3],['ficus',.2]]}),{k}=s;
 const {THREE,M,mat,block,instance,rand,groundZ,props,cylinder,pool}=k;
 const Tb=2.2,Ta=6.64;
 k.keepClear((x,y)=>y>-12&&y<Ta+2.8);
 const t=s.overTracks([Tb,Ta],{station:14});
 s.station(parts,{scale:.38,x:4,y:-7.4});

 // 高架月台與新站的白色拱頂（柱子立在兩股外側，車身不擋）。
 const isl=s.platform(Ta,{length:26,width:3,edge:.72,z:t.z,bottom:t.z-.73});
 s.furnish(isl,{name:'臺中',stairs:false,bench:5});
 const white=mat('#f1f2ee',{roughness:.45,metalness:.2}),steel=mat('#cfd3d3',{metalness:.5,roughness:.4});
 s.vault(-15,15,Tb-1.6,Ta+1.6,t.z+3.1,1.3,white,{ribs:steel,step:2.5});
 for(let x=-15;x<=15.1;x+=5)for(const y of [Tb-1.6,Ta+1.6])block(steel,[.2,.2,3.8],[x,y,t.z+1.2]);
 for(const x of [-9,0,9]){block(M.lamp,[1.4,.14,.04],[x,(isl.y0+isl.y1)/2,isl.z+1.9]);k.addLight('platform-'+x,x,(isl.y0+isl.y1)/2,isl.z+1.8,2,7);}
 // 高架底下：穿堂的玻璃量體。
 block(white,[24,Ta-Tb+3,.4],[0,(Ta+Tb)/2,t.z-.93]);block(M.glass,[20,Ta-Tb+1.6,2.7],[0,(Ta+Tb)/2,groundZ+1.4]);
 for(let x=-10;x<=10;x+=2.5)block(steel,[.1,Ta-Tb+1.7,2.7],[x,(Ta+Tb)/2,groundZ+1.4]);

 // 舊月台與留下來的舊軌道：步道、草皮、木棧。
 const old=k.line({y:-1.9,z:s.railZ});k.ballastTrack(old);
 block(mat('#8ea06f',{roughness:.95}),[64,2.6,.03],[0,-1.9,groundZ+.03]);
 const oldP=s.platform(-1.9,{side:-1,length:26,width:1.3,x:4});
 for(let x=-26;x<=-10;x+=3.2)props.bush(x,-.5,groundZ,.5);for(let x=20;x<=30;x+=3.2)props.bush(x,-.5,groundZ,.5);
 for(const x of [-24,-14,-4,12,22])s.lamp(x,-.2,{arm:-1,h:2.1,r:1.6});

 // 站前：台灣大道、公車、計程車，右手邊紅磚老屋與新大樓。
 s.label('臺中車站',4,-10.5,groundZ+3.05,2.4,.42,{bg:'#e6dfc9',fg:'#5a3a2a',depth:.05});
 s.plaza(4,-13.4,44,4,{color:'#c9bfae'});
 for(const x of [-8,4,16])s.planter(x,-13.8,2.8);
 s.road(-17,{width:3.2,cars:[[-25,-1],[-16,1],[-5,-1],[8,1],[19,-1],[27,1]]});
 s.busStop(-13,-14.6);k.bus(-13,-15.8,{len:3.9,z:groundZ+.02});s.busStop(19,-14.6);
 for(let x=-18;x<=-16;x+=2)k.car(x,-12.4,{taxi:true,kind:'sedan'});
 s.scooters(20,24,-12.4);s.bikes(-23,-12.6,6);
 for(const x of [-20,-6,10,24])s.lamp(x,-15.2,{arm:-1});
 k.addLight('entrance',4,-11.8,groundZ+2.3,1.3,7);k.addLight('plaza',-10,-13.2,groundZ+2.6,1,7);
 const brick=mat('#a65a42',{roughness:.85}),trim=mat('#e5dfd0');
 block(brick,[7,3.4,2.8],[-27,-8,groundZ+1.4]);block(trim,[7.2,3.6,.14],[-27,-8,groundZ+2.86]);block(trim,[7.1,3.5,.1],[-27,-8,groundZ+1.5]);
 for(let x=-29.7;x<=-24.2;x+=1.1){block(M.glass,[.62,.04,.8],[x,-9.72,groundZ+2.1]);block(M.glass,[.62,.04,.8],[x,-9.72,groundZ+.7]);}
 s.shops(-31,-18.4,-3.6,{floors:[3,3,4,3],ground:'shop'});
 k.tower(29,-10,{w:3.6,d:3.2,h:8.4,kind:'office'});k.tower(24.6,-9.4,{w:3.2,d:3,h:6,kind:'home'});
 s.treeRow(-30,30,-19.2,5,1.9);

 // 站後：矮街屋與公園。
 s.road(10.4,{width:2,cars:[[-22,-1],[-4,1],[15,-1]]});
 s.shops(-30,-6,14.2,{floors:[2,3,2,3],ground:'shop'});s.shops(6,29,14.4,{floors:[3,2,3],ground:'shop'});
 s.treeRow(-30,30,18.6,3.6,1.8);

 return s.finish({tracks:t,label:'台中舊站',themes:THEMES,anchors:{station:[4,-11,groundZ+3],platform:[0,(isl.y0+isl.y1)/2,isl.z]}});
}
