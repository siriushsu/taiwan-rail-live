// 臺南地下化（extend_tainan_underground_1017.mjs）之後，2D 畫線跟著改走地下。
// 做法同 d38fc977（山線三義隧道）：不手工畫，取實體股道組出的南下路徑（5066 大橋→臺南、5072 臺南→保安），
// 把舊 shape 在兩個接點之間的節點換成這條路徑的節點。舊 shape 在這一段本來就是南下（東側）股道的
// OSM 節點（逐點離 108071684／152086608／747411514／1176543138／1176543139／108037248／161325956 的節點
// 0.01～0.46 m），所以換上的是同一側、同一種來源的股道。
// 接點：北端是 108071684 保留下來的北端節點，南端是東側銜接段接回地面線的節點（都是舊 shape 上原有的點）。
// 站距：接點以北不變；接點以南各站 d 加上這一段的長度差；區間內的臺南重新投影到新 shape。
// 跑法：BASE_REF=<改動前已驗證的 commit> node scripts/reshape_tainan_underground_2d_1017.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const ref = process.env.BASE_REF; assert(ref, '必須明確指定改動前的 BASE_REF');
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {encoding: 'utf8'}).trim();
const sha = execFileSync('git', ['-C', root, 'rev-parse', ref], {encoding: 'utf8'}).trim();
const raw = execFileSync('git', ['-C', root, 'show', `${sha}:data/tra.json`], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
assert.equal(JSON.stringify(JSON.parse(raw)), raw, 'tra.json 序列化方式跟 JSON.stringify 不同');
const tra = JSON.parse(raw), net = JSON.parse(fs.readFileSync('rail-3d/physical/network.json', 'utf8'));
const ext = net.extensions.at(-1); assert.equal(ext.name, '臺南鐵路地下化第一階段（2026-10-17 通車）');
const ln = tra.lines.find(l => l.name.startsWith('縱貫線南段')); assert(ln, '找不到縱貫線南段');

// 南下路徑的節點序列（推估停車點不是 OSM 節點，落在原本的兩個節點之間，不放進 shape）
const seq = [];
for (const pid of ['5066', '5072']) for (const [wi, start, count] of net.paths[pid].walk) {
  const w = net.ways[wi], sign = Math.sign(count);
  for (let j = 0; j < Math.abs(count); j++) {
    const i = start + j * sign, a = i + (sign < 0 ? 1 : 0), b = i + (sign > 0 ? 1 : 0);
    for (const k of seq.length ? [b] : [a, b]) if (seq.at(-1)?.id !== w.nodes[k]) seq.push({id: w.nodes[k], c: w.coordinates[k]});
  }
}
const pts = seq.filter(p => !String(p.id).startsWith('estimated:')).map(p => ({id: p.id, ll: [+p.c[1].toFixed(6), +p.c[0].toFixed(6)]}));
const north = net.ways.find(w => String(w.id) === '108071684').nodes[0], south = ext.inferredLinks['tainan-ug-link-e'].to;
const same = (p, q) => p[0] === q[0] && p[1] === q[1];
const si = id => { const k = pts.findIndex(p => p.id === id); assert(k >= 0, `南下路徑上沒有 ${id}`); return k; };
const [pa, pb] = [si(north), si(south)];
const a = ln.shape.findIndex(p => same(p, pts[pa].ll)), b = ln.shape.findIndex(p => same(p, pts[pb].ll));
assert(a > 0 && b > a, `舊 shape 找不到接點（${a}, ${b}）`);
const mid = pts.slice(pa + 1, pb).map(p => p.ll);
const shape = [...ln.shape.slice(0, a + 1), ...mid, ...ln.shape.slice(b)];
for (let i = 1; i < shape.length; i++) assert(!same(shape[i - 1], shape[i]), `shape 第 ${i} 點重複`);

// 距離與投影：同 verify_track_geometry.mjs
const R = 6371, toR = Math.PI / 180;
const distKm = (p, q) => Math.hypot((q[1] - p[1]) * Math.cos((p[0] + q[0]) / 2 * toR) * toR * R, (q[0] - p[0]) * toR * R);
const cumOf = s => s.reduce((c, p, i) => (c.push(i ? c[i - 1] + distKm(s[i - 1], p) : 0), c), []);
const project = (pt, s, cum) => { let best = {dist: Infinity};
  for (let i = 0; i < s.length - 1; i++) { const p = s[i], q = s[i + 1], k = Math.cos(p[0] * toR), vx = (q[1] - p[1]) * k, vy = q[0] - p[0], px = (pt[1] - p[1]) * k, py = pt[0] - p[0];
    const L2 = vx * vx + vy * vy, t = L2 ? Math.max(0, Math.min(1, (px * vx + py * vy) / L2)) : 0, r = [p[0] + vy * t, p[1] + (q[1] - p[1]) * t], dist = distKm(pt, r);
    if (dist < best.dist) best = {dist, d: cum[i] + distKm(p, r)}; }
  return best; };
const oldCum = cumOf(ln.shape), cum = cumOf(shape), bNew = a + 1 + mid.length;
const delta = cum[bNew] - oldCum[b];
const inside = [];
for (const st of ln.stations) {
  if (st.d <= oldCum[a]) continue;
  if (st.d >= oldCum[b]) { st.d += delta; continue; }
  const pr = project([st.lat, st.lon], shape, cum); assert(pr.dist < 0.1, `${st.name} 離新 shape ${pr.dist} km`);
  inside.push({name: st.name, old: st.d, d: pr.d, offM: +(pr.dist * 1000).toFixed(1)}); st.d = pr.d;
}
assert.deepEqual(inside.map(s => s.name), ['臺南'], '區間內的站不只臺南');
ln.shape = shape; ln.shapeLen = +cum.at(-1).toFixed(4);
fs.writeFileSync('data/tra.json', JSON.stringify(tra));

// 平交道：兩個接點之間的地面線停用，區間內的平交道不再有列車通過，拿掉；接點以南的 d 跟車站一樣加上長度差。
// 官方平交道 XML（build_crossings.mjs 的來源）還沒更新，所以在這裡處理，理由寫進 source_notes。
const crossRaw = execFileSync('git', ['-C', root, 'show', `${sha}:data/crossings.json`], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
assert.equal(JSON.stringify(JSON.parse(crossRaw)), crossRaw, 'crossings.json 序列化方式跟 JSON.stringify 不同');
const cross = JSON.parse(crossRaw), dropped = [];
cross.crossings = cross.crossings.filter(x => {
  if (x.lnId !== ln.id || x.d <= oldCum[a]) return true;
  if (x.d >= oldCum[b]) { x.d = +(x.d + delta).toFixed(4); return true; }
  dropped.push(x.name); return false;
});
assert.deepEqual(dropped, ['實踐路(舊名大光路)', '東豐路', '青年路', '大同路141巷', '榮譽路', '生產路', '龍寶路', '空軍後勤部'], `區間內的平交道跟預期不同：${dropped}`);
cross.source_notes += `2026-10-17 臺南鐵路地下化第一階段通車，大橋–保安間地面線停用，區間內 ${dropped.length} 處平交道（${dropped.join('、')}）移除；官方 XML 尚未更新。`;
fs.writeFileSync('data/crossings.json', JSON.stringify(cross));

// 路段懸賞的計價單位抄了一份站距；整檔重跑會換掉班表日期與尖峰時段（出貨檔是 09-01 班表產的），所以只換站距。
const bountyRaw = execFileSync('git', ['-C', root, 'show', `${sha}:data/bounty_units.json`], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
assert.equal(JSON.stringify(JSON.parse(bountyRaw)), bountyRaw, 'bounty_units.json 序列化方式跟 JSON.stringify 不同');
const bounty = JSON.parse(bountyRaw), oldStations = JSON.parse(raw).lines.find(l => l.id === ln.id).stations, bl = bounty.lines[`tra_sched|${ln.id}`];
assert.equal(bl.stations.length, ln.stations.length, '懸賞單位的站數跟 tra.json 不同');
let bountyMoved = 0;
bl.stations.forEach((s, i) => { assert.equal(s.name, ln.stations[i].name); assert.equal(s.d, oldStations[i].d, `懸賞單位 ${s.name} 站距跟改動前的 tra.json 不同`);
  if (s.d !== ln.stations[i].d) { s.d = ln.stations[i].d; bountyMoved++; } });
fs.writeFileSync('data/bounty_units.json', JSON.stringify(bounty));
console.log(JSON.stringify({base: sha, seam: [a, b], replaced: b - a - 1, inserted: mid.length, points: [oldCum.length, shape.length],
  crossingsDropped: dropped.length, bountyMoved, corridorKm: [+(oldCum[b] - oldCum[a]).toFixed(4), +(cum[bNew] - cum[a]).toFixed(4)], deltaKm: +delta.toFixed(6), shapeLen: ln.shapeLen, inside}));
