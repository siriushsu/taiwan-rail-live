#!/usr/bin/env node
// 網頁登入的 CSP 守門人。
//
// 為什麼需要這支:2026-09-10 的 issue #54「登入失敗：Firebase: Error (auth/internal-error)」。
// 根因不在登入程式碼,而在 _headers 的 CSP 少了兩樣網頁版 signInWithPopup 必需的東西
// (見 _headers 註解 2b)。這個組合的惡劣之處是【三重靜默】:
//   · CSP 少一條不會有任何建置錯誤,git 不衝突、wrangler 不報錯;
//   · Firebase SDK 把所有被擋的資源一律折成 auth/internal-error,錯誤字面完全不提 CSP;
//   · 本機 http server 不送 CSP ⇒ 本機怎麼測都是綠的,只有真的部署上去才現形。
// 所以這一條只能靠靜態閘門守,不能靠「下次記得測登入」。
//
// 判準刻意【從檔案推導】而不是寫死常數:authDomain 取自 firebase-config.js,換 Firebase 專案
// 時這支會跟著改而不是假綠(判準盲點 #3)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const R = [];
const ok = (id, pass, detail) => { R.push(pass); console.log(`${pass ? '✅' : '❌'} ${id} — ${detail}`); };

const headers = read('_headers');
const csp = (headers.match(/Content-Security-Policy:([^\n]*)/) || [])[1] || '';
ok('G0 取得 CSP 那一行', csp.length > 100, `${csp.length} bytes`);

const dir = name => {
  const seg = csp.split(';').map(x => x.trim()).find(x => x === name || x.startsWith(name + ' '));
  return seg === undefined ? null : seg.slice(name.length).trim();
};

// 網站走的是 popup 流程才需要 gapi 與 authDomain iframe;哪天改成 redirect 或原生 credential,
// 需求就變了 ⇒ 判準本身要跟著失效,不要繼續守一條已經不成立的規則(判準盲點 #10)。
const html = read('index.html');
const usesPopup = /signInWithPopup\(/.test(html);
ok('G1 網頁登入仍走 signInWithPopup', usesPopup,
  usesPopup ? 'popup 流程 ⇒ 下面 G2/G3 成立' : '流程換了,請重新確認這支要守什麼');

// G2:gapi 載入器。被擋 ⇒ Firebase 建不出接收 OAuth 結果的通道 ⇒ auth/internal-error。
const scriptSrc = dir('script-src') || '';
ok('G2 script-src 放行 apis.google.com', /(^|\s)https:\/\/apis\.google\.com(\s|$)/.test(scriptSrc),
  scriptSrc || '(沒有 script-src)');

// G3:那個通道本身是 authDomain 上的跨來源 iframe。
// 🔴 frame-src 【整個不存在】時會回退到 default-src 'self',也就是連自家 authDomain 都擋——
//    這正是 #54 的一半,所以「有沒有這個指令」要單獨判,不能只判內容。
const authDomain = (read('firebase-config.js').match(/authDomain:\s*"([^"]+)"/) || [])[1] || '';
ok('G3a firebase-config.js 讀得到 authDomain', !!authDomain, authDomain || '(讀不到)');
const frameSrc = dir('frame-src');
ok('G3b CSP 有明寫 frame-src', frameSrc !== null,
  frameSrc === null ? '缺 frame-src ⇒ 回退 default-src ⇒ authDomain iframe 被擋' : frameSrc);
ok('G3c frame-src 放行 authDomain', !!authDomain && !!frameSrc
  && new RegExp(`(^|\\s)https://${authDomain.replace(/\./g, '\\.')}(\\s|$)`).test(frameSrc),
  `需要 https://${authDomain}`);

// G4:換 token 與同步的端點。*.googleapis.com 同時涵蓋 identitytoolkit／securetoken／firestore。
const connectSrc = dir('connect-src') || '';
ok('G4 connect-src 涵蓋 googleapis.com', /https:\/\/(\*\.)?googleapis\.com(\s|$)/.test(connectSrc),
  connectSrc ? '有' : '(沒有 connect-src)');

// G5:反向。gapi 的 gen_204 遙測【應該】保持被擋——實測擋掉不影響登入,放行只是多送一個
// 第三方追蹤點。這條同時是上面那組的正向對照:它與 G2 動的是同一個主機、不同指令,
// 若有人為了讓 console 乾淨而整批放行,這裡會紅。
ok('G5 connect-src 沒有順手放行 apis.google.com', !/apis\.google\.com/.test(connectSrc),
  'gen_204 遙測維持封鎖');

const bad = R.filter(x => !x).length;
console.log(bad ? `\n❌ ${bad} 項未過` : `\n✅ ${R.length} 項全過`);
process.exit(bad ? 1 : 0);
