// 車庫場景解鎖：車庫（index.html 的 train-garage.js）與場景外框頁（garage-scene.html）共用這一份，不准另寫一份判斷。
// 解鎖單位是場景 id（south-coast／viaduct／shifen／alishan），不是車款 id；不綁通行證（plusActive）。
// 唯一判斷點是 garageSceneUnlocked(sceneId)：卡片的鎖頭與場景頁要不要掛 3D 都只問它。
(function(){
 const TEST_KEY='rail-garage-scene-unlock-test';
 // 本機測試開關：網址帶 ?unlock=1 打開、?unlock=0 關掉，記在同源 localStorage。
 // 車庫與場景 iframe 同源，所以兩邊看到同一個值。
 // 只在本機與區網有效（localhost、127.0.0.1、*.localhost、*.test、10.／172.16–31.／192.168. 區網位址）：
 // 正式站、預覽站、GitHub Pages 上網址帶 unlock=1 一律不理，不然任何人改個網址就能解開全部景（09-29 驗收 F3）。
 // App 內嵌的 capacitor://localhost、https://localhost 也算本機，但 App 裡使用者改不到網址，不會被拿來開鎖。
 function testSwitchAllowed(){
  try{
   const h=location.hostname;
   return h==='localhost'||h==='127.0.0.1'||h==='[::1]'||h.endsWith('.localhost')||h.endsWith('.test')||/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
  }catch{return false;}
 }
 function garageSceneTestUnlock(sceneId){
  if(!testSwitchAllowed())return false;
  try{
   const u=new URLSearchParams(location.search).get('unlock');
   if(u==='1')localStorage.setItem(TEST_KEY,'1');else if(u==='0')localStorage.removeItem(TEST_KEY);
   return localStorage.getItem(TEST_KEY)==='1';
  }catch{return false;}
 }
 // 籌碼帳本快取：這一輪不接帳本，固定回 null。
 // 懸賞線規劃（主對話判讀，帳本還沒接）：讀 window.RAIL_NATIVE_UNLOCKED_SCENES（原生注入的場景 id 陣列），
 // 否則讀同源 localStorage 'trainmap-chips-me-v1'（{unlocked:[{scene,nth,at}]}）。
 function chipsMeCache(){return null;}
 function garageSceneUnlocked(sceneId){
  if(garageSceneTestUnlock(sceneId))return true;
  const c=chipsMeCache();
  return !!(c&&Array.isArray(c.unlocked)&&c.unlocked.some(u=>u.scene===sceneId));
 }
 Object.assign(window,{garageSceneUnlocked,garageSceneTestUnlock,chipsMeCache});
})();
