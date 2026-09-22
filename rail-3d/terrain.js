// 缺檔時裁切較粗的真實高程，不能把未知陸地補成海平面。
// 只有 404 才往上一層尋找；斷網、拒絕存取等錯誤仍回報給地圖。
export function registerTerrainProtocol(maplibregl,{archive=null}={}) {
  const cache=new Map();
  const stats={mode:archive?'local':'remote',localReads:0,networkReads:0,fallbacks:{},missing:{}};
  async function read(z,x,y,signal){
    const key=`${z}/${x}/${y}`;
    if(cache.has(key))return cache.get(key);
    if(archive){
      const tile=await archive.getZxy(z,x,y,signal);signal.throwIfAborted();
      if(!tile){stats.missing[key]=true;return null;}
      const data=tile.data;stats.localReads++;cache.set(key,data);
      if(cache.size>32)cache.delete(cache.keys().next().value);
      return data;
    }
    const response=await fetch(`https://tiles.mapterhorn.com/${key}.webp`,{signal});
    if(response.status===404){stats.missing[key]=true;return null;}
    if(!response.ok)throw new Error(`地形圖磚 ${key}：HTTP ${response.status}`);
    const data=await response.arrayBuffer();stats.networkReads++;cache.set(key,data);
    if(cache.size>32)cache.delete(cache.keys().next().value);
    return data;
  }
  maplibregl.addProtocol('island-dem',async(params,controller)=>{
    const match=params.url.match(/^island-dem:\/\/(\d+)\/(\d+)\/(\d+)$/);
    if(!match)throw new Error('地形圖磚網址不正確');
    const [z,x,y]=match.slice(1).map(Number),signal=controller.signal;
    const original=await read(z,x,y,signal);
    if(original)return {data:original.slice(0)};
    for(let level=1;level<=Math.min(z,archive?12:4);level++){
      const scale=2**level,parentZ=z-level,parentX=Math.floor(x/scale),parentY=Math.floor(y/scale);
      const parent=await read(parentZ,parentX,parentY,signal);
      if(!parent)continue;
      signal.throwIfAborted();
      const image=new Image(),blobURL=URL.createObjectURL(new Blob([parent],{type:'image/webp'}));
      try{
        image.src=blobURL;await image.decode();signal.throwIfAborted();
        const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
        const context=canvas.getContext('2d');context.imageSmoothingEnabled=false;
        const size=image.width/scale;
        context.drawImage(image,(x%scale)*size,(y%scale)*size,size,size,0,0,512,512);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        if(!blob)throw new Error('無法讀取備援高程圖磚');
        signal.throwIfAborted();
        stats.fallbacks[`${z}/${x}/${y}`]=`${parentZ}/${parentX}/${parentY}`;
        return {data:await blob.arrayBuffer()};
      }finally{URL.revokeObjectURL(blobURL);}
    }
    throw new Error(`缺少地形圖磚 ${z}/${x}/${y}，較粗圖磚也無法使用`);
  });
  return stats;
}
