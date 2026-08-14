// 台鐵誤點偏移的「畫面速度上界」驗收（缺陷①）。
//
// 為什麼要新寫一支而不是擴充 verify_speed_cap.mjs：
//   verify_speed_cap 的第 4 項（唯一守得住顯示層的那項）讀的是 #fpSpd 印出來的字，
//   而那個字在 index.html 裡就被 Math.min(raw, speedCapOf(tr)) 夾過了 ⇒ 上界加在
//   「顯示量」上，地圖上真正在移動的那個點沒有任何上界。這正是 2026-08-09 北捷那次的
//   同一個形態：「凡把速率上界加在某個中間量上，換掉下游映射時上界就默默失效」。
//   本檔量的是**未經任何夾限的地圖位移**，也就是使用者眼睛看到的那個量。
//
// 判準來源（刻意非同源）：speedCapOf(tr) = 車種極速，來自 PERF_RULES，不是本次改出來的東西。
// 使用者裁示：速度不能超過上限，不留容差。
//
// 用法：PORT=6400 ROOT=<受測樹> ENGINES=chromium,webkit node scripts/verify_tra_motion.mjs
import { createRequire } from 'module';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT || path.resolve(HERE, '..');
const PORT = Number(process.env.PORT || 6400);
const ENGINES = (process.env.ENGINES || 'chromium').split(',').map(s => s.trim()).filter(Boolean);
const req = createRequire(fs.existsSync(path.join(ROOT, 'node_modules/playwright'))
  ? path.join(ROOT, 'package.json') : '/Users/xuxiang/Code/捷運小動畫/package.json');
const pw = req('playwright');

