import {createModelBuilder} from './station-models.js';
// 外觀辨識版：保留塔身、飛簷、鏤空與退縮；不宣稱立面與室內為測繪成果。
export function buildLandmark(meta){
 const b=createModelBuilder({glass:'#588e89',roof:'#345d94',gold:'#d5a329',stone:'#d7cdbb',brick:'#b77c64',metal:'#bad1c8'}),W=meta.footprintWidthM,D=meta.footprintDepthM,H=meta.displayHeightM;
 b.frame(0,0,(meta.rotationDeg||0)*Math.PI/180);
 const ring=(w,d,z,cut=.16)=>[[-w/2+cut*w,-d/2,z],[w/2-cut*w,-d/2,z],[w/2,-d/2+cut*d,z],[w/2,d/2-cut*d,z],[w/2-cut*w,d/2,z],[-w/2+cut*w,d/2,z],[-w/2,d/2-cut*d,z],[-w/2,-d/2+cut*d,z]];
 function taper(key,z0,z1,w0,d0,w1,d1,cut=.16){const a=ring(w0,d0,z0,cut),c=ring(w1,d1,z1,cut);for(let i=0;i<8;i++){const j=(i+1)%8;b.quad(key,a[i],a[j],c[j],c[i]);b.tri(key,[0,0,z1],c[i],c[j]);}}
 function bands(key,w,d,from,to,step){for(let z=from;z<to;z+=step){b.box(key,0,0,z,w,d,.45);}}
 if(meta.landmarkType==='taipei101'){
  const W=meta.footprintWidthM*.72,D=meta.footprintDepthM*.72;
  b.box('stone',0,0,14,meta.footprintWidthM,meta.footprintDepthM,28);taper('glass',28,90,W*.72,D*.72,W*.64,D*.64);
  for(let i=0;i<8;i++){const z=90+i*40;taper('glass',z,z+38,W*.61,D*.61,W*.77,D*.77);taper('metal',z+38,z+40,W*.77,D*.77,W*.64,D*.64);}
  taper('glass',410,450,W*.58,D*.58,W*.45,D*.45);taper('metal',450,466,W*.45,D*.45,W*.18,D*.18);taper('metal',466,H,W*.055,D*.055,.6,.6);
 }else if(meta.landmarkType==='tower85'){
  b.box('stone',0,0,16,W,D,32);
  for(const sign of [-1,1]){b.box('glass',sign*W*.33,0,113,W*.29,D*.8,162);b.box('metal',sign*W*.33,0,195,W*.31,D*.82,5);}
  b.box('glass',0,0,218,W*.9,D*.78,50);b.box('glass',0,0,275,W*.4,D*.66,100);
  taper('glass',325,347,W*.4,D*.66,W*.27,D*.45);taper('metal',347,H,W*.055,D*.055,.5,.5);
  // 遠近都以主要分節辨識，省略會形成摩爾紋的密集樓層細線。
 }else if(meta.landmarkType==='shinkong'){
  b.box('brick',0,0,16,W,D,32);b.box('glass',0,0,103,W*.72,D*.77,142);bands('brick',W*.73,D*.78,35,172,8);
  b.box('brick',0,0,186,W*.61,D*.66,24);b.box('glass',0,0,205,W*.49,D*.54,14);taper('brick',212,H,W*.49,D*.54,W*.1,D*.13);
  for(const side of [-1,1])for(const x of [-.28,-.14,0,.14,.28])b.box('brick',x*W,side*D*.39,105,W*.018,.8,142);
 }else if(meta.landmarkType==='cksmh'){
  for(let i=0;i<6;i++)b.box('trim',0,0,1.2+i*2.2,W*(1-i*.05),D*(1-i*.05),2.2);
  b.box('trim',0,0,29,W*.63,D*.63,32);
  for(const side of [-1,1])b.box('window',side*W*.316,0,28,.3,D*.24,25);
  taper('roof',45,53,W*.83,D*.83,W*.40,D*.40,.293);taper('roof',53,66,W*.63,D*.63,W*.15,D*.15,.293);taper('gold',66,H,W*.04,D*.04,.3,.3,.293);
 }else{
  b.box('stone',0,0,1,W,D,2);b.box('brick',0,0,10,W*.73,D*.73,18);
  for(const side of [-1,1])for(let i=0;i<12;i++){const t=(i-5.5)/12;b.box('stone',t*W*.94,side*D*.43,12,1.6,1.6,22);b.box('stone',side*W*.43,t*D*.94,12,1.6,1.6,22);}
  for(const x of [-.12,.12])b.box('stone',x*W,-D*.36,12,1.6,1.6,22);
  const roof=(u,v)=>[u*W/2,v*D/2,27-7*Math.max(Math.abs(u),Math.abs(v))+10.4*Math.pow(Math.abs(u*v),3)];
  for(let x=0;x<20;x++)for(let y=0;y<20;y++){const a=-1+x/10,c=-1+y/10;b.quad('gold',roof(a,c),roof(a+.1,c),roof(a+.1,c+.1),roof(a,c+.1));}
 }
 const root=b.finish();root.name=meta.name;root.userData.landmark=true;return root;
}
