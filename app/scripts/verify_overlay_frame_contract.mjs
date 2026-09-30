// 發行閘門：投影快取仍保留底圖與列車的同幀更新，四種破壞契約的負樣本必須被擋下。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { assertGlOverlaySameFrame } from './verify-release.mjs';
const src = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
assertGlOverlaySameFrame(src);
for (const [name, from, to] of [
  ['移除 render 接線', "M.on('render', syncDrawMaplibre);", ''],
  ['移除投影更新', 'if (projectedView !== projectionKey()) reprojectView();', ''],
  ['尺寸未納入快取', 'size.x, size.y', '1, 1'],
  ['地形未使快取失效', "M.on('style.load', () => { terrainProjectionEpoch++; });", '']
]) {
  assert(src.includes(from), `負樣本找不到落點：${name}`);
  assert.throws(() => assertGlOverlaySameFrame(src.replace(from, to)), name);
  console.log('PASS 負樣本', name);
}
console.log('PASS 同幀投影快取發行契約');