// G0（心得 32）：驗的必須是當前工作樹
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
    () => typeof state !== 'undefined' && state.trains && state.trains.some(t => t.sys === 'tra_sched' && t.stops && t.stops.length),
    null, { timeout: 180000 });

  const r = await page.evaluate(async () => {
    // 情境：先讓一批車帶著大誤點（模擬 TDX 回報），再讓誤點整批歸零（模擬上游斷線後
    // liveActive() 退場、或列車追回誤點），量偏移量怎麼下降、以及地圖上實際移動了多遠。
    const MAXRATE = 2;                    // 外部契約常數：有效時間最多以 2× 前進
    const DELAY_MIN = 10;                 // 注入 10 分鐘誤點
    const out = { rateBad: [], pausedBad: [], capBad: [], jumpBad: [], samples: 0, fell: 0, onTimeEntry: null, onTimeVal: null };

    const cand = state.trains.filter(t => t.sys === 'tra_sched' && t.stops && t.stops.length > 3 && !t.loop);
    const inRun = cand.filter(t => {
      const s = t.stops; return state.simSec > s[0].depSec + 120 && state.simSec < s[s.length - 1].arrSec - 120;
    });
    const use = (inRun.length ? inRun : cand).slice(0, 20);
    const onTime = cand.find(t => !use.includes(t));

    state.live = { map: new Map(use.map(t => [String(t.train), DELAY_MIN])), at: Date.now(), delayed: use.length, srcAt: '' };
    state.playing = false;                // 由本腳本自己推進 simSec，不讓 tick 插手

    // 先讓偏移層收斂到「有誤點」的穩態（模擬時間推進，讓 rise 支把 cur 拉到 600）
    for (let i = 0; i < 400; i++) { state.simSec += 2; use.forEach(t => liveDelaySec(t)); await new Promise(r => requestAnimationFrame(r)); }

    // ── 第一段：暫停（adv=0）。偏移量不得自己變動，車在地圖上也不得移動。
    //
    // 🔴 為什麼「地圖位移」這條要量在這裡，而不是靠下面第二段的 km/h：
    //   第二段用 haversineKm(a,b) / STEP * 3600 算速度，STEP 是**模擬秒**。而缺陷①的瞬移
    //   發生在「模擬時間完全沒前進」的那段真實時間裡（無 motion 分支用真實時間 dt 收斂），
    //   除以模擬秒的判準結構上照不到它，只撿得到收斂完的尾巴。使用者眼睛看到的是「車突然
    //   跳了一段」，對應的物理事實是：**模擬時間沒前進，車就不准移動**。這條沒有容差、
    //   不含任何本計畫改出來的量，是最乾淨的非同源判準。
    state.live = { map: new Map(), at: Date.now(), delayed: 0, srcAt: '' };   // 釋放
    const before = use.map(t => liveDelaySec(t));
    const posBefore = use.map(t => trainPos(t, state.simSec));
    const simBefore = state.simSec;
    for (let i = 0; i < 40; i++) await new Promise(r => requestAnimationFrame(r));  // 真實時間過了約 0.7 秒，模擬時間 0
    const after = use.map(t => liveDelaySec(t));
    const posAfter = use.map(t => trainPos(t, state.simSec));
    out.simMoved = state.simSec - simBefore;   // 必須是 0，否則這段的「暫停」前提不成立
    use.forEach((t, i) => {
      if (Math.abs(after[i] - before[i]) > 1e-6)
        out.pausedBad.push({ train: String(t.train), before: +before[i].toFixed(3), after: +after[i].toFixed(3) });
      const a = posBefore[i], b = posAfter[i];
      if (a && b) {
        const m = haversineKm(a, b) * 1000;
        if (m > 1) out.jumpBad.push({ train: String(t.train), m: Math.round(m) });
      }
    });

    // ── 第二段：模擬時間逐步前進，量 shift 的下降速率與地圖位移
    let prevShift = use.map(t => liveDelaySec(t));
    let prevPos = use.map(t => trainPos(t, state.simSec));
    const STEP = 2;                        // 每步 2 模擬秒
    for (let k = 0; k < 200; k++) {
      state.simSec += STEP;
      await new Promise(r => requestAnimationFrame(r));
      const nowShift = use.map(t => liveDelaySec(t));
      const nowPos = use.map(t => trainPos(t, state.simSec));
      use.forEach((t, i) => {
        out.samples++;
        const drop = prevShift[i] - nowShift[i];
        if (drop > 0.001) out.fell++;
        // 契約：shift 每模擬秒最多下降 (maxRate-1) 秒 ⇒ 有效時間最多以 maxRate× 前進
        if (drop > STEP * (MAXRATE - 1) + 1e-6)
          out.rateBad.push({ train: String(t.train), drop: +drop.toFixed(3), allow: STEP * (MAXRATE - 1) });
        // 契約：有效時間不得倒退
        if (drop < -(STEP + 1e-6))
          out.rateBad.push({ train: String(t.train), drop: +drop.toFixed(3), note: '有效時間倒退' });
        // 絕對背書：畫面速度不得超過 車種極速 × maxRate（＋2 容差吸收取樣量化）
        const a = prevPos[i], b = nowPos[i];
        if (a && b) {
          const kmh = haversineKm(a, b) / STEP * 3600;
          const lim = speedCapOf(t) * MAXRATE + 2;
          if (kmh > lim) out.capBad.push({ train: String(t.train), kmh: Math.round(kmh), lim: Math.round(lim) });
        }
      });
      prevShift = nowShift; prevPos = nowPos;
    }
    out.rateBad.sort((x, y) => y.drop - x.drop); out.rateBad = out.rateBad.slice(0, 6);
    out.capBad.sort((x, y) => y.kmh - x.kmh); out.capBad = out.capBad.slice(0, 6);
    out.jumpBad.sort((x, y) => y.m - x.m); out.jumpN = out.jumpBad.length; out.jumpBad = out.jumpBad.slice(0, 6);
    out.pausedBad = out.pausedBad.slice(0, 6);

    // ── 準點控制組：不得建立 entry、值恆為 0
    if (onTime) { out.onTimeVal = liveDelaySec(onTime); out.onTimeEntry = _easedShift.has((onTime.sys || 'tra_sched') + ':' + onTime.train); }
    return out;
  });

  check(`[${eng}] A 偏移量每模擬秒的下降不得超過契約上限（有效時間 ≤ 2× 前進）`,
    r.rateBad.length === 0,
    r.rateBad.length === 0 ? `${r.samples} 個取樣全數合規（其中 ${r.fell} 次真的在下降）`
      : `${r.rateBad.length} 次違規；最大單步下降 ${r.rateBad[0].drop} 秒（允許 ${r.rateBad[0].allow}）例：${JSON.stringify(r.rateBad.slice(0, 3))}`);

  check(`[${eng}] B 暫停時（模擬時間不前進）偏移量不得自己變動`,
    r.pausedBad.length === 0,
    r.pausedBad.length === 0 ? '暫停 0.7 秒真實時間，所有受測車偏移量逐值不變'
      : `${r.pausedBad.length} 台在暫停中自己走了：${JSON.stringify(r.pausedBad.slice(0, 3))}`);

  check(`[${eng}] B2 模擬時間沒前進，車就不得在地圖上移動（使用者看到的「瞬移」本體）`,
    r.jumpBad.length === 0 && r.simMoved === 0,
    r.simMoved !== 0 ? `前提不成立：這段模擬時間走了 ${r.simMoved} 秒，B2 無效`
      : r.jumpBad.length === 0 ? '暫停 0.7 秒真實時間，所有受測車位移 ≤1 公尺'
        : `${r.jumpN} 台在模擬時間 0 前進時被畫著移動，最遠 ${r.jumpBad[0].m} 公尺：${JSON.stringify(r.jumpBad.slice(0, 3))}`);

  check(`[${eng}] C 畫面速度不得超過 車種極速 × 2`,
    r.capBad.length === 0,
    r.capBad.length === 0 ? `${r.samples} 個取樣零次超標`
      : `${r.capBad.length} 次超標，最快 ${r.capBad[0].kmh} km/h（上限 ${r.capBad[0].lim}）例：${JSON.stringify(r.capBad.slice(0, 3))}`);

  check(`[${eng}] D 分母閘門：觀察窗內偏移量真的在下降（否則 A/C 是以「什麼都沒發生」假綠）`,
    r.fell > 0, `${r.fell}/${r.samples} 個取樣偏移量下降中`);

  check(`[${eng}] E 準點控制組：零誤點的車不得建立漸變條目，值恆為 0`,
    r.onTimeVal === 0 && r.onTimeEntry === false,
    `liveDelaySec=${r.onTimeVal}、_easedShift 有條目=${r.onTimeEntry}`);

  await browser.close();
}

const bad = results.filter(r => !r.pass).length;
console.log(`\n合計 ${results.length - bad} PASS / ${bad} FAIL`);
process.exit(bad ? 1 : 0);
