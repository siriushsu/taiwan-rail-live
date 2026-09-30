// 原型頁薄殼：場景邏輯在 rail-3d/garage-scenes/guanghua-view.js（場景外框頁 garage-scene.html 也用它）。
// 預設掛 emu3000；網址帶 ?car=<車款id> 換車、?period=day|sunset|night、?opposing=1 另一股軌道再跑一班對向車（本機檢視與測試用）。
// window.guanghuaPreview 是驗收用的量測介面（見 guanghua-view.js 的 preview）。
import {mountGuanghua} from '../../rail-3d/garage-scenes/guanghua-view.js?revision=guanghua-rough-20260930';
const q=new URLSearchParams(location.search);
const handle=mountGuanghua(document,{car:q.get('car')||undefined,period:q.get('period')||undefined,params:{opposing:q.get('opposing')==='1'}});
handle.ready.then(ok=>{if(ok)window.guanghuaPreview=handle.preview;});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
