// 使用者規則的正面符合性掃描:不從症狀反推,直接對每條線每台車逐格檢查。
//   R2 倒數塞不進區段(行駛秒+停靠秒)就不該畫這台車
//   R3 不跳段:一格之內位置不得前進超過一站
//   R5 到終點站過了停靠秒就該收車
//   R6 一般站到站後,過了該站停靠秒就該發車(不得無限罰站)
//   R7 位置不得倒退(方向翻面除外)
//   R8 同線同向兩台不得黏在一起(<150m)
// 用法: node scripts/verify_rules_conformance.mjs [秒數] [html]
import { chromium } from 'playwright';
import fs from 'node:fs';
const SEC = Number(process.argv[2] || 240);
const html = fs.readFileSync(process.argv[3] || 'index.html', 'utf8');
const U = 'https://railisland.tw/';
const b = await chromium.launch(); const p = await b.newPage();
await p.route(u => { const x = new URL(u); return x.origin + x.pathname === new URL(U).origin + '/'; },
  r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
// 資料檔也用本機的:harness 預設只換 index.html,其餘走正式站 ⇒ 量到的是正式站的舊資料。
if (process.env.LOCAL_DATA === '1') await p.route(u => {
  const x = new URL(u); return x.origin === new URL(U).origin && x.pathname.startsWith('/data/');
}, r => { const f = '.' + new URL(r.request().url()).pathname;
  if (!fs.existsSync(f)) return r.continue();
  r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: fs.readFileSync(f) }); });
