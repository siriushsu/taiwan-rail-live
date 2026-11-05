// 車款 → 場景對照表。**手維護，不是產生檔**（對照 train-garage-catalog.js 是 import_garage_blender.py 整份覆寫的產生檔）。
// 設計書：docs/superpowers/specs/2026-09-09-車庫一車一景-design.md §3.4、2026-09-12-車庫場景複審與特色車站-design.md §4
//
// 讀這個檔的有兩處：車庫第 4 格「場景」（train-garage.js），以及 App 的烘焙腳本
//    （native scripts/garage-scenes/bake.mjs 讀網頁釘版，manifest 的 cars 與 place 都從這裡來）。改規則、分派或地名，App 要重烘。
//    已做好的場景跑哪些車、地名叫什麼，看檔尾的 RailGarageSceneRules（照車款目錄的系統分）。下面的對照表留著
//    原型畫的是哪款車（params 為空那款：烘焙拿它的車寬當人與天燈的比例尺）、故事與參數，以及待做場景的草案。
//    其餘待做的場景還沒有程式；站點分派也還沒定案（2026-09-12 草案）。
//
// 欄位：
//   tier   'A' 手工場景（一眼認得出是哪裡）｜'B' 原型＋參數
//   scene  場景模組名，對應 rail-3d/garage-scenes/<scene>.js
//   place  這個場景是哪裡（給 UI 的 label 與 aria-label）
//   story  data/tra_special_trains.json 的 id；沒有故事的留 null
//   params 傳進 createScene(params) 的參數
//
// 已實作：south-coast、alishan、viaduct、shifen，以及不在對照表裡的 duoliang、crossing、guanghua；台鐵特色車站 11 座（station-stage.js 的舞台，檔尾場景規則列的那幾座）；捷運、高鐵、機捷九座在對照表後段，跑哪些車看檔尾的場景規則。其餘為待做。
window.RailGarageScenes = {

 // ───────── Tier A：手工場景（19 座，4 座已完成） ─────────

 // 南迴海岸（已完成；2026-10-28 更正：原本誤寫成多良海岸）
 blue:        {tier:'A',scene:'south-coast',place:'南迴線・南迴海岸',story:'blue-train',params:{}},
 bluecoach:   {tier:'A',scene:'south-coast',place:'南迴線・南迴海岸',story:'blue-train',params:{}},

 // 阿里山林鐵・之字形（已完成；其餘林鐵車款共用場景、換路段參數）
 dl38:        {tier:'A',scene:'alishan',place:'阿里山林鐵・之字形',story:null,params:{}},
 dl25:        {tier:'A',scene:'alishan',place:'阿里山林鐵・獨立山螺旋',story:null,params:{section:'spiral'}},
 dl39:        {tier:'A',scene:'alishan',place:'阿里山林鐵・奮起湖',story:null,params:{section:'fenqihu'}},
 dl45:        {tier:'A',scene:'alishan',place:'阿里山林鐵・二萬坪',story:null,params:{section:'erwanping'}},
 alicoach:    {tier:'A',scene:'alishan',place:'阿里山林鐵・神木',story:null,params:{section:'sacredtree'}},
 hinoki:      {tier:'A',scene:'alishan',place:'阿里山林鐵・檜木林',story:null,params:{section:'cypress'}},
 fushen:      {tier:'A',scene:'alishan',place:'阿里山林鐵・檜木林',story:null,params:{section:'cypress'}},
 xuyue:       {tier:'A',scene:'alishan',place:'阿里山林鐵・二萬坪',story:null,params:{section:'erwanping'}},

 // 高架月台（已完成）
 emu3000:     {tier:'A',scene:'viaduct',place:'高架車站・站前街',story:'emu3000',params:{}},

 // 平溪線十分老街（已完成）
 dr1000:      {tier:'A',scene:'shifen',place:'平溪線・十分老街',story:'pingxi',params:{}},

 // ── 以下是 9/12 的分派草案：場景做好的跑所有台鐵車（看檔尾場景規則），這裡只留故事；qingshui、huadong、roundhouse 還沒做 ──

 // 冬山車站（宜蘭線）：連續白色鋼拱＋半透明膜材屋頂，東部幹線第一個高架車站。
 // 　台鐵沒有「東山車站」（查過臺灣鐵路車站列表全文），「東山」指的即是此站。
 temu2000:    {tier:'A',scene:'dongshan',place:'冬山車站',story:'puyuma',params:{}},
 // 清水斷崖：北迴線隧道口與海崖
 temu1000:    {tier:'A',scene:'qingshui',place:'北迴線・清水斷崖',story:'taroko',params:{}},
 // 台南車站：1936 現代主義古蹟站房
 e1000:       {tier:'A',scene:'tainan',place:'台南車站',story:'pp',params:{}},
 ppcoach:     {tier:'A',scene:'tainan',place:'台南車站',story:'pp',params:{}},
 // 新竹車站：1913 巴洛克古蹟站房
 e200:        {tier:'A',scene:'hsinchu',place:'新竹車站',story:'chukuang',params:{}},
 juguang:     {tier:'A',scene:'hsinchu',place:'新竹車站',story:'chukuang',params:{}},
 // 台北地下月台：寬島式月台、通勤人潮
 emu500:      {tier:'A',scene:'taipei-under',place:'台北車站・地下月台',story:'local',params:{}},
 emu900:      {tier:'A',scene:'taipei-under',place:'台北車站・地下月台',story:'fast-local',params:{crowd:'rush'}},
 // 勝興車站：舊山線木造站房
 shanlan:     {tier:'A',scene:'shengxing',place:'舊山線・勝興車站',story:'shanlan',params:{}},
 // 海線木造小站：談文／大山那一系
 haifeng:     {tier:'A',scene:'haixian',place:'海線・木造小站',story:'haifeng',params:{}},
 // 彰化扇形車庫：轉車盤與放射狀股道
 dt668:       {tier:'A',scene:'roundhouse',place:'彰化扇形車庫',story:'steam',params:{}},
 // 集集車站：檜木站房
 ck124:       {tier:'A',scene:'jiji',place:'集集車站',story:'jiji',params:{}},
 // 花東縱谷：稻田與遠山
 ct273:       {tier:'A',scene:'huadong',place:'花東縱谷・稻田',story:'steam',params:{season:'summer'}},
 dr3100:      {tier:'A',scene:'huadong',place:'花東縱谷・稻田',story:'dr3100',params:{}},
 // 舊高雄車站：1941 帝冠樣式
 mingri:      {tier:'A',scene:'kaohsiung-old',place:'舊高雄車站',story:'mingri',params:{}},
 mingricoach: {tier:'A',scene:'kaohsiung-old',place:'舊高雄車站',story:'mingri',params:{}},

 // ───────── 捷運、高鐵、機捷（2026-11-03 起，一個系統一座，各照一個經典車站；共用骨架 metro-kit.js） ─────────
 // 選站與分組見 native docs/m9/lanes/metro-garage-scenes-handoff.md。

 // 台北捷運高運量：淡水信義線劍潭站（龍舟造型屋頂的高架站）
 c301:        {tier:'A',scene:'taipei-metro',place:'淡水信義線・劍潭站',story:null,params:{}},
 c321:        {tier:'A',scene:'taipei-metro',place:'淡水信義線・劍潭站',story:null,params:{}},
 c341:        {tier:'A',scene:'taipei-metro',place:'淡水信義線・劍潭站',story:null,params:{}},
 c371:        {tier:'A',scene:'taipei-metro',place:'淡水信義線・劍潭站',story:null,params:{}},
 c381:        {tier:'A',scene:'taipei-metro',place:'淡水信義線・劍潭站',story:null,params:{}},
 // 文湖線：動物園站（端點站，旁邊是貓空纜車動物園站）
 wenhu:       {tier:'A',scene:'wenhu',place:'文湖線・動物園站',story:null,params:{}},
 val256:      {tier:'A',scene:'wenhu',place:'文湖線・動物園站',story:null,params:{}},
 // 桃園機場捷運：山鼻站（田野中的高架站）
 airportlocal:  {tier:'A',scene:'airport-mrt',place:'機場捷運・山鼻站',story:null,params:{}},
 airportexpress:{tier:'A',scene:'airport-mrt',place:'機場捷運・山鼻站',story:null,params:{}},
 // 新北捷運中運量（環狀線、三鶯線）：三鶯線陶瓷老街站
 y100:        {tier:'A',scene:'ntpc-metro',place:'三鶯線・陶瓷老街站',story:null,params:{}},
 sanying:     {tier:'A',scene:'ntpc-metro',place:'三鶯線・陶瓷老街站',story:null,params:{}},
 // 新北輕軌（淡海、安坑）：淡海輕軌淡水漁人碼頭站
 danhai:      {tier:'A',scene:'ntpc-lrt',place:'淡海輕軌・淡水漁人碼頭站',story:null,params:{}},
 ankeng:      {tier:'A',scene:'ntpc-lrt',place:'淡海輕軌・淡水漁人碼頭站',story:null,params:{}},
 // 台中捷運：綠線文心森林公園站（旁邊是圓滿戶外劇場）
 taichung:    {tier:'A',scene:'taichung-metro',place:'台中捷運綠線・文心森林公園站',story:null,params:{}},
 // 高雄捷運：美麗島站（地下站，光之穹頂）
 kaohsiung:   {tier:'A',scene:'kaohsiung-metro',place:'高雄捷運・美麗島站',story:null,params:{}},
 // 高雄輕軌：駁二大義站（駁二倉庫群旁的草皮軌道）
 caf:         {tier:'A',scene:'kaohsiung-lrt',place:'高雄輕軌・駁二大義站',story:null,params:{}},
 citadis:     {tier:'A',scene:'kaohsiung-lrt',place:'高雄輕軌・駁二大義站',story:null,params:{}},
 // 台灣高鐵：新竹站（風帆般的彎曲屋頂）
 '700t':      {tier:'A',scene:'thsr',place:'台灣高鐵・新竹站',story:null,params:{}},

 // ───────── Tier B：原型＋參數（台鐵，待做） ─────────

 // 支線木造小站
 emu600:       {tier:'B',scene:'branch-wooden',place:'內灣線・木造小站',story:'neiwan',params:{}},

 // 海線月台
 emu700:       {tier:'B',scene:'seaside-platform',place:'海線・側式月台',story:null,params:{}},
 emu800:       {tier:'B',scene:'seaside-platform',place:'海線・側式月台',story:null,params:{}},
 emu800r:      {tier:'B',scene:'seaside-platform',place:'海線・側式月台',story:null,params:{livery:'reverse'}},

 // 山線隧道口
 emu100:       {tier:'B',scene:'mountain-tunnel',place:'山線・隧道口',story:null,params:{era:'retro'}},
 emu1200:      {tier:'B',scene:'mountain-tunnel',place:'山線・隧道口',story:null,params:{}},
 dr2700:       {tier:'B',scene:'mountain-tunnel',place:'山線・隧道口',story:null,params:{era:'retro'}},

 // 西部幹線正線（電力機車牽引）
 e300:         {tier:'B',scene:'mainline',place:'西部幹線・正線',story:null,params:{}},
 e400:         {tier:'B',scene:'mainline',place:'西部幹線・正線',story:null,params:{}},
 e500:         {tier:'B',scene:'mainline',place:'西部幹線・正線',story:null,params:{}},
 r200:         {tier:'B',scene:'mainline',place:'西部幹線・正線',story:null,params:{}},

 // 調車場
 r20:          {tier:'B',scene:'yard',place:'調車場',story:null,params:{}},
 r100:         {tier:'B',scene:'yard',place:'調車場',story:null,params:{}},
 r150:         {tier:'B',scene:'yard',place:'調車場',story:null,params:{}},
 r180:         {tier:'B',scene:'yard',place:'調車場',story:null,params:{}},
 dhl100:       {tier:'B',scene:'yard',place:'調車場・轉轍區',story:null,params:{}},
};

