/* 路線導覽：只讀路網，不修改站序、班表、篩選或繪圖層。網站與 App 共用。 */
(function () {
  'use strict';
  const norm = s => String(s || '').replace(/臺/g, '台').replace(/\s+/g, '').toLowerCase();
  const valid = s => s && Number.isFinite(s.lat) && Number.isFinite(s.lon);
  const key = (sys, id) => sys + '|' + id;

  function catalog(systems, stationIndex) {
    const stations = new Map((stationIndex || []).map(s => [key(s.sysId, norm(s.name)), s]));
    const routes = [];
    for (const sys of systems || []) {
      const lines = sys.mode === 'sched' ? sys._track?.lines : sys.data?.lines;
      for (const line of lines || []) {
        if (line.aux || !line.id) continue;
        // 原始陣列已是該條營運線的站序。分岔線各自保留，反向顯示也只反轉副本。
        const stops = (line.stations || []).filter(valid).map(s => {
          const canonical = stations.get(key(sys.id, norm(s.name)));
          return { name: canonical?.name || s.name, lat: canonical?.lat ?? s.lat,
            lon: canonical?.lon ?? s.lon, sysId: sys.id, sysLabel: sys.label,
            kind: sys.mode === 'sched' ? 'sched' : 'freq' };
        });
        if (stops.length < 2) continue;
        routes.push({ id: key(sys.id, line.id), lineId: line.id, sysId: sys.id,
          sysLabel: sys.label, name: line.name || line.id, color: line.color || '#55728c',
          stations: stops, shape: line.shape || [] });
      }
    }
    return routes;
  }

  function search(routes, query, system, translated) {
    const q = norm(query);
    return routes.filter(r => (!system || r.sysId === system) && (!q ||
      norm(r.name + r.sysLabel + r.lineId).includes(q) || r.stations.some(s => norm(s.name).includes(q)) || (translated && norm(translated(r)).includes(q))));
  }
  function ordered(route, reverse) { return reverse ? route.stations.slice().reverse() : route.stations.slice(); }
  function points(route) {
    const shape = route.shape.filter(p => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite));
    return shape.length ? shape.map(p => [p[0], p[1]]) : route.stations.map(s => [s.lat, s.lon]);
  }
  const scenes = [
    { id: 'taipei', title: '台北車站群', note: '板橋、台北、南港的鐵道交會',
      system: 'tra_sched', names: ['板橋', '台北', '南港'], pitch: 40, maxZoom: 13 },
    { id: 'wenhu', title: '文湖線沿線', note: '從動物園到南港展覽館',
      system: 'mrt', line: 'BR', pitch: 45, maxZoom: 13 },
    { id: 'danhai', title: '淡海輕軌', note: '綠山線與藍海線同框',
      system: 'ntdlrt', pitch: 45, maxZoom: 14 },
    { id: 'alishan', title: '阿里山林鐵', note: '從嘉義向山裡延伸的路網',
      system: 'afr_sched', pitch: 40, maxZoom: 12 },
  ];
  function scenePoints(scene, routes) {
    const chosen = routes.filter(r => r.sysId === scene.system && (!scene.line || r.lineId === scene.line));
    if (scene.names) {
      const found = new Map();
      for (const r of chosen) for (const s of r.stations) if (scene.names.includes(norm(s.name))) found.set(norm(s.name), [s.lat, s.lon]);
      return found.size === scene.names.length ? [...found.values()] : [];
    }
    return chosen.flatMap(points);
  }

  function create(a) {
    const $ = id => document.getElementById(id), t = a.t;
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const tx = s => esc(t(s));
    let routes = [], selected = '', reverse = false, tab = 'routes';
    // 起終站已在下一行，標題只保留路線名；也能沿用既有基礎線名的外語字典。
    const routeLabel = r => a.routeName(r.name.replace(/[（(].*[）)]$/, '').trim(), r.sysId);
    const stationLabel = s => a.stationName(s.name, s.sysId);
    const color = r => /^#[0-9a-f]{3,8}$/i.test(r.color) ? r.color : '#55728c';
    const row = r => `<button type="button" class="rd-route" data-route="${esc(r.id)}" style="--route-color:${color(r)}"><span class="rd-color" aria-hidden="true"></span><span class="rd-copy"><b>${esc(routeLabel(r))}</b><small>${esc(t(r.sysLabel))} · ${esc(t('{n} 站', { n: r.stations.length }))}</small><small>${esc(stationLabel(r.stations[0]))} ↔ ${esc(stationLabel(r.stations.at(-1)))}</small></span><span aria-hidden="true">›</span></button>`;
    function renderList() {
      const list = search(routes, $('rdSearch').value, $('rdSystem').value, r => routeLabel(r) + t(r.sysLabel) + r.stations.map(stationLabel).join(' '));
      $('rdList').innerHTML = list.length ? list.map(row).join('') : `<p class="rd-note" role="status">${tx('找不到符合的路線')}</p>`;
    }
    function renderDetail() {
      const route = routes.find(r => r.id === selected);
      $('rdBrowse').hidden = !!route; $('rdDetail').hidden = !route;
      if (!route) { selected = ''; renderList(); return; }
      const stops = ordered(route, reverse);
      $('rdDetail').innerHTML = `<div class="rd-actions"><button type="button" data-rd="back">‹ ${tx('所有路線')}</button><button type="button" data-rd="view">${tx('查看全線')}</button></div>` +
        `<h4>${esc(routeLabel(route))}</h4><p class="rd-note">${esc(t(route.sysLabel))} · ${esc(t('{n} 站', { n: stops.length }))}</p>` +
        `<button type="button" class="rd-direction" data-rd="reverse" aria-label="${tx('反轉站序')}"><span>${esc(stationLabel(stops[0]))} → ${esc(stationLabel(stops.at(-1)))}</span><span aria-hidden="true">⇄</span></button>` +
        `<p class="rd-note">${tx('點車站看班次；實際停靠以看板為準。')}</p>` +
        `<ol class="rd-stations" style="--route-color:${color(route)}">${stops.map((s, i) => `<li><button type="button" data-stop="${i}"><span class="rd-dot" aria-hidden="true"></span><span>${esc(stationLabel(s))}</span><span class="rd-chevron" aria-hidden="true">›</span></button></li>`).join('')}</ol>`;
    }
    function renderScenes() {
      $('rdScenes').innerHTML = `<p class="rd-note">${tx('選一個視角看車；跨路網會切到全台同框，時間維持不變。')}</p>` + scenes.filter(s => scenePoints(s, routes).length > 1).map(s =>
        `<button type="button" class="rd-scene" data-scene="${s.id}"><b>${tx(s.title)}</b><small>${tx(s.note)}</small><span>${tx('前往取景')} ↗</span></button>`).join('');
    }
    function switchTab(next) {
      tab = next;
      for (const b of $('rdTabs').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.rdtab === tab));
      $('rdRoutes').hidden = tab !== 'routes'; $('rdScenes').hidden = tab !== 'scenes'; $('rdSettings').hidden = tab !== 'settings';
      if (tab === 'routes') renderDetail();
      if (tab === 'scenes') renderScenes();
      $('trackPanel').scrollTop = 0;
    }
    $('rdSearch').addEventListener('input', renderList);
    $('rdSystem').addEventListener('change', renderList);
    $('rdTabs').onclick = e => { const b = e.target.closest('[data-rdtab]'); if (b) switchTab(b.dataset.rdtab); };
    $('rdRoutes').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.route) { selected = b.dataset.route; reverse = false; renderDetail(); $('trackPanel').scrollTop = 0; return; }
      const route = routes.find(r => r.id === selected); if (!route) return;
      if (b.dataset.rd === 'back') { selected = ''; renderDetail(); }
      if (b.dataset.rd === 'reverse') { reverse = !reverse; renderDetail(); $('rdDetail').querySelector('[data-rd="reverse"]').focus({ preventScroll: true }); }
      if (b.dataset.rd === 'view') a.view(points(route), { system: route.sysId, pitch: null, maxZoom: 14 });
      if (b.dataset.stop != null) { const s = ordered(route, reverse)[Number(b.dataset.stop)]; if (s) a.openStation(s); }
    };
    $('rdScenes').onclick = e => {
      const b = e.target.closest('[data-scene]'); if (!b) return;
      const scene = scenes.find(s => s.id === b.dataset.scene);
      if (scene) a.view(scenePoints(scene, routes), scene);
    };
    return { refresh(next) {
      routes = catalog(a.systems(), a.stations());
      const value = $('rdSystem').value;
      const systems = [...new Map(routes.map(r => [r.sysId, r.sysLabel])).entries()];
      $('rdSystem').innerHTML = `<option value="">${tx('所有系統')}</option>` + systems.map(([id, label]) => `<option value="${esc(id)}">${tx(label)}</option>`).join('');
      $('rdSystem').value = value;
      switchTab(next || tab);
    } };
  }
  window.RailDiscovery = { catalog, search, ordered, points, scenes, scenePoints, create };
})();
