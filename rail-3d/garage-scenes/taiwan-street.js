import * as THREE from '../vendor/three.module.js';
import {cable} from './scene-detail-kit.js';
// 參考青年路平交道照片的街屋密度與混合立面；招牌為自寫通用店種。
export function taiwanStreet(k){
 const {mat,block,beam,props,instance}=k,concrete=mat('#b2ae9e'),dark=mat('#3b4140'),tin=mat('#557d79'),rust=mat('#98745a'),glass=props.glass;
 block(mat('#70736d'),[64,3.8,.08],[0,6.8,.04]);block(mat('#777973'),[54,2.7,.075],[-2,-7.4,.0375]);
 // 橫巷止於主道路邊，紅白路緣各段不完全整齊。
 for(const side of [-1,1])for(let x=4.5;x<31;x+=1.2)block(mat(Math.floor(x)%3?'#bd5444':'#d4cbb5'),[1.0,.15,.12],[side*x,8.65,.1]);
 const specs=[[-27,11.1,4.5,2,1],[-22.4,11.3,4.3,3,2],[-17.8,11.0,4.6,2,3],[-13.1,10.8,4.3,3,0],[-8.4,11.4,4.3,2,4],[8.3,11.4,4.2,3,1],[12.6,11.0,4.3,2,0],[17.0,11.25,4.1,3,4],[21.4,11.1,4.4,2,2],[26,11.5,4.5,3,3]];
 const names=['早餐','機車行','五金','便當','茶飲','小吃','電器','洗衣','雜貨','麵店'],walls=['#c6b9a0','#cbc6b5','#a8b5b0','#cab29c','#b4b6a9'];
 specs.forEach(([x,y,w,f,t],i)=>{
  const H=f*1.5+(i%3)*.25,m=mat(walls[t]);block(m,[w,4,H],[x,y,H/2]);block(concrete,[w+.1,4.1,.18],[x,y,H+.09]);
  // 背巷立面也保留窗、後門及排水管，旋轉到背面不只剩空白方塊。
  for(let level=0;level<f;level++)for(const dx of [-w*.26,w*.26]){block(glass,[.70,.07,.70],[x+dx,y+2.05,level*1.5+.75]);block(concrete,[.75,.14,.05],[x+dx,y+2.08,level*1.5+.38]);block(dark,[.04,.08,.72],[x+dx,y+2.1,level*1.5+.75]);}
  block(mat('#697b74'),[.7,.09,1.3],[x,y+2.055,.66]);block(mat('#8c9684'),[.075,.1,H],[x-w*.43,y+2.08,H/2]);
  block(mat('#92968a'),[w*.85,.08,1.15],[x,y-2.047,.65]);for(let z=.18;z<1.2;z+=.09)block(mat('#717b73'),[w*.84,.018,.02],[x,y-2.094,z]);
  for(let level=1;level<f;level++)for(const dx of [-w*.25,w*.25]){block(glass,[.93,.075,.90],[x+dx,y-2.05,level*1.5+.65]);for(let d=-.36;d<.4;d+=.18)block(dark,[.035,.13,1],[x+dx+d,y-2.14,level*1.5+.65]);block(concrete,[1.13,.60,.09],[x+dx,y-2.26,level*1.5+.14]);
   block(mat('#cbcabc'),[.65,.35,.42],[x+dx+.35,y-2.34,level*1.5+.15]);for(let l=0;l<4;l++)block(dark,[.49,.025,.024],[x+dx+.35,y-2.53,level*1.5+.03+l*.08]);}
  const awn=mat(i%3===0?'#3e7770':i%3===1?'#8e6b57':'#667e88');block(awn,[w+.15,1.4,.10],[x,y-2.6,1.55],[.12,0,0]);for(let dx=-w/2;dx<w/2;dx+=.18)block(mat('#b5b19e'),[.025,1.35,.025],[x+dx,y-2.6,1.62],[.12,0,0]);
  for(const dx of [-w/2+.1,w/2-.1])block(dark,[.06,.06,1.55],[x+dx,y-3.13,.8]);
  const bg=['#b44331','#ddd1a2','#386e77','#4b765c','#c7933e'][i%5],fg=i%5===1?'#884033':'#f4ead1';k.label(names[i],x,y-2.76,2.08,w*.9,.66,{bg,fg,lit:true});
  // 附掛窄招牌、加蓋、儲水桶、落水管與局部補丁。
  if(i%2===0)k.label(names[i],x-w*.43,y-3.0,3.75,.65,1.9,{bg,fg,vertical:true,lit:true});
  if(i%3!==1){const roof=mat(i%3===0?'#797b71':'#7b8c85');block(roof,[w*.85,2.8,.16],[x-.12,y+.25,H+.65],[.13,0,0]);for(let dx=-w*.4;dx<w*.4;dx+=.25)block(mat('#a2a895'),[.023,2.8,.025],[x+dx-.12,y+.25,H+.74],[.13,0,0]);}else{for(const yy of [y-1.9,y+1.9])block(concrete,[w,.12,.55],[x,yy,H+.3]);block(rust,[w*.35,2.2,.15],[x-w*.26,y+.5,H+.5],[.14,0,0]);}
  instance(k.cylinder,mat('#cacbc0',{metalness:.4,roughness:.4}),[x+w*.3,y+.8,H+.68],[.40,.40,1.15]);
  block(mat('#847e6a'),[.07,.09,H],[x+w/2-.12,y-2.1,H/2]);
  for(let j=0;j<3;j++){const xx=x-w*.4+j*w*.28;block(mat('#918e7c'),[.2,.035,.23+j*.04],[xx,y-2.098,.24]);}
  // 騎樓旁堆箱、瓦斯桶、盆栽保留在道路外。
  for(let j=0;j<2;j++){block(mat('#ab8e60'),[.40,.43,.38],[x+w*.3,y-2.9+j*.5,.27]);props.bush(x-w*.35,y-2.9,.36,.25);}
 });
 // 後巷不是空白草坪：低矮加蓋、牆後植栽與不規則小院。
 block(mat('#999b88'),[63,9,.05],[0,19,.025]);
 for(const [x,y,w,d]of [[-27,18,5,4],[-19,20,6,5],[-10,19,4,4],[7,18,5,4],[15,21,6,4],[25,19,5,5]]){block(mat('#bab39c'),[w,d,2.3],[x,y,1.15]);block(mat(x<0?'#797e76':'#7b8c85'),[w+.25,d+.25,.16],[x,y,2.42],[0,.08,0]);for(let dx=-w/2;dx<w/2;dx+=.3)block(mat('#a0a391'),[.03,d+.2,.03],[x+dx,y,2.53],[0,.08,0]);for(const dx of [-w*.3,w*.3])block(glass,[.9,.07,.8],[x+dx,y-d/2-.04,1.2]);}
 for(const [x,y]of [[-31,23],[-23,25],[-15,24],[-3,18],[4,24],[20,25],[31,23],[-31,-9],[31,-8]])props.broadleaf(x,y,0,2.5+k.rand());
 for(let i=0;i<35;i++)props.bush(-30+k.rand()*60,24+k.rand()*2,0,.4+k.rand()*.4);
 // 前景保留低矮店屋，朝路的一面和背面都有門窗與屋簷。
 for(const [x,w,t]of [[-24,6,1],[-15,5,0],[16,5,2],[25,6,3]]){props.townhouse(x,-12,0,{width:w,depth:4,floors:2,tint:t,facing:Math.PI,ground:'shop',roof:t%2?'tin':'pitched',back:true});}
 // 長短不一的水泥牆、磚塊補牆與張貼布告，避開軌道淨空。
 for(const side of [-1,1]){for(let x=8;x<31;x+=.7){block(mat('#927e64'),[.67,.19,.80],[side*x,4.0,.4]);for(const z of [.15,.38,.61])block(mat('#baa18a'),[.63,.21,.018],[side*x,4.0,z]);}block(mat('#d6ccb2'),[.65,.024,.42],[side*13,3.892,.48]);}
 // 多束下垂電纜與引入線；鐵道上方保持足夠淨空。
 for(const x of [-29,-18,-6,6,18,29]){props.pole(x,5.2,0,5.2);block(mat('#92968e'),[.28,.30,.65],[x,5.05,4.4]);for(const dx of [-.35,0,.35])instance(k.cylinder,mat('#bbb9a6'),[x+dx,5.2,5.16],[.10,.10,.17]);}
 for(const [a,b]of [[-29,-18],[-18,-6],[-6,6],[6,18],[18,29]])for(let j=0;j<3;j++)cable(k,[[a,5.05+j*.16,5.2],[(a+b)/2,5.05+j*.16,4.55-j*.1],[b,5.05+j*.16,5.2]],dark,.022);
 for(const x of [-18,6,18])cable(k,[[x,5.2,4.9],[x+1,8.2,4.2],[x+2,10,4.5]],dark,.023);
 // 道路補丁、人孔蓋、排水格柵、路邊固定機車與零星三角錐。
 for(const [x,y,w,d]of [[-.3,-12,1.4,2.5],[2.2,10,1,2],[-1.2,7,1.3,1.8]])block(mat('#626762'),[w,d,.016],[x,y,.158]);
 instance(k.cylinder,mat('#525d59'),[-1.4,-10,.175],[.46,.46,.024]);
 for(const x of [-3.65,3.65])for(let y=-15;y<16;y+=3){block(dark,[.42,.6,.024],[x,y,.20]);for(let j=0;j<5;j++)block(concrete,[.36,.03,.026],[x,y-.22+j*.11,.215]);}
 let parked=0;for(const x of [-27,-25.5,-20,-18.5,-12,9,10.5,15,23,25]){const y=7.35+(parked%2)*.25,a=(parked%3-1)*.25;block(mat(parked%2?'#8e9a95':'#a85446'),[.44,1.0,.50],[x,y,.60],[0,0,a]);block(dark,[.45,.57,.13],[x,y-.12,.9],[0,0,a]);for(const dy of [-.34,.34])instance(k.cylinder,dark,[x,y+dy,.30],[.22,.22,.12],[0,Math.PI/2,0]);beam(dark,[x-.3,y+.35,1.0],[x+.3,y+.35,1.0],.05);parked++;}
 for(const [x,y]of [[-4.4,-10],[5.0,7],[-17,7.3]]){block(dark,[.40,.40,.06],[x,y,.2]);const g=k.geo(new THREE.ConeGeometry(.17,.48,8));g.rotateX(Math.PI/2);k.mesh(g,mat('#c77944'),[x,y,.46]);}
 for(const [x,y]of [[-13,7],[14,7.5],[-5.4,-9]]){block(mat('#956e4d'),[.5,.5,.4],[x,y,.2]);props.bush(x,y,.4,.35);}
 k.label('停 看 聽',-5.15,-4.8,1.8,1.65,.48);
 return{buildings:20,parkedScooters:parked,reference:'青年路平交道街景（2011 原照），非現況復刻'};
}
