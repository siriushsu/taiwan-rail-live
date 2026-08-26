// 台鐵等站卡「版面＋精度」判準的突變測試:證明 render_activity_widget.mjs 裡那幾道
// 等站卡 gate 真的有牙。
//
// 🔴 突變清單的產生方式是【逐條修法各還原一次】,不是「想幾個看起來像回歸的改動」——
//    後者由實作者自己列,會系統性地漏掉他沒想到的那一條(judgment 心得 37)。
//    下面每一發都對應 TraWaitActivity.swift 裡一個【刻意的設計決定】,把它還原成
//    「沒有想到那件事時最自然會寫出來的樣子」。
//
// 判準是「算繪腳本失敗,而且失敗訊息裡有這一句」——不是只看有沒有非零離開:
// 少了訊息比對,任何一發把 Swift 改到編不起來都會「通過」,而編譯錯誤跟判準有沒有牙無關。
//
// 跑法:node app/scripts/_mutate_trawait_render.mjs
// 跑完自動還原並比對 md5——還原失敗會以非零離開,不會把突變過的檔留在樹上。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TARGET = resolve(here, '../ios/App/RailBoardWidget/TraWaitActivity.swift');
const RENDER = resolve(here, 'render_activity_widget.mjs');
const shots = mkdtempSync(join(tmpdir(), 'trawait-mutate-'));

const original = readFileSync(TARGET, 'utf8');
const originalMd5 = createHash('md5').update(original).digest('hex');

// 每一發:from → to 的字面取代(必須恰好命中一次,否則整支中止——避免「突變根本沒套上去
// 卻因為全綠而誤以為判準沒牙」這種反向假象),外加預期失敗訊息裡必須出現的片語。
const MUTATIONS = [
  {
    id: 'R1 主角改回倒數(還原成「還有幾分幾秒」)',
    why: '這是整張卡最核心的紅線:官方只有表定與誤點分鐘,秒級倒數是憑空造出來的精度。\n'
       + '     刻意挑一個【形狀上合法】的倒數(14:00 也符合 HH:mm),證明判準靠的是值不是形狀。',
    from: '            heroText: RailBoardClock.updateTimeString(eta),',
    to: '            heroText: String(format: "%02d:%02d", Int(max(0, eta.timeIntervalSince(now))) / 60,'
      + ' Int(max(0, eta.timeIntervalSince(now))) % 60),',
    expect: '表定＋官方誤點應該是',
  },
  {
    id: 'R2 誤點未知當成準點',
    why: '「不在官方動態窗裡」與「官方說準點」被合併——卡片會宣稱一個官方沒說過的事實。',
    from: `            tone = .unknown
            delayText = expired ? "誤點資訊已過期" : "目前無即時誤點資訊"`,
    to: `            tone = .onTime
            delayText = expired ? "誤點資訊已過期" : "準點"`,
    expect: '的誤點句是',
  },
  {
    id: 'R3 主角標籤寫死成「實際約」',
    why: '沒想到「準點」與「誤點未知」的主角時刻【本來就相同】時最自然的寫法。\n'
       + '     後果:官方沒說話的時候,卡片用一個 34pt 的數字替官方說了「這班準點」。\n'
       + '     先開火的是逐格期望表(它把每一格的標籤釘死);「準點與未知不可同標籤」那條\n'
       + '     是同一件事的第二道防線,它守的是【未來有人放寬期望表】的那一天。',
    from: '            heroCaption: shown == nil ? "表定" : "實際約",',
    to: '            heroCaption: "實際約",',
    expect: '的主角標成',
  },
  {
    id: 'R4 第三列永遠印表定',
    why: '主角本身就是表定的時候(誤點未知／過期)再印一次 ⇒ 同一個數字並排兩份。',
    from: '            schedText: shown == nil ? nil : "表定 \\(RailBoardClock.updateTimeString(sched))",',
    to: '            schedText: "表定 \\(RailBoardClock.updateTimeString(sched))",',
    expect: '出現 2 次',
  },
  {
    id: 'R5 第三列不印表定',
    why: '反方向:表定整個從卡上消失,使用者就再也驗不了我們算出來的那個主角時刻。\n'
       + '     兩個方向各一發是刻意的——只寫「不可以重複」的話,「乾脆都不印」也會全綠。',
    from: '            schedText: shown == nil ? nil : "表定 \\(RailBoardClock.updateTimeString(sched))",',
    to: '            schedText: nil,',
    expect: '出現 0 次',
  },
  {
    id: 'R6 誤點資訊不會過期',
    why: '半小時前的誤點被當成現在的事實(使用者長期裁示:「有資訊就一定要對」)。',
    from: '        let expired = age.map { $0 > TraWaitStale.delayMaxAgeSeconds } ?? false',
    to: '        let expired = false',
    // 先開火的同樣是逐格期望表(過齡那一格的主角必須退回表定);
    // 「過期那格 expired=true、新鮮那格 expired=false」是第二道防線。
    expect: '「誤點資訊過齡」的主角時刻是',
  },
  {
    id: 'R7 到站說明句只留一種',
    why: '沒接上推播的卡不會自己更新誤點、也不會自己收,卻跟接上的說同一句話。',
    from: `        let hint: String? = isStale
            ? (pushed == true ? "追蹤到此結束，卡片會自動關閉"
                              : "誤點分鐘不會自己更新，要看最新請回軌島")
            : nil`,
    to: `        let hint: String? = isStale ? "追蹤到此結束，卡片會自動關閉" : nil`,
    expect: '說同一句話',
  },
  {
    id: 'R8 主角字級與列距調回寬鬆值',
    why: '這兩個數字是被 160pt 逼出來的,不是美感選擇:六列全滿時鎖屏卡片會被系統截掉上下緣\n'
       + '     (2026-08-17 使用者實機回報過同一件事)。',
    from: '        VStack(alignment: .leading, spacing: scale.pt(3)) {',
    to: '        VStack(alignment: .leading, spacing: scale.pt(6)) {',
    to2: {
      from: '                        .font(.system(size: scale.pt(34), weight: .semibold))',
      to: '                        .font(.system(size: scale.pt(44), weight: .semibold))',
    },
    expect: '超過系統上限',
  },
  {
    id: 'R9 主角改用自走倒數元件',
    why: 'RailCountdownText 是給「3 分」「52 秒」用的兩級字階＋倒數語意。\n'
       + '     這一發驗的是原始碼層 gate(traNoSelfRunningTextGate),它擋的是【冷門分支】\n'
       + '     偷偷長出自走文字——值層 gate 只驗得到 fixture 走過的那幾條路。',
    from: '                    Text(display.heroText)\n'
        + '                        .font(.system(size: scale.pt(34), weight: .semibold))',
    to: '                    RailCountdownText(countdown: .noData, size: scale.pt(34), scale: scale)\n'
      + '                    Text(display.heroText)\n'
      + '                        .font(.system(size: scale.pt(34), weight: .semibold))',
    expect: 'RailCountdownText',
  },
  {
    id: 'R10 minimal 兩態都畫空心環',
    why: '那顆圓只有 22pt、塞不下「18:35」⇒ 狀態只能靠形狀。兩態同形就等於它什麼都沒說。',
    from: `            if arrived {
                Circle().fill(mono ? Color.primary : c.ok)
            } else {
                Circle().strokeBorder(ring, lineWidth: scale.pt(2))
            }`,
    to: '            Circle().strokeBorder(ring, lineWidth: scale.pt(2))',
    expect: '畫成同一張圖',
  },
  {
    id: 'R11 負誤點(早到)被夾成準點',
    why: '官方值一律照抄(使用者長期裁示)。夾正看起來「比較合理」,但那是我們改了官方說的話。',
    from: '            else if m < 0 { tone = .late; delayText = "早到 \\(-m) 分" }   // 官方值照抄，不夾正',
    to: '            else if m < 0 { tone = .onTime; delayText = "準點" }',
    expect: '的誤點句是',
  },
  {
    id: 'R12 「結束」鈕改成 Button(action:)',
    why: '鎖屏 Live Activity 跑不了任意 closure ⇒ 那顆鈕畫得出來但按了不會有任何反應。',
    from: '                Button(intent: TraWaitEndIntent()) {\n                    RailEndButton(scale: scale, height: height) { Text("結束") }',
    to: '                Button(action: {}) {\n                    RailEndButton(scale: scale, height: height) { Text("結束") }',
    expect: '顆接了 intent',
  },
  {
    id: 'R13 島上那條軌道不吃 display.track',
    why: '算繪一律走靜態軌道(理由見 pngData)⇒ 少傳 interval 的那條在真機上不會自己走,\n'
       + '     而算繪出來的每一張圖都長得一模一樣。兩個呼叫點只壞一個時,存在性檢查是綠的。',
    from: `            RailSpineTrack(interval: display.track,
                           progress: display.progress,
                           phase: display.arrived ? .arriving : .running,
                           lineColor: display.color, scale: scale)`,
    to: `            RailSpineTrack(interval: nil,
                           progress: display.progress,
                           phase: display.arrived ? .arriving : .running,
                           lineColor: display.color, scale: scale)`,
    expect: '個把 display.track 傳進去',
  },
];

