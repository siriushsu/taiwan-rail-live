import * as THREE from '../vendor/three.module.js';
// 前後轉向架共用 3D 路徑；車身與車鉤一起俯仰。反向行駛不翻轉車廂。
export function createTerrainFollower(train){
 const forward=new THREE.Vector3(),side=new THREE.Vector3(),up=new THREE.Vector3(),matrix=new THREE.Matrix4(),xAxis=new THREE.Vector3(1,0,0),ends=[],couplers=train.root.children.filter(c=>c.isMesh);
 return function follow(path,s){
  train.root.rotation.set(0,0,0);ends.length=0;
  for(const c of train.cars){const q=s+c.offset,a=path.sample(q+c.length*.3),b=path.sample(q-c.length*.3);forward.set(a.x-b.x,a.y-b.y,a.z-b.z).normalize();side.set(-forward.y,forward.x,0).normalize();up.crossVectors(forward,side).normalize();matrix.makeBasis(forward,side,up);c.car.quaternion.setFromRotationMatrix(matrix);if(c.flip)c.car.rotateZ(Math.PI);c.car.position.set((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2);c.heading=Math.atan2(forward.y,forward.x);c.pitch=Math.atan2(forward.z,Math.hypot(forward.x,forward.y));ends.push({front:c.car.position.clone().addScaledVector(forward,c.length/2).addScaledVector(up,.26),rear:c.car.position.clone().addScaledVector(forward,-c.length/2).addScaledVector(up,.26)});}
  for(let i=0;i<couplers.length;i++){const a=ends[i].rear,b=ends[i+1].front,c=couplers[i];forward.subVectors(b,a);const length=forward.length();c.position.copy(a).add(b).multiplyScalar(.5);c.quaternion.setFromUnitVectors(xAxis,forward.normalize());c.scale.set(length+.08,1,1);}
 };
}
