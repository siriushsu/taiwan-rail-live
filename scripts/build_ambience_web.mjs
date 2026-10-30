#!/usr/bin/env node
// 網站版車聲的打亂檔：node scripts/build_ambience_web.mjs <輸出路徑>
//
// 車聲 loop 是 Envato AudioJungle 授權素材（Music Standard License）：網站可以當成品用，
// 但「不可讓使用者把音檔抽出來單獨使用」，原檔也不能進這個公開 repo。所以網站上放的是打亂過的
// .bin——直接開網址拿到的不是能播的 mp3——由 index.html 的 ambWebUnscramble 還原後交給 Web Audio。
// 這支由 ship_web 在出貨的乾淨 worktree 裡呼叫；本機測試時也可以手動跑，輸出到 audio/（已 gitignore）。
//
// 原檔來源：RAIL_AMBIENCE_FILE，沒設就用主樹（git common dir 的上一層）的
// `suno musics/_licensed/ambience/train-ride-loop.mp3`（同 app/scripts/prepare-web.mjs）。缺檔就非零退出。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
if (args.length !== 1 || args[0].startsWith('-')) {
  console.error('用法：node scripts/build_ambience_web.mjs <輸出路徑>');
  process.exit(2);
}
const out = path.resolve(args[0]);
const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
const src = process.env.RAIL_AMBIENCE_FILE
  || path.join(path.dirname(commonDir), 'suno musics', '_licensed', 'ambience', 'train-ride-loop.mp3');
if (!fs.existsSync(src)) {
  console.error(`❌ 車聲原檔不存在：${src}（放到 suno musics/_licensed/ambience/ 或設 RAIL_AMBIENCE_FILE）`);
  process.exit(1);
}

// 跟 index.html 的 ambWebUnscramble 同一段（XOR 兩次＝原檔），兩邊要一起改。
const b = new Uint8Array(fs.readFileSync(src));
let s = 0x5eed7a11;
for (let i = 0; i < b.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; b[i] ^= s & 255; }

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, b);
console.log(`車聲打亂檔 ✓ ${out}（${b.length} bytes，md5 ${crypto.createHash('md5').update(b).digest('hex')}）`);
