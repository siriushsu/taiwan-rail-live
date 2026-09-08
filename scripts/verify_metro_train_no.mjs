// 捷運跟車卡的車次欄（2026-09-08 使用者：「現在捷運不是每一班都有對到車次，但是如果有對到，
// 我希望在列車資訊卡的上方有欄位顯示車次」）。
//
// 用法：node scripts/verify_metro_train_no.mjs [目標目錄]
//
// 這個功能的危險不在「顯示不出來」，在「顯示了不該顯示的東西」——契約(trtc-official-lifecycle-
// contract 規則 7 與禁手表)寫死：車次只是標籤，內部 vehicleId 不准冒充車次、CarWeight 的車廂
// 編號也不准。文湖線 BR 與環狀線 Y 官方本來就沒有這一欄，高捷 KR/KO 的 Core 快照裡也全是空的。
// 所以本檔的重心是**反向判準＋正向對照成對**：有號的要一字不差顯示，沒號的要整欄消失，
// 而且任何情況下都不准長得像 vehicleId 或路線縮寫。
//
// 真值一律取自磁碟上的兩份 fixture（與頁面不同源）：
//   scripts/fixtures/trtc_live_crowd.json    → 北捷官方名冊那條路（roster 由 board/trains 現場合成）
//   scripts/fixtures/metro_core_snapshot.json → Core 那條路（publicLabel）
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(process.argv[2] || SELF_ROOT);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const md5 = b => createHash('md5').update(b).digest('hex');

