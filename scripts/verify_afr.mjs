// 阿里山林鐵(v0719a)獨立驗證——資料層斷言 + Playwright 真引擎(chromium+webkit)端到端 + 手機寬度。
// 本腳本不參與實作,判準來自 TDX 原始資料與地理事實,刻意不看 build_afr.mjs 怎麼做:
//
//   · TDX v3/Rail/AFR 才有資料(v2 全 404)。官方本線 StationOfLine 為 17 站,序尾是
//     「…第二分道→二萬平→阿里山」——但本線 shape 幾何終點在神木(離軌1.2m)、阿里山離本線 503m,
//     實際路線是 二萬平→神木→阿里山(最後 1.3km 由神木線提供)。故車次5/8(嘉義↔阿里山)densify
//     後必為 18 站,若出現 17 站即代表最短路徑抄了「二萬平→阿里山」的捷徑、跳過神木。
//   · 站碼 360-381 連號(缺 364,已廢站),本線實體站序即 MAIN_ORDER 那 17 站。
//   · 線形長度必須「分碎片累加」:MULTILINESTRING 的碎片接縫不是軌道(本線 22 碎片虛胖 19.49km、
//     祝山線 5 碎片虛胖 3.39km)。祝山線例外:碎片間有 TDX 真實缺口(端點最近距 104–527m),
//     4 處直線橋接約 1.23km,故拼接後 4.99km > 碎片內 3.76km。
//   · 獨立山螺旋是繞山盤旋上升,拼接錯誤(在 2D 自我交叉的分岔節點選錯圈次)會讓累積轉向互相
//     抵消並在接縫留下銳角。用「路徑自身累積轉向角」量,不可用「相對重心方位角」(偏心螺旋會失真)。
//   · TDX 班次的 TrainTypeID/TrainTypeName 十班全 null,車種是本專案依起訖路線歸類的四類;
//     前端用 typeName 做繪製 gate(state.visible.has),故 key 不可與台鐵車種相撞。
import { readFileSync } from 'node:fs';
import { chromium, webkit } from 'playwright';

