// 台鐵等站卡純邏輯(scripts/tra_wait_core.mjs)的判準。
//
// 判準獨立性(心得 29):期望值一律寫字面量,或用【與實作不同的算式】獨立算出來。
// 絕不呼叫受測模組自己的函式去產生期望——那會退化成「驗證這支函式跟自己一致」。
// 例:twEtaSec 的期望不寫 sched + delay*60(那是實作本人),而是把時刻換成 HH:MM 字串比對,
// 走的是完全不同的一條路(Date 格式化 vs 純算術)。
//
// 跑法:node scripts/verify_tra_wait_core.mjs
// 突變:bash scripts/_mutate_tra_wait_core.sh  (七發,各自預期打紅哪幾條;跑完自動還原並比 md5)
import {
  twLiveDataAt, twDelayFor, twEtaSec, twContentState, twShouldPush, twShouldEnd, twNextEndAt,
  TW_DELAY_MAX_AGE_SEC, TW_ARRIVED_GRACE_SEC, TW_END_PAD_SEC, TW_MAX_TRACK_SEC, TW_DATA_AT_EPS_SEC,
} from './tra_wait_core.mjs';

const results = [];
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };

// 台北時間的 HH:MM。用來替 twEtaSec 做獨立驗算——它走 Intl 而不是算術,
// 與受測實作沒有共用任何一行程式。
const hhmm = sec => new Intl.DateTimeFormat('zh-Hant-TW', {
  timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(sec * 1000));

// 2026-08-22 18:32:00 +08:00 的 epoch 秒。字面量,不由受測碼推導。
const SCHED = Math.round(Date.parse('2026-08-22T18:32:00+08:00') / 1000);
const NOW = SCHED - 20 * 60;                         // 開卡當下：表訂前 20 分鐘
const AT_ISO = '2026-08-22T18:11:30+08:00';
const AT_SEC = Math.round(Date.parse(AT_ISO) / 1000);
const live = (trains, at = AT_ISO) => ({ at, srv: NOW * 1000, trains });

// ── A 誤點取值:「查不到」與「準點」是兩件事 ───────────────────────────────
{
  const l = live([{ no: '123', delay: 3, sta: '1000', status: 1 },
                  { no: '456', delay: 0, sta: '1010', status: 1 }]);
  const a = twDelayFor(l, '123', NOW);
  ok('A1 查得到就照抄官方誤點', a.known === true && a.delayMin === 3, JSON.stringify(a));
  // 🔴 正向對照:delay=0 必須是 known=true / delayMin=0(準點),不可以被當成「查不到」。
  const b = twDelayFor(l, '456', NOW);
  ok('A1r 準點(0 分)是 known=true 且 delayMin=0', b.known === true && b.delayMin === 0, JSON.stringify(b));
  // 🔴 這條是全檔最重要的一條:不在官方動態窗裡的車(TDX 只給前後 30 分鐘)不可以變成準點。
  const c = twDelayFor(l, '789', NOW);
  ok('A2 不在清單裡 ⇒ known=false 且 delayMin=null(絕不等於準點)',
    c.known === false && c.delayMin === null, JSON.stringify(c));
  ok('A3 車次比對是字串等值(不做前綴/數值寬鬆比對)',
    twDelayFor(l, '12', NOW).known === false && twDelayFor(l, '0123', NOW).known === false);
  ok('A4 車次空字串 ⇒ known=false', twDelayFor(l, '', NOW).known === false && twDelayFor(l, null, NOW).known === false);
  // 官方值照抄字面(使用者長期裁示):負值不夾正。
  const neg = twDelayFor(live([{ no: '123', delay: -2 }]), '123', NOW);
  ok('A5 負誤點照抄不夾正', neg.known === true && neg.delayMin === -2, JSON.stringify(neg));
  // 🔴 A6/A6r 是【呼叫端能不能分辨兩種 known=false】的唯一依據。少了它,worker 只能自己
  //    再算一次資料齡(門檻存兩份必漂),或把兩種一視同仁(南迴那種站間長跑會讓主角時刻
  //    在 18:35↔18:32 之間跳)。兩條要一起看:一條證明有標記,另一條證明標記不是恆真。
  ok('A6 看板新鮮但查無此車 ⇒ fresh=true(呼叫端據此 hold,不翻成無資訊)',
    c.fresh === true && c.known === false, JSON.stringify(c));
  ok('A6r 查得到的那一筆也是 fresh=true', a.fresh === true);
  // 🔴 A7:同一車次兩筆是【實測到的上游形狀】,不是假想。取樣自 2026-08-22 23:15 的
  //    /api/tra-live:3782 兩筆(誤點 5、6),23:17 那份 288 也兩筆(0、1)。
  //    期望值 6 是照【前端看板的規則】獨立推出來的(Map.set 後蓋前 ⇒ 最後一筆),
  //    不是照實作推的——判準與實作不同源(心得 29)。
  const dup = twDelayFor(live([{ no: '3782', delay: 5, sta: '4190', status: 2 },
                               { no: '3782', delay: 6, sta: '4190', status: 2 }]), '3782', NOW);
  ok('A7 同一車次多筆 ⇒ 取最後一筆(與看板 Map.set 後蓋前同規則)',
    dup.known === true && dup.delayMin === 6, JSON.stringify(dup));
}

// ── B 資料齡:太舊就當作沒有即時資訊(不是當作準點) ──────────────────────
{
  const trains = [{ no: '123', delay: 3 }];
  // 期望邊界獨立寫死 1800(＝前端 liveActive 的 1800e3),不引用常數本身當期望。
  ok('B0 齡上限就是前端 liveActive 的 30 分鐘', TW_DELAY_MAX_AGE_SEC === 1800, String(TW_DELAY_MAX_AGE_SEC));
  const justOk = twDelayFor(live(trains), '123', AT_SEC + 1800);
  ok('B1 齡恰好 1800 秒仍然採用(邊界含)', justOk.known === true && justOk.delayMin === 3, JSON.stringify(justOk));
  const tooOld = twDelayFor(live(trains), '123', AT_SEC + 1801);
  ok('B2 齡 1801 秒 ⇒ known=false(車明明在清單裡也一樣)',
    tooOld.known === false && tooOld.delayMin === null, JSON.stringify(tooOld));
  ok('B3 解不出資料時刻 ⇒ known=false 且 dataAt=null',
    twDelayFor(live(trains, 'not-a-date'), '123', NOW).known === false
    && twLiveDataAt({ at: 'not-a-date' }) === null);
  ok('B4 上游時刻比我方快幾秒【不】當成壞資料(未來側刻意無門檻)',
    twDelayFor(live(trains), '123', AT_SEC - 30).known === true);
  ok('B5 dataAt 取上游 UpdateTime,不是我方 now', twDelayFor(live(trains), '123', NOW).dataAt === AT_SEC);
  // 🔴 B6 是 A6 的反面:資料過舊那一種 known=false 必須 fresh=false,呼叫端才會把卡片
  //    翻成「目前無即時誤點資訊」而不是無限期沿用一個 30 分鐘前的誤點。
  ok('B6 齡 1801 秒 ⇒ fresh=false(與「查無此車」分得開)', tooOld.fresh === false, JSON.stringify(tooOld));
  ok('B6r 解不出資料時刻也是 fresh=false', twDelayFor(live(trains, 'not-a-date'), '123', NOW).fresh === false);
}

// ── C 實際約到站 = 表訂 + 誤點 ────────────────────────────────────────────
{
  // 獨立驗算:用時鐘字串比對,而不是重寫一次 sched + delay*60。
  ok('C1 表訂 18:32 誤點 3 分 ⇒ 18:35', hhmm(twEtaSec(SCHED, 3)) === '18:35', hhmm(twEtaSec(SCHED, 3)));
  ok('C1r 準點 ⇒ 就是表訂 18:32', hhmm(twEtaSec(SCHED, 0)) === '18:32', hhmm(twEtaSec(SCHED, 0)));
  ok('C2 誤點未知(null) ⇒ 退回表訂本人,不憑空加減', twEtaSec(SCHED, null) === SCHED);
  ok('C3 誤點 45 分跨過整點也對', hhmm(twEtaSec(SCHED, 45)) === '19:17', hhmm(twEtaSec(SCHED, 45)));
  ok('C4 表訂壞值 ⇒ null(不回 NaN 讓它一路漏到卡片上)', twEtaSec(undefined, 3) === null && twEtaSec('x', 3) === null);
  // 🔴 null 與空字串要單獨列一條:Number(null)===0、Number('')===0 都是【合法有限數】,
  //    只測 undefined/'x' 的話,把 num() 換回 Number() 這支腳本會全綠(第一版就是這樣漏的)。
  ok('C4r 表訂為 null/空字串也要回 null(Number(null) 是 0 不是 NaN)',
    twEtaSec(null, 3) === null && twEtaSec('', 3) === null);
}

// ── D ContentState 的跨行程契約 ───────────────────────────────────────────
{
  const st = twContentState({ delayMin: 3, known: true }, AT_SEC);
  const keys = Object.keys(st).sort().join(',');
  // 🔴 具名覆蓋率斷言:欄位集合是跨行程契約,少送一個 key 在 App 端就是那一欄變 nil。
  //    比對【整組】而不是逐個 includes——後者對「多送了一欄」完全無感。
  ok('D1 欄位集合恰為 delayMin,dataAt,notice,pushed', keys === 'dataAt,delayMin,notice,pushed', keys);
  ok('D2 值照抄', st.delayMin === 3 && st.dataAt === AT_SEC && st.notice === null && st.pushed === true, JSON.stringify(st));
  const unknown = twContentState({ delayMin: null, known: false }, AT_SEC);
  ok('D3 誤點未知 ⇒ delayMin=null(而不是 0)', unknown.delayMin === null && Object.keys(unknown).length === 4);
  // 🔴 反向對照:known=false 但 delayMin 帶著髒值時,也必須被清成 null——
  //    否則「上游掛掉沿用舊值」會靜靜地把一個過期的誤點畫到卡片上。
  ok('D3r known=false 時就算帶了值也要清成 null', twContentState({ delayMin: 9, known: false }, AT_SEC).delayMin === null);
  ok('D4 資料時刻壞值 ⇒ dataAt=null', twContentState({ delayMin: 0, known: true }, 'x').dataAt === null);
}

// ── E 推播遲滯 ────────────────────────────────────────────────────────────
{
  const base = { delayMin: 3, dataAt: AT_SEC, notice: null, pushed: true };
  ok('E1 沒推過就一定要推', twShouldPush(null, base) === true);
  ok('E2 誤點變了要推', twShouldPush(base, { ...base, delayMin: 5 }) === true);
  // 🔴 這兩條是 A2 的下游:0 與 null 若在比較時被 == 併起來,「從準點變成沒有資訊」
  //    (上游掛掉)就永遠不會推,卡片會一直宣稱準點。
  ok('E2a 準點→未知 要推', twShouldPush({ ...base, delayMin: 0 }, { ...base, delayMin: null }) === true);
  ok('E2b 未知→準點 要推', twShouldPush({ ...base, delayMin: null }, { ...base, delayMin: 0 }) === true);
  ok('E3 什麼都沒變就不推', twShouldPush(base, { ...base }) === false);
  ok('E4 更新時刻漂 599 秒不值得單獨推一發',
    twShouldPush(base, { ...base, dataAt: AT_SEC + 599 }) === false);
  ok('E4r 漂 600 秒就要推(卡片印的「HH:mm 更新」不可以越來越假)',
    twShouldPush(base, { ...base, dataAt: AT_SEC + 600 }) === true, `eps=${TW_DATA_AT_EPS_SEC}`);
  ok('E5 notice 變了要推', twShouldPush(base, { ...base, notice: '路線異常' }) === true);
}

// ── F 收卡 ────────────────────────────────────────────────────────────────
{
  const eta = twEtaSec(SCHED, 3);          // 18:35
  const endAt = eta + 1800;
  ok('F0 到站寬限 3 分鐘', TW_ARRIVED_GRACE_SEC === 180, String(TW_ARRIVED_GRACE_SEC));
  ok('F1 還沒到站 ⇒ 不收', twShouldEnd(eta - 60, eta, endAt) === null);
  ok('F2 剛到站(寬限內)⇒ 不收', twShouldEnd(eta + 179, eta, endAt) === null);
  ok('F3 到站 +180 秒 ⇒ arrived', twShouldEnd(eta + 180, eta, endAt) === 'arrived');
  ok('F4 硬上限到 ⇒ endAt', twShouldEnd(endAt, null, endAt) === 'endAt');
  // 🔴 缺訊只 hold:算不出實際到站(誤點未知也算得出來,這裡指表訂本身壞掉)時,
  //    絕不可以順手收卡——卡片在使用者還要等車的時候憑空消失是最糟的失敗形態。
  ok('F5 算不出到站時刻且未到硬上限 ⇒ 不收', twShouldEnd(eta, null, endAt) === null);
}

// ── G end_at 隨誤點往後延 ────────────────────────────────────────────────
{
  const boundAt = NOW;
  const eta0 = twEtaSec(SCHED, 3);
  const end0 = eta0 + 1800;
  ok('G0 緩衝 30 分、硬上限 3.5 小時', TW_END_PAD_SEC === 1800 && TW_MAX_TRACK_SEC === 12600,
    `${TW_END_PAD_SEC}/${TW_MAX_TRACK_SEC}`);
  ok('G1 誤點沒變 ⇒ 不必動', twNextEndAt(eta0, end0, boundAt) === null);
  const eta1 = twEtaSec(SCHED, 20);
  ok('G2 誤點變大 ⇒ 延到「實際到站 + 30 分」', twNextEndAt(eta1, end0, boundAt) === eta1 + 1800,
    String(twNextEndAt(eta1, end0, boundAt)));
  // 🔴 只准往後:誤點縮回來時不可以把 end_at 拉近(會提前收卡),也不可以每輪都改寫 D1。
  ok('G3 誤點縮回來 ⇒ 不縮短', twNextEndAt(twEtaSec(SCHED, 1), end0, boundAt) === null);
  // 封頂:表訂在 bound_at 之後 20 分,誤點 5 小時 ⇒ want 遠超上限,必須被夾在 bound_at+3.5h。
  const far = twNextEndAt(twEtaSec(SCHED, 300), end0, boundAt);
  ok('G4 延到超過 bound_at+3.5 小時要封頂', far === boundAt + 12600, String(far));
  ok('G5 封頂之後不再往上爬(回 null 而不是同一個值)',
    twNextEndAt(twEtaSec(SCHED, 400), boundAt + 12600, boundAt) === null);
}

const bad = results.filter(r => !r.p).length;
console.log(`\n總計 ${results.length} 項,FAIL ${bad}`);
process.exit(bad ? 1 : 0);
