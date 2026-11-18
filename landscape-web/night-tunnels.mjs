// 使用原圖磚相同的燈光模型重算後，只疊上地下里程造成差異的像素；資料版本不合便沿用圖磚。
const directory=new URL('./places/night/',import.meta.url);
let index;
export async function patchNightTexture(texture,url,bytes) {
  const path=/(?:^|\/)((?:night\/far2?\/F\d+_\d+\.png)|(?:far[23]?\/F\d+_\d+\/mask\.png))$/.exec(url)?.[1];
  if(!path)return;
  try {
    index??=fetch(new URL('index.json',directory)).then(r=>{if(!r.ok)throw Error(r.status);return r.json()}).catch(e=>{index=null;throw e});
    const expected=(await index)[path];
    if(!expected || expected[0]!==bytes.byteLength)return;
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    const signature=Array.from(digest.subarray(0,12),v=>v.toString(16).padStart(2,'0')).join('');
    if(expected[1]!==signature)return;
    const response=await fetch(new URL(path,directory));if(!response.ok)return;
    const bitmap=await createImageBitmap(await response.blob());
    const canvas=document.createElement('canvas');canvas.width=texture.image.width;canvas.height=texture.image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(texture.image,0,0);ctx.drawImage(bitmap,0,0);bitmap.close();
    texture.image=canvas;texture.needsUpdate=true;
  } catch { /* 原圖磚已經載好，弱網仍能顯示夜景。 */ }
}
