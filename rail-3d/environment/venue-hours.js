// 常態開放或外觀點燈時段。索引 0 為週日。null 表示當日休館。
// 未公布固定時段（含依場次開館）的建物只保留低亮度外觀。
const hours = new Map();
const span = (start,end) => [start*60,end*60];
function daily(ids,start,end) { weekly(ids,[span(start,end)]); }
function weekly(ids,week) { for (const id of ids.split(' ')) hours.set(id,week); }
function exceptMonday(ids,start,end) {
  const s=span(start,end);
  weekly(ids,[s,null,s,s,s,s,s]);
}
function special(ids,start,end,overrides) {
  const week=Array(7).fill(span(start,end));
  for (const [d,h] of Object.entries(overrides)) week[d]=h && span(...h);
  weekly(ids,week);
}

// 國家級紀念建築、市政地標的整夜外牆投光，與室內辦公及參觀時間獨立。
daily('presidential-office presidential-annexes control-yuan cksmh-landmark-v1 cks-garden sunyatsen-landmark-v1 taipei-north-gate taichung-city-hall ntpc-city-hall taipei-city-hall keelung-guanyin yilan-county-hall hsinchu-prefecture taichung-prefecture',0,24);
daily('grand-hotel tamsui-lovers-tower grand-hyatt-taipei taoyuan-airport-t1 taoyuan-airport-t2 tpe-concourses tpe-concourse-b tpe-tower',0,24);

