#!/usr/bin/env node
// 北捷看板帳本本機 fixture server。只讀已落盤語料，不連線、不需要真實帳密。
//
// 預設回放 s02；同一個 scheduled 內的第二次 TrackInfo 會前進到下一份 tk 快照。
// 測試可用 /__reset 歸零、/__state 讀 access log、/__config?slot=s02&advance=1 調整。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.TRTC_FIXTURE_PORT || process.argv[2] || 43187);
const CORPUS = process.env.TRTC_FIXTURE_DIR || '/Users/xuxiang/Code/軌島-語料/trtc-peak-0803';
const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8'));
const snaps = { tk: [], hw: [], br: [] };
for (const rec of manifest.快照) {
  const body = JSON.parse(fs.readFileSync(path.join(CORPUS, rec.file), 'utf8'));
  snaps[rec.kind].push({ slot: rec.slot, at: rec.fetchedAtEpoch, rows: body.rows });
}
for (const list of Object.values(snaps)) list.sort((a, b) => a.at - b.at);

let firstSlot = process.env.TRTC_FIXTURE_SLOT || 's02';
let advanceTk = process.env.TRTC_FIXTURE_ADVANCE_TK !== '0';
let calls = [];
let kindCounts = { tk: 0, hw: 0, br: 0 };

const json = (res, value, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
};
const slotIndex = (kind) => {
  const list = snaps[kind];
  const exact = list.findIndex(s => s.slot === firstSlot);
  if (exact >= 0) return exact;
  const n = Number(String(firstSlot).replace(/^s/, ''));
  const next = list.findIndex(s => Number(s.slot.slice(1)) >= n);
  return next >= 0 ? next : 0;
};
const rowsFor = (kind) => {
  const list = snaps[kind];
  const start = slotIndex(kind);
  const offset = kind === 'tk' && advanceTk ? kindCounts.tk : 0;
  return list[Math.min(list.length - 1, start + offset)].rows;
};
const soap = rows => `${JSON.stringify(rows)}<?xml version="1.0" encoding="utf-8"?><soap:Envelope></soap:Envelope>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/health') return json(res, { ok: true, corpus: path.basename(CORPUS) });
  if (req.method === 'GET' && url.pathname === '/__state') return json(res, { firstSlot, advanceTk, kindCounts, calls });
  if (req.method === 'POST' && url.pathname === '/__reset') {
    calls = []; kindCounts = { tk: 0, hw: 0, br: 0 };
    return json(res, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/__config') {
    if (url.searchParams.has('slot')) firstSlot = url.searchParams.get('slot');
    if (url.searchParams.has('advance')) advanceTk = url.searchParams.get('advance') !== '0';
    calls = []; kindCounts = { tk: 0, hw: 0, br: 0 };
    return json(res, { ok: true, firstSlot, advanceTk });
  }
  if (req.method !== 'POST') return json(res, { error: 'not found' }, 404);
  let body = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let kind = null;
    if (/getTrackInfo/.test(body) || /TrackInfo/.test(url.pathname)) kind = 'tk';
    else if (/getCarWeightBRInfo/.test(body) || /CarWeightBR/.test(url.pathname)) kind = 'br';
    else if (/getCarWeightByInfoEx/.test(body) || /CarWeight/.test(url.pathname)) kind = 'hw';
    calls.push({ method: req.method, path: url.pathname, kind, host: req.headers.host || '' });
    if (!kind) return json(res, { error: 'unknown fixture method' }, 400);
    const rows = rowsFor(kind);
    kindCounts[kind]++;
    res.writeHead(200, { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store' });
    res.end(soap(rows));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(JSON.stringify({ ready: true, port: PORT, corpus: CORPUS, slot: firstSlot }));
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
