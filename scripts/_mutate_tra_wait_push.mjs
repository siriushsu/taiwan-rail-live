// 台鐵等站卡推播鏈(worker.js 那一層)的突變測試:證明 verify_tra_wait_push.mjs 的判準真的有牙。
//
// 🔴 突變清單的產生方式是【逐條修法各還原一次】,不是「想幾個看起來像回歸的改動」——
//    後者由實作者自己列,會系統性地漏掉他沒想到的那一條(judgment 心得 37)。
//    下面每一發都對應 traWaitPushAll／traWaitBind／traWaitLive 裡一個【刻意的設計決定】,
//    把它還原成「沒有想到那件事時最自然會寫出來的樣子」。
//
// ⚠️ 突變沒轉紅時,先確認突變本身真的改變了行為(核心那支的 M7 就踩過:只拿掉兩道互為備援的
//    守衛之一 ⇒ 全綠,那不是判準沒牙,是突變根本沒生效)。取代字串命中次數必須恰好 1,否則中止。
//
// 跑法:node scripts/_mutate_tra_wait_push.mjs
// 跑完自動還原並比對 md5——還原失敗會以非零離開,不會把突變過的 worker.js 留在樹上。
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, '..', 'worker.js');
const VERIFY = join(HERE, 'verify_tra_wait_push.mjs');

const original = readFileSync(TARGET, 'utf8');
const originalMd5 = createHash('md5').update(original).digest('hex');