const LIVE = JSON.parse(readFileSync(path.join(ROOT, 'scripts/fixtures/trtc_live_crowd.json'), 'utf8'));
const SNAP = JSON.parse(readFileSync(path.join(ROOT, 'scripts/fixtures/metro_core_snapshot.json'), 'utf8'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.geojson': 'application/json' };

// 兩份 fixture 都是某個時刻的快照,時間戳要整體平移到「現在」,否則一開始就超齡、
// 名冊根本不會建立(rosterLive/snapshotLive 都看時間),那會紅成「功能壞了」的樣子。
const liveShift = () => Math.round(Date.now() / 1000) - Math.max(...LIVE.board.map(r => Number(r.at)));
function liveBody() {
  const s = liveShift(), f = structuredClone(LIVE);
  f.board = f.board.map(r => ({ ...r, at: Number(r.at) + s, eta: Number(r.eta) + s,
    ...(r.eta2 == null ? {} : { eta2: Number(r.eta2) + s }) }));
  f.trains = f.trains.map(t => ({ ...t, at: Number(t.at) + s }));
  return JSON.stringify(f);
}
const snapShift = () => Math.round(Date.now() / 1000) - Number(SNAP.sourceAt);
function snapBody() {
  const s = snapShift(), f = structuredClone(SNAP);
  f.generatedAt = Number(f.generatedAt) + s; f.sourceAt = Number(f.sourceAt) + s;
  f.validUntil = Math.round(Date.now() / 1000) + 90;
  for (const sys of f.systems) for (const tr of sys.trains) {
    if (Array.isArray(tr.trajectory)) tr.trajectory = tr.trajectory.map(p => ({ ...p, epoch: Number(p.epoch) + s }));
    if (tr.nextCall) tr.nextCall = { ...tr.nextCall,
      arrivalEpoch: tr.nextCall.arrivalEpoch == null ? null : Number(tr.nextCall.arrivalEpoch) + s,
      departureEpoch: tr.nextCall.departureEpoch == null ? null : Number(tr.nextCall.departureEpoch) + s };
    if (tr.retireAt != null) tr.retireAt = Number(tr.retireAt) + s;
  }
  return JSON.stringify(f);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/trtc-live') { res.setHeader('content-type', 'application/json'); return res.end(liveBody()); }
  if (url.pathname.startsWith('/api/')) { res.statusCode = 404; return res.end('no api in verify'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;
const done = code => { server.close(); process.exit(code); };

// ── G0:確認驗的是哪一棵樹（驗收腳本驗到別棵 worktree 的舊檔是真的發生過的事）──
const localHash = md5(readFileSync(path.join(ROOT, 'index.html')));
const BUILD = (readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/const BUILD = '([^']+)'/) || [])[1];
console.log(`驗證目標：${ROOT}\nBUILD ${BUILD}／index.html md5：${localHash}\n`);
const servedHash = md5(Buffer.from(await (await fetch(BASE + '/index.html')).arrayBuffer()));
ok(servedHash === localHash, `G0 伺服器供的 index.html 與本樹逐 byte 相同（served ${servedHash.slice(0, 8)}）`);
if (servedHash !== localHash) { console.log('\n目標不符,後續斷言無意義,中止。'); done(1); }

// 磁碟真值:fixture 裡「官方有給車次」的號碼集合。頁面說某台車是 218 次,那個 218 必須在這裡面。
const DISK_LIVE_NOS = new Set(LIVE.trains.filter(t => t.sys === 'hw' && String(t.no || '').trim()).map(t => String(t.no).trim()));
const DISK_CORE = new Map();          // vehicleId → publicLabel(可能是空字串)
for (const sys of SNAP.systems) for (const tr of sys.trains) DISK_CORE.set(String(tr.vehicleId), String(tr.publicLabel || '').trim());
const CORE_WITH = [...DISK_CORE].filter(([, v]) => v).length, CORE_WITHOUT = [...DISK_CORE].filter(([, v]) => !v).length;
ok(DISK_LIVE_NOS.size > 0, `G0 北捷 fixture 有 ${DISK_LIVE_NOS.size} 個官方車次可比對`);
ok(CORE_WITH > 0 && CORE_WITHOUT > 0,
  `G0 Core fixture 同時有「有號」${CORE_WITH} 台與「沒號」${CORE_WITHOUT} 台——兩邊都有樣本,正反判準才都不是零資訊`);

const INIT = () => { try {
  localStorage.setItem('trainmap-howto-seen', '1');
  localStorage.setItem('trainmap-language', 'zh-TW');
  localStorage.setItem('trainmap-appearance', 'light');
} catch (e) {} };
const browser = await chromium.launch();
// 讀卡片實際渲染出來的字。判準一律讀 DOM,不讀 info 物件——使用者看的是 DOM。
const readCard = page => page.evaluate(() => {
  const el = document.getElementById('fcNo');
  return { exists: !!el, hidden: el ? el.hidden : null, text: el ? el.textContent : null,
    line: (document.getElementById('fcLine') || {}).textContent || '',
    cardHidden: document.getElementById('freqCard').hidden };
});

// ══ A. 北捷官方名冊那條路 ══════════════════════════════════════════════════
console.log('\n═══ A. 北捷官方名冊：有官方車次就顯示，沒有就整欄消失 ═══');
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
await ctxA.addInitScript(INIT);
const pa = await ctxA.newPage();
const errA = [];
pa.on('pageerror', e => errA.push(String(e).slice(0, 200)));
await pa.goto(BASE + '/index.html?lang=zh-TW', { waitUntil: 'domcontentloaded' });
await pa.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });
await pa.evaluate(() => selectGroup(GROUPS.find(g => g.id === 'metro')));
await pa.waitForFunction(() => state.trtcOfficialRoster && (state.trtcOfficialRoster.vehicles || []).length > 0, null, { timeout: 60000 })
  .catch(() => {});
const rosterA = await pa.evaluate(() => (state.trtcOfficialRoster && state.trtcOfficialRoster.vehicles || [])
  .map(v => ({ id: String(v.vehicleId), line: String(v.line), no: String(v.officialNo || '').trim() })));
const withNo = rosterA.filter(v => v.no), noNo = rosterA.filter(v => !v.no);
ok(withNo.length > 0, `A0 名冊裡有 ${withNo.length} 台帶官方車次的車（總 ${rosterA.length} 台）`);
ok(noNo.length > 0, `A0 名冊裡有 ${noNo.length} 台沒有官方車次的車（文湖線／環狀線本來就沒有這一欄）——反向判準的樣本`);

// A1(正向):有號的必須一字不差顯示,而且那個號碼要在磁碟 fixture 裡找得到。
for (const v of withNo.slice(0, 6)) {
  const card = await pa.evaluate(([lineId, vehicleId]) => {
    state.freqFollow = { official: true, lineId, vehicleId };
    document.getElementById('freqCard').hidden = false;
    updateFreqFollowCamera(true);
    const el = document.getElementById('fcNo');
    return { hidden: el.hidden, text: el.textContent };
  }, [v.line, v.id]);
  ok(card.text === v.no && card.hidden === false,
    `A1 ${v.line} 的 ${v.no} 次顯示在卡片頂列（實際：「${card.text}」hidden=${card.hidden}）`);
  ok(DISK_LIVE_NOS.has(v.no), `A1 ${v.no} 次在磁碟 fixture 的官方車次集合裡（不是頁面自己編出來的）`);
}
// A2(反向):沒號的整欄消失。這是本功能最容易做錯的一格——退而求其次去撿 BR/Y 或內部 id。
for (const v of noNo.slice(0, 6)) {
  const card = await pa.evaluate(([lineId, vehicleId]) => {
    state.freqFollow = { official: true, lineId, vehicleId };
    document.getElementById('freqCard').hidden = false;
    updateFreqFollowCamera(true);
    const el = document.getElementById('fcNo');
    return { hidden: el.hidden, text: el.textContent };
  }, [v.line, v.id]);
  ok(card.hidden === true && card.text === '',
    `A2 ${v.line} 這台沒有官方車次的車不顯示車次欄（實際：hidden=${card.hidden}／「${card.text}」）`);
}
// A3(禁手):任何情況都不准把內部 vehicleId 或路線縮寫當車次。契約禁手表第 2 條。
const bad = [];
for (const v of rosterA.slice(0, 24)) {
  const text = await pa.evaluate(([lineId, vehicleId]) => {
    state.freqFollow = { official: true, lineId, vehicleId };
    updateFreqFollowCamera(true);
    return document.getElementById('fcNo').textContent;
  }, [v.line, v.id]);
  if (text && (text === v.id || text === v.line || /^(BR|Y)$/.test(text) || text.includes(':'))) bad.push(`${v.line}/${v.id}→「${text}」`);
}
ok(bad.length === 0, `A3 抽驗 ${Math.min(24, rosterA.length)} 台,沒有一台把內部 id／路線縮寫當車次顯示（越界：${bad.join('、') || '無'}）`);
ok(errA.length === 0, `A 節期間頁面無未捕捉例外（${errA.slice(0, 2).join(' | ') || '無'}）`);
await ctxA.close();

// ══ B. Core 那條路 ════════════════════════════════════════════════════════
console.log('\n═══ B. Core（publicLabel）：同一個欄位、同一條規則 ═══');
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
await ctxB.addInitScript(INIT);
const pb = await ctxB.newPage();
const errB = [];
pb.on('pageerror', e => errB.push(String(e).slice(0, 200)));
await pb.route('**/*', route => {
  const u = new URL(route.request().url());
  if (u.pathname.endsWith('/v1/metro/snapshot')) return route.fulfill({ status: 200,
    contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: snapBody() });
  return route.continue();
});
await pb.goto(BASE + '/index.html?metrocore=1&lang=zh-TW', { waitUntil: 'domcontentloaded' });
await pb.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });
await pb.waitForTimeout(1500);
await pb.evaluate(() => { const g = GROUPS.find(x => x.id === 'metro'); if (state.group !== 'metro') selectGroup(g, false); });
await pb.waitForFunction(() => (state.lines || []).some(l => metroCoreSystemIdForLine(l) === 'trtc'), null, { timeout: 60000 });
await pb.evaluate(() => {
  state.clockAtNow = true; state.playing = true; state.speedMult = 1; state._scrubTime = false;
  state.simSec = nowSecOfDay();
});
await pb.waitForFunction(() => state.metroCore && state.metroCore.snapshot
  && (state.metroCore.snapshot.systems || []).length > 0, null, { timeout: 60000 }).catch(() => {});
