// 台鐵等站卡推播鏈的純邏輯。獨立成檔的理由與 la_push_core.mjs／metro_wait_core.mjs 相同:
// 測試要能直接 import,而 worker.js 從 Node import 不可靠。
//
// 🔴 這一支與 metro_wait_core.mjs 是【兩件不同的事】,不要照著改:
//    捷運等車卡每分鐘都要重新挑「這一站的下一班是誰」;台鐵等站卡追的是【一班指定的車】,
//    表訂時刻在開卡當下就固定了,伺服器每分鐘只要把官方誤點分鐘 join 回來。
//
// 🔴 精度紅線(memory: tra-thsr-no-official-eta):台鐵官方【只有】表訂時刻與誤點分鐘,
//    沒有預估到站時刻。所以這裡算得出來的唯一東西是「表訂＋誤點」,而且:
//      · 誤點分鐘一律照抄官方原值,不平滑、不內插、不猜;
//      · 「查不到這班車」與「誤點 0 分」是兩件事——前者 delayMin=null(卡片明說沒有即時
//        資訊),後者 delayMin=0(準點)。把前者當成準點就是在宣稱一個官方沒說過的事實。

// 誤點資料齡上限。與前端 liveActive() 的 1800e3 同值(index.html:19024)——超過這個齡
// 就不再套用任何誤點,卡片退回「表訂＋目前無即時誤點資訊」。
// 🔴 不設未來側的門檻是刻意的:TDX 的 UpdateTime 比我們快幾秒是常態,而「上游時鐘比我們快」
//    並不會讓那份誤點變成假的。真正會出事的只有「資料太舊」這一側。
export const TW_DELAY_MAX_AGE_SEC = 1800;

// 到站後多久收卡。這班車在這一站的事情結束了,卡片就該走——留著只會變成一張永遠寫著
// 「18:35」的殭屍卡。3 分鐘是給「表訂＋誤點」這個估計值本身的誤差留餘裕。
export const TW_ARRIVED_GRACE_SEC = 180;

// end_at 相對「實際到站」的緩衝。誤點會讓實際到站一路往後,所以 end_at 也要跟著延
// (見 twNextEndAt);這個緩衝決定「車到了之後這一列還會在 D1 裡待多久」的上界。
export const TW_END_PAD_SEC = 1800;

// 從 bound_at 起算的追蹤硬上限。台鐵看板只列未來 3 小時,加上誤點的延長餘裕取 3.5 小時;
// 同時把「灌假 token 的列能活多久」鎖死在一個有界的值(同 metro_wait 的 MW_MAX_DURATION_SEC)。
export const TW_MAX_TRACK_SEC = Math.round(3.5 * 3600);

// 「更新時刻」的推播遲滯。卡片上會印「HH:mm 更新」,那個數字必須大致為真;但每分鐘推一發
// 只為了把分鐘數往前撥一格是純浪費(一小時 60 發 APNs,而使用者看不出差別)。
// 10 分鐘＝「使用者看到的『更新』時刻最多落後多久」與推播量之間的折衷。
// 🔴 這與 metro_wait 的作法【刻意不同】:那張卡的視圖根本不畫 dataAt,所以它把 dataAt
//    完全排除在比較之外;這張卡畫了,排除就等於印一個會越來越假的時刻。
// 🔴 2026-09-23 例外(使用者裁示「先改伺服器每分鐘推播」,同日再裁示「那就改30秒吧」):
//    等車卡 B 在軌道上畫了一台車,而即時動態的圖片不會自己走,只在收到推播時往前挪一格。
//    所以「車正在上一站→本站之間」那一段每 30 秒推一發(見 twRunWindow/twRunTickDue);
//    其他時段車是靜止的,仍照這條遲滯。
export const TW_DATA_AT_EPS_SEC = 600;

