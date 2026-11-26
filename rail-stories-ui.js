/* 沿線小故事（網站版）的畫面：字幕、配音、第一次跟車的試播邀請、車次卡與車站卡的一列、沿途清單與全文卡、觀看設定的開關。
 * 規則（哪一段出哪一則、字幕怎麼切、音檔網址）在 rail-stories.js；播放流程照 App 的 RailStories.kt（native m9/release-210-1126）：
 * 每秒一步、換頁看時間、換了不經過這裡的車就停、配音念到總長加 10 秒還沒完就放掉聲音改照字的節奏。
 * 只在中文介面出現（故事只有中文）。故事的字是故事線定的原檔，這裡只顯示、不改字。
 * 主程式（index.html）呼叫的入口：init、noteMetro、trainCardRow、boardRowHtml、closePanel；資料由主程式的 railStoriesFetch() 載。
 * 讀主程式的全域（state、effTLive、soloPanel…）都在執行期才讀，所以這支可以比主程式先載入。 */
(function (root) {
  'use strict';
  const R = root.RailStories;
  if (!R) return;

  const KEY_AUTO = 'trainmap-story-auto';     // '1'＝開；沒存過＝關
  const KEY_INVITE = 'trainmap-story-invite'; // 'done'＝答過不再問；數字＝試播過幾次
  const INVITE_MAX = 3;                       // 沒理它的話最多試播幾次（每次跟車一次）
  const DUCK = 0.25;                          // 念的時候配樂壓到幾成
  const SCHED = new Set(['tra_sched', 'thsr_sched', 'afr_sched']);

  const S = {
    book: null, loading: false, failed: false,
    auto: false,
    played: new Set(),     // 這次開網頁播過的故事：同一則不重播
    trialKeys: new Set(),  // 這次開網頁試播過的跟車（同一次跟車只試一次）
    play: null,            // { pass, pages, index, endsAt, voice, cuts, trial }
    ctx: null, follow: null, route: null, routeKey: null,
    metro: null,           // 主程式 updateFreqCard 送進來的捷運下一站與方向
    cardTr: null,          // 車次卡現在顯示的那班車（主程式 renderTrainCard 送進來）
    audio: null, voiceTok: 0, gesture: false, duck: null,
    cap: null, row: null, view: null, lastPanelHtml: '', lastTcHtml: null, lastFcHtml: null,
    warned: false,
  };

  // ── 小工具 ──
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const norm = s => String(s || '').replace(/臺/g, '台');
  const fn = name => (typeof root[name] === 'function' ? root[name] : null);
  const call = (name, ...a) => { const f = fn(name); if (f) { try { return f(...a); } catch (e) {} } return undefined; };
  const lang = () => { try { return typeof I18N_LANG === 'string' ? I18N_LANG : 'zh-TW'; } catch (e) { return 'zh-TW'; } };
  const available = () => lang() === 'zh-TW';
  const st = () => { try { return state; } catch (e) { return null; } };
  const mobile = () => { try { return root.matchMedia(MOBILE_MQ).matches; } catch (e) { return root.innerWidth <= 900; } };
  const bodyHas = c => document.body.classList.contains(c);
  const hm = sec => { const s = ((Math.round(sec) % 86400) + 86400) % 86400; return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0'); };
  const safeUrl = u => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');

  // ── 資料（要用時才載） ──
  function ensureBook() {
    if (S.book || S.loading || S.failed || !fn('railStoriesFetch')) return;
    S.loading = true;
    Promise.resolve(root.railStoriesFetch()).then(([stories, directions]) => {
      S.loading = false;
      S.book = R.parseBook(stories, directions);
      if (!S.book) { S.failed = true; return; }
      tick();
      const s = st();
      if (s && s.boardStation && document.getElementById('board') && !document.getElementById('board').hidden) call('renderBoard');
    }).catch(() => { S.loading = false; S.failed = true; });
  }

  // ── 正在跟的車 ──
  function trackLine(sys, id) {
    const s = st();
    return ((s && s.trackLines) || []).find(l => l.sys === sys && l.id === id) || null;
  }
  /** 現在跟的是哪一班：班表車（台鐵、高鐵、林鐵）或捷運；沒在跟＝null。amb＝放空中。 */
  function currentCtx() {
    const s = st(); if (!s) return null;
    const amb = !!s.ambient;
    const tr = s.followTrain;
    // 自製列車（isMyTrain）不放故事：自製車不准動到其他功能的狀態（試播次數也算；verify_my_train_isolation 的 localStorage 白名單）
    if (tr && SCHED.has(tr.sys) && tr.stops && tr.stops.length > 1 && !call('isMyTrain', tr)) {
      return { kind: 'sched', tr, amb, key: 'S|' + tr.sys + '|' + tr.train + '|' + (tr._rday || '') + '|' + tr.stops.length };
    }
    const m = S.metro;
    if (s.freqFollow && m && m.ln && Date.now() - m.at < 5000) {
      const sys = call('freqSysIdOf', m.ln) || m.ln._sys;
      const names = (m.ln.stations || []).map(x => x.name);
      const step = R.metroStep(names.map(norm), m.next != null ? norm(m.next) : null, m.dest != null ? norm(m.dest) : null, m.routeDirection, null);
      if (!sys || !step) return null;
      return { kind: 'metro', ln: m.ln, sys, names, step, amb, key: 'M|' + sys + '|' + m.ln.id + '|' + step };
    }
    return null;
  }
  function routeFor(c) {
    if (S.routeKey === c.key && S.route) return S.route;
    let route;
    if (c.kind === 'sched') {
      const tr = c.tr;
      let names = tr.stops.map(x => x.name), arr = tr.stops.map(x => x.arrSec), dep = tr.stops.map(x => x.depSec);
      // 網站的高鐵班表只有停靠站：補上通過站，直達車才碰得到綁在跳過站的故事
      if (tr.sys === 'thsr_sched') {
        const ln = trackLine('thsr_sched', 'THSR');
        if (ln) { const w = R.withPassStations(names, arr, dep, ln.stations); names = w.names; arr = w.arrSec; dep = w.depSec; }
      }
      route = R.schedRoute(S.book, tr.sys, names, arr, dep, id => { const ln = trackLine(tr.sys, id); return ln ? ln.stations.map(x => x.name) : null; });
    } else {
      route = R.metroRoute(S.book, c.sys, c.ln.id, c.names, c.step);
    }
    S.route = route; S.routeKey = c.key;
    return route;
  }
  function followNow(c) {
    const route = routeFor(c);
    if (!route || !route.passes.length) return null;
    if (c.kind === 'sched') return R.follow(route, root.effTLive(c.tr), 0);
    const m = S.metro;
    const at = m.done ? route.names.length : route.names.findIndex(n => norm(n) === norm(m.next));
    return at < 0 ? null : R.follow(route, 0, 0, at);
  }
  /** 開進那一段的時刻（含即時誤點），捷運沒有逐站時刻＝''。 */
  function passClock(c, p) {
    if (!c || c.kind !== 'sched') return '';
    const s = st();
    return hm(s.simSec + (p.enterSec - root.effTLive(c.tr)));
  }

  // ── 每秒一步 ──
  function tick() {
    try { step(); } catch (e) { if (!S.warned) { S.warned = true; console.warn('沿線小故事', e); } }
  }
  function step() {
    const on = available();
    if (S.row) S.row.hidden = !on;
    if (!on) {
      if (S.play) stopPlay();
      S.ctx = S.follow = null;
      paintCap(); renderTcRow();
      if (S.view) closePanel();
      return;
    }
    // 中文介面一開就把故事載好：看板、車次卡的那一列要在第一次畫的時候就在，晚一拍才插進來會把下面的內容往下推
    //（看板剛把公車槽捲進畫面，就被推出看板底；verify_query_tab G8b）。中途切回中文也從這裡補載。
    if (!S.book) ensureBook();
    const c = currentCtx();
    if (c && !S.book) ensureBook();
    S.ctx = c;
    S.follow = c && S.book ? followNow(c) : null;
    renderTcRow();
    if (S.view && S.view.kind === 'list') renderPanel(false);
    stepPlay(S.follow, c);
    keepDuck();
    paintCap();
  }

  /** 'auto'＝開關開著；'trial'＝還沒答過的人第一次跟車（不含放空）試播一則；null＝不播。放空只有「跟車」視角播，群車不播。 */
  function playMode(c) {
    if (!c) return null;
    const s = st();
    if (c.amb && s.ambientStyle !== 'follow') return null;
    if (S.auto) return 'auto';
    if (!c.amb && inviteOpen() && !S.trialKeys.has(c.key)) return 'trial';
    return null;
  }
  // 手機的營運公告展開時蓋在頂端，字幕的鈕會被它壓住：這時不開播、已在播的先收起來
  const alertOpen = () => { const e = document.getElementById('alertDetail'); return !!e && !e.hidden; };
  function canStart() {
    if (document.hidden) return false;
    const p = document.getElementById('storyPanel');
    if (p && !p.hidden) return false;
    if (mobile() && (bodyHas('sheet-open') || alertOpen())) return false;
    return !bodyHas('ride-picking');
  }
  function stepPlay(f, c) {
    const now = Date.now();
    const p = S.play;
    if (p) {
      const s = st();
      if (!f || (!p.trial && !S.auto) || (c.amb && s.ambientStyle !== 'follow')) { stopPlay(); return; }
      // 換了一班不經過這裡的車（放空會自己換車）：停。車只是開出這一段的話讓它播完。
      if (!f.passes.some(x => x.story.id === p.pass.story.id)) { stopPlay(); return; }
      if (now < p.endsAt) return;
      if (p.voice) { // 有聲音的那一則時間到了還沒念完（斷線卡住）：聲音放掉，剩下的照字的節奏
        stopVoice(); p.voice = false; p.cuts = null; p.endsAt = now + R.playPageMs(p.pages[p.index]); return;
      }
      if (p.index + 1 < p.pages.length) { p.index++; p.endsAt = now + R.playPageMs(p.pages[p.index]); return; }
      S.play = null;
    }
    if (!f) return;
    const mode = playMode(c);
    if (!mode || !canStart()) return;
    const pass = f.current(S.played);
    if (!pass) return;
    const pages = R.playPages(pass);
    if (!pages.length) return;
    S.played.add(pass.story.id);
    if (mode === 'trial') { S.trialKeys.add(c.key); bumpInvite(); }
    S.play = { pass, pages, index: 0, endsAt: now + R.playPageMs(pages[0]), voice: false, cuts: null, trial: mode === 'trial' };
    if (mode === 'auto') startVoice(pass);
  }
  function stopPlay() {
    S.play = null;
    stopVoice();
  }

  // ── 試播邀請 ──
  function inviteOpen() {
    const v = store.get(KEY_INVITE);
    return v !== 'done' && (parseInt(v, 10) || 0) < INVITE_MAX;
  }
  function bumpInvite() { store.set(KEY_INVITE, String((parseInt(store.get(KEY_INVITE), 10) || 0) + 1)); }
  function inviteDone() { store.set(KEY_INVITE, 'done'); }

  // ── 開關 ──
  function setAuto(on) {
    S.auto = !!on;
    store.set(KEY_AUTO, on ? '1' : '0');
    if (on) { inviteDone(); prime(); } else if (S.play && !S.play.trial) stopPlay();
    syncRow();
    paintCap();
  }

  // ── 配音 ──
  function audioEl() {
    if (!S.audio) { S.audio = new Audio(); S.audio.preload = 'auto'; }
    return S.audio;
  }
  function userActive() {
    try { return S.gesture || !!(navigator.userActivation && navigator.userActivation.hasBeenActive); } catch (e) { return S.gesture; }
  }
  /** 瀏覽器規定點過畫面才出聲；iOS 還要在點的那一下讓同一個 audio 播過一次。之後都重用它。 */
  function prime() {
    S.gesture = true;
    if (!S.auto || (S.play && S.play.voice)) return;
    const a = audioEl();
    if (a.getAttribute('src')) return;
    try {
      const u32 = v => String.fromCharCode(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
      const u16 = v => String.fromCharCode(v & 255, (v >> 8) & 255);
      const n = 400;
      a.src = 'data:audio/wav;base64,' + btoa('RIFF' + u32(36 + n) + 'WAVEfmt ' + u32(16) + u16(1) + u16(1) + u32(8000) + u32(8000) + u16(1) + u16(8) + 'data' + u32(n) + '\x80'.repeat(n));
      const tok = ++S.voiceTok;
      const pr = a.play();
      if (pr && pr.then) pr.then(() => { if (tok === S.voiceTok) { a.pause(); a.removeAttribute('src'); } }).catch(() => {});
    } catch (e) {}
  }
  function onGesture() {
    const first = !S.gesture;
    S.gesture = true;
    if (first) prime();
  }
  function startVoice(pass) {
    if (!S.auto || !userActive()) return; // 還沒點過畫面：這一則只有字
    const a = audioEl();
    const tok = ++S.voiceTok, id = pass.story.id;
    const mine = () => tok === S.voiceTok && S.play && S.play.pass.story.id === id;
    a.onplaying = () => {
      if (tok !== S.voiceTok) return;
      const p = S.play, total = a.duration * 1000;
      // 名稱那一頁還在的時候載到了，才改成跟著聲音走；來不及就放掉聲音，照字的節奏
      if (!mine() || p.index !== 0 || p.voice || !Number.isFinite(total) || total <= 0) { if (!p || !p.voice || !mine()) stopVoice(); return; }
      p.pages = R.voicePages(p.pass); p.cuts = R.voiceCuts(p.pages, total); p.voice = true; p.index = 0;
      p.endsAt = Date.now() + total + 10000;
      duck(); paintCap();
    };
    a.ontimeupdate = () => {
      const p = S.play;
      if (!mine() || !p.voice || !p.cuts) return;
      const i = R.voicePage(p.cuts, a.currentTime * 1000);
      if (i !== p.index && i < p.pages.length) { p.index = i; paintCap(); }
    };
    const done = finished => {
      if (tok !== S.voiceTok) return;
      unduck();
      const p = S.play;
      if (!mine() || !p.voice) return;
      p.voice = false; p.cuts = null;
      if (finished) { S.play = null; paintCap(); } else p.endsAt = Date.now() + R.playPageMs(p.pages[p.index]);
    };
    a.onended = () => done(true);
    a.onerror = () => done(false);
    a.src = R.voiceUrl(pass);
    try { const pr = a.play(); if (pr && pr.catch) pr.catch(() => done(false)); } catch (e) { done(false); }
  }
  function stopVoice() {
    S.voiceTok++;
    const a = S.audio;
    if (a) { try { a.pause(); a.onplaying = a.ontimeupdate = a.onended = a.onerror = null; a.removeAttribute('src'); a.load(); } catch (e) {} }
    unduck();
  }
  // 念的時候配樂壓到 25%；iOS 網頁不能調音量，改成先暫停、念完接著放。
  function music() { const s = st(); return s && s.music && s.music.audio ? s.music : null; }
  function duck() {
    const m = music();
    if (S.duck || !m || !m.enabled || m.audio.paused) return;
    if (bodyHas('music-volume-unavailable')) { m.audio.pause(); S.duck = { paused: true }; return; }
    S.duck = { vol: true };
    if (fn('musicRamp')) root.musicRamp(m.vol * DUCK, 400); else m.audio.volume = m.vol * DUCK;
  }
  function keepDuck() { // 念到一半換曲：主程式會把音量設回原值，這裡每秒壓回去
    const m = music();
    if (!S.duck || !S.duck.vol || !m || m.audio.paused) return;
    if (m.audio.volume > m.vol * DUCK + 0.02) { clearInterval(m._fade); m.audio.volume = m.vol * DUCK; }
  }
  function unduck() {
    const d = S.duck, m = music();
    S.duck = null;
    if (!d || !m || !m.enabled) return;
    if (d.paused) { try { const pr = m.audio.play(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) {} return; }
    if (!m.audio.paused) { if (fn('musicRamp')) root.musicRamp(m.vol, 800); else m.audio.volume = m.vol; }
  }

  // ── 字幕卡 ──
  function capEl() {
    if (S.cap) return S.cap;
    const stage = document.querySelector('.stage');
    if (!stage) return null;
    const el = document.createElement('div');
    el.className = 'story-cap'; el.id = 'storyCap'; el.hidden = true;
    el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="sc-name"></div><div class="sc-text"></div>' +
      '<button type="button" class="sc-x" aria-label="關閉這則故事">×</button>' +
      '<div class="sc-ask" hidden><span>之後每段都這樣播？</span><button type="button" class="no">不用</button><button type="button" class="yes">打開</button></div>';
    el.addEventListener('click', e => {
      const p = S.play;
      if (!p) return;
      if (e.target.closest('.sc-x')) { if (p.trial) inviteDone(); stopPlay(); paintCap(); return; }
      if (e.target.closest('.sc-ask .no')) { inviteDone(); stopPlay(); paintCap(); return; }
      if (e.target.closest('.sc-ask .yes')) {
        // 打開＝開關打開、這一則從頭念
        const pass = p.pass;
        setAuto(true);
        const pages = R.playPages(pass);
        S.play = { pass, pages, index: 0, endsAt: Date.now() + R.playPageMs(pages[0]), voice: false, cuts: null, trial: false };
        startVoice(pass);
        paintCap();
        return;
      }
      if (e.target.closest('.sc-text') && !el.classList.contains('sc-ambient')) openCard({ pass: p.pass, back: { kind: 'list' } });
    });
    stage.append(el);
    S.cap = el;
    return el;
  }
  function capVisible() {
    if (document.hidden) return false;
    const p = document.getElementById('storyPanel');
    if (p && !p.hidden) return false;
    if (mobile() && (bodyHas('sheet-open') || alertOpen())) return false;
    return !bodyHas('ride-picking');
  }
  function paintCap() {
    const p = S.play;
    if (!p) { if (S.cap) S.cap.hidden = true; return; }
    const el = capEl();
    if (!el) return;
    if (!available() || !capVisible()) { el.hidden = true; return; }
    const s = st();
    const amb = !!(s && s.ambient);
    el.classList.toggle('sc-ambient', amb);
    el.classList.toggle('sc-mobile', mobile());
    const name = el.querySelector('.sc-name'), text = el.querySelector('.sc-text'), ask = el.querySelector('.sc-ask');
    const label = p.index === 0 ? p.pass.tag : p.pass.story.name; // 同 App：名稱那一頁上面放地點與哪側看得到，之後放名稱
    if (name.textContent !== label) name.textContent = label;
    const page = p.pages[p.index] || '';
    if (text.textContent !== page) text.textContent = page;
    ask.hidden = !p.trial || amb;
    const shown = el.hidden;
    el.hidden = false;
    place(el);
    if (shown) relayout(); // 剛出現這一拍旁邊的鈕可能還在搬（見 relayout）
  }
  // 字幕位置要讓開的東西會在字幕出現之後才動：觀看鈕是 view-controls.js 晚一點才放進 #mapActions 那排（手機橫放跟車時，
  // 字幕第一次量的時候它還不在，字幕就壓在它上面，等下一秒重排才讓開；verify_view_btn_side_entry 量到過），
  // 跟車欄開合、卡片開關、放空也會改 body 的 class 讓那排鈕換位置。這些變動一發生就隔兩拍再量一次。
  let relayId = 0;
  function relayout() {
    if (relayId) return;
    relayId = root.requestAnimationFrame(() => root.requestAnimationFrame(() => { relayId = 0; paintCap(); }));
  }
  /** 照當下版面量位置：電腦跟車＝地圖下方「隨機跟隨」上面；電腦放空＝站台帶上面、空出來那塊的正中間；
   *  手機放空＝左下跟車卡上面；手機跟車＝頂部時間膠囊下面、讓開右邊那排鈕。 */
  function place(el) {
    const box = el.offsetParent || el.parentElement;
    if (!box) return;
    const vis = q => {
      const e = typeof q === 'string' ? document.querySelector(q) : q;
      if (!e || e.hidden || e.closest('[hidden]')) return null;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? r : null;
    };
    const B = box.getBoundingClientRect();
    const s = st();
    const amb = !!(s && s.ambient), mob = mobile();
    let L = B.left + 10, Rr = B.right - 10, maxW, top = null, bottom = null, center = null;
    const sheet = !mob ? vis(document.querySelector('.board:not([hidden])')) : null;
    if (sheet && sheet.left > B.left + B.width / 2) Rr = Math.min(Rr, sheet.left - 12);
    const rail = !mob ? vis('#viewDock .view-rail') : null;
    if (rail && rail.left > B.left + B.width / 2) Rr = Math.min(Rr, rail.left - 10);
    const fp = vis('#followPanel') || vis('#freqCard');
    const ctl = vis('.controls');
    if (!mob && !amb) {
      const rb = vis('#randBtn');
      bottom = rb ? rb.top - 10 : ctl ? ctl.top - 12 : B.bottom - 16;
      center = rb ? rb.left + rb.width / 2 : null;
      if (fp && fp.right < B.left + B.width / 2 && fp.bottom > bottom - 60) L = Math.max(L, fp.right + 12);
      maxW = 580;
    } else if (!mob && amb) {
      bottom = (ctl ? ctl.top : B.bottom) - 12;
      if (fp && fp.right < B.left + B.width / 2) L = Math.max(L, fp.right + 16);
      maxW = 660;
    } else if (mob && amb) {
      bottom = (fp ? fp.top : ctl ? ctl.top : B.bottom - 8) - 10;
      if (fp) L = Math.max(L, fp.left);
      maxW = 420;
    } else {
      const badge = vis('#statBadge');
      top = (badge ? badge.bottom : B.top + 56) + 10;
      for (const q of ['#mapActions > *', '#followLockBtn', '#viewSettingsBtn']) {
        for (const e of document.querySelectorAll(q)) {
          const r = vis(e);
          if (r && r.left > B.left + B.width / 2 && r.top < top + 140 && r.bottom > top - 4) Rr = Math.min(Rr, r.left - 8);
        }
      }
      L = B.left + 8;
      maxW = 520;
    }
    const w = Math.max(160, Math.min(maxW, Rr - L));
    let x = center == null ? L + (Rr - L - w) / 2 : Math.min(Math.max(center - w / 2, L), Rr - w);
    el.style.width = w + 'px';
    el.style.left = Math.round(x - B.left - box.clientLeft) + 'px';
    const h = el.offsetHeight;
    const y = top != null ? top : bottom - h;
    el.style.top = Math.round(Math.max(B.top + 6, y) - B.top - box.clientTop) + 'px';
  }

  // ── 車次卡「沿途故事」那一列 ──
  function trainCardRow(tr) {
    S.cardTr = tr || null;
    if (available() && tr && SCHED.has(tr.sys) && !S.book) ensureBook();
    S.lastTcHtml = null;
    renderTcRow();
  }
  /** 車次卡（班表車 #tcStories）與捷運跟車卡（#fcStories）的「沿途故事」那一列，同 App StoryTrainRow：幾則＋下一則（班表車加「約幾點」）。 */
  function renderTcRow() {
    const c = S.ctx, f = S.follow;
    const rowHtml = () => {
      const next = f.next(), clock = next ? passClock(c, next) : '';
      return '<span class="rl">沿途故事</span><b>' + f.count + ' 則</b><span class="rs">' + (next ? esc('下一則：' + next.story.name + (clock ? '・約 ' + clock : '')) : '') +
        '</span><span class="chev" aria-hidden="true">›</span>';
    };
    const on = available() && c && f;
    const tc = on && c.kind === 'sched' && S.cardTr === c.tr ? rowHtml() : '';
    const fc = on && c.kind === 'metro' ? rowHtml() : '';
    for (const [id, html, key] of [['tcStories', tc, 'lastTcHtml'], ['fcStories', fc, 'lastFcHtml']]) {
      const el = document.getElementById(id);
      if (!el || html === S[key]) continue;
      S[key] = html;
      el.innerHTML = html;
      el.hidden = !html;
    }
  }

  // ── 車站卡「這站的故事」那一列 ──
  function stationStories(name, systems) {
    if (!S.book) return [];
    const k = norm(name);
    return S.book.stories.filter(s => s.stations.length === 1 && norm(s.stations[0]) === k && (!systems || !systems.length || systems.includes(s.system)))
      .map((s, i) => [s, i]).sort((a, b) => a[0].rank - b[0].rank || a[1] - b[1]).map(x => x[0]);
  }
  function boardRowHtml(name, systems) {
    if (!available() || !name) return '';
    if (!S.book) { ensureBook(); return ''; }
    const list = stationStories(name, systems);
    if (!list.length) return '';
    return '<button type="button" class="story-brow" data-story-stn="' + esc(name) + '" data-story-sys="' + esc((systems || []).join(',')) + '">' +
      '<b>這站的故事</b><span class="rs">' + esc(list.length === 1 ? list[0].name : list.length + ' 則') + '</span>' +
      '<span class="chev" aria-hidden="true">›</span></button>';
  }

  // ── 沿途清單、這站的故事、全文卡（.board 家族的面板 #storyPanel） ──
  function openList() { openView({ kind: 'list', seen: false }); }
  function openStation(name, systems, boardSt) { // 同 App：這站只有一則就直接開全文
    const list = stationStories(name, systems);
    if (list.length === 1) openCard({ story: list[0], back: { kind: 'board', name, boardSt } });
    else openView({ kind: 'stn', name, systems, boardSt });
  }
  function openCard(v) { openView(Object.assign({ kind: 'card' }, v)); }
  function openView(view) {
    const el = document.getElementById('storyPanel');
    if (!el || !available()) return;
    const wasOpen = !el.hidden;
    if (!wasOpen) call('notePanelOpener', 'storyPanel');
    call('soloPanel', 'story'); // 手機：關掉其他底部面板
    if (!mobile()) for (const n of ['closeBoard', 'closeFavPanel', 'closeRidePanel', 'closeExplorePanel', 'closeTrackPanel', 'closeTodayPanel',
      'closeDelayHist', 'closePinCard', 'closeNearbyStations', 'closeSugarCard', 'closeBusStopPanel', 'closeSearchPanel']) call(n);
    S.view = view;
    el.hidden = false;
    el.onclick = onPanelClick;
    renderPanel(true);
    call('updateSheetOpenClass');
    if (!wasOpen) call('panelFocusIn', 'storyPanel');
    paintCap();
  }
  /** [handover]＝別的面板正在接手（主程式 notePanelOpener／soloPanel 叫的）：焦點不搬回這個面板的入口。 */
  function closePanel(handover) {
    // 主程式每開一張面板都會先叫這裡（handover）：面板要等這一拍畫出來，兩幀後馬上重排字幕讓開它，不等下一秒的 tick
    if (handover) root.requestAnimationFrame(() => root.requestAnimationFrame(paintCap));
    const el = document.getElementById('storyPanel');
    if (!el || el.hidden) { S.view = null; return; }
    const back = handover ? null : call('panelFocusBack', 'storyPanel');
    el.hidden = true; el.innerHTML = ''; el.onclick = null;
    S.view = null; S.lastPanelHtml = '';
    call('updateSheetOpenClass');
    if (typeof back === 'function') back();
    paintCap();
  }
  function head(title) {
    return '<h3><span>' + esc(title) + '</span><button class="close" type="button" aria-label="關閉">×</button></h3>';
  }
  function followLabel(c) {
    if (!c) return '';
    if (c.kind === 'sched') {
      const kind = call('trainDisplayKind', c.tr) || c.tr.typeName || '';
      const no = call('trainDisplayNo', c.tr) || c.tr.train;
      return (kind ? kind + ' ' : '') + no;
    }
    return call('metroLineFullLabel', c.ln) || c.ln.name || '';
  }
  function listHtml(v) {
    const c = S.ctx, f = S.follow;
    if (!c || !f) return head('沿途故事') + '<div class="sp-empty">沒有在跟車。跟著一班車，這裡會列出它沿途經過的故事。</div>';
    const items = v.seen ? f.passes.filter(p => p.story.notifiable) : f.passes;
    let h = head(followLabel(c) + ' 沿途故事') +
      '<div class="sp-seg" role="group" aria-label="篩選"><button type="button" data-seen="0" class="' + (v.seen ? '' : 'on') + '" aria-pressed="' + !v.seen + '">全部 ' + f.count + '</button>' +
      '<button type="button" data-seen="1" class="' + (v.seen ? 'on' : '') + '" aria-pressed="' + !!v.seen + '">車上看得到 ' + f.seenCount + '</button></div>';
    let lastState = null;
    for (const p of items) {
      const state = f.state(p);
      const label = state === lastState ? '' : state === 'past' ? '經過了' : state === 'now' ? '現在' : '接下來';
      lastState = state;
      const clock = passClock(c, p);
      const time = clock ? (state === 'ahead' ? '約 ' + clock : clock) : '';
      h += '<button type="button" class="sp-li ' + state + (c.kind === 'sched' ? '' : ' nost') + '" data-i="' + f.passes.indexOf(p) + '">' +
        (c.kind === 'sched' ? '<i>' + label + '</i>' : '') +
        '<span>' + esc(p.story.name) + '<small>' + esc(p.tag) + '</small></span><em>' + (c.kind === 'sched' ? esc(time) : esc(label)) + '</em></button>';
    }
    if (!items.length) h += '<div class="sp-empty">這一班沿途沒有車上看得到的故事。</div>';
    return h;
  }
  function stnHtml(v) {
    const list = stationStories(v.name, v.systems);
    let h = head(v.name + '站的故事');
    for (const s of list) h += '<button type="button" class="sp-li nost" data-id="' + esc(s.id) + '"><span>' + esc(s.name) + '<small>' + esc(s.visibleLabel) + '</small></span><em></em></button>';
    if (!list.length) h += '<div class="sp-empty">這站沒有故事。</div>';
    if (v.boardSt) h += '<button type="button" class="sp-foot" data-back="board">‹ 回' + esc(v.name) + '看板</button>';
    return h;
  }
  function cardHtml(v) {
    const story = v.pass ? v.pass.story : v.story;
    if (!story) return head('沿線小故事');
    const text = v.pass ? v.pass.text : story.story;
    const placeLine = v.pass ? v.pass.placeLine : story.lineName + '・' + story.place;
    let h = head('沿線小故事') + '<div class="sp-card">' +
      '<div class="sp-name">' + esc(story.name) + '</div>' +
      '<div class="sp-tags">' + (story.category ? '<span class="sp-tag">' + esc(story.category) + '</span>' : '') +
      '<span class="sp-tag' + (story.notifiable ? ' ok' : '') + '">' + esc(v.pass ? v.pass.tag.split('・').pop() : story.visibleLabel) + '</span></div>' +
      '<div class="sp-place">' + esc(placeLine) + '</div>' +
      (story.intro ? '<p class="sp-intro">' + esc(story.intro) + '</p>' : '') +
      '<p class="sp-text">' + esc(text) + '</p>';
    if (story.sources.length) {
      h += '<div class="sp-src">' + story.sources.map(s => {
        const u = safeUrl(s.url);
        return '出處：' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(s.title) + ' ↗</a>' : esc(s.title));
      }).join('<br>') + '</div>';
    }
    h += '</div>';
    const back = v.back || null;
    if (back && back.kind === 'list' && S.follow) h += '<button type="button" class="sp-foot" data-back="list">這班車沿途 ' + S.follow.count + ' 則故事 ›</button>';
    else if (back && back.kind === 'stn') h += '<button type="button" class="sp-foot" data-back="stn">‹ ' + esc(back.name) + '站的故事</button>';
    else if (back && back.kind === 'board' && back.boardSt) h += '<button type="button" class="sp-foot" data-back="board">‹ 回' + esc(back.name) + '看板</button>';
    return h;
  }
  function renderPanel(force) {
    const el = document.getElementById('storyPanel');
    const v = S.view;
    if (!el || el.hidden || !v) return;
    const html = v.kind === 'list' ? listHtml(v) : v.kind === 'stn' ? stnHtml(v) : cardHtml(v);
    if (!force && html === S.lastPanelHtml) return; // 內容沒變不重寫：每秒重寫會讓點擊落空
    const keep = !force ? el.scrollTop : 0;
    S.lastPanelHtml = html;
    el.innerHTML = html;
    el.scrollTop = keep;
    if (force && v.kind === 'list') {
      const now = el.querySelector('.sp-li.now') || el.querySelector('.sp-li.ahead');
      if (now) now.scrollIntoView({ block: 'center' });
    }
  }
  function onPanelClick(e) {
    const v = S.view;
    if (!v) return;
    if (e.target.closest('h3 .close')) { closePanel(); return; }
    const seg = e.target.closest('.sp-seg button');
    if (seg) { v.seen = seg.dataset.seen === '1'; renderPanel(true); return; }
    const li = e.target.closest('.sp-li');
    if (li) {
      if (v.kind === 'list' && S.follow) {
        const p = S.follow.passes[+li.dataset.i];
        if (p) openCard({ pass: p, back: { kind: 'list', seen: v.seen } });
      } else if (v.kind === 'stn' && S.book) {
        const s = S.book.story(li.dataset.id);
        if (s) openCard({ story: s, back: v });
      }
      return;
    }
    const back = e.target.closest('.sp-foot');
    if (back) {
      const k = back.dataset.back;
      if (k === 'list') openView({ kind: 'list', seen: !!(v.back && v.back.seen) });
      else if (k === 'stn' && v.back) openView(v.back);
      else if (k === 'board') { const bs = v.boardSt || (v.back && v.back.boardSt); if (bs) { closePanel(); call('openBoard', bs); } }
    }
  }

  // ── 觀看設定「畫面」那一列（背景音樂下面） ──
  function makeRow() {
    const row = document.createElement('button');
    row.className = 'ms-row'; row.id = 'storyRow'; row.type = 'button'; row.setAttribute('role', 'switch');
    row.innerHTML = '<span class="sr-copy"><b>沿線小故事</b><small>跟車或放空時，車開進有故事的路段就出字幕、念出來</small></span><span class="toggle"></span>';
    row.addEventListener('click', () => setAuto(!S.auto));
    S.row = row;
    syncRow();
    const place = () => {
      let a = document.querySelector('.ms-row[data-proxy="musicBtn"]');
      if (!a) return false;
      if (a.nextElementSibling && a.nextElementSibling.id === 'homeOpeningRow') a = a.nextElementSibling;
      if (a.nextElementSibling !== row) a.after(row);
      return !!root.railViewControls;
    };
    if (!place()) { let n = 0; const iv = setInterval(() => { if (place() || ++n > 120) clearInterval(iv); }, 500); }
  }
  function syncRow() {
    if (!S.row) return;
    S.row.hidden = !available();
    const tg = S.row.querySelector('.toggle');
    if (tg) tg.classList.toggle('on', S.auto);
    S.row.setAttribute('aria-checked', String(S.auto));
  }

  // ── 主程式呼叫的入口 ──
  /** 捷運跟車卡每次更新時送進來（主程式 updateFreqCard）：下一站、終點、環線方向。 */
  function noteMetro(ln, info) {
    if (!ln || !info) return;
    S.metro = { ln, next: info.nextName, dest: info.termName, routeDirection: info.loop ? info.routeDirection : null, done: !!info.done, at: Date.now() };
  }
  let started = false;
  function init() {
    if (started) return;
    started = true;
    S.auto = store.get(KEY_AUTO) === '1';
    makeRow();
    if (available()) ensureBook(); // 理由同 step() 開頭：別等第一次開看板才載
    document.addEventListener('pointerdown', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
    // 車次卡那一列、車站卡那一列：看板每隔一陣子整張重畫，所以用委派
    document.addEventListener('click', e => {
      const t = e.target.closest && e.target.closest('#tcStories, #fcStories, .story-brow');
      if (!t) return;
      e.stopPropagation(); e.preventDefault();
      if (t.id === 'tcStories' || t.id === 'fcStories') { openList(); return; }
      const s = st();
      openStation(t.dataset.storyStn, (t.dataset.storySys || '').split(',').filter(Boolean), s && s.boardStation ? s.boardStation : null);
    }, true);
    document.addEventListener('visibilitychange', paintCap);
    new MutationObserver(relayout).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const actions = document.getElementById('mapActions');
    // 觀看鈕是「插進」這排、再改 class 搬到跟車欄左邊，排本身的大小不一定變，所以看子節點與它們的 class／style
    if (actions) new MutationObserver(relayout).observe(actions, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    const ad = document.getElementById('alertDetail'); // 公告一展開就收字幕（見 alertOpen）
    if (ad) new MutationObserver(relayout).observe(ad, { attributes: true, attributeFilter: ['hidden'] });
    root.addEventListener('resize', paintCap);
    setInterval(tick, 1000);
  }

  root.RailStoriesUI = { init, noteMetro, trainCardRow, boardRowHtml, closePanel, _s: S, _tick: tick };
})(typeof globalThis === 'object' ? globalThis : this);