const coreList = await pb.evaluate(() => {
  const snap = state.metroCore && state.metroCore.snapshot;
  if (!snap) return [];
  const out = [];
  for (const sys of snap.systems) for (const tr of sys.trains) {
    const ln = metroCoreLineForId(sys.systemId, tr.lineId);
    if (!ln) continue;
    if (!metroCoreFollowRecord({ core: true, systemId: sys.systemId, lineId: tr.lineId, vehicleId: tr.vehicleId })) continue;
    out.push({ sys: String(sys.systemId), line: String(tr.lineId), id: String(tr.vehicleId), label: String(tr.publicLabel || '').trim() });
  }
  return out;
});
const cWith = coreList.filter(v => v.label), cWithout = coreList.filter(v => !v.label);
ok(coreList.length > 0, `B0 Core 快照裡有 ${coreList.length} 台位置解得出來的車（有號 ${cWith.length}／沒號 ${cWithout.length}）`);
const follow = (page, v) => page.evaluate(([systemId, lineId, vehicleId]) => {
  state.freqFollow = { core: true, systemId, lineId, vehicleId };
  document.getElementById('freqCard').hidden = false;
  updateFreqFollowCamera(true);
  const el = document.getElementById('fcNo');
  return { hidden: el.hidden, text: el.textContent };
}, [v.sys, v.line, v.id]);
for (const v of cWith.slice(0, 5)) {
  const card = await follow(pb, v);
  ok(card.text === v.label && card.hidden === false,
    `B1 Core ${v.sys}/${v.line} 的 ${v.label} 次顯示在卡片頂列（實際：「${card.text}」hidden=${card.hidden}）`);
  ok(DISK_CORE.get(v.id) === v.label, `B1 ${v.label} 與磁碟 fixture 裡 ${v.id} 的 publicLabel 相同`);
}
for (const v of cWithout.slice(0, 5)) {
  const card = await follow(pb, v);
  ok(card.hidden === true && card.text === '',
    `B2 Core ${v.sys}/${v.line} 這台沒有 publicLabel 的車不顯示車次欄（實際：hidden=${card.hidden}／「${card.text}」）`);
  ok(DISK_CORE.get(v.id) === '', `B2 磁碟 fixture 裡 ${v.id} 的 publicLabel 確實是空的（不是頁面弄丟的）`);
}
ok(errB.length === 0, `B 節期間頁面無未捕捉例外（${errB.slice(0, 2).join(' | ') || '無'}）`);

