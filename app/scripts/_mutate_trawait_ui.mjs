// 台鐵等站卡【前端】判準的突變測試:證明 verify_tra_wait_ui.mjs 那 89 條真的有牙。
//
// 🔴 突變清單的產生方式是【逐條修法各還原一次】,不是「想幾個看起來像回歸的改動」——
//    後者由實作者自己列,會系統性地漏掉他沒想到的那一條(judgment 心得 37)。
//    下面每一發都對應 index.html 裡一個【刻意的設計決定】,把它還原成「沒有想到那件事時
//    最自然會寫出來的樣子」。
//
// 判準是「驗收腳本失敗,而且失敗清單裡有指定的那一條」——不是只看有沒有非零離開:
// 少了條目比對,任何一發把頁面改到開不了機都會「通過」,而 boot 壞掉跟判準有沒有牙無關。
//
// 跑法:node app/scripts/_mutate_trawait_ui.mjs
// 跑完自動還原並比對 md5——還原失敗會以非零離開,不會把突變過的 index.html 留在樹上。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TARGET = resolve(here, '../../index.html');
const VERIFY = resolve(here, 'verify_tra_wait_ui.mjs');

const original = readFileSync(TARGET, 'utf8');
const originalMd5 = createHash('md5').update(original).digest('hex');

