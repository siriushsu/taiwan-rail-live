// 車款 → 場景對照表。**手維護，不是產生檔**（對照 train-garage-catalog.js 是 import_garage_blender.py 整份覆寫的產生檔）。
// 設計書：docs/superpowers/specs/2026-09-09-車庫一車一景-design.md §3.4、2026-09-12-車庫場景複審與特色車站-design.md §4
//
// 🚧 草案（2026-09-12）：站點分派還沒經使用者裁示，也還沒有任何程式讀這個檔。
//    四個已完成的場景（south-coast／alishan／viaduct／shifen）只活在 prototypes/garage-*/，車庫本體尚未接線。
//
// 欄位：
//   tier   'A' 手工場景（一眼認得出是哪裡）｜'B' 原型＋參數
//   scene  場景模組名，對應 rail-3d/garage-scenes/<scene>.js
//   place  這個場景是哪裡（給 UI 的 label 與 aria-label）
//   story  data/tra_special_trains.json 的 id；沒有故事的留 null
//   params 傳進 createScene(params) 的參數
//
// 已實作：south-coast、alishan、viaduct、shifen。其餘為待做。
window.RailGarageScenes = {

 // ───────── Tier A：手工場景（19 座，4 座已完成） ─────────

 // 南迴海岸・多良（已完成）
 blue:        {tier:'A',scene:'south-coast',place:'南迴線・多良海岸',story:'blue-train',params:{}},
 bluecoach:   {tier:'A',scene:'south-coast',place:'南迴線・多良海岸',story:'blue-train',params:{}},

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

 // ── 以下待做 ──

 // 冬山車站（宜蘭線）：連續白色鋼拱＋半透明膜材屋頂，東部幹線第一個高架車站。
 // 　台鐵沒有「東山車站」（查過臺灣鐵路車站列表全文），使用者說的東山即此站。
 temu2000:    {tier:'A',scene:'dongshan',place:'冬山車站',story:'puyuma',params:{}},
 // 清水斷崖：北迴線隧道口與海崖
 temu1000:    {tier:'A',scene:'qingshui',place:'北迴線・清水斷崖',story:'taroko',params:{}},
 // 台南車站：1936 現代主義古蹟站房
 e1000:       {tier:'A',scene:'tainan',place:'台南車站',story:'pp',params:{}},
 ppcoach:     {tier:'A',scene:'tainan',place:'台南車站',story:'pp',params:{}},
 // 新竹車站：1913 巴洛克古蹟站房
 e200:        {tier:'A',scene:'hsinchu',place:'新竹車站',story:'chukuang',params:{}},
 juguang:     {tier:'A',scene:'hsinchu',place:'新竹車站',story:'chukuang',params:{}},
 // 士林站：淡水信義線高架段，宮殿式（歇山式）黃琉璃瓦翹脊屋頂＋朱紅橫帶。
 // 　不是弧形頂棚——那條線上以弧形出名的是隔壁劍潭站（龍舟造型）；要換站再說。
 c301:        {tier:'A',scene:'shilin',place:'捷運士林站',story:null,params:{}},
 // 美麗島站：光之穹頂
 kaohsiung:   {tier:'A',scene:'formosa',place:'捷運美麗島站',story:null,params:{}},
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
 // 高鐵新竹站：姚仁喜設計，單一平行四邊形彎曲屋頂（風帆），屋頂高 26 公尺
 '700t':      {tier:'A',scene:'thsr-hsinchu',place:'高鐵新竹站',story:null,params:{}},
 // 淡海輕軌：街道與行武者塗裝
 danhai:      {tier:'A',scene:'tamsui-lrt',place:'淡海輕軌・街道',story:null,params:{}},

 // ───────── Tier B：原型＋參數（30 款，8 個原型） ─────────

 // 高架捷運站
 c371:         {tier:'B',scene:'metro-elevated',place:'高架捷運站',story:null,params:{livery:'trtc'}},
 c381:         {tier:'B',scene:'metro-elevated',place:'高架捷運站',story:null,params:{livery:'trtc'}},
 wenhu:        {tier:'B',scene:'metro-elevated',place:'文湖線・高架彎道',story:null,params:{gauge:'rubber'}},
 val256:       {tier:'B',scene:'metro-elevated',place:'文湖線・高架彎道',story:null,params:{gauge:'rubber'}},
 airportlocal: {tier:'B',scene:'metro-elevated',place:'機場線・高架站',story:null,params:{livery:'tymc'}},
 airportexpress:{tier:'B',scene:'metro-elevated',place:'機場線・高架站',story:null,params:{livery:'tymc'}},
 y100:         {tier:'B',scene:'metro-elevated',place:'環狀線・高架站',story:null,params:{livery:'ntmc'}},
 sanying:      {tier:'B',scene:'metro-elevated',place:'三鶯線・高架站',story:null,params:{livery:'ntmc'}},
 taichung:     {tier:'B',scene:'metro-elevated',place:'台中捷運・高架站',story:null,params:{livery:'tmrt'}},

 // 地下站
 c321:         {tier:'B',scene:'metro-underground',place:'地下捷運站',story:null,params:{}},
 c341:         {tier:'B',scene:'metro-underground',place:'地下捷運站',story:null,params:{}},

 // 輕軌街道
 ankeng:       {tier:'B',scene:'lrt-street',place:'輕軌・街道站',story:null,params:{livery:'ankeng'}},
 caf:          {tier:'B',scene:'lrt-street',place:'輕軌・海邊段',story:null,params:{scenery:'harbour'}},
 citadis:      {tier:'B',scene:'lrt-street',place:'輕軌・市區段',story:null,params:{scenery:'city'}},

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
//  區間車從 seaside-platform 移過來），屬於配置調整，等裁示。
//  參考照片與幾何筆記：~/Documents/軌島封存/車站參考照片-20260912/（不進 repo）