await p.goto(U + '?g=metro', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 120000 });
const R = await p.evaluate(async (SEC) => {
  const V = [];                       // 違規
  const cov = new Map();              // 每條線:掃到幾台、經過哪些站
  const prev = new Map();             // vehicleId -> 上一格
  const stopAt = new Map();           // vehicleId -> {station, since}
  const hav = (a, c) => { const R = 6371000, t = x => x * Math.PI / 180;
    const d1 = t(c.lat - a.lat), d2 = t(c.lon - a.lon), s = Math.sin(d1 / 2) ** 2 +
      Math.cos(t(a.lat)) * Math.cos(t(c.lat)) * Math.sin(d2 / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s))); };
  const add = (line, rule, vid, detail) => V.push({ line, rule, vid: String(vid).slice(-10), detail });
  for (let k = 0; k * 2 < SEC; k++) {
    const now = Date.now() / 1000;
    const roster = state.trtcOfficialRoster;
    if (!trtcOfficialRosterActive(roster, undefined, now)) { await new Promise(z => setTimeout(z, 2000)); continue; }
    for (const ln of state.lines) {
      if (!isTrtcBoardLine || !isTrtcBoardLine(ln)) continue;
      const vs = trtcOfficialRosterForLine(roster, ln.id);
      if (!vs.length) continue;
      const c = cov.get(ln.id) || { ids: new Set(), st: new Set(), ticks: 0 };
      c.ticks++;
      const live = [];
      for (const v of vs) {
        let pos = null; try { pos = trtcOfficialDisplayPosition(ln, v, now); } catch (e) { add(ln.id, 'ERR', v.vehicleId, String(e)); }
        if (!pos) {
          // R5:終點站的車過了停靠秒就該不見 —— 不見是對的,不記違規
          prev.delete(v.vehicleId); stopAt.delete(v.vehicleId); continue;
        }
        c.ids.add(v.vehicleId);
        const step = Number(v.dir) === 2 ? 1 : -1;
        const prog = trtcOfficialPositionProgress(ln, v, pos);
        if (!Number.isFinite(prog)) continue;
        c.st.add(Math.round(prog / step));
        live.push({ v, pos, prog, step });
        // R2:倒數塞不進這一段還畫了車
        if (!v.terminal && Number.isFinite(Number(v.arrEpoch)) &&
            !trtcCountdownFitsSegment(ln, Number(v.from), Number(v.to), Number(v.arrEpoch) - now))
          add(ln.id, 'R2', v.vehicleId, `段${v.from}->${v.to} 倒數${Math.round(v.arrEpoch - now)}s`);
        // R5:終點站的車過了停靠秒還在
        if (v.terminal && Number.isFinite(Number(v.arrEpoch)) &&
            now > Number(v.arrEpoch) + trtcOfficialDwellAt(ln, Number(v.from)) + 5)
          add(ln.id, 'R5', v.vehicleId, `終點站滯留 ${Math.round(now - v.arrEpoch)}s 站${v.from} src=${v.source}`);
        const snap = { prog, step, from: Number(v.from), to: Number(v.to), arr: Number(v.arrEpoch),
          src: String(v.source || ''), tl: (Array.isArray(v.timeline) ? v.timeline : [])
            .map(x => `${x.from}->${x.to}@${Math.round(x.arrEpoch - now)}`).join(','), now };
        const pr = prev.get(v.vehicleId);
        if (pr && pr.step === step) {
          const d = prog - pr.prog;
          if (d < -0.02) add(ln.id, 'R7', v.vehicleId, `倒退 ${d.toFixed(2)} 段` +
            ` |前:段${pr.from}->${pr.to} 到站${Math.round(pr.arr - pr.now)}s後 tl[${pr.tl}]` +
            ` |後:段${snap.from}->${snap.to} 到站${Math.round(snap.arr - now)}s後 tl[${snap.tl}] src=${snap.src}`);
          if (d > 1.05) add(ln.id, 'R3', v.vehicleId, `一格跳 ${d.toFixed(2)} 站` +
            ` |前:段${pr.from}->${pr.to} |後:段${snap.from}->${snap.to}`);
        }
        prev.set(v.vehicleId, snap);
        // R6:停在同一站超過該站停靠秒 + 20 秒寬限
        const phys = prog / step, st = Math.round(phys);
        if (Math.abs(phys - st) <= 0.02) {
          const s0 = stopAt.get(v.vehicleId);
          if (s0 && s0.station === st) {
            const held = now - s0.since, budget = trtcOfficialDwellAt(ln, st) + 20;
            if (held > budget && !s0.flagged) {
              s0.flagged = true;
              add(ln.id, 'R6', v.vehicleId, `站${st}(${(ln.stations[st] || {}).name || '?'}) 停 ${Math.round(held)}s > 停靠${trtcOfficialDwellAt(ln, st)}s+20`);
            }
          } else stopAt.set(v.vehicleId, { station: st, since: now, flagged: false });
        } else stopAt.delete(v.vehicleId);
      }
      // R8:同線同向黏在一起
      for (const dir of [1, 2]) {
        const g = live.filter(x => Number(x.v.dir) === dir).sort((a, z) => a.prog - z.prog);
        for (let i = 1; i < g.length; i++) {
          const m = hav(g[i - 1].pos, g[i].pos);
          if (m < 150) add(ln.id, 'R8', g[i].v.vehicleId, `與 ${String(g[i - 1].v.vehicleId).slice(-6)} 相距 ${Math.round(m)}m`);
        }
      }
      cov.set(ln.id, c);
    }
    await new Promise(z => setTimeout(z, 2000));
  }
  return { V, cov: [...cov].map(([id, c]) => ({ id, cars: c.ids.size, stations: c.st.size, ticks: c.ticks })) };
}, SEC);
await b.close();
const byLine = {};
for (const v of R.V) { (byLine[v.line] ||= {})[v.rule] = ((byLine[v.line] || {})[v.rule] || 0) + 1; }
console.log(`\n===== 規則符合性掃描｜${SEC} 秒 =====`);
console.log('線別        掃到車  經過站  違規');
for (const c of R.cov) {
  const bad = byLine[c.id] ? Object.entries(byLine[c.id]).map(([r, n]) => `${r}×${n}`).join(' ') : '—';
  console.log(`${c.id.padEnd(12)}${String(c.cars).padStart(4)}${String(c.stations).padStart(8)}   ${bad}`);
}
const uniq = new Map();
for (const v of R.V) { const k = `${v.line}|${v.rule}|${v.vid}`; if (!uniq.has(k)) uniq.set(k, v); }
console.log(`\n違規明細(去重後 ${uniq.size} 筆,列前 20):`);
for (const v of [...uniq.values()].slice(0, 20)) console.log(`  [${v.rule}] ${v.line} ${v.vid} ${v.detail}`);
console.log(`\n總計 違規 ${R.V.length} 次 / 去重 ${uniq.size} 件`);
