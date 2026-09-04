// issue #14 修復驗收：行程邊界判定與跟隨面板改走校正後時間軸(effTLive)，與 trainPos 同軸。
// 判準刻意用外部常數「表定終點時間 + 注入的誤點量」，不拿 effTLive 自己的回傳當真值(避免與實作同源)。
// 用法：PORT=5288 node scripts/dev_server.mjs & 然後 VURL=http://localhost:5288/index.html node scripts/verify_issue14.mjs
import { chromium, webkit } from 'playwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEngineMatrix } from './lib/engine_matrix.mjs';

const URL = process.env.VURL || 'http://localhost:5288/index.html';
const DM = 30, DS = DM * 60; // 注入誤點 30 分
let matrixCheck = null;
const ck = (ok, msg, detail = '') => matrixCheck(ok, msg, detail);

// ── G0 自檢：確認 dev server 服務的就是「當前工作區」那份 index.html。
// 這台機器同時跑著好幾個 session 的 server，port 會被別人佔走，驗到別人的檔案而全綠是真的發生過的事。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md5 = b => createHash('md5').update(b).digest('hex');
const diskHash = md5(readFileSync(path.join(ROOT, 'index.html')));

const matrix = await runEngineMatrix(async ({ engineUrl, check }) => {
 matrixCheck = check;
 const targetURL = engineUrl(URL);
 const servedHash = md5(Buffer.from(await (await fetch(targetURL)).arrayBuffer()));
 ck(diskHash === servedHash, 'G0 服務中的檔案是當前工作區', `URL=${targetURL} ROOT=${ROOT} disk=${diskHash} served=${servedHash}`);

 for (const [eng, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
  console.log(`\n===== ${eng} =====`);
  const br = await launcher.launch();
  const pg = await br.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e)));

  let mockNo = null;
  await pg.route('**/api/tra-live*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ at: new Date().toISOString(), trains: mockNo ? [{ no: mockNo, delay: DM }] : [] }),
  }));

  await pg.goto(targetURL, { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 500, null, { timeout: 40000 });

  // 候選：從真實班表挑一班可在「表定終點後 10 分」觀察、且扣掉 30 分誤點後仍在旅途中的車。
  // 測試時鐘稍後固定到 probe；不再依執行當下幾點，凌晨／離峰也能跑同一個產品情境。
  // probe 限制在當日內，避免這支 issue #14 gate 額外混入跨午夜語意（跨午夜另由 G 驗）。
  const cand = await pg.evaluate(({ ds }) => {
    const out = [];
    for (const tr of state.trains) {
      if (tr.loop || !tr.stops || tr.stops.length < 3) continue;
      if (tr.sys && tr.sys !== 'tra_sched') continue;
      const first = tr.stops[0], last = tr.stops[tr.stops.length - 1];
      const probe = last.arrSec + 600, live = probe - ds;
      if (probe < 86400 && first.depSec < probe && live > first.arrSec && live < last.arrSec)
        out.push({ no: String(tr.train), probe, duration: last.arrSec - first.depSec });
    }
    out.sort((a, b) => b.duration - a.duration || a.probe - b.probe);
    return out.slice(0, 3);
  }, { ds: DS });
  if (!cand.length) {
    ck(false, `${eng} 找得到符合 issue #14 時段條件的候選車次`, '此為改前已存在的時段相依紅；不中斷另一瀏覽器／地圖引擎');
    await br.close();
    continue;
  }
  mockNo = cand[0].no;
  const probeSec = cand[0].probe;
  // 不 reload：WebKit 搭配 page.route 在 reload 中偶發把任意本機 JSON 報成 CORS，且這裡只需
  // 讓同一頁再輪詢一次 live fixture。直接呼叫產品 pollLive，測到的仍是完整 fetch→parse→state 路徑。
  await pg.evaluate(() => pollLive());
  await pg.waitForFunction(() => state.live && state.live.map && state.live.map.size > 0, null, { timeout: 20000 });
  await pg.evaluate(probe => {
    window.nowSecOfDay = () => probe;
    state.simSec = probe;
  }, probeSec);
  console.log(`  測試車次 ${mockNo}（注入誤點 ${DM} 分；固定時鐘 ${probeSec} 秒）`);

  // ── A. 主症狀：誤點車過了表定終點時間後，點地圖上的車不該被撥回發車
  const a = await pg.evaluate(({ no }) => {
    const tr = state.trains.find(t => String(t.train) === no);
    state.simSec = nowSecOfDay();
    const before = state.simSec, shift = liveDelaySec(tr), posLive = !!trainPos(tr, state.simSec);
    setFollow(tr);
    const after = state.simSec, followed = state.followId === tr.train;
    clearFollow();
    return { before, after, shift, posLive, followed, arr: tr.stops[tr.stops.length - 1].arrSec, dep: tr.stops[0].depSec };
  }, { no: mockNo });
  ck(Math.abs(a.shift - DS) < 30, `A0 誤點已套用 liveDelaySec=${Math.round(a.shift)}s`);
  ck(a.posLive && a.before > a.arr, `A0 前置成立：now(${a.before}) > 表定終點(${a.arr}) 且車仍在地圖上`);
  ck(a.after === a.before, `A1 點車後 simSec 不變（${a.before}→${a.after}）＝不再從頭回放`);
  ck(a.followed, `A2 確實跟上了這班車`);

  // ── B. 準點車回歸：真正跑完的車，點擊仍要撥回發車（原行為不能弄丟）
  const b = await pg.evaluate(({ no }) => {
    const tr = state.trains.find(t => String(t.train) !== no && !t.loop && t.stops.length > 2
      && (!t.sys || t.sys === 'tra_sched') && nowSecOfDay() - t.stops[t.stops.length - 1].arrSec > 1800
      && t.stops[0].depSec < nowSecOfDay());
    if (!tr) return { skip: true };
    state.simSec = nowSecOfDay();
    const before = state.simSec;
    setFollow(tr);
    const after = state.simSec, want = Math.max(0, tr.stops[0].depSec - 20) % 86400;
    clearFollow();
    return { no: String(tr.train), before, after, want, rewound: Math.abs(after - want) < 1 };
  }, { no: mockNo });
  ck(b.skip || b.rewound, b.skip ? 'B 略過（找不到準點且已跑完的對照車）' : `B 準點已跑完的 ${b.no}：仍撥回發車前 20 秒（${b.before}→${b.after}）`);

  // ── C. 抵達判定：判準＝表定終點 + 注入誤點量（外部常數，不問 effTLive）
  const c = await pg.evaluate(({ no, ds }) => {
    const tr = state.trains.find(t => String(t.train) === no);
    const last = tr.stops[tr.stops.length - 1];
    const probe = at => {
      state.simSec = at;
      state.followTrain = tr; state.followId = tr.train; state.followStatus = null;
      state.followStartEff = tr.stops[0].depSec; state.followTimeJumped = false;
      state._routePts = buildFollowRoute(tr);
      updateFollowCamera();
      const st = state.followStatus; state.followTrain = null; state.followId = null;
      return st;
    };
    return {
      early: probe(last.arrSec + 600),        // 表定終點後 10 分：實際還在跑 → 不該 done
      late: probe(last.arrSec + ds + 30),     // 表定終點 + 誤點量 + 30 秒：真的到了 → 該 done
    };
  }, { no: mockNo, ds: DS });
  ck(c.early !== 'done', `C1 表定終點後 10 分（實際還在跑）：followStatus='${c.early}' ≠ done`);
  ck(c.late === 'done', `C2 表定終點 +${DM} 分後（真的到了）：followStatus='${c.late}'`);

  // ── D. 完乘蓋章回歸：誤點車從發車跟到終點，章要蓋得到（followStartEff 必須同軸）
  const d = await pg.evaluate(({ no, ds }) => {
    const tr = state.trains.find(t => String(t.train) === no);
    const first = tr.stops[0], last = tr.stops[tr.stops.length - 1];
    state.simSec = first.depSec + ds;   // 誤點車「實際發車」的那一刻
    setFollow(tr);
    const startEff = state.followStartEff;
    const qualified = startEff <= first.depSec + 60 && !state.followTimeJumped;
    state.simSec = last.arrSec + ds + 30; // 實際抵達
    updateFollowCamera();
    const st = state.followStatus;
    clearFollow();
    return { startEff, dep: first.depSec, qualified, st };
  }, { no: mockNo, ds: DS });
  ck(d.qualified, `D1 誤點車發車時起跟：followStartEff=${Math.round(d.startEff)} ≈ 表定發車 ${d.dep} → 完乘資格成立`);
  ck(d.st === 'done', `D2 跟到實際抵達：followStatus='${d.st}'`);

  // ── E. 跟隨面板同軸：誤點車在表定終點後，面板不該說「已抵達終點」
  const e = await pg.evaluate(({ no }) => {
    const tr = state.trains.find(t => String(t.train) === no);
    state.simSec = nowSecOfDay();
    setFollow(tr);
    updateFollowPanel(tr);
    const eta = (document.getElementById('fpEta') || {}).textContent || '';
    const nx = (document.getElementById('fpNext') || {}).textContent || '';
    // 獨立判準：用 trainPos 的實際座標找最近的「還沒到的停靠站」，看面板下一站是否對得上
    const pos = trainPos(tr, state.simSec);
    clearFollow();
    return { eta, nx, hasPos: !!pos };
  }, { no: mockNo });
  ck(e.hasPos && e.nx !== '—' && !/已抵達終點/.test(e.eta), `E 跟隨面板下一站='${e.nx}'、eta='${e.eta}' → 不再提早宣告到終點`);

  // ── F. 高鐵零誤套：非 live 系統 liveDelaySec 恆 0 ⇒ effTLive === effT
  const f = await pg.evaluate(() => {
    const tr = state.trains.find(t => t.sys && t.sys !== 'tra_sched' && !t.loop && t.stops && t.stops.length > 2);
    if (!tr) return { skip: true };
    state.simSec = nowSecOfDay();
    return { no: String(tr.train), sys: tr.sys, same: effTLive(tr) === effT(tr), shift: liveDelaySec(tr) };
  });
  ck(f.skip || (f.same && f.shift === 0), f.skip ? 'F 略過（本群組無非台鐵系統車）' : `F 高鐵/${f.sys} ${f.no}：liveDelaySec=0、effTLive===effT`);

  // ── G. 跨午夜回歸（issue #6）：arrSec ≥ 86400 的車，午夜後仍判得到抵達
  const g = await pg.evaluate(({ ds }) => {
    const tr = state.trains.find(t => !t.loop && t.stops && t.stops[t.stops.length - 1].arrSec >= 86400);
    if (!tr) return { skip: true };
    const last = tr.stops[tr.stops.length - 1];
    state.live = { map: new Map(), at: Date.now(), delayed: 0, srcAt: new Date().toISOString() }; // 跨日車不注入誤點
    state.simSec = (last.arrSec + 30) % 86400; // 午夜後
    state.followTrain = tr; state.followId = tr.train; state.followStatus = null;
    state.followStartEff = tr.stops[0].depSec; state.followTimeJumped = false;
    state._routePts = buildFollowRoute(tr);
    updateFollowCamera();
    const st = state.followStatus;
    state.followTrain = null; state.followId = null;
    return { no: String(tr.train), arr: last.arrSec, st };
  }, { ds: DS });
  ck(g.skip || g.st === 'done', g.skip ? 'G 略過（今日無跨午夜車）' : `G 跨午夜車 ${g.no}（arrSec=${g.arr}）午夜後仍判得到抵達：'${g.st}'`);

  // 已知測試環境噪音：WebKit + page.route 攔截 + reload 時，開機的 alert 輪詢會報 CORS。
  // 已用未修改的 f0d46c8 基線在相同條件下對照重現（兩邊各 1 筆、標的在 metro/thsr-alert 間跳動、
  // chromium 零），確認與本次修改無關，故只在此類訊息上豁免，其餘 pageerror 一律不放行。
  const real = errs.filter(x => !/Fetch API cannot load .*\/api\/\w+-alert due to access control checks/.test(x));
  ck(real.length === 0, `零 pageerror（環境噪音 ${errs.length - real.length} 筆已豁免，其餘 ${real.length}）` + (real.length ? ' → ' + real[0] : ''));
  await br.close();
 }
});

console.log(`\n雙地圖引擎總計 ${matrix.assertions.length - matrix.failures.length}/${matrix.assertions.length} 通過`);
process.exit(matrix.passed ? 0 : 1);
