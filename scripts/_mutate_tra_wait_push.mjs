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
    from: `      const nextEnd = twNextEndAt(eta, row.end_at, row.bound_at);
      if (nextEnd != null) {
        await env.DELAY_DB.prepare('UPDATE tra_wait_bindings SET end_at=?, expire_at=? WHERE token=?')
          .bind(nextEnd, nextEnd + 300, row.token).run();
        extended++;
      }`,
    to: `      const nextEnd = twNextEndAt(eta, row.end_at, row.bound_at);`,
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
    from: `      ' station=excluded.station, train_no=excluded.train_no, sched_sec=excluded.sched_sec,' +
      ' end_at=excluded.end_at, last_state=NULL, fail_streak=0,' +
      ' bound_at=excluded.bound_at, expire_at=excluded.expire_at'`,
    to: `      ' station=excluded.station, train_no=excluded.train_no, sched_sec=excluded.sched_sec,' +
      ' end_at=excluded.end_at, expire_at=excluded.expire_at'`,
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
    from: `  await env.DELAY_DB.prepare('DELETE FROM tra_wait_bindings WHERE expire_at < ?').bind(now).run();`,
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
