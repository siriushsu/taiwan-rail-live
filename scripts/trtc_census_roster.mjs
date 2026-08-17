// 逐車名冊（census roster）：名冊來源＝官方逐車清單，站牌倒數只負責時刻與位置。
//
// 2026-08-17 使用者裁示「可以動手」後改的架構。原本的名冊由站牌倒數列反推「有幾台車、
// 哪一台是哪一台」，而站牌逐輪只提到一部分車（實測 67 個車號 vs 逐車清單 76 台），
// 於是「認不出車號」被升級成「位置不確定」：綁定器配錯班 ⇒ shift≈k×班距 ⇒ 疊車與倒退。
//
// 逐車清單本身就帶穩定身分，不需要任何綁定：
//   no   高運量＝真車次；文湖線＝車廂組編號（穩定的車體身分，但不可當車次顯示）
//   stn  帶線別前綴的站碼（BL17／G11／O20／R22／BR18）⇒ 經 codeMap 直接得到線與站序
//   dir  方向。⚠ 折返時會落後：實測 66 筆有 path 的樣本中 3 筆的 dir 仍指著舊方向，
//        3 筆全是剛到終點站掉頭的車。所以方向一律優先從 path 推，dir 只在沒有 path 時當退路。
//   at   CarWeight 的時戳，實測落後 96–265 秒 ⇒ 只能當粗錨點
//   dest/path  來自 TrackInfo（實測資料齡約 25 秒）⇒ 時刻與精細位置用這個
//
// 契約：這支只回報「官方說現在有哪些車、各在哪裡」。它不生車、不刪車、不猜身分；
// 認不出車次就把 officialNo 留空（使用者裁示：認不出來留白，絕不因此不畫車）。
const norm = s => String(s == null ? '' : s).trim().replace(/站$/, '');

function lineIndexNames(model) {
  const out = new Map();
  for (const [id, line] of model.lines) out.set(id, (line.stations || []).map(s => norm(s.name)));
  return out;
}

// 站碼 → 候選 {line, i}。分支點（R22 同時是 R 的第 20 站與 R_XBT 的第 0 站）會有多筆，
// 用「下一站／終點站在哪一條線上找得到」來決定，不用車號猜——車號猜正是舊綁定器的迴圈來源。
function resolveStation(model, names, stn, nextName, destName) {
  const rec = model.codeMap && model.codeMap.get(String(stn));
  const on = (rec && rec.on) || [];
  if (!on.length) return null;
  if (on.length === 1) return { line: on[0].line, i: on[0].i, ambiguous: false };
  const next = norm(nextName), dest = norm(destName);
  const scored = on.map(c => {
    const arr = names.get(c.line) || [];
    const nextIdx = next ? arr.indexOf(next) : -1;
    const destIdx = dest ? arr.indexOf(dest) : -1;
    let score = 0;
    if (nextIdx >= 0) score += 2 + (Math.abs(nextIdx - c.i) <= 2 ? 2 : 0);
    if (destIdx >= 0 && destIdx !== c.i) score += 1;
    return { ...c, score };
  }).sort((a, b) => b.score - a.score);
  if (!scored[0].score) return null;                       // 全部對不上：不猜，交給呼叫端記為 dropped
  // 平手不一定等於歧義。中和新蘆線共線段（南勢角↔大橋頭）在模型裡被拆成蘆洲、新莊兩條線，
  // 那一段站序完全相同 ⇒ 必然平手，實測每輪 5 台南下車因此整台不畫。共線段是同一條實體
  // 軌道：只要「從這裡到終點」的站序兩邊相同，選哪條畫出來都一樣，這不是猜。真的分岔才叫歧義。
  if (scored[1] && scored[1].score === scored[0].score) {
    const tied = scored.filter(c => c.score === scored[0].score);
    const routeOf = c => {
      const arr = names.get(c.line) || [];
      const di = dest ? arr.indexOf(dest) : -1;
      if (di < 0) return null;                             // 終點不在這條線上：無從比對，維持歧義
      return (di >= c.i ? arr.slice(c.i, di + 1) : arr.slice(di, c.i + 1).reverse()).join('>');
    };
    const routes = tied.map(routeOf);
    if (routes.some(r => r == null) || routes.some(r => r !== routes[0])) return null;
    const pick = tied.slice().sort((a, b) => String(a.line) < String(b.line) ? -1 : 1)[0];
    return { line: pick.line, i: pick.i, ambiguous: true };
  }
  return { line: scored[0].line, i: scored[0].i, ambiguous: true };
}