// https://www.taipei-101.com.tw/tw/lighting/schedule （塔身日落到 23 時）
daily('taipei101-landmark-v1',12,23);
// https://npac-ntch.org/visits 、https://www.npac-ntt.org/news/c-NRrzKIVyFwu
daily('national-theater national-concert-hall',11.5,21);
exceptMonday('taichung-opera',11.5,21);
// https://tpac.org.taipei/venue-color 、https://www.npac-weiwuying.org/
exceptMonday('taipei-pac',12,21);
daily('weiwuying',11,20);
// https://www.tfam.museum/Common/editor.aspx?ddlLang=zh-tw&id=230
special('tfam',9.5,17.5,{1:null,6:[9.5,20.5]});
// https://www.ntl.edu.tw/wSite/ct?ctNode=1711&mp=1&xItem=58536 （含自修室）
// https://www.ksml.edu.tw/sub/content/index.aspx?Parser=1,5,45 、https://tnda.tainan.gov.tw/civilbook/page.asp?page=157
exceptMonday('national-taiwan-library',8,21);
exceptMonday('kaohsiung-main-library',10,22);
special('tainan-public-library',8.5,21,{0:[8.5,17.5],1:null});
// https://www.tmc.taipei/faq/ （戶外照明最晚 22 時；入夜漸亮）
daily('taipei-music-center',17,22);
// https://www.hayashi.com.tw/ 、https://att4fun.com.tw/contact
daily('hayashi-department-store',11,21);
special('att4fun-xinyi',11,22,{5:[11,23],6:[11,23]});
// https://www.redhouse.taipei/newsCT.aspx?id=256
special('ximen-red-house red-house',11,21,{1:null,6:[11,22]});
// https://www.gondola.taipei/cp.aspx?n=BFE4B2ABA0D9FB61
special('maokong-gondola-zoo maokong-gondola-maokong maokong-gondola-zhinan maokong-gondola-zoo-south',9,21,{0:[9,22],1:null,6:[9,22]});
// https://www.fgsbmc.org.tw/tw/visit-info.aspx （大佛所在本館）
special('foguang-buddha',9,18,{2:null});
// https://www.mitsui-shopping-park.com.tw/mop/taichungport/tw/shop.html?id=8ff41e1a
special('taichung-star',11,21.5,{0:[10.5,21.5],6:[10.5,21.5]});
// https://www.lihpaoresort.com/LihpaolandApp/opentime/skydream
special('lihpao-sky-dream',14,20.5,{0:[14,21],5:[14,21],6:[14,21]});
// https://www.travel.taipei/file/35483/ 、https://www.dream-mall.com.tw/
daily('miramar-wheel',13,22);
special('dream-mall-wheel',11,22,{0:[10.5,22],5:[11,22.5],6:[10.5,22.5]});
special('tcap-wheel',9,17,{0:[9,18],1:null,6:[9,18]});
daily('taipei-zoo-halls',9,17);
exceptMonday('national-taiwan-museum railway-department',9.5,17);
exceptMonday('island-annex-mrt-xinbeitou',10,18);
// https://www.nstm.gov.tw/ 、https://khh.travel/zh-tw/attractions/detail/216/
exceptMonday('nstm-kaohsiung kaohsiung-history-museum',9,17);
// https://www.tsa.gov.tw/
daily('tsa-terminals',5,23);
// 交通部觀光署景點資料 https://data.gov.tw/dataset/7777
exceptMonday('chiayi-art-museum nmmst-main-hall miaoli-hakka-roundhouse',9,17);
daily('hinoki-village',10,18);
special('chiayi-tower',9,17,{0:[9,18],1:null,2:null,6:[9,19]});
special('changhua-roundhouse',13,16,{0:[10,16],1:null,6:[10,16]});
special('checheng-wood',9,17,{0:[9,18],6:[9,18]});
special('dounan-warehouses',10,18,{1:null,2:null});
// 臺北旅遊網，各廟管理單位的常態參訪時間
daily('longshan-temple',6,22);
daily('19850819000015',6,18);
daily('19980325000009',9,17);
daily('20210118000001',7,18);
// 文化部文化資產局古蹟資料（caseId、openUpTime）
// https://data.boch.gov.tw/opendata/v2/assetsCase/1.1.json
weekly('20000711000002',[null]); // 慈雲寺不開放參觀
special('20131225000001',9,17,{2:null,4:null,5:null,6:null});
daily('19850819000039',5,17.5);
daily('20060724000005',6,19);
daily('19850819000058',5.5,21.5);
exceptMonday('19831228000004',8.5,17);
daily('19851127000011',6.5,20);
daily('19851127000017 20051107000001 20201118000003',8,17);
daily('19960827000001 20120119000001',8,18);
daily('19851127000019',7,21);
daily('19851127000022',6.5,18);
daily('20040517000001',6,18.5);
daily('19850819000078',8,20);
daily('19851127000090',5,20);
daily('19851127000091',6,20);
daily('19850819000090',8,17.5); // 奎閣午休位於白天
daily('20180731000001',6,21);
daily('20190501000002',0,24);
daily('20201123000009',6,22);

// https://www.npm.gov.tw/Articles.aspx?l=1&sno=02007001 、https://www.chimeimuseum.tw/visit
exceptMonday('npm-main-hall',9,17);
special('chimei-museum',9.5,17.5,{3:null});
// https://www.lym.gov.tw/ch/audience-service/traffic/lym/ 、https://tam.gov.taipei/cp.aspx?n=D7A6936DE433333F
special('lanyang-museum',9,17,{3:null});
special('taipei-astronomical-museum',9,17,{1:null,6:[9,21]});
// https://www.tshs.ntpc.gov.tw/xmdoc/cont?xsmsid=0g245643771715011728 （每月第一個週一另行休館）
special('tamsui-fort-san-domingo',9.5,17,{0:[9.5,18],6:[9.5,18]});
// https://www.pier2.org/ 、https://khh.travel/zh-tw/attractions/detail/8/
special('pier2-art-center pier2-penglai-dayong',10,18,{0:[10,20],5:[10,20],6:[10,20]});
// https://www.kw2.com.tw/ （棧貳庫與大港倉共同營運時段）
special('kw2-warehouse dagang-warehouses',10,21,{5:[10,22],6:[10,22]});
// https://khh.travel/zh-tw/attractions/detail/128/ （含夜間售票處）
daily('dadong-arts-center',9,21);
// https://www.taisugar.com.tw/ 、https://www.kia.gov.tw/FACNSER.html
daily('qiaotou-sugar-refinery qiaotou-sugar',9,16.5);
daily('khh-terminals',4+20/60,24);
// https://www.breezecenter.com/zh_tw/stores/7636 、https://www.skm.com.tw/branch/1/1121
special('nanshan-plaza cathay-landmark',11,21.5,{4:[11,22],5:[11,22],6:[11,22]});
special('xinyi-skm',11,21.5,{5:[11,22],6:[11,22]});
// 觀光署資料中的全天候戶外地景，與廟內及展覽時間分開。
daily('baguashan-buddha',0,24);
daily('keelung-sign',12,24);

