import * as THREE from '../vendor/three.module.js';

// 以弧長參數取樣，車身、轉向架、道床及月台共用同一條曲線。
export function coastalPath() {
  const radius=92, limit=36;
  return {length:180,trackStart:-36,trackLength:72,
    sample(s){const a=Math.max(-limit,Math.min(limit,s)),h=a/radius,d=s-a;
      return {x:radius*Math.sin(h)+d*Math.cos(h),y:radius*(1-Math.cos(h))+d*Math.sin(h),z:4,heading:h};}
  };
}
export function offsetPath(path,offset,reverse=false){return {...path,sample(s){const p=path.sample(reverse?-s:s);return {...p,x:p.x-Math.sin(p.heading)*offset,y:p.y+Math.cos(p.heading)*offset,heading:p.heading+(reverse?Math.PI:0)};}};}
export function offsetPoint(path,s,n,z){const p=path.sample(s);return [p.x-Math.sin(p.heading)*n,p.y+Math.cos(p.heading)*n,z??p.z];}
export function ribbon(k,path,start,end,left,right,bottom,top,material){
 const shape=new THREE.Shape(),N=Math.ceil((end-start)/.7);
 for(let i=0;i<=N;i++){const p=offsetPoint(path,start+(end-start)*i/N,left);i?shape.lineTo(p[0],p[1]):shape.moveTo(p[0],p[1]);}
 for(let i=N;i>=0;i--){const p=offsetPoint(path,start+(end-start)*i/N,right);shape.lineTo(p[0],p[1]);}shape.closePath();
 return k.mesh(new THREE.ExtrudeGeometry(shape,{depth:top-bottom,bevelEnabled:false}),material,[0,0,bottom]);
}
// bars（可選）：三道橫桿離 z 的高度；不給就是原本的 [.18,.62,height]。
export function fence(k,path,start,end,n,z,material,height=1.05,bars=[.18,.62,height]){
 for(let s=start;s<=end;s+=.62){const p=offsetPoint(path,s,n,z+height/2);k.block(material,[.065,.065,height],p);}
 for(const h of bars)for(let s=start;s<end;s+=.6)k.beam(material,offsetPoint(path,s,n,z+h),offsetPoint(path,Math.min(end,s+.6),n,z+h),.07);
}
export function cable(k,points,material,width=.025){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));for(let i=0;i<24;i++)k.beam(material,curve.getPoint(i/24).toArray(),curve.getPoint((i+1)/24).toArray(),width);}
// 連續高程網格，外緣封到基座；頂面每個面有些微土色與植被差異。
export function hillside(k,point,nx=48,ny=18){
 const vertices=[],colors=[],green=new THREE.Color(),add=(a,b,c,color)=>{vertices.push(...a,...b,...c);green.set(color);for(let i=0;i<3;i++)colors.push(green.r,green.g,green.b);};
 const ground=[];for(let j=0;j<=ny;j++){ground[j]=[];for(let i=0;i<=nx;i++)ground[j][i]=point(i/nx,j/ny);}
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const a=ground[j][i],b=ground[j][i+1],c=ground[j+1][i],d=ground[j+1][i+1],shade=['#5f7d50','#638153','#607e50','#648154','#668356'][(i*13+j*7)%5];add(a,b,d,shade);add(a,d,c,shade);const base=p=>[p[0],p[1],-.35];add(base(a),base(d),base(b),'#72715c');add(base(a),base(c),base(d),'#72715c');}
 const edge=[...ground[0],...ground.slice(1).map(r=>r[nx]),...ground[ny].slice(0,-1).reverse(),...ground.slice(1,-1).reverse().map(r=>r[0])];
 for(let i=0;i<edge.length;i++){const a=edge[i],b=edge[(i+1)%edge.length],c=[a[0],a[1],-.35],d=[b[0],b[1],-.35];add(a,c,b,'#72715c');add(b,c,d,'#72715c');}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();return k.mesh(g,k.mat('#ffffff',{vertexColors:true,flatShading:true}));
}
// 空心山體：截面有真正的隧道孔，內壁、兩端及外側均成面，不以實心山球蓋住軌道。
export function tunnelRidge(k,path,start,end){
 const outer=[[-5.8,3.55],[-5.2,6.0],[-3.8,8.9],[-1.1,11.2],[2.1,13.5],[5.8,14.4],[7.4,10.5],[7.4,3.55]];
 const inner=[[-1.70,3.78],[1.70,3.78],[1.70,5.8]];
 for(let i=1;i<=24;i++){const a=Math.PI*i/24;inner.push([1.7*Math.cos(a),5.8+1.7*Math.sin(a)]);}
 const shape=new THREE.Shape(outer.map(p=>new THREE.Vector2(...p)));shape.holes.push(new THREE.Path(inner.map(p=>new THREE.Vector2(...p))));
 const cap=new THREE.ShapeGeometry(shape),v=cap.getAttribute('position');
 const frontProfile=[[-3.2,3.55],[-3.1,4.6],[-2.5,6.5],[-1.1,8.2],[2.1,8.8],[4.8,8.0],[5.4,5.5],[5.4,3.55]];
 const world=(s,p)=>offsetPoint(path,s,p[0],p[1]),N=24;
 const outerAt=(t,j)=>{const f=t*t*(3-2*t),a=frontProfile[j],b=outer[j];return[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f+Math.sin(t*Math.PI)*.3*Math.sin(j*3+t*8)];};
 for(const [s,t]of [[start,0],[end,1]]){const profile=outer.map((_,j)=>outerAt(t,j)),sh=new THREE.Shape(profile.map(p=>new THREE.Vector2(...p)));sh.holes.push(new THREE.Path(inner.map(p=>new THREE.Vector2(...p))));const g=new THREE.ShapeGeometry(sh),arr=g.getAttribute('position');for(let i=0;i<arr.count;i++)arr.setXYZ(i,...world(s,[arr.getX(i),arr.getY(i)]));g.computeVertexNormals();k.mesh(g,k.mat('#888d72',{side:THREE.DoubleSide,flatShading:true}));}cap.dispose();
 for(const [profile,color]of [[outer,'#628153'],[inner,'#66665c']]){const vs=[],ids=[];for(let i=0;i<=N;i++){const s=start+(end-start)*i/N;for(let j=0;j<profile.length;j++)vs.push(...world(s,profile===outer?outerAt(i/N,j):profile[j]));}const count=profile.length;for(let i=0;i<N;i++)for(let j=0;j<count;j++){const a=i*count+j,b=i*count+(j+1)%count,c=a+count,d=b+count;ids.push(a,b,d,a,d,c);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vs,3));g.setIndex(ids);g.computeVertexNormals();k.mesh(g,k.mat(color,{side:THREE.DoubleSide,flatShading:true}));}
 for(let i=0;i<95;i++){const t=.03+k.rand()*.94,j=1+Math.floor(k.rand()*5),f=k.rand(),a=outerAt(t,j),b=outerAt(t,j+1),p=world(start+(end-start)*t,[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f]);if(i%4===0)k.props.broadleaf(...p,1.2+k.rand()*.8);else k.props.bush(...p,.4+k.rand()*.5);}
 const front=start,concrete=k.mat('#b4b1a0');
 for(let i=0;i<24;i++){const a=Math.PI*i/24,b=Math.PI*(i+1)/24;k.beam(concrete,world(front,[1.9*Math.cos(a),5.8+1.9*Math.sin(a)]),world(front,[1.9*Math.cos(b),5.8+1.9*Math.sin(b)]),.34);}
 for(const side of [-1,1])k.beam(concrete,world(front,[side*1.9,3.8]),world(front,[side*1.9,5.8]),.34);
 return {start,end,clearance:1.7};
}
// handHeight（可選）：扶手「頂面」在踏階鼻上方多高（垂直量）。給了，扶手與下橫桿就與踏階鼻連線平行（斜率 rise/tread），立柱從踏面頂立到扶手中心線；
// 不給就是原本的樣子（立柱 .94、扶手離踏面約 1.0，扶手兩端與踏階鼻連線不平行——那組數字只在扶手很高的時候看不出來）。
export function staircase(k,{x,y,z,width=2.4,steps=12,rise=.16,tread=.32,angle=0,railColor='#408eaa',handHeight}){
 const stone=k.mat('#aaa997'),edge=k.mat('#d5cfb9'),rail=k.mat(railColor),hand=k.mat('#675f4f'),transform=(a,b,c)=>[x+a*Math.cos(angle)-b*Math.sin(angle),y+a*Math.sin(angle)+b*Math.cos(angle),c];
 for(let i=0;i<steps;i++){const h=(i+1)*rise;k.block(stone,[width,tread,h],transform(0,(i+.5)*tread,z+h/2),[0,0,angle]);k.block(edge,[width,.055,.035],transform(0,i*tread+.04,z+h+.018),[0,0,angle]);}
 for(const side of [-1,1]){
  if(handHeight!==undefined){const lx=side*(width/2-.05),r0=z+rise,hc=handHeight-.045/Math.cos(Math.atan(rise/tread)),low=.27*handHeight; // r0＝踏階鼻連線在 y=0 的高（第一階踏面）；hc＝扶手中心線離連線的高（頂面再扣掉半個扶手粗）
   for(let i=0;i<=steps;i++){const base=z+Math.min(i+1,steps)*rise,top=r0+i*rise+hc;k.block(rail,[.065,.065,top-base],transform(lx,i*tread,(base+top)/2));}
   k.beam(hand,transform(lx,0,r0+hc),transform(lx,steps*tread,r0+steps*rise+hc),.09);k.beam(rail,transform(lx,0,r0+low),transform(lx,steps*tread,r0+steps*rise+low),.07);continue;}
  for(let i=0;i<=steps;i++){const h=z+Math.min(i+1,steps)*rise;k.block(rail,[.065,.065,.94],transform(side*(width/2-.05),i*tread,h+.47));}k.beam(hand,transform(side*(width/2-.05),0,z+rise+1),transform(side*(width/2-.05),steps*tread,z+steps*rise+1),.09);k.beam(rail,transform(side*(width/2-.05),0,z+rise+.25),transform(side*(width/2-.05),steps*tread,z+steps*rise+.25),.07);}
 return{bottom:transform(0,0,z),top:transform(0,steps*tread,z+steps*rise),steps,rise,tread};
}
