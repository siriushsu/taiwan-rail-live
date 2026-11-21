export const TW2_ITEMS = {
  // 道路線
  yline: "黃線修正：路口前截斷；單行道、圓環、轉向連接線不畫黃線",
  lane: "車道線：白色車道虛線、路面邊線",
  xing: "路口標線：停止線、枕木紋斑馬線、機車待轉區",
  walk: "人行道沿路畫；巷弄綠色標線型人行道；建物外擴那一圈白邊關掉或改水泥色",
  tone: "路面色調：陰影裡的柏油不要偏深藍",
  mtree: "林蔭大道：分隔島與路側補行道樹",
  pole: "路燈：白天看得到燈桿，晚上路面有光斑、光點在桿頂",
  sig: "路口號誌",
  moto: "路邊停的機車",
  // 建物線
  heli: "停機坪降量：約一成、褪色、縮小、不都在正中",
  stair: "樓梯間：有門、靠邊，透天也給小的",
  tank: "水塔移到樓梯間頂；不鏽鋼水塔材質",
  shed: "全覆式鐵皮棚（頂樓整層加蓋）",
  arcade: "騎樓真的凹進去",
  cage: "外凸鐵窗（老公寓、透天）",
  // 旁支（2026-11-20 晚）
  soil: "施工中的地：名字是公園的改回公園；其餘不再整片深褐，顏色跟著衛星影像走",
  lst: "龍山寺屋瓦與木作顏色",
  // 第 2 輪
  lshape: "龍山寺造型：弧形燕尾脊、簷角起翹、垂脊、正殿重簷、六角鐘鼓樓、前殿石牆",
  temple: "一般的廟：紅瓦為主、牆色加深、依大小分小祠／單殿／幾進的殿／合院，弧形燕尾脊",
  church: "教堂、清真寺、靜思堂不畫成中式廟頂",
  sfix: "地表修正表：逐處指定某塊地是什麼（艋舺公園＝鋪面廣場加樹）",
  pylon: "高壓電塔與電線（資料有、原本完全沒畫；每格 infra.json）",
  wind: "風力發電機（葉片會轉；每格 infra.json）",
  trow: "樹列與單株樹照地圖資料的真實位置種（行道樹、分隔島；樹列 24 公尺一棵，烘在 trees.bin）",
  otank: "油槽、水槽不畫成公寓：輪廓接近正圓的無名建物改畫成圓槽",
  bclass: "照資料的建物類別畫：溫室、車棚、機棚、筒倉、油槽不當成一般房子",
  // 第 4 輪
  gov: "政府與公共建物照來源資料的名字認：公所、戶政地政、法院、警察、消防不畫成透天或公寓（buildings.json 的 pub 欄位）",
  sport: "體育場館照名字與類別認：體育館、球館、運動中心、學校活動中心畫大跨度拱頂，風雨球場只有拱頂與柱子，體育場與看台畫成往後升高的斜看台（同一個欄位）",
  campus: "比較大的校園（2 公頃以上）裡被當成透天或公寓的建物改成校舍（同一個欄位）",
  ocs: "電氣化的台鐵、高鐵股道沿線畫電車線桿與架空線（只在近景；資料是圖磚 rails.json 早就有的 electrified 欄）",
  brg: "道路橋與高架：橋墩從整面牆改成 T 型墩（柱＋帽梁），側板分成護欄（淺）與梁身（深）兩段",
  parts: "來源資料有分件的建物（裙樓、塔樓各自的輪廓與樓層）照分件畫，不再整棟一個高度（烘圖磚時就換成分件，bake/parts.mjs）",
  // 第 5 輪
  btype: "橋型示意：查證過是吊橋、斜張橋、拱橋、桁架橋的橋，畫出塔與纜、拱肋與吊桿、桁架；主跨中間的橋墩拿掉（每格 bridges.json 的 bridges、clear；總表 bridges-index.json）",
  rbrg: "河上橋跟都市高架分開：站在水裡的橋墩改成圓柱墩＋帽梁＋承台，跨水那一段的梁身薄一點、顏色淺一點（同一份 bridges.json 的 wp、wr）",
  plat: "月台板：來源資料有月台輪廓、站房模型沒蓋到的，補一塊月台（含月台邊的黃線；每格 platforms.json、總表 platforms-index.json）",
  yard: "側線與調車場降一級畫：道碴帶窄一點、矮一點，顏色偏鏽（資料是圖磚 rails.json 早就有的 service 欄）",
  lrt: "輕軌架空線：淡海、安坑輕軌的股道畫架空線與線桿（高雄輕軌沒有架空線，不畫）"
};
export const TW2_ALL = Object.keys(TW2_ITEMS);
export const TW2_ADOPTED = TW2_ALL.filter((k) => k !== "mtree");
export function parseTw2(search = "") {
  const v = new URLSearchParams(search).get("tw2"), F = {};
  let on;
  if (v === "0") on = [];
  else if (!v) on = TW2_ADOPTED;
  else if (v === "1" || v === "all") on = TW2_ALL;
  else {
    const list = v.split(","), all = list.includes("all"), minus = list.filter((k) => k.startsWith("-")).map((k) => k.slice(1));
    on = minus.length || all ? (all ? TW2_ALL : TW2_ADOPTED).filter((k) => !minus.includes(k)) : list;
  }
  for (const k of TW2_ALL) F[k] = on.includes(k);
  F.any = TW2_ALL.some((k) => F[k]);
  F.key = F.any ? "-tw2" + TW2_ALL.filter((k) => F[k]).map((k) => k.slice(0, 2) + k.length).join("") : "";
  F.T = {};
  F.num = (name, dflt) => {
    const p = new URLSearchParams(search);
    return p.has("x2" + name) ? +p.get("x2" + name) : dflt;
  };
  return F;
}
export const TW2 = parseTw2(globalThis.__LANDSCAPE_HOST__ ? "?" + globalThis.__LANDSCAPE_HOST__.params : globalThis.location?.search || "");
