// 閘門的 Chromium 改走真 GPU 的無頭模式。ship_web.mjs 用 NODE_OPTIONS=--import 預載這支，閘門檔一支都不用改。
//
// 為什麼：不帶 channel 的 chromium.launch() 跑的是 chrome-headless-shell，WebGL 走 SwiftShader 軟體算繪；
// 地圖是 MapLibre（WebGL），每支開地圖的閘門都在用 CPU 模擬 GPU（GPU 程序常駐 4–5 顆核心）。十幾個 session
// 並行時互相拖慢，計時型閘門跟著假紅。同一版 Chromium 的無頭模式（channel:'chromium'，Playwright 自帶，
// 版本與 headless shell 相同）走 ANGLE Metal，一樣不開視窗、不搶焦點。量測數字見加入這支的 commit 訊息。
//
// 做法：主程式原始碼有提到 playwright 才載入 playwright-core（每個程序約 0.2 CPU 秒，dev_server、wrangler
// 這類子程序不必付），替沒指定 channel／executablePath 的 chromium.launch／launchPersistentContext／
// launchServer 補 channel:'chromium'。headless 不動（預設 true）；腳本自己指定 channel 的照舊；WebKit 不動。
// 任何一步出錯都當作沒載入（退回 headless shell），不能因為這支讓閘門起不來。
//
// 單獨跑某支閘門、要跟出貨鏈同一種模式（在 repo 根目錄）：
//   NODE_OPTIONS=--import=./scripts/pw_gpu_preload.mjs node scripts/verify_xxx.mjs
// 不帶 NODE_OPTIONS 就是舊的 headless shell；想分辨「紅燈是不是 GPU 模式造成的」就兩種各跑一次。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

try {
  const main = process.argv[1] && path.resolve(process.argv[1]);
  if (main && /playwright/.test(fs.readFileSync(main, 'utf8'))) {
    const { chromium } = createRequire(main)('playwright-core');
    const withChannel = o => (o && (o.channel || o.executablePath)) ? o : { ...o, channel: 'chromium' };
    for (const [name, at] of [['launch', 0], ['launchServer', 0], ['launchPersistentContext', 1]]) {
      const orig = chromium[name];
      if (typeof orig !== 'function') continue;
      chromium[name] = (...args) => { args[at] = withChannel(args[at]); return orig.apply(chromium, args); };
    }
  }
} catch { /* 退回 headless shell */ }
