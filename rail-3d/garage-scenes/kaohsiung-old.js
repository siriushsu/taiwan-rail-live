// 高雄車站：1941 年帝冠式舊站房搬回新站前，旁邊是白色鋁板拼成的雲朵天棚；鐵路 2018 年地下化，軌道層做成剖面，上面原來的路線變成綠園道。
// 校正模型：舊站房照原貌，天棚只切一小塊（白板、柱、屋頂綠化），高度用照片量到的 6.6／10.4 公尺。不是實際配置的重建。
import {createStage,themes} from './station-stage.js';

export const THEMES=themes('#e6e9e8','#f2d3b4','#10192a');

export function createScene([imperial,canopy]){
 const s=createStage({seed:20469,grass:'#8e8a83',trees:[['terminalia',.5],['koelreuteria',.3],['ficus',.2]]}),{k}=s;
 const {M,mat,block,instance,rand,groundZ,props,cylinder}=k;
 const Tb=4.4,Ta=8.8,top=2.8,yCut=1,yRear=13;
 k.keepClear((x,y)=>y>-.2&&y<yRear+1);
 const street=s.cutaway({yCut,top,yRear,rear:1.2,streetColor:'#d3cdbf',rearColor:'#7fa35e'});
 // 坑底：地下軌道層。
 block(M.slab,[k.plinthW-.3,yRear-yCut,.05],[0,(yCut+yRear)/2,groundZ+.025]);
 const t=s.overTracks([Tb,Ta],{z:s.railZ,deck:false,mast:1.3});
 const isl=s.platform(Ta,{length:44}),blue=mat('#1f6fb0',{roughness:.5}),col=mat('#d9d6cc');
 s.furnish(isl,{name:'高雄',stairs:true});
 const yc=(isl.y0+isl.y1)/2;
 for(let x=-20;x<=20;x+=5){if(Math.abs(x)<3)continue;block(col,[.34,.34,1.9],[x,yc,isl.z+.95]);block(blue,[.36,.36,.1],[x,yc,isl.z+1.2]);}
 for(const x of [-15,0,15]){block(M.lamp,[2.4,.14,.04],[x,yc,isl.z+1.86]);k.addLight('platform'+x,x,yc,isl.z+1.7,2,7);}
 block(mat('#c9c5ba'),[44,.3,.14],[0,yc,isl.z+1.96]);

 // 街面（比底座高）：舊站房、雲朵天棚、廣場、博愛路。
 s.setGround(street);
 s.station(imperial,{scale:.36,x:-15,y:-9.4,z:street});
 s.station(canopy,{scale:.36,x:13.4,y:-9.2,z:street,paint:{white:'#f2f2ed',column:'#e0e0dc',ceiling:'#efeee8',green:'#6f9a55'}});
 s.plaza(0,-9,62,16.6,{color:'#d3cec2',grid:2.6});
 // 天棚頂上的綠化：照屋面三角形撒灌木與矮樹，再鋪幾條步道。
 {const g=canopy.parts.get('green').geometry.attributes.position,n=g.count/3;
  for(let i=0;i<150;i++){const t2=Math.floor(rand()*n)*3,x=13.4+.36*(g.getX(t2)+g.getX(t2+1)+g.getX(t2+2))/3,y=-9.2+.36*(g.getY(t2)+g.getY(t2+1)+g.getY(t2+2))/3,z=street+10.4*.36;
   if(i%6===0)props.broadleaf(x,y,z,.9+rand()*.4);else props.bush(x,y,z,.28+rand()*.26);}}
 const lantern=mat('#ffe3b8',{emissive:'#ffcf8a',emissiveIntensity:0}),ball=mat('#3f8fd8',{emissive:'#4fa8ff',emissiveIntensity:0});
 for(const [x,y] of [[6,-4.4],[10,-9.4],[14.2,-5.6],[18,-11.4],[22.4,-7],[26,-3.8],[3.4,-11.6],[27.6,-11.6]]){block(M.steel,[.03,.03,.8],[x,y,street+1.85]);instance(cylinder,lantern,[x,y,street+1.4],[.5,.5,.42]);}
 instance(cylinder,ball,[13.2,-8.2,street+.8],[1,1,1]);block(M.steel,[.6,.6,.3],[13.2,-8.2,street+.15]);
 s.road(-17.6,{width:2.6});s.crosswalk(-3.2,-17.6);s.signal(-1.4,-15.9);
 k.bus(-26,-15.2,{len:3.8,z:street});s.busStop(-25,-14.1);
 for(let x=-6;x<=2;x+=2.1)k.car(x,-14.8,{taxi:true,kind:'sedan',z:street});
 s.scooters(3.6,8,-14.6);s.bikes(-5,-12.9,6);
 for(const x of [-29,-6,4,29])s.lamp(x,-15.4,{arm:-1});
 k.addLight('entrance',-15,-14.6,street+2.2,1.3,7);k.addLight('plaza',13,-9,street+1.7,1.1,7);
 s.treeRow(-30,30,-19.3,5,1.7);
 // 往地下的出入口：玻璃盒子與手扶梯棚。
 const white=mat('#f3f1ea',{roughness:.5});
 for(const x of [-23,-1]){block(M.glass,[3.2,1.6,1.2],[x,-1.6,street+.6]);block(white,[3.5,1.9,.1],[x,-1.6,street+1.25]);}
 s.label('高雄車站',-15,-1.5,street+.8,3.2,.6,{bg:'#0f5ca8',fg:'#ffffff',depth:.06,lit:true,facing:Math.PI});
 for(const x of [-30,-27,-11,-7,5,10,16,22,28])s.planter(x,-.2,2,.5);

 // 綠園道：地下軌道上面的矮台地，自行車道、長椅、矮樹。
 s.setGround(groundZ+1.2);
 s.plaza(0,15,60,1.2,{color:'#c7b89a',grid:9});
 for(let i=0;i<20;i++){const x=-31+i*3.3;if(k.inside(x,17.4,1.4))props.broadleaf(x+(rand()-.5)*.6,17.4+(rand()-.5),groundZ+1.2,1.3+rand()*.4);}
 for(const x of [-20,-6,8,22]){block(mat('#8b6f52'),[1.1,.26,.06],[x,13.9,groundZ+1.48]);s.lamp(x+2,13.8,{h:1.9,r:1.4,arm:1});}

 const b=s.finish({tracks:t,label:'高雄車站',themes:THEMES,anchors:{station:[-15,-14,street+2],platform:[0,yc,isl.z],canopy:[13.4,-9,street+3]},update(time,theme){lantern.emissiveIntensity=theme.lamp*1.4;ball.emissiveIntensity=theme.lamp*1.2;}});
 return b;
}
