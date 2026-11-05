// 保安車站（台南仁德）：1909 年的檜木站房，「永保安康」車票的那個保安，站前一排大王椰子，站後是田。
// 不是實際街廓的重建。
import {createStage,themes} from './station-stage.js';

export const THEMES=themes('#e9ece4','#f3d6b6','#121c2a');

export function createScene(parts){
 const s=createStage({seed:20465,grass:'#8c9a68',trees:[['delonix',.4],['koelreuteria',.3],['acacia',.3]]}),{k}=s;
 const {M,mat,block,instance,rand,groundZ,props,cylinder}=k;
 const Tb=.6,Ta=5;
 k.keepClear((x,y)=>y>-12&&y<Ta+2.6);
 const t=s.tracks([Tb,Ta]);
 s.station(parts,{scale:.46,y:-3.8});

 const isl=s.platform(Ta,{length:30}),side=s.platform(Tb,{length:30,width:.9});
 s.canopy(isl,{from:-10,to:10,color:'#7c6a54',post:'#7a6a58',step:2.5,lights:2});s.furnish(isl,{name:'保安'});
 s.trackFence(Ta+2.1,{color:'#8d8676'});

 // 站前：小廣場、永保安康的紀念牌、木條長椅。大王椰子排在站前路兩邊。
 s.label('保安車站',2.6,-6.86,groundZ+1.9,1.5,.3,{bg:'#efe9dc',fg:'#3a2a1c',depth:.04});
 s.plaza(0,-10.4,22,4.4,{color:'#c9c2ae'});
 const red=mat('#a93226',{roughness:.5});
 s.label('永保安康',-6.4,-9.4,groundZ+1,2.4,.62,{bg:'#a93226',fg:'#f8e7b5',depth:.08});for(const a of [-1,1])block(red,[.09,.09,.72],[-6.4+a,-9.4,groundZ+.36]);
 for(const x of [4,6.6]){block(mat('#7f6a50'),[1.6,.3,.06],[x,-11.2,groundZ+.32]);for(const a of [-.6,.6])block(mat('#6a5844'),[.08,.26,.3],[x+a,-11.2,groundZ+.16]);}
 for(const x of [-10,-3,3,10])s.planter(x,-12,1.8,.6);
 for(const x of [-13.4,-9.6,9.6,13.4])s.palm(x,-9.6,4);
 for(const x of [-21,-17.2,17.2,21])s.palm(x,-13.4,3.6);
 s.scooters(11.4,14.2,-11);s.bikes(-13,-11.2,5);
 s.road(-15.4,{width:2.2,cars:[[-22,-1],[-2,1],[17,-1]]});
 for(const x of [-16,16])s.lamp(x,-13.2,{arm:-1});
 k.addLight('entrance',0,-8.8,groundZ+2,1.2,6);k.addLight('plaza',0,-11,groundZ+2.4,.9,6);
 // 街尾幾間矮屋、雜貨店，田邊農舍。
 s.shops(-31,-18,-9.4,{floors:[2,2,1,2],ground:'shop'});s.shops(18.4,31,-9.4,{floors:[2,1,2],ground:'shop'});
 for(let x=-30;x<=30;x+=4.4)if(Math.abs(x)>1)props.broadleaf(x,-18.8,groundZ,1.9+rand()*.7);

 // 站後：稻田、農舍、田埂上的電線桿。
 s.fields(-30,-3,8.2,17.6);s.fields(3,18.6,8.2,17.6);
 block(mat('#c2b596'),[1.6,12,.04],[0,14,groundZ+.03]);
 props.farmhouse(-22,18.4,groundZ,{tint:1});props.farmhouse(12,18.6,groundZ,{tint:2,pitched:false});
 for(const x of [-26,-13,0,13,26])props.pole(x,7.6,groundZ,2.6);
 for(const [x,y] of [[-29,12],[-16,18.4],[-5,18.8],[4,18.6],[22,18.8],[29,14]])props.broadleaf(x,y,groundZ,1.7+rand()*.5);
 const cane=mat('#6f9a4e');for(let y=9;y<=16.8;y+=.6)for(let x=20;x<=29;x+=.8)if(rand()<.8){block(cane,[.05,.05,.8],[x,y,groundZ+.44]);block(cane,[.34,.05,.03],[x,y,groundZ+.82],[0,.5,rand()*3]);}

 return s.finish({tracks:t,label:'保安車站',themes:THEMES,anchors:{station:[0,-6.8,groundZ+1.5],platform:[0,(isl.y0+isl.y1)/2,isl.z],sign:[-6.4,-9.4,groundZ+1]}});
}
