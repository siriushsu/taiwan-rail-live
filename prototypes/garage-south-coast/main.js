// 原型頁薄殼：場景邏輯已搬到 rail-3d/garage-scenes/south-coast-view.js（共用場景外框頁 garage-scene.html 也用它）。
// window.southCoastPreview 介面欄位維持不變，scripts/verify_garage_south_coast*.mjs、verify_garage_follow_camera.mjs 直接沿用。
import {mountSouthCoast} from '../../rail-3d/garage-scenes/south-coast-view.js?revision=scene-frame-0929';
const handle=mountSouthCoast(document,{car:'blue'});
handle.ready.then(ok=>{if(ok)window.southCoastPreview=handle.preview;});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