// https://klctb.klcg.gov.tw/cp.aspx?n=7492 、https://sites.google.com/ppdc.com.tw/estation/站內資訊-information
daily('keelung-tower',9,21);
daily('taipei-city-hall-bus',5,25);
// https://www.skm.com.tw/branch/2/1111 、https://www.lucys.com.tw/pages/big-city-遠東巨城購物中心
special('shinkong-landmark-v1 hsinchu-big-city',11,21.5,{5:[11,22],6:[11,22]});
// 太麻里鄉公所東麻鄉農觀字第1140019352號公告，自 2025-12-01 起。
// https://www.taimali.gov.tw/home/images/news/2025-12-05_786532.png
daily('duoliang-station',8,17);
// 文化部古蹟開放資料與各館舍公告。舊站房的展覽與相鄰現役車站分別計時。
// https://khh.travel/zh-tw/attractions/detail/1215/ 、https://tyrp.tycg.gov.tw/faq/
exceptMonday('takao-old takao-railway-museum',10,18);
exceptMonday('taoyuan-warehouse',10,16.5);
daily('taian-old',9,17);
special('shanjia-old',10,17,{0:null,6:null});
special('beimen-old',8,17,{0:null,6:null});
// https://chacha.tainan.gov.tw/ 、https://erjiebarn.darj.org.tw/p/blog-page_21.html
special('longtian-warehouses',9,17,{2:null});
special('erjie-granary',9,17,{3:null});

// https://www.arena.taipei/cp.aspx?n=7D1DD519E65F6A97&s=471785BF8F15AF22 、https://iplay.sports.gov.tw/GymInfo/Index/30570
daily('taipei-arena',9,22);
weekly('taipei-stadium',[[span(5,9),span(18,22)]]);
// https://tainanbiennial.org/venues/ 、https://romantichakka.hakka.gov.tw/zh-TW/attraction/Spot?a=928&id=1900
special('tainan-art-museum-2',10,18,{1:null,6:[10,21]});
daily('guanshan-old island-annex-tra-guanshan',9,18);
// https://hualien1913.nat.gov.tw/參觀注意事項/ （園區服務中心）
exceptMonday('hualien-creative-park',10,18);

// https://kpmc.com.tw/faq/ 、https://www.post.gov.tw/post/internet/I_location/post.jsp?ID=1302&prsb_no=000100-6
exceptMonday('kaohsiung-music-center',10,22);
special('taipei-post-office',8.5,21,{0:null,6:[9,12]});
// https://travel.taichung.gov.tw/zh-tw/Attractions/Intro/278 、https://khh.travel/file/1921/
daily('baojue-maitreya',9,17);
daily('lotus-pond-pagodas',8,18);
// https://www.twtainan.net/zh-tw/statics/aviation/ （一般服務時間）
daily('tnn-terminal',7,18);
// https://www.g9cip.com/
daily('chiayi-creative-park',10,18);

export const monthlyMondayClosures = new Map([
  [hours.get('tamsui-fort-san-domingo'),'first'],
  [hours.get('keelung-tower'),'last'],
]);
export const venueHours = hours;