// 每一發:from → to 的字面取代(必須恰好命中一次,否則整支中止——避免「突變根本沒套上去
// 卻因為全綠而誤以為判準沒牙」這種反向假象),外加預期會轉紅的那一條判準的代號。
const MUTATIONS = [
  {
    id: 'U1 誤點改讀 easedShift 的漸變值',
    why: '整張卡的第一紅線:使用者長期裁示「官方值一律照抄」。liveDelaySec() 是給動畫用的\n'
       + '     漸變量,它在兩個官方值之間平滑移動 ⇒ 送上去的是一個官方從來沒說過的數字。\n'
       + '     只有 C3 那一刻(官方剛從 7 跳到 20、eased 還在爬)分得出來——C1 是綠的,\n'
       + '     因為 live 剛啟用時 eased 會 snap 到官方值、兩者恰好相等。',
    from: '  const raw = state.live.map.get(String(trainNo));',
    to: '  const _mtr = (state.trains || []).find(t => String(t.train) === String(trainNo) && t.sys === \'tra_sched\');\n'
      + '  const raw = _mtr ? Math.round(liveDelaySec(_mtr) / 60) : null;',
    expect: 'C3 選單印的是官方原值',
  },
  {
    id: 'U2 「不在官方動態窗裡」被當成「準點」',
    why: 'TDX 的 TrainLiveBoard 只給動態前後 30 分鐘的車,還沒發車的車根本不在裡面。\n'
       + '     把 null 合併成 0 ⇒ 選單替官方宣稱一件它沒說過的事。',
    from: '  if (raw == null) return { delayMin: null, dataAt };',
    to: '  if (raw == null) return { delayMin: 0, dataAt };',
    expect: 'C2 不在官方動態窗裡的車',
  },
  {
    id: 'U3 schedSec 沒把誤點減回去（送出去的是實際約到站不是表定）',
    why: '卡片印的是「表定 18:32・誤點 3 分（實際約 18:35）」——表定被汙染成 18:35 的話,\n'
       + '     伺服器每分鐘還會再加一次誤點,兩個數字會越漂越遠。\n'
       + '     🔴 這一發只有在 eased 已經追上官方值時才驗得到(D0 就是為它做的前提閘門):\n'
       + '     dl 還停在 0 的那一瞬間,「有沒有減回去」算出來一模一樣。',
    from: '    const schedEpoch = nowEpoch + (r.dtm - r.dl * 60);',
    to: '    const schedEpoch = nowEpoch + r.dtm;',
    expect: 'D2 schedSec 換回台北鐘面',
  },
  {
    id: 'U4 官方停駛的車也能被選來追蹤',
    why: '追蹤一班今天不開的車,卡片會安安靜靜地倒數到一個永遠不會發生的時刻。\n'
       + '     （B6 的分母是腳本自己注入的一班停駛車——今天官方零停駛,不注入的話這條恆真。）',
    from: '    if (r.off) continue;                       // 官方停駛:沒有這班車可等',
    to: '    if (false) continue;',
    expect: 'B6 官方停駛的車不在候選裡',
  },
  {
    id: 'U5 候選不設上限',
    why: '看板一站可以有 59 班在窗內。全塞進選單＝使用者要在鎖屏開卡之前先捲一份時刻表。',
    from: '    if (out.length >= 8) break;',
    to: '    if (false) break;',
    expect: 'B3 候選 1–8 班',
  },
  {
    id: 'U6 選單掛進 .stage（不是 body 層）',
    why: '.stage 的 z-index 會把子孫封頂成 1000 ⇒ 對話框被地圖上的東西蓋掉。\n'
       + '     computed style 完全照不到(opacity/display 都正常),只有「掛在誰底下」看得出來。',
    from: '  modal.hidden = false;\n'
        + '  requestAnimationFrame(() => { const first = choices.querySelector(\'.tra-wait-choice\'); if (first) first.focus(); });',
    to: '  document.querySelector(\'.stage\').appendChild(modal);\n'
      + '  modal.hidden = false;\n'
      + '  requestAnimationFrame(() => { const first = choices.querySelector(\'.tra-wait-choice\'); if (first) first.focus(); });',
    expect: 'B2 選單掛在 body 層',
  },
  {
    id: 'U7 時鐘不在「現在」時不自救',
    why: '看板的 rows 是照 state.simSec 推的。時鐘被撥到兩小時後時直接讀它,\n'
       + '     算出來的表定對不上真實世界,而卡片會言之鑿鑿地印出來。',
    from: '  if (Math.abs(state.simSec - nowSecOfDay(activeTz())) > 120 || state.speed !== 1) {\n'
        + '    jumpToNow();\n'
        + '    renderBoard();\n'
        + '    showToast(\'已把時間帶回「現在」才能追蹤班次\');\n'
        + '  }',
    to: '',
    expect: 'H1 時鐘離開「現在」時先帶回來',
  },
  {
    id: 'U8 互斥函式不收台鐵這半',
    why: '鎖屏同時掛兩張等候卡＝兩張都看不清。收不掉 JS 這半的 state 時,\n'
       + '     看板鈕會停在「結束追蹤」而那張卡早就被擠掉了。',
    from: '  if (keep !== \'tra\') {\n'
        + '    traWaitUnbind();\n'
        + '    if (state.traWait) { state.traWait = null; refreshTraWaitButton(); }\n'
        + '  }',
    to: '',
    expect: 'F2 反向也成立',
  },
  {
    id: 'U9 開卡路徑忘了呼叫互斥函式',
    why: '🔴 與 U8 是【同一件事的兩個失效面】:互斥函式本身寫得再對,只要開卡路徑沒叫它,\n'
       + '     鎖屏上照樣並存兩張卡。這一發驗的是 F1 走真的開卡路徑(不是直接呼叫互斥函式)\n'
       + '     ——斷言擺在受測物下游的話,這一發是綠的。',
    from: '  waitCardsDropOther(\'tra\');   // 鎖屏只留一張等候卡（原生也會收,這裡收 JS 這半的 state 與綁定）',
    to: '',
    expect: 'F1 從看板開等站卡時',
  },
  {
    id: 'U10 收卡不通知伺服器註銷',
    why: '伺服器會繼續每分鐘推給一張已經不存在的卡,直到 expire_at 才被 cron 清掉。',
    from: '  traWaitUnbind();   // 伺服器那一列要一起清掉,否則它會繼續推給一張已經不存在的卡',
    to: '',
    expect: 'G2 收卡同時通知伺服器註銷',
  },
  {
    id: 'U11 舊卡的 token 也照樣交班',
    why: 'pushTokenUpdates 是 AsyncSequence,token 會多次輪替。少了 key 比對,\n'
       + '     換車時舊卡的 token 會在新卡開好之後回來、被當成新卡的 token 送上去。\n'
       + '     🔴 這一發【兩道閘門一起拿掉】是刻意的:listener 與 traWaitBind 各有一道,\n'
       + '     那是縱深防禦——只拿掉其中一道,行為上完全看不出來(第一版突變就是只拿掉\n'
       + '     traWaitBind 那道,結果全綠)。縱深防禦的定義就是「少一道還是擋得住」,\n'
       + '     所以要驗的是「key 比對這件事整個不見了」,不是「某一行還在不在」。',
    from: '    if (!token || key !== _twKey) return;   // 舊卡的 token 晚到:丟掉,不可以交上去',
    to: '    if (!token) return;',
    to2: {
      from: '  if (!token || key !== _twKey || !s || !s.endAt) return;  // 舊卡的 token、或 state 還沒設好',
      to: '  if (!token || !s || !s.endAt) return;',
    },
    expect: 'E4 key 對不上的 token 不會交班',
  },
  {
    id: 'U12 bind 自己重算追蹤窗',
    why: '伺服器每分鐘要用【同一個表定】去算實際約到站。自己重算會與卡片上印著的數字漂開,\n'
       + '     而且算出來的 endAt 與原生回的不同時,伺服器會提早或延後收卡。',
    from: '        schedSec: s.schedSec, endAt: s.endAt,',
    to: '        schedSec: s.schedSec, endAt: Math.floor(Date.now() / 1000) + 3600,',
    expect: 'E2 bind 的 schedSec/endAt',
  },
  {
    id: 'U13 沒有原生 plugin 也畫 pill',
    why: '網站與 PWA 沒有 ActivityKit ⇒ 按了什麼都不會發生。\n'
       + '     這顆鈕是純 App 能力的入口,不該出現在沒有那個能力的環境。',
    from: '  if (!st || st.sys !== \'tra_sched\' || !traWaitEnabled()) return \'\';',
    to: '  if (!st || st.sys !== \'tra_sched\') return \'\';',
    expect: 'I1 沒有 RailTraWait plugin 時 pill 完全不出現',
  },
  {
    id: 'U14 pill 移出 sticky h3',
    why: 'v0717p 鐵則:看板捲動時 h3 是唯一固定在頂端的一列。放在 h3 外面的話,\n'
       + '     使用者捲兩下看班次,這顆 CTA 就捲不見了。',
    // 🔴 錨點不能只寫 close 鈕那一行——四張看板(台鐵/高鐵/捷運/林鐵)長得一模一樣,
    //    命中 4 次。改成在【唯一含 traWaitBoardHtml 的那一段】上就地切,並在執行時才組出來。
    build: src => {
      const head = '    traWaitBoardHtml(st) +\n';
      const tail = ' + eventRowsHtml(st) +';
      const i = src.indexOf(head);
      const j = src.indexOf(tail, i);
      if (i < 0 || j < 0) return null;
      const from = src.slice(i, j + tail.length);
      return {
        from,
        to: from.replace(head, '')
                .replace('</h3>` + stnMetaHtml(st)', '</h3>` + traWaitBoardHtml(st) + stnMetaHtml(st)'),
      };
    },
    expect: 'A2 pill 出現在 sticky h3 內',
  },
  {
    id: 'U15 字體改回無效的 font 簡寫',
    why: '🔴 這一發是被實際的紅逼出來的(第一次跑 J1 時 WebKit 27px vs Chromium 33px)。\n'
       + '     `font: 800 12.5px/1.5 inherit` 裡的 inherit 擺在 family 的位置＝整條宣告被丟掉,\n'
       + '     兩個引擎各自退回自己的 UA 預設按鈕字體。iOS 是 WebKit ⇒ 這顆 CTA 在【唯一有\n'
       + '     等站卡的平台】上最矮,而且從來沒有過 800 字重。',
    from: '    font-weight: 800; font-size: 12.5px; line-height: 1.5; font-family: inherit;\n'
        + '    letter-spacing: .6px;',
    to: '    font: 800 12.5px/1.5 inherit; letter-spacing: .6px;',
    expect: 'J1b .board-wait 的字體宣告',
  },
  {
    id: 'U16 payload 加一個倒數欄位',
    why: '派工原話:「絕不做秒級倒數——沒有的精度不准造」。payload 是卡片文字的唯一原料,\n'
       + '     這裡漏進去的話,卡上要不要印就只剩版面決定,而版面是會改的。',
    from: '    dest: cand.dest, schedSec: cand.schedEpoch, color: cand.color, key,',
    to: '    dest: cand.dest, schedSec: cand.schedEpoch, color: cand.color, key,\n'
      + '    secondsLeft: Math.max(0, cand.schedEpoch - Math.floor(Date.now() / 1000)),',
    expect: 'D5 payload 沒有任何倒數',
  },
  {
    id: 'U17 dataAt 改取讀取端時鐘',
    why: '誤點值的年齡決定卡片要不要說「誤點資訊已過期」。用讀取端時鐘標齡的話,\n'
       + '     「被某層快取餵了半小時前的主體」這件事【結構上不可能】被偵測到——它恆為新鮮。',
    from: '  const dataAt = Math.round(ms / 1000);',
    to: '  const dataAt = Math.round(Date.now() / 1000);',
    expect: 'D3 delayMin 是官方原值',
  },
];

