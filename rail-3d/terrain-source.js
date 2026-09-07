// 不改高程內容，只把原 PMTiles 分成小型靜態資產。Range 只讀本次所需圖磚。
const root=new URL('./terrain/',import.meta.url);
export async function terrainArchive(pmtiles){
  const response=await fetch(new URL('manifest.json',root));if(!response.ok)throw Error('地形目錄載入失敗');const manifest=await response.json();
  return new pmtiles.PMTiles({getKey:()=>root.href+manifest.sha256,
    async getBytes(offset,length,signal){
      if(offset<0||length<0||offset+length>manifest.byteLength)throw Error('地形讀取範圍不正確');
      const result=new Uint8Array(length);let written=0;
      while(written<length){const at=offset+written,index=Math.floor(at/manifest.chunkSize),start=at%manifest.chunkSize,n=Math.min(length-written,manifest.chunks[index].bytes-start);
        const r=await fetch(new URL(manifest.chunks[index].file,root),{headers:{Range:`bytes=${start}-${start+n-1}`},signal});
        if(!r.ok)throw Error('地形分片讀取失敗');const b=new Uint8Array(await r.arrayBuffer());
        const part=r.status===206?b:b.subarray(start,start+n);if(part.byteLength!==n)throw Error('地形分片長度不符');result.set(part,written);written+=n;
      }return {data:result.buffer};
    }});
}
