// 阿里山林鐵(v0719f)獨立驗證——資料層斷言 + Playwright 真引擎(chromium+webkit)端到端 + 手機寬度。
// v0719f 增列:F 林鐵四種列車介紹卡有描述、G 台糖五分車景點標記(座標對獨立轉錄、記號畫素、點擊開卡)。
// 本腳本不參與實作,判準來自 TDX 原始資料與地理事實,刻意不看 build_afr.mjs 怎麼做:
//
//   · TDX v3/Rail/AFR 才有資料(v2 全 404)。官方本線 StationOfLine 為 17 站,序尾是
//     「…第二分道→二萬平→阿里山」——但本線 shape 幾何終點在神木(離軌1.2m)、阿里山離本線 503m,
//     實際路線是 二萬平→神木→阿里山(最後 1.3km 由神木線提供)。故車次5/8(嘉義↔阿里山)densify
//     後必為 18 站,若出現 17 站即代表最短路徑抄了「二萬平→阿里山」的捷徑、跳過神木。
//   · 站碼 360-381 連號(缺 364,已廢站),本線實體站序即 MAIN_ORDER 那 17 站。
//   · TDX MULTILINESTRING 有本線1處、祝山線4處跨分量缺口；不能畫直線穿越山谷，現以 OSM
//     active narrow_gauge ways 補齊。祝山線 104m 弦對應的真實繞行甚至達約675m，是必要驗收點。
//   · 獨立山螺旋是繞山盤旋上升,拼接錯誤(在 2D 自我交叉的分岔節點選錯圈次)會讓累積轉向互相
//     抵消並在接縫留下銳角。用「路徑自身累積轉向角」量,不可用「相對重心方位角」(偏心螺旋會失真)。
//   · TDX 班次的 TrainTypeID/TrainTypeName 十班全 null,車種是本專案依起訖路線歸類的四類;
//     前端用 typeName 做繪製 gate(state.visible.has),故 key 不可與台鐵車種相撞。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