function runVerify() {
  try {
    const out = execFileSync(process.execPath, [VERIFY], { encoding: 'utf8', stdio: 'pipe' });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: String((e.stdout || '') + (e.stderr || '')) };
  }
}
// 只認【FAIL 行】裡出現的條目名,不認整份輸出——PASS 行也含判準名,拿整份輸出比對會把
// 「這條其實是綠的」讀成抓到了。
const failedNames = out => out.split('\n').filter(l => l.trim().startsWith('FAIL ')).join('\n');

// 控制組:沒突變的時候必須整支跑完。少了這一條,「每一發都紅」有可能只是因為它本來就是紅的。
const baseline = runVerify();
if (!baseline.ok) {
  console.error('控制組就跑不過——先修好驗收腳本再跑突變:\n' + baseline.out.slice(-2500));
  process.exit(2);
}
console.log('控制組 全綠 ✓\n');

let bad = 0;
for (const m of MUTATIONS) {
  let mutated = original;
  if (m.build) {
    const built = m.build(original);
    if (!built) {
      console.error(`${m.id}:build() 組不出取代字串（錨點在 index.html 裡找不到）,整支中止`);
      process.exit(2);
    }
    m.from = built.from; m.to = built.to;
  }
  const apply = (from, to) => {
    if (mutated.split(from).length - 1 !== 1) {
      console.error(`${m.id}:取代字串命中 ${mutated.split(from).length - 1} 次(必須恰好 1 次),整支中止`);
      writeFileSync(TARGET, original);
      process.exit(2);
    }
    mutated = mutated.replace(from, to);
  };
  apply(m.from, m.to);
  if (m.to2) apply(m.to2.from, m.to2.to);
  writeFileSync(TARGET, mutated);
  const res = runVerify();
  writeFileSync(TARGET, original);

  // 🔴 頁面開不了機不算抓到:那證明的是 JS 語法檢查,不是判準有牙。
  //    boot 掛掉時 A1 之後每一條都會紅,任何 expect 都會「命中」。
  const booted = /PASS \[chromium\] A1 /.test(res.out);
  const fails = failedNames(res.out);
  const hit = !res.ok && booted && fails.includes(m.expect);
  if (!hit) bad++;
  console.log(`${hit ? 'PASS' : 'FAIL'} ${m.id}`);
  if (hit) {
    const line = res.out.split('\n').find((l) => l.trim().startsWith('FAIL ') && l.includes(m.expect)) ?? '';
    console.log(`     抓到:${line.trim().slice(0, 150)}`);
    const n = fails.split('\n').filter(Boolean).length;
    if (n > 2) console.log(`     （連帶轉紅 ${n} 條，代表這條修法不只被一個判準看著）`);
  } else if (res.ok) {
    console.log('     🔴 驗收腳本【整支跑完】=這一條沒有任何判準看得到');
  } else if (!booted) {
    console.log('     🔴 頁面開不了機(這一發的取代寫壞了,不是判準有牙),修突變本身');
  } else {
    console.log(`     🔴 有紅但不是預期那條(預期含「${m.expect}」),實際紅的是:\n     ${fails.split('\n').filter(Boolean).slice(0, 4).map(s => s.trim().slice(0, 120)).join('\n     ')}`);
  }
  console.log(`     ${m.why}`);
}

const restoredMd5 = createHash('md5').update(readFileSync(TARGET, 'utf8')).digest('hex');
if (restoredMd5 !== originalMd5) {
  console.error(`\n🔴 還原失敗:md5 ${restoredMd5} ≠ ${originalMd5}`);
  process.exit(2);
}
console.log(`\n還原確認 md5=${originalMd5} ✓`);
console.log(`總計 ${MUTATIONS.length} 發,沒抓到的 ${bad} 發`);
process.exit(bad ? 1 : 0);
