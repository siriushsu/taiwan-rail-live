// 佛光山佛陀紀念館典藏的佛光大佛，佛身 48 公尺。館方記載右手蓮花印、左手與願印。
// https://www.fgsbmc.org.tw/tw/collection-object.aspx?serno=234
import * as THREE from './engine/vendor/three.module.js';

export function seatedBuddha() {
  const group=new THREE.Group(), spheres=[], tubes=[];
  const skin=0xd6a954,robe=0xc39a4f,fold=0xa67b3e,hair=0xac854a;
  const temp=new THREE.Object3D();
  function oval(x,y,z,rx,ry,rz,color,tilt=0,yaw=0) {
    temp.position.set(x,y,z);temp.scale.set(rx,ry,rz);temp.rotation.set(0,yaw,tilt);
    temp.updateMatrix();spheres.push([temp.matrix.clone(),color]);
  }
  function line(coords,r,color) {
    const curve=new THREE.CatmullRomCurve3(coords.map(p=>new THREE.Vector3(...p)));
    tubes.push([new THREE.TubeGeometry(curve,Math.max(8,coords.length*3),r,6,false),color]);
  }
  function limb(a,b,width,depth,color) {
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b);
    temp.position.copy(start).lerp(end,.5);
    temp.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),end.clone().sub(start).normalize());
    temp.scale.set(width,end.distanceTo(start)*.5+width*.47,depth);
    temp.updateMatrix();spheres.push([temp.matrix.clone(),color]);
  }
  function turning(profile,color,depth=1) {
    const geom=new THREE.LatheGeometry(profile.map(([x,y])=>new THREE.Vector2(x,y)),64);
    geom.scale(1,1,depth);tubes.push([geom,color]);
  }
  turning([[0,0],[13.4,0],[14.8,.7],[15,1.3],[14,1.8],[13.6,2.1],[14.9,2.8],[15.2,3.5],[13.4,4.7],[0,4.7]],0xb59961,.79);
  for(let i=0;i<32;i++) {
    const a=i*Math.PI/16;
    oval(13.7*Math.sin(a),3,10.7*Math.cos(a),1.6,1.65,.8,0xd0ad6e,0,a);
  }
  // 盤坐雙膝與衣褶沿座面展開，中軸朝向成佛大道。
  oval(0,7.3,-.5,15,4.3,9,robe);
  oval(-6.3,7.7,4.2,8.8,3.4,4.5,robe,-.09,-.20);
  oval(6.0,7.5,4.5,8.6,3.35,4.4,robe,.1,.22);
  oval(-1.5,9.9,5.4,5.3,1.35,1.9,skin,-.14,-.2);
  oval(2.9,10.4,4.2,3.9,1.25,1.55,skin,.11,.27);
  turning([[0,7],[6.9,7.4],[8.8,11.2],[7.8,15.5],[8.2,20.5],[9.7,25],[10.3,27.7],[9.1,29.4],[5.6,30.6],[3.1,30.7],[0,30.5]],robe,.62);
  oval(0,31.3,0,3.8,3.5,3.1,skin);
  for(let i=0;i<6;i++) {
    const y=13.1+i*2.4;
    line([[-7.3,y+4.3,2.3],[-5.1,y+1,4.2],[0,y-.1,5.05],[5.2,y+1.4,4.25],[7.7,y+3.3,2.5]],.16,fold);
  }
  limb([8.5,27,-.5],[11.2,17,1.6],3.3,3.35,robe);
  limb([11.1,17.0,1.5],[8.4,13.8,6.5],2.15,2.1,skin);
  oval(7,13.75,7.1,2.45,.81,1.7,skin,-.25,.2);
  for(let i=0;i<4;i++)limb([5.9+i*.62,13.65,7.15],[5.1+i*.71,13.55,8.65+.2*Math.sin(i)],.32,.29,skin);
  limb([-8.1,26.9,-.4],[-10.6,18.7,2.7],3.2,3.2,robe);
  limb([-10.6,18.8,2.9],[-9.3,25.5,6.3],1.65,1.75,skin);
  oval(-9.1,26.7,6.45,1.32,2.15,.74,skin,-.06);
  for(let i=0;i<3;i++)line([[-9.8+i*.62,27.8,6.45],[-10+i*.62,29.4+Math.sin(i)*.4,6.7],[-9.85+i*.62,30.1+Math.sin(i)*.4,6.6]],.30,skin);
  line([[-8.55,27.6,6.65],[-8.2,28.6,6.8],[-8.6,29.05,7],[-9.05,28.5,7.3]],.33,skin);
  line([[-8.15,26.4,6.7],[-7.95,27.4,7.2],[-8.4,28.2,7.4],[-9,28.5,7.3]],.34,skin);
  oval(0,36.7,.12,4.33,5.5,3.85,skin);
  for(const side of [-1,1]) {
    oval(side*4.06,35.6,.03,.8,2.6,.86,skin,side*.1);
    line([[side*.7,37.2,3.82],[side*1.6,37.47,3.65],[side*2.65,37.12,3.1]],.11,fold);
    line([[side*.85,36.72,3.85],[side*1.7,36.49,3.65],[side*2.55,36.77,3.18]],.085,fold);
  }
  oval(0,36.0,3.65,.56,1.15,.68,skin);
  line([[-1.05,34.55,3.25],[0,34.47,3.58],[1.05,34.55,3.25]],.10,fold);
  oval(0,39.15,-.18,4.35,3.65,3.8,hair);
  for(let j=0;j<6;j++) {
    const a=.04+j*.245,count=Math.max(6,Math.round(28*Math.cos(a)));
    for(let i=0;i<count;i++) {
      const b=2*Math.PI*(i+(j%2)*.45)/count;
      const x=4.1*Math.cos(a)*Math.sin(b),y=39.25+3.4*Math.sin(a),z=3.6*Math.cos(a)*Math.cos(b)-.18;
      oval(x,y,z,.54,.51,.54,hair);
    }
  }
  oval(0,42.7,-.3,1.78,1.7,1.7,hair);
  oval(0,44.1,-.35,.73,.68,.75,hair);
  const matte=new THREE.MeshStandardMaterial({roughness:.54,metalness:.24});
  const inst=new THREE.InstancedMesh(new THREE.SphereGeometry(1,18,12),matte,spheres.length);
  spheres.forEach(([m,c],i)=>{inst.setMatrixAt(i,m);inst.setColorAt(i,new THREE.Color(c));});
  inst.computeBoundingSphere();group.add(inst);
  const materials=new Map();
  for(const [g,c] of tubes) {
    if(!materials.has(c))materials.set(c,new THREE.MeshStandardMaterial({color:c,roughness:.57,metalness:.23,side:THREE.DoubleSide}));
    group.add(new THREE.Mesh(g,materials.get(c)));
  }
  group.rotation.y=70*Math.PI/180;
  group.scale.setScalar(48/(44.78-4.7));
  group.position.y=36;
  return group;
}
