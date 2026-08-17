// 疊車那一對到底是誰：把「畫面上靠太近的同向兩台」回溯到它們的官方名冊紀錄。
//
// 為什麼要這支：`scan_map_health` 只答「有幾對、差幾公尺」，答不出**三個互斥原因**裡的哪一個——
//   (a) 產品回歸：我們把同一台實體車畫成兩台，或外推讓一台漂進另一台。
//   (b) 環境條件：官方資料本身就報了兩台這麼近的車（那依裁示「有官方數據就是在」不該判缺陷）。
//   (c) 判準過期：100m 門檻是為班表外推路徑訂的，對官方即時路徑不一定適用。
// 分辨法＝看兩台的官方欄位（vehicleId／officialNo／from→to／run／dir／source／holdReason）。
// 不做判定，只把事實印出來。
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://127.0.0.1:5399/';
const ROUNDS = Number(process.argv[3] || 6);
const BAD_M = 100, AT_STATION_M = 60;

const b = await chromium.launch();
const p = await b.newPage();
p.on('pageerror', e => console.log('❌ pageerror：' + e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });
await p.evaluate(() => {
  const g = (typeof GROUPS !== 'undefined' ? GROUPS : []).find(x => (x.members || []).includes('mrt'));
  if (g) selectGroup(g);
});
await p.waitForTimeout(4000);

for (let r = 1; r <= ROUNDS; r++) {
  const snap = await p.evaluate(({ BAD_M, AT_STATION_M }) => {
    const R = state.trtcOfficialRoster || {};
    const byId = new Map((R.vehicles || []).map(v => [`${v.line}|${v.vehicleId}`, v]));
    const hits = [];
    for (const h of (state._freqHits || [])) {
      if (!h || !h.ln || h.vehicleId == null) continue;
      const ln = h.ln, sts = ln.stations || [];
      // 沿線里程與最近車站：與 scan_map_health 同一組量法（畫面座標＋沿線 d）
      let nearIdx = null, nearM = null;
      for (let i = 0; i < sts.length; i++) {
        const dm = Math.abs((sts[i].d != null ? sts[i].d : NaN) - h.d) * 1000;
        if (Number.isFinite(dm) && (nearM == null || dm < nearM)) { nearM = dm; nearIdx = i; }
      }
      hits.push({ key: `${ln.id}|${h.vehicleId}`, line: ln.id, dir: h.dir, d: h.d, x: h.x, y: h.y,
        nearIdx, nearM, nearName: nearIdx != null && sts[nearIdx] ? sts[nearIdx].name : null,
        label: h.officialNo || null });
    }
    const groups = new Map();
    for (const h of hits) { const g = `${h.line}|${h.dir}`; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(h); }
    const pairs = [];
    for (const [g, arr] of groups) for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const m = (arr[i].d != null && arr[j].d != null) ? Math.abs(arr[i].d - arr[j].d) * 1000 : null;
      if (m == null || m >= BAD_M) continue;
      const both = arr[i].nearM < AT_STATION_M && arr[j].nearM < AT_STATION_M && arr[i].nearIdx === arr[j].nearIdx;
      const pick = h => {
        const v = byId.get(h.key) || {};
        return { key: h.key, label: h.label, near: `${h.nearName}(#${h.nearIdx}, ${Math.round(h.nearM)}m)`,
          px: [Math.round(h.x), Math.round(h.y)],
          off: { from: v.from, to: v.to, run: v.run, dir: v.dir, dest: v.dest,
            no: v.officialNo != null ? v.officialNo : null, src: v.source || null,
            hold: v.holdReason || null, arr: v.arrEpoch || null, obs: v.observedEpoch || null } };
      };
      pairs.push({ group: g, m: Math.round(m), bothAtStation: both, a: pick(arr[i]), b: pick(arr[j]) });
    }
    return { at: new Date().toTimeString().slice(0, 8), feed: R.feedMode || null,
      recvAgo: R.receivedEpoch ? Math.round(Date.now() / 1000 - R.receivedEpoch) : null,
      rosterN: (R.vehicles || []).length, hitN: hits.length,
      hold: state.trtcOfficialRosterHold ? state.trtcOfficialRosterHold.reason : null, pairs };
  }, { BAD_M, AT_STATION_M });

  console.log(`\n[${snap.at}] feed=${snap.feed} 名冊 ${snap.rosterN} 台（${snap.recvAgo}s 前換新）` +
    `　畫面 ${snap.hitN} 台　hold=${snap.hold || '—'}　<${BAD_M}m 同向對數 ${snap.pairs.length}`);
  for (const q of snap.pairs) {
    console.log(`  ▸ ${q.group} 相距 ${q.m}m${q.bothAtStation ? '（兩台都在同一站）' : ''}`);
    for (const s of [q.a, q.b])
      console.log(`     ${s.key} 牌=${s.label || '—'} 最近站=${s.near} px=${s.px}\n` +
        `        官方 from=${s.off.from}→to=${s.off.to} run=${s.off.run} dir=${s.off.dir} ` +
        `dest=${s.off.dest} no=${s.off.no || '—'} src=${s.off.src || '—'} hold=${s.off.hold || '—'}`);
  }
  if (r < ROUNDS) await p.waitForTimeout(20000);
}
await b.close();
