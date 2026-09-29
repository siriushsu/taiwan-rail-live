#!/usr/bin/env node
// 官方名冊的單線退路契約：名冊整體仍新鮮，但某線已沒有任何可繪車輛時，必須回 null
// 交還當日班表。2026-09-20 環狀線上游久斷時曾回 []，四個消費端因此整線短路消失。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

for (const required of [
  "t('{line}：班表推估'",
  "t('；另有 {n} 條線改依當日班表推估，列車位置與到站時間可能有誤差'",
  "t('：即時訊號暫時中斷，目前依當日班表推估；列車位置與到站時間可能有誤差'",
  'trtcOfficialItemsForLine(ln, fallbackNow) !== null',
]) {
  if (!html.includes(required)) throw new Error(`缺少班表退路標示契約：${required}`);
}

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`找不到 ${name}`);
  const open = html.indexOf('{', start);
  let depth = 0, mode = 'code', escaped = false;
  for (let i = open; i < html.length; i++) {
    const c = html[i], next = html[i + 1];
    if (mode === 'line') { if (c === '\n') mode = 'code'; continue; }
    if (mode === 'block') { if (c === '*' && next === '/') { mode = 'code'; i++; } continue; }
    if (mode !== 'code') {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if ((mode === 'single' && c === "'") || (mode === 'double' && c === '"') ||
          (mode === 'template' && c === '`')) mode = 'code';
      continue;
    }
    if (c === '/' && next === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && next === '*') { mode = 'block'; i++; continue; }
    if (c === "'") { mode = 'single'; continue; }
    if (c === '"') { mode = 'double'; continue; }
    if (c === '`') { mode = 'template'; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`${name} 未閉合`);
}

const product = extractFunction('trtcOfficialItemsForLine');
function run(source, rendered) {
  const sandbox = {
    state: { trtcOfficialRoster: { feedMode: 'official', vehicles: [] } },
    OFFICIAL_ROSTER_ENABLED: true,
    isTrtcBoardLine: () => true,
    trtcOfficialRosterLive: () => true,
    trtcOfficialRenderItems: () => rendered,
    Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${source}; this.call = trtcOfficialItemsForLine;`, sandbox);
  return sandbox.call({ id: 'Y' }, 1000);
}

const empty = run(product, []);
const one = [{ vehicleId: 'Y-live' }], live = run(product, one);
const mutant = product.replace('return items && items.length ? items : null;', 'return items;');
if (mutant === product) throw new Error('突變錨點不存在，判準已失效');
const mutantEmpty = run(mutant, []);

const pass = empty === null && live === one && Array.isArray(mutantEmpty);
console.log(`${pass ? '✅' : '❌'} 官方名冊單線 0 台回 null 退回班表；有車仍使用官方；空陣列突變會被抓到`);
console.log('✅ 班表退路會明示推估與時間誤差，官方車輛恢復後自動撤除標示');
if (!pass) process.exit(1);
