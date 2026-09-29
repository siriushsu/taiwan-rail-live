// 原型頁薄殼：場景邏輯已搬到 rail-3d/garage-scenes/viaduct-view.js（共用場景外框頁 garage-scene.html 也用它）。
// window.viaductPreview 介面欄位維持不變，scripts/verify_garage_viaduct*.mjs、verify_garage_fleet_views.mjs 直接沿用。
// 預設掛原生車 emu3000；網址帶 ?car=<車款id> 可換車（本機檢視與測試用）。
import {mountViaduct} from '../../rail-3d/garage-scenes/viaduct-view.js?revision=scene-frame-0929';
const handle=mountViaduct(document,{car:new URLSearchParams(location.search).get('car')||undefined});
handle.ready.then(ok=>{if(ok)window.viaductPreview=handle.preview;});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
