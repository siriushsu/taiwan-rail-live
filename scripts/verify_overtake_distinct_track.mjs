// 同向預排待避：待避車與超越車不能在同一股道上（立體地圖）。
//
// 待避是瀏覽器依當日車群排的（index.html planSameDirectionOvertakes），派車表的計畫裡待避車在那一站是「通過」，
// 綁到的股道就是通過用的正線，超越車也走同一股 ⇒ 立體畫面上超越車直接穿過停著的待避車。
// 2026-09-29 撥到 10/3 實測：預排 14 筆，12 筆兩車在該站是同一個股道節點（114 在五堵等 228、6669 在北埔等 273
// 都在 12183049764……）；9/29～10/10 共 115 筆有 86 筆。既有閘門量不到：verify_overtake_station_planning 只驗
// 待避期間停在實體股道固定一點，verify_physical_no_overlap 的 B 類用的是釘死的 9/13 班表。
//
// 當天每一筆預排待避逐筆驗（不抽樣）：
//   A. 待避車在待避站的股道節點 ≠ 超越車在該站的節點。
//   B. 超越車在該站的進出路徑不經過待避車停的節點。
//   C. 待避期間逐秒取樣兩車畫面位置（trainPosAt，畫面同一個入口），車身（整列中心前後各半列，編組長取
//      formations.js 同一份對照）佔用的股道資源不相交——這條才是「超越車穿過停著的待避車」本身，A、B 只是節點層的必要條件。
//   D. 待避期間停在實體股道同一點。
//   E. 待避期間逐秒，待避車車身與同站其他列車（超越車以外，前後 120 秒內在該站停靠或通過的）不共用股道：
//      換到的那一股不能正停著別班、也不能有另一班從旁穿過（9/13 考卷實測：埔心 173 換到 1161 正停著的待避線）。
// 修法兩層：rail-3d/physical/overtake-sidings.js 把待避車換到另一股；index.html 選待避站時查 data/tra_overtake_tracks.json，
// 那個方向沒有空股（超越車不走、待避期間也沒別班佔著）的站不排（2026-09-29 裁示「改排到有空股的站」）。
// 判準的真值都從畫面入口現量（record 的路徑解成節點、trainPosAt 的車身）；改道模組自己回報的 sidings 只拿來在明細標「改道」，不參與判定。
//
// 跑法：node scripts/verify_overtake_distinct_track.mjs
//   OVERTAKE_DATE=YYYY-MM-DD 只驗那一天；不給就從台北今天起逐日找第一個有預排待避的日子（14 天內都沒有才 FAIL）。
//   瀏覽器一律無視窗（headless），Chromium 與 WebKit 各跑一次。
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let PORT = Number(process.env.PORT || 0);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = join(ROOT, normalize(rel === '/' ? '/index.html' : rel));
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }); res.end(readFileSync(file));
});
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
PORT = server.address().port;
console.log(`驗收樹 ${ROOT}（port ${PORT}）`);

const DAY = process.env.OVERTAKE_DATE || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const SCAN = process.env.OVERTAKE_DATE ? 1 : 14;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const failures = [];
const ok = (engine, name, pass, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${engine} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures.push(`${engine} ${name}`);
};