const PORT = process.env.PORT || 5179;
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const hav = (a, b) => {
  const R = 6371000, p = Math.PI / 180;
  return 2 * R * Math.asin(Math.sqrt(Math.sin((b[0] - a[0]) * p / 2) ** 2 +
    Math.cos(a[0] * p) * Math.cos(b[0] * p) * Math.sin((b[1] - a[1]) * p / 2) ** 2));
};
const brg = (a, b) => Math.atan2((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI;
// 點到 polyline 的距離必須量「到線段」而非「到頂點」:軌道是連續的線,頂點只是取樣。
// 本線有一段 1170m 的 TDX 資料缺口以直線橋接,屏遮那站正落在該段上——量到頂點會得到 425m
// 的假性偏離,量到線段則是實際的 88m。
function distToSeg(p, a, b) {
  const k = Math.cos(p[0] * Math.PI / 180), R = 111320;
  const px = (p[1] - a[1]) * k * R, py = (p[0] - a[0]) * R;
  const bx = (b[1] - a[1]) * k * R, by = (b[0] - a[0]) * R;
  const L2 = bx * bx + by * by;
  const t = L2 ? Math.max(0, Math.min(1, (px * bx + py * by) / L2)) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}
const distToLine = (p, shape) => {
  let m = Infinity;
  for (let i = 1; i < shape.length; i++) { const d = distToSeg(p, shape[i - 1], shape[i]); if (d < m) m = d; }
  return m;
};

const MAIN_ORDER = ['嘉義', '北門', '鹿麻產', '竹崎', '樟腦寮', '獨立山', '梨園寮', '交力坪',
  '水社寮', '奮起湖', '多林', '十字路', '屏遮那', '第一分道', '第二分道', '二萬平', '神木'];
const T5_EXPECT = [...MAIN_ORDER, '阿里山'];
const T5_SCHEDULED = ['嘉義', '北門', '竹崎', '交力坪', '奮起湖', '二萬平', '阿里山'];
const SHAPE_KM = { '本線': 68.16, '祝山線': 4.99, '神木線': 1.29, '沼平線': 1.07 };

console.log('\n═══ A. 軌道路網 data/afr.json ═══');
const track = JSON.parse(readFileSync('data/afr.json', 'utf8'));
ok(track.lines?.length === 4, `4 條線（實得 ${track.lines?.length}）`);
for (const ln of track.lines) {
  const nm = ln.name || ln.id;
  const ds = ln.stations.map(s => s.d);
  ok(ds.every((d, i) => i === 0 || d > ds[i - 1]), `${nm}：里程 d 嚴格遞增（${ln.stations.length} 站）`);
  ok(ln.shape.every(p => p.length === 2 && p.every(Number.isFinite)), `${nm}：shape ${ln.shape.length} 點無 NaN/null`);
  let worst = { n: null, d: 0 };
  for (const st of ln.stations) {
    const dm = distToLine([st.lat, st.lon], ln.shape);
    if (dm > worst.d) worst = { n: st.name, d: dm };
  }
  ok(worst.d <= 150, `${nm}：最遠站 ${worst.n} 離軌 ${worst.d.toFixed(0)}m（上限 150m）`);
  const key = Object.keys(SHAPE_KM).find(k => nm.includes(k));
  if (key) {
    const L = ln.shape.reduce((s, p, i) => i ? s + hav(ln.shape[i - 1], p) : 0, 0) / 1000;
    ok(Math.abs(L - SHAPE_KM[key]) / SHAPE_KM[key] <= 0.05, `${nm}：長度 ${L.toFixed(2)}km（基準 ${SHAPE_KM[key]}km）`);
  }
}
ok(track.lines.find(l => l.name.includes('本線')).stations.map(s => s.name).join() === MAIN_ORDER.join(),
  '本線站序＝嘉義…二萬平→神木（末站依幾何現實為神木，非官方的阿里山）');

console.log('\n═══ B. 獨立山螺旋（錯接會被拉直／出現銳角）═══');
{
  const main = track.lines.find(l => l.stations.some(s => s.name === '獨立山'));
  const st = main.stations.find(s => s.name === '獨立山');
  const inR = main.shape.map(p => hav(p, [st.lat, st.lon]) < 900);
  let bi = 0, bl = 0, ci = -1, cl = 0;
  inR.forEach((v, i) => { if (v) { if (ci < 0) ci = i; cl++; if (cl > bl) { bl = cl; bi = ci; } } else { ci = -1; cl = 0; } });
  const seg = main.shape.slice(bi, bi + bl);
  let acc = 0, prev = null, sharp = 0;
  for (let i = 1; i < seg.length; i++) {
    const jump = hav(seg[i - 1], seg[i]), b = brg(seg[i - 1], seg[i]);
    if (prev !== null) {
      let d = b - prev; while (d > 180) d -= 360; while (d < -180) d += 360;
      acc += d; if (Math.abs(d) > 100 && jump > 15) sharp++;
    }
    prev = b;
  }
  ok(Math.abs(acc) / 360 >= 1.4, `螺旋累積轉向 ${(Math.abs(acc) / 360).toFixed(2)} 圈（錯接會抵消到 <0.5 圈）`);
  ok(sharp === 0, `螺旋區銳角接縫 ${sharp} 處（錯接特徵，應為 0）`);
}

console.log('\n═══ C. 之字形折返（阿里山碰壁）═══');
{
  const main = track.lines.find(l => l.stations.some(s => s.name === '第一分道'));
  const at = n => main.stations.find(s => s.name === n);
  const [p1, p2, p3, p4] = ['屏遮那', '第一分道', '第二分道', '二萬平'].map(at);
  ok(p2.lat > p1.lat && p3.lat < p2.lat && p4.lat < p3.lat,
    `折返形態正確：屏遮那${p1.lat}→第一分道${p2.lat}↑→第二分道${p3.lat}↓→二萬平${p4.lat}↓`);
}

console.log('\n═══ D. 班表 data/afr_schedule_dense.json ═══');
const sch = JSON.parse(readFileSync('data/afr_schedule_dense.json', 'utf8'));
ok(sch.trains?.length === 10, `10 個車次（實得 ${sch.trains?.length}）`);
for (const no of ['5', '8']) {
  const t = sch.trains.find(x => String(x.train) === no);
  const names = t.stops.map(s => s.name);
  const expect = no === '5' ? T5_EXPECT : [...T5_EXPECT].reverse();
  ok(names.length === 18, `車次 ${no}：densify 後 18 站（實得 ${names.length}）`);
  ok(names.join() === expect.join(), `車次 ${no}：站序正確（含神木，未抄捷徑）`);
}
ok(sch.trains.find(x => String(x.train) === '5').stops.filter(s => s.stop !== false).map(s => s.name).join() === T5_SCHEDULED.join(),
  '車次 5：實際停靠站未被 densify 改動（7 站）');
let mono = true;
for (const tr of sch.trains) for (let i = 0; i < tr.stops.length; i++) {
  if (tr.stops[i].arrSec > tr.stops[i].depSec) mono = false;
  if (i && tr.stops[i].arrSec < tr.stops[i - 1].depSec) mono = false;
}
ok(mono, '全部 10 車次時刻單調不遞減');
const tp = new Map();
for (const ln of track.lines) for (const s of ln.stations) tp.set(s.name, [s.lat, s.lon]);
let bad = [];
for (const tr of sch.trains) for (const s of tr.stops) {
  const p = tp.get(s.name);
  if (!p || p[0] !== s.lat || p[1] !== s.lon) bad.push(s.name);
}
ok(bad.length === 0, `班表站座標與軌道同源${bad.length ? '：' + [...new Set(bad)].join(',') : ''}`);
const traKeys = new Set(JSON.parse(readFileSync('data/tra_schedule_dense.json', 'utf8')).types.map(t => t.key));
const clash = sch.types.map(t => t.key).filter(k => traKeys.has(k));
ok(clash.length === 0, `車種 key 不撞台鐵（${sch.types.map(t => t.key).join('/')}）`);
ok(sch.trains.every(t => t.typeName && t.carName), '每個車次都有 typeName/carName（空值會讓列車畫不出來）');

console.log('\n═══ E. 端到端（Playwright 真引擎）═══');
for (const [engine, name] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
  const b = await engine.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto(BASE + '/?_cb=' + name, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof state !== 'undefined' && state.systems
    && state.systems.some(s => s.id === 'afr_sched') && state.systems.find(s => s.id === 'afr_sched')._track, { timeout: 30000 });
  await p.waitForFunction(() => state.ready === true, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1200);

  const r = await p.evaluate(() => {
    loadSystem(state.systems.find(s => s.id === 'afr_sched'));
    const H = (a, b) => { const R = 6371000, q = Math.PI / 180; return 2 * R * Math.asin(Math.sqrt(Math.sin((b[0] - a[0]) * q / 2) ** 2 + Math.cos(a[0] * q) * Math.cos(b[0] * q) * Math.sin((b[1] - a[1]) * q / 2) ** 2)); };
    state.simSec = 11 * 3600; // 11:00，本線車次 1/5 都在山裡跑
    const shapes = state.trackLines.map(l => l.shape);
    let running = 0, offTrack = [];
    for (const tr of state.trains) {
      const pos = trainPos(tr, state.simSec);
      if (!pos) continue;
      running++;
      const d = Math.min(...shapes.map(sh => Math.min(...sh.map(q => H([pos.lat, pos.lon], q)))));
      if (d > 50) offTrack.push(`${tr.train}:${d.toFixed(0)}m`);
    }
    return { group: state.group, sysId: state.sysId, trains: state.trains.length,
      seg: state._segStats, types: state.types.map(t => t.key), running, offTrack };
  });
  ok(r.sysId === 'afr_sched' && r.group === 'nat', `[${name}] 林鐵掛在國家鐵路群組`);
  ok(r.trains === 10, `[${name}] 10 車次載入`);
  ok(r.seg.straight === 0 && r.seg.onShape > 0, `[${name}] 貼軌 ${r.seg.onShape} 段全部貼上軌道、0 段退回直線`);
  ok(r.running > 0, `[${name}] 11:00 有 ${r.running} 班在跑`);
  ok(r.offTrack.length === 0, `[${name}] 所有奔跑中列車都在軌道上（>50m 者：${r.offTrack.join(',') || '無'}）`);

  // 手機寬度：國家鐵路三個成員鈕都要能被摸到（沿可捲祖先捲動後做命中測試，見全域規則心得19）
  for (const w of [360, 375, 414, 768]) {
    await p.setViewportSize({ width: w, height: 780 });
    await p.waitForTimeout(400);
    const m = await p.evaluate(() => {
      const btns = [...document.querySelectorAll('#systems .mem')];
      const out = [];
      for (const b of btns) {
        const sc = (() => { let e = b.parentElement; while (e) { const s = getComputedStyle(e); if (/auto|scroll/.test(s.overflowX + s.overflowY)) return e; e = e.parentElement; } return null; })();
        if (sc) sc.scrollLeft = b.offsetLeft - 10;
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        out.push({ t: b.textContent.trim(), h: r.height, ok: !!hit && (hit === b || b.contains(hit)) });
      }
      return out;
    });
    const afr = m.find(x => x.t.includes('阿里山'));
    ok(!!afr && afr.ok, `[${name}] ${w}px：「${afr?.t || '?'}」按鈕可點擊命中`);
    // 高度絕對值不比(chromium 29px / webkit 27px 是引擎字體度量差,且是既有設計);
    // 要驗的是「新增第三個成員沒有把成員列弄壞」——三顆高度一致即可。
    ok(new Set(m.map(x => Math.round(x.h))).size === 1,
      `[${name}] ${w}px：三個成員鈕高度一致（${m.map(x => x.h.toFixed(0)).join('/')}px）`);
  }
  await b.close();
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} 過 / ${fail} 敗\n`);
process.exit(fail ? 1 : 0);
