// A54 自動跟車驗證:adb reverse 讓手機的 localhost:PORT 打到 Mac 的 dev server → 手機 Chrome 開頁 → CDP(adb forward 9223)
// 驅動 60× 跟車＋幾次平移 → adb screenrecord 同步錄 → 拉回 → analyze_device_recording。用法:
//   node device_follow_test.mjs <repo> <url> <dpr> [secs]
//   例:npm run dev-server(port 5179)後 node scripts/device_follow_test.mjs . 'http://localhost:5179/?engine=maplibre&aligndot=follow' 2.8125 50
// 前提:手機開 USB 偵錯、已解鎖且螢幕亮著(鎖定時 Chrome 收到 intent 也不開分頁);第一次錄會被首訪教學卡蓋住,所以 ready 後先按「開始看車」。
// 產出 ~/Desktop/probe-auto-a54.mp4(dpr 依手機:A54 2.8125)並直接跑分析器;錄影一開始那 1.5 秒探針可能還沒錨定,gap 閘門容得下。
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
const [repo, url, dprS, secsS] = process.argv.slice(2);
const ADB = process.env.ADB || process.env.HOME + '/Library/Android/sdk/platform-tools/adb'; // Node ≥22:fetch／WebSocket 是全域
const secs = +(secsS || 50), dpr = +dprS;
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const u = new URL(url);
adb('reverse', `tcp:${u.port || 80}`, `tcp:${u.port || 80}`);
try { adb('forward', 'tcp:9223', 'localabstract:chrome_devtools_remote'); } catch (e) {}
adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${url}'`);
let tab = null;
for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { const list = await (await fetch('http://localhost:9223/json')).json(); tab = list.find(t => t.type === 'page' && t.url.startsWith(u.origin)); } catch (e) {} }
if (!tab) throw new Error('phone tab not found');
console.log('tab', tab.id, tab.url);
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result && r.result.exceptionDetails) throw new Error('page: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result && r.result.result ? r.result.result.value : undefined; };
for (let i = 0; i < 60; i++) { const ok = await ev('!!(window.__state && __state.ready && window.__alignProbe && (__state.trains||[]).length)'); if (ok) break; await sleep(500); if (i === 59) throw new Error('page not ready'); }
console.log('ready; BUILD=', await ev('typeof BUILD!=="undefined"?BUILD:null'), 'dpr=', await ev('devicePixelRatio'), 'engine=', await ev('window.__map&&__map.raw?"maplibre":"?"'), 'probe=', JSON.stringify(await ev('__alignProbe.state()')));
await ev('(document.getElementById("howtoGo")||{click(){}}).click();1'); await sleep(800); // 首訪教學卡會蓋住探針(第一次自動錄影前 9 秒全是 absent)
console.log('howto dismissed; card visible=', await ev('!!(document.getElementById("howtoGo")&&document.getElementById("howtoGo").offsetParent)'));
const out = '/sdcard/probe-auto.mp4';
const rec = spawn(ADB, ['shell', 'screenrecord', '--time-limit', String(secs), '--bit-rate', '16000000', out], { stdio: 'inherit' });
await sleep(1500);
console.log('setView Taipei z13'); await ev('M.setView([25.04,121.54],13,{animate:false});1'); await sleep(2500);
console.log('speed 60×'); await ev('setSpeed(60);1'); await sleep(500);
const tr = await ev(`(()=>{const cand=(state.trains||[]).map(tr=>{const a=trainPos(tr,state.simSec-5),b=trainPos(tr,state.simSec+5);return {tr,a,heading:a&&b?initialBearing(a,b):null};}).filter(c=>c.a&&c.heading!=null).sort((x,y)=>Math.hypot(x.a.lat-25.04,x.a.lon-121.54)-Math.hypot(y.a.lat-25.04,y.a.lon-121.54))[0]; if(!cand) return null; setFollow(cand.tr,false,false); return cand.tr.train;})()`);
console.log('follow', tr); await sleep(26000);
console.log('probe', JSON.stringify(await ev('__alignProbe.state()')));
await ev('clearFollow();1'); await sleep(1000);
await ev('setSpeed(1);1');
for (const d of [[400, 0], [0, 500], [-400, -300]]) { await ev(`M.panBy([${d[0]},${d[1]}],{animate:false});1`); await sleep(1800); }
console.log('probe', JSON.stringify(await ev('__alignProbe.state()')));
await new Promise(res => rec.on('exit', res));
ws.close();
const local = path.join(process.env.HOME, 'Desktop', 'probe-auto-a54.mp4');
adb('pull', out, local); console.log('pulled', local);
execFileSync('node', [path.join(repo, 'scripts/analyze_device_recording.mjs'), local, '--dpr', String(dpr)], { stdio: 'inherit', cwd: repo });