// 伺服器自己起,連接埠由 OS 指派(PORT=0 那顆先探再交棒),不再預設連 5179。
// 原因是實測踩到的:5179 當下是另一個 worktree 的 dev server,腳本會一聲不響地去驗**別人的樹**
// ——全綠也毫無意義(全域規則:前端驗證會驗到別人的樹;本機同時有 30+ 個並行 worktree)。
// ROOT 由本檔自身路徑推導,不吃 --root/env,結構上只可能服務自己這棵樹;開跑前再用 md5
// 斷言「伺服器吐回來的 index.html === ROOT/index.html」,把「我在量誰」這件事變成具名閘門。
// PORT 仍可覆寫(指向已在跑的 server),但那條路要自己負責樹對不對,故 md5 閘門一樣會跑。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);                                   // 資料層一律讀 ROOT 底下,不吃呼叫端 cwd
const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
let child = null;
const PORT = process.env.PORT || await freePort();
const BASE = `http://localhost:${PORT}`;
if (!process.env.PORT) {
  child = spawn(process.execPath, [path.join(ROOT, 'scripts/dev_server.mjs')], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'inherit'] });
  process.on('exit', () => child?.kill());
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { child?.kill(); process.exit(1); });
}
for (let i = 0; ; i++) {                               // 等它真的聽得到,不用固定秒數
  try { const r = await fetch(BASE + '/index.html'); if (r.ok) break; } catch {}
  if (i > 100) { console.error(`✗ dev server 起不來（${BASE}）`); child?.kill(); process.exit(1); }
  await new Promise(r => setTimeout(r, 100));
}
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const hav = (a, b) => {
  const R = 6371000, p = Math.PI / 180;
  return 2 * R * Math.asin(Math.sqrt(Math.sin((b[0] - a[0]) * p / 2) ** 2 +
    Math.cos(a[0] * p) * Math.cos(b[0] * p) * Math.sin((b[1] - a[1]) * p / 2) ** 2));
};
const brg = (a, b) => Math.atan2((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI;
// 點到 polyline 的距離必須量「到線段」而非「到頂點」:軌道是連續的線,頂點只是取樣。
// 站點離軌需量到線段而非頂點；頂點只是折線取樣，不能拿點距代替線距。
function distToSeg(p, a, b) {
  const k = Math.cos(p[0] * Math.PI / 180), R = 111320;
  const px = (p[1] - a[1]) * k * R, py = (p[0] - a[0]) * R;
  const bx = (b[1] - a[1]) * k * R, by = (b[0] - a[0]) * R;
  const L2 = bx * bx + by * by;
  const t = L2 ? Math.max(0, Math.min(1, (px * bx + py * by) / L2)) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}
const distToLine = (p, shape) => {                      // shape 可以是一條線，也可以是一疊線
  if (Array.isArray(shape[0]?.[0])) return Math.min(...shape.map(s => distToLine(p, s)));
  let m = Infinity;
  for (let i = 1; i < shape.length; i++) { const d = distToSeg(p, shape[i - 1], shape[i]); if (d < m) m = d; }
  return m;
};

const MAIN_ORDER = ['嘉義', '北門', '鹿麻產', '竹崎', '樟腦寮', '獨立山', '梨園寮', '交力坪',
  '水社寮', '奮起湖', '多林', '十字路', '屏遮那', '第一分道', '第二分道', '二萬平', '神木'];
const T5_EXPECT = [...MAIN_ORDER, '阿里山'];
const T5_SCHEDULED = ['嘉義', '北門', '竹崎', '交力坪', '奮起湖', '二萬平', '阿里山'];
const SHAPE_KM = { '本線': 69.47, '祝山線': 5.81, '神木線': 1.29, '沼平線': 1.07 };

// G0 我在量的是誰:伺服器吐回來的 index.html 必須逐 byte 等於這棵樹的那份。
// 這條紅掉代表 PORT 指到了別的樹(或別的 session 的 server),下面 120 條全部不算數。
const servedMd5 = createHash('md5').update(Buffer.from(await (await fetch(BASE + '/index.html')).arrayBuffer())).digest('hex');
const localMd5 = createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
console.log(`\n═══ G0. 驗證目標 ═══\n  ROOT=${ROOT}\n  index.html md5=${localMd5}（server :${PORT} 吐回 ${servedMd5}）`);
ok(servedMd5 === localMd5, `伺服器服務的是本樹（${BASE}）`);

console.log('\n═══ A. 軌道路網 data/afr.json ═══');
const track = JSON.parse(readFileSync('data/afr.json', 'utf8'));
// aux=true 是站內股道(之字形折返股),不是營業線:官方站序/里程/長度那幾條只對營業線成立。
const revenue = track.lines?.filter(l => !l.aux) || [], yards = track.lines?.filter(l => l.aux) || [];
ok(revenue.length === 4, `4 條營業線（實得 ${revenue.length}）`);
for (const ln of revenue) {
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
ok(revenue.find(l => l.name.includes('本線')).stations.map(s => s.name).join() === MAIN_ORDER.join(),
  '本線站序＝嘉義…二萬平→神木（末站依幾何現實為神木，非官方的阿里山）');
{
  // ── 站內股道：畫出來的線要蓋到「列車真的停在哪」──────────────────────────────
  // 2026-09-07 裁示「軌道都要跟新的、正確的資訊」。列車位置自 0f5bb774 起改吃實體股道
  // (rail-3d/physical，index.html trainPosAt 第一行，沒有 zoom 閘門)，而 TDX 的 Shape 只給營業
  // 線、不含之字形折返股 ⇒ 停靠中的車會畫在官方線形之外(阿里山 94m、神木 164m)。
  // 判準刻意不寫「有幾條股道」(那會跟著資料漂)，而是量真正的不變量：**林鐵每一個實體停靠點
  // 都要有軌道畫得出來**。這條在資料層就成立，涵蓋全天所有班次，不只 E 段抽樣的 11:00。
  const sidecar = JSON.parse(readFileSync('data/afr_station_tracks.json', 'utf8'));
  ok(yards.length > 0 && JSON.stringify(yards) === JSON.stringify(sidecar.lines),
    `站內股道與 data/afr_station_tracks.json 逐欄一致（${yards.length} 條）`);
  ok(yards.every(l => l.shape.length >= 2 && l.shape.every(p => p.length === 2 && p.every(Number.isFinite))),
    '站內股道 shape 無 NaN/null');
  // 股道是站內的短股，不該長成一條新路線；而且必須接得回營業線，不能是浮空的碎片。
  const longest = Math.max(...yards.map(l => l.shapeLen));
  ok(longest <= 0.5, `每條站內股道都短於 0.5km（最長 ${(longest * 1000).toFixed(0)}m）`);
  const detached = yards.filter(l =>
    Math.min(...l.shape.map(p => Math.min(...revenue.map(r => distToLine(p, r.shape))))) > 20);
  ok(detached.length === 0, `站內股道都接得回營業線（浮空的：${detached.map(l => l.id).join(',') || '無'}）`);

  const net = JSON.parse(readFileSync('rail-3d/physical/network.json', 'utf8'));
  const dispatch = JSON.parse(readFileSync('rail-3d/physical/dispatch.json', 'utf8'));
  const at = new Map();
  for (const w of net.ways) w.nodes.forEach((n, i) => at.set(String(n), [w.coordinates[i][1], w.coordinates[i][0]]));
  const stops = new Set();   // 派軌路徑的起訖節點＝motion.js 停靠(dwell)時吐出來的座標
  for (const [key, plan] of Object.entries(dispatch.plans)) if (key.startsWith('afr_sched:'))
    for (const id of plan.pathIds) { stops.add(String(net.paths[id].from)); stops.add(String(net.paths[id].to)); }
  const shapes = track.lines.map(l => l.shape);
  const far = [...stops].map(n => ({ n, name: net.nodeTags[n]?.name || n, d: distToLine(at.get(n), shapes) }))
    .filter(x => x.d > 50).sort((a, b) => b.d - a.d);
  ok(far.length === 0, `${stops.size} 個實體停靠點都在畫得出來的軌道上（>50m 者：`
    + `${far.map(x => `${x.name}:${x.d.toFixed(0)}m`).join(',') || '無'}）`);
  // 反向對照(判準恆真的話上面那條就毫無訊號):拿掉站內股道，阿里山與神木必須立刻紅回來。
  const withoutYards = revenue.map(l => l.shape);
  const regress = [...stops].filter(n => distToLine(at.get(n), withoutYards) > 50).length;
  ok(regress > 0, `控制組：只用營業線時有 ${regress} 個停靠點離線 >50m（證明上一條會紅）`);
}
{
  const fills = JSON.parse(readFileSync('data/afr_osm_gap_fills.json', 'utf8'));
  ok(fills.fills?.length === 5 && /OpenStreetMap/.test(fills.source), '5處 TDX 缺口均有 OSM ODbL 補線來源');
  for (const fill of fills.fills) {
    const ln = track.lines.find(l => l.id === fill.lineId);
    const worst = Math.max(...fill.path.map(p => distToLine(p, ln.shape)));
    ok(worst < 5, `${fill.lineId} OSM way ${fill.wayIds.join('/')} 已進成品線形（最大偏離 ${worst.toFixed(1)}m）`);
  }
}

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
// 車次組成:TDX 常態表 10 班,扣除祝山線觀日列車 97/98(佔位時間,前端逐日推算合成),
// 加官網補充的沼平/神木完整區間車 42 班(TDX 只收每線最後一往返)→ 靜態班表應為 50 班。
ok(sch.trains?.length === 50, `50 個車次（TDX 10−祝山2＋官網補充42；實得 ${sch.trains?.length}）`);
// ── 沼平/神木完整班表:獨立基準逐格轉錄自「車站張貼紙本時刻表」照片(網友 2026-07 回報,
//    與 build 所用的官網 afrch 0000300 是兩個獨立來源——任一邊轉錄錯就對不上)──
{
  const PHOTO = { // 車次→發車時刻(左欄阿里山出發、右欄沼平/神木出發,照片兩欄合併)
    '31': '09:00', '33': '09:30', '100': '09:40', '35': '10:00', '102': '10:10', '37': '10:30',
    '104': '10:40', '39': '11:00', '106': '11:10', '41': '11:30', '108': '11:40', '43': '13:00',
    '110': '13:10', '45': '13:30', '112': '13:40', '47': '14:00', '114': '14:10', '49': '14:30',
    '116': '14:40', '51': '15:10', '118': '15:20', '53': '15:40', '120': '15:50',
    '32': '09:20', '34': '09:50', '101': '10:00', '36': '10:20', '103': '10:30', '38': '10:50',
    '105': '11:00', '40': '11:20', '107': '11:30', '42': '11:50', '109': '12:00', '44': '13:20',
    '111': '13:30', '46': '13:50', '113': '14:00', '48': '14:20', '115': '14:30', '50': '15:00',
    '117': '15:10', '52': '15:30', '119': '15:40', '54': '16:00', '121': '16:10',
  };
  const hm = s => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}`;
  const bad = [];
  for (const [no, dep] of Object.entries(PHOTO)) {
    const t = sch.trains.find(x => String(x.train) === no);
    if (!t) { bad.push(`${no}缺`); continue; }
    if (hm(t.stops[0].depSec) !== dep) bad.push(`${no}:${hm(t.stops[0].depSec)}≠照片${dep}`);
  }
  ok(bad.length === 0, `沼平/神木全部 ${Object.keys(PHOTO).length} 班與紙本時刻表照片逐班一致${bad.length ? '：' + bad.slice(0, 5).join(',') : ''}`);
  const zp = sch.trains.filter(t => t.typeName === '沼平線'), sm = sch.trains.filter(t => t.typeName === '神木線');
  ok(zp.length === 24 && sm.length === 22, `沼平線 ${zp.length} 班(12往返)、神木線 ${sm.length} 班(11往返)`);
  const runBad = [...zp, ...sm].filter(t => {
    const run = (t.stops[t.stops.length - 1].arrSec - t.stops[0].depSec) / 60;
    return run !== (t.typeName === '沼平線' ? 6 : 7);
  });
  ok(runBad.length === 0, `行駛時間全對（沼平 6 分/神木 7 分）${runBad.length ? '：' + runBad.map(t => t.train).join(',') : ''}`);
}
ok(!sch.trains.some(t => ['97', '98'].includes(String(t.train))), '靜態班表不含 97/98（佔位時間防線；觀日列車由前端逐日推算合成）');
ok((sch.types || []).some(t => t.key === '祝山線'), 'types 保留「祝山線」（前端合成的觀日列車要掛這個 key）');
{ // 祝山線的軌道仍必須畫出來——排除的是班次,不是路線
  const zs = track.lines.find(l => (l.name || '').includes('祝山'));
  ok(!!zs && zs.shape.length > 20, `祝山線軌道仍在（shape ${zs?.shape?.length} 點）`);
}
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
ok(mono, '全部 50 車次時刻單調不遞減');
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

// 觀日列車獨立基準:日出表逐格抄自使用者提供的官方訂票系統截圖(afrts/afrch 同表),
// 不是從 index.html 複製——實作內嵌表若轉錄有誤,期望值就對不上。
// 校準點:2026-07-19 官方公告「04:20 開車/回程末班 06:10」,當旬(7月16~20)日出 05:32
// → 去程=日出−72分、回程=日出+38分,四捨五入到 5 分(官方公告慣例粒度)。
const SUNRISE_INDEP = [
  ['07:05', '07:02', '06:40', '06:00', '05:29', '05:19', '05:25', '05:36', '05:48', '06:13', '06:32', '06:50'],
  ['07:08', '07:01', '06:33', '05:50', '05:28', '05:21', '05:27', '05:40', '05:50', '06:18', '06:35', '06:54'],
  ['07:06', '06:54', '06:28', '05:42', '05:25', '05:19', '05:30', '05:41', '05:56', '06:20', '06:37', '06:57'],
  ['07:05', '06:52', '06:18', '05:39', '05:23', '05:20', '05:32', '05:45', '05:58', '06:21', '06:40', '06:59'],
  ['07:05', '06:47', '06:13', '05:35', '05:21', '05:24', '05:33', '05:46', '06:01', '06:23', '06:43', '07:03'],
  ['07:03', '06:45', '06:06', '05:30', '05:20', '05:25', '05:34', '05:47', '06:09', '06:30', '06:48', '07:04'],
];
const todayTW = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()); // YYYY-MM-DD
{
  const [, mTW, dTW] = todayTW.split('-').map(Number);
  const [sh, sm] = SUNRISE_INDEP[Math.min(5, Math.floor((dTW - 1) / 5))][mTW - 1].split(':').map(Number);
  var sunriseSec = sh * 3600 + sm * 60;
}
const r5i = s => Math.round(s / 300) * 300;
const expDep = r5i(sunriseSec - 72 * 60), expRet = r5i(sunriseSec + 38 * 60);

// 台糖五園區座標——獨立第二次轉錄自 afr_sugar_research.md(維基 infobox 度分秒換算),
// 刻意不從 index.html 複製;實作端抄錯或此處抄錯都會在 G 段現形。
const SUGAR_INDEP = {
  '溪湖糖廠': [23.9520, 120.4812],
  '蒜頭糖廠': [23.4794, 120.2997],
  '烏樹林': [23.3286, 120.3744],
  '新營糖廠': [23.2997, 120.3169],
  '橋頭糖廠': [22.7578, 120.3142],
};

console.log('\n═══ E. 端到端（Playwright 真引擎）═══');
// 視窗尺寸一律在 newContext 就釘死,不用 setViewportSize:headless chromium 的視窗是
// maximized,事後改尺寸會被 CDP 擋下(Browser.setWindowBounds「To resize minimized/maximized/
// fullscreen window, restore it to normal state first.」),整支腳本在手機寬度迴圈第一圈就崩。
// 每個寬度開自己的 context 還有一個好處:版面是「以該寬度載入」的,與真實手機一致,
// 不會驗到「桌面版面被縮窄」這種現實不存在的中間態。
//
// locale 一律釘 zh-TW(context locale ＋ ?lang=zh-TW 兩道):本頁多語化之後,成員鈕文字與
// 看板文案都會跟著瀏覽器語系走,而本腳本的判準是中文字串;Playwright chromium 預設 en-US,
// 不釘的話「阿里山」永遠找不到、看板 sub 也對不上——那是判準在量語系,不是在量功能。
const openPage = async (b, name, width, height) => {
  const ctx = await b.newContext({ viewport: { width, height }, locale: 'zh-TW' });
  const p = await ctx.newPage();
  await p.goto(BASE + `/?_cb=${name}${width}&lang=zh-TW`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof state !== 'undefined' && state.systems
    && state.systems.some(s => s.id === 'afr_sched') && state.systems.find(s => s.id === 'afr_sched')._track, { timeout: 30000 });
  await p.waitForFunction(() => state.ready === true, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1200);
  // 首訪教學卡(#howtoWrap,z800)蓋住地圖上所有卡片與 elementFromPoint——按「開始看車」收掉,
  // 等同真實首訪者的第一個動作;不用 localStorage 預塞,讓教學卡照常出現過一次。
  await p.evaluate(() => { const w = document.getElementById('howtoWrap'); if (w && !w.hidden) document.getElementById('howtoGo').click(); });
  await p.waitForTimeout(200);
  return { ctx, p };
};

for (const [engine, name] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
  const b = await engine.launch();
  const { ctx: deskCtx, p } = await openPage(b, name, 1280, 900);
  // 語系具名閘門:下面所有中文判準都預設頁面是 zh-TW。語系若沒生效要在這裡紅,
  // 而不是讓它散成一堆「找不到某某字串」的假回歸(全域規則:驗收腳本必須釘死語系與時鐘)。
  const lang = await p.evaluate(() => document.documentElement.lang);
  ok(/^zh/.test(lang), `[${name}] 頁面語系釘在中文（實得 ${lang || '(空)'}）`);

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
      groupMembers: (GROUPS.find(g => g.id === state.group) || {}).members || [],
      seg: state._segStats, types: state.types.map(t => t.key), running, offTrack };
  });
  // 判準原本釘死 state.group === 'nat'。'nat'(國家鐵路)還在,但林鐵之後也被收進 'tra'(台鐵)這個
  // **有分頁**的群組(members: tra_sched + afr_sched),loadSystem 落點自然是分頁那一個 ⇒ 判準過期。
  // 要驗的本意是「林鐵跟台鐵同群、不是自己一群也不是被丟到捷運」,所以改驗成員關係而不是群組 id
  // ——id 會再改,成員關係才是這條判準真正在乎的事。
  ok(r.sysId === 'afr_sched' && r.groupMembers.includes('afr_sched') && r.groupMembers.includes('tra_sched'),
    `[${name}] 林鐵與台鐵同群（載入群組 ${r.group}：${r.groupMembers.join('/') || '無成員'}）`);
  ok(r.trains === 52, `[${name}] 52 車次載入（靜態 50＋前端合成觀日 97/98）`);
  ok(r.seg.straight === 0 && r.seg.onShape > 0, `[${name}] 貼軌 ${r.seg.onShape} 段全部貼上軌道、0 段退回直線`);
  ok(r.running > 0, `[${name}] 11:00 有 ${r.running} 班在跑`);
  ok(r.offTrack.length === 0, `[${name}] 所有奔跑中列車都在軌道上（>50m 者：${r.offTrack.join(',') || '無'}）`);

  // ── 祝山線觀日列車（前端依官方日出表推算合成）──
  // 期望值由本腳本自帶的日出表獨立算出:表值抄自使用者提供的官方訂票系統截圖(與 afrch 0000300 同表),
  // 是對實作內嵌表的獨立轉錄——兩邊若有一邊抄錯,此處對不上。
  // 祝山線站座標取自 data/afr.json 本身(下方 ZS_FILE),不取執行期的 _track.stations:
  // 08-19 173bcf40「停靠中的列車不再被畫到自己那條線的外面」之後,前端會把離線形 20–300m 的站
  // 就地校正到線上(index.html 的 posAlongShape 貼軌),阿里山正是這種站(原始點離自己的線 115m)。
  // 於是「合成班次的停靠站座標 === 執行期站座標」永遠不可能成立——那是在驗貼軌有沒有跑,
  // 不是在驗同源。改對檔案逐 byte 比,反而比原判準更嚴:抄錯一個座標仍然當場現形。
  const ZS_FILE = Object.fromEntries(track.lines.find(l => l.name === '祝山線').stations.map(s => [s.name, [s.lat, s.lon]]));
  const zr = await p.evaluate(([expDep, expRet, ZSF]) => {
    const t97 = state.trains.find(t => String(t.train) === '97');
    const t98 = state.trains.find(t => String(t.train) === '98');
    if (!t97 || !t98) return { missing: true };
    const zs = state.systems.find(s => s.id === 'afr_sched')._track.lines.find(l => l.name === '祝山線');
    const sameSrc = [...t97.stops, ...t98.stops].every(s => {
      const ref = ZSF[s.name];
      return !!ref && ref[0] === s.lat && ref[1] === s.lon;
    });
    // 動畫在軌:發車後 15 分應有位置,且貼祝山線
    const H = (a, b) => { const R = 6371000, q = Math.PI / 180; return 2 * R * Math.asin(Math.sqrt(Math.sin((b[0] - a[0]) * q / 2) ** 2 + Math.cos(a[0] * q) * Math.cos(b[0] * q) * Math.sin((b[1] - a[1]) * q / 2) ** 2)); };
    const pos = trainPos(t97, t97.stops[0].depSec + 900);
    const onZs = pos ? Math.min(...zs.shape.map(q => H([pos.lat, pos.lon], q))) : Infinity;
    // 站台看板:簡回發車前 10 分,阿里山站看板要列出 97+推算標,且 sub 不得謊稱誤點推估
    state.simSec = t97.stops[0].depSec - 600;
    const st = state.schedStations.find(s => s.name === '阿里山' && s.sys === 'afr_sched');
    openBoard(st);
    const bd = document.getElementById('board');
    const row97 = [...bd.querySelectorAll('.row')].find(el => el.querySelector('b')?.textContent === '97');
    const sub = bd.querySelector('.sub')?.textContent || '';
    closeBoard();
    return {
      dep97: t97.stops[0].depSec, dep98: t98.stops[0].depSec,
      est: !!(t97.est && t98.est), car: t97.carName, sys97: t97.sys, sameSrc,
      pos: !!pos, onZs, hasRow: !!row97, rowEst: !!row97?.querySelector('.estTag'), sub,
    };
  }, [expDep, expRet, ZS_FILE]);
  if (zr.missing) ok(false, `[${name}] 觀日列車 97/98 未被合成`);
  else {
    const hm = s => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}`;
    ok(zr.dep97 === expDep, `[${name}] 97 發車 ${hm(zr.dep97)}＝日出−72分（獨立表期望 ${hm(expDep)}）`);
    ok(zr.dep98 === expRet, `[${name}] 98 回程 ${hm(zr.dep98)}＝日出+38分（獨立表期望 ${hm(expRet)}）`);
    if (todayTW === '2026-07-19') ok(zr.dep97 === 4 * 3600 + 20 * 60 && zr.dep98 === 6 * 3600 + 10 * 60,
      `[${name}] 與今日官方公告完全吻合（04:20 開車／回程末班 06:10）`);
    ok(zr.est && /觀日/.test(zr.car), `[${name}] 97/98 帶 est 旗標、carName=${zr.car}`);
    ok(zr.sys97 === 'afr_sched', `[${name}] 97 蓋 afr_sched 章（liveDelaySec 的 sys gate 前提，防誤吃台鐵同號誤點）`);
    ok(zr.sameSrc, `[${name}] 合成班次站座標與軌道同源`);
    ok(zr.pos && zr.onZs < 50, `[${name}] 發車+15分 有位置且貼祝山線（離軌 ${zr.onZs.toFixed(0)}m）`);
    ok(zr.hasRow && zr.rowEst, `[${name}] 阿里山站看板列出 97 且帶「推算」標`);
    ok(/無即時資訊/.test(zr.sub) && !/誤點推估/.test(zr.sub), `[${name}] 林鐵看板 sub 不謊稱誤點推估（實際：${zr.sub.slice(0, 30)}…）`);
  }

  // ── F. 林鐵列車介紹卡（v0719f）：四種列車都要有描述且含各自的關鍵事實詞 ──
  const fr = await p.evaluate(() => {
    const out = {};
    for (const [tn, kw] of [['阿里山號', /獨立山/], ['沼平線', /櫻花/], ['神木線', /巨木/], ['祝山線', /日出/]]) {
      const tr = state.trains.find(t => t.typeName === tn);
      const it = tr ? trainIntro(tr) : null;
      out[tn] = { has: !!(it && it.desc), kw: !!(it && it.desc && kw.test(it.desc)) };
    }
    out.traOk = TYPE_DESC['區間車'] === '站站皆停的通勤電聯車。'; // 台鐵既有描述不受波及
    return out;
  });
  for (const tn of ['阿里山號', '沼平線', '神木線', '祝山線'])
    ok(fr[tn].has && fr[tn].kw, `[${name}] ${tn} 介紹卡有描述且含關鍵事實詞`);
  ok(fr.traOk, `[${name}] 台鐵既有車種描述未被動到`);

  // ── G. 台糖五分車景點標記（v0719f）──
  // 座標基準=對研究報告(afr_sugar_research.md,維基 infobox 換算)的獨立第二次轉錄,
  // 與 index.html 內嵌值分開手抄——任一邊抄錯此處對不上。
  const gr = await p.evaluate((INDEP) => {
    const H = (a, b) => { const R = 6371000, q = Math.PI / 180; return 2 * R * Math.asin(Math.sqrt(Math.sin((b[0] - a[0]) * q / 2) ** 2 + Math.cos(a[0] * q) * Math.cos(b[0] * q) * Math.sin((b[1] - a[1]) * q / 2) ** 2)); };
    const out = { n: SUGAR_PARKS.length, fields: true, coordOk: [] };
    for (const pk of SUGAR_PARKS) {
      if (!(pk.name && pk.full && pk.town && pk.blurb && pk.hours)) out.fields = false;
      const ref = INDEP[pk.name];
      out.coordOk.push(ref ? H([pk.lat, pk.lon], ref) < 50 : false);
    }
    // 橋頭園區:飛到 z13、手動補一幀,驗記號畫素(非透明暖色)+命中表+點擊開卡(像素級雙證據,心得24)
    const qt = SUGAR_PARKS.find(x => x.name === '橋頭糖廠');
    // 相機走 M 適配層:M4-B 拔 Leaflet 後 window.__map 是 raw maplibregl.Map,沒有 setView。
    window.__M.setView([qt.lat, qt.lon], 13, { animate: false });
    draw();
    const h = (state._sugarHits || []).find(x => x.pk === qt);
    let px = null, hitOk = false, cardShown = false, cardTitle = '', cardHitOk = false;
    if (h) {
      const d = ctx.getImageData(Math.round(h.x * state.dpr), Math.round(h.y * state.dpr), 1, 1).data;
      px = [d[0], d[1], d[2], d[3]];
      const hit = sugarAt({ x: h.x, y: h.y });
      hitOk = !!hit;
      if (hit) {
        openSugarCard(hit.pk);
        const el = document.getElementById('sugarCard');
        const r = el.getBoundingClientRect();
        cardShown = !el.hidden && r.width > 100;
        cardTitle = el.querySelector('.xc-ttl b')?.textContent || '';
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + 30);
        cardHitOk = !!at && el.contains(at);
        closeSugarCard();
      }
    }
    return { ...out, hasHit: !!h, px, hitOk, cardShown, cardTitle, cardHitOk };
  }, SUGAR_INDEP);
  ok(gr.n === 5 && gr.fields, `[${name}] 五個園區資料齊全（name/full/town/blurb/hours）`);
  ok(gr.coordOk.every(Boolean) && gr.coordOk.length === 5, `[${name}] 五園區座標與獨立轉錄一致（<50m）`);
  ok(gr.hasHit, `[${name}] z13 橋頭園區記號進入命中表`);
  ok(!!gr.px && gr.px[3] > 0 && gr.px[0] > gr.px[2], `[${name}] 記號畫素為非透明暖色（rgba=${gr.px}）`);
  ok(gr.hitOk && gr.cardShown && /橋頭/.test(gr.cardTitle), `[${name}] 點擊命中開卡（標題：${gr.cardTitle}）`);
  ok(gr.cardHitOk, `[${name}] 卡片中心 elementFromPoint 命中（像素級證據）`);

  // 成員鈕（台鐵／阿里山林鐵）——這條列住在桌面 header 裡，故在桌面寬度量（沿可捲祖先捲動後
  // 做命中測試，見全域規則心得19）。手機殼沒有這條列，改驗它自己的路徑，見下方迴圈。
  const dm = await p.evaluate(() => {
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
  const afrMem = dm.find(x => x.t.includes('阿里山'));
  // 找不到就把實得清單寫進訊息:原本的 fallback 是「?」,紅起來只看得到一個問號,
  // 完全分不出「按鈕被蓋住」與「根本沒有這顆按鈕」——那是兩種修法完全不同的紅。
  const afrMemLabel = afrMem ? afrMem.t : `阿里山（找不到，實得 ${dm.map(x => x.t).join('/') || '零顆成員鈕'}）`;
  ok(!!afrMem && afrMem.ok, `[${name}] 1280px：成員鈕「${afrMemLabel}」可點擊命中`);
  // 高度絕對值不比(chromium 29px / webkit 27px 是引擎字體度量差,且是既有設計);
  // 要驗的是「多一個成員沒有把成員列弄壞」——每顆高度一致即可。至少要有兩顆,
  // 否則空陣列的 Set.size 是 0、單顆是 1,判準會在「成員列整個不見」時默默放行。
  ok(dm.length >= 2 && new Set(dm.map(x => Math.round(x.h))).size === 1,
    `[${name}] 1280px：${dm.length} 顆成員鈕高度一致（${dm.map(x => x.h.toFixed(0)).join('/') || '無'}px）`);

  // 手機寬度：走手機殼自己的群組路徑。
  // 判準原本在這裡量 #systems .mem 的命中,但手機殼(body.mobile-shell.fs)把整條桌面 header
  // (header.header-row)設成 display:none ⇒ 成員鈕連同整條列收成 0×0。那不是「被誰蓋住」,
  // 是設計上整條列不在版面裡(四顆群組頁籤也一樣,收成頂列右上那顆 #gtabOne「台▾」)。
  // 對著一條設計上不存在的列做命中測試永遠是紅的,而且紅得沒有資訊 ⇒ 判準過期。
  // 改驗使用者在手機上真正走的那條路:群組鈕摸得到 → 點開 → 「台鐵」那列摸得到
  // (林鐵就掛在這一群;選單只列群組不列成員)。整段是真的點一次、量它造成的狀態改變,
  // 不是只問 elementFromPoint 命中誰(全域規則:互動能力要真做一次那個互動)。
  for (const w of [360, 375, 414, 768]) {
    const { ctx: mCtx, p: mp } = await openPage(b, name, w, 780);
    const m = await mp.evaluate(() => {
      const hit = el => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return { ok: false, w: 0, h: 0 };
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { ok: !!at && (at === el || el.contains(at)), w: Math.round(r.width), h: Math.round(r.height) };
      };
      loadSystem(state.systems.find(s => s.id === 'afr_sched'));
      const hdr = document.querySelector('header.header-row');
      const one = document.getElementById('gtabOne');
      const oneHit = one ? hit(one) : { ok: false, w: 0, h: 0 };
      const oneLabel = one ? one.textContent.trim() : '(無 #gtabOne)';
      if (one) one.click();                       // 真的點一次,不是直接呼叫 gtabPopSet
      const pop = document.getElementById('gtabPop');
      const rows = [...document.querySelectorAll('#gtabPop .gp-row')]
        .map(r => ({ t: r.textContent.trim(), cur: r.getAttribute('aria-current') === 'true', ...hit(r) }));
      const cur = rows.find(r => r.cur);
      // 「哪一列該是林鐵那群」由 GROUPS 的成員關係決定,不寫死群組名——群組會改名、會多一個。
      const afrLabels = GROUPS.filter(g => (g.members || []).includes('afr_sched')).map(g => g.label);
      const popOpen = !!pop && !pop.hidden;
      // 量完就把選單收掉:它掛在頂列右上,會蓋住台糖卡的關閉鈕,讓下一項檢查紅得莫名其妙
      // (本輪實測:不收的話 360/375/414/768 四個寬度的台糖卡關閉鈕命中全部假紅)。
      if (one && popOpen) one.click();
      return { headerHidden: !hdr || getComputedStyle(hdr).display === 'none',
        oneLabel, oneHit, popOpen, popClosedAfter: !!pop && pop.hidden, rows,
        curOk: !!cur && cur.ok && afrLabels.some(lb => cur.t.includes(lb)),
        curText: cur ? cur.t : '(沒有標記 aria-current 的群組列)' };
    });
    ok(m.headerHidden && m.oneHit.ok,
      `[${name}] ${w}px：頂列群組鈕「${m.oneLabel}」可點擊命中（${m.oneHit.w}×${m.oneHit.h}px）`);
    ok(m.popOpen && m.rows.length > 0 && m.curOk && m.popClosedAfter,
      `[${name}] ${w}px：點開群組選單後，林鐵所屬的「${m.curText}」列可點擊命中（共 ${m.rows.length} 列，再點一次收得掉）`);
    // 台糖園區卡:每個寬度都要不出界、關閉鈕可實點(新功能必驗手機版)
    const gm = await mp.evaluate(() => {
      openSugarCard(SUGAR_PARKS[0]);
      const el = document.getElementById('sugarCard');
      const r = el.getBoundingClientRect();
      const btn = document.getElementById('sgClose');
      const br = btn.getBoundingClientRect();
      const at = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
      const fits = r.left >= 0 && r.right <= innerWidth + 0.5 && r.width > 100;
      closeSugarCard();
      return { fits, w: r.width, closeOk: !!at && (at === btn || btn.contains(at)) };
    });
    ok(gm.fits && gm.closeOk, `[${name}] ${w}px：台糖卡不出界（寬 ${gm.w.toFixed(0)}px）且關閉鈕可點`);
    await mCtx.close();
  }
  await deskCtx.close();
  await b.close();
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} 過 / ${fail} 敗\n`);
child?.kill();
process.exit(fail ? 1 : 0);
