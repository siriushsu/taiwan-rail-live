// 對齊探針圓心(純函式,無 I/O):輸入 RGBA buffer,輸出洋紅環(#ff00ff,底圖引擎畫)與青點(#00ffff,overlay 畫)的圓心。
// 不用「看得見的像素質心」——真機錄影裡探針常被壓掉一塊(列車卡片邊緣、路線帶、站名、HUD),質心會被推離圓心;
// 09-03 第一支真機錄影就這樣假紅(x 對到 0.4px、y 卻差 29px,全是遮擋)。改成「已知半徑的圓擬合」:
// 取色塊的邊緣像素,RANSAC 找出圓周角度覆蓋最廣的圓心,再用內點做定半徑最小平方精修;
// 被遮住那一段的邊緣不在圓周上,自然是離群點。圓周至少要看得見 MIN_ARC 才算量到(否則回 null＝這一幀沒有可用探針)。
//
// 洋紅畫成環(12–18css)不畫實心圓(09-04):真機的遮擋物是半透明的車號卡與站名,邊是直的——直邊會在錯的圓心附近
// 排出一串剛好落在圓周容差內的邊緣像素(直邊與錯圓相切),真圓弧只剩 0.3 左右時錯圓心會贏、量出 10 幾 px 的假失步。
// 環有外圈(r)與內圈(rIn)兩條邊,同一個遮擋直邊對兩個半徑的「相切錯圓心」位置不同,兩圈擬合不同心就整顆作廢;
// 兩圈同心才是「確定」的圓心。只擬合得出一圈時,圓弧 ≥ SURE_ARC 才算確定,否則標 sure:false 給分析器降級處理。
// 半徑由呼叫端依 dpr 給:洋紅環 circle-radius 12css＋stroke 6css → 外 18·dpr、內 12·dpr;青色 ctx.arc 半徑 5css → 5·dpr
// (主畫布 dpr 上限 2,但 CSS 會把畫布放大回裝置像素,所以最終畫面上仍是 5·dpr)。
export const MIN_ARC = 0.35, RIM_TOL = 2.5, MIN_PIX = 12, SURE_ARC = 0.5;
// 顏色門檻:以 09-03 真機錄影量到的探針像素為準(洋紅 r p2=208／g p50=0／b p50=253;青 r p98=4／g p2=251／b p2=250),
// 留壓縮抖動的餘裕,同時把正式線色擋在外面:沙崙線 #B565A7 壓縮後 (176–184, 98–103, 160–170) 靠 b≥180 擋掉;
// 內灣線 #00A0B0 壓縮後 g 可到 208、b 到 218,門檻擋不完——靠下面的連通元件尺寸篩掉(線是長條,探針外框永遠 ≤ 2r)。
export const isMag = (r, g, b) => r >= 180 && b >= 180 && g <= 110;
export const isCyn = (r, g, b) => g >= 200 && b >= 200 && r <= 110;
// 遮罩下的寬鬆門檻(09-04 iPhone v0904m 錄影):更多抽屜開著時整張地圖蓋一層暗色遮罩,青點實測 (10,191,198)、洋紅環
// (188,13,197)——青的 200 門檻直接看不見(3 秒全判成 orphanBlind、max-gap 假紅),洋紅 180 只差 8。寬鬆版降到 165 並加
// 「彩色兩通道比第三通道高 ≥80」擋灰階;但**只准在已找到的另一顆探針附近用**(analyze 的 dim retry):全域放寬過一次,
// 內灣線的青綠在 f_00558 被擬合成一顆 1007px 外的假青點(weakOver)。真機正常亮度 (0,253,253)/(254,0,255)。
export const isMagDim = (r, g, b) => r >= 165 && b >= 165 && g <= 110 && r - g >= 80 && b - g >= 80;
export const isCynDim = (r, g, b) => g >= 165 && b >= 165 && r <= 110 && g - r >= 80 && b - r >= 80;

