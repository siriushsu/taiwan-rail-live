// 原型頁薄殼：場景邏輯已搬到 rail-3d/garage-scenes/alishan-view.js（共用場景外框頁 garage-scene.html 也用它）。
// window.alishanPreview 介面欄位維持不變，scripts/verify_garage_alishan*.mjs 直接沿用。
// 預設掛原生車 dl38；網址帶 ?car=<車款id> 可換車（本機檢視與測試用）。
import {mountAlishan} from '../../rail-3d/garage-scenes/alishan-view.js?revision=scene-frame-0929';
const handle=mountAlishan(document,{car:new URLSearchParams(location.search).get('car')||undefined});
handle.ready.then(ok=>{if(ok)window.alishanPreview=handle.preview;});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