// 行駛段內兩發之間的最小間隔。
// 🔴 2026-09-23 使用者裁示「那就改30秒吧」:行駛段從每分鐘一發改成每 30 秒一發——cron 每分鐘
//    跑一次,同一次執行內在起跑 +30 秒再跑一輪只挪車的(worker.js waitCardHalfMinute)。
//    所以相鄰兩發的間隔是 30 秒(第一輪→第二輪,同一次執行內,固定)與 30±j 秒(第二輪→下一分鐘
//    第一輪,j＝cron 起跑時刻的抖動)。20 秒＝兩側各留 10 秒:
//      · 下一分鐘的 cron 早到 10 秒以內,仍推得出去(正式站 09-23 實測 4 筆 tick 全落在每分鐘
//        第 32 秒,j 不到 1 秒);
//      · 排程觸發是「至少一次」:同一分鐘重跑在 20 秒內的,不會把同一格再推一次。
//    改這個數之前先看 worker.js 的 WAIT_HALF_TICK_MS:間隔必須小於它,否則第二輪永遠推不出去。
export const TW_RUN_PUSH_GAP_SEC = 20;

// 🔴 嚴格數值轉換:不可以直接用 Number()——`Number(null)`、`Number('')` 都是 **0**(不是 NaN),
//    於是「算不出實際到站時刻」會被 `Number.isFinite` 判成合法的 0,再與 now 比大小就變成
//    「早就到站了」⇒ 卡片在使用者還在等車的時候被收掉。這一條是本檔第一版真的寫錯、
//    被 verify 的 F4/F5 當場抓到的形狀,不要改回去。
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// /api/tra-live 這一份回應的資料時刻(上游 TDX 的 UpdateTime),epoch 秒。
// 解不出來回 null——寧可當作「不知道多新」,也不可以拿我方的 now 冒充上游時刻。
export function twLiveDataAt(live) {
  const ms = Date.parse((live && live.at) || '');
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null;
}

// 取這一班車的官方誤點分鐘。回 { delayMin, known, dataAt, fresh }。
// known=false 有三種來源,卡片上一律寫「目前無即時誤點資訊」(不可寫成準點):
//   (a) 整份資料太舊(上游掛掉時 worker 會沿用舊 mem 回 200,那份 at 是舊的)
//   (b) 解不出資料時刻
//   (c) 這班車不在官方動態窗裡——TDX 的 TrainLiveBoard 只給「動態前後 30 分鐘的車次」,
//       所以還沒發車的車根本不會出現。前端 state.live.map 對【每一班在窗內的車】都會
//       set 一筆(含 delay=0),所以「在不在這份清單裡」本身就是有意義的訊號。
//
// 🔴 fresh 存在的唯一理由是把 (c) 與 (a)(b) 分開,而這兩者的正確處置【相反】:
//    · fresh 且找不到 ⇒ 這一份看板是新的,只是這班車這一刻沒有事件(南迴那種站間跑三十分鐘
//      的區段會整段掉出動態窗)。把卡片翻成「無即時誤點資訊」會讓主角時刻在 18:35 與 18:32
//      之間來回跳——呼叫端應該 hold,沿用上次推出去的內容。
//    · 不 fresh ⇒ 上游真的掛了/資料過舊。這時繼續宣稱「誤點 3 分」才是說謊,該翻成無資訊
//      (與前端 liveActive() 超過 30 分就不再套用誤點是同一條界線)。
//    ⚠️ 不可以在呼叫端自己拿 dataAt 重算一次新鮮度:門檻會在兩個地方各存一份,改一邊就漂。
export function twDelayFor(live, trainNo, nowSec) {
  const dataAt = twLiveDataAt(live);
  const stale = { delayMin: null, known: false, dataAt, fresh: false };
  if (dataAt == null) return stale;
  const now = num(nowSec);
  if (now == null || now - dataAt > TW_DELAY_MAX_AGE_SEC) return stale;
  const miss = { delayMin: null, known: false, dataAt, fresh: true };
  const key = String(trainNo == null ? '' : trainNo).trim();
  if (!key) return miss;
  // 🔴 同一個車次號在 trains[] 裡【真的會出現兩筆】,而且誤點值不一樣。
  //    2026-08-22 23:15/23:17 兩次取樣實測:3782 兩筆都是 sta=4190 status=2,誤點 5 與 6;
  //    23:17 那份連 288 也是(0 與 1)。上游 TrainLiveBoards 就是這樣給的,兩次取樣都在,
  //    不是瞬間抖動。
  //    前端地圖與這張卡片一律取【誤點較大】的那筆：上游陣列排序改變時不會因為
  //    「最後一筆」剛好較小，就把列車與卡片都向前推。兩處規則必須保持一致。
  let found = null;
  for (const t of Array.isArray(live && live.trains) ? live.trains : []) {
    if (String((t && t.no) == null ? '' : t.no) !== key) continue;
    const d = Number(t && t.delay);
    // 官方值照抄字面(使用者長期裁示):不夾正、不取絕對值。上游若真的給了負數,
    // 那是官方在說「早到」,由視圖決定怎麼講,不在這裡偷偷改掉。
    const candidate = { delayMin: Number.isFinite(d) ? Math.round(d) : 0, known: true, dataAt, fresh: true };
    if (!found || candidate.delayMin > found.delayMin) found = candidate;
  }
  return found || miss;
}