// 色塊的邊緣像素(4 鄰域有一個不是同色,或貼著畫面邊界)。
// 先做連通元件、丟掉外框任一邊超過 2.4r 的元件:同色的軌道線／路線帶／UI 區塊都是長條或大塊,而探針(環或點)
// 不管被遮成什麼樣,外框都不會超過 2r。09-04 自測實例:內灣線畫在探針旁,青點的圓擬合被線的邊緣釣走 360px。
export function rim(rgba, w, h, test, r) {
  const mask = new Uint8Array(w * h);
  let n = 0;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) if (test(rgba[p], rgba[p + 1], rgba[p + 2])) { mask[i] = 1; n++; }
  if (n < MIN_PIX) return null;
  const maxSide = 2.4 * r + 2, seen = new Uint8Array(w * h), stack = new Int32Array(n);
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    let sp = 0, x0 = w, x1 = 0, y0 = h, y1 = 0; const comp = [];
    stack[sp++] = s; seen[s] = 1;
    while (sp) {
      const j = stack[--sp]; comp.push(j);
      const x = j % w, y = (j - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[j - 1] && !seen[j - 1]) { seen[j - 1] = 1; stack[sp++] = j - 1; }
      if (x < w - 1 && mask[j + 1] && !seen[j + 1]) { seen[j + 1] = 1; stack[sp++] = j + 1; }
      if (y > 0 && mask[j - w] && !seen[j - w]) { seen[j - w] = 1; stack[sp++] = j - w; }
      if (y < h - 1 && mask[j + w] && !seen[j + w]) { seen[j + w] = 1; stack[sp++] = j + w; }
    }
    if (x1 - x0 + 1 > maxSide || y1 - y0 + 1 > maxSide) { for (const j of comp) mask[j] = 0; n -= comp.length; }
  }
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
// (角度格擋得住「灌水」,擋不住「相切」——直邊與錯圓相切時那串內點本身就散在 6–8 格;那一層交給環的兩圈同心檢查。)
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
// 只裁一塊 RGBA 出來(給 dim retry 用:寬鬆門檻只准看已找到那顆探針的鄰近)。回 { rgba, w, h, x0, y0 }。
export function cropRgba(rgba, w, h, cx, cy, R) {
  const x0 = Math.max(0, Math.floor(cx - R)), y0 = Math.max(0, Math.floor(cy - R));
  const x1 = Math.min(w, Math.ceil(cx + R)), y1 = Math.min(h, Math.ceil(cy + R));
  const cw = x1 - x0, ch = y1 - y0; if (cw <= 0 || ch <= 0) return null;
  const out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) out.set(rgba.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x1) * 4), y * cw * 4);
  return { rgba: out, w: cw, h: ch, x0, y0 };
}

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

// magInR 給了就當環量:外圈與內圈各擬合一次、必須同心才是確定的圓心。同心容差 max(3px, 10% 外半徑):影片壓縮讓遮罩
// 兩側各縮 1px 左右,只看得見半圈時定半徑擬合會把圓心往可見側拉 ~0.6–0.8px、內外圈方向相反(所以取兩圈平均正好抵銷),
// 兩圈可差到 1.5–2px;直邊相切釣出的假圓心差的是 r/3 量級,容差 10% 仍分得開。
// 只擬合得出一圈時,可見弧 ≥ SURE_ARC 才 sure。不給 magInR(check-engine 的 G7 只量外圈)就照舊單圈。
// 青點只有一圈,sure ＝ 可見弧 ≥ SURE_ARC。
export function probeCentroids(rgba, w, h, { magR = 18, magInR = null, cynR = 5, magTest = isMag, cynTest = isCyn } = {}) {
  const magPts = rim(rgba, w, h, magTest, magR), cynPts = rim(rgba, w, h, cynTest, cynR);
  const out = fitCircle(magPts, magR);
  // 內圈只准用「不是外圈內點」的邊緣像素:只剩半圈時,一個往可見側偏 6px 的 r12 圓會貼著外圈(內切)收一整段內點,
  // 角度格比真內圈還多(09-04 自測 occluded:假內圈 0.67 vs 真 0.56)。外圈先擬合、把它的內點拿掉,內圈就沒東西可貼。
  const rest = out && magPts ? magPts.filter(p => Math.abs(Math.hypot(p[0] - out.x, p[1] - out.y) - magR) > RIM_TOL) : magPts;
  const inn = magInR ? fitCircle(rest, magInR) : null;
  let mag = null;
  if (out && inn) {
    const agree = Math.hypot(out.x - inn.x, out.y - inn.y), tol = Math.max(3, 0.1 * magR);
    if (agree <= tol) mag = { x: (out.x + inn.x) / 2, y: (out.y + inn.y) / 2, n: out.n + inn.n, arc: out.arc, arcIn: inn.arc, agree, sure: true };
    // 不同心:至少一圈是被直邊釣走的假圓心,整顆作廢(分析器會把這一幀當「只找到青」處理)
  } else if (out || inn) {
    const f = out || inn; mag = { ...f, sure: f.arc >= SURE_ARC, rim: out ? 'outer' : 'inner' };
  }
  const c = fitCircle(cynPts, cynR);
  return { mag, cyn: c ? { ...c, sure: c.arc >= SURE_ARC } : null };
}
