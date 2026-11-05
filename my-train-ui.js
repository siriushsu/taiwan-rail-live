// 自製列車：儲存、排班表單、自製車面板。透過 host 跟 index.html 溝通，比照 train-garage.js。
// 對應的純函式在 my-train-plan.js，接進網頁的部分在 index.html 的 ownTrain 系列函式。
// 🔴 儲存那六個函式（storeDefaults／storeSanitizeTrain／storeSanitize／storeMigrate／storeLoad／storeSave）
//    被 scripts/verify_my_train_plan.mjs 用 extractFunction 單獨抽出來測：它們只准用 localStorage、MyTrainPlan
//    與 STORAGE_KEY／LEGACY_KEY／HALO_SIZES 三個常數，不准用這個檔裡的其他東西。改名要同步改那支腳本。
// 🔴 localStorage 一律包 try/catch（私密模式、配額滿、被封鎖都會丟錯），讀不到就當沒有自製車。
(() => {
  'use strict';
  // 車隊存在新鍵。舊鍵只在新鍵還不存在時讀一次，之後不寫不刪：舊版只認舊鍵，新鍵存在也就不會因為車隊刪光而復活。
  const STORAGE_KEY = 'trainmap-my-fleet-v1';
  const LEGACY_KEY = 'trainmap-my-train-v1';
  const HALO_SIZES = ['std', 'lg', 'xl'];

  // ── 儲存─────────────────────────────────────────────────
  function storeDefaults() {
    return { v: 1, appearance: { haloOn: true, haloSize: 'std' }, trains: [], device: null, earned: {} };
  }
  // 只看形狀，不看車款與站還在不在：那兩種失效要在站點資料與車庫目錄都載入之後才判斷，
  // 而且失效時還要拿名字寫提示，所以這裡不能丟掉。名字存正規化後的版本。
  function storeSanitizeTrain(t) {
    if (!t || typeof t !== 'object') return null;
    if (typeof t.id !== 'string' || !/^my:[0-9A-Za-z-]{8,}$/.test(t.id)) return null;
    const nm = MyTrainPlan.validateName(t.name);
    if (!nm.ok) return null;
    if (typeof t.modelId !== 'string' || !t.modelId) return null;
    if (!['tra_sched', 'thsr_sched', 'afr_sched'].includes(t.sys)) return null;
    if (typeof t.from !== 'string' || !t.from || typeof t.to !== 'string' || !t.to) return null;
    const via = t.via == null ? null : t.via;
    if (via !== null && via !== 'mountain' && via !== 'coast') return null;
    const dir = t.dir == null ? null : t.dir;   // 環島順行／逆行；舊紀錄沒有這欄＝走最短那邊
    if (dir !== null && dir !== 'shun' && dir !== 'ni') return null;
    if (!['all', 'major', 'express'].includes(t.pattern)) return null;
    if (!Number.isInteger(t.depSec) || t.depSec < 0 || t.depSec >= 86400) return null;
    return { id: t.id, name: nm.name, modelId: t.modelId, sys: t.sys, from: t.from, to: t.to, via, dir, pattern: t.pattern, depSec: t.depSec, color: MyTrainPlan.normalizeColor(t.modelId, t.color), ...MyTrainPlan.fleetFields(t) };
  }
  function storeSanitize(raw) {
    const out = storeDefaults();
    if (!raw || typeof raw !== 'object' || raw.v !== 1) return out;
    const ap = raw.appearance;
    if (ap && typeof ap === 'object') {
      if (typeof ap.haloOn === 'boolean') out.appearance.haloOn = ap.haloOn;
      if (HALO_SIZES.includes(ap.haloSize)) out.appearance.haloSize = ap.haloSize;
    }
    const ids = new Set();
    for (const t of Array.isArray(raw.trains) ? raw.trains : []) {
      const clean = storeSanitizeTrain(t);
      if (clean && !ids.has(clean.id) && ids.size < MyTrainPlan.FLEET_MAX) { ids.add(clean.id); out.trains.push(clean); }
    }
    out.trains = MyTrainPlan.assignTracks(out.trains);
    if (typeof raw.device === 'string' && MyTrainPlan.DEVICE_RE.test(raw.device)) out.device = raw.device;
    out.earned = MyTrainPlan.earnedOf(raw.earned);
    return out;
  }
  // 舊存檔搬進第 1 股，首航日算今天（舊存檔沒有建立日期，回推不到）。
  function storeMigrate(text) {
    let raw = null;
    try { raw = JSON.parse(text); } catch (e) { return storeDefaults(); }
    if (!raw || typeof raw !== 'object') return storeDefaults();
    const train = raw.train && typeof raw.train === 'object' ? { ...raw.train, track: 0, firstDay: MyTrainPlan.taipeiDay(Date.now()) } : null;
    return storeSanitize({ v: raw.v, appearance: raw.appearance, trains: train ? [train] : [] });
  }
  function storeLoad() {
    let text = null;
    try { text = localStorage.getItem(STORAGE_KEY); } catch (e) { return storeDefaults(); }
    if (text == null) {
      let legacy = null;
      try { legacy = localStorage.getItem(LEGACY_KEY); } catch (e) { return storeDefaults(); }
      if (legacy == null) return storeDefaults();
      const moved = storeMigrate(legacy);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(moved)); } catch (e) {}
      return moved;
    }
    let raw = null;
    try { raw = JSON.parse(text); } catch (e) { return storeDefaults(); }
    return storeSanitize(raw);
  }
  // trains 裡有任何一列不合格 → 不寫、回 false（原本存的不動）。沒帶 trains 也不寫，免得把車隊洗掉。
  function storeSave(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.trains)) return false;
    const clean = storeSanitize({ ...data, v: 1 });
    if (clean.trains.length !== data.trains.length) return false;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(clean)); } catch (e) { return false; }
    return true;
  }

  // ── 自製車面板（DOM 契約見 scripts/verify_my_train_isolation.mjs）───────
  // 掛載方式：host.mountNode() 回傳既有的 #followPanel 本身，我們的面板根節點
  // （[data-mt-panel]）是它的**直接子節點**。真車專屬的那些列由 index.html 的 .fp-own 規則
  // （只留 .fp-head 與 [data-mt-panel]）整批藏掉；收合／展開沿用 #fpClose 加在 .follow-panel
  // 上的 .fp-min class，我們不自己 toggle class、也不自己做收合鈕——只在 my-train-ui.css 寫
  // 「.fp-min 時面板只留頭列」的規則。「結束跟車」是 #fpEnd，留在 .fp-head 裡，不歸我們管，
  // 所以 host.onEndFollow 這裡沒有呼叫到。
  let panelEl = null;    // [data-mt-panel] 根節點，只建一次
  let panelHost = null;  // 最近一次 mountPanel／updatePanel 收到的 host
  let panelRefs = null;  // 會變的節點快取，updatePanel 只改這些節點的 textContent／單一子區塊的 innerHTML

  const HALO_LABEL = { on: '光環：開', off: '光環：關' };
  const SIZE_LABEL = { std: '大小：標準', lg: '大小：大', xl: '大小：特大' };
  const SIZE_NEXT = { std: 'lg', lg: 'xl', xl: 'std' };
  const PATTERN_LABEL = { all: '站站停', major: '只停大站', express: '直達' };
  const VIA_LABEL = { mountain: '山線', coast: '海線' };
  const DIR_LABEL = { shun: '台鐵順行', ni: '台鐵逆行' };

  function mtEsc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // 內容沒變就不動 DOM；內容變了才整段換掉，換掉前後保留捲動位置——這一塊本身不含任何按鈕
  // （逐站時刻是純文字清單），使用者往上捲的時候不會被拉回最底。
  function mtSetHtml(el, html) {
    if (!el || el.innerHTML === html) return;
    const top = el.scrollTop;
    el.innerHTML = html;
    el.scrollTop = top;
  }
  function mtSetText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }

  function mtOnAction(action) {
    if (!panelHost) return;
    if (action === 'edit') { if (panelHost.onEdit) panelHost.onEdit(); return; }
    if (action === 'delete') { if (panelHost.onDelete) panelHost.onDelete(); return; }
    if (action === 'halo' || action === 'size') {
      const cur = storeLoad().appearance;
      const next = { haloOn: cur.haloOn, haloSize: cur.haloSize };
      if (action === 'halo') next.haloOn = !cur.haloOn;
      else next.haloSize = SIZE_NEXT[cur.haloSize] || 'std';
      if (panelHost.onAppearance) panelHost.onAppearance(next);
    }
  }

  // 事件列：照 rel 把新的一條插到正確位置，只動那一個節點；已經畫過的列不重畫。
  // 列跟 log.items 裡的物件一對一（Map 的鍵就是那個物件），被上限丟掉或整趟清空的列才拿掉。
  // 使用者捲在最底時跟著捲到最新一條；往上捲的時候不拉回最底。「在不在最底」記在 evStick，由使用者的捲動更新：
  // 面板收合（display:none）時量到的捲動數字全是 0，不能拿當下量的值判斷；收合期間新增的列，等面板再出現時補捲。
  let evRows = new Map();
  let evLog = null;
  let evVer = -1;
  let evLang = null;
  let evStick = true;
  let evPendingStick = false;
  function eventText(it, host, rec) {
    const meta = it.meta || {};
    if (it.kind === 'depart') return host.t('從 {station} 發車', { station: host.stationName(meta.station || it.key, rec.sys) });
    if (it.kind === 'stop') return host.t('停靠 {station}', { station: host.stationName(meta.station || it.key, rec.sys) });
    if (it.kind === 'arrive') return host.t('抵達 {station}', { station: host.stationName(meta.station || it.key, rec.sys) });
    if (it.kind === 'pass' || it.kind === 'meet') {
      const vals = { kind: host.trainTypeName ? host.trainTypeName(meta.typeName || '') : (meta.typeName || ''), train: meta.train || it.key };
      return host.t(it.kind === 'pass' ? '{kind} {train} 從旁通過' : '與 {kind} {train} 交會', vals);
    }
    return it.text || '';
  }
  function renderEvents(log, host, rec) {
    const box = panelRefs && panelRefs.events;
    if (!box) return;
    const items = log && Array.isArray(log.items) ? log.items : [];
    const ver = log ? log.ver : -1;
    if (log === evLog && ver === evVer && evRows.size === items.length && evLang === host.lang) return;
    if (log !== evLog) { evLog = log; evStick = true; }
    evVer = ver;
    evLang = host.lang;
    const live = new Set(items);
    for (const [it, row] of evRows) if (!live.has(it)) { row.remove(); evRows.delete(it); }
    let after = null;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      let row = evRows.get(it);
      if (!row) {
        row = document.createElement('div');
        row.className = 'mt-ev';
        const tm = document.createElement('span');
        tm.className = 'mt-ev-t';
        tm.textContent = host.fmtHM(it.simT);
        const tx = document.createElement('span');
        tx.className = 'mt-ev-x';
        tx.textContent = eventText(it, host, rec);
        row.append(tm, tx);
        box.insertBefore(row, after);
        evRows.set(it, row);
      } else {
        mtSetText(row.querySelector('.mt-ev-t'), host.fmtHM(it.simT));
        mtSetText(row.querySelector('.mt-ev-x'), eventText(it, host, rec));
      }
      after = row;
    }
    if (panelRefs.evEmpty) panelRefs.evEmpty.hidden = items.length > 0;
    evStickNow(box);
  }
  function evStickNow(box) {
    if (!evStick) return;
    if (box.clientHeight === 0) { evPendingStick = true; return; } // 看不見：等出現再捲
    evPendingStick = false;
    box.scrollTop = box.scrollHeight;
  }

  function mountPanel(rec, host) {
    if (!host || typeof host.mountNode !== 'function') return;
    const root = host.mountNode();
    if (!root) return;
    // 防重複掛（呼叫端理論上會先 unmountPanel 才重掛；這裡只是防護，不是主要機制）。
    if (panelEl && panelEl.parentNode === root) { updatePanel(rec, host); return; }
    if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);

    const el = document.createElement('div');
    el.setAttribute('data-mt-panel', '');
    el.innerHTML =
      '<div class="mt-head">' +
        '<span class="mt-badge">' + mtEsc(host.t('自製')) + '</span>' +
        '<b class="mt-name" data-mt-name data-i18n-skip></b>' +
        '<span data-mt-mark></span>' +
      '</div>' +
      '<div class="mt-caption">' + mtEsc(host.t('你自己排的班次，不在官方時刻表上')) + '</div>' +
      '<div data-mt-maiden></div>' +
      '<div class="mt-body">' +
        '<div class="mt-row mt-model" data-mt-model></div>' +
        '<div class="mt-row mt-route" data-mt-route></div>' +
        '<div class="mt-row mt-pattern" data-mt-pattern></div>' +
        '<div class="mt-next">' +
          '<span class="lbl">' + mtEsc(host.t('下一站')) + '</span>' +
          '<span class="stn" data-mt-next-stn></span>' +
          '<span class="eta" data-mt-next-eta></span>' +
        '</div>' +
        '<div class="mt-stops" data-mt-stops tabindex="0" role="region"></div>' +
        '<div class="mt-events" data-mt-events tabindex="0" role="region">' +
          '<div class="mt-ev-empty" data-mt-ev-empty>' + mtEsc(host.t('跑起來就會記下停靠與交會')) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="mt-appearance">' +
        '<button type="button" class="mt-btn" data-mt-action="halo"></button>' +
        '<button type="button" class="mt-btn" data-mt-action="size"></button>' +
      '</div>' +
      '<div class="mt-actions">' +
        '<button type="button" class="mt-btn" data-mt-action="edit">' + mtEsc(host.t('編輯')) + '</button>' +
        '<button type="button" class="mt-btn mt-btn-danger" data-mt-action="delete">' + mtEsc(host.t('刪除')) + '</button>' +
      '</div>';
    // 事件委派掛在根節點上一次，永不隨內容重建而失效（按鈕本身也永遠不會被 innerHTML 整段換掉）。
    el.addEventListener('click', e => {
      const btn = e.target.closest('[data-mt-action]');
      if (!btn) return;
      e.stopPropagation();
      mtOnAction(btn.getAttribute('data-mt-action'));
    });
    root.appendChild(el);

    panelEl = el;
    panelHost = host;
    evRows = new Map();
    evLog = null;
    evVer = -1;
    evStick = true;
    evPendingStick = false;
    panelRefs = {
      name: el.querySelector('[data-mt-name]'),
      mark: el.querySelector('[data-mt-mark]'),
      maiden: el.querySelector('[data-mt-maiden]'),
      model: el.querySelector('[data-mt-model]'),
      route: el.querySelector('[data-mt-route]'),
      pattern: el.querySelector('[data-mt-pattern]'),
      nextStn: el.querySelector('[data-mt-next-stn]'),
      nextEta: el.querySelector('[data-mt-next-eta]'),
      stops: el.querySelector('[data-mt-stops]'),
      events: el.querySelector('[data-mt-events]'),
      evEmpty: el.querySelector('[data-mt-ev-empty]'),
      halo: el.querySelector('[data-mt-action="halo"]'),
      size: el.querySelector('[data-mt-action="size"]'),
    };
    // 只有看得見的時候才更新「在不在最底」（收合時量到的全是 0）；程式自己捲到底也會觸發，結果一樣是 true。
    const evBox = panelRefs.events;
    if (evBox) evBox.addEventListener('scroll', () => {
      if (evBox.clientHeight > 0) evStick = evBox.scrollHeight - evBox.scrollTop - evBox.clientHeight < 4;
    }, { passive: true });
    updatePanel(rec, host);
  }

  // 外觀快取(面板的「每秒更新」實際上是每幀,見 updateFollowCamera→updateFollowPanel)：
  // updatePanel 每幀都要讀一次外觀，但 storeLoad() 每次都 JSON.parse。以 localStorage 原始
  // 字串當快取鍵，字串沒變就回傳上次解析好的物件、變了才重新呼叫 storeLoad()（內含 JSON.parse）。
  // 天生正確：不管是誰寫了這把 key（目前只有 storeSave 一個寫入者，見檔頭），下一次 getItem
  // 讀到的字串就會變，快取自動失效，不必額外掛失效邏輯。只給 updatePanel 用，不是 storeLoad
  // 本身的一部分——storeLoad 要保持能被 scripts/verify_my_train_plan.mjs 的 extractFunction
  // 單獨抽出來跑（檔頭護欄：那五個函式不准用檔案裡其他變數）。
  let apCacheRaw, apCacheVal;
  function loadAppearanceForPanel() {
    let text = null;
    try { text = localStorage.getItem(STORAGE_KEY); } catch (e) { text = null; }
    if (text !== apCacheRaw) { apCacheRaw = text; apCacheVal = storeLoad().appearance; }
    return apCacheVal;
  }

  // 頭牌、車牌框、第一趟親手發車的大章。每幀都會走到,外觀沒變就不碰 DOM。
  function renderLook(rec, host) {
    const lk = rec._ownLook || {}, key = [lk.mark, lk.plate, rec._ownMaiden, host.lang].join('|');
    if (key === panelRefs.lookKey) return;
    panelRefs.lookKey = key;
    const plan = globalThis.MyTrainPlan, marks = globalThis.MyTrainMarks, honors = plan.HONOR_GROUPS.flatMap(g => g.list);
    const nameOf = id => host.t(honors.find(h => h.id === id).name), plate = plan.PLATES[lk.plate];
    panelRefs.mark.innerHTML = lk.mark ? '<img class="mt-mark" src="' + marks.url(lk.mark, nameOf(lk.mark)) + '" alt="' + mtEsc(host.t('頭牌「{name}」', { name: nameOf(lk.mark) })) + '">' : '';
    panelRefs.name.classList.toggle('mt-plate', !!(plate && plate.bg));
    panelRefs.name.classList.toggle('dbl', !!(plate && plate.dbl));
    panelRefs.name.style.cssText = plate && plate.bg ? '--pb:' + plate.bg + ';--pl:' + plate.line + ';--pi:' + plate.ink : '';
    const first = nameOf('maiden');
    panelRefs.maiden.innerHTML = rec._ownMaiden ? marks.stamp(first, true, 'mt-big-stamp') + '<p class="mt-maiden">' + mtEsc(host.t('拿到成就「{name}」，解鎖頭牌「{name}」，回車庫就能掛上。', { name: first })) + '</p>' : '';
  }

  // 每秒呼叫：只改會變的文字節點，逐站時刻那一塊用 innerHTML 做 diff-guard 但那個區塊裡
  // 沒有任何按鈕。事件列逐條插入，見 renderEvents。
  // log＝state.ownTrainLog；沒傳（undefined）就不動事件列，免得把已經畫好的列整批拿掉。
  function updatePanel(rec, host, log) {
    if (!panelEl || !panelRefs || !rec) return;
    panelHost = host;
    mtSetText(panelRefs.name, rec.label);
    renderLook(rec, host);
    mtSetText(panelRefs.model, rec.typeName ? host.t(rec.typeName) : '');

    const stops = rec.stops || [];
    const first = stops[0], last = stops[stops.length - 1];
    let routeText = '';
    if (first && last) {
      routeText = host.stationName(first.name, rec.sys) + ' → ' + host.stationName(last.name, rec.sys);
      const dirKey = DIR_LABEL[rec._ownDir];
      if (dirKey) routeText += ' · ' + (host.lang === 'zh-TW' ? dirKey.slice(2) : host.t(dirKey));
      const viaKey = VIA_LABEL[rec._ownVia];
      if (viaKey) routeText += ' · ' + host.t(viaKey);
    }
    mtSetText(panelRefs.route, routeText);
    mtSetText(panelRefs.pattern, host.t(PATTERN_LABEL[rec._ownPattern] || ''));
    panelRefs.stops.setAttribute('aria-label', host.t('逐站時刻'));
    panelRefs.events.setAttribute('aria-label', host.t('事件紀錄'));

    // 下一站還要多久：一律用本趟秒數（rel），跨午夜的班才不會在 00:00 之後算錯。
    // 在路上（rel ≤ 全程）＝第一個還沒到的停靠站（通過站不算，跟真車面板的 nextStopInfo 同一個意思）；
    // 不在路上時，離上一次抵達比離下一次發車近就算「已抵達」，否則倒數到起站發車（這班每天都開）。
    const now = host.simSec();
    const dep0 = first ? first.depSec : 0, dur = last ? last.arrSec - dep0 : 0;
    const rel = first ? globalThis.MyTrainPlan.tripRel(now, dep0) : 0;
    const running = rel <= dur;
    const arrived = !running && (!!rec._ownRun || rel - dur < 86400 - rel);
    let nextStop = null, etaSec = 0;
    if (running) {
      for (const s of stops) { if (s.stop !== false && s.arrSec - dep0 > rel) { nextStop = s; etaSec = s.arrSec - dep0 - rel; break; } }
    } else if (!arrived && first) { nextStop = first; etaSec = 86400 - rel; }
    if (nextStop) {
      mtSetText(panelRefs.nextStn, host.stationName(nextStop.name, rec.sys));
      const mm = Math.max(0, Math.round(etaSec / 60));
      mtSetText(panelRefs.nextEta, mm < 1 ? host.t('即將進站') : host.t('{n} 分', { n: mm }));
    } else {
      mtSetText(panelRefs.nextStn, '—');
      mtSetText(panelRefs.nextEta, host.t('已抵達終點'));
    }

    const html = stops.map(s => {
      const isPass = s.stop === false;
      const done = running ? s.arrSec - dep0 <= rel : arrived;
      const cls = 'mt-stop' + (isPass ? ' mt-stop-pass' : '') + (done ? ' mt-stop-done' : '');
      const label = isPass ? host.t('通過') : host.fmtHM(s.arrSec % 86400);
      return '<div class="' + cls + '"><span class="mt-stop-name">' + mtEsc(host.stationName(s.name, rec.sys)) + '</span>'
        + '<span class="mt-stop-time">' + mtEsc(label) + '</span></div>';
    }).join('');
    mtSetHtml(panelRefs.stops, html);

    // 外觀列：目前值一律從 MyTrainUI.load().appearance 讀（不是自己另存一份）；每幀都會呼叫到
    // 這裡，走 loadAppearanceForPanel() 的快取，不要改回直接呼叫 storeLoad()。
    const ap = loadAppearanceForPanel();
    mtSetText(panelRefs.halo, host.t(HALO_LABEL[ap.haloOn ? 'on' : 'off']));
    mtSetText(panelRefs.size, host.t(SIZE_LABEL[ap.haloSize] || SIZE_LABEL.std));

    if (log !== undefined) renderEvents(log, host, rec);
    if (evPendingStick && panelRefs.events) evStickNow(panelRefs.events);
  }

  function unmountPanel() {
    if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
    panelEl = null;
    panelHost = null;
    panelRefs = null;
    evRows = new Map();
    evLog = null;
    evVer = -1;
    evLang = null;
  }

  // ── 排班表單(DOM 契約見 scripts/verify_my_train_isolation.mjs 檔頭)──────────────────
  // formCtx:{ sys, graph, stats, sd, modelId } 只在表單開著時存在,openForm 時重建(sys 固定,
  // 車款不會在表單開著時換)。formSel 是使用者目前的選擇,name 直接讀 DOM(不另外存一份)。
  let formEl = null, formCtx = null, formMode = 'schedule', formPreset = null, formPlanned = null;
  let formSel = { from: null, to: null, via: null, dir: null, pattern: 'all', hh: 0, mm: 0, color: null };
  const FORM_REASON = {
    same: '起訖站不能相同', no_path: '這兩站之間目前找不到路線', unknown_station: '請選擇起訖站',
    bad_pattern: '這個停站方式現在不能用', bad_dep: '出發時間不對', model_gone: '車款目前無法使用',
    save_failed: '存檔失敗，請再試一次', over_day: '全程超過 24 小時，換個停站方式或方向試試',
  };
  // 表單靜態標籤:formBuild() 只建一次 DOM,不能把翻譯烤進 innerHTML
  // (語言切換後重開表單仍是舊語言)。改成 data-mt-lbl 佔位,openForm() 每次開表單時用 host.t() 重新填字。
  const FORM_LABELS = {
    from: '起站', to: '訖站', 'via-mountain': '山線', 'via-coast': '海線', 'dir-shun': '台鐵順行', 'dir-ni': '台鐵逆行', deptime: '每天發車時間',
    'pattern-all': '站站停', 'pattern-major': '只停大站', 'pattern-express': '直達',
    hh: '時', mm: '分', name: '名字', cancel: '取消', depart: '發車', colorlabel: '車牌顏色', swap: '起訖對調',
  };

  // iOS 15.0–15.3 的 WebView 與非安全來源都沒有 crypto.randomUUID,退路依序是
  // crypto.getRandomValues 組 v4 UUID、最後才是 Math.random(不保證密碼學等級隨機,但總比表單卡住好)。
  function mtUuid() {
    try { if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); } catch (e) {}
    try {
      if (crypto && typeof crypto.getRandomValues === 'function') {
        const b = crypto.getRandomValues(new Uint8Array(16));
        b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
        const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
      }
    } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function mtNorm(s) { return String(s == null ? '' : s).replace(/臺/g, '台').toLocaleLowerCase(); }

  function formSetPressed(sel, val) {
    formEl.querySelectorAll(sel).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === val)));
  }

  // 名字字數即時計數(5 字上限):跟 validateName 用同一套正規化＋字素計數,
  // 不能用原始字串長度(換行/控制字元/前後空白都要先濾掉,否則計數跟真正拿去驗證的字數對不上)。
  // 獨立於 formRecompute()——後者在起訖站沒選好時會提早 return,字數計數不能被那個提早 return 卡住。
  function formUpdateNameCount() {
    if (!formCtx) return;
    const input = formEl.querySelector('[data-mt-f="name"]');
    const countEl = formEl.querySelector('[data-mt-f="namecount"]');
    if (!input || !countEl) return;
    const plan = formCtx.host.plan();
    const n = plan.nameLength(plan.normalizeName(input.value));
    mtSetText(countEl, n + '/' + plan.NAME_MAX);
    countEl.classList.toggle('mt-f-namecount-over', n > plan.NAME_MAX);
  }

  // 選定一個站(建議列、清單裡的站鈕共用)。換了站,方向回到新那組站的最短那邊(同輸入框的 input 處理)。
  // 起站選好、訖站還空著,直接攤開訖站清單——不 focus 輸入框,手機才不會跳鍵盤蓋住清單。
  function formPickStation(which, key) {
    const n = formCtx.graph.nodes.get(key);
    if (!n) return;
    formSel[which] = key; formSel.dir = null;
    formEl.querySelector(`[data-mt-f="${which}"]`).value = formCtx.host.stationName(n.name, formCtx.sys);
    formHideSug(which);
    if (which === 'from' && !formSel.to) {
      formBrowseStations('to');
      formEl.querySelector('[data-mt-f="to"]').closest('label').scrollIntoView({ block: 'start' });
    }
    formRecompute();
  }
  function formHideSug(which) {
    const box = formEl.querySelector(`[data-mt-sug="${which}"]`);
    box.hidden = true; box.replaceChildren(); box.classList.remove('mt-f-browse');
  }

  // 起訖搜尋框:輸入即篩(比對正規化後的顯示名子字串),最多列 8 筆;點一列選定那個站鍵。
  // 比對與顯示都要看得懂 host.stationName 的翻譯名(英文介面打「Taipei」找不到是原本的坑)——
  // 比對時原始站名(n.name)與顯示名都試,顯示與選定後帶回輸入框的值一律用顯示名。
  // 空字串改成攤開整份清單;打出完整站名(只有一站相符)就算選到,不必再點那一列。
  function formFilterStations(which, query) {
    const box = formEl.querySelector(`[data-mt-sug="${which}"]`);
    const q = mtNorm(query).trim();
    if (!q) { formBrowseStations(which); return; }
    formHideSug(which);
    const host = formCtx.host;
    const list = [...formCtx.graph.nodes.values()]
      .filter(n => mtNorm(n.name).includes(q) || mtNorm(host.stationName(n.name, formCtx.sys)).includes(q))
      .slice(0, 8);
    box.hidden = list.length === 0;
    for (const n of list) {
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'mt-f-sug-row'; row.setAttribute('data-mt-sug-key', n.key);
      row.textContent = host.stationName(n.name, formCtx.sys);
      row.onclick = () => formPickStation(which, n.key);
      box.appendChild(row);
    }
    const exact = list.filter(n => mtNorm(n.name) === q || mtNorm(host.stationName(n.name, formCtx.sys)) === q);
    if (exact.length === 1) formSel[which] = exact[0].key;
  }

  // 還沒打字時的整份清單:站多的系統(台鐵)先列常用大站(站等 ≤1,依路線順序),再依路線收合;
  // 站少的(高鐵、林鐵)直接照路線攤開。大站的站等跟「只停大站」同一套 stationTiers。
  function formBrowseStations(which) {
    const box = formEl.querySelector(`[data-mt-sug="${which}"]`);
    const { host, sys, graph, sd, tiers } = formCtx;
    box.replaceChildren(); box.classList.add('mt-f-browse');
    const lines = [];
    for (const ln of sd.lines || []) {
      const keys = [];
      for (const st of ln.stations || []) {
        const k = host.plan().stationKey(sys, st.name);
        if (graph.nodes.has(k) && !keys.includes(k)) keys.push(k);
      }
      if (keys.length) lines.push({ name: String(ln.name).split(/[（(]/)[0].trim(), keys });
    }
    const chips = keys => {
      const wrap = document.createElement('div'); wrap.className = 'mt-f-chips';
      for (const k of keys) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'mt-f-chip'; b.setAttribute('data-mt-sug-key', k);
        b.setAttribute('aria-pressed', String(formSel.from === k || formSel.to === k));
        b.textContent = host.stationName(graph.nodes.get(k).name, sys);
        b.onclick = () => formPickStation(which, k);
        wrap.appendChild(b);
      }
      return wrap;
    };
    const heading = text => { const h = document.createElement('div'); h.className = 'mt-f-sec'; h.textContent = text; return h; };
    if (graph.nodes.size > 25) {
      const big = [];
      for (const l of lines) for (const k of l.keys) if (tiers.get(graph.nodes.get(k).name) <= 1 && !big.includes(k)) big.push(k);
      if (big.length) box.append(heading(host.t('常用大站')), chips(big));
      for (const l of lines) {
        const d = document.createElement('details'); d.className = 'mt-f-line';
        const s = document.createElement('summary');
        const cnt = document.createElement('span'); cnt.textContent = host.t('{n} 站', { n: l.keys.length });
        s.append(host.t(l.name), cnt);
        d.append(s, chips(l.keys));
        box.appendChild(d);
      }
    } else {
      for (const l of lines) {
        if (lines.length > 1) box.appendChild(heading(host.t(l.name)));
        box.appendChild(chips(l.keys));
      }
    }
    box.hidden = false;
  }
  // 點輸入框:已選定就攤開整份清單(方便換站),否則照目前打的字篩。已經開著就不重畫(focus 跟 click
  // 會連續各來一次,重畫會把剛展開的路線收回去)。
  function formOpenSug(which) {
    if (!formCtx) return;
    formHideSug(which === 'from' ? 'to' : 'from');
    if (!formEl.querySelector(`[data-mt-sug="${which}"]`).hidden) return;
    if (formSel[which]) formBrowseStations(which);
    else formFilterStations(which, formEl.querySelector(`[data-mt-f="${which}"]`).value);
  }

  // 每次輸入/切換都重算:先給路線摘要(不管名字合不合法),名字合法才進一步算完整時刻表預覽。
  // ctx 沿用 ownTrainRebuild 同一套組法(host 已經有 buildProfile/stnClassMap/classOf/catalog)。
  function formRecompute() {
    if (!formCtx) return;
    const plan = formCtx.host.plan();
    const routeEl = formEl.querySelector('[data-mt-f="route"]');
    const previewEl = formEl.querySelector('[data-mt-f="preview"]');
    const reasonEl = formEl.querySelector('[data-mt-f="reason"]');
    const departBtn = formEl.querySelector('[data-mt-f="depart"]');
    const viaBox = formEl.querySelector('.mt-f-via');
    const dirBox = formEl.querySelector('.mt-f-dir');
    formPlanned = null;
    departBtn.disabled = true;
    if (!formSel.from || !formSel.to) {
      mtSetText(routeEl, ''); mtSetText(previewEl, '');
      mtSetText(reasonEl, formCtx.host.t(FORM_REASON.unknown_station));
      viaBox.hidden = true; dirBox.hidden = true;
      return;
    }
    const route = plan.findRoute(formCtx.graph, formSel.from, formSel.to, { via: formSel.via, dir: formSel.dir });
    if (!route.ok) {
      mtSetText(routeEl, ''); mtSetText(previewEl, '');
      mtSetText(reasonEl, formCtx.host.t(FORM_REASON[route.reason] || route.reason));
      viaBox.hidden = true; dirBox.hidden = true;
      return;
    }
    // 順行／逆行：環島那一圈上的兩站才有得選；沒選過就是最短那邊的方向（findRoute 回的 dir）。
    dirBox.hidden = !route.dirChoice;
    formSel.dir = route.dir;
    if (route.dirChoice) formSetPressed('[data-mt-fdir]', route.dir);
    viaBox.hidden = !route.viaChoice;
    if (route.viaChoice) { if (!formSel.via) formSel.via = 'mountain'; formSetPressed('[data-mt-fvia]', formSel.via); }
    else formSel.via = null;
    mtSetText(routeEl, formCtx.host.t('經過 {n} 站・{km} 公里', { n: route.stops.length, km: route.km.toFixed(1) }));
    const nameRaw = formEl.querySelector('[data-mt-f="name"]').value;
    const nameCheck = plan.validateName(nameRaw);
    if (!nameCheck.ok) {
      mtSetText(previewEl, '');
      mtSetText(reasonEl, formCtx.host.t(nameCheck.reason === 'empty' ? '幫它取個名字吧' : '名字最多 5 個字'));
      return;
    }
    // 時/分超出範圍就判不合法,發車鈕按不了、reason 欄寫原因——不准悄悄夾住
    // (夾住會讓框裡顯示的值跟實際拿去排班的時刻對不上,例如打 25 卻悄悄排成 23)。
    if (!Number.isInteger(formSel.hh) || formSel.hh < 0 || formSel.hh > 23
      || !Number.isInteger(formSel.mm) || formSel.mm < 0 || formSel.mm > 59) {
      mtSetText(previewEl, '');
      mtSetText(reasonEl, formCtx.host.t(FORM_REASON.bad_dep));
      return;
    }
    const hh = formSel.hh, mm = formSel.mm;
    const draft = {
      id: 'my:preview', name: nameCheck.name, modelId: formCtx.modelId, sys: formCtx.sys,
      from: formSel.from, to: formSel.to, via: formSel.via, dir: formSel.dir, pattern: formSel.pattern,
      depSec: (hh * 3600 + mm * 60) % 86400, color: formSel.color,
    };
    const ctx = {
      lines: formCtx.sd.lines, trains: formCtx.sd.trains, denseTrains: formCtx.sd.denseTrains,
      stnClassMap: formCtx.host.stnClassMap(), classOf: formCtx.host.classOf, buildProfile: formCtx.host.buildProfile,
      catalog: formCtx.host.catalog(), color: null, graph: formCtx.graph, stats: formCtx.stats,
    };
    const result = plan.planTrain(draft, ctx);
    if (!result.ok) {
      mtSetText(previewEl, '');
      mtSetText(reasonEl, formCtx.host.t(FORM_REASON[result.reason] || result.reason));
      return;
    }
    const tt = result.timetable.stops;
    // 只算中途站(扣掉起訖兩端,兩端永遠是 stop:true,算進去會多報兩站、直達車還會
    // 誤報「停 2 站」)。
    const midN = tt.slice(1, -1).filter(s => s.stop).length;
    const stopsPart = midN > 0 ? formCtx.host.t('中途停 {n} 站', { n: midN }) : formCtx.host.t('中途不停站');
    mtSetText(previewEl, formCtx.host.t('預估 {arr} 抵達・全程約 {dur} 分・{stops}', {
      arr: formCtx.host.fmtHM(tt[tt.length - 1].arrSec % 86400),
      dur: Math.max(1, Math.round(result.timetable.totalSec / 60)),
      stops: stopsPart,
    }));
    mtSetText(reasonEl, '');
    departBtn.disabled = false;
    formPlanned = draft;
  }

  // 不夾住,只是把打進來的值算成數字(可能超出範圍或 NaN),合不合法交給 formRecompute 判斷。
  function formParseHM(v) { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : NaN; }

  // 只有 mode==='edit' 時才判斷 nameOnly:七個欄位全等才算。
  function formSameExceptName(a, b) {
    return a.modelId === b.modelId && a.sys === b.sys && a.from === b.from && a.to === b.to
      && a.via === b.via && (a.dir || null) === (b.dir || null) && a.pattern === b.pattern && a.depSec === b.depSec;
  }

  // 開頭擋掉表單已經關著的情況——關掉的表單理論上不該再送出,但取消只呼叫 dialog.close()
  // 不會讓裡面的控件失去可操作性,程式化 .click() 或鍵盤 Enter 仍能一路跑到這裡,必須自己再擋一次。
  // 改成「onDepart 回報成功才關表單」——原本先關表單才呼叫 onDepart,存檔失敗(例如
  // localStorage 寫入被擋)使用者完全看不出來,車也不會真的換掉;現在失敗就留在表單上、reason 欄寫原因。
  function formSubmit() {
    if (!formEl || !formEl.open) return;
    if (!formPlanned || formEl.querySelector('[data-mt-f="depart"]').disabled) return;
    const train = { ...formPlanned, id: (formMode !== 'schedule' && formPreset) ? formPreset.id : ('my:' + mtUuid()) };
    const meta = formMode === 'edit' ? { mode: 'edit', nameOnly: formPreset ? formSameExceptName(formPreset, train) : false } : { mode: formMode };
    const host = formCtx.host;
    const success = host.onDepart ? host.onDepart(train, meta) : false;
    if (success) closeForm();
    else mtSetText(formEl.querySelector('[data-mt-f="reason"]'), host.t(FORM_REASON.save_failed));
  }

  function formBuild() {
    if (formEl) return;
    const el = document.createElement('dialog');
    el.id = 'mtForm';
    el.setAttribute('data-mt-form', '');
    el.setAttribute('aria-labelledby', 'mtFormTitle');
    el.innerHTML =
      '<div class="mt-f-head"><b class="mt-f-title" id="mtFormTitle"></b><button type="button" class="mt-f-x" data-mt-f="cancel" data-mt-close aria-label="關閉">×</button></div>' +
      '<div class="mt-f-model"><img class="mt-f-thumb" alt="" width="64" height="40"><div><b class="mt-f-mname"></b><span class="mt-f-msys"></span></div></div>' +
      '<div class="mt-f-body">' +
        '<div class="mt-f-colors" data-mt-f="colorswrap"><span class="mt-f-colorlbl" data-mt-lbl="colorlabel"></span>' +
          '<div class="mt-f-colorbtns">' +
            '<button type="button" class="mt-f-color" data-mt-color data-slot="0" data-v="" aria-pressed="false"><i></i><span></span></button>' +
            '<button type="button" class="mt-f-color" data-mt-color data-slot="1" data-v="" aria-pressed="false"><i></i><span></span></button>' +
            '<button type="button" class="mt-f-color" data-mt-color data-slot="2" data-v="" aria-pressed="false"><i></i><span></span></button>' +
            '<button type="button" class="mt-f-color" data-mt-color data-slot="3" data-v="" aria-pressed="false"><i></i><span></span></button>' +
            '<button type="button" class="mt-f-color" data-mt-color data-slot="4" data-v="" aria-pressed="false"><i></i><span></span></button>' +
          '</div></div>' +
        '<label class="mt-f-lbl"><span data-mt-lbl="from"></span><input class="mt-f-in" data-mt-f="from" type="text" autocomplete="off"></label>' +
        '<div class="mt-f-sug" data-mt-sug="from" hidden></div>' +
        '<button type="button" class="mt-f-swap" data-mt-f="swap" data-mt-lbl="swap"></button>' +
        '<label class="mt-f-lbl"><span data-mt-lbl="to"></span><input class="mt-f-in" data-mt-f="to" type="text" autocomplete="off"></label>' +
        '<div class="mt-f-sug" data-mt-sug="to" hidden></div>' +
        '<div class="mt-f-route" data-mt-f="route"></div>' +
        '<div class="mt-f-dir" hidden>' +
          '<button type="button" data-mt-fdir="shun" data-v="shun" data-mt-lbl="dir-shun" aria-pressed="false"></button>' +
          '<button type="button" data-mt-fdir="ni" data-v="ni" data-mt-lbl="dir-ni" aria-pressed="false"></button>' +
        '</div>' +
        '<div class="mt-f-via" hidden>' +
          '<button type="button" data-mt-fvia="mountain" data-v="mountain" data-mt-lbl="via-mountain" aria-pressed="true"></button>' +
          '<button type="button" data-mt-fvia="coast" data-v="coast" data-mt-lbl="via-coast" aria-pressed="false"></button>' +
        '</div>' +
        '<div class="mt-f-pattern">' +
          '<button type="button" data-mt-fpattern="all" data-v="all" data-mt-lbl="pattern-all" aria-pressed="true"></button>' +
          '<button type="button" data-mt-fpattern="major" data-v="major" data-mt-lbl="pattern-major" aria-pressed="false"></button>' +
          '<button type="button" data-mt-fpattern="express" data-v="express" data-mt-lbl="pattern-express" aria-pressed="false"></button>' +
        '</div>' +
        '<div class="mt-f-timewrap"><span class="mt-f-timelbl" data-mt-lbl="deptime"></span>' +
        '<div class="mt-f-time"><label class="mt-f-lbl"><span data-mt-lbl="hh"></span><input class="mt-f-num" data-mt-f="hh" type="number" min="0" max="23" inputmode="numeric"></label>' +
          '<label class="mt-f-lbl"><span data-mt-lbl="mm"></span><input class="mt-f-num" data-mt-f="mm" type="number" min="0" max="59" inputmode="numeric"></label></div></div>' +
        '<label class="mt-f-lbl"><span data-mt-lbl="name"></span><span class="mt-f-namecount" data-mt-f="namecount"></span><input class="mt-f-in" data-mt-f="name" type="text" maxlength="200" data-i18n-skip></label>' +
        '<div class="mt-f-preview" data-mt-f="preview"></div>' +
        '<div class="mt-f-reason" data-mt-f="reason" role="status" aria-live="polite" aria-atomic="true"></div>' +
      '</div>' +
      '<div class="mt-f-foot">' +
        '<button type="button" class="mt-btn" data-mt-f="cancel" data-mt-lbl="cancel"></button>' +
        '<button type="button" class="mt-btn mt-btn-accent" data-mt-f="depart" data-mt-lbl="depart" disabled></button>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('cancel', e => { e.preventDefault(); closeForm(); });
    el.querySelectorAll('[data-mt-f="cancel"]').forEach(b => b.onclick = () => closeForm());
    el.querySelector('[data-mt-f="depart"]').onclick = formSubmit;
    // 換了起站或訖站，方向回到新那組站的最短那邊（不沿用上一組選的順行／逆行）。
    el.querySelector('[data-mt-f="from"]').addEventListener('input', e => { formSel.from = null; formSel.dir = null; formFilterStations('from', e.target.value); formRecompute(); });
    el.querySelector('[data-mt-f="to"]').addEventListener('input', e => { formSel.to = null; formSel.dir = null; formFilterStations('to', e.target.value); formRecompute(); });
    for (const w of ['from', 'to']) for (const ev of ['focus', 'click']) el.querySelector(`[data-mt-f="${w}"]`).addEventListener(ev, () => formOpenSug(w));
    // 按到輸入框與它的清單以外的地方就收起清單。看 pointerdown 的目標,不看 click:清單在按下時才攤開,
    // 版面一推,click 會落到共同祖先(.mt-f-body)被當成點在外面。focusin 只管鍵盤 Tab 換到別的欄位——
    // WebKit 點按鈕不給按鈕焦點,焦點落在 dialog 本身,那一次不能算「離開」,否則站鈕還沒 click 清單就沒了。
    const closeSugOutside = e => {
      if (!formCtx || e.target === el) return;
      for (const w of ['from', 'to']) {
        const box = el.querySelector(`[data-mt-sug="${w}"]`);
        if (!box.hidden && !box.contains(e.target) && e.target !== el.querySelector(`[data-mt-f="${w}"]`)) formHideSug(w);
      }
    };
    el.addEventListener('pointerdown', closeSugOutside);
    el.addEventListener('focusin', closeSugOutside);
    el.querySelector('[data-mt-f="swap"]').onclick = () => {
      if (!formCtx) return;
      const a = el.querySelector('[data-mt-f="from"]'), b = el.querySelector('[data-mt-f="to"]');
      [formSel.from, formSel.to] = [formSel.to, formSel.from]; [a.value, b.value] = [b.value, a.value];
      formSel.dir = null;
      formRecompute();
    };
    el.querySelectorAll('[data-mt-fpattern]').forEach(b => b.onclick = () => { formSel.pattern = b.dataset.v; formSetPressed('[data-mt-fpattern]', b.dataset.v); formRecompute(); });
    el.querySelectorAll('[data-mt-fvia]').forEach(b => b.onclick = () => { formSel.via = b.dataset.v; formSetPressed('[data-mt-fvia]', b.dataset.v); formRecompute(); });
    el.querySelectorAll('[data-mt-fdir]').forEach(b => b.onclick = () => { formSel.dir = b.dataset.v; formSetPressed('[data-mt-fdir]', b.dataset.v); formRecompute(); });
    el.querySelector('[data-mt-f="hh"]').addEventListener('input', e => { formSel.hh = formParseHM(e.target.value); formRecompute(); });
    el.querySelector('[data-mt-f="mm"]').addEventListener('input', e => { formSel.mm = formParseHM(e.target.value); formRecompute(); });
    el.querySelectorAll('[data-mt-color]').forEach(b => b.onclick = () => { formSel.color = b.dataset.v; formSetPressed('[data-mt-color]', b.dataset.v); formRecompute(); });
    el.querySelector('[data-mt-f="name"]').addEventListener('input', () => { formRecompute(); formUpdateNameCount(); });
    el.querySelector('[data-mt-f="name"]').addEventListener('compositionend', formUpdateNameCount);
    formEl = el;
  }

  // host＝ownTrainHost();opts.modelId 必填,opts.preset 是儲存形狀(舊 saved.train)或 null,
  // opts.mode 是 'schedule'|'replan'|'edit'。失效的站(preset 裡的 key 在圖上查不到)留空。
  function openForm(host, opts = {}) {
    if (host.requireAccess && !host.requireAccess(() => openForm(host, opts))) return;
    formBuild();
    const modelId = opts.modelId, preset = opts.preset || null, mode = opts.mode || 'schedule';
    formMode = mode; formPreset = preset;
    const plan = host.plan();
    const model = plan.MODELS[modelId];
    if (!model) return;
    const sys = model.sys;
    const sd = host.systemData(sys);
    const graph = plan.buildGraph(sd.lines, sys);
    const stats = plan.buildRunStats(sys, sd.denseTrains, host.classOf, graph);
    formCtx = { host, sys, graph, stats, sd, modelId, tiers: plan.stationTiers(sys, sd.denseTrains, host.stnClassMap()) };
    // formBuild() 只建一次 DOM、當時不一定有 host,標籤改成每次開表單都重新翻(語言切換後跟著變)。
    for (const [k, zh] of Object.entries(FORM_LABELS)) {
      const lbl = formEl.querySelector(`[data-mt-lbl="${k}"]`);
      if (lbl) lbl.textContent = host.lang === 'zh-TW' && (k === 'dir-shun' || k === 'dir-ni') ? zh.slice(2) : host.t(zh);
    }
    formEl.querySelector('[data-mt-close]').setAttribute('aria-label', host.t('關閉'));
    if (opts.submit) formEl.querySelector('[data-mt-f="depart"]').textContent = opts.submit;

    const cat = (host.catalog() || {})[modelId];
    formEl.querySelector('.mt-f-title').textContent = host.t(mode === 'edit' ? '編輯這班車' : mode === 'replan' ? '重新排' : '自己排一班');
    formEl.querySelector('.mt-f-thumb').src = cat ? cat.thumbnail : '';
    formEl.querySelector('.mt-f-mname').textContent = cat ? host.t(cat.name) : modelId;
    formEl.querySelector('.mt-f-msys').textContent = cat ? host.t(cat.system) : '';

    const fromKey = preset && graph.nodes.has(preset.from) ? preset.from : null;
    const toKey = preset && graph.nodes.has(preset.to) ? preset.to : null;
    formSel = {
      from: fromKey, to: toKey, via: preset ? preset.via : null, dir: preset ? (preset.dir || null) : null,
      pattern: (preset && preset.pattern && !(sys === 'afr_sched' && preset.pattern === 'major')) ? preset.pattern : 'all',
      hh: 0, mm: 0, color: plan.normalizeColor(modelId, preset ? preset.color : undefined),
    };
    const depSec = preset ? preset.depSec : Math.round(host.simSec());
    formSel.hh = Math.floor((depSec % 86400) / 3600); formSel.mm = Math.floor((depSec % 3600) / 60);

    formEl.querySelector('[data-mt-f="from"]').value = fromKey ? host.stationName(graph.nodes.get(fromKey).name, sys) : '';
    formEl.querySelector('[data-mt-f="to"]').value = toKey ? host.stationName(graph.nodes.get(toKey).name, sys) : '';
    formEl.querySelector('[data-mt-f="hh"]').value = formSel.hh;
    formEl.querySelector('[data-mt-f="mm"]').value = formSel.mm;
    formEl.querySelector('[data-mt-f="name"]').value = preset ? preset.name : '';
    formHideSug('from'); formHideSug('to');
    for (const w of ['from', 'to']) formEl.querySelector(`[data-mt-f="${w}"]`).placeholder = host.t('輸入站名，或從清單選');
    formSetPressed('[data-mt-fpattern]', formSel.pattern);
    formSetPressed('[data-mt-fvia]', formSel.via || 'mountain');
    // 林鐵沒有「只停大站」
    formEl.querySelector('[data-mt-fpattern="major"]').hidden = sys === 'afr_sched';
    // 車牌顏色:選項只能是這台車自己系統的色盤;高鐵只有一色、不給選,整排藏掉。
    const colorEntries = Object.entries(plan.COLOR_PALETTE[sys] || {});
    formEl.querySelector('[data-mt-f="colorswrap"]').hidden = sys === 'thsr_sched';
    formEl.querySelectorAll('[data-mt-color]').forEach((b, i) => {
      const entry = colorEntries[i];
      b.hidden = !entry;
      if (entry) {
        b.dataset.v = entry[1];
        b.querySelector('i').style.setProperty('--c', entry[1]);
        b.querySelector('span').textContent = host.t(entry[0]);
      }
    });
    formSetPressed('[data-mt-color]', formSel.color);

    formRecompute();
    formUpdateNameCount();
    if (typeof formEl.showModal === 'function') formEl.showModal();
  }

  // 不論怎麼關(取消鈕、Esc/背景的 cancel 事件、成功送出之後),都把 formPlanned 清成
  // null——原本只有 dialog.close() 沒清掉,殘留的 formPlanned 讓已經取消的草稿還留著能被送出。
  function closeForm() {
    formPlanned = null;
    if (formEl && formEl.open) formEl.close();
  }

  globalThis.MyTrainUI = {
    STORAGE_KEY,
    LEGACY_KEY,
    newDevice: mtUuid,
    load: storeLoad,
    save: storeSave,
    mountPanel,
    updatePanel,
    unmountPanel,
    openForm,
    closeForm,
  };
})();
