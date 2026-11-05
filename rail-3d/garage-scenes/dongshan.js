// 冬山車站（宜蘭線）：東部幹線第一座高架車站，一道道白色鋼拱撐起半透明的膜，像放大的瓜棚；橋下是紅磚站房，四周是蘭陽平原的水田，後面是山。
// 校正模型自帶橋面、月台、拱與膜；不是實際街廓的重建。橋面上兩股之間的月台在模型裡，軌道在月台兩側。
import {createStage,themes} from './station-stage.js';

export const THEMES=themes('#e3ecef','#f0d6bf','#101b2b');

export function createScene(parts){
 const s=createStage({seed:20468,grass:'#8fa26c',trees:[['koelreuteria',.35],['terminalia',.35],['trema',.3]]}),{k}=s;
 const {M,mat,block,instance,rand,groundZ,props,cylinder}=k;
 const S=.38,Y=.4,Tb=Y-6.2,Ta=Y+6.2;
 k.keepClear((x,y)=>y>Y-10&&y<Y+10);
 const t=s.overTracks([Tb,Ta],{z:groundZ+11*S,deck:false,mast:1.32});
 s.station(parts,{scale:S,y:Y,paint:{arch:'#dcdcd6',metal:'#7f8486',structure:'#b4afa2',brick:'#9c4a34',paving:'#b7b4a8',label:'#d8b451'}});
 // 膜是半透明的：車從下面過看得見。
 for(const o of k.group.children)if(o.name==='station-membrane'){o.material.transparent=true;o.material.opacity=.42;o.material.color.set('#f0eee4');o.castShadow=false;}
 const deckZ=groundZ+12.1*S;
 for(const x of [-14,0,14])k.addLight('platform'+x,x,Y,deckZ+2,2.2,8);
 s.label('冬山',-6,Y+.6,deckZ+.7,1.7,.48,{bg:'#fbfbf7',fg:'#17396b',band:'#1f5fa8',facing:Math.PI,depth:.05});s.label('冬山',-6,Y-.6,deckZ+.7,1.7,.48,{bg:'#fbfbf7',fg:'#17396b',band:'#1f5fa8',depth:.05});
 for(const x of [-16,-11,11,16])for(const y of [-2,2]){block(mat('#6f93a8',{roughness:.5}),[1.1,.24,.05],[x,Y+y,deckZ+.21]);block(M.steel,[.9,.2,.2],[x,Y+y,deckZ+.1]);}

 // 站前：廣場、馬賽克裝置牆、計程車與機車，外面是馬路。
 s.plaza(0,-10.8,34,4.6,{color:'#c9c2ae'});
 const tiles=['#c8503c','#e0a93f','#2f7f8f','#3f5f9e','#e9e4d3'].map(c=>mat(c,{roughness:.5}));
 for(let i=0;i<24;i++)for(let j=0;j<5;j++)block(tiles[(i*3+j*2)%5],[.26,.05,.26],[-12+i*.28,-11.5,groundZ+.24+j*.28]);
 block(mat('#8d8676'),[7,.14,1.5],[-8.8,-11.42,groundZ+.75]);
 for(const x of [4,10])s.planter(x,-12.4,2.4);
 for(let x=6;x<=12.4;x+=2.1)k.car(x,-9.4,{taxi:true,kind:'sedan'});
 s.scooters(14,17,-9.6);s.bikes(-13.6,-9.4,5);
 s.road(-14.6,{width:2.3});s.crosswalk(-4,-14.6);
 for(const x of [-16,-3,10,20])s.lamp(x,-13,{arm:-1});
 k.addLight('entrance',0,-7,groundZ+2.4,1.3,7);k.addLight('plaza',0,-11,groundZ+2.6,1,7);
 s.shops(-31,-18,-8.6,{floors:[3,3,4],ground:'shop'});s.shops(20,31.4,-8.6,{floors:[3,4,3],ground:'shop'});

 // 水田：前後都是。後面再上去是山，遠處淡一點。
 s.fields(-31,31,-19.4,-16.2,3.6,1.6);
 s.fields(-31,31,Y+9.2,16.2,3.6,2.3);
 for(const [x,y,t2] of [[-24,-18,1],[12,-18,2]])props.farmhouse(x,y,groundZ,{tint:t2});
 for(const x of [-28,-14,0,14,28])props.pole(x,-15.9,groundZ,2.6);
 const edge=(x,y)=>Math.min(1,(33-Math.abs(x))/4.4)*Math.min(1,(20-y)/1.6);
 const h=(x,y)=>{const d=y-16;if(d<=0)return 0;const e=Math.max(0,edge(x,y));return e*(d*1.7+.8*Math.sin(x*.27)+.5*Math.sin(x*.61+y));};
 s.terrain(-32.8,32.8,15.8,19.9,h,{nx:50,ny:6,colors:['#6f8f72','#779679','#6a8a6d','#7b9a7c']});
 for(let i=0;i<16;i++){const x=-31+i*4.1;if(Math.abs(x)>2)props.broadleaf(x,-15.8,groundZ,1.6+rand()*.7);}

 return s.finish({tracks:t,label:'冬山車站',themes:THEMES,anchors:{station:[0,Y-5.7,groundZ+1.3],platform:[0,Y,deckZ],arch:[0,Y,groundZ+23*S]}});
}
