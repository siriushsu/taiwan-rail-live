#!/usr/bin/env node
// 下載／解析 OpenStreetMap，抽出 TDX 阿里山林鐵 shape 缺口的實際軌道路徑。
// 可離線重跑：node scripts/fetch_afr_osm_fills.mjs /tmp/afr-main.osm /tmp/afr-zhushan.osm

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data/afr_osm_gap_fills.json');
const R = 6371, toR = Math.PI / 180;
const distKm = (a, b) => Math.hypot(
  (b[1] - a[1]) * Math.cos((a[0] + b[0]) / 2 * toR) * toR * R,
  (b[0] - a[0]) * toR * R,
);

const SOURCES = [
  { key: 'main', bbox: '120.770,23.506,120.790,23.517' },
  { key: 'zhushan', bbox: '120.800,23.505,120.840,23.535' },
];
const TARGETS = [
  { lineId: 'AFR_MAIN', source: 'main', from: [23.510827, 120.775144], to: [23.512364, 120.786352], rangeKm: [1.2, 1.6] },
  { lineId: 'AFR_ZHUSHAN', source: 'zhushan', from: [23.524229, 120.816389], to: [23.525717, 120.816262], rangeKm: [0.15, 0.25] },
  { lineId: 'AFR_ZHUSHAN', source: 'zhushan', from: [23.526825, 120.816138], to: [23.522835, 120.81893], rangeKm: [0.6, 0.8] },
  { lineId: 'AFR_ZHUSHAN', source: 'zhushan', from: [23.522536, 120.819298], to: [23.521876, 120.820027], rangeKm: [0.55, 0.8] },
  { lineId: 'AFR_ZHUSHAN', source: 'zhushan', from: [23.52112, 120.820263], to: [23.516879, 120.819748], rangeKm: [0.45, 0.65] },
];

async function sourceText(src, localFile) {
  if (localFile) return fs.readFileSync(localFile, 'utf8');
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${src.bbox}`;
  const r = await fetch(url, { headers: { 'user-agent': 'railisland-track-builder/1.0 (https://railisland.tw)' } });
  if (!r.ok) throw new Error(`OSM ${src.key}: HTTP ${r.status}`);
  return r.text();
}

function parseOsm(xml) {
  const nodes = new Map(), ways = [];
  for (const m of xml.matchAll(/<node\b([^>]*)>/g)) {
    const id = m[1].match(/\bid="(\d+)"/)?.[1];
    const lat = m[1].match(/\blat="([^"]+)"/)?.[1], lon = m[1].match(/\blon="([^"]+)"/)?.[1];
    if (id && lat && lon) nodes.set(id, [+lat, +lon]);
  }
  for (const m of xml.matchAll(/<way\b[^>]*\bid="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const tags = Object.fromEntries([...m[2].matchAll(/<tag k="([^"]+)" v="([^"]*)"\/>/g)].map(x => [x[1], x[2]]));
    if (!['narrow_gauge', 'rail'].includes(tags.railway) || tags.disused === 'yes' || tags.abandoned === 'yes') continue;
    const refs = [...m[2].matchAll(/<nd ref="(\d+)"\/>/g)].map(x => x[1]).filter(x => nodes.has(x));
    if (refs.length > 1) ways.push({ id: m[1], refs });
  }
  const adj = new Map();
  const add = (a, b, way) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push({ to: b, km: distKm(nodes.get(a), nodes.get(b)), way }); };
  for (const way of ways) for (let i = 1; i < way.refs.length; i++) {
    add(way.refs[i - 1], way.refs[i], way.id); add(way.refs[i], way.refs[i - 1], way.id);
  }
  return { nodes, ways, adj };
}

function shortestPath(graph, from, to) {
  const nearest = pt => [...graph.adj.keys()].map(id => ({ id, km: distKm(pt, graph.nodes.get(id)) })).sort((a, b) => a.km - b.km)[0];
  const a = nearest(from), b = nearest(to);
  if (a.km > 0.03 || b.km > 0.03) throw new Error(`OSM 端點吸附過遠：${(a.km * 1000).toFixed(1)}m／${(b.km * 1000).toFixed(1)}m`);
  const best = new Map([[a.id, 0]]), prev = new Map(), queue = [[0, a.id]];
  while (queue.length) {
    queue.sort((x, y) => x[0] - y[0]);
    const [km, id] = queue.shift();
    if (km !== best.get(id)) continue;
    if (id === b.id) break;
    for (const edge of graph.adj.get(id) || []) {
      const next = km + edge.km;
      if (next >= (best.get(edge.to) ?? Infinity)) continue;
      best.set(edge.to, next); prev.set(edge.to, { id, way: edge.way }); queue.push([next, edge.to]);
    }
  }
  if (!prev.has(b.id)) throw new Error('OSM 軌道圖找不到缺口兩端之間的連通路徑');
  const ids = [b.id], ways = [];
  while (ids[ids.length - 1] !== a.id) {
    const p = prev.get(ids[ids.length - 1]); ways.push(p.way); ids.push(p.id);
  }
  ids.reverse(); ways.reverse();
  return { snapM: [+((a.km) * 1000).toFixed(1), +((b.km) * 1000).toFixed(1)],
    km: best.get(b.id), wayIds: [...new Set(ways)], path: ids.map(id => graph.nodes.get(id)) };
}

const localFiles = process.argv.slice(2), graphs = new Map(), sourceMeta = [];
for (let i = 0; i < SOURCES.length; i++) {
  const src = SOURCES[i], xml = await sourceText(src, localFiles[i]);
  graphs.set(src.key, parseOsm(xml));
  sourceMeta.push({ key: src.key, bbox: src.bbox, api: `https://api.openstreetmap.org/api/0.6/map?bbox=${src.bbox}` });
}

const fills = TARGETS.map(target => {
  const r = shortestPath(graphs.get(target.source), target.from, target.to);
  if (r.km < target.rangeKm[0] || r.km > target.rangeKm[1])
    throw new Error(`${target.lineId}: OSM 路徑 ${r.km.toFixed(3)}km 超出 gate ${target.rangeKm.join('–')}km`);
  console.log(`${target.lineId}: 直線 ${distKm(target.from, target.to).toFixed(3)}km → OSM ${r.km.toFixed(3)}km，ways ${r.wayIds.join(',')}`);
  return { lineId: target.lineId, from: target.from, to: target.to, wayIds: r.wayIds, snapM: r.snapM,
    path: r.path.map(p => p.map(v => +v.toFixed(7))) };
});

writeFileSyncCompat(OUT, JSON.stringify({
  source: '© OpenStreetMap contributors（ODbL），OSM API 0.6', fetched: new Date().toISOString().slice(0, 10),
  sources: sourceMeta, fills,
}));
console.log(`wrote ${path.relative(ROOT, OUT)} (${fills.length} gaps)`);

function writeFileSyncCompat(file, data) { fs.writeFileSync(file, data); }
