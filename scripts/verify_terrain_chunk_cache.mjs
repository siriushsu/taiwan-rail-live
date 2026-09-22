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
// mode='capacitor' 照 Android App 實測（2026-09-18 模擬器 API 35，@capacitor/android 8.4.2 ＋ WebView）：
//   有 Range 就回 206、Content-Range 照抄請求，但 body 是【從請求起點一路到檔尾】（要 100-199 拿到 8,388,508
//   bytes、要 5000000-5000015 拿到 3,388,608 bytes）；沒帶 Range 回 200 整片。只看狀態碼的讀法會把這份當片段，
//   長度不符丟錯，地景底圖的 DEM 永遠不到（Android 地景立體列車消失）。
function install(mode,log){
  globalThis.fetch=async(url,init)=>{
    const name=String(url).split('/').pop();
    if(name==='manifest.json')return {ok:true,json:async()=>manifest};
    const index=Number(name.replace('.bin',''));
    const m=/^bytes=(\d+)-(\d+)$/.exec(init?.headers?.Range||'');
    const chunk=whole.subarray(index*CHUNK,(index+1)*CHUNK),start=m&&Number(m[1]),end=m&&Number(m[2]);
    const [status,body]=!m||mode==='cloudflare'?[200,chunk]:mode==='capacitor'?[206,chunk.subarray(start)]:[206,chunk.subarray(start,end+1)];
    log.push({index,bytes:body.byteLength,range:!!m});
    return {ok:true,status,arrayBuffer:async()=>body.buffer.slice(body.byteOffset,body.byteOffset+body.byteLength)};
  };
}
const stub={PMTiles:class{constructor(source){this.source=source;}}};
async function build(mode,log){install(mode,log);const {terrainArchive}=await import('../rail-3d/terrain-source.js?'+Math.random());return (await terrainArchive(stub)).source;}

// 取樣序列照真實開站的形狀：先讀檔頭與目錄（同一片的多次小讀），再讀幾張圖磚。
const reads=[[0,16],[40,120],[900,64],[3000,200],[16,32],[CHUNK+10,50],[CHUNK+900,80],[0,64]];
const notes={};
// 第二組從分片中段開始讀：Android 那台第一筆拿到的是「起點到檔尾」而不是整片，這條路徑只有這組會走到。
const midFirst=[[CHUNK+900,80],[CHUNK+10,50],[900,64],[CHUNK+3000,16],[40,120]];
for(const [mode,seq] of [['cloudflare',reads],['capacitor',reads],['capacitor-mid',midFirst],['range',reads]]){
  const log=[],source=await build(mode.replace('-mid',''),log);
  for(const [offset,length] of seq){
    const got=new Uint8Array((await source.getBytes(offset,length)).data);
    assert.deepEqual([...got],[...whole.subarray(offset,offset+length)],mode+' 讀回來的位元組要與原檔相同');
  }
  notes[mode]={請求次數:log.length,下載KB:+(log.reduce((a,r)=>a+r.bytes,0)/1024).toFixed(1),帶Range次數:log.filter(r=>r.range).length};
}
// Cloudflare 那台：8 次讀取只碰 2 片，整份給也只該抓 2 次。
assert.equal(notes.cloudflare.請求次數,2,'忽略 Range 的伺服器上，8 次讀取只該發 2 次請求（一片一次）');
assert.ok(notes.cloudflare.下載KB<=CHUNKS*CHUNK/1024/2,'忽略 Range 的伺服器上，下載量不得超過用到的分片大小');
// Android 那台：內容逐位元組正確（上面已驗），且被抓到不照 Range 回之後不再帶 Range、一片只抓一次。
assert.equal(notes.capacitor.請求次數,2,'Android App 的伺服器上，從檔頭開始的 8 次讀取只該發 2 次請求');
assert.equal(notes['capacitor-mid'].請求次數,3,'Android App 從分片中段開始讀：第一筆拿到尾段、之後兩片各整片抓一次，共 3 次');
assert.equal(notes['capacitor-mid'].帶Range次數,1,'Android App 的伺服器第一次回得比要的多之後，就不該再帶 Range');
// 正向對照：會回 206 的伺服器要維持原本的逐段讀取，不得因為快取而少讀或讀錯。
assert.equal(notes.range.請求次數,reads.length,'支援 Range 的伺服器上，每次讀取仍各自發一次請求（片段不進快取）');
assert.ok(notes.range.下載KB<1,'支援 Range 的伺服器上，下載量應該只有幾百位元組');
// 分母：兩台都要真的跑過，否則上面的斷言可能是空過。
assert.ok(Object.values(notes).every(n=>n.請求次數>0)&&Object.keys(notes).length===4,'兩種伺服器都要真的被請求過');

console.log(notes);
console.log('地形分片快取：忽略 Range 與 Android App 的伺服器不重複下載、支援 Range 的維持原行為、內容逐位元組相同，皆通過');
