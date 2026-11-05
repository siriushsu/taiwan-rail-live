// 台北車站：1989 年起鐵路在地下，地面上是兩層屋簷的大站房；軌道層做成剖面，鐵路留下的空間變成市民大道。
// 站房是照印象用方料搭的，比例縮過（實際約 190 公尺寬），不是照圖面做的。
import {createStage,themes} from './station-stage.js';

export const THEMES=themes('#e6e9ec','#efd2ba','#0f1827');

export function createScene(){
 const s=createStage({seed:20471,grass:'#8e8a83',trees:[['terminalia',.5],['koelreuteria',.3],['ficus',.2]]}),{k}=s;
 const {M,mat,block,instance,rand,groundZ,props,hip,cylinder}=k;
 const Tb=4.4,Ta=8.8,top=2.8,yCut=1,yRear=13;
 k.keepClear((x,y)=>y>-.2&&y<yRear+1);
 const street=s.cutaway({yCut,top,yRear,rear:1.2,streetColor:'#cfc9bb',rearColor:'#a39f92'});
 block(M.slab,[k.plinthW-.3,yRear-yCut,.05],[0,(yCut+yRear)/2,groundZ+.025]);
 const t=s.overTracks([Tb,Ta],{z:s.railZ,deck:false,mast:1.3});
 const isl=s.platform(Ta,{length:44}),yc=(isl.y0+isl.y1)/2,col=mat('#d4d0c6'),trim=mat('#1f6fb0');
 s.furnish(isl,{name:'臺北'});
 for(let x=-20;x<=20;x+=5){if(Math.abs(x)<3)continue;block(col,[.34,.34,1.9],[x,yc,isl.z+.95]);block(trim,[.36,.36,.1],[x,yc,isl.z+1.2]);}
 block(mat('#c9c5ba'),[44,.3,.14],[0,yc,isl.z+1.96]);
 for(const x of [-15,0,15]){block(M.lamp,[2.4,.14,.04],[x,yc,isl.z+1.86]);k.addLight('platform'+x,x,yc,isl.z+1.7,2,7);}

 // 街面：大站房。米褐石材牆、直條長窗、兩層橘褐色大屋簷。
 s.setGround(street);
 const X=-2,Y=-7.6,W=30,D=10,wall=mat('#b8a489',{roughness:.85}),wallD=mat('#9c8a72',{roughness:.85}),tile=mat('#a9602c',{roughness:.6}),tileD=mat('#7c4620',{roughness:.6}),hall=mat('#e4d9c4');
 block(wallD,[W+.6,D+.6,.5],[X,Y,street+.25]);block(wall,[W,D,4.6],[X,Y,street+2.8]);
 for(const y of [Y-D/2-.02,Y+D/2+.02])for(let i=0;i<20;i++){const x=X-W/2+.8+i*(W-1.6)/19;block(M.glass,[.82,.05,3.2],[x,y,street+2.8]);block(wallD,[.16,.1,3.4],[x+.7,y,street+2.8]);}
 for(const x of [X-W/2-.02,X+W/2+.02])for(let i=0;i<6;i++)block(M.glass,[.05,.9,3.2],[x,Y-D/2+1+i*1.6,street+2.8]);
 block(tileD,[W+1.6,D+1.6,.16],[X,Y,street+5.2]);instance(hip,tile,[X,Y,street+5.28],[W+1.6,D+1.6,1.5]);
 block(wall,[W-8,D-3.4,.9],[X,Y,street+6.6]);for(let i=0;i<14;i++)block(M.glass,[.8,.04,.5],[X-10+i*1.54,Y-(D-3.4)/2-.02,street+6.6]);
 block(tileD,[W-6.6,D-2,.12],[X,Y,street+7.08]);instance(hip,tile,[X,Y,street+7.14],[W-6.6,D-2,1.5]);
 for(const [w,d,z] of [[W+1.6,D+1.6,5.28],[W-6.6,D-2,7.14]]){const zt=street+z+1.5,hx=w/4;s.beam(tileD,[X-hx,Y,zt],[X+hx,Y,zt],.12,.1);
  for(const a of [-1,1])for(const b of [-1,1])s.beam(tileD,[X+a*w/2,Y+b*d/2,street+z],[X+a*hx,Y,zt],.09,.08);
  for(let i=1;i<18;i++){const x=X-w/2+i*w/18;for(const b of [-1,1])s.beam(tileD,[x,Y+b*d/2,street+z],[Math.max(X-hx,Math.min(X+hx,x)),Y,zt],.02,.02);}}
 // 正面門廳：四根大柱、挑高門。
 block(hall,[11,1.3,.3],[X,Y-D/2-.7,street+2.5]);for(const a of [-4.8,-1.6,1.6,4.8])block(wallD,[.5,.5,2.4],[X+a,Y-D/2-1.1,street+1.2]);block(M.glass,[9,.06,2],[X,Y-D/2-.04,street+1.2]);
 s.label('臺北車站',X,Y-D/2-1.38,street+2.5,4.4,.72,{bg:'#3a2f28',fg:'#f0d8a8',depth:.05});

 // 站前：忠孝西路、公車專用道、機車、行道樹，遠處的摩天大樓。
 s.plaza(X,-15,42,3.4,{color:'#d0cabb'});
 s.road(-18.2,{width:2.6});
 for(const x of [-21,-14])k.bus(x,-17.6,{len:3.9,z:street});s.busStop(-17,-16.3,3.8);
 for(let x=7;x<=13;x+=2.1)k.car(x,-14.6,{taxi:true,kind:'sedan',z:street});
 s.scooters(16,19.6,-14.4);s.bikes(-9,-14.2,7);
 for(const x of [-19,-6,6,19])s.lamp(x,-16,{arm:-1});
 k.addLight('entrance',X,-14,street+2.4,1.4,8);k.addLight('plaza',X+11,-15,street+2.6,1,7);
 for(const x of [-23,-3,1])s.planter(x,-15.8,2.2,.6);
 k.tower(25,-8,{w:4.6,d:4.2,h:13,kind:'office',z:street});k.tower(29.6,-13,{w:3.2,d:3,h:8,kind:'office',z:street});k.tower(20.6,-3,{w:3,d:3,h:6,kind:'home',z:street});
 k.tower(-28.4,-11,{w:3.4,d:3.2,h:6.4,kind:'office',z:street});k.tower(-27.6,-4,{w:3.2,d:3,h:5,kind:'home',z:street});
 s.treeRow(-30,30,-19.4,4.6,1.7);
 for(const x of [-22,-14,10,16])s.planter(x,-.2,2,.5);

 // 市民大道：地下軌道上面的矮台地。
 s.setGround(groundZ+1.2);
 s.road(15.2,{width:2.8,cars:[[-26,-1],[-12,1],[2,-1],[17,1],[27,-1]]});
 s.shops(-30,-6,18.4,{floors:[1,1,1],width:2.8,ground:'shop',z:groundZ+1.2});s.shops(4,29,18.4,{floors:[1,1,1],width:2.8,ground:'shop',z:groundZ+1.2});

 return s.finish({tracks:t,label:'台北車站',themes:THEMES,anchors:{station:[X,-14,street+3],platform:[0,yc,isl.z]}});
}
