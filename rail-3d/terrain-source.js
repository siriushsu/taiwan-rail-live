// 不改高程內容，只把原 PMTiles 分成小型靜態資產。Range 只讀本次所需圖磚。
// 🔴 Cloudflare Workers 的靜態資產【不支援 Range】：2026-09-12 對正式站實測，向 00.bin 要 16 KB
//    回的是 HTTP 200 加整個 8 MB 分片，連 accept-ranges 都沒有。而本機 dev_server.mjs 會正確回 206，
//    所以這個毛病在本機結構上看不見。實測開站（地景底圖）九次圖磚讀取全落在同一個分片：
//    真正要的 2.3 MB，實際下載 72 MB，主執行緒連帶凍結 8.3 秒。
//    伺服器既然整份都給了就留著用：同一分片的後續讀取直接切記憶體，同時進來的讀取共用同一個 fetch。
//    回 206 的伺服器（本機、將來支援 Range 的來源）拿到的是片段，不進快取，行為與從前完全相同。
const root=new URL('./terrain/',import.meta.url);
// 留幾片看記憶體預算，不看片數——分片大小將來若改小，這裡會自己多留幾片。
const CACHE_BUDGET=16*1024*1024;
export async function terrainArchive(pmtiles){
  const response=await fetch(new URL('manifest.json',root));if(!response.ok)throw Error('地形目錄載入失敗');const manifest=await response.json();
  const held=new Map(),keep=Math.max(2,Math.round(CACHE_BUDGET/manifest.chunkSize));
  async function download(index,start,n,signal){
    const r=await fetch(new URL(manifest.chunks[index].file,root),{headers:{Range:`bytes=${start}-${start+n-1}`},signal});
    if(!r.ok)throw Error('地形分片讀取失敗');const b=new Uint8Array(await r.arrayBuffer());
    return r.status===206?{slice:b}:{full:b};
  }
  async function read(index,start,n,signal){
    const cached=held.get(index);
    if(cached){held.delete(index);held.set(index,cached);const full=await cached;if(full)return full.subarray(start,start+n);}
    const pending=download(index,start,n,signal);
    // 先掛上去讓同時進來的讀取共用；只給片段或抓失敗就解析成 null，下一次照舊自己抓。
    held.set(index,pending.then(o=>o.full||null,()=>null));
    for(const k of [...held.keys()].slice(0,Math.max(0,held.size-keep)))if(k!==index)held.delete(k);
    const o=await pending;return o.full?o.full.subarray(start,start+n):o.slice;
  }
  return new pmtiles.PMTiles({getKey:()=>root.href+manifest.sha256,
    async getBytes(offset,length,signal){
      if(offset<0||length<0||offset+length>manifest.byteLength)throw Error('地形讀取範圍不正確');
      const result=new Uint8Array(length);let written=0;
      while(written<length){const at=offset+written,index=Math.floor(at/manifest.chunkSize),start=at%manifest.chunkSize,n=Math.min(length-written,manifest.chunks[index].bytes-start);
        const part=await read(index,start,n,signal);
        if(part.byteLength!==n)throw Error('地形分片長度不符');result.set(part,written);written+=n;
      }return {data:result.buffer};
    }});
}
