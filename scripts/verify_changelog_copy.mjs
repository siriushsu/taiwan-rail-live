#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');

function section(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`找不到更新紀錄區段：${startMarker}`);
  return html.slice(start, end);
}

function entries(source) {
  return [...source.matchAll(/<li(?![^>]*class="grp")[^>]*>[\s\S]*?<span>([\s\S]*?)<\/span>\s*<\/li>/g)]
    .map(match => match[1].replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, '字').trim());
}

const recent = entries(section('<ul class="foot-list foot-recent">', '</ul>'));
const history = entries(section('<details class="foot-more">', '</details>'));
const failures = [];

if (recent.length > 8) failures.push(`最近更新有 ${recent.length} 條，超過 8 條`);
for (const [label, list, limit] of [['最近更新', recent, 90], ['完整歷史', history, 120]]) {
  for (const text of list) if (text.length > limit) failures.push(`${label} ${text.length}/${limit} 字：${text.slice(0, 48)}…`);
}

if (failures.length) {
  console.error(`更新紀錄文案驗收失敗（${failures.length} 項）`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`更新紀錄文案驗收通過：最近 ${recent.length} 條（最長 ${Math.max(...recent.map(text => text.length))} 字）、完整歷史 ${history.length} 條（最長 ${Math.max(...history.map(text => text.length))} 字）`);
