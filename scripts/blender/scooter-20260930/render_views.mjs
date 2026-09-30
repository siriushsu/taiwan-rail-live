#!/usr/bin/env node
// 驗收 M5（夜間燈）、M6（對照圖）與瀏覽器內的 draw call／console 檢查。無視窗 Chrome（channel:'chrome', headless:true）。
// 用法：node scripts/blender/scooter-20260930/render_views.mjs <輸出資料夾>
// 自己起一個唯讀靜態伺服器（port 0＝系統挑），跑完就關；測試頁是伺服器內建的虛擬頁，不寫進 repo。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'output/scooter/views'));
fs.mkdirSync(OUT, {recursive: true});
const {chromium} = createRequire(ROOT + '/package.json')('playwright');
const MIME = {'.js': 'text/javascript', '.json': 'application/json', '.gz': 'application/gzip', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png'};
const PAGE = `<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:#888;overflow:hidden}canvas{display:block}</style><body><script type="module">
import * as THREE from '/rail-3d/vendor/three.module.js';
import {loadScooterKit, createScooterRider} from '/rail-3d/garage-scooter.js';
import {loadGarageParts} from '/rail-3d/garage-model.js?revision=doors-0924';
let glCalls=0;for(const k of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced','drawRangeElements']){const P=WebGL2RenderingContext.prototype,o=P[k];if(o)P[k]=function(...a){glCalls++;return o.apply(this,a);};}
const W=1280,H=720;
window.__errors=[];addEventListener('error',e=>window.__errors.push(String(e.message)));addEventListener('unhandledrejection',e=>window.__errors.push('rejection '+e.reason));
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);renderer.setSize(W,H,false);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const [peopleKit,scooterKit]=await Promise.all([loadGarageParts(new URL('/rail-3d/assets/garage-people-v1/people.json',location.href)),loadScooterKit()]);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(24,W/H,.1,60);camera.up.set(0,0,1);
const hemi=new THREE.HemisphereLight('#cfe3ee','#8a8f78',1.5),sun=new THREE.DirectionalLight('#fff2d4',2.6);
sun.position.set(-3,-4,6);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-3,right:3,top:3,bottom:-3,near:1,far:20});sun.shadow.normalBias=.02;
const ground=new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.MeshStandardMaterial({color:'#cfcdc4',roughness:1}));ground.receiveShadow=true;
scene.add(hemi,sun,sun.target,ground);
let cur=null,night=false;
function theme(n){night=n;scene.background=new THREE.Color(n?'#141f2e':'#e7e8e1');hemi.color.set(n?'#5d7590':'#cfe3ee');hemi.groundColor.set(n?'#2b3440':'#8a8f78');hemi.intensity=n?.9:1.5;sun.color.set(n?'#9fbfe4':'#fff2d4');sun.intensity=n?.6:2.6;ground.material.color.set(n?'#3a4350':'#cfcdc4');}
theme(false);
const api={
 build({rider=true,look={},shadows=true}={}){if(cur){scene.remove(cur.group);cur.dispose();}cur=createScooterRider({peopleKit:rider?peopleKit:null,scooterKit,scale:1,look,castShadow:shadows});scene.add(cur.group);return {state:cur.state,dims:cur.dims};},
 theme,setNight(on){cur.setNight(on);},
 view({az,el=0,dist,target,fov=24,h}){// az：從 +X（正前）繞 z 轉的角度（度，正＝往 +Y 左邊）；h：直接指定鏡頭高度
  const a=az*Math.PI/180,e=el*Math.PI/180,t=new THREE.Vector3(...target);camera.fov=fov;camera.updateProjectionMatrix();
  camera.position.set(t.x+dist*Math.cos(e)*Math.cos(a),t.y+dist*Math.cos(e)*Math.sin(a),h??t.z+dist*Math.sin(e));camera.lookAt(t);},
 render(){renderer.info.reset();glCalls=0;renderer.render(scene,camera);return {calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,glDrawCalls:glCalls};},
 project(p){const v=new THREE.Vector3(...p).project(camera);return [(v.x+1)/2*W,(1-v.y)/2*H,v.z];},
 roi(x,y,w,h){const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(renderer.domElement,0,0);
  const d=g.getImageData(Math.round(x-w/2),Math.round(y-h/2),w,h).data;let s=0,m=0;for(let i=0;i<d.length;i+=4){const l=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];s+=l;m=Math.max(m,l);}return {mean:s/(d.length/4),max:m,rgb:[d[0],d[1],d[2]]};},
 update(dt,speed){cur.update(dt,speed);},
 wheelAngle(){return {...cur.state.wheelAngle};},
 rig(){return cur.rig;},
};
window.api=api;window.ready=true;
</script>`;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'), p = decodeURIComponent(url.pathname);
  if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (p === '/__scooter_test.html') { res.writeHead(200, {'content-type': 'text/html'}); return res.end(PAGE); }
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, {'content-type': MIME[path.extname(fp)] ?? 'application/octet-stream', 'cache-control': 'no-store'});
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({channel: 'chrome', headless: true});
const results = {console: {errors: [], warnings: []}};
try {
  const page = await (await browser.newContext({viewport: {width: 1280, height: 720}, deviceScaleFactor: 1})).newPage();
  page.on('console', m => { if (m.type() === 'error') results.console.errors.push(m.text()); else if (m.type() === 'warning') results.console.warnings.push(m.text()); });
  page.on('pageerror', e => results.console.errors.push('pageerror ' + e.message));
  await page.goto(base + '/__scooter_test.html');
  await page.waitForFunction('window.ready===true', null, {timeout: 60000});
  const shot = async (name, view, opts = {}) => { await page.evaluate(v => window.api.view(v), view); const info = await page.evaluate(() => window.api.render()); await page.screenshot({path: path.join(OUT, name + '.png')}); return info; };
  const gl = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  results.gl = gl;
  // ---- 空車：正側面、斜前 45°、正前、側面低角度 ----
  results.build = await page.evaluate(() => window.api.build({rider: false}));
  const T0 = [0, 0, .58];
  await shot('01-scooter-side', {az: -90, dist: 6.2, target: T0});
  await shot('02-scooter-front45', {az: 45, dist: 6.0, target: T0, el: 8});
  await shot('03-scooter-front', {az: 0, dist: 6.2, target: T0});
  await shot('04-scooter-side-low', {az: -90, dist: 4.6, target: [0, 0, .5], h: .5, fov: 34});
  await shot('04b-scooter-rear45', {az: 215, dist: 6.0, target: T0, el: 8});
  // ---- 騎士坐上去 ----
  results.buildRider = await page.evaluate(() => window.api.build({rider: true}));
  const T1 = [0, 0, .86];
  await shot('05-rider-side', {az: -90, dist: 8.0, target: T1});
  await shot('05b-rider-front45', {az: 40, dist: 7.2, target: T1, el: 6});
  await shot('05c-rider-front', {az: 0, dist: 7.6, target: T1});
  // ---- draw call（瀏覽器內 renderer.info）：整組（機車＋騎士＋安全帽）單獨渲染，含陰影與不含陰影 ----
  for (const shadows of [false, true]) {
    await page.evaluate(s => { window.api.build({rider: true, shadows: s}); window.api.view({az: 40, dist: 7.2, target: [0, 0, .86]}); }, shadows);
    const info = await page.evaluate(() => { window.api.render(); return window.api.render(); });
    results['drawCalls_' + (shadows ? 'withShadowCasting' : 'noShadow')] = info;
  }
  // 扣掉地面（1 次）：地面本身也是一個網格，所以場景總呼叫數要再減 1；另外量「只有機車的 group」的呼叫數
  const isolated = await page.evaluate(() => { window.api.build({rider: true, shadows: false}); return window.api.render(); });
  results.drawCalls_note = '場景含地面 1 個網格；機車組本身 ＝ 場景呼叫數 − 1（地面）';
  results.drawCalls_isolatedMain = isolated.calls - 1;
  results.drawCalls_glNote = 'glDrawCalls＝WebGL 層真的下了幾次 draw（含陰影 pass）；場景含地面 1 次；機車組 ＝ 該數字 − 1';
  // ---- 夜間（M5）：同一機位，setNight(false) vs (true)，量前燈、尾燈周圍 30×30 的亮度 ----
  await page.evaluate(() => { window.api.build({rider: true}); window.api.theme(true); });
  const rig = await page.evaluate(() => window.api.rig());
  const measureLamp = async (name, view, point) => {
    await page.evaluate(v => window.api.view(v), view);
    await page.evaluate(() => window.api.setNight(false)); await page.evaluate(() => window.api.render());
    const uv = await page.evaluate(p => window.api.project(p), point);
    const off = await page.evaluate(([x, y]) => window.api.roi(x, y, 30, 30), uv);
    await page.screenshot({path: path.join(OUT, name + '-off.png')});
    await page.evaluate(() => window.api.setNight(true)); await page.evaluate(() => window.api.render());
    const on = await page.evaluate(([x, y]) => window.api.roi(x, y, 30, 30), uv);
    await page.screenshot({path: path.join(OUT, name + '-on.png')});
    return {screen: uv.slice(0, 2).map(Math.round), off, on, gain: on.mean - off.mean};
  };
  results.night = {
    front: await measureLamp('06-night-front45', {az: 30, dist: 6.4, target: [.1, 0, .8], el: 6}, rig.lampFront),
    rear: await measureLamp('07-night-rear', {az: 200, dist: 6.4, target: [-.3, 0, .8], el: 6}, rig.lampRear),
  };
  // 夜間斜前（騎士＋車燈亮）：M6 的第 6 張
  await page.evaluate(() => window.api.setNight(true)); await shot('06-night-front45-lit', {az: 30, dist: 6.4, target: [.1, 0, .8], el: 6});
  // 夜間白天各一張正前：頭燈對照（縮放）
  // ---- 輪子轉動：update 之後前後輪轉角增加、像素改變 ----
  await page.evaluate(() => { window.api.theme(false); window.api.build({rider: false}); window.api.view({az: -90, dist: 3.0, target: [.645, 0, .23], fov: 24}); window.api.render(); });
  const w0 = await page.evaluate(() => window.api.roi(640, 360, 200, 200)); const a0 = await page.evaluate(() => window.api.wheelAngle());
  await page.evaluate(() => { window.api.update(.1, 2.0); window.api.render(); });
  const w1 = await page.evaluate(() => window.api.roi(640, 360, 200, 200)); const a1 = await page.evaluate(() => window.api.wheelAngle());
  results.wheel = {before: a0, after: a1, roiBefore: w0, roiAfter: w1, note: 'update(0.1 s, speed 2.0 m/s)：走 0.2 m，轉角應為 0.2/半徑'};
  results.errorsInPage = await page.evaluate(() => window.__errors);
} finally {
  await browser.close();
  server.close();
}
fs.writeFileSync(path.join(OUT, 'render-results.json'), JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
