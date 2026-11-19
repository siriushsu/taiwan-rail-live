// 總統府立面。座標沿圖磚原模型的兩翼（s 向北、t 向西），保留原有量體與兩座天井。
// 拱形、白色橫帶、複柱依總統府建築介紹 https://www.president.gov.tw/Page/91 取形。
const brick = [.48,.16,.11], limestone = [.88,.81,.66], trim = [.74,.67,.55];
const reveal = [.095,.065,.056], glass = [.115,.16,.18], bronze = [.27,.225,.15];

export function presidentialFacade(THREE, east, north, base, near) {
  const positions=[], colors=[], indices=[];
  const az=5.7*Math.PI/180, sn=Math.sin(az), cs=Math.cos(az);
  function wall(s0,t0,s1,t1) {
    const length=Math.hypot(s1-s0,t1-t0), ds=(s1-s0)/length, dt=(t1-t0)/length;
    function point(x,z,depth) {
      const s=s0+ds*x+dt*depth, t=t0+dt*x-ds*depth;
      return [east+s*sn-t*cs,north+s*cs+t*sn,base+z];
    }
    function quad(a,b,c,d,color) {
      const start=positions.length/3;
      for(const p of [a,b,c,d]) { positions.push(...point(...p)); colors.push(...color); }
      indices.push(start,start+1,start+2,start,start+2,start+3);
    }
    function rect(x0,x1,z0,z1,d,color) {
      quad([x0,z0,d],[x1,z0,d],[x1,z1,d],[x0,z1,d],color);
    }
    function ledge(x0,x1,z,h,d) {
      rect(x0,x1,z,z+h,d,limestone);
      quad([x0,z+h,d],[x1,z+h,d],[x1,z+h,.1],[x0,z+h,.1],trim);
      quad([x0,z,.1],[x1,z,.1],[x1,z,d],[x0,z,d],trim);
    }
    // 深窗洞、窗額與窗台共用同一扇窗的輪廓。拉遠只保留能讀出窗距的輪廓。
    function window(x,z,w,h,rise,portico=false) {
      const d=portico ? .35 : .33, radius=w/2, spring=z+h-rise;
      const frame=portico ? .38 : (near ? .19 : .24), steps=rise ? (near?8:4) : 1;
      const fill=portico?reveal:glass;
      rect(x-radius-frame,x+radius+frame,z,spring,d,limestone);
      rect(x-radius,x+radius,z+.05,spring+.01,d+.035,fill);
      let last;
      for(let i=0;i<=steps;i++) {
        const a=Math.PI*(1-i/steps), c=Math.cos(a), s=Math.sin(a);
        const inner=[x+radius*c,spring+rise*s,d+.035];
        const outer=[x+(radius+frame)*c,spring+(rise+frame)*s+(rise?0:frame),d+.055];
        if(last) {
          if(rise) quad([last.inner[0],spring,d+.035],[inner[0],spring,d+.035],inner,last.inner,fill);
          quad(last.inner,inner,outer,last.outer,limestone);
        }
        last={inner,outer};
      }
      if(near) {
        ledge(x-radius-.36,x+radius+.36,z-.2,.20,d+.18);
        if(!portico) {
          rect(x-.065,x+.065,z+.04,z+h-.08,d+.075,bronze);
          rect(x-radius,x+radius,spring-.42,spring-.29,d+.075,bronze);
        }
        if(rise) rect(x-.15,x+.15,z+h-.06,z+h+frame+.14,d+.10,trim);
      }
    }
    function bays(n,{court=false,corner=false}={}) {
      const pitch=length/n;
      const levels=corner?[2.5,6.8,11.1,15.4,19.7,23.3]:[2.5,6.8,11.1,15.4,19.7];
      for(const [floor,z] of levels.entries()) {
        if(!court && near) rect(length*.033,length*.967,z-.04,z+1.76,.20,brick);
        const w=Math.min(pitch*.52,corner?2.35:2.12), rise=floor===3?w/2:(floor===2||floor===4) ? .5 : 0;
        for(let i=0;i<n;i++) window((i+.5)*pitch,z,w,floor===4?2.05:2.72,rise);
      }
      if(!court) {
        ledge(0,length,21.95,.40,.58);
        if(corner) ledge(0,length,26.70,.44,.70);
        if(near) for(let i=1;i<n;i++) {
          const x=i*pitch;
          for(const shift of [-.30,.30]) {
            const u=x+shift;
            rect(u-.13,u+.13,9.5,19.3,.38,trim);
            ledge(u-.23,u+.23,9.35,.29,.49);
            ledge(u-.25,u+.25,19.25,.32,.5);
          }
        }
      }
    }
    function column(x) {
      const count=near?10:6;
      // 柱腳、微收分的柱身與柱頭共用同一組剖面。
      const profile=[[.15,.37],[.48,.37],[.68,.24],[7.50,.21],[7.72,.32],[7.95,.39],[8.55,.39]];
      for(let i=1;i<profile.length;i++) {
        const [bottom,rb]=profile[i-1], [top,rt]=profile[i];
        for(let k=0;k<count;k++) {
          const a=k*2*Math.PI/count,b=(k+1)*2*Math.PI/count;
          const ring=(angle,r,z)=>[x+r*Math.cos(angle),z,.58+r*Math.sin(angle)];
          quad(ring(b,rb,bottom),ring(a,rb,bottom),ring(a,rt,top),ring(b,rt,top),limestone);
        }
      }
    }
    function pediment(left,right,z,rise) {
      const center=(left+right)/2;
      for(const [a,b,za,zb] of [[left,center,z,z+rise],[center,right,z+rise,z]]) {
        quad([a,z,.44],[b,z,.44],[b,zb,.44],[a,za,.44],trim);
        quad([a,za,.55],[b,zb,.55],[b,zb+.32,.55],[a,za+.32,.55],limestone);
      }
      ledge(left-.18,right+.18,z-.27,.29,.60);
    }
    return {length,window,bays,ledge,column,pediment,rect};
  }
  // 東西長翼、兩端與角樓，窗列在中央入口及轉角中斷。
  for(const [s0,s1] of [[-48,-13],[13.5,48]]) wall(s0,-39.5,s1,-39.5).bays(8);
  for(const [s0,s1] of [[-13,-6],[6,13.5]]) wall(s0,-40.2,s1,-40.2).bays(2);
  for(const [s0,s1] of [[48,13.4],[-13,-48]]) wall(s0,36,s1,36).bays(8);
  for(const s of [61.7,-63.8]) {
    const t=s>0?-30:30;
    wall(s,t,s,-t).bays(13);
  }
  for(const [s0,s1] of [[-61.5,-48],[48,61.5]]) {
    wall(s0,-41.5,s1,-41.5).bays(3,{corner:true});
    wall(s1,40.5,s0,40.5).bays(3,{corner:true});
  }
  const central=wall(-6,-40.2,6,-40.2);
  central.rect(0,12,10.02,23.6,.21,brick);
  for(const x of [2.15,6,9.85]) {
    central.window(x,11.15,2.28,4.02,.62);
    central.window(x,16.95,2.38,4.52,1.19);
  }
  central.ledge(0,12,15.55,.38,.52);
  central.pediment(-.24,12.24,22.65,2.46);
  const entrance=wall(-6,-43,6,-43);
  for(const x of [2,6,10]) entrance.window(x,.3,2.86,7.9,1.43,true);
  for(const x of [.27,3.66,4.34,7.66,8.34,11.73]) entrance.column(x);
  entrance.ledge(-.2,12.2,8.72,.46,.68);
  entrance.ledge(-.44,12.44,9.65,.38,.91);
  if(near) {
    for(const [s0,s1] of [[12.4,46],[-46,-12]]) {
      wall(s1,-22,s0,-22).bays(8,{court:true});
      wall(s0,19,s1,19).bays(8,{court:true});
      wall(s0,-22,s0,19).bays(9,{court:true});
      wall(s1,19,s1,-22).bays(9,{court:true});
    }
  }
  for(const [a,b] of [[[-5.2,-36.5],[5.8,-36.5]],[[5.8,-36.5],[5.8,-25.5]],
                       [[5.8,-25.5],[-5.2,-25.5]],[[-5.2,-25.5],[-5.2,-36.5]]]) {
    const shaft=wall(...a,...b);
    for(const x of [.54,10.46]) shaft.rect(x-.23,x+.23,26.4,39.1,.23,limestone);
    for(const x of [3.7,7.3]) {
      shaft.window(x,27.4,2.22,4.2,.5);
      shaft.window(x,33.0,2.22,4.9,1.11);
    }
    shaft.ledge(0,shaft.length,38.9,.48,.48);
  }
  // 塔冠的四向深拱與角柱維持在原紅磚塔身內，原來的八角段與銅帽仍露出。
  for(const [a,b] of [[[-4.6,-35.9],[5.2,-35.9]],[[5.2,-35.9],[5.2,-26.1]],
                       [[5.2,-26.1],[-4.6,-26.1]],[[-4.6,-26.1],[-4.6,-35.9]]]) {
    const face=wall(...a,...b);
    for(const x of [3.0,6.8]) face.window(x,40.4,2.15,7.75,1.08);
    face.ledge(0,face.length,48.5,.50,.68);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