function runRender() {
  try {
    execFileSync(process.execPath, [RENDER, shots], { encoding: 'utf8', stdio: 'pipe' });
    return { ok: true, out: '' };
  } catch (e) {
    return { ok: false, out: String((e.stdout || '') + (e.stderr || '')) };
  }
}

// 控制組:沒突變的時候必須整支跑完。少了這一條,「每一發都紅」有可能只是因為它本來就是紅的。
const baseline = runRender();
if (!baseline.ok) {
  console.error('控制組就跑不過——先修好算繪腳本再跑突變:\n' + baseline.out.slice(-2000));
  process.exit(2);
}
console.log('控制組 全綠 ✓\n');

let bad = 0;
for (const m of MUTATIONS) {
  let mutated = original;
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
  const res = runRender();
  writeFileSync(TARGET, original);

  // 🔴 編譯錯誤不算抓到:那證明的是 Swift 語法檢查,不是判準有牙。
  const compiled = !/error:/.test(res.out);
  const hit = !res.ok && compiled && res.out.includes(m.expect);
  if (!hit) bad++;
  console.log(`${hit ? 'PASS' : 'FAIL'} ${m.id}`);
  if (hit) {
    const line = res.out.split('\n').find((l) => l.includes(m.expect)) ?? '';
    console.log(`     抓到:${line.trim().slice(0, 140)}`);
  } else if (res.ok) {
    console.log('     🔴 算繪腳本【整支跑完】=這一條沒有任何判準看得到');
  } else if (!compiled) {
    console.log('     🔴 Swift 編不起來(這一發的取代寫壞了,不是判準有牙),修突變本身');
  } else {
    console.log(`     🔴 有失敗但訊息對不上(預期含「${m.expect}」):\n     ${res.out.trim().split('\n').slice(-2).join('\n     ').slice(0, 300)}`);
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