// 研究過但還沒配車的候選場景（2026-09-12）：
//  新高雄車站「雲朵天棚」（2024-12-28 啟用，2700 片白色橢圓鋁板、79 根樹狀分枝柱）——
//  辨識度極高又好用低面數做，但現有對照裡沒有車空著。要用得先挪一款（例如把某款
//  區間車從 seaside-platform 移過來），屬於配置調整，尚待定案。
//  參考照片與幾何筆記：~/Documents/軌島封存/車站參考照片-20260912/（不進 repo）

// 已做好的場景各跑哪個系統的車（train-garage-catalog.js 的 system）、場景的地名（給 UI 的 label 與 aria-label）。
// 台鐵的場景所有台鐵車都能進，阿里山進所有林鐵車；預設車庫田園小站不在這裡，每款車都能跑。
// cars：同一系統分成兩座的再列車款，只跑列出的那幾款（台北捷運的高運量進劍潭、文湖線進動物園；新北捷運的三鶯線、環狀線進陶瓷老街，輕軌進漁人碼頭）。
// 要跟 train-garage.js 的 BUILT_SCENES 與 rail-3d/garage-diorama.js 的 SCENES 一致。
window.RailGarageSceneRules = {
 'south-coast': {system:'台鐵',place:'南迴線・南迴海岸'},
 alishan:       {system:'阿里山林鐵',place:'阿里山林鐵・之字形'},
 viaduct:       {system:'台鐵',place:'高架車站・站前街'},
 shifen:        {system:'台鐵',place:'平溪線・十分老街'},
 duoliang:      {system:'台鐵',place:'南迴線・多良車站'},
 crossing:      {system:'台鐵',place:'街角平交道'},
 guanghua:      {system:'台鐵',place:'台南・光華街'},
 'taipei-metro':   {system:'台北捷運',place:'淡水信義線・劍潭站',cars:['c301','c321','c341','c371','c381']},
 wenhu:            {system:'台北捷運',place:'文湖線・動物園站',cars:['wenhu','val256']},
 'airport-mrt':    {system:'桃園捷運',place:'機場捷運・山鼻站'},
 'ntpc-metro':     {system:'新北捷運',place:'三鶯線・陶瓷老街站',cars:['y100','sanying']},
 'ntpc-lrt':       {system:'新北捷運',place:'淡海輕軌・淡水漁人碼頭站',cars:['danhai','ankeng']},
 'taichung-metro': {system:'台中捷運',place:'台中捷運綠線・文心森林公園站'},
 'kaohsiung-metro':{system:'高雄捷運',place:'高雄捷運・美麗島站'},
 'kaohsiung-lrt':  {system:'高雄輕軌',place:'高雄輕軌・駁二大義站'},
 thsr:             {system:'台灣高鐵',place:'台灣高鐵・新竹站'},
 hsinchu:       {system:'台鐵',place:'縱貫線・新竹車站'},
 tainan:        {system:'台鐵',place:'縱貫線・台南車站'},
 'taichung-old': {system:'台鐵',place:'縱貫線・台中舊站'},
 chiayi:        {system:'台鐵',place:'縱貫線・嘉義車站'},
 baoan:         {system:'台鐵',place:'縱貫線・保安車站'},
 jiji:          {system:'台鐵',place:'集集線・集集車站'},
 dongshan:      {system:'台鐵',place:'宜蘭線・冬山車站'},
 'kaohsiung-old': {system:'台鐵',place:'縱貫線・高雄車站'},
 haixian:       {system:'台鐵',place:'海線・大山車站'},
 shengxing:     {system:'台鐵',place:'舊山線・勝興車站'},
 'taipei-under': {system:'台鐵',place:'台北車站・地下月台'},
};
