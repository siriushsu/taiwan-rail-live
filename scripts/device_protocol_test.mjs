// A54 整套錄影協定自動化:CDP Input.dispatchTouchEvent 真手勢(捏合／拖曳／兩指旋轉／兩指傾斜各 5 秒)→ 1× 跟車 30 秒 → 退出 → 切外觀／衛星,
// adb screenrecord 同步錄 → 拉回 ~/Desktop/probe-protocol-a54.mp4 → analyze_device_recording。每個手勢做完印相機狀態(zoom/bearing/pitch 真的變了才算做到)。
//   node device_protocol_test.mjs <repo> <url> <dpr>
//   例:node scripts/device_protocol_test.mjs . 'http://localhost:5179/?engine=maplibre&aligndot=follow' 2.8125
// 前提同 device_follow_test.mjs(USB 偵錯、解鎖亮屏、dev server＋adb reverse)。坑:(1) touchMove 不能逐事件 await(每個 44ms、地圖不動);
// (2) 用過 Input.synthesizePinchGesture 的分頁之後所有 dispatchTouchEvent 都進不了頁面 → 每次關舊分頁開新的;(3) 本機 dev server 沒衛星 token 時沒有 #satBtn。
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
const [repo, url, dprS] = process.argv.slice(2);
const ADB = process.env.ADB || process.env.HOME + '/Library/Android/sdk/platform-tools/adb';
const dpr = +dprS;
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const u = new URL(url);
if (u.hostname === 'localhost') adb('reverse', `tcp:${u.port || 80}`, `tcp:${u.port || 80}`);
try { adb('forward', 'tcp:9223', 'localabstract:chrome_devtools_remote'); } catch (e) {}
const tabs = async () => (await (await fetch('http://localhost:9223/json')).json()).filter(t => t.type === 'page');
for (const old of (await tabs()).filter(t => t.url.startsWith(u.origin))) { await fetch(`http://localhost:9223/json/close/${old.id}`); } // 舊分頁的觸控輸入會死掉(用過 synthesizePinchGesture 之後 dispatchTouchEvent 全進不了頁面),一律開新分頁
await sleep(800);
adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${url}'`);
let tab = null; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); tab = (await tabs()).find(t => t.url.startsWith(u.origin)); }
if (!tab) throw new Error('phone tab not found');
await fetch(`http://localhost:9223/json/activate/${tab.id}`);
console.log('tab', tab.id, tab.url);
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result && r.result.exceptionDetails) throw new Error('page: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result && r.result.result ? r.result.result.value : undefined; };
for (let i = 0; i < 80; i++) { let ok = false; try { ok = await ev('!!(window.__state && __state.ready && window.__alignProbe && (__state.trains||[]).length)'); } catch (e) {} if (ok) break; await sleep(500); if (i === 79) throw new Error('page not ready'); }
console.log('ready; BUILD=', await ev('typeof BUILD!=="undefined"?BUILD:null'), 'dpr=', await ev('devicePixelRatio'), 'vp=', await ev('innerWidth+"x"+innerHeight'), 'href=', await ev('location.href'));
await ev('(document.getElementById("howtoGo")||{click(){}}).click();1'); await sleep(800);
console.log('handlers', await ev('JSON.stringify({pitch:__map.touchPitch.isEnabled(),rot:__map.touchZoomRotate.isEnabled(),drag:__map.dragPan.isEnabled(),maxPitch:__map.getMaxPitch()})'));
const cam = async () => await ev('(()=>{const c=M.getCenter();return JSON.stringify({lat:+c.lat.toFixed(5),lng:+c.lng.toFixed(5),z:+M.getZoom().toFixed(2),b:+M.getBearing().toFixed(1),p:+__map.getPitch().toFixed(1)})})()');
const ins = JSON.parse(await ev('JSON.stringify(mapInsets())')); const W = await ev('innerWidth'), H = await ev('innerHeight');
const cx = Math.round((ins.left + (W - ins.right)) / 2), cy = Math.round((ins.top + (H - ins.bottom)) / 2);
console.log('gesture center', cx, cy, 'insets', JSON.stringify(ins));
const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i, radiusX: 6, radiusY: 6, force: 1 })) });
const ease = t => 0.5 - 0.5 * Math.cos(Math.PI * t);
const outBack = t => t < 0.5 ? ease(t * 2) : ease((1 - t) * 2); // 去再回,兩端速度 0(不留慣性)
async function gesture(name, secs, fn) {
  const steps = Math.round(secs * 60), t0 = performance.now();
  await touch('touchStart', fn(0));
  let mid = null;
  for (let i = 1; i <= steps; i++) { touch('touchMove', fn(i / steps)); const d = t0 + i * (secs * 1000 / steps) - performance.now(); if (d > 0) await sleep(d); if (i === Math.round(steps / 2)) mid = await cam(); } // 不等回覆:逐事件 await 每個要 44ms,而且地圖不動(實測 touch_probe.mjs);16ms 節拍連送 Chrome 會自己合併 touchmove
  await touch('touchEnd', []);
  console.log(name, 'done', ((performance.now() - t0) / 1000).toFixed(1) + 's; mid', mid, 'end', await cam()); // 去回型手勢結束時相機會回原位,中途那筆才證明手勢有效
}
await ev('setSpeed(1);1');
await ev('M.setView([25.04,121.54],14,{animate:false});1'); await sleep(1000);
console.log('start cam', await cam());
await gesture('warm-up drag', 1, t => [[cx - 40 + 80 * outBack(t), cy]]); await sleep(500); // 新分頁的第一個雙指手勢常只吃到一半(實測 device_pinch_test:冷捏合 mid 15.06/end 15.06,暖身後 16.3/14.9),先單指暖身
const out = '/sdcard/probe-protocol.mp4';
const rec = spawn(ADB, ['shell', 'screenrecord', '--time-limit', '72', '--bit-rate', '16000000', out], { stdio: 'inherit' });
await sleep(1500);
await gesture('pinch', 5, t => { const d = 100 + 160 * outBack(t); return [[cx - d / 2, cy], [cx + d / 2, cy]]; }); await sleep(1000);
await gesture('drag', 5, t => { const s = outBack(t); return [[cx - 60 + 130 * s, cy - 40 + 80 * s]]; }); await sleep(1000);
await gesture('rotate', 5, t => { const a = ease(t) * Math.PI / 2, r = 100; return [[cx + r * Math.cos(a), cy + r * Math.sin(a)], [cx - r * Math.cos(a), cy - r * Math.sin(a)]]; }); await sleep(1000);
await gesture('tilt', 5, t => { const y = cy + 100 - 160 * outBack(t); return [[cx - 90, y], [cx + 90, y]]; }); await sleep(1000);
const tr = await ev(`(()=>{const c=M.getCenter();const cand=(state.trains||[]).map(tr=>{const a=trainPos(tr,state.simSec-5),b=trainPos(tr,state.simSec+5);return {tr,a,heading:a&&b?initialBearing(a,b):null};}).filter(x=>x.a&&x.heading!=null).sort((x,y)=>Math.hypot(x.a.lat-c.lat,x.a.lon-c.lng)-Math.hypot(y.a.lat-c.lat,y.a.lon-c.lng))[0]; if(!cand) return null; setFollow(cand.tr,false,false); return cand.tr.train;})()`);
console.log('follow 1×', tr); await sleep(30000);
console.log('follow cam', await cam(), 'probe', await ev('JSON.stringify(__alignProbe.state())'));
await ev('clearFollow();1'); await sleep(2000); console.log('exit follow cam', await cam());
await ev('document.getElementById("themeBtn").click();1'); await sleep(3000); console.log('theme', await ev('JSON.stringify({appearance:state.appearance,dark:state.mapDark,cls:document.querySelector(".stage").className})'));
const hasSat = await ev('!!(document.getElementById("satBtn")&&document.getElementById("satBtn").offsetParent)');
if (hasSat) { await ev('document.getElementById("satBtn").click();1'); await sleep(3000); console.log('sat', await ev('JSON.stringify({basemap:state.basemap,cls:document.querySelector(".stage").className})')); await ev('document.getElementById("satBtn").click();1'); await sleep(1500); }
else { console.log('sat button absent (no sat token on this origin) → skipped'); await sleep(4500); }
for (let i = 0; i < 3; i++) { await ev('document.getElementById("themeBtn").click();1'); await sleep(700); if (!(await ev('state.mapDark'))) break; }
console.log('restored', await ev('JSON.stringify({appearance:state.appearance,dark:state.mapDark,basemap:state.basemap})'));
await new Promise(res => rec.on('exit', res));
ws.close();
const local = path.join(process.env.HOME, 'Desktop', 'probe-protocol-a54.mp4');
adb('pull', out, local); console.log('pulled', local);
execFileSync('node', [path.join(repo, 'scripts/analyze_device_recording.mjs'), local, '--dpr', String(dpr)], { stdio: 'inherit', cwd: repo });
