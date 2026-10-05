// 北捷集中輪詢者（獨立 Worker，2026-09-02）；2026-10-05 起也放新北捷官網的集中出口（NtmPoller）。
//
// 它存在的唯一理由是把 TrtcPoller 這顆 Durable Object 從主站 Worker 裡搬出來：
// 含 DO migration 的版本【不能】走 `wrangler versions upload`（Cloudflare 錯誤 10211:
// "migrations must be fully applied via a non-versioned deployment"），而主站的出貨鏈
// 就是 upload → 預覽給使用者親試 → 升 100%。DO 留在主站的話，這批只能直接 100% 上線、
// 跳過預覽；搬出來之後主站永遠不必帶 migration，出貨流程一個字都不用改。NtmPoller 同理。
//
// 🔴 類別本體【不複製一份】，直接從 worker.js re-export——同一份原始碼兩個部署目標，
//    才不會長出兩套會各自漂移的輪詢邏輯（judgment 第九節第 10 條：跨處必須一致的東西只留一份）。
//    代價是這顆 Worker 會把整個 worker.js 打包進來（約 92KB gzip），但它一行都不會執行到。
//    也因為如此，部署這顆＝把 worker.js 當下的 TrtcPoller／NtmPoller 一起換上去，兩顆 DO 都會重啟一次。
//
// 部署：npx wrangler deploy --config wrangler.poller.jsonc
// 🔴 一律從乾淨的 worktree 部署（git worktree add --detach <暫存路徑> origin/main）：這顆會把磁碟上的整份 worker.js
//    打包上去，工作樹裡別人還沒 commit 的改動會一起上線。改了 NtmPoller 或 NTM_LIVE_MIN_GAP_MS 之後，ship-web 不會
//    替你部署這顆，要另外部署才生效。間隔改長時，主站帶過去的間隔會讓 DO 先照長的走；但同時在線的舊版主站
//    （漸進部署、預覽版本）帶的仍是舊值，DO 每個請求各自取較長的那個——要每個請求都照新的間隔，這顆也要部署。
// 這顆 Worker 需要自己的 TRTC_API_USER／TRTC_API_PASS secret（與主站同值，各存一份）；NtmPoller 不需要 secret。
export { TrtcPoller, NtmPoller } from './worker.js';
import { _ntm } from './worker.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/status') {
      // 唯一的公開出口：落點與新鮮度。刻意不代理 /raw——raw 只走 Durable Object 綁定，
      // 不從公開網址進來（不然任何人都能逼我們去打北捷）。
      if (!env.TRTC_POLLER) return Response.json({ error: '未綁定' }, { status: 500 });
      // 名字要與 worker.js 的 TRTC_POLLER_NAME 一致（同名才是同一顆 DO）。
      // v2 是 2026-09-02 實測落在 NRT（東京）的那一顆，理由見 worker.js 該常數的註解。
      const stub = env.TRTC_POLLER.get(env.TRTC_POLLER.idFromName('trtc-poller-v2'), { locationHint: 'apac-ne' });
      const r = await stub.fetch('https://trtc-poller/status');
      return new Response(await r.text(), { headers: { 'content-type': 'application/json; charset=utf-8' } });
    }
    if (url.pathname === '/ntm-status') {
      // 新北捷集中出口的落點與新鮮度，同樣只讀、不觸發查詢（查詢只走主站的 DO 綁定）。
      // ?name= 只收 ntm-poller-v1…v8：名字＝落點，換名字之前用它先量；不收任意字串，免得外人拿這個
      // 公開網址無限建 DO。提示與北捷那顆同為 apac-ne（理由見 worker.js 的 TRTC_POLLER_HINT）。
      if (!env.NTM_POLLER) return Response.json({ error: '未綁定' }, { status: 500 });
      const name = url.searchParams.get('name') || _ntm.NTM_POLLER_NAME;
      if (!/^ntm-poller-v[1-8]$/.test(name)) return Response.json({ error: 'bad name' }, { status: 400 });
      const stub = env.NTM_POLLER.get(env.NTM_POLLER.idFromName(name), { locationHint: 'apac-ne' });
      const r = await stub.fetch('https://ntm-poller/status');
      return new Response(await r.text(), { headers: { 'content-type': 'application/json; charset=utf-8' } });
    }
    return new Response('railisland trtc poller', { status: 200, headers: { 'content-type': 'text/plain' } });
  },
};