const MUTATIONS = [
  {
    id: 'W1 不分「看板新鮮但查無此車」與「資料過舊」(兩種 known=false 一視同仁)',
    why: '沒想到動態窗只有前後 30 分鐘時最自然的寫法。後果:在途的車掉出窗一輪,\n'
       + '     主角時刻就在 18:35↔18:32 之間來回跳。\n'
       + '     ⚠️ 第一版突變只改 shownDelay,而 hold 的早退守衛還在 ⇒ 那一列照樣不推、D1 全綠。\n'
       + '     跟核心那支的 M7 同款:突變沒轉紅時先確認突變真的改變了行為,不要直接判定判準沒牙。',
    from: `      const holding = !delay.known && delay.fresh && !!prev && prev.delayMin != null;`,
    to: `      const holding = false;`,
    to2: {
      from: `      const shownDelay = delay.known ? delay.delayMin : (holding ? prev.delayMin : null);`,
      to: `      const shownDelay = delay.known ? delay.delayMin : null;`,
    },
    expect: ['D1'],
  },
  {
    id: 'W2 誤點未知時照樣拿「表訂+180 秒」收卡',
    why: '最直覺的寫法就是把算好的 eta 直接交給收卡判定。但誤點未知時 eta 退回表訂,\n'
       + '     拿它收卡＝宣稱一個我們從沒告訴過使用者的到站時刻(精度紅線)。',
    from: `      const why = twShouldEnd(now, shownDelay == null ? null : eta, row.end_at);`,
    to: `      const why = twShouldEnd(now, eta, row.end_at);`,
    expect: ['C6', 'C6b'],
  },
  {
    id: 'W3 把 end_at 延長塞進「推播成功」那一支',
    why: '看起來很自然:反正都要寫 D1,一起寫。但誤點穩定不變時根本不推播 ⇒ end_at 永遠\n'
       + '     停在原地 ⇒ 一班誤點 40 分的車會在還沒到站時被 end_at 收掉。',
    from: `      const nextEnd = half ? null : twNextEndAt(eta, row.end_at, row.bound_at);
      if (nextEnd != null) {
        await env.DELAY_DB.prepare('UPDATE tra_wait_bindings SET end_at=?, expire_at=? WHERE token=?')
          .bind(nextEnd, nextEnd + 300, row.token).run();
        extended++;
      }`,
    to: `      const nextEnd = half ? null : twNextEndAt(eta, row.end_at, row.bound_at);`,
    to2: {
      from: `        await env.DELAY_DB.prepare('UPDATE tra_wait_bindings SET last_state=?, apns_env=?, fail_streak=0 WHERE token=?')
          .bind(JSON.stringify(state), r.envName, row.token).run();
        sent++;`,
      to: `        await env.DELAY_DB.prepare('UPDATE tra_wait_bindings SET last_state=?, apns_env=?, fail_streak=0 WHERE token=?')
          .bind(JSON.stringify(state), r.envName, row.token).run();
        if (nextEnd != null) {
          await env.DELAY_DB.prepare('UPDATE tra_wait_bindings SET end_at=?, expire_at=? WHERE token=?')
            .bind(nextEnd, nextEnd + 300, row.token).run();
          extended++;
        }
        sent++;`,
    },
    expect: ['E4'],
  },
  {
    id: 'W4 延長 end_at 時忘了一起延 expire_at',
    why: 'expire_at 是 cron 的兜底清理欄。只延 end_at 的話,延出去的那一段會先被兜底 DELETE\n'
       + '     掃掉——卡片在使用者還在等車時憑空消失,而且一則 log 都沒有。',
    from: `        await env.DELAY_DB.prepare('UPDATE tra_wait_bindings SET end_at=?, expire_at=? WHERE token=?')
          .bind(nextEnd, nextEnd + 300, row.token).run();`,
    to: `        await env.DELAY_DB.prepare('UPDATE tra_wait_bindings SET end_at=? WHERE token=?')
          .bind(nextEnd, row.token).run();`,
    expect: ['E1b'],
  },
  {
    id: 'W5 收卡沿用 metroWaitPushEnd 的預設 log 前綴',
    why: '共用那支函式時最容易漏掉的一格。後果:正式站的 log 裡兩條迴圈的收卡訊息長得\n'
       + '     一模一樣,出事時分不出是等車卡還是等站卡。',
    from: `        await metroWaitPushEnd(env, jwt, row, endState, now, why, 'tw-push');`,
    to: `        await metroWaitPushEnd(env, jwt, row, endState, now, why);`,
    expect: ['C8c'],
  },
  {
    id: 'W6 更新那一發不帶 stale-date',
    why: '推播的 content 會【整包取代】舊 content,少送這一項就等於把卡片的「已進站」語意\n'
       + '     拿掉(視圖靠 isStale 翻色),第一發之後就再也不會翻。',
    from: `      if (eta != null) body.aps['stale-date'] = Math.round(eta);`,
    to: `      // (突變:不帶 stale-date)`,
    expect: ['A7', 'A12b', 'A13b'],
  },
  {
    id: 'W7 收卡那一發直接送 prev(不用現算的形狀當底)',
    why: '「送使用者上次看到的那一包」聽起來完全正確,但欄位集合是跨行程契約——\n'
       + '     舊版 worker 存下來的 last_state 會決定欄位集合,新增一欄之後所有還活著的卡\n'
       + '     收到的 end 都會少那一欄。',
    from: `        const endState = { ...twContentState(delay, delay.dataAt), ...(prev || {}), pushed: true };`,
    to: `        const endState = { ...(prev || {}), pushed: true };`,
    expect: ['C3'],
  },
  {
    id: 'W8 換綁時不重設 last_state／fail_streak／bound_at',
    why: '只更新「這次交班帶來的欄位」是最小改動的直覺寫法。後果:換綁另一班車時,\n'
       + '     新車第一輪只要碰巧同樣是「誤點 3 分」就不會推,卡片停在舊車;\n'
       + '     且 3.5 小時上限從舊卡起算,新卡可能一開就已經超時。',
    from: `      ' end_at=excluded.end_at, last_state=NULL, fail_streak=0,' +
      ' bound_at=excluded.bound_at, expire_at=excluded.expire_at'`,
    to: `      ' end_at=excluded.end_at, expire_at=excluded.expire_at'`,
    expect: ['H3', 'H3b'],
  },
  {
    id: 'W9 cron 內部呼叫 tra-live 不帶 _src=cron',
    why: '複製 URL 時最容易掉的一段。後果:每分鐘一筆合成的 cam=na 假前景資料進\n'
       + '     railisland_usage,而那個 dataset 正是用來算前景分鐘與成本的。',
    // 🔴 錨點必須帶下面那行 tw-push 的 log:同一句 traLive(...?_src=cron) 在 laPushAll 也有一份,
    //    只取單行會命中兩次而整支中止。
    from: `    const r = await traLive(new Request(baseUrl + '/api/tra-live?_src=cron'), env, ctx);
    const j = await r.json();
    if (!r.ok || !Array.isArray(j && j.trains)) {
      console.error(\`[cron tw-push] tra-live 不可用`,
    to: `    const r = await traLive(new Request(baseUrl + '/api/tra-live'), env, ctx);
    const j = await r.json();
    if (!r.ok || !Array.isArray(j && j.trains)) {
      console.error(\`[cron tw-push] tra-live 不可用`,
    expect: ['A11b'],
  },
  {
    id: 'W10 拿掉過期列的兜底清理',
    why: '「收卡時就會刪列了,何必再掃一次」——但收卡推播整發失敗(APNs 全滅、D1 抖動)時,\n'
       + '     那一列會變成每分鐘打一次 APNs 的孤兒,永遠沒有出路。',
    from: `  if (!half) await env.DELAY_DB.prepare('DELETE FROM tra_wait_bindings WHERE expire_at < ?').bind(now).run();`,
    to: `  // (突變:拿掉兜底清理)`,
    expect: ['G1'],
  },
  {
    id: 'W11 拿掉 traLive 的 in-flight 去重',
    why: 'cron 三條迴圈並行、邊緣快取與 mem 都是 55 秒而 cron 每分鐘一發 ⇒ 兩條都會\n'
       + '     「剛好過期」⇒ 每分鐘向 TDX 買兩次同一份資料。TDX 是點數制,105% 是硬斷線。',
    from: `      if (!traLiveInflight) {
        traLiveInflight = (async () => {`,
    to: `      {
        await (async () => {`,
    to2: {
      from: `        })().finally(() => { traLiveInflight = null; });
      }
      await traLiveInflight;`,
      to: `        })();
      }`,
    },
    expect: ['J1'],
  },
  // ── 2026-09-23 等車卡 B:行駛段每分鐘推(使用者裁示「先改伺服器每分鐘推播」)──────────
  {
    id: 'W12 推播迴圈沒接上行駛段判斷(只剩遲滯)',
    why: '改了純邏輯卻忘了在 worker 裡呼叫:卡片上的車只在誤點變了才動,跟改版前一模一樣。',
    from: `      const runDue = twRunTickDue(prev, now, twRunWindow(row.prev_dep_sec, row.sched_sec, shownDelay));`,
    to: `      const runDue = false;`,
    expect: ['R1', 'R2', 'RP172a', 'RP165a'],
  },
  {
    id: 'W13 行駛段窗口用「這一輪查到的」誤點而不是「顯示中的」',
    why: '最直覺是拿 delay.delayMin——但 hold 時它是 null(這班車暫時掉出動態窗),\n'
       + '     窗口就不見了:南迴那種站間長跑正好整段停車。',
    from: `twRunWindow(row.prev_dep_sec, row.sched_sec, shownDelay)`,
    to: `twRunWindow(row.prev_dep_sec, row.sched_sec, delay.delayMin)`,
    expect: ['R8'],
  },
  {
    id: 'W14 hold 一律不推(沿用改版前那行)',
    why: '「hold 就是什麼都不送」是改版前的正確規則;車會動之後,hold 期間也要挪車。',
    from: `      if (holding && !runDue) { held++; continue; }`,
    to: `      if (holding) { held++; continue; }`,
    expect: ['R8'],
  },
  {
    id: 'W15 hold 中的行駛段那一發用現算的內容(不沿用上一次送出去的)',
    why: '省掉 holding 分支、直接 twContentState:hold 住的「誤點 3 分」會被翻成「沒有資訊」,\n'
       + '     主角時刻在 18:35↔18:32 之間跳——正是 hold 要防的事。',
    from: `      const state = holding
        ? { ...twContentState(delay, delay.dataAt, now), ...prev, pushed: true, tick: now }
        : twContentState(delay, delay.dataAt, now);`,
    to: `      const state = twContentState(delay, delay.dataAt, now);`,
    expect: ['R8b'],
  },
  {
    id: 'W16 推播沒帶 tick',
    why: '忘了把 now 傳進去:行駛段相鄰兩發在 TDX 沒更新的那分鐘逐字相同,系統不保證重畫。',
    from: `        : twContentState(delay, delay.dataAt, now);`,
    to: `        : twContentState(delay, delay.dataAt);`,
    expect: ['R3', 'R3b'],
  },
  {
    id: 'W17 bind 收了 prevDepSec 卻沒寫進 D1',
    why: '驗了格式、忘了綁參數:新版 App 開的卡全部退回改版前的行為,而且沒有任何錯誤訊息。',
    from: `.bind(String(b.token), station, trainNo, schedSec, prevDepSec, endAt, now, endAt + 300)`,
    to: `.bind(String(b.token), station, trainNo, schedSec, null, endAt, now, endAt + 300)`,
    expect: ['H6'],
  },
  {
    id: 'W18 換綁時不更新 prev_dep_sec',
    why: 'ON CONFLICT 那串欄位最容易漏一個:新車會拿舊車的上一站時段每分鐘推。',
    from: `      ' prev_dep_sec=excluded.prev_dep_sec,' +
`,
    to: ``,
    expect: ['H3e'],
  },
  {
    id: 'W19 上一站下限綁在 3.5 小時追蹤上限',
    why: '「反正追蹤最多 3.5 小時」——但時刻表裡有站間將近六小時的班次(6022 次臺南→南港),\n'
       + '     整張卡會 400、連誤點都收不到。',
    from: `p < schedSec - TW_PREV_DEP_MAX_GAP_SEC`,
    to: `p < schedSec - TW_MAX_TRACK_SEC`,
    expect: ['H6b'],
  },
  {
    id: 'W20 壞的 prevDepSec 默默當成沒送',
    why: '「選填欄位壞了就忽略」很常見;但卡片會以為接上了行駛中推播而畫車,車卻只在誤點變了才動。',
    from: `      return jsonRes({ error: 'bad_prev' }, 400, 'no-store');
    }
    prevDepSec = p;`,
    to: `    } else {
      prevDepSec = p;
    }`,
    expect: ['H2'],
  },
  // ── 2026-09-23 半分鐘那一輪(使用者裁示「那就改30秒吧」)────────────────────────────
  {
    id: 'W21 cron 沒接上半分鐘版本(仍直接呼叫 traWaitPushAll)',
    why: '包裝寫好了、測試也綠,但 scheduled 忘了改——正式站照舊每分鐘一發。',
    from: `      const twTask = traWaitPushWithHalf(env, ctx, 'https://railisland.tw').catch(e => {`,
    to: `      const twTask = traWaitPushAll(env, ctx, 'https://railisland.tw').catch(e => {`,
    expect: ['S0'],
  },
  {
    id: 'W22 第二輪重新拿 tra-live',
    why: '「第二輪就是再跑一次迴圈」最自然——但那等於每分鐘多打一次上游(TDX 點數)。',
    from: `  const live = half ? half.live : await traWaitLive(env, ctx, baseUrl);`,
    to: `  const live = await traWaitLive(env, ctx, baseUrl);`,
    expect: ['S3'],
  },
  {
    id: 'W23 第二輪也收卡',
    why: '收卡提早 30 秒看起來無害,但收卡推播、刪列、end 的欄位形狀都是每分鐘那一輪的契約。',
    from: `        if (half) { unchanged++; continue; }   // 收卡留給每分鐘那一輪(最多晚 30 秒,與改版前相同)
        // 形狀以現算的為準`,
    to: `        // 形狀以現算的為準`,
    expect: ['S5'],
  },
  {
    id: 'W24 第二輪的 APNs 失敗也記失敗次數',
    why: '沿用第一輪的失敗處理:熔斷的「連續失敗輪數」以兩倍速到頂,永久失敗半分鐘就刪列。',
    from: `      if (half) {
        console.error(\`[cron \${tag}] APNs 非 2xx(不記失敗次數,留給每分鐘那一輪): status=\${r.status} reason=\${r.reason || '(無法解析)'} env=\${r.envName} token=\${String(row.token).slice(0, 8)}…\`);
        continue;
      }
      const failStreak = (Number(row.fail_streak) || 0) + 1;
      await env.DELAY_DB.prepare('UPDATE tra_wait_bindings SET fail_streak=? WHERE token=?')`,
    to: `      const failStreak = (Number(row.fail_streak) || 0) + 1;
      await env.DELAY_DB.prepare('UPDATE tra_wait_bindings SET fail_streak=? WHERE token=?')`,
    expect: ['S6b'],
  },
  {
    id: 'W25 第二輪也推從沒推過的列',
    why: '兩輪之間才開的卡,第一發該用最新的資料(下一分鐘第一輪),不是 30 秒前那一份。',
    from: `      if (half && !prev) { unchanged++; continue; }
      const delay = twDelayFor(live, row.train_no, now);`,
    to: `      const delay = twDelayFor(live, row.train_no, now);`,
    expect: ['S7'],
  },
  {
    id: 'W26 第二輪不限行駛段(內容變了也推)',
    why: '第二輪的職責只有挪車;內容變化的推播與失敗重試都是每分鐘一次的事。',
    from: `      if (half && !runDue) { unchanged++; continue; }
`,
    to: ``,
    expect: ['S10b'],
  },
  {
    id: 'W27 包裝沒有睡到 +30 秒就跑第二輪',
    why: '少了那一行等待,第二輪緊接著第一輪跑,間隔 0 秒一發都推不出去。',
    from: `  if (used < WAIT_HALF_TICK_MS) await sleep(WAIT_HALF_TICK_MS - used);`,
    to: ``,
    expect: ['S1', 'S3c'],
  },
  {
    id: 'W28 第一輪跑太久也照跑第二輪',
    why: '沒有上限時,第二輪會跟下一分鐘的 cron 擠在一起。',
    from: `  if (used > WAIT_HALF_TICK_LATEST_MS) {`,
    to: `  if (false) {`,
    expect: ['S9', 'S9b'],
  },
];

