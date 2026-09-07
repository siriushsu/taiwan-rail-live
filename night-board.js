/* 暗色站板只改閱讀層：仍使用既有分組、時刻與 click 處理，不另算到站資料。 */
(() => {
  let activeKey = '', activeGroup = '', current = null, clock = null;
  const dark = () => document.documentElement.dataset.theme === 'dark';
  const text = (node, selector) => node.querySelector(selector)?.textContent.trim() || '';
  function updateTime() {
    if (!current || !current.row.isConnected || !dark() || current.el.hidden) return;
    const {row, time} = current;
    const at = Number(row.dataset.nightAt);
    const left = row.hasAttribute('data-night-at') && clock ? Math.max(0, Math.ceil((at - clock() + 129600) % 86400 - 43200)) : null;
    const value = left === null ? text(row, '.min') : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (time.textContent !== value) time.textContent = value;
    time.classList.toggle('words', !/^\d+[:：]\d+$/.test(value));
  }
  function decorate(el, getClock, label) {
    current = null; clock = getClock;
    if (!el || el.hidden || !dark()) return;
    el.querySelectorAll('.night-directions,.night-next').forEach(n => n.remove());
    const groups = [], metroGroups = new Map();
    const metro = !el.querySelector(':scope > .row[data-no]') && !!el.querySelector(':scope > .row[data-li],:scope > .row[data-core-record],:scope > .row[data-trtc-eta]');
    let group, heading = null;
    for (const child of el.children) {
      child.classList.remove('night-group-hidden', 'night-group-active');
      if (child.matches('.bgrp,.grp')) { heading = child; group = { label:child.textContent.trim(), head:child, rows:[] }; if (!metro) groups.push(group); }
      else if (child.matches('.row') && child.querySelector('.min')) {
        if (metro) {
          const label = [heading?.textContent.trim(), text(child, 'b')].filter(Boolean).join(' · ');
          if (!metroGroups.has(label)) { const item = {label,head:heading,rows:[]}; metroGroups.set(label,item); groups.push(item); }
          group = metroGroups.get(label);
        }
        if (!group) { group = { label:'', rows:[] }; groups.push(group); }
        group.rows.push(child);
      }
    }
    const available = groups.filter(g => g.rows.length);
    if (!available.length) return;
    const key = el.querySelector('h3')?.textContent || '';
    if (key !== activeKey) { activeGroup = ''; activeKey = key; }
    const tabs = document.createElement('div'); tabs.className = 'night-directions';
    const hero = document.createElement('button'); hero.type = 'button'; hero.className = 'night-next';
    const insert = available[0].head || available[0].rows[0];
    insert.before(tabs, hero);
    function select(g) {
      activeGroup = g.label;
      for (const head of new Set(available.map(other => other.head).filter(Boolean))) {
        head.classList.toggle('night-group-hidden', head !== g.head);
        head.classList.toggle('night-group-active', head === g.head);
      }
      for (const other of available) {
        other.rows.forEach(r => r.classList.toggle('night-group-hidden', other !== g));
      }
      for (const button of tabs.children) button.setAttribute('aria-pressed', String(button._group === g));
      hero.replaceChildren();
      const row = g.rows.find(r => !r.classList.contains('off'));
      hero.hidden = !row;
      if (!row) { current = null; return; }
      const add = (cls, value) => { const span = document.createElement('span'); span.className = cls; span.textContent = value; hero.append(span); return span; };
      add('night-next-label', label);
      const time = add('night-next-time', text(row, '.min'));
      add('night-next-detail', [text(row, 'b'), text(row, '.dest')].filter(Boolean).join(' · '));
      add('night-next-clock', text(row, '.t'));
      const follows = row.matches('[data-no],[data-ci],[data-core-vehicle],[data-trtc-no]');
      hero.disabled = !follows;
      hero.onclick = event => { event.stopPropagation(); if (follows) row.click(); };
      current = {el,row,time}; updateTime();
    }
    if (available.length > 1) for (const g of available) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = g.label;
      button._group = g; button.onclick = event => { event.stopPropagation(); el._downNo = null; select(g); };
      tabs.append(button);
    }
    tabs.hidden = available.length < 2;
    select(available.find(g => g.label === activeGroup) || available[0]);
  }
  setInterval(updateTime, 1000);
  window.RailNightBoard = { decorate };
})();
