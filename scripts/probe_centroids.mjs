// 對齊探針圓心(純函式,無 I/O):輸入 RGBA buffer,輸出洋紅(#ff00ff,底圖引擎畫)與青色(#00ffff,overlay 畫)兩顆探針的圓心。
// 不用「看得見的像素質心」——真機錄影裡探針常被壓掉一塊(列車卡片邊緣、路線帶、站名、HUD),質心會被推離圓心;
// 09-03 第一支真機錄影就這樣假紅(x 對到 0.4px、y 卻差 29px,全是遮擋)。改成「已知半徑的圓擬合」:
// 取色塊的邊緣像素,RANSAC 找出最多邊緣點落在半徑 r 圓周上的圓心,再用內點做定半徑最小平方精修;
// 被遮住那一段的邊緣不在圓周上,自然是離群點。圓周至少要看得見 MIN_ARC 才算量到(否則回 null＝這一幀沒有可用探針)。
// 半徑由呼叫端依 dpr 給:洋紅 circle-radius 18css → 18·dpr;青色 ctx.arc 半徑 5css → 5·dpr
// (主畫布 dpr 上限 2,但 CSS 會把畫布放大回裝置像素,所以最終畫面上仍是 5·dpr)。
// 顏色門檻放寬到影片壓縮(yuv420p 色度次取樣)後仍抓得到。
export const MIN_ARC = 0.35, RIM_TOL = 2.5, MIN_PIX = 12;
export const isMag = (r, g, b) => r >= 150 && b >= 150 && g <= 110;
export const isCyn = (r, g, b) => g >= 150 && b >= 150 && r <= 110;

// 色塊的邊緣像素(4 鄰域有一個不是同色,或貼著畫面邊界)。
function rim(rgba, w, h, test) {
  const mask = new Uint8Array(w * h);
  let n = 0;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) if (test(rgba[p], rgba[p + 1], rgba[p + 2])) { mask[i] = 1; n++; }
  if (n < MIN_PIX) return null;
  const pts = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!mask[i]) continue;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) pts.push([x, y]);
  }
  return pts;
}

// 已知半徑 r 的圓擬合:RANSAC(兩個邊緣點決定兩個候選圓心)取「看得見的圓周角度」最廣者,再定半徑精修。
// 回 { x, y, n: 內點數, arc: 看得見的圓周比例(36 個 10° 角度格裡有內點的比例) } 或 null。
// 為什麼用角度格不用內點數:遮擋物的直邊(列車卡片、HUD 邊緣)會在錯的圓心附近排出一整串「剛好落在圓周容差內」的
// 邊緣像素,內點數會被灌水——09-04 自測實例:洋紅只剩 22% 真弧,錯圓心 (+13px) 卻收到 47 個內點(0.42 圓周)而勝出,
// 那些內點只占 12/36 個角度格;真圓心 30 個內點散在 10 格。角度格量的是「圓周有多少方向看得見」,直邊灌不了水。
const NB = 36;
export function fitCircle(pts, r) {
  if (!pts || pts.length < 3) return null;
  const score = (cx, cy) => { // 內點數 n 與有內點的角度格數 nb
    let n = 0, nb = 0; const bins = new Uint8Array(NB);
    for (const p of pts) {
      const dx = p[0] - cx, dy = p[1] - cy; if (Math.abs(Math.hypot(dx, dy) - r) > RIM_TOL) continue;
      n++; const b = (((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * NB) | 0) % NB; if (!bins[b]) { bins[b] = 1; nb++; }
    }
    return { n, nb };
  };
  let seed = 20260903; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; // 固定種子,結果可重現
  const N = pts.length, iters = Math.min(600, N * 4);
  let best = null, bestN = 0, bestNb = 0;
  for (let it = 0; it < iters; it++) {
    const a = pts[(rnd() * N) | 0], b = pts[(rnd() * N) | 0];
    const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
    if (d < 1 || d > 2 * r) continue;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, hh = Math.sqrt(Math.max(0, r * r - d * d / 4));
    for (const s of [1, -1]) {
      const cx = mx - s * hh * dy / d, cy = my + s * hh * dx / d;
      const sc = score(cx, cy);
      if (sc.nb > bestNb || (sc.nb === bestNb && sc.n > bestN)) { bestNb = sc.nb; bestN = sc.n; best = [cx, cy]; }
    }
  }
  if (!best || bestNb < MIN_ARC * NB) return null;
  let [cx, cy] = best;
  for (let k = 0; k < 6; k++) { // 定半徑最小平方:每個內點各給一個「沿半徑方向退 r」的圓心估計,取平均,迭代收斂
    let sx = 0, sy = 0, n = 0;
    for (const p of pts) { const ex = p[0] - cx, ey = p[1] - cy, dd = Math.hypot(ex, ey); if (!dd || Math.abs(dd - r) > RIM_TOL) continue; sx += p[0] - r * ex / dd; sy += p[1] - r * ey / dd; n++; }
    if (!n) break; cx = sx / n; cy = sy / n;
  }
  const fin = score(cx, cy);
  if (fin.nb < MIN_ARC * NB) return null; // 精修後再驗一次:圓心動了,可見角度可能掉到門檻下
  return { x: cx, y: cy, n: fin.n, arc: fin.nb / NB };
}

// 某顏色在圓心 (cx,cy) 半徑 R 內有幾個像素。給「只找到一顆探針」的影格分辨用:另一顆的圓擬合失敗,
// 但它的顏色若仍在找到那顆附近有色塊,代表兩層畫在同一處、只是被遮到量不出圓心(不是失步)。
// 刻意只數附近、不數整張畫面:顏色門檻放寬過,畫面別處的 UI 色會誤觸,數整張會把「遮擋」判成「失步」。
export function colorMassNear(rgba, w, h, test, cx, cy, R) {
  const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(w - 1, Math.ceil(cx + R));
  const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(h - 1, Math.ceil(cy + R));
  const R2 = R * R;
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x - cx, dy = y - cy; if (dx * dx + dy * dy > R2) continue;
    const p = (y * w + x) * 4;
    if (test(rgba[p], rgba[p + 1], rgba[p + 2])) n++;
  }
  return n;
}

export function probeCentroids(rgba, w, h, { magR = 18, cynR = 5 } = {}) {
  return { mag: fitCircle(rim(rgba, w, h, isMag), magR), cyn: fitCircle(rim(rgba, w, h, isCyn), cynR) };
}