// 實際約到站 = 表訂 + 誤點。誤點未知時就是表訂本人(那是當下唯一有的官方值)。
// 🔴 這是全卡唯一的「算出來的」數字,而它的兩個輸入都是官方值 ⇒ 可以顯示。
//    再往下一層(把它換算成秒級倒數)就是在製造官方沒有的精度,絕不可以做。
export function twEtaSec(schedSec, delayMin) {
  const s = num(schedSec);
  if (s == null) return null;
  const d = num(delayMin);
  return Math.round(s + (d == null ? 0 : d) * 60);
}

// 組 ContentState。🔴 欄位集合是跨行程契約:每一個 key 都要送(值可以是 null),不可省略——
// 與 laPushAll／mwContentState 同一條規矩。欄位名對應 app/ios/App/App/TraWaitAttributes.swift。
// delayMin 的 null 與 0 是兩種不同的事實,不可合併(見 twDelayFor)。
export function twContentState(delay, dataAt, tickSec) {
  const known = !!(delay && delay.known);
  const raw = num(delay && delay.delayMin);
  const at = num(dataAt);
  const tick = num(tickSec);
  return {
    delayMin: known && raw != null ? Math.round(raw) : null,
    dataAt: at == null ? null : Math.round(at),
    notice: null,
    // 🔴 pushed:告訴視圖「這張卡有伺服器在餵」。消費點有二:到站後那句說明(零推播的卡
    //    必須老實說「不會自己更新誤點」),以及等車卡 B 要不要畫車(沒人餵的卡,車會停在
    //    開卡那一刻的位置騙人)。App 開卡時不送(nil=還不知道),伺服器每一發都送 true。
    pushed: true,
    // 🔴 tick:伺服器送出這一發的時刻(epoch 秒)。兩個用途:
    //    (1) 行駛段每 30 秒那一發,誤點與資料時刻常常一個字都沒變(TDX 兩分鐘才更新一次)——
    //        內容若與上一發完全相同,系統不保證會重畫,車就不會往前挪。這一欄保證每一發都不一樣。
    //    (2) 視圖畫車的時鐘【只准用它】,不准用 Date():系統會替同一份 ContentState 在不同時間
    //        各算一張快照(淺色／深色／切外觀),用 Date() 同一次更新的車會前後跳、甚至倒退
    //        (捷運等車卡 B 實測踩到,feat/metro-wait-track-b f7b144d3)。
    //    它【不是】倒數,也不進 twShouldPush 的比較(否則車靜止的時段也每一輪都推)。
    tick: tick == null ? null : Math.round(tick),
  };
}

// 這一輪算出來的內容,跟【上一次真的送出去的】比,值不值得再推一發。
// 🔴 比較基準是「上一次送出去的」而不是「上一輪算出來的」:理由同 mwShouldPush——
//    只跟上一輪比的話,慢慢漂移的量永遠碰不到門檻,就永遠推不出去。
export function twShouldPush(prev, next) {
  if (!prev) return true;
  const s = v => String(v == null ? '' : v);
  if (s(prev.delayMin) !== s(next.delayMin)) return true;
  if (s(prev.notice) !== s(next.notice)) return true;
  // 更新時刻只在漂超過門檻時才值得為它單獨推一發(見 TW_DATA_AT_EPS_SEC)。
  const pa = num(prev.dataAt), na = num(next.dataAt);
  if ((pa == null) !== (na == null)) return true;
  if (pa != null && Math.abs(na - pa) >= TW_DATA_AT_EPS_SEC) return true;
  return false;
}