for (const [engine, launcher] of [['Chromium', chromium], ['WebKit', webkit]]) {
  const browser = await launcher.launch({ headless: true });
  let report = null, usedDay = null;
  for (let i = 0; i < SCAN; i++) {
    usedDay = addDays(DAY, i);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*tra-live*', r => r.abort());
    await page.addInitScript(day => {
      localStorage.setItem('trainmap-howto-seen', '1');
      const NativeDate = Date, fixed = new NativeDate(`${day}T07:43:00+08:00`).getTime();
      window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
    }, usedDay);
    await page.goto(`http://127.0.0.1:${PORT}/?g=tra&t=07:43`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => typeof state !== 'undefined' && state.ready && state.trains?.length > 300, null, { timeout: 120_000 });
    await page.waitForFunction(() => !!window.railIslandPhysical, null, { timeout: 120_000 });
    report = await page.evaluate(async () => {
      const { formationFor } = await import('/rail-3d/integration/formations.js');
      const P = window.railIslandPhysical, G = P.geometry;
      const half = tr => {
        const sp = specialOf(tr), f = formationFor({ systemId: tr.sys, carName: tr.carName, typeName: tr.typeName,
          stockId: sp?.stock?.id, branchId: sp?.branch?.id, namedId: sp?.named?.id }, 'actual');
        return (f ? f.lengths.reduce((a, b) => a + b, 0) : 200) / 2;
      };
      // 第 j 站（原班表站序）在綁定路徑上的節點，以及進出兩段路徑
      const at = (tr, j) => {
        const r = P.record(tr); if (!r) return null;
        const b = r.stopIndexes ? r.stopIndexes.indexOf(j) : j; if (b < 0) return { skipped: true };
        const ids = r.plan.pathIds, inId = b > 0 ? ids[b - 1] : null, outId = b < ids.length ? ids[b] : null;
        const units = [inId, outId].filter(x => x != null).map(x => G.unfold(x));
        return { node: String(inId != null ? G.unfold(inId).nodeIds.at(-1) : G.unfold(outId).nodeIds[0]), basis: r.bindingBasis,
          nodes: new Set(units.flatMap(u => u.nodeIds.map(String))), moved: !!r.sidings?.some(m => m.stopIndex === b) };
      };
      const body = (p, h) => {
        const out = new Set(), d = p.route.path.d;
        for (let i = 0; i < p.route.edges.length && i < d.length - 1; i++)
          if (d[i + 1] > p.chainageM - h && d[i] < p.chainageM + h) out.add(p.route.edges[i].resource);
        return out;
      };
      const rows = [];
      for (const t of state.trains) t.stops.forEach((s, j) => {
        if (!s._plannedDwell) return;
        const tag = `${t.train}@${s.name}等${s._overtakeBy}`;
        const F = state.trains.find(f => String(f.train) === String(s._overtakeBy) && f.stops.some(x => x.name === s.name));
        if (!F) { rows.push({ tag, missing: '找不到超越車' }); return; }
        const fj = F.stops.findIndex(x => x.name === s.name), L = at(t, j), R = at(F, fj);
        if (!L || !R || L.skipped || R.skipped) { rows.push({ tag, missing: `綁不到實體股道（待避車 ${L ? L.skipped ? '略過該站' : L.basis : '無'}／超越車 ${R ? R.skipped ? '略過該站' : R.basis : '無'}）` }); return; }
        const hL = half(t), hF = half(F);
        const others = state.trains.filter(o => o !== t && o !== F && o.stops?.some(x => x.name === s.name && x.depSec >= s.arrSec - 120 && x.arrSec <= s.depSec + 120));
        const otherSec = new Map();
        let overlapSec = 0, firstOverlap = null, fixed = true, physical = true, anchor = null;
        for (let x = Math.ceil(s.arrSec + 1); x <= Math.floor(s.depSec - 1); x++) {
          const pl = trainPosAt(t, x);
          if (!pl?.physical) { physical = false; continue; }
          if (!anchor) anchor = pl; else if (Math.hypot(pl.lat - anchor.lat, pl.lon - anchor.lon) > 1e-9) fixed = false;
          const bl = body(pl, hL);
          for (const o of others) {
            const po = trainPosAt(o, x); if (!po?.physical) continue;
            for (const res of body(po, half(o))) if (bl.has(res)) { otherSec.set(String(o.train), (otherSec.get(String(o.train)) || 0) + 1); break; }
          }
          const pf = trainPosAt(F, x); if (!pf?.physical) continue;
          for (const res of body(pf, hF)) if (bl.has(res)) { overlapSec++; firstOverlap ??= x; break; }
        }
        rows.push({ tag, dir: Math.sign(s.dB - s.dA), dwell: Math.round(s.depSec - s.arrSec), nodeL: L.node, nodeF: R.node, basisL: L.basis, basisF: R.basis,
          sameNode: L.node === R.node, throughL: R.nodes.has(L.node), overlapSec, firstOverlap, fixed, physical, halfL: hL, halfF: hF,
          others: others.length, otherHits: [...otherSec].map(([k, v]) => `${k}×${v}s`),
          moved: L.moved });
      });
      return { build: BUILD, day: state.data?._schedDay, rows };
    });
    report.errors = errors;
    await context.close();
    if (report.rows.length || i === SCAN - 1) break;
    console.log(`  ${engine} ${usedDay} 沒有預排待避，往後一天`);
  }
  console.log(`${engine} 驗收日 ${usedDay}（排程日 ${report.day}，BUILD ${report.build}）`);
  const rows = report.rows, bound = rows.filter(r => !r.missing);
  const list = (xs, f) => xs.length ? xs.slice(0, 12).map(f).join('、') + (xs.length > 12 ? `…（共 ${xs.length} 筆）` : '') : '';
  ok(engine, `當天有預排待避（${rows.length} 筆）`, rows.length > 0);
  ok(engine, `每筆的待避車與超越車都綁到實體股道（${bound.length}/${rows.length}）`, bound.length === rows.length && rows.length > 0,
    list(rows.filter(r => r.missing), r => `${r.tag}:${r.missing}`));
  const same = bound.filter(r => r.sameNode), through = bound.filter(r => r.throughL), overlap = bound.filter(r => r.overlapSec > 0), loose = bound.filter(r => !r.fixed || !r.physical);
  ok(engine, `A 待避車與超越車不在同一個股道節點（${bound.length - same.length}/${bound.length}）`, bound.length > 0 && !same.length,
    list(same, r => `${r.tag}:${r.nodeL}`));
  ok(engine, `B 超越車的進出路徑不經過待避車停的節點（${bound.length - through.length}/${bound.length}）`, bound.length > 0 && !through.length,
    list(through, r => `${r.tag}:${r.nodeL}`));
  ok(engine, `C 待避期間兩車車身不共用股道（${bound.length - overlap.length}/${bound.length}）`, bound.length > 0 && !overlap.length,
    list(overlap, r => `${r.tag}:${r.overlapSec}s`));
  ok(engine, `D 待避期間停在實體股道同一點（${bound.length - loose.length}/${bound.length}）`, bound.length > 0 && !loose.length,
    list(loose, r => `${r.tag}:固定=${r.fixed}／實體=${r.physical}`));
  const crowded = bound.filter(r => r.otherHits.length), checkedOthers = bound.reduce((n, r) => n + r.others, 0);
  ok(engine, `E 待避期間待避車不與同站其他列車共用股道（${bound.length - crowded.length}/${bound.length}，同站前後 120 秒內共 ${checkedOthers} 班次）`,
    bound.length > 0 && !crowded.length, list(crowded, r => `${r.tag}:${r.otherHits.join('+')}`));
  for (const r of bound) console.log(`   ${r.tag} 方向${r.dir} 停${r.dwell}s 待避節點 ${r.nodeL}${r.moved ? '（改道）' : ''}／超越車 ${r.nodeF} 車身重疊 ${r.overlapSec}s${r.otherHits.length ? '／同站他車重疊 ' + r.otherHits.join('+') : ''} ${r.basisL}/${r.basisF}`);
  ok(engine, '頁面無 runtime 錯誤', report.errors.length === 0, report.errors.slice(0, 3).join(' | '));
  await browser.close();
}

server.close();
if (failures.length) { console.error(`\n${failures.length} 項失敗：${failures.join('、')}`); process.exit(1); }
console.log('\n預排待避：待避車與超越車在不同股道、車身不相交、待避期間停在實體股道同一點（Chromium＋WebKit）');