// C(反向控制組):班表／班距那兩條路完全沒有官方車次來源(機捷/中捷/淡海/安坑/三鶯),
// 車次欄必須整欄消失。少了這一條,「隨便抓個什麼填進去」的假修法會全綠。
console.log('\n═══ C. 班表／班距推算的車：沒有官方車次來源，欄位必須消失 ═══');
const c = await pb.evaluate(() => {
  const ln = (state.lines || []).find(l => !metroCoreSystemIdForLine(l) && !isTrtcBoardLine(l) && (l._tt || []).length);
  if (!ln) {
    const k = (state.lines || []).find(l => !metroCoreSystemIdForLine(l) && !isTrtcBoardLine(l));
    if (!k) return { setup: false };
    state.freqFollow = { ln: k, k: 0 };
    document.getElementById('freqCard').hidden = false;
    updateFreqFollowCamera(true);
    const el = document.getElementById('fcNo');
    return { setup: true, kind: '班距幽靈車', line: k.id, hidden: el.hidden, text: el.textContent };
  }
  const tr = ln._tt.find(x => freqTrainTime(x, state.simSec) != null) || ln._tt[0];
  state.freqFollow = { ln, tr };
  document.getElementById('freqCard').hidden = false;
  updateFreqFollowCamera(true);
  const el = document.getElementById('fcNo');
  return { setup: true, kind: '實際時刻班次', line: ln.id, hidden: el.hidden, text: el.textContent };
});
ok(c.setup, `C0 取得一條沒有官方車次來源的線（${c.setup ? c.line + '／' + c.kind : '取不到'}）`);
if (c.setup) ok(c.hidden === true && c.text === '',
  `C1 ${c.line} 的${c.kind}不顯示車次欄（實際：hidden=${c.hidden}／「${c.text}」）`);
await ctxB.close();

await browser.close();
console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass}／失敗 ${fail}`);
done(fail === 0 ? 0 : 1);
