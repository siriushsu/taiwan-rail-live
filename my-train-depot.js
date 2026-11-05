// 機務段頁:六股車隊的總覽、點車特寫、資訊畫框、親手發車。3D 在 rail-3d/roundhouse-stage.js,這裡只管畫面上的字與按鈕。
// 資料與動作全走 host(index.html 的 ownTrainDepotHost),本檔不讀存檔、不碰地圖。
// 一格 row:{n,state:'home'|'out'|'empty',id,name,modelId,kind,from,to,line,time,first,firstToday,stats,earned,look,base,demo,issue,block}。block 是不能親手發車的原因,base 是原色車牌的顏色。
(function () {
  'use strict';
  const TRACKS = 6;
  const { HONOR_GROUPS, FLEET_HONORS, HONOR_SHELF, MARK_IDS, PLATES, TWIN_MODELS } = MyTrainPlan;
  const HONORS = Object.fromEntries(HONOR_GROUPS.flatMap(g => g.list).map(h => [h.id, h]));
  const PERIODS = [['day', '白天'], ['dusk', '黃昏'], ['night', '夜晚']];
  const ICON = {
    l: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    r: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };
  let host = null, dialog = null, stage = null, rows = [], cur = -1, picking = false, opening = 0, timer = 0, observer = null, departing = false, shown = false, leaving = false;
  let chipsNow = '', frameNow = '', frameTrack = -1, panelNow = ''; // 上次畫的內容:每 20 秒重算一次,沒變就別動 DOM,手指點到一半的格子和捲到一半的畫框才不會被換掉
  let looking = false, trial = null, panelFor = null; // trial:試掛中的 {mark} 或 {plate},離開就回原樣。panelFor:成就頁看哪一股,-1 是車隊
  const $ = s => dialog.querySelector(s);
  const tr = (key, values) => host.t(key, values);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const narrow = () => matchMedia('(max-width:759px),(orientation:portrait)').matches;
  const honorName = id => tr(HONORS[id].name);
  const markURL = id => MyTrainMarks.url(id, honorName(id));
  const gotCount = earned => Object.keys(HONORS).filter(id => earned[id]).length;
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
    const f = host.fleet(), honors = own.reduce((n, r) => n + gotCount(r.earned), FLEET_HONORS.filter(h => f.earned[h.id]).length);
    // 窄手機放不下一行時只在段與段之間折，數字和單位不拆開。
    const line = own.length ? tr('{count} 列車 · {km} 公里', { count: own.length, km: fmt(km) }).split(' · ') : [];
    if (line.length && f.standby) line.push(tr('待命 {count} 列', { count: f.standby }));
    $('.md-fleet').innerHTML = line.map(s => `<span>${esc(s)}</span>`).join(' · ');
    $('.md-sum').hidden = !own.length;
    $('.md-sum span').textContent = tr('成就 {count} 枚', { count: honors });
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
    const x = r.stats, wait = r.meetsWait && !x.meets, stat = (label, value, unit = '', more = '') => `<div class="md-st"><span>${esc(label)}</span><b>${value}${unit ? `<small>${esc(unit)}${more}</small>` : ''}</b></div>`;
    return `<h3 class="md-sec">${esc(tr('這列車的紀錄'))}</h3><div class="md-grid">
      ${stat(tr('首航日'), esc(r.first || '—'))}${stat(tr('已行駛'), fmt(x.days), tr('天'))}${stat(tr('累計里程'), fmt(x.km), tr('公里'))}
      ${stat(tr('發車'), fmt(x.trips), tr('趟'), `<span class="md-hd">${esc(tr('・親手 {count}', { count: fmt(x.hand) }))}</span>`)}${stat(tr('停靠'), fmt(x.stops), tr('站次'))}${stat(tr('交會真車'), wait ? esc(tr('計算中')) : fmt(x.meets), wait ? '' : tr('次'))}</div>`;
  }
  const bar = pct => `<div class="md-bar"><i style="width:${Math.min(100, pct)}%"></i></div>`;
  // 畫框上那一排章,和往下一枚走到哪了。首航沒有進度,告訴他怎麼拿。
  function honorsHTML(r) {
    const next = HONOR_SHELF.map(id => HONORS[id]).find(h => !r.earned[h.id]);
    let goal = '';
    if (next) {
      const v = r.stats[next.stat], first = next.id === 'maiden';
      const hint = !first ? `${fmt(v)}／${fmt(next.goal)}` : r.block || r.issue ? ''
        : tr(r.firstToday ? '按「發車」就拿到，或等今天 {time} 的班次跑完。' : '按「發車」就拿到，或等明天 {time} 的班次跑完。', { time: r.time });
      goal = `<div><p class="md-next">${esc(tr('下一個「{name}」：{desc}。', { name: tr(next.name), desc: tr(next.desc) }))}${esc(hint)}</p>${first ? '' : bar(v / next.goal * 100)}</div>`;
    }
    return `<h3 class="md-sec md-row">${esc(tr('成就 {got}／{total}', { got: gotCount(r.earned), total: Object.keys(HONORS).length }))}<button class="md-lnk sm" type="button" data-a="ach">${esc(tr('全部成就'))}</button></h3>
      <div class="md-stamps">${HONOR_SHELF.map(id => `<div class="md-stp ${r.earned[id] ? 'got' : ''}" title="${esc(tr(HONORS[id].desc))}">${MyTrainMarks.stamp(honorName(id), !!r.earned[id])}<span>${esc(honorName(id))}</span></div>`).join('')}</div>${goal}`;
  }
  // 地圖上的車牌:原色跟排班時選的顏色走,其他是成就給的框。
  function plateHTML(r, label, id) {
    const p = PLATES[id] || PLATES.base, c = p.bg ? p : r.base;
    return `<span class="md-plt ${p.dbl ? 'dbl' : ''}" data-i18n-skip style="--pb:${c.bg};--pl:${c.line};--pi:${c.ink}">${esc(label)}</span>`;
  }
  const lookHTMLBrief = r => `<h3 class="md-sec">${esc(tr('外觀'))}</h3><div class="md-lk">${r.look.mark
    ? `<img src="${markURL(r.look.mark)}" alt="${esc(tr('頭牌「{name}」', { name: honorName(r.look.mark) }))}">`
    : `<i class="md-nomk" role="img" aria-label="${esc(tr('沒掛頭牌'))}"></i>`}${plateHTML(r, r.name, r.look.plate)}</div>`;
  // 發車鈕:車在股道上才有。按鈕只留一顆主要動作,其他動作用底線文字。
  function footHTML(r) {
    const go = r.block === 'pass_required' ? `<button class="md-btn" type="button" data-a="pass">${esc(tr('開通行證才能發車'))}</button>`
      : r.state === 'out' ? `<button class="md-btn navy" type="button" data-a="watch">${esc(tr('去看它'))}</button>`
      : r.block === 'not_now' ? `<button class="md-btn navy" type="button" data-a="now">${esc(tr('回到現在'))}</button>`
      : r.issue ? `<button class="md-btn navy" type="button" data-a="replan">${esc(tr('重新排'))}</button>`
      : `<button class="md-btn" type="button" data-a="go">${esc(tr('發車'))}</button>`;
    if (r.demo) return `<div class="md-ff">${go}</div>`;
    const look = `<button class="md-lnk" type="button" data-a="look">${esc(tr('換外觀'))}</button>`;
    if (r.block === 'pass_required') return `<div class="md-ff">${go}${look}</div>`;
    const edit = r.issue ? '' : `<button class="md-lnk" type="button" data-a="edit">${esc(tr('編輯班次'))}</button>`;
    return `<div class="md-ff">${go}${look}${edit}<button class="md-lnk" type="button" data-a="delete">${esc(tr('刪除'))}</button></div>`;
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
    if (looking) return lookHTML(r);
    const out = r.state === 'out', note = noteOf(r);
    return frameHead(r) + `<div class="md-fb"><div><div class="md-nm"><h2 data-i18n-skip>${esc(r.name)}</h2><span class="md-tag">${esc(tr('自製'))}</span>
      <span class="md-pill ${out ? 'out' : ''}">${esc(out ? tr('出勤中') : tr('在庫'))}</span></div><p class="md-kind">${esc(r.kind)}</p></div>
      <div class="md-route"><b>${esc(r.from)}</b><span class="md-ln"></span><b>${esc(r.to)}</b><p>${esc(r.line)}</p></div>
      ${r.demo ? '' : statsHTML(r) + honorsHTML(r) + lookHTMLBrief(r)}${note ? `<p class="md-note">${esc(note)}</p>` : ''}</div>${footHTML(r)}`;
  }
  // 換外觀:拿到的點了就掛上;沒拿到的可以試掛看樣子,離開就回原樣。
  function lookHTML(r) {
    const now = { ...r.look, ...trial }, plateNow = now.plate || 'base', plateSaved = r.look.plate || 'base';
    const ownMark = id => !!r.earned[id], ownPlate = id => !PLATES[id].by || !!r.earned[PLATES[id].by];
    const cls = (id, cur, saved, ok) => `${ok ? '' : 'lock'} ${id === cur ? (id === saved ? 'on' : 'try') : ''}`;
    const by = trial && (trial.plate ? PLATES[trial.plate].by : trial.mark);
    const hint = by ? tr('試掛中。拿到「{name}」才能留著：{desc}。', { name: honorName(by), desc: tr(HONORS[by].desc) })
      : r.state === 'out' ? tr('這列車在外面，回庫才看得到車頭的頭牌。') : tr('點一個就掛上。沒拿到的可以試掛看看。');
    const plateTag = id => { const p = PLATES[id]; return !p.by ? tr('預設') : ownPlate(id) ? tr('已拿到') : tr('要「{name}」', { name: honorName(p.by) }); };
    const ids = Object.keys(PLATES);
    return `<div class="md-fh"><b>${esc(tr('換外觀'))}</b><div class="md-nav"><button type="button" data-a="lookDone" aria-label="${esc(tr('完成'))}">${ICON.x}</button></div></div><div class="md-fb">
      <div class="md-lkp">${plateHTML(r, r.name, plateNow)}<small>${esc(tr('地圖上的車牌'))}</small></div><p class="md-next">${esc(hint)}</p>
      <section><h3 class="md-sec">${esc(tr('頭牌'))}<small>${esc(tr('掛在車頭 {got}／{total}', { got: MARK_IDS.filter(ownMark).length, total: MARK_IDS.length }))}</small></h3>
      <div class="md-mkg"><button class="md-mki ${cls(null, now.mark, r.look.mark, true)}" type="button" data-a="mk" data-k=""><i></i>${esc(tr('不掛'))}</button>${MARK_IDS.map(id =>
        `<button class="md-mki ${cls(id, now.mark, r.look.mark, ownMark(id))}" type="button" data-a="mk" data-k="${id}"><img src="${markURL(id)}" alt="">${esc(honorName(id))}</button>`).join('')}</div></section>
      <section><h3 class="md-sec">${esc(tr('車牌框'))}<small>${esc(tr('地圖上看得到 {got}／{total}', { got: ids.filter(ownPlate).length, total: ids.length }))}</small></h3>
      <div class="md-plg">${ids.map(id => `<button class="md-pli ${cls(id, plateNow, plateSaved, ownPlate(id))}" type="button" data-a="pl" data-k="${id}">${plateHTML(r, tr(PLATES[id].name), id)}<small>${esc(plateTag(id))}</small></button>`).join('')}</div></section>
      </div><div class="md-ff"><button class="md-btn navy" type="button" data-a="lookDone">${esc(tr('完成'))}</button></div>`;
  }
  function openLook() { looking = true; trial = null; showFrame(cur); stage?.look(true); }
  function closeLook() { looking = false; trial = null; showFrame(cur); stage?.look(false); stage?.setFleet(fleetOf()); }
  function pickLook(kind, id) {
    const r = rows[cur], ok = !id || (kind === 'mark' ? r.earned[id] : !PLATES[id].by || r.earned[PLATES[id].by]);
    trial = ok ? null : { [kind]: id };
    if (ok) host.setLook(r.id, { ...r.look, [kind]: id });
    refresh();
  }
  // 成就頁:這列車或車隊。獎勵那一行照成就給的東西寫。
  function rewardOf(h) {
    if (h.deco) return tr('車庫佈置：{name}', { name: tr(h.deco) });
    if (h.mark) return tr('頭牌「{name}」', { name: tr(h.name) });
    return h.plate ? tr('車牌框「{name}」', { name: tr(PLATES[h.plate].name) }) : '';
  }
  function honorItem(h, got, value, extra) {
    const reward = rewardOf(h), left = h.goal > 1 && !got ? `<div class="md-ap">${bar(value / h.goal * 100)}<small>${fmt(value)}／${fmt(h.goal)}</small></div>` : '';
    return `<li class="${got ? 'got' : ''}">${MyTrainMarks.stamp(tr(h.name), got)}<div><b>${esc(tr(h.name))}</b><p>${esc(tr(h.desc))}${extra ? ` ${esc(extra)}` : ''}</p>${reward ? `<em class="md-rw">${esc(reward)}</em>` : ''}${left}</div></li>`;
  }
  function panelHTML() {
    const fleet = panelFor < 0, r = rows[panelFor], f = host.fleet();
    const groups = fleet ? [{ name: '車隊', note: '六股一起算', list: FLEET_HONORS }] : HONOR_GROUPS, earned = fleet ? f.earned : r.earned;
    const list = groups.flatMap(g => g.list), got = list.filter(h => earned[h.id]).length;
    const title = fleet ? tr('車隊成就') : tr('{name}的成就', { name: r.name });
    const sub = fleet ? tr('{count} 列車', { count: rows.filter(x => x.id).length }) : tr('首航 {date}', { date: r.first });
    const noTwin = !fleet && !TWIN_MODELS.includes(r.modelId) ? tr('這款車路上沒有同款真車，拿不到。') : '';
    const body = groups.map(g => `<section><h3 class="md-sec">${esc(tr(g.name))}<small>${esc(tr(g.note))}${g.source ? `・${esc(tr(g.source))}` : ''}</small></h3><ul class="md-al">${g.list.map(h =>
      honorItem(h, !!earned[h.id], (fleet ? f.totals : r.stats)[h.stat] || 0, h.id === 'twin' ? noTwin : '')).join('')}</ul></section>`).join('');
    return `<div class="md-fh"><b data-i18n-skip>${esc(title)}</b><div class="md-nav"><button type="button" data-a="achClose" aria-label="${esc(tr('關閉'))}">${ICON.x}</button></div></div>
      <div class="md-fb"><p class="md-next">${esc(sub)}　${esc(tr('已拿 {got}／{total}', { got, total: list.length }))}</p>${body}
      <p class="md-note">${esc(tr(fleet ? '獎勵都是外觀，不給點數。車庫佈置之後才開放，現在拿到的會留著。' : '獎勵都是外觀，不給點數。'))}</p></div>`;
  }
  function showPanel() {
    const el = $('.md-panel'), html = panelHTML();
    if (html !== panelNow) {
      const top = el.querySelector('.md-fb')?.scrollTop || 0, again = !!panelNow;
      el.innerHTML = panelNow = html;
      if (again) el.querySelector('.md-fb').scrollTop = top;
    }
    el.classList.add('on');
  }
  function openPanel(i) { panelFor = i; panelNow = ''; showPanel(); }
  function closePanel() { panelFor = null; $('.md-panel').classList.remove('on'); }
  function showFrame(i) {
    const f = $('.md-frame'), html = frameHTML(i), page = looking ? `look${i}` : i;
    if (html !== frameNow) {
      const on = document.activeElement, keep = f.contains(on) ? `[data-a="${on.dataset.a}"]${on.dataset.k === undefined ? '' : `[data-k="${on.dataset.k}"]`}` : null, top = frameTrack === page ? f.querySelector('.md-fb')?.scrollTop : 0;
      f.innerHTML = frameNow = html;
      frameTrack = page;
      if (top) f.querySelector('.md-fb').scrollTop = top;
      // 重畫會把焦點掉回 body,Tab 就斷了。
      if (keep) (f.querySelector(keep) || $('.md-gl')).focus({ preventScroll: true });
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
    if (panelFor !== null) closePanel();
    if (looking) { looking = false; trial = null; }
    cur = i; picking = false;
    showFrame(i); showChips();
    stage?.select(i);
  }
  function back() {
    if (departing || stage?.busy) return;
    if (panelFor !== null) closePanel();
    const trying = trial; looking = false; trial = null;
    cur = -1; picking = false;
    if (trying) stage?.setFleet(fleetOf());
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
    else if (a === 'look') openLook();
    else if (a === 'lookDone') closeLook();
    else if (a === 'mk') pickLook('mark', el.dataset.k || null);
    else if (a === 'pl') pickLook('plate', el.dataset.k);
    else if (a === 'ach') openPanel(cur);
    else if (a === 'achFleet') openPanel(-1);
    else if (a === 'achClose') closePanel();
  }

  function build() {
    dialog.lang = host.lang();
    dialog.classList.toggle('dark', host.dark());
    dialog.setAttribute('aria-label', tr('機務段'));
    dialog.innerHTML = `<canvas class="md-gl" tabindex="0" role="img" aria-label="${esc(tr('扇形車庫 3D 場景，點股道上的列車看特寫'))}"></canvas>
      <header class="md-head"><b>${esc(tr('軌島機務段'))}</b><span class="md-fleet"></span><button class="md-exit" type="button" data-a="exit">${esc(tr('離開'))}</button></header>
      <div class="md-ctl"><div class="md-seg" role="group" aria-label="${esc(tr('時間'))}">${PERIODS.map(([id, text]) => `<button type="button" data-period="${id}" aria-pressed="false">${esc(tr(text))}</button>`).join('')}</div></div>
      <section class="md-dock" aria-label="${esc(tr('選一列車'))}"><div class="md-dock-top"><b>${esc(tr('點一列車看特寫'))}</b><div class="md-sum" hidden><button class="md-lnk sm" type="button" data-a="achFleet">${esc(tr('車隊成就'))}</button><span></span></div></div><div class="md-chips"></div></section>
      <aside class="md-frame" aria-label="${esc(tr('列車資訊'))}"></aside>
      <aside class="md-panel" aria-label="${esc(tr('成就'))}"></aside>
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
        markImage: id => MyTrainMarks.canvas(id, 512, honorName(id)),
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
  const fleetOf = () => rows.map((r, i) => ({ model: r.modelId || null, state: r.state, mark: i === cur && trial?.mark ? trial.mark : r.look?.mark || null }));
  // 存檔或時鐘變了:重算每一股,車庫的車跟著換,開著的畫框重畫。
  function refresh() {
    if (!shown || leaving || departing) return;
    const was = rows[cur]?.modelId;
    rows = host.rows();
    if (cur >= 0 && rows[cur].state !== 'empty') picking = false;
    showChips();
    if (cur >= 0) showFrame(cur);
    if (panelFor !== null) showPanel();
    const swapped = cur >= 0 && was !== rows[cur].modelId;
    stage?.setFleet(fleetOf()).then(() => { if (swapped) stage?.refocus(); });
  }
  // 地圖的快捷鍵(←→ 撥時鐘、數字換倍速)在這頁不算:時鐘撥走就不能親手發車。捕獲階段攔,焦點掉到 body 也攔得到。
  function onKey(e) {
    if (e.target.closest?.('input,select,textarea')) return;
    e.stopPropagation();
    if (departing || looking || panelFor !== null || document.querySelector('#mtForm[open]')) return;
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
    cur = -1; picking = false; departing = false; shown = true; chipsNow = frameNow = panelNow = ''; frameTrack = -1; looking = false; trial = null; panelFor = null;
    rows = host.rows();
    showChips();
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    dialog.oncancel = e => { e.preventDefault(); if (departing) return; if (panelFor !== null) closePanel(); else if (looking) closeLook(); else if (cur >= 0) back(); else exit(); };
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
