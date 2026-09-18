// 地形分片：伺服器忽略 Range 時不准重複下載同一片。
// 🔴 這支為什麼不能只靠本機瀏覽器驗：scripts/dev_server.mjs 會正確回 206，Cloudflare Workers 的
//    靜態資產不會（2026-09-12 對正式站 curl 實測：要 16 KB 回 200 ＋整個 8 MB，連 accept-ranges 都沒有）。
//    在本機跑什麼都是綠的，所以這裡自己造一台「照 Cloudflare 行為」的伺服器來考。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const CHUNK=64*1024,CHUNKS=6,TOTAL=CHUNK*CHUNKS;
const whole=crypto.randomBytes(TOTAL);
const manifest={chunkSize:CHUNK,byteLength:TOTAL,sha256:'test',
  chunks:Array.from({length:CHUNKS},(_,i)=>({file:i+'.bin',bytes:CHUNK,sha256:'c'+i}))};

// mode='cloudflare' 一律回 200 加整片；mode='range' 照 Range 回 206；
// mode='capacitor' 照 @capacitor/android 8.4.2 WebViewLocalServer.handleLocalRequest：
//   有 Range 就回 206、Content-Range 照抄請求，但 body 是【從檔頭開始的整份檔案】——它根本沒跳到起點。
//   只看狀態碼的讀法會把這份當片段，長度不符丟錯，地景底圖的 DEM 永遠不到（2026-09-18 Android 立體列車消失）。
function install(mode,log){
  globalThis.fetch=async(url,init)=>{
    const name=String(url).split('/').pop();
    if(name==='manifest.json')return {ok:true,json:async()=>manifest};
    const index=Number(name.replace('.bin',''));
    const m=/^bytes=(\d+)-(\d+)$/.exec(init?.headers?.Range||'');
    const start=Number(m[1]),end=Number(m[2]);
    const body=mode==='range'?whole.subarray(index*CHUNK+start,index*CHUNK+end+1):whole.subarray(index*CHUNK,(index+1)*CHUNK);
    log.push({index,bytes:body.byteLength});
    return {ok:true,status:mode==='cloudflare'?200:206,arrayBuffer:async()=>body.buffer.slice(body.byteOffset,body.byteOffset+body.byteLength)};
  };
}
const stub={PMTiles:class{constructor(source){this.source=source;}}};
async function build(mode,log){install(mode,log);const {terrainArchive}=await import('../rail-3d/terrain-source.js?'+Math.random());return (await terrainArchive(stub)).source;}

// 取樣序列照真實開站的形狀：先讀檔頭與目錄（同一片的多次小讀），再讀幾張圖磚。
const reads=[[0,16],[40,120],[900,64],[3000,200],[16,32],[CHUNK+10,50],[CHUNK+900,80],[0,64]];
const notes={};
for(const mode of ['cloudflare','capacitor','range']){
  const log=[],source=await build(mode,log);
  for(const [offset,length] of reads){
    const got=new Uint8Array((await source.getBytes(offset,length)).data);
    assert.deepEqual([...got],[...whole.subarray(offset,offset+length)],mode+' 讀回來的位元組要與原檔相同');
  }
  notes[mode]={請求次數:log.length,下載KB:+(log.reduce((a,r)=>a+r.bytes,0)/1024).toFixed(1)};
}
// Cloudflare 那台：8 次讀取只碰 2 片，整份給也只該抓 2 次。
assert.equal(notes.cloudflare.請求次數,2,'忽略 Range 的伺服器上，8 次讀取只該發 2 次請求（一片一次）');
assert.ok(notes.cloudflare.下載KB<=CHUNKS*CHUNK/1024/2,'忽略 Range 的伺服器上，下載量不得超過用到的分片大小');
// Capacitor 那台：假 206 其實是整片，行為要跟 Cloudflare 一樣（內容正確、一片只抓一次）。
assert.equal(notes.capacitor.請求次數,2,'回假 206（整份檔案）的伺服器上，8 次讀取只該發 2 次請求');
// 正向對照：會回 206 的伺服器要維持原本的逐段讀取，不得因為快取而少讀或讀錯。
assert.equal(notes.range.請求次數,reads.length,'支援 Range 的伺服器上，每次讀取仍各自發一次請求（片段不進快取）');
assert.ok(notes.range.下載KB<1,'支援 Range 的伺服器上，下載量應該只有幾百位元組');
// 分母：兩台都要真的跑過，否則上面的斷言可能是空過。
assert.ok(notes.cloudflare.請求次數>0&&notes.capacitor.請求次數>0&&notes.range.請求次數>0,'兩種伺服器都要真的被請求過');

console.log(notes);
console.log('地形分片快取：忽略 Range 與回假 206 的伺服器不重複下載、支援 Range 的維持原行為、內容逐位元組相同，皆通過');
