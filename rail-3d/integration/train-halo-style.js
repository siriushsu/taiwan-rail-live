// A 版自然散光：每節車廂獨立衰減，差異固定在車廂上，不隨時間閃動。
export const HALO_STOPS = [[0,1],[.18,.87],[.4,.5],[.64,.17],[.84,.025],[1,0]];
export function haloNight(sun, dark = false) {
  if (!sun) return dark ? 1 : 0;
  const t = Math.max(0, Math.min(1, (sun.elevation + 6) / 14));
  return 1 - t*t*(3-2*t);
}
const colors = new Map();
export function haloPalette(color, night) {
  let rgb = colors.get(color);
  if (!rgb) {
    let hex = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color) ? color.slice(1) : '438477';
    if (hex.length === 3) hex = [...hex].map(c=>c+c).join('');
    rgb = hex.match(/../g).map(c=>parseInt(c,16)/255); colors.set(color,rgb);
  }
  const warm = [1,198/255,109/255];
  return {rgb:rgb.map((c,i)=>c+(warm[i]-c)*night),strength:.7+.3*night,alpha:(.16+.03*night)*(.7+.3*night)};
}
const variations = [];
function variation(k) {
  if (!variations[k]) { const noise=n=>{const x=Math.sin((n+1)*12.9898+7.2)*43758.5453;return x-Math.floor(x);};
    variations[k]=[noise(k),noise(k+17),noise(k+31),noise(k+53)]; }
  return variations[k];
}
export function scatterCar(before, p, after, radius, k, alpha, emit) {
  const dx=after.x-before.x,dy=after.y-before.y,angle=Math.atan2(dy,dx),spacing=Math.max(1,Math.hypot(dx,dy)/2),n=variation(k);
  const rx=spacing*(1.1+n[0]*.22)+32,ry=(radius*1.25+53)*(.84+n[1]*.38),side=(n[2]-.5)*ry*.34,
    x=p.x-Math.sin(angle)*side,y=p.y+Math.cos(angle)*side,a=alpha*Math.min(1,spacing/rx);
  emit(x,y,angle+(n[3]-.5)*.2,rx,ry,a);
  emit(x-Math.sin(angle)*ry*.22,y+Math.cos(angle)*ry*.22,angle-.12,rx*1.3,ry*1.45,a*.34);
}

// 遠景車牌／圓點共用小型貼圖，畫面更新只 drawImage，不逐車建立漸層。
const sprites = new Map();
export function haloSprite(color, night) {
  const bucket=Math.round(night*20),key=color+':'+bucket;
  if (sprites.has(key)) return sprites.get(key);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
  const ctx=canvas.getContext('2d'),palette=haloPalette(color,bucket/20),rgb=palette.rgb.map(c=>Math.round(c*255)).join(',');
  function cloud(x,y,rx,ry,alpha) { ctx.save();ctx.translate(x,y);ctx.scale(rx,ry);
    const g=ctx.createRadialGradient(0,0,0,0,0,1);for(const [at,a]of HALO_STOPS)g.addColorStop(at,`rgba(${rgb},${a})`);
    ctx.fillStyle=g;ctx.globalAlpha=alpha;ctx.fillRect(-1,-1,2,2);ctx.restore(); }
  cloud(61,65,48,44,palette.alpha*1.3);cloud(68,59,59,54,palette.alpha*.42);
  if(sprites.size>=256)sprites.delete(sprites.keys().next().value);sprites.set(key,canvas);return canvas;
}
