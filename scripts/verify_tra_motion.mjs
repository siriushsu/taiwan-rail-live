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
  // 🔴 只擋 tra-live 這一支(其餘資源走真網路,照 repo 其他 22 支的慣例):本腳本整段靠
  //   「注入 state.live 的假誤點」量偏移量升降,而頁面自己有 setInterval(pollLive, 60e3)
  //   (index.html:16025)會把 state.live 整顆換掉。真輪詢一落進量測窗,注入的誤點被洗掉 ⇒
  //   偏移量在「上升段」就開始回落、跑完早已歸零 ⇒ 第二段一次都不下降 ⇒ D 分母歸零假紅。
  //   落不落得進窗內是 boot 時序的確定性函數(實測:同一分鐘 origin/main 綠、多跑一批 boot
  //   工作的分支三次全紅;擋掉這支之後兩邊逐值等同),所以不是機率問題,不能靠重跑繞過。
  await page.route('**/*tra-live*', r => r.abort());
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof state !== 'undefined' && state.trains && state.trains.some(t => t.sys === 'tra_sched' && t.stops && t.stops.length),
    null, { timeout: 180000 });

  const r = await page.evaluate(async () => {
    // 情境：先讓一批車帶著大誤點（模擬 TDX 回報），再讓誤點整批歸零（模擬上游斷線後
    // liveActive() 退場、或列車追回誤點），量偏移量怎麼下降、以及地圖上實際移動了多遠。
    const MAXRATE = 2;                    // 外部契約常數：有效時間最多以 2× 前進
    const DELAY_MIN = 10;                 // 注入 10 分鐘誤點
    const HALF_MIN = 6;                   // 先建 6 分再拉到 10 分:+4 分 < 5 分門檻(SNAP_SEC),上升側才走 1× 凍結;+5 分會被 G 的一步到位吃掉,F 分母歸零
    const STEP = 2;                       // 每步 2 模擬秒（第〇段與第二段共用）
    const FULL = DELAY_MIN * 60;          // 600 秒＝滿載誤點
    const out = { rateBad: [], pausedBad: [], capBad: [], jumpBad: [], shiftJumpBad: [], heldJump: [],
      riseBad: [], riseSeen: 0, heldN: 0, samples: 0, fell: 0, onTimeEntry: null, onTimeVal: null };

    const cand = state.trains.filter(t => t.sys === 'tra_sched' && t.stops && t.stops.length > 3 && !t.loop);
    const inRun = cand.filter(t => {
      const s = t.stops; return state.simSec > s[0].depSec + 120 && state.simSec < s[s.length - 1].arrSec - 120;
    });
    const use = (inRun.length ? inRun : cand).slice(0, 20);
    const onTime = cand.find(t => !use.includes(t));

    // 先用一半的誤點建 entry。easedShift 對「首見」會 snap 到 target（初次同步），所以「上升」
    // 這件事在建 entry 那一步結構上量不到；要量必須讓 entry 已存在、gate 一路不斷線，只把 target 拉高。
    state.live = { map: new Map(use.map(t => [String(t.train), HALF_MIN])), at: Date.now(), delayed: use.length, srcAt: '' };
    state.playing = false;                // 由本腳本自己推進 simSec，不讓 tick 插手
    use.forEach(t => liveDelaySec(t));    // 建 entry

    // ── 第〇段：把 target 拉到 600，量「誤點正在加大」這一半的上升速率。
    //
    // 🔴 這是本批次唯一安全宣稱的閘門：`minRate: 0` 讓 rise = adv×(1−0) = adv，與改動前的
    //   無 motion 上升分支逐字等價 ⇒ 準點的車與「誤點正在加大」的車行為零變化。沒有這條，
    //   後人「順手把 minRate 對齊北捷的 .25」不會有任何東西轉紅（實測突變 M3 六項全綠），
    //   而那會讓所有誤點加大中的車在畫面上被拖慢。
    //   判準非同源：期望值 STEP 來自「有效時間以 1× 前進」這個外部契約，不讀 TRA_MOTION_PROFILE。
    state.live.map = new Map(use.map(t => [String(t.train), DELAY_MIN]));
    let prevRise = use.map(t => liveDelaySec(t));
    for (let i = 0; i < 400; i++) {
      state.simSec += STEP;
      await new Promise(r => requestAnimationFrame(r));
      const nowRise = use.map(t => liveDelaySec(t));
      use.forEach((t, j) => {
        const d = nowRise[j] - prevRise[j];
        // 只看兩端都還沒貼到 target 的步：貼到 600 的那一步被 Math.min 夾成部分上升，不是速率樣本
        if (prevRise[j] < FULL - 1e-6 && nowRise[j] < FULL - 1e-6 && d > 1e-9) {
          out.riseSeen++;
          if (Math.abs(d - STEP) > 1e-6) out.riseBad.push({ train: String(t.train), d: +d.toFixed(6), want: STEP });
        }
      });
      prevRise = nowRise;
    }

    // ── 第一段：暫停（adv=0）。偏移量不得自己變動，車在地圖上也不得移動。
    //
    // 🔴 為什麼「地圖位移」這條要量在這裡，而不是靠下面第二段的 km/h：
    //   第二段用 haversineKm(a,b) / STEP * 3600 算速度，STEP 是**模擬秒**。而缺陷①的瞬移
    //   發生在「模擬時間完全沒前進」的那段真實時間裡（無 motion 分支用真實時間 dt 收斂），
    //   除以模擬秒的判準結構上照不到它，只撿得到收斂完的尾巴。使用者眼睛看到的是「車突然
    //   跳了一段」，對應的物理事實是：**模擬時間沒前進，車就不准移動**。這條沒有容差、
    //   不含任何本計畫改出來的量，是最乾淨的非同源判準。
    // 🔴 位移要分兩條路徑量，因為 trainPos = trainPosAt(t − liveDelaySec − blockHoldSec)：
    //   偏移（本批次的受測物）與 #17 阻擋的車距棘輪，兩者都會在模擬時間凍結時動。棘輪在
    //   dSim=0 時改用「每幀固定 1.111 公尺」的步長且完全不鉗（既有行為，非本輪造成），所以
    //   只量全量位移的話：取樣裡剛好有被擋的車 ⇒ 假紅，剛好沒有 ⇒ 假綠（實測 9 次只中 1 次，
    //   分野就是 blockHoldSize 是不是 0）。B2a 剔掉阻擋單獨量偏移，B2b 量全量但只對「沒被擋」
    //   的車開火，並把被擋的記在 #17 帳上。
    state.live = { map: new Map(), at: Date.now(), delayed: 0, srcAt: '' };   // 釋放
    const before = use.map(t => liveDelaySec(t));
    const posBefore = use.map(t => trainPos(t, state.simSec));
    const posNHBefore = use.map(t => trainPosAt(t, state.simSec - liveDelaySec(t)));  // 剔掉 blockHoldSec
    const heldBefore = use.map(t => blockHoldSec(t));
    const simBefore = state.simSec;
    for (let i = 0; i < 40; i++) await new Promise(r => requestAnimationFrame(r));  // 真實時間過了約 0.7 秒，模擬時間 0
    const after = use.map(t => liveDelaySec(t));
    const posAfter = use.map(t => trainPos(t, state.simSec));
    const posNHAfter = use.map(t => trainPosAt(t, state.simSec - liveDelaySec(t)));
    const heldAfter = use.map(t => blockHoldSec(t));
    out.simMoved = state.simSec - simBefore;   // 必須是 0，否則這段的「暫停」前提不成立
    out.heldN = heldBefore.filter((h, i) => h > 0 || heldAfter[i] > 0).length;
    use.forEach((t, i) => {
      if (Math.abs(after[i] - before[i]) > 1e-6)
        out.pausedBad.push({ train: String(t.train), before: +before[i].toFixed(3), after: +after[i].toFixed(3) });
      const held = heldBefore[i] > 0 || heldAfter[i] > 0;
      if (posNHBefore[i] && posNHAfter[i]) {   // B2a：偏移路徑單獨量，零容差
        const m = haversineKm(posNHBefore[i], posNHAfter[i]) * 1000;
        if (m > 1) out.shiftJumpBad.push({ train: String(t.train), m: Math.round(m) });
      }
      const a = posBefore[i], b = posAfter[i];
      if (a && b) {                             // B2b：全量位移，依有沒有被擋分流
        const m = haversineKm(a, b) * 1000;
        if (m > 1) (held ? out.heldJump : out.jumpBad)
          .push({ train: String(t.train), m: Math.round(m), dHold: +(heldAfter[i] - heldBefore[i]).toFixed(3) });
      }
    });

    // ── 第二段：模擬時間逐步前進，量 shift 的下降速率與地圖位移
    let prevShift = use.map(t => liveDelaySec(t));
    let prevPos = use.map(t => trainPos(t, state.simSec));
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
    // 先記真數再截斷（計畫給的原始碼就是先 slice 再讀 .length，害首跑把 12 班 236 格印成 8/8）
    out.jumpBad.sort((x, y) => y.m - x.m); out.jumpN = out.jumpBad.length; out.jumpBad = out.jumpBad.slice(0, 6);
    out.shiftJumpBad.sort((x, y) => y.m - x.m); out.shiftJumpN = out.shiftJumpBad.length; out.shiftJumpBad = out.shiftJumpBad.slice(0, 6);
    out.heldJump.sort((x, y) => y.m - x.m); out.heldJumpN = out.heldJump.length; out.heldJump = out.heldJump.slice(0, 6);
    out.riseN = out.riseBad.length; out.riseBad = out.riseBad.slice(0, 6);
    out.pausedBad = out.pausedBad.slice(0, 6);

    // ── 第三段（G，2026-09-05 使用者裁示「5 分」）：上升 ≥ SNAP_SEC 一步到位（跳回真實位置），< SNAP_SEC 維持 1× 凍結。
    //   09-05 屏東線事故：TDX 只在過站時更新 delay，區間被扣幾十分鐘 ⇒ 到站一次 +53；舊行為＝畫面原地停 53 分鐘
    //   （首見就帶 70 分的車＝停 70 分鐘）。判準非同源：SNAP_SEC 是裁示值，不讀 TRA_MOTION_PROFILE。
    //   G1/G4 要的是「首見」路徑，前面下降段只跑 200 步（600 秒誤點以 2 秒/步收回只收到 200），use 的
    //   entry 都還在 ⇒ 首見一律用沒碰過的車；G2/G3 反過來刻意用還留著 entry 的 use。
    const SNAP_SEC = 300;
    const pool = (inRun.length ? inRun : cand).filter(t => !use.includes(t) && t !== onTime);
    const freshA = pool.slice(0, 5), freshB = pool.slice(5, 10), g2 = use.slice(0, 10);
    out.g = { sinceGateMs: performance.now() - _traGateEp.at, creationSnap: [], jumpSnap: [], smallRise: [], creationFreeze: [], moved: 0, nA: freshA.length, nB: freshB.length, n2: g2.length };
    // G1 首見即 10 分：第一次查詢就等於 target（不從 0 開始凍結爬 10 分鐘）
    freshA.forEach(t => state.live.map.set(String(t.train), DELAY_MIN));
    freshA.forEach(t => { const v = liveDelaySec(t); if (Math.abs(v - DELAY_MIN * 60) > 1e-6) out.g.creationSnap.push({ train: String(t.train), v: +v.toFixed(3) }); });
    // G2 既有 entry 一次拉到 20 分（增量 ≥ SNAP_SEC）：下一次查詢即等於新 target，且車在地圖上真的換了位置
    const posPre = g2.map(t => trainPos(t, state.simSec));
    g2.forEach(t => state.live.map.set(String(t.train), DELAY_MIN * 2));
    g2.forEach((t, i) => {
      const v = liveDelaySec(t); if (Math.abs(v - DELAY_MIN * 120) > 1e-6) out.g.jumpSnap.push({ train: String(t.train), v: +v.toFixed(3) });
      const p = trainPos(t, state.simSec); if (posPre[i] && p && haversineKm(posPre[i], p) * 1000 > 1) out.g.moved++;
    });
    // G3 既有 entry 再 +4 分（< SNAP_SEC）：維持凍結——一步後只前進 adv（=STEP），不准跳到 target
    g2.forEach(t => state.live.map.set(String(t.train), DELAY_MIN * 2 + 4));
    const preSmall = g2.map(t => liveDelaySec(t));
    state.simSec += STEP; await new Promise(r => requestAnimationFrame(r));
    g2.forEach((t, i) => { const v = liveDelaySec(t); if (Math.abs(v - (preSmall[i] + STEP)) > 1e-6) out.g.smallRise.push({ train: String(t.train), from: +preSmall[i].toFixed(3), v: +v.toFixed(3) }); });
    // G4 首見 4 分（< SNAP_SEC）：首次查詢是 0（原地凍結等追上），一步後只前進 adv——凍結行為保留
    freshB.forEach(t => state.live.map.set(String(t.train), 4));
    const firstB = freshB.map(t => liveDelaySec(t));
    state.simSec += STEP; await new Promise(r => requestAnimationFrame(r));
    freshB.forEach((t, i) => { const v = liveDelaySec(t); if (firstB[i] !== 0 || Math.abs(v - STEP) > 1e-6) out.g.creationFreeze.push({ train: String(t.train), first: +firstB[i].toFixed(3), v: +v.toFixed(3) }); });

    // ── 準點控制組：不得建立 entry、值恆為 0
    if (onTime) { out.onTimeVal = liveDelaySec(onTime); out.onTimeEntry = _easedShift.has((onTime._rday || '') + '|' + (onTime.sys || 'tra_sched') + ':' + onTime.train); }
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

  check(`[${eng}] B2a 模擬時間沒前進時，**偏移路徑**不得讓車在地圖上移動（使用者看到的「瞬移」本體）`,
    r.shiftJumpN === 0 && r.simMoved === 0,
    r.simMoved !== 0 ? `前提不成立：這段模擬時間走了 ${r.simMoved} 秒，B2a 無效`
      : r.shiftJumpN === 0 ? '暫停 0.7 秒真實時間，剔掉 #17 阻擋後所有受測車位移 ≤1 公尺'
        : `${r.shiftJumpN} 台在模擬時間 0 前進時被偏移畫著移動，最遠 ${r.shiftJumpBad[0].m} 公尺：${JSON.stringify(r.shiftJumpBad.slice(0, 3))}`);

  check(`[${eng}] B2b 全量位移：**沒被 #17 擋住**的車在模擬時間 0 前進時一律不得移動`,
    r.jumpN === 0 && r.simMoved === 0,
    r.simMoved !== 0 ? `前提不成立：這段模擬時間走了 ${r.simMoved} 秒，B2b 無效`
      : `取樣 ${r.heldN} 台被擋 / 共 ${r.jumpN + r.heldJumpN + 0} 台有位移；未被擋而移動 ${r.jumpN} 台`
        + (r.heldJumpN ? `；被擋而移動 ${r.heldJumpN} 台（記在 #17 車距棘輪帳上，非本批次）最遠 ${r.heldJump[0].m} 公尺` : '')
        + (r.jumpN ? `：${JSON.stringify(r.jumpBad.slice(0, 3))}` : ''));

  check(`[${eng}] C 畫面速度不得超過 車種極速 × 2`,
    r.capBad.length === 0,
    r.capBad.length === 0 ? `${r.samples} 個取樣零次超標`
      : `${r.capBad.length} 次超標，最快 ${r.capBad[0].kmh} km/h（上限 ${r.capBad[0].lim}）例：${JSON.stringify(r.capBad.slice(0, 3))}`);

  check(`[${eng}] D 分母閘門：觀察窗內偏移量真的在下降（否則 A/C 是以「什麼都沒發生」假綠）`,
    r.fell > 0, `${r.fell}/${r.samples} 個取樣偏移量下降中`);

  check(`[${eng}] F 上升側零變化：誤點加大時，偏移量必須恰以 1× 模擬時間前進（minRate 的閘門）`,
    r.riseN === 0 && r.riseSeen > 0,
    r.riseSeen === 0 ? '分母為零：觀察窗內沒有任何一步是「還沒貼到 target 的上升」，F 無效'
      : r.riseN === 0 ? `${r.riseSeen} 個上升取樣全數恰為 ${2} 秒/步（＝adv，與改動前的無 motion 分支等價）`
        : `${r.riseN}/${r.riseSeen} 個上升取樣偏離 adv；例：${JSON.stringify(r.riseBad.slice(0, 3))}`);

  check(`[${eng}] G0 前提：G 段跑的時候「首見 snap 5 秒窗」已關（否則 G1/G4 分不出是哪條規則）`,
    r.g.sinceGateMs > 5000, `距 gate 啟用 ${Math.round(r.g.sinceGateMs)} ms`);
  check(`[${eng}] G1 首見即帶 ≥5 分誤點：第一次查詢就等於 target（不從 0 凍結爬）`,
    r.g.creationSnap.length === 0 && r.g.nA > 0,
    r.g.creationSnap.length === 0 ? `${r.g.nA} 台首見 10 分全數一步到位` : `${r.g.creationSnap.length}/${r.g.nA} 台沒 snap：${JSON.stringify(r.g.creationSnap.slice(0, 3))}`);
  check(`[${eng}] G2 既有條目一次 +≥5 分：下一次查詢即等於新 target，車在地圖上跳回真實位置`,
    r.g.jumpSnap.length === 0 && r.g.n2 > 0 && r.g.moved > 0,
    r.g.jumpSnap.length === 0 ? `${r.g.n2} 台全數一步到位，其中 ${r.g.moved} 台地圖位置改變` : `${r.g.jumpSnap.length}/${r.g.n2} 台沒 snap：${JSON.stringify(r.g.jumpSnap.slice(0, 3))}`);
  check(`[${eng}] G3 既有條目 +4 分（<5 分）：維持 1× 凍結，不准 snap（正向對照）`,
    r.g.smallRise.length === 0 && r.g.n2 > 0,
    r.g.smallRise.length === 0 ? `${r.g.n2} 台一步後恰前進 ${2} 秒` : `${r.g.smallRise.length}/${r.g.n2} 台偏離：${JSON.stringify(r.g.smallRise.slice(0, 3))}`);
  check(`[${eng}] G4 首見 4 分（<5 分）：首次為 0、之後 1× 爬升（凍結行為保留，正向對照）`,
    r.g.creationFreeze.length === 0 && r.g.nB > 0,
    r.g.creationFreeze.length === 0 ? `${r.g.nB} 台首次 0、一步後 ${2} 秒` : `${r.g.creationFreeze.length}/${r.g.nB} 台偏離：${JSON.stringify(r.g.creationFreeze.slice(0, 3))}`);

  check(`[${eng}] E 準點控制組：零誤點的車不得建立漸變條目，值恆為 0`,
    r.onTimeVal === 0 && r.onTimeEntry === false,
    `liveDelaySec=${r.onTimeVal}、_easedShift 有條目=${r.onTimeEntry}`);

  await browser.close();
}

const bad = results.filter(r => !r.pass).length;
console.log(`\n合計 ${results.length - bad} PASS / ${bad} FAIL`);
process.exit(bad ? 1 : 0);
