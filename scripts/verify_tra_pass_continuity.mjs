// 通過站(stop:false)前後的位置連續性驗收(改進計畫 2-5)。
//
// 缺陷:assignRunProfiles 把通過站的到離站時刻 `Math.round` 到整秒
// (index.html:7374),但 trainSeg 是拿那個整秒當「這一刻在第 i 段還是第 i+1 段」的分界。
// 真正通過該站的時刻是曲線解出來的小數 T*,兩者最多差 0.5 秒 ⇒
//   ・t ∈ (T*, round(T*)):還被判在前一段,段內進度 f 夾到 1 ⇒ 位置【凍在站點】
//   ・t 一過 round(T*):換到後一段,f 從曲線重算 ⇒ 位置【一次跳】到 (round(T*)−T*)×v
// 台鐵最快車種 150 km/h ⇒ 0.5 s × 41.7 m/s = 20.86 公尺,一幀跳完。
//
// 判準(刻意非同源,三層):
//   A 物理上界:單步位移 ≤ 車種極速 × dt × 1.15(極速來自 PERF_RULES,不是本次改的東西;
//     1.15 留給大圓距離與折線弦長的離散誤差)。
//   B 窗內平順度:同一個鄰域窗內,最大單步 ≤ 1.5 × 中位單步。完全不引用任何模型常數,也不需要
//     另找對照窗——只問「這 2.4 秒裡有沒有哪一步明顯不像它的鄰居」。窗只有 ±1.2 秒,台鐵最猛的
//     加減速(1.5 km/h/s)在窗內也只改變 1 m/s 車速,真實的速度變化撐不出 1.5× 的比值。
//     (初版把對照窗設在「本節點與下一節點的中點」,但下一個節點常是真停靠站 ⇒ 對照窗落在煞車段,
//      量到的是【速度差】不是【平順度差】:蘇澳新 91 km/h vs 對照 27 km/h 自然 3.3×。已廢棄。)
//   C 凍結:在通過站鄰域內,不得出現「明明在跑卻連續多步位移 ≈ 0」。凍結與跳是同一個 bug 的兩面,
//     只驗跳會漏掉 round-down 的那一半(那一半只凍不跳)。
//
// 位置一律取 trainPosAt(表定軸,不含即時誤點與 #17 阻擋回撥),量的是使用者看到的那顆點的經緯度。
//
// 用法:PORT=6427 ROOT=<受測樹> ENGINES=chromium,webkit node scripts/verify_tra_pass_continuity.mjs
import { createRequire } from 'module';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT || path.resolve(HERE, '..');
const PORT = Number(process.env.PORT || 6427);
const ENGINES = (process.env.ENGINES || 'chromium').split(',').map(s => s.trim()).filter(Boolean);
const req = createRequire(fs.existsSync(path.join(ROOT, 'node_modules/playwright'))
  ? path.join(ROOT, 'package.json') : '/Users/xuxiang/Code/捷運小動畫/package.json');
const pw = req('playwright');

