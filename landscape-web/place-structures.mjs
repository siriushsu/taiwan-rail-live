// 在已知座標放入可辨識的遊具和道路洞口。局部座標依序為縱向、橫向、高度（公尺）。
export function appendStructures(detail,groundAt,positions,colors,normals) {
  function frame(x,y,dx,dy) {
    const z=groundAt(x,y);
    return ([a,b,h])=>[x+dx*a-dy*b,z+h,-(y+dy*a+dx*b)];
  }
  let world;
  const paint=new Map();
  function tri(a,b,c,color) {
    const [p,q,r]=[a,b,c].map(world);
    const u=q.map((v,i)=>v-p[i]), v=r.map((w,i)=>w-p[i]);
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const len=Math.hypot(...n)||1;
    let tint=paint.get(color);
    if (!tint) {
      tint=[16,8,0].map(shift=>Math.round(255*((((color>>shift)&255)/255+.055)/1.055)**2.4));paint.set(color,tint);
    }
    for (const vertex of [p,q,r]) {
      positions.push(...vertex);colors.push(...tint,255);
      normals.push(...n.map(i=>Math.round(127*i/len)),0);
    }
  }
  function quad(a,b,c,d,color) {tri(a,b,c,color);tri(a,c,d,color);}
  function box(x,y,z,l,w,h,color) {
    const ring=[[-l/2,-w/2],[l/2,-w/2],[l/2,w/2],[-l/2,w/2]];
    const bot=ring.map(([u,v])=>[x+u,y+v,z]), top=bot.map(p=>[p[0],p[1],z+h]);
    quad(...top,color);
    for(let i=0;i<4;i++) {const j=(i+1)%4;quad(bot[i],bot[j],top[j],top[i],color);}
  }
  const metal=0x789496, timber=0xae825a, blue=0x4a8db0, gold=0xe0ae55, red=0xc86e57;
  for (const [kind,x,y,degrees] of detail.equipment||[]) {
    const a=degrees*Math.PI/180;
    world=frame(x,y,Math.cos(a),Math.sin(a));
    if (kind==='slide') {
      for(const v of [-.51,.51]) {
        box(-1.25,v,0,.10,.1,1.85,metal);
        quad([-1.2,v,1.55],[1.6,v,.24],[1.6,v,.45],[-1.2,v,1.82],gold);
      }
      box(-1.55,0,1.40,.8,1.06,.15,blue);
      quad([-1.2,-.5,1.55],[1.6,-.5,.24],[1.6,.5,.24],[-1.2,.5,1.55],gold);
      for(let i=0;i<5;i++) box(-1.96,0,i*.29+.12,.14,1,.08,metal);
    } else if(kind==='swing'||kind==='basketswing') {
      for(const v of [-1.55,1.55]) for(const s of [-1,1]) {
        quad([s*.95,v,0],[s*.79,v,0],[s*.06,v,2.6],[s*.19,v,2.6],blue);
      }
      box(0,0,2.54,.18,3.35,.16,blue);
      for(const v of [-.72,.72]) {
        for(const s of [-.24,.24]) box(0,v+s,.55,.044,.044,2,metal);
        box(0,v,.49,.33,.60,.09,gold);
      }
    } else if(kind==='seesaw'||kind==='balancebeam'||kind==='horizontal_bar') {
      const h=kind==='horizontal_bar'?1.65:.58;
      for(const u of (kind==='seesaw'?[0]:[-1.25,1.25])) box(u,0,0,.15,.28,h,blue);
      box(0,0,h,3.1,kind==='horizontal_bar'?.08:.24,.10,timber);
      if(kind==='seesaw') for(const u of [-1.25,1.25]) box(u,0,h+.10,.4,.42,.08,red);
    } else if(kind==='climbingframe') {
      for(const u of [-1,0,1]) for(const v of [-.85,.85]) box(u,v,0,.1,.1,2.1,blue);
      for(const h of [.45,.95,1.45,2]) for(const v of [-.85,.85]) box(0,v,h,2.1,.10,.08,gold);
      for(const u of [-1,0,1]) box(u,0,2,.1,1.8,.10,gold);
    } else if(kind==='sandpit') {
      box(0,0,.04,3.8,3.1,.10,0xd7c192);
      for(const v of [-1.55,1.55]) box(0,v,.10,4,.16,.16,timber);
      for(const u of [-1.96,1.96]) box(u,0,.10,.16,3.2,.16,timber);
    } else if(kind==='playhouse') {
      for(const u of [-.90,.90]) for(const v of [-.75,.75]) box(u,v,0,.14,.14,1.8,timber);
      box(0,0,.22,2,1.7,.16,timber);
      for(const s of [-1,1]) quad([-1.15,s*1.05,1.75],[1.15,s*1.05,1.75],[1.15,0,2.4],[-1.15,0,2.4],red);
    } else if(kind==='carousel'||kind==='roundabout') {
      const canopy=kind==='carousel', r=canopy?4.0:1.15;
      for(let i=0;i<16;i++) {
        const a=i*Math.PI/8,b=(i+1)*Math.PI/8;
        const p=[r*Math.cos(a),r*Math.sin(a)],q=[r*Math.cos(b),r*Math.sin(b)];
        tri([0,0,.26],[...p,.26],[...q,.26],timber);
        if(canopy) {
          tri([0,0,4.5],[...p,3.2],[...q,3.2],i%2?gold:red);
          if(i%2===0) {box(p[0]*.75,p[1]*.75,.26,.08,.08,3,metal);box(p[0]*.75,p[1]*.75,1.0,.65,.34,.28,gold);}
        }
      }
      box(0,0,.26,.20,.20,canopy?4:.85,blue);
    }
  }
  for(const [x,y,dx,dy,width,clearance] of detail.tunnels?.portals||[]) {
    world=frame(x,y,dx,dy);
    const radius=width/2+.30, side=1.8, height=clearance?clearance-side:Math.min(5.6,2.7+radius*.25);
    const arch=(angle,rise,spread,depth)=>[depth,Math.cos(angle)*(radius+spread),side+Math.sin(angle)*(height+rise)];
    for(let i=0;i<16;i++) {
      const a=i*Math.PI/16,b=(i+1)*Math.PI/16;
      quad(arch(a,0,0,-.20),arch(b,0,0,-.20),arch(b,.58,.55,-.20),arch(a,.58,.55,-.20),0x918e80);
      tri([.18,0,side],arch(a,0,0,.18),arch(b,0,0,.18),0x212729);
      quad(arch(a,.58,.55,-.20),arch(b,.58,.55,-.20),arch(b,.58,.55,2.2),arch(a,.58,.55,2.2),0x7e8077);
    }
    quad([.18,-radius,-.8],[.18,radius,-.8],[.18,radius,side],[.18,-radius,side],0x202627);
    for(const s of [-1,1]) box(.95,s*(radius+.27),-.7,2.3,.55,side+.71,0x918e80);
  }
}
