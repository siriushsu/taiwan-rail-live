// 機務段頁:六股車隊的總覽、點車特寫、資訊畫框、親手發車。3D 在 rail-3d/roundhouse-stage.js,這裡只管畫面上的字與按鈕。
// 資料與動作全走 host(index.html 的 ownTrainDepotHost),本檔不讀存檔、不碰地圖。
// 一格 row:{n,state:'home'|'out'|'empty',id,name,modelId,kind,from,to,line,time,first,stats,demo,issue,block}。block 是不能親手發車的原因。
(function () {
  'use strict';
  const TRACKS = 6;
  const PERIODS = [['day', '白天'], ['dusk', '黃昏'], ['night', '夜晚']];
  const ICON = {
    l: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    r: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };
  let host = null, dialog = null, stage = null, rows = [], cur = -1, picking = false, opening = 0, timer = 0, observer = null, departing = false, shown = false, leaving = false;
  let chipsNow = '', frameNow = '', frameTrack = -1; // 上次畫的內容:每 20 秒重算一次,沒變就別動 DOM,手指點到一半的格子和捲到一半的畫框才不會被換掉
  const $ = s => dialog.querySelector(s);
  const tr = (key, values) => host.t(key, values);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const narrow = () => matchMedia('(max-width:759px),(orientation:portrait)').matches;
  // 手機照車庫場景的規矩(不畫陰影、像素比 1)。
  const lite = () => matchMedia('(pointer:coarse) and (hover:none)').matches;

  // 鏡頭要避開的範圍:總覽避開頂列與底下的選車列,特寫避開畫框。
  function layout() {
    const frame = $('.md-frame');
    return {
      top: $('.md-ctl').getBoundingClientRect().bottom + 6, bottom: $('.md-dock').offsetHeight + 6,
      side: narrow() ? 0 : frame.offsetWidth + 16, under: narrow() ? frame.offsetHeight : 0, narrow: narrow(),
    };
  }
  function chipHTML(r, i) {
    const sub = r.state === 'home' ? tr('{time} 開', { time: r.time }) : r.state === 'out' ? tr('出勤中') : tr('排一班');
    const cls = r.state === 'home' ? '' : r.state;
    return `<button class="md-chip ${cls}" type="button" data-i="${i}"><i>${r.n}</i><b data-i18n-skip>${esc(r.name || tr('空股'))}</b><small>${esc(sub)}</small></button>`;
  }
  function showChips() {
    const box = $('.md-chips'), html = rows.map(chipHTML).join('');
    if (html !== chipsNow) { box.innerHTML = chipsNow = html; }
    for (const c of box.children) c.setAttribute('aria-pressed', String(+c.dataset.i === cur));
    const own = rows.filter(r => r.id), km = own.reduce((n, r) => n + r.stats.km, 0);
    $('.md-fleet').textContent = own.length ? tr('{count} 列車 · {km} 公里', { count: own.length, km: fmt(km) }) : '';
  }
  const frameHead = r => `<div class="md-fh"><b>${esc(tr('第 {n} 股', { n: r.n }))}</b><div class="md-nav">
    <button type="button" data-a="prev" aria-label="${esc(tr('上一股'))}">${ICON.l}</button><button type="button" data-a="next" aria-label="${esc(tr('下一股'))}">${ICON.r}</button>
    <button type="button" data-a="back" aria-label="${esc(tr('回全景'))}">${ICON.x}</button></div></div>`;
  function emptyHTML(r) {
    if (!picking) {
      const go = r.block === 'pass_required' ? `<button class="md-btn" type="button" data-a="pass">${esc(tr('開通行證才能發車'))}</button>`
        : `<button class="md-btn navy" type="button" data-a="pick">${esc(tr('排一班'))}</button>`;
      return frameHead(r) + `<div class="md-fb"><div class="md-nm"><h2>${esc(tr('這股還空著'))}</h2></div>
        <p class="md-lead">${esc(tr('從已入庫的車挑一款，取個五字內的名字，排好路線和時間，它就住進這一股。'))}</p></div>
        <div class="md-ff">${go}</div>`;
    }
    const models = host.models();
    const list = models.length
      ? `<div class="md-models">${models.map(m => `<button type="button" data-a="model" data-model="${esc(m.id)}">${esc(m.name)}</button>`).join('')}</div>`
      : `<p class="md-lead">${esc(tr('車庫裡還沒有可以自己排班的車。先到車庫看看怎麼收集。'))}</p>`;
    return frameHead(r) + `<div class="md-fb"><div class="md-nm"><h2>${esc(tr('挑一款車'))}</h2></div>${list}</div>`;
  }
  function statsHTML(r) {
    const x = r.stats, stat = (label, value, unit = '') => `<div class="md-st"><span>${esc(label)}</span><b>${value}${unit ? `<small>${esc(unit)}</small>` : ''}</b></div>`;
    return `<h3 class="md-sec">${esc(tr('這列車的紀錄'))}</h3><div class="md-grid">
      ${stat(tr('首航日'), esc(r.first || '—'))}${stat(tr('已行駛'), fmt(x.days), tr('天'))}${stat(tr('累計里程'), fmt(x.km), tr('公里'))}
      ${stat(tr('發車'), fmt(x.trips), tr('趟'))}${stat(tr('親手發車'), fmt(x.hand), tr('次'))}${stat(tr('停靠'), fmt(x.stops), tr('站次'))}</div>`;
  }
  // 發車鈕:車在股道上才有。按鈕只留一顆主要動作,其他動作用底線文字。
  function footHTML(r) {
    const go = r.block === 'pass_required' ? `<button class="md-btn" type="button" data-a="pass">${esc(tr('開通行證才能發車'))}</button>`
      : r.state === 'out' ? `<button class="md-btn navy" type="button" data-a="watch">${esc(tr('去看它'))}</button>`
      : r.block === 'not_now' ? `<button class="md-btn navy" type="button" data-a="now">${esc(tr('回到現在'))}</button>`
      : r.issue ? `<button class="md-btn navy" type="button" data-a="replan">${esc(tr('重新排'))}</button>`
      : `<button class="md-btn" type="button" data-a="go">${esc(tr('發車'))}</button>`;
    if (r.demo || r.block === 'pass_required') return `<div class="md-ff">${go}</div>`;
    const edit = r.issue ? '' : `<button class="md-lnk" type="button" data-a="edit">${esc(tr('編輯班次'))}</button>`;
    return `<div class="md-ff">${go}${edit}<button class="md-lnk" type="button" data-a="delete">${esc(tr('刪除'))}</button></div>`;
  }
  function noteOf(r) {
    if (r.issue) return tr('路線資料有變動，這列車要重新排才能上路。');
    if (r.demo) return tr('這是示範車。開通行證後可以排滿 6 股，每一列都有自己的首航日與里程。');
    if (r.block === 'pass_required') return tr('通行證到期了。車隊都還在，開通行證後回到地圖上跑。');
    if (r.block === 'not_now') return tr('地圖時鐘不在現在，回到現在才能親手發車。');
    return '';
  }
  function frameHTML(i) {
    const r = rows[i];
    if (r.state === 'empty') return emptyHTML(r);
    const out = r.state === 'out', note = noteOf(r);
    return frameHead(r) + `<div class="md-fb"><div><div class="md-nm"><h2 data-i18n-skip>${esc(r.name)}</h2><span class="md-tag">${esc(tr('自製'))}</span>
      <span class="md-pill ${out ? 'out' : ''}">${esc(out ? tr('出勤中') : tr('在庫'))}</span></div><p class="md-kind">${esc(r.kind)}</p></div>
      <div class="md-route"><b>${esc(r.from)}</b><span class="md-ln"></span><b>${esc(r.to)}</b><p>${esc(r.line)}</p></div>
      ${r.demo ? '' : statsHTML(r)}${note ? `<p class="md-note">${esc(note)}</p>` : ''}</div>${footHTML(r)}`;
  }
  function showFrame(i) {
    const f = $('.md-frame'), html = frameHTML(i);
    if (html !== frameNow) {
      const keep = f.contains(document.activeElement) ? document.activeElement.dataset.a : null, top = frameTrack === i ? f.querySelector('.md-fb')?.scrollTop : 0;
      f.innerHTML = frameNow = html;
      frameTrack = i;
      if (top) f.querySelector('.md-fb').scrollTop = top;
      // 重畫會把焦點掉回 body,Tab 就斷了。
      if (keep) (f.querySelector(`[data-a="${keep}"]`) || $('.md-gl')).focus({ preventScroll: true });
    }
    f.classList.add('on');
    $('.md-dock').classList.add('off');
    $('.md-ctl').classList.toggle('dim', narrow());
  }
  function hideFrame() {
    $('.md-frame').classList.remove('on');
    $('.md-dock').classList.remove('off');
    $('.md-ctl').classList.remove('dim');
  }
  function select(i) {
    if (departing || stage?.busy) return;
    cur = i; picking = false;
    showFrame(i); showChips();
    stage?.select(i);
  }
  function back() {
    if (departing || stage?.busy) return;
    cur = -1; picking = false;
    hideFrame(); showChips();
    stage?.back();
  }
  const step = d => select(((cur < 0 ? (d > 0 ? -1 : 0) : cur) + d + TRACKS) % TRACKS);

  // 親手發車:按下去就算一趟(車已經在地圖上跑),車開遠了就淡到地圖跟車。略過動畫或開不了 3D 就直接接過去。
  async function depart(i) {
    const r = rows[i], rec = r.id ? host.depart(r.id) : null;
    if (!rec) { refresh(); return; }
    departing = true;
    hideFrame();
    $('.md-dock').classList.add('off');
    $('.md-ctl').classList.add('dim');
    $('.md-skip').hidden = false;
    const words = { signal: tr('出庫號誌轉綠'), onto: tr('開上轉車台'), align: tr('轉車台對準出庫線'), out: tr('{name}開出車庫', { name: r.name }) };
    const cap = $('.md-cap');
    let left = false;
    const leave = () => {
      if (left) return;
      left = true; departing = false;
      cap.hidden = true; $('.md-skip').hidden = true;
      host.follow(rec);
      close('fade');
    };
    await stage?.depart(i, k => { cap.hidden = false; cap.textContent = words[k]; }, leave);
    leave();
  }

  function act(a, el) {
    const r = rows[cur];
    if (a === 'prev') step(-1);
    else if (a === 'next') step(1);
    else if (a === 'back') back();
    else if (a === 'exit') exit();
    else if (a === 'pick') { picking = true; showFrame(cur); }
    else if (a === 'model') host.schedule(el.dataset.model, cur);
    else if (a === 'go') depart(cur);
    else if (a === 'watch') { const id = r.id; close(); host.watch(id); }
    else if (a === 'pass') { close(); host.pass(); }
    else if (a === 'now') { host.toNow(); refresh(); }
    else if (a === 'edit') host.edit(r.id);
    else if (a === 'replan') host.replan(r.id);
    else if (a === 'delete') { if (host.remove(r.id)) refresh(); }
  }

  function build() {
    dialog.lang = host.lang();
    dialog.classList.toggle('dark', host.dark());
    dialog.setAttribute('aria-label', tr('機務段'));
    dialog.innerHTML = `<canvas class="md-gl" tabindex="0" role="img" aria-label="${esc(tr('扇形車庫 3D 場景，點股道上的列車看特寫'))}"></canvas>
      <header class="md-head"><b>${esc(tr('軌島機務段'))}</b><span class="md-fleet"></span><button class="md-exit" type="button" data-a="exit">${esc(tr('離開'))}</button></header>
      <div class="md-ctl"><div class="md-seg" role="group" aria-label="${esc(tr('時間'))}">${PERIODS.map(([id, text]) => `<button type="button" data-period="${id}" aria-pressed="false">${esc(tr(text))}</button>`).join('')}</div></div>
      <section class="md-dock" aria-label="${esc(tr('選一列車'))}"><div class="md-dock-top"><b>${esc(tr('點一列車看特寫'))}</b></div><div class="md-chips"></div></section>
      <aside class="md-frame" aria-label="${esc(tr('列車資訊'))}"></aside>
      <div class="md-cap" role="status" hidden></div>
      <button class="md-skip" type="button" hidden>${esc(tr('略過動畫'))}</button>
      <div class="md-load" role="status">${esc(tr('把車開進車庫…'))}</div>`;
    dialog.onclick = e => {
      const chip = e.target.closest('.md-chip');
      if (chip) { select(+chip.dataset.i); return; }
      const period = e.target.closest('[data-period]');
      if (period) { setPeriod(period.dataset.period); return; }
      if (e.target.closest('.md-skip')) { stage?.skip(); return; }
      const b = e.target.closest('[data-a]');
      if (b) act(b.dataset.a, b);
    };
  }
  function setPeriod(id) {
    for (const b of dialog.querySelectorAll('[data-period]')) b.setAttribute('aria-pressed', String(b.dataset.period === id));
    stage?.setTheme(id);
  }
  async function start(ticket) {
    const load = $('.md-load');
    try {
      const { createRoundhouseStage } = await import('./rail-3d/roundhouse-stage.js');
      if (ticket !== opening) return;
      const next = await createRoundhouseStage({
        canvas: $('.md-gl'), lite: lite(), label: s => tr(s), layout, reduced: reduced(), onLost: () => close(),
        onPick: i => { if (i >= 0 && i !== cur) select(i); else if (i < 0 && cur >= 0) back(); },
      });
      if (ticket !== opening) { next.dispose(); return; }
      stage = next;
      setPeriod(host.period());
      await stage.setFleet(fleetOf());
      if (ticket !== opening) return;
      stage.resize();
      if (cur >= 0) stage.select(cur);
      observer = new ResizeObserver(() => stage?.resize());
      observer.observe(dialog);
      load.classList.add('off');
    } catch (e) {
      if (ticket !== opening) return;
      console.error('roundhouse', e);
      load.textContent = tr('這台裝置開不了 3D');
      load.classList.add('flat');
    }
  }
  const fleetOf = () => rows.map(r => ({ model: r.modelId || null, state: r.state }));
  // 存檔或時鐘變了:重算每一股,車庫的車跟著換,開著的畫框重畫。
  function refresh() {
    if (!shown || leaving || departing) return;
    const was = rows[cur]?.modelId;
    rows = host.rows();
    if (cur >= 0 && rows[cur].state !== 'empty') picking = false;
    showChips();
    if (cur >= 0) showFrame(cur);
    const swapped = cur >= 0 && was !== rows[cur].modelId;
    stage?.setFleet(fleetOf()).then(() => { if (swapped) stage?.refocus(); });
  }
  // 地圖的快捷鍵(←→ 撥時鐘、數字換倍速)在這頁不算:時鐘撥走就不能親手發車。捕獲階段攔,焦點掉到 body 也攔得到。
  function onKey(e) {
    if (e.target.closest?.('input,select,textarea')) return;
    e.stopPropagation();
    if (departing || document.querySelector('#mtForm[open]')) return;
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  }
  // opts.track:開頁就看這一股;opts.model:再把這款車的排班表單打開。
  function open(nextHost, opts = {}) {
    if (shown) return;
    host = nextHost;
    dialog = document.getElementById('mtDepot');
    if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'mtDepot'; document.body.append(dialog); }
    build();
    cur = -1; picking = false; departing = false; shown = true; chipsNow = frameNow = ''; frameTrack = -1;
    rows = host.rows();
    showChips();
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    dialog.oncancel = e => { e.preventDefault(); if (departing) return; if (cur >= 0) back(); else exit(); };
    document.addEventListener('keydown', onKey, true);
    start(++opening);
    timer = setInterval(refresh, 20000);
    if (opts.track != null) select(opts.track);
    if (opts.model) host.schedule(opts.model, opts.track);
  }
  // how==='fade':地圖從淡出那一刻就接回來,3D 等淡完才放掉。
  function close(how) {
    if (!shown || leaving) return;
    opening++;
    clearInterval(timer);
    document.removeEventListener('keydown', onKey, true);
    observer?.disconnect(); observer = null;
    leaving = true;
    const finish = () => {
      leaving = shown = false;
      stage?.dispose(); stage = null;
      dialog.classList.remove('leaving');
      if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
      dialog.innerHTML = '';
    };
    if (how === 'fade' && !reduced()) { dialog.classList.add('leaving'); setTimeout(finish, 700); } else finish();
    host.onClose();
  }
  // 從車庫進來的,離開回車庫。
  function exit() { const back = host.exit; close(); back?.(); }
  globalThis.MyTrainDepot = {
    open, close, refresh,
    get isOpen() { return shown && !leaving; },
    // 測試用:3D 舞台與車都就位了沒。
    get stage() { return stage; },
    get ready() { return !!stage && !!$('.md-load')?.classList.contains('off'); },
  };
})();
