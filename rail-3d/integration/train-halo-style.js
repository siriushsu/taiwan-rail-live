// 自然散光：每節車廂獨立衰減，差異固定在車廂上，不隨時間閃動。
export const HALO_STOPS = [[0,1],[.18,.87],[.4,.5],[.64,.17],[.84,.025],[1,0]];
export function haloNight(sun, dark = false) {
  if (!sun) return dark ? 1 : 0;
  const t = Math.max(0, Math.min(1, (sun.elevation + 6) / 14));
  return 1 - t*t*(3-2*t);
}
const colors = new Map();
// opts.warmMix===false(自製列車專用):深夜只免顏色的暖色混合,strength/alpha 仍照 night 走——
// 不能靠傳 night=0 代替,那樣連亮度、透明度都會一起變成全場最淡。
export function haloPalette(color, night, opts) {
  let rgb = colors.get(color);
  if (!rgb) {
    let hex = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color) ? color.slice(1) : '438477';
    if (hex.length === 3) hex = [...hex].map(c=>c+c).join('');
    rgb = hex.match(/../g).map(c=>parseInt(c,16)/255); colors.set(color,rgb);
  }
  const warm = [1,198/255,109/255];
  const mixed = opts && opts.warmMix === false ? rgb : rgb.map((c,i)=>c+(warm[i]-c)*night);
  return {rgb:mixed,strength:.7+.3*night,alpha:(.16+.03*night)*(.7+.3*night)};
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
// 快取鍵要帶 opts:自製車跟同色真車若共用同一把 color+bucket 鍵,會拿到對方畫好的(暖色混合不同)貼圖。
const sprites = new Map();
export function haloSprite(color, night, opts) {
  const bucket=Math.round(night*20),own=opts&&opts.warmMix===false?'own':'',size=(opts&&opts.size)||1,key=color+':'+bucket+':'+own+':'+size;
  if (sprites.has(key)) return sprites.get(key);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
  const ctx=canvas.getContext('2d'),palette=haloPalette(color,bucket/20,opts),rgb=palette.rgb.map(c=>Math.round(c*255)).join(',');
  function cloud(x,y,rx,ry,alpha) { ctx.save();ctx.translate(x,y);ctx.scale(rx,ry);
    const g=ctx.createRadialGradient(0,0,0,0,0,1);for(const [at,a]of HALO_STOPS)g.addColorStop(at,`rgba(${rgb},${a})`);
    ctx.fillStyle=g;ctx.globalAlpha=alpha;ctx.fillRect(-1,-1,2,2);ctx.restore(); }
  cloud(61,65,48*size,44*size,palette.alpha*1.3);cloud(68,59,59*size,54*size,palette.alpha*.42);
  if(sprites.size>=256)sprites.delete(sprites.keys().next().value);sprites.set(key,canvas);return canvas;
}
// 自製列車名牌:光環關著時,3D 近看改畫這個——長相跟真車 2D 車牌一致
// (台鐵/林鐵＝實心圓角藥丸,高鐵＝兩端尖頭白底橘框),不再是舊版的洋紅底白虛線框。只靠光環/名字
// 辨識這是自製車,車牌本身完全比照真車(見 my-train-plan.js 的車牌顏色段與 index.html drawTag/drawHSRTag)。
// 這張貼圖是離線產生(沒有 map 畫面可比對),沒有 index.html 的 pal() 可用;外框固定用淺色系那組
// (#fffdf6,同 MAP_PAL.light.tagOutline 的值)而不隨底圖主題變化——這張貼圖背後是任意 3D 場景像素,
// 不像 2D 車牌背後只有三種底圖色版之一,本來就沒有「正確跟著哪個主題」這回事,固定一色是刻意簡化
// 不是漏做。
const HSR_ORANGE_3D = '#E85D0D';
const TAG_OUTLINE_3D = '#fffdf6';
// 跟 index.html 的 textColorFor 同一條公式(含同一個門檻值 150);兩個獨立的 script 執行環境
// (這裡是動態 import 的 ES module)不共用函式,故意留一份小拷貝而不是隱性依賴全域函式。
function textColorFor3D(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#fff';
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#111' : '#fff';
}
const nameplates = new Map();
// isHSR:布林,決定畫哪一種牌形——快取鍵要帶這個,否則同一個 label+color 撞到不同牌形會拿錯貼圖。
// frame:成就給的車牌框 {bg,line,ink,dbl}(MyTrainPlan.PLATES),比例照 index.html 的 drawOwnPlate。
export function nameplateSprite(label, color, isHSR, frame) {
  const key = (isHSR ? 'hsr' : 'std') + ':' + color + ':' + label + ':' + (frame ? JSON.stringify(frame) : '');
  if (nameplates.has(key)) return nameplates.get(key);
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 80;
  const ctx = canvas.getContext('2d');
  ctx.font = '700 30px system-ui, "PingFang TC", "Microsoft JhengHei", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const textWidth = ctx.measureText(label).width, padX = 22, w = Math.min(240, Math.max(70, textWidth + padX * 2)), h = 52,
    x = (256 - w) / 2, y = (80 - h) / 2, midY = 40;
  // 比照 index.html drawHSRTag 的比例(HSR_NOSE/TAG_H = 5/15):兩端尖角、白底橘框橘字。
  // 藥丸牌：圓角半徑＝牌高一半，跟 2D drawTag（rx 7.5／TAG_H 15）同比例
  const path = inset => {
    const x0 = x + inset, x1 = x + w - inset, y0 = y + inset, y1 = y + h - inset, rx = (y1 - y0) / 2, nose = h / 3;
    ctx.beginPath();
    if (isHSR) {
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1 + nose, midY);
      ctx.lineTo(x1, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0 - nose, midY);
    } else {
      ctx.moveTo(x0 + rx, y0); ctx.arcTo(x1, y0, x1, y1, rx); ctx.arcTo(x1, y1, x0, y1, rx);
      ctx.arcTo(x0, y1, x0, y0, rx); ctx.arcTo(x0, y0, x1, y0, rx);
    }
    ctx.closePath();
  };
  path(0);
  ctx.fillStyle = frame ? frame.bg : isHSR ? '#fffdf6' : color; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = frame || !isHSR ? TAG_OUTLINE_3D : HSR_ORANGE_3D; ctx.stroke();
  if (frame) {
    ctx.strokeStyle = frame.line;
    if (frame.dbl) { path(2.6); ctx.lineWidth = 2.8; ctx.stroke(); path(7.6); ctx.stroke(); } else { path(4.3); ctx.lineWidth = 4.5; ctx.stroke(); }
  }
  ctx.fillStyle = frame ? frame.ink : isHSR ? HSR_ORANGE_3D : textColorFor3D(color);
  ctx.fillText(label, 128, midY + 1);
  if (nameplates.size >= 8) nameplates.delete(nameplates.keys().next().value); nameplates.set(key, canvas);
  return canvas;
}