function runSec(line, from, to) {
  const v = line.runs && line.runs.get(`${from}>${to}`);
  return Number(v) > 0 ? Number(v) : null;
}

// path 是「前方各站的到站時刻」。把它攤成逐段 timeline：第一段的起站是 to 的前一站，
// 之後每一段接續。ETA 全部照抄官方，不做任何平滑或校正（使用者裁示：官方的值照抄字面）。
function timelineFromPath(line, names, arr, startFrom, path, dirStep) {
  const out = [];
  let from = startFrom;
  for (const p of path) {
    const to = arr.indexOf(norm(p.name));
    if (to < 0 || to === from) continue;
    if (Math.sign(to - from) !== dirStep) break;           // 官方 path 偶爾夾雜反向列，遇到就停
    const arrEpoch = Number(p.eta);
    if (!Number.isFinite(arrEpoch)) break;
    const run = runSec(line, from, to);
    out.push({ from, to, depEpoch: run ? arrEpoch - run : arrEpoch, arrEpoch, terminal: false });
    from = to;
  }
  return out;
}

export function buildCensusRoster({ model, trains, nowEpoch, day, prior = null, maxStaleSec = 900 }) {
  const names = lineIndexNames(model);
  const vehicles = [];
  const diag = { input: 0, built: 0, noCode: 0, unresolved: 0, noPath: 0, stale: 0,
    dirFromPath: 0, dirFromField: 0, dirFieldDisagreed: 0, duplicates: 0, held: 0, byLine: {} };
  const seen = new Set();
  // 上一輪的位置。兩個位置來源的新鮮度差很多——CarWeight 的 stn 實測落後 96–265 秒，
  // TrackInfo 的 path 只落後約 25 秒——所以同一台車在「這輪有 path／下輪沒有」之間切換時，
  // 位置會在兩個來源之間跳，往回跳就是使用者看到的倒退。這裡只允許前進：
  // 算出來的位置若落在上一輪後面，就維持上一輪（hold），等官方資料自己追上。
  const priorById = new Map((prior || []).map(v => [v.vehicleId, v]));

  for (const t of trains || []) {
    diag.input++;
    const no = String((t && t.no) || '').trim();
    const sys = t && t.sys === 'br' ? 'br' : 'hw';
    if (!no) { diag.unresolved++; continue; }
    // at 太舊表示這台車的逐車回報已經斷了很久。這不是「資料齡退場」——名冊仍以官方清單為準，
    // 只是這一筆連粗位置都不可信，畫出來會是亂跳的車，所以整筆略過（下一輪它回來就回來）。
    const at = Number(t.at);
    if (Number.isFinite(at) && nowEpoch - at > maxStaleSec) { diag.stale++; continue; }

    // path 的前幾筆常常已是過去式：官方對「列車進站」給的倒數是 0，換算出的 eta 等於這份
    // payload 的時戳，下一輪就過期了。照抄第一筆會讓車卡在那一站、前後班疊在同一點上。
    const rawPath = Array.isArray(t.path) ? t.path : [];
    let pi = 0;
    while (pi < rawPath.length && Number(rawPath[pi].eta) <= nowEpoch) pi++;
    const path = rawPath.slice(pi);
    const hit = resolveStation(model, names, t.stn, path[0] && path[0].name, t.dest);
    if (!hit) { (model.codeMap && model.codeMap.get(String(t.stn))) ? diag.unresolved++ : diag.noCode++; continue; }
    const line = model.lines.get(hit.line);
    const arr = names.get(hit.line) || [];
    if (!line || !arr.length) { diag.unresolved++; continue; }

    // 方向：有 path 就從 path 推（折返時 dir 欄位會落後，實測 3/66）
    let dirStep = null;
    if (path.length) {
      const nextIdx = arr.indexOf(norm(path[0].name));
      if (nextIdx >= 0 && nextIdx !== hit.i) {
        dirStep = Math.sign(nextIdx - hit.i);
        diag.dirFromPath++;
        const fieldStep = Number(t.dir) === 1 ? -1 : 1;
        if (fieldStep !== dirStep) diag.dirFieldDisagreed++;
      }
    }
    if (dirStep == null) {
      if (Number(t.dir) !== 1 && Number(t.dir) !== 2) { diag.unresolved++; continue; }
      dirStep = Number(t.dir) === 1 ? -1 : 1;               // 實測 63/66 筆成立的慣例
      diag.dirFromField++;
      diag.noPath++;
    }

    // to 取官方 path 的第一站（新鮮）；from 取它的前一站。CarWeight 的 stn 較舊，
    // 只有在沒有 path 時才拿來當 from。
    let from, to;
    if (path.length && arr.indexOf(norm(path[0].name)) >= 0 && arr.indexOf(norm(path[0].name)) !== hit.i) {
      to = arr.indexOf(norm(path[0].name));
      from = to - dirStep;
    } else {
      from = hit.i;
      to = hit.i + dirStep;
    }
    if (from < 0 || to < 0 || from >= arr.length || to >= arr.length) {
      // 已在端點且方向指向線外：這是停在終點站的車，畫在終點站本身
      from = to = Math.max(0, Math.min(arr.length - 1, hit.i));
    }

    let terminal = from === to;
    let run = terminal ? 0 : (runSec(line, from, to) || 90);
    const firstEta = path.length ? Number(path[0].eta) : NaN;
    // 沒有未來 ETA 時只能用 CarWeight 的 at 推，而它落後最多 265 秒 ⇒ 常常算出過去的到站時刻，
    // 繪製端對那種車回 null＝整台不見（實測 10 台）。官方說車在就要畫 ⇒ 過期夾到現在。
    // 🔴 過期的到站時刻不可夾到現在：續推從到站時刻起算停站，夾了就等於每輪重設成
    // 「剛到站」⇒ 車永遠停著（實測文湖線 22/24 台凍結）。
    const arrEpoch = Number.isFinite(firstEta) && !terminal ? firstEta
      : (Number.isFinite(at) ? at + run : nowEpoch + run);
    // 官方沒給終點（文湖線全部、高運量約一成）就用行進方向上的線末站。
    // 不可留 null——前端名冊驗證要求 dest 是合法站序整數，null 會讓整包被判 malformed。
    const destIdx = (() => {
      const i = arr.indexOf(norm(t.dest));
      return i >= 0 ? i : (dirStep > 0 ? arr.length - 1 : 0);
    })();

    // 已經開到終點站：繪製端的契約是「到 dest 就收車」，但官方逐車清單仍說這台車在——
    // 它只是停在終點站等折返。標成「停在終點站」而不是讓它整台消失。
    if (!terminal && to === destIdx && arrEpoch <= nowEpoch + 1) { from = to; terminal = true; run = 0; }
    // 停在端點的車方向必須指向線內：端點繪製會算 next = from + step，指向線外就得到不存在的站
    // 而整台回 null（實測 6 台停在終點站的車就是這樣不見的）。
    const dirOut = terminal
      ? (from <= 0 ? 2 : (from >= arr.length - 1 ? 1 : (dirStep > 0 ? 2 : 1)))
      : (dirStep > 0 ? 2 : 1);

    const timeline = terminal
      ? [{ from, to, depEpoch: arrEpoch, arrEpoch, terminal: true }]
      : (path.length ? timelineFromPath(line, names, arr, from, path, dirStep) : []);
    if (!timeline.length) timeline.push({ from, to, depEpoch: arrEpoch - run, arrEpoch, terminal });

    // 身分＝官方給的那個編號本身，跨輪穩定，不需要任何綁定或推論。
    const vehicleId = `cs:${day}:${sys}:${no}`;
    if (seen.has(vehicleId)) { diag.duplicates++; continue; }
    seen.add(vehicleId);

    // 只准前進：同一台車、同一條線、同一個方向時，位置不得落到上一輪後面。
    // 折返（dir 改變）與換線是合法的，不套這條。
    const prev = priorById.get(vehicleId);
    if (prev && prev.line === hit.line && prev.dir === dirOut &&
        !prev.terminal && !terminal && (to - prev.to) * dirStep < 0) {
      from = prev.from; to = prev.to; diag.held++;
      vehicles.push({ ...prev, run: prev.run, arrEpoch: Math.max(prev.arrEpoch, nowEpoch),
        source: 'census-hold', censusEpoch: Number.isFinite(at) ? at : null, observedEpoch: nowEpoch });
      diag.built++;
      diag.byLine[hit.line] = (diag.byLine[hit.line] || 0) + 1;
      continue;
    }

    vehicles.push({
      vehicleId, line: hit.line, dir: dirOut,
      dest: destIdx, from, to, run, arrEpoch, terminal,
      // 文湖線的 no 是車廂組編號不是車次，不可當車次顯示 ⇒ 留白（使用者裁示允許）
      officialNo: sys === 'hw' ? no : null,
      source: 'census', censusEpoch: Number.isFinite(at) ? at : null,
      observedEpoch: nowEpoch, timeline,
    });
    diag.built++;
    diag.byLine[hit.line] = (diag.byLine[hit.line] || 0) + 1;
  }

  return { vehicles, diagnostics: diag };
}
