#!/usr/bin/env node
// 部署設定的「整包覆蓋」防線——npm run check-deploy-config（已掛進 ship_web 的 preflight）
//
// 為什麼要有這支：`wrangler.jsonc` 的 `triggers.crons` 與 `.assetsignore` 都是**宣告式整包覆蓋**
// 的設定——部署時 Cloudflare 拿檔案裡那份**取代**現況，不是合併。所以「少一條」這件事：
//   - git 三方合併不會當成衝突（兩邊都合法，只是內容不同）
//   - wrangler 照樣部署成功，不報錯、不標紅
//   - `worker.js` 裡對應的程式碼一行都沒少，只是那個分支**永遠不會被呼叫**
//   - 全部 API 照常 200，要到有人發現「東西怎麼不動了」才知道
// 而少掉的東西可能是**不可重現**的（北捷帳本每分鐘的官方取樣，當下沒取到就永遠沒有了）。
//
// 已經真的發生過的同族事故：2026-07-26 `.cache/` 只進了 `.gitignore` 沒進 `.assetsignore`，
// 60 天的 TDX 原始快取在預覽站公開可下載（實測 200／849KB）。
// 正在等著發生的：`origin/feat/alert-log` 那條分支的 crons 是 `["15 1 * * *","15 4 * * *","*/5 * * * *"]`
// ——它切自 `* * * * *` 還不存在的年代，照那份合併＝把每分鐘那顆整個關掉。
//
// 這支不是要證明設定「對」，是要讓**移除變成一個刻意的動作**：想拿掉一條，
// 就得回到下面的表把它刪掉，而那張表會逼你先讀一遍「拿掉會壞什麼」。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── 必須存在的 cron 觸發器 ────────────────────────────────────────────────
// key＝cron 運算式（要與 wrangler.jsonc 逐字相同），value＝拿掉會停掉什麼。
// 🔴 要刪掉任何一條之前，先確認 value 裡列的每一件事都真的不需要了。
const REQUIRED_CRONS = {
  '* * * * *':
    '北捷帳本每分鐘的官方取樣（🔴 不可重現，當下沒取到就永遠沒有）、Live Activity 跟車卡推播、'
    + '捷運等車卡推播、NCDR 災害監看、高鐵班表自癒（worker.js 的 scheduled 對這條有專屬分支並提早 return）',
  '15 1 * * *':
    '台鐵誤點履歷 ingest、逐站事件保留期清理、高鐵未來班表 ingest'
    + '（走 scheduled 的 fallthrough 分支，不是靠字面比對，所以程式裡搜不到這個字串是正常的）',
};

// ── `.assetsignore` 裡不可以消失的條目 ────────────────────────────────────
// 只列「真的外洩過或差一步就外洩」的那幾條，不是全表——全表的正本是 .assetsignore 自己的註解。
const REQUIRED_ASSETSIGNORE = {
  '.env': '憑證',
  '.cache': '🔴 2026-07-26 實測外洩：60 天 TDX 原始快取在預覽站回 200',
  'data/tdx': '🔴 TDX／OSM 原始 API 傾印 68 檔；裸跑 wrangler upload 時的第二道防線',
  'node_modules': '🔴 仍在做實事：少了它，node_modules 裡 1,773 個普通檔會被當靜態資產上傳',
  'scratchpad': '各 session 的暫存工作區，內容不受控',
  '.superpowers': '🔴 SDD 帳本與 review-*.diff——diff 裡留著「改動前」的原文',
  'fixtures': '保存的上游原始回應（驗收語料），原始資料不對外散布',
  'scripts': '出貨腳本與驗收腳本，不是網站資產',
  'worker.js': '後端原始碼',
  'wrangler.jsonc': '後端設定（含 binding 名稱與 namespace id）',
};

const fails = [];
const fail = m => fails.push(m);
const ok = m => console.log('  ✓ ' + m);

// ── 1. crons ──────────────────────────────────────────────────────────────
const wranglerPath = path.join(ROOT, 'wrangler.jsonc');
const wrangler = fs.readFileSync(wranglerPath, 'utf8');
const cronsRaw = /"crons"\s*:\s*(\[[^\]]*\])/.exec(wrangler);
if (!cronsRaw) {
  fail('wrangler.jsonc 裡找不到 "crons" ——整組排程觸發器不見了，所有 cron 任務都不會跑');
} else {
  let declared;
  try { declared = JSON.parse(cronsRaw[1]); } catch (e) { declared = null; }
  if (!Array.isArray(declared)) {
    fail(`wrangler.jsonc 的 "crons" 解析不出陣列：${cronsRaw[1]}`);
  } else {
    const set = new Set(declared);
    for (const [cron, drives] of Object.entries(REQUIRED_CRONS)) {
      if (set.has(cron)) ok(`cron "${cron}" 有宣告`);
      else fail(`🔴 cron "${cron}" 從 wrangler.jsonc 消失了 —— 這會靜默停掉：${drives}`);
    }
    // 反向：宣告了但這張表沒記的，要嘛是有人新增卻沒說明它在做什麼，要嘛是誤加的死觸發器
    //（死觸發器不會報錯，只會每次照跑照計費）。兩種都要人看一眼，所以一律擋下來。
    for (const cron of declared) {
      if (!REQUIRED_CRONS[cron]) {
        fail(`cron "${cron}" 有宣告但 check_deploy_config.mjs 的 REQUIRED_CRONS 沒有記它在做什麼`
          + ' —— 新增的請補一條說明（順便就受到這道防線保護）；已經不需要的請從 wrangler.jsonc 刪掉');
      }
    }
  }
}

// ── 2. .assetsignore ──────────────────────────────────────────────────────
const aiPath = path.join(ROOT, '.assetsignore');
if (!fs.existsSync(aiPath)) {
  fail('🔴 .assetsignore 不存在 —— wrangler 會把整個工作目錄當靜態資產上傳');
} else {
  const lines = new Set(fs.readFileSync(aiPath, 'utf8').split('\n')
    .map(l => l.trim()).filter(l => l && !l.startsWith('#')));
  const missing = Object.entries(REQUIRED_ASSETSIGNORE).filter(([k]) => !lines.has(k));
  if (!missing.length) ok(`.assetsignore 的 ${Object.keys(REQUIRED_ASSETSIGNORE).length} 條高後果排除都在`);
  for (const [k, why] of missing) fail(`🔴 .assetsignore 少了 "${k}" —— ${why}`);
}

// ── 收尾 ──────────────────────────────────────────────────────────────────
if (fails.length) {
  console.error('\n❌ 部署設定檢查未過：\n' + fails.map(f => '  ✗ ' + f).join('\n'));
  console.error('\n這類設定是整包覆蓋的，少一條不會有任何錯誤訊息 —— 修好再出貨。');
  process.exit(1);
}
console.log(`\n✅ 部署設定檢查通過（${Object.keys(REQUIRED_CRONS).length} 條 cron、`
  + `${Object.keys(REQUIRED_ASSETSIGNORE).length} 條高後果資產排除）`);