// 這班車「從上一站開往本站」的時段 [from, to),epoch 秒。
//   from = 上一站表定發車 + 誤點;to = 本站表定到站 + 誤點(＝卡片主角「實際約」)。
// 回 null = 這一刻沒有行駛段可言,伺服器不必為了挪車推播:
//   · 沒有上一站(舊版 App 不送、或這一站就是起點站);
//   · 🔴 誤點未知(null)。車的位置只准用「表定＋官方誤點」推算——沒有官方誤點時照表定
//     畫一台在走的車,就是在宣稱這班車準點。視圖在同一條件下不畫車,兩邊必須一致。
//   · 上一站發車不早於本站到站(資料壞了;bind 端點已擋,這裡是第二道)。
export function twRunWindow(prevDepSec, schedSec, delayMin) {
  const p = num(prevDepSec), s = num(schedSec), d = num(delayMin);
  if (p == null || s == null || d == null || p >= s) return null;
  return { from: Math.round(p + d * 60), to: Math.round(s + d * 60) };
}

// 行駛段內這一輪要不要為了「車往前挪一格」推一發(與 twShouldPush 或起來用)。
// 🔴 只看行駛段:車還沒從上一站開出來時它是靜止的(卡片畫在上一站左邊的虛線上),
//    每 30 秒推一發只是把同一張圖再送一次;到站之後由 stale-date 翻成「車應已到」,也不必推。
// 間隔以【上一次真的送出去的】tick 為準(同 twShouldPush 的比較基準)。
export function twRunTickDue(prev, nowSec, win) {
  const now = num(nowSec);
  if (!win || now == null) return false;
  if (now < win.from || now >= win.to) return false;
  const last = num(prev && prev.tick);
  return last == null || now - last >= TW_RUN_PUSH_GAP_SEC;
}

// 該不該收卡。回 'arrived' / 'endAt' / null。
// 🔴 「挑不到誤點」【不是】收卡條件:上游抖動、資料過舊、車還沒進動態窗,三者在這裡長得
//    一模一樣,而把其中任何一種當成該收卡,都會讓卡片在使用者還在等車的時候憑空消失。
//    使用者裁示:缺訊只 hold。(同 metroWaitPushAll 的同一條註解。)
export function twShouldEnd(nowSec, etaSec, endAt) {
  const now = num(nowSec);
  if (now == null) return null;
  const eta = num(etaSec);
  if (eta != null && now >= eta + TW_ARRIVED_GRACE_SEC) return 'arrived';
  const end = num(endAt);
  if (end != null && now >= end) return 'endAt';
  return null;
}

// 誤點把實際到站往後推時,把 end_at 一起往後延。回新值,或 null=不必動。
// 🔴 只准往後延,永不縮短:誤點縮回來時把 end_at 拉近,會在使用者還在等車時提前收卡;
//    而且一伸一縮會讓這一列每輪都在寫 D1。
// 🔴 這條之所以合法,是因為卡片【不印】「追蹤至 HH:mm」——捷運等車卡那條
//    「endAt 只算一次、兩邊必須是同一個數」的鐵則,守的是「卡片印出來的承諾」;
//    這張卡沒有對使用者承諾這個數,所以伺服器可以自己延。
export function twNextEndAt(etaSec, curEndAt, boundAt) {
  const eta = num(etaSec), cur = num(curEndAt), bound = num(boundAt);
  if (eta == null || cur == null) return null;
  const want = Math.round(eta + TW_END_PAD_SEC);
  if (want <= cur) return null;
  const cap = bound == null ? want : bound + TW_MAX_TRACK_SEC;
  const next = Math.min(want, cap);
  return next > cur ? next : null;
}