// G0(心得 32):驗的必須是當前工作樹,而且是【這一顆 ROOT】的 index.html。
const diskMd5 = createHash('md5').update(fs.readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
const servedMd5 = createHash('md5').update(Buffer.from(
  await (await fetch(`http://127.0.0.1:${PORT}/index.html`)).arrayBuffer())).digest('hex');
console.log(`G0 target=${ROOT}\n   disk=${diskMd5}\n   serve=${servedMd5}`);
if (diskMd5 !== servedMd5) { console.error('G0 FAIL：server 提供的不是目標樹的 index.html'); process.exit(1); }

const results = [];
const check = (n, pass, detail) => { results.push({ n, pass }); console.log(`${pass ? 'PASS ' : 'FAIL '} ${n} — ${detail}`); };

for (const eng of ENGINES) {
  const browser = await pw[eng].launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('PAGEERROR', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof state !== 'undefined' && state.trains
      && state.trains.some(t => t.sys === 'tra_sched' && t.stops && t.stops.some(s => s.stop === false && s.rp)),
    null, { timeout: 180000 });

  const r = await page.evaluate(() => {
    const DT = 0.05;          // 取樣步長(模擬秒)。比 60fps 的一幀還細,抓得到單幀跳。
    const W = 1.2;            // 通過站前後各取樣 1.2 秒
    const MARGIN = 1.15;      // 大圓距離／折線弦長離散誤差的餘裕
    const MAXTR = 60;         // 取樣車數上限(整份班表跑完太久)
    const R = 6371008.8;
    const rad = d => d * Math.PI / 180;
    const metres = (p, q) => {              // 小距離用等距圓柱近似即可(誤差 <1e-6)
      const dLat = rad(q.lat - p.lat), dLon = rad(q.lon - p.lon) * Math.cos(rad((p.lat + q.lat) / 2));
      return Math.hypot(dLat, dLon) * R;
    };
    const walk = (tr, t0, t1) => {          // 回傳 { mx 最大單步公尺, med 中位單步, n 步數, zero 零位移步數 }
      let prev = null; const ds = [];
      for (let t = t0; t <= t1 + 1e-9; t += DT) {
        const p = trainPosAt(tr, t);
        if (!p) { prev = null; continue; }
        if (prev) ds.push(metres(prev, p));
        prev = p;
      }
      if (!ds.length) return { mx: 0, med: 0, n: 0, zero: 0 };
      const sorted = ds.slice().sort((a, b) => a - b);
      return { mx: sorted[sorted.length - 1], med: sorted[sorted.length >> 1],
        n: ds.length, zero: ds.filter(d => d < 0.02).length };
    };

    const out = { pass: 0, ctrl: 0, worst: [], ratioWorst: [], frozen: [], trains: 0, nodes: 0 };
    const cand = state.trains.filter(t => t.sys === 'tra_sched' && !t.loop && t.stops
      && t.stops.some(s => s.stop === false && s.rp));
    for (const tr of cand.slice(0, MAXTR)) {
      const s = tr.stops, cap = speedCapOf(tr) / 3.6;   // m/s,外部常數(PERF_RULES 車種極速)
      const lim = cap * DT * MARGIN;
      out.trains++;
      for (let j = 1; j < s.length - 1; j++) {
        if (s[j].stop !== false || !s[j].rp) continue;
        if (!s[j - 1].segLn || !s[j].segLn) continue;   // 無線形的段是端點直線內插,不在本題範圍
        const tp = s[j].arrSec;
        // 鄰域不得越過相鄰節點(否則量到的是別的節點的行為)
        const lo = Math.max(tp - W, (s[j - 1].depSec + tp) / 2 + 0.01);
        const hi = Math.min(tp + W, (tp + s[j + 1].arrSec) / 2 - 0.01);
        if (!(hi - lo > 4 * DT)) continue;
        out.nodes++;
        const { mx, med, n, zero } = walk(tr, lo, hi);
        if (!n) continue;
        out.pass++;
        if (mx > lim) out.worst.push({ train: String(tr.train), st: s[j].name, m: +mx.toFixed(2), lim: +lim.toFixed(2) });
        if (zero >= 3 && mx > 0.5) out.frozen.push({ train: String(tr.train), st: s[j].name, zero, of: n });
        // 窗內平順度。med < 0.05 m/步(車速 <3.6 km/h)時比值沒有意義,不列入分母。
        if (med > 0.05) {
          out.ctrl++;
          const ratio = mx / med;
          if (ratio > 1.5) out.ratioWorst.push({ train: String(tr.train), st: s[j].name, ratio: +ratio.toFixed(2), m: +mx.toFixed(2), med: +med.toFixed(2) });
        }
      }
    }
    out.worst.sort((a, b) => b.m - a.m); out.worstN = out.worst.length; out.worst = out.worst.slice(0, 6);
    out.ratioWorst.sort((a, b) => b.ratio - a.ratio); out.ratioN = out.ratioWorst.length; out.ratioWorst = out.ratioWorst.slice(0, 6);
    out.frozenN = out.frozen.length; out.frozen = out.frozen.slice(0, 6);
    return out;
  });

  // 覆蓋率本身要有一條具名斷言(judgment 心得 37d):分母無聲縮水時要紅,不能只印在 detail。
  check(`[${eng}] 樣本覆蓋`, r.pass >= 200 && r.ctrl >= 100,
    `${r.trains} 台台鐵車、${r.nodes} 個通過站節點,實際取樣 ${r.pass} 個(其中 ${r.ctrl} 個車速夠快、納入平順度比值)`);
  check(`[${eng}] A 物理上界:通過站鄰域無單步超過車種極速`, r.worstN === 0,
    r.worstN === 0 ? `${r.pass} 個節點鄰域零次超標`
      : `${r.worstN} 個節點超標,最遠一步 ${r.worst[0].m} m(上限 ${r.worst[0].lim} m/步):${JSON.stringify(r.worst.slice(0, 3))}`);
  check(`[${eng}] B 窗內平順度:最大單步不得凸出中位單步 1.5 倍`, r.ratioN === 0,
    r.ratioN === 0 ? `${r.ctrl} 個窗全部 ≤1.5×`
      : `${r.ratioN} 個窗超過 1.5×,最高 ${r.ratioWorst[0].ratio}×(${r.ratioWorst[0].m} m vs 中位 ${r.ratioWorst[0].med} m):${JSON.stringify(r.ratioWorst.slice(0, 3))}`);
  check(`[${eng}] C 凍結:通過站鄰域不得原地不動`, r.frozenN === 0,
    r.frozenN === 0 ? `${r.pass} 個節點鄰域零次凍結`
      : `${r.frozenN} 個節點出現連續零位移:${JSON.stringify(r.frozen.slice(0, 3))}`);

  await browser.close();
}

const bad = results.filter(x => !x.pass).length;
console.log(`\n總計 ${results.length - bad}/${results.length} 通過`);
process.exit(bad ? 1 : 0);
