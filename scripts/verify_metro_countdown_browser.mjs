// 重播巡檢封存的正式回覆，測真實 Chromium/WebKit 看板與手機觸控，不連正式 API。
// METRO_CAPTURE_DIR 指向巡檢的 work/overall-audit（含 browser.json 與 response-*.json）。
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
const root = path.resolve(import.meta.dirname, '..');
const capture = process.env.METRO_CAPTURE_DIR;
assert(capture, '請指定 METRO_CAPTURE_DIR：使用封存真實資料，不自製高分來源');
const audit = JSON.parse(fs.readFileSync(path.join(capture, 'browser.json'), 'utf8'));
const now = audit.frames[0].at * 1000;
const ntmCapture = process.env.METRO_NTM_CAPTURE && JSON.parse(fs.readFileSync(process.env.METRO_NTM_CAPTURE,'utf8'));
const ntmInputs = ntmCapture?.flatMap(r=>r.rows.filter(x=>x.kind==='proxy'&&x.status===200)).sort((a,b)=>a.received-b.received);
const payloads = new Map();
for (const rec of audit.network) if (rec.status === 200 && rec.body && rec.receivedAt<=now/1000) {
  const url = new URL(rec.url);
  payloads.set(url.pathname + url.search, fs.readFileSync(path.join(capture, rec.body), 'utf8'));
}
const mime = { '.html': 'text/html', '.json': 'application/json', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('content-type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
  for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await type.launch({ headless: true, ...(engine === 'chromium' ? { channel: 'chrome' } : {}) });
    try {
      for (const width of [360, 375, 414, 768]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: true, hasTouch: true, locale: 'zh-TW' });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.addInitScript(now => {
          const NativeDate = Date;
          window.__auditNow = now;
          window.Date = class extends NativeDate {
            constructor(...args) { super(...(args.length ? args : [window.__auditNow])); }
            static now() { return window.__auditNow; }
          };
          localStorage.setItem('trainmap-howto-seen', '1');
          localStorage.setItem('trainmap-lang', 'zh-TW');
        }, now);
        await page.route('**/*', route => {
          const url = new URL(route.request().url());
          const body = payloads.get(url.pathname + url.search);
          if (body) return route.fulfill({ contentType: 'application/json', body });
          if (url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: '{"rows":[],"trains":[],"list":[],"board":[],"src":null}' });
          if (url.origin !== base) return route.abort();
          return route.continue();
        });
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        // 路網資料可能比 boot 的預設群組切換更早就緒；等 ready 才操作，避免開機又把捷運頁切回全台。
        await page.waitForFunction(() => typeof state !== 'undefined' && state.ready && state.systems &&
          ['krtc', 'ntdlrt', 'ntalrt', 'tymc'].every(id => state.systems.some(s => s.id === id && s.data && s._times)), null, { timeout: 45000 });
        await page.evaluate(async () => {
          selectGroup(GROUPS.find(g => g.id === 'metro'), true);
          await Promise.all([pollMetroCore(), pollMetroLive(), pollNtmLive()]);
        });
        await page.waitForFunction(() => state._metroLiveRaw?.krtc && state._metroLiveRaw?.tymc && state._ntmLiveRaw?.ankeng && state.metroCore?.snapshot, null, { timeout: 20000 });
        const sources = await page.evaluate(() => {
          const out = [];
          for (const id of ['KR', 'KO', 'A', 'V', 'VB', 'K']) {
            const ln = state.lines.find(l => l.id === id);
            state.visible.add(id);
            const choices = ln.stations.map((st, si) => ({ st, si, rows: metroSourceRowsForEntry({ ln, si, li: state.lines.indexOf(ln) }) }))
              .filter(x => x.rows.length).sort((a, b) => b.rows.filter(r=>r.vehicleId).length-a.rows.filter(r=>r.vehicleId).length || b.rows.length-a.rows.length);
            if (!choices.length) { out.push({ line: id, missing: true }); continue; }
            const chosen = choices[0];
            const view = metroCoreBoardView(chosen.st, state.lines, false);
            const rows = view.groups.filter(g => g.ln.id === id && g.kind === 'source').flatMap(g => g.rows);
            const exported = webMcpMetroBoardRows(chosen.st, state.lines, false, 100)
              .filter(r => r.line_id === id && r.data_basis === 'official_realtime_board');
            out.push({ line: id, station: chosen.st.name, index: chosen.si, rows: rows.length,
              exported: exported.length, exportTimesValid: exported.every(r => /^\d{2}:\d{2}$/.test(r.arrival_time)),
              linked: rows.filter(r => r.vehicleId).length, core: metroCoreItemsForLine(ln)?.length ?? null,
              sourceEpochs: rows.map(r => r.arrivalEpoch), precision: rows.map(r => r.precision) });
          }
          return out;
        });
        assert(sources.every(s => !s.missing && s.rows > 0 && s.exported === s.rows && s.exportTimesValid), JSON.stringify(sources));
        assert(sources.filter(s => ['KR', 'KO'].includes(s.line)).every(s => s.core === null && s.rows > 0),
          '本次真實語料的高捷位置應保留防護，但官方倒數不能跟著消失');
        assert(sources.filter(s => ['V','VB','K'].includes(s.line)).every(s=>s.core>0&&s.linked>0),
          '新北輕軌真實車號必須接到地圖與看板，不能只把未連結列藏起來：'+JSON.stringify(sources));
        for (const selected of sources) {
          await page.evaluate(({ line, index }) => {
            const ln = state.lines.find(l => l.id === line);
            openBoard({ ...ln.stations[index], sys: ln._sys });
          }, selected);
          await page.waitForFunction(() => document.querySelectorAll('#board .row[data-core-record]').length > 0);
          const shown = await page.evaluate(line => {
            const el = document.getElementById('board'), rect = el.getBoundingClientRect();
            const records = el._metroCoreRecords || [];
            return { source: records.filter(r => r.kind === 'source' && r.ln.id === line).length,
              overflow: el.scrollWidth - el.clientWidth, left: rect.left, right: rect.right,
              bodyOverflow: document.documentElement.scrollWidth - innerWidth,
              text: el.querySelector('.row .min')?.textContent };
          }, selected.line);
          assert(shown.source > 0, `${engine}/${width}/${selected.line} 沒顯示來源列`);
          assert(shown.overflow <= 2 && shown.bodyOverflow <= 2, JSON.stringify(shown));
          assert(shown.left >= -1 && shown.right <= width + 1, JSON.stringify(shown));
          const unlinked = page.locator('#board .row[data-core-record]:not([data-core-vehicle])').first();
          if (await unlinked.count()) {
            const before = await page.evaluate(() => !!state.freqFollow);
            await unlinked.tap();
            assert.equal(await page.evaluate(() => !!state.freqFollow), before, '未連結倒數誤追班表車');
          }
          await page.locator('#boardClose').tap();
          assert.equal(await page.evaluate(() => state.boardStation), null, '手機關閉看板失效');
        }
        const following=[];
        // 即使遠端 Core 中斷，新北官方來源與其身分仍應獨立可用。
        await page.evaluate(()=>{state.metroCore.snapshot=null;});
        for(const selected of sources.filter(s=>['V','VB','K'].includes(s.line))){
          await page.evaluate(({line,index})=>{const ln=state.lines.find(l=>l.id===line);openBoard({...ln.stations[index],sys:ln._sys});},selected);
          const linked=page.locator('#board .row[data-core-vehicle]').first();
          const id=await linked.getAttribute('data-core-vehicle');
          assert(id?.startsWith('ntm:'));
          await linked.tap();
          await page.waitForFunction(id=>state._freqHits?.some(h=>h.core&&h.vehicleId===id),id,{timeout:10000});
          const follow=await page.evaluate(()=>{
            const f=state.freqFollow,r=metroCoreFollowRecord(f),info=metroCoreVehicleInfo(r);
            const rendered=r&&metroCoreItemsForLine(r.ln)?.find(x=>x.vehicleId===f.vehicleId);
            const valid=rendered&&Math.abs(rendered.pos.lat-r.pos.lat)<1e-10&&Math.abs(rendered.pos.lon-r.pos.lon)<1e-10;
            return {id:f?.vehicleId,publicLabel:info.officialNo,valid:!!valid,status:document.getElementById('fcStatus').textContent,crowd:freqCrowdCars()};
          });
          assert.equal(follow.id,id);assert(follow.publicLabel);assert(follow.valid);
          assert.match(follow.status,/官方(車號|倒數)/);assert.equal(follow.crowd,null);
          if(process.env.METRO_SCREENSHOT_DIR && width===375 && selected.line==='K'){
            fs.mkdirSync(process.env.METRO_SCREENSHOT_DIR,{recursive:true});
            await page.screenshot({path:path.join(process.env.METRO_SCREENSHOT_DIR,`${engine}-375.png`)});
          }
          following.push(follow);await page.evaluate(()=>clearFreqFollow());
        }
        let clockReplay=null;
        if(ntmInputs){
          // 第二份真實序列重播：官方時間要進入實際跟車卡，不能只檢查模型內的附加欄位。
          clockReplay=await page.evaluate(inputs=>{
            state.ntmLiveModel={};state._ntmLiveRaw={};
            const failures=[],cases=[],checked=[];
            for(const row of inputs){
              window.__auditNow=row.received*1000;state.simSec=metroCoreEpochSecOfDay(row.received);
              applyNtmLive(row.feed,row.body.src,row.body.at,row.received*1000);
              const sourceAt=Date.parse(row.body.at)/1000,sys=NtmLiveModel.system(state.ntmLiveModel,row.feed,row.received);
              for(const train of sys?.trains||[]){
                const o=train.observation,eta=sourceAt+o.seconds;
                if(train.pending||train.sourceAt!==sourceAt||eta<row.received-30)continue;
                const ln=state.lines.find(l=>l.id===train.lineId),pos=metroCorePositionAt(ln,train,row.received);
                const info=metroCoreVehicleInfo({ln,train,pos,systemId:sys.systemId});
                checked.push(train.vehicleId);
                if(info.nextBasis!=='official'||Math.abs(info.nextSec-metroCoreEpochSecOfDay(eta))>.001||info.nextName!==ln.stations[o.si].name)
                  failures.push({car:o.car,eta,info});
                if(o.seconds>1&&eta>=row.received&&train.calls[0].arrivalEpoch>eta+1)
                  cases.push({line:ln.id,si:o.si,vehicleId:train.vehicleId,eta,received:row.received});
              }
            }
            return {checked:checked.length,failures,cases};
          },ntmInputs);
          assert(clockReplay.checked>20);assert.deepEqual(clockReplay.failures,[]);
          assert(clockReplay.cases.length>0,'真實資料必須包含動畫時鐘與官方 ETA 分離的案例');
          const selected=clockReplay.cases.find(c=>c.line==='K')||clockReplay.cases[0];
          await page.evaluate(({inputs,selected})=>{
            state.ntmLiveModel={};state._ntmLiveRaw={};
            for(const row of inputs.filter(r=>r.received<=selected.received)){
              window.__auditNow=row.received*1000;state.simSec=metroCoreEpochSecOfDay(row.received);
              applyNtmLive(row.feed,row.body.src,row.body.at,row.received*1000);
            }
            const ln=state.lines.find(l=>l.id===selected.line);openBoard({...ln.stations[selected.si],sys:ln._sys});
          },{inputs:ntmInputs,selected});
          const link=page.locator(`#board .row[data-core-vehicle="${selected.vehicleId}"]`);
          await link.tap();
          await page.waitForFunction(id=>state._freqHits?.some(h=>h.vehicleId===id),selected.vehicleId);
          const displayed=await page.evaluate(()=>{
            const rec=metroCoreFollowRecord(state.freqFollow),info=metroCoreVehicleInfo(rec);
            return {next:info.nextSec,basis:info.nextBasis,text:document.getElementById('fcNext').textContent,
              status:document.getElementById('fcStatus').textContent,overflow:document.documentElement.scrollWidth-innerWidth};
          });
          assert.equal(displayed.basis,'official');assert(Math.abs(displayed.next-((selected.eta+8*3600)%86400))<.001);
          assert.match(displayed.status,/官方倒數/);assert(displayed.overflow<=2);
          clockReplay.displayed=displayed;
          if(process.env.METRO_SCREENSHOT_DIR&&width===375)await page.screenshot({path:path.join(process.env.METRO_SCREENSHOT_DIR,`${engine}-official-clock-375.png`)});
          const motion=await page.evaluate(async selected=>{
            const samples=[];
            for(const elapsed of [0,.1,.25,.5,1,2,3]){
              window.__auditNow=(selected.received+elapsed)*1000;state.simSec=metroCoreEpochSecOfDay(selected.received+elapsed);
              await new Promise(requestAnimationFrame);
              const rec=metroCoreFollowRecord(state.freqFollow);
              samples.push({elapsed,progress:rec.pos.progress,direction:rec.train.direction,
                drawn:state._freqHits.some(h=>h.vehicleId===selected.vehicleId)});
            }
            return samples;
          },selected);
          assert(motion.every(s=>s.drawn));
          for(let i=1;i<motion.length;i++){
            const d=motion[i].progress-motion[i-1].progress,dir=motion[i].direction===2?1:-1;
            assert(dir*d>=-1e-8&&Math.abs(d)<.05,'動畫不能倒退或跳站');
          }
          clockReplay.motion=motion;
          await page.evaluate(eta=>{window.__auditNow=(eta+31)*1000;state.simSec=metroCoreEpochSecOfDay(eta+31);},selected.eta);
          await page.waitForFunction(()=>document.getElementById('fcStatus').textContent.includes('下一站時間與位置為推估'));
          clockReplay.afterOfficialWindow=await page.locator('#fcStatus').textContent();
          await page.evaluate(()=>clearFreqFollow());
        }
        const travel=await page.evaluate(()=>{const save=state.simSec;state.simSec+=600;
          const result=['V','VB','K'].map(id=>metroCoreItemsForLine(state.lines.find(l=>l.id===id)));state.simSec=save;return result;});
        assert(travel.every(x=>x===null),'時間旅行不能沿用即時車輛');
        const stale = await page.evaluate(() => {
          window.__auditNow += 151000;
          const ln = state.lines.find(l => l.id === 'KR');
          return ln.stations.reduce((sum, _st, si) => sum + metroSourceRowsForEntry({ ln, si }).length, 0);
        });
        assert.equal(stale, 0, '過期來源仍偽裝成即時');
        assert(await page.evaluate(()=>['V','VB','K'].every(id=>metroCoreItemsForLine(state.lines.find(l=>l.id===id))===null)), 'NTM 個別觀測過期必須降級');
        assert.deepEqual(errors, []);
        const result = { engine, width, sources, following, clockReplay, errors, staleRows: stale };
        results.push(result);
        console.log(JSON.stringify(result));
        await context.close();
      }
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
if (process.env.METRO_RESULT) fs.writeFileSync(process.env.METRO_RESULT, JSON.stringify({ method: 'Captured production responses; functional browser replay, not accuracy scoring', results }, null, 2));
console.log(`PASS ${results.length} 組瀏覽器／手機寬度，6 條線官方倒數與觸控驗證`);