function runVerify() {
  try {
    execFileSync(process.execPath, [VERIFY], { encoding: 'utf8', stdio: 'pipe' });
    return [];
  } catch (e) {
    const out = String((e.stdout || '') + (e.stderr || ''));
    // 🔴 只取【代號】那一段:判準名稱後面常常緊接著中文說明而沒有空白(例:
    //    「FAIL C6(精度)誤點未知 ⇒ …」),用 \S+ 會抓成 `C6(精度)誤點未知`,
    //    於是預期的 C6 永遠對不上 ⇒ 有牙的判準被誤判成沒抓到。
    return [...out.matchAll(/^FAIL ([A-Z]+[0-9]+[a-z]*)/gm)].map(m => m[1]);
  }
}

// 控制組:沒突變的時候必須全綠。少了這一條,「每一發都轉紅」有可能只是判準本來就是紅的。
const baseline = runVerify();
if (baseline.length) {
  console.error(`控制組就不是全綠(${baseline.join(',')})——先修好判準再跑突變。`);
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
  const red = runVerify();
  writeFileSync(TARGET, original);

  const got = new Set(red);
  const missing = m.expect.filter(x => !got.has(x));
  const extra = red.filter(x => !m.expect.includes(x));
  const pass = missing.length === 0 && red.length > 0;
  if (!pass) bad++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${m.id}`);
  console.log(`     預期轉紅 ${m.expect.join(',')}｜實際轉紅 ${red.length ? red.join(',') : '(全綠=判準沒牙)'}`);
  if (missing.length) console.log(`     🔴 沒被抓到:${missing.join(',')}`);
  if (extra.length) console.log(`     (另外連帶轉紅:${extra.join(',')})`);
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
