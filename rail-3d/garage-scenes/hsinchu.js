// 新竹車站：1913 年的巴洛克式站房（鐘塔、馬薩式屋頂、洗石子立面），站前中正路直通迎曦門（東門城）與護城河。
// 不是實際街廓的重建：迎曦門搬到廣場左前方，站後的竹科與十八尖山只取印象。
import {createStage,themes} from './station-stage.js';

export const THEMES=themes('#e6ecef','#f1d6bd','#111b2a',{day:{water:'#4f7d82',shallow:'#7ea79f'},sunset:{water:'#7a6d60',shallow:'#b08f74'},night:{water:'#16252f',shallow:'#27404a'}});

export function createScene(parts){
 const s=createStage({seed:20461,trees:[['koelreuteria',.45],['terminalia',.35],['delonix',.2]]}),{k}=s;
 const {M,mat,block,instance,rand,groundZ,props,prism,hip,cylinder,pool}=k;
 const Tb=.6,Ta=5;
 k.keepClear((x,y)=>y>-11&&y<Ta+2.6);
 const t=s.tracks([Tb,Ta]);
 s.station(parts,{scale:.4,x:-1.8,y:-6});

 const isl=s.platform(Ta,{length:40}),side=s.platform(Tb,{length:40,width:1.7});
 s.canopy(isl,{from:-17,to:17,color:'#5c7b7f'});s.furnish(isl,{name:'新竹'});
 s.furnish(side,{stairs:false,bench:7});
 s.trackFence(Ta+2.1);

 // 站前：廣場、圓環花台、計程車排班、公車站、機車與 YouBike，再過去是中正路。
 s.label('新竹車站',-1.8,-11.32,groundZ+3.26,2.3,.42,{bg:'#d9d6c8',fg:'#3a3a36',depth:.05});
 s.plaza(0,-13.4,48,5.4);
 for(const x of [-7,0,7])s.planter(x,-14.5,3);
 for(let x=8.6;x<=17;x+=2.1)k.car(x,-11.9,{taxi:true,kind:'sedan'});
 s.busStop(-13,-15.2);k.bus(-13,-16.3,{len:3.8});
 s.scooters(18.6,22.6,-11.6);s.bikes(-20,-11.8,7);
 for(const x of [-22,-11,11,22])s.lamp(x,-15.4,{arm:-1});
 k.addLight('entrance',-1.8,-11.6,groundZ+2.3,1.3,7);k.addLight('plaza',0,-14.2,groundZ+2.8,1,7);
 s.road(-17.6);s.crosswalk(3.4,-17.6);s.signal(5.2,-15.9);

 // 迎曦門：花崗岩城台開一個拱門、上面兩層歇山城樓，前面一段護城河。
 const G={x:-27.4,y:-7.4},stone=mat('#a9a595',{roughness:.95}),stoneD=mat('#8f8b7c',{roughness:.95}),hole=mat('#2f2c29'),pillar=mat('#a43a2c'),wallR=mat('#e6dcc5'),roofT=mat('#5b5a54',{roughness:.7}),ridge=mat('#8c4a35');
 block(stone,[5.4,3.4,2.1],[G.x,G.y,groundZ+1.05]);block(stoneD,[5.7,3.7,.22],[G.x,G.y,groundZ+.11]);block(stoneD,[5.6,3.6,.12],[G.x,G.y,groundZ+2.12]);
 for(const y of [G.y-1.71,G.y+1.71]){block(hole,[1.2,.04,1.2],[G.x,y,groundZ+.6]);instance(cylinder,hole,[G.x,y,groundZ+1.2],[1.2,1.2,.04],[Math.PI/2,0,0]);}
 for(let i=0;i<9;i++){const x=G.x-2.6+i*.65;for(const y of [G.y-1.7,G.y+1.7])block(stoneD,[.34,.14,.2],[x,y,groundZ+2.26]);}
 block(wallR,[3.6,2.0,.9],[G.x,G.y,groundZ+2.65]);
 for(let i=0;i<6;i++){const x=G.x-1.85+i*.74;for(const y of [G.y-1.1,G.y+1.1])instance(cylinder,pillar,[x,y,groundZ+2.65],[.13,.13,.92]);}
 instance(hip,roofT,[G.x,G.y,groundZ+3.1],[4.7,3.1,.62]);block(wallR,[2.4,1.3,.5],[G.x,G.y,groundZ+3.55]);instance(hip,roofT,[G.x,G.y,groundZ+3.8],[3.3,2.2,.75]);block(ridge,[1.7,.08,.08],[G.x,G.y,groundZ+4.56]);
 s.label('迎曦',G.x,G.y-1.75,groundZ+1.86,1.1,.32,{bg:'#3a3a36',fg:'#e7d9a8',depth:.04,lit:false});
 k.river(16,1.9,[-24.6,-11.2],{water:'#4f7d82',shallow:'#7ea79f'});
 for(const y of [-10.15,-12.25])block(stoneD,[16,.16,.16],[-24.6,y,groundZ+.08]);
 for(const x of [-30,-26.6,-23.2,-19.8])props.broadleaf(x,-9.7,groundZ,1.8+rand()*.5);

 // 站前兩側：騎樓街屋、百貨大樓。
 s.shops(16.4,31,-8.6,{floors:[4,5,4,6]});
 k.tower(13.6,-9,{w:3.4,d:3,h:7.2,kind:'office'});
 for(const x of [-31,-29,29,31])props.broadleaf(x,-15,groundZ,1.9);
 s.treeRow(-30,30,-19.2,4.4,1.9);

 // 站後：後站小街、機車與矮房，再過去是低矮的公園樹林（十八尖山）。
 s.plaza(0,8.6,50,1.5,{color:'#a5a297'});
 s.road(10.7,{width:2.1,cars:[[-20,-1],[-3,1],[14,-1]]});
 s.shops(-29,-11,14,{floors:[2,3,2,3],width:2.8,ground:'shop'});s.shops(7,27,14.2,{floors:[3,2,2,3],width:2.8,ground:'shop'});
 for(let i=0;i<20;i++){const x=-30+i*3.1,y=17.6+rand()*1.3;if(k.inside(x,y,1.2))props.broadleaf(x,y,groundZ,2+rand()*.8);}

 return s.finish({tracks:t,label:'新竹車站',themes:THEMES,anchors:{station:[-1.8,-10,groundZ+3],platform:[0,(isl.y0+isl.y1)/2,isl.z],gate:[G.x,G.y,groundZ+2]}});
}
