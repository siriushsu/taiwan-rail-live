// 同向待避的待避線（台鐵）。待避是前端執行期排的（index.html planSameDirectionOvertakes），派車表的計畫裡
// 待避車在那一站是「通過」，綁到的就是通過用的正線，超越車也走同一股 ⇒ 立體畫面上超越車直接穿過停著的待避車
// （2026-10-03 預排 14 筆有 12 筆兩車停／過同一個節點；9/29～10/10 共 115 筆有 86 筆）。
// 這裡把待避車在待避站前後一小段換到另一股，條件：
//   ・只用出貨路網裡已打包的台鐵路徑（派車表現在或以前派過的實體股道，不憑空造股道）；每一段的終點要屬於
//     下一站（派車表在該站用過的節點、推估停車點，或 OSM 同名／300 m 內匿名的停車位置，與 topology.stopCandidates 同一套），
//     長度不超過派車表該站對最長的那條（含 scripts/extend_tra_overtake_sidings.mjs 補的待避側線路徑；
//     data/tra_track_sections.json 的 maxPathM 就是它，跑段剖面照它算，換股不會超速）；
//   ・不逆向走正線：沒有 service 標記的股道，派車表幾乎只單向使用（≥20 次、另一向 ≤2%）就不准反著走；
//   ・待避站換到停車位置（OSM railway=stop、推估停車點或派車表正式停過的節點）；
//   ・車身（取樣點是整列中心，前後各半列）不壓到待避期間同站其他列車（超越車在內，motion.js 從 _overtakePeers 取）
//     在這一站的進出路徑——待避線可能正停著別班，也可能不只一班從旁通過；
//   ・窗口兩端、窗口內的正式停靠站與其他待避站節點不變，每個接點道岔不倒車（route-runtime.joinable）；
//   ・不引入原本沒走的非電化股道（藍皮等柴聯車專用線）。
// 窗口從前後各一站開始，找不到再往外擴（五堵北上的第三股要到七堵才併回正線）。原本就不衝突
// （五堵 4022／472：超越車自己走第三股）就不動；找不到就照舊，由 scripts/verify_overtake_distinct_track.mjs 列出來。
const MAX_SPAN = 4;
const WRONG_WAY_MIN_USES = 20, WRONG_WAY_SHARE = 0.02;
const normalize = x => String(x || '').replaceAll('臺', '台').replace(/\s*[（(].*?[）)]/g, '').replace(/(火車站|車站)$/, '').replace(/-環島$/, '').trim();
const distanceM = (a, b) => Math.hypot((a[0] - b[0]) * Math.cos((a[1] + b[1]) / 2 * Math.PI / 180), a[1] - b[1]) * 111320;
export function createOvertakeSidings(pack, dispatch, geometry) {
  let idx = null;
  const add = (map, k, v) => (map.get(k) || map.set(k, new Set()).get(k)).add(v);
  const index = () => {
    if (idx) return idx;
    const byFrom = new Map(), atStation = new Map(), stopAt = new Set(), pairMax = new Map(), uses = new Map(), coord = new Map();
    for (const [id, p] of Object.entries(pack.paths)) if (p.system === 'tra_sched') (byFrom.get(p.from) || byFrom.set(p.from, []).get(p.from)).push(Number(id));
    for (const [key, plan] of Object.entries(dispatch.plans)) {
      if (!key.startsWith('tra_sched:')) continue;
      let sig; try { sig = JSON.parse(plan.stopSignature); } catch { continue; }
      if (sig.length !== plan.pathIds.length + 1) continue;
      plan.pathIds.forEach((id, i) => {
        const p = pack.paths[id]; if (!p) return;
        const k = [sig[i][0], sig[i + 1][0]].sort().join('|');
        pairMax.set(k, Math.max(pairMax.get(k) || 0, p.lengthM));
        add(atStation, sig[i][0], p.from); add(atStation, sig[i + 1][0], p.to);
        for (const [wi, , n] of p.walk) { const u = uses.get(wi) || uses.set(wi, [0, 0]).get(wi); u[n > 0 ? 0 : 1]++; }
      });
      sig.forEach((s, i) => {
        if (i && i < sig.length - 1 && !(s[2] > s[1])) return;
        const node = i < plan.pathIds.length ? pack.paths[plan.pathIds[i]]?.from : pack.paths[plan.pathIds[i - 1]]?.to;
        if (node != null) stopAt.add(s[0] + '@' + node);
      });
    }
    // 派車表沒派過車的待避側線路徑（scripts/extend_tra_overtake_sidings.mjs），與股道表的 maxPathM 同樣算進最長路徑。
    for (const e of pack.extensions || []) for (const [id, pair] of Object.entries(e.overtakePaths || {})) {
      const k = pair.map(n => 'tra_sched:' + n).sort().join('|'), p = pack.paths[id];
      if (p) pairMax.set(k, Math.max(pairMax.get(k) || 0, p.lengthM));
    }
    for (const s of pack.inferredStops || []) add(atStation, s.station, String(s.id));
    for (const w of pack.ways) if (w.system === 'tra_sched') w.nodes.forEach((n, i) => { if (pack.nodeTags?.[n]?.railway === 'stop') coord.set(String(n), w.coordinates[i]); });
    for (const list of byFrom.values()) list.sort((a, b) => a - b);
    return idx = { byFrom, atStation, stopAt, pairMax, uses, coord };
  };
  // node 屬不屬於 name 這一站（at＝班表站點 [lon,lat]）。
  const member = (node, name, at) => {
    const { atStation, coord } = index();
    if (atStation.get(name)?.has(node)) return true;
    const tags = pack.nodeTags?.[node], c = coord.get(node);
    if (tags?.railway !== 'stop' || !c || !at) return false;
    const named = normalize(tags.name);
    return named ? named === name.slice(name.indexOf(':') + 1) && distanceM(c, at) < 500 : distanceM(c, at) < 300;
  };
  const stopPosition = (node, name) => pack.nodeTags?.[node]?.railway === 'stop' || String(node).startsWith('estimated:') || index().stopAt.has(name + '@' + node);
  const wrongWay = id => (pack.paths[id]?.walk || []).some(([wi, , n]) => {
    if (pack.ways[wi]?.tags?.service) return false;
    const u = index().uses.get(wi); if (!u) return false;
    const total = u[0] + u[1];
    return total >= WRONG_WAY_MIN_USES && u[n > 0 ? 0 : 1] / total <= WRONG_WAY_SHARE;
  });
  const nonElectric = id => (pack.paths[id]?.walk || []).map(([wi]) => wi).filter(wi => pack.ways[wi]?.tags?.electrified === 'no');
  // 車身壓到的邊資源：進站段最後 half 公尺、出站段最前 half 公尺。
  const tail = (id, half) => { if (id == null) return []; const u = geometry.unfold(id), d = u.path.d, L = u.path.length; return u.edges.filter((e, i) => d[i + 1] > L - half).map(e => e.resource); };
  const head = (id, half) => { if (id == null) return []; const u = geometry.unfold(id), d = u.path.d; return u.edges.filter((e, i) => d[i] < half).map(e => e.resource); };
  const lengthOf = id => pack.paths[id]?.lengthM ?? Infinity;
  // ids：綁定站序之間的路徑；names：各站 stationKey；coords：各站班表座標 [lon,lat]；fixed[k]：第 k 站節點不得換
  // （正式停靠、別的待避站）；w：待避站；avoidNodes／avoidRes：待避期間同站其他列車在這一站進出路徑經過的節點與邊資源；
  // half：待避車半列長（公尺）。回傳 {ids, changed:[站序], node} 或 null（原本就不衝突，或找不到可換的股道）。
  function reroute({ ids, names, coords = [], fixed, w, avoidNodes, avoidRes, half }) {
    const N = names.length, nodeAt = k => (k < ids.length ? pack.paths[ids[k]]?.from : pack.paths[ids[k - 1]]?.to);
    const hits = list => list.some(r => avoidRes.has(r));
    if (!avoidNodes.has(nodeAt(w)) && !hits(tail(ids[w - 1], half)) && !hits(head(ids[w], half))) return null;
    const { byFrom, pairMax } = index(), allowed = new Set(ids.flatMap(nonElectric));
    const options = (k, node) => (byFrom.get(node) || []).filter(id => {
      if (id === ids[k]) return true;
      const p = pack.paths[id];
      return member(p.to, names[k + 1], coords[k + 1]) && p.lengthM <= (pairMax.get([names[k], names[k + 1]].sort().join('|')) ?? -Infinity) + 1e-3
        && !wrongWay(id) && !nonElectric(id).some(wi => !allowed.has(wi));
    });
    for (let span = 2; span <= MAX_SPAN; span++) {
      let best = null;
      for (let s0 = w - 1; s0 >= Math.max(0, w + 1 - span); s0--) {
        const e0 = s0 + span;
        if (e0 > N - 1) continue;
        // 動態規劃：狀態＝剛走完的那段路徑（下一個接點的道岔接不接得上看它），值＝(換掉的站數, 站間長度差) 與走法。
        let states = new Map([[s0 > 0 ? ids[s0 - 1] : null, { node: nodeAt(s0), cost: 0, changed: 0, chain: [] }]]);
        for (let k = s0; k < e0 && states.size; k++) {
          const next = new Map();
          for (const [last, st] of states) for (const id of options(k, st.node)) {
            if (last != null && !geometry.joinable(last, id)) continue;
            if (k === w && hits(head(id, half))) continue;
            const to = pack.paths[id].to;
            if (k + 1 === e0) { if (to !== nodeAt(e0) || (e0 < ids.length && !geometry.joinable(id, ids[e0]))) continue; }
            else if (k + 1 === w) { if (avoidNodes.has(to) || !stopPosition(to, names[w]) || hits(tail(id, half))) continue; }
            else if (fixed[k + 1] && to !== nodeAt(k + 1)) continue;
            const changed = st.changed + (to !== nodeAt(k + 1) ? 1 : 0), cost = st.cost + Math.abs(lengthOf(id) - lengthOf(ids[k])), cur = next.get(id);
            if (!cur || changed < cur.changed || (changed === cur.changed && cost < cur.cost)) next.set(id, { node: to, cost, changed, chain: [...st.chain, id] });
          }
          states = next;
        }
        for (const st of states.values())
          if (!best || st.changed < best.changed || (st.changed === best.changed && st.cost < best.cost)) best = { ...st, s0, e0 };
      }
      if (best) {
        const out = [...ids.slice(0, best.s0), ...best.chain, ...ids.slice(best.e0)], changed = [];
        for (let k = best.s0 + 1; k < best.e0; k++) if (pack.paths[out[k - 1]].to !== nodeAt(k)) changed.push(k);
        return { ids: out, changed, node: pack.paths[out[w - 1]].to };
      }
    }
    return null;
  }
  // body：停在進站段 inId 終點、之後走出站段 outId 的列車，車身壓到的邊資源（scripts/build_tra_overtake_tracks.mjs 共用）。
  return { reroute, body: (inId, outId, half) => [...tail(inId, half), ...head(outId, half)] };
}
