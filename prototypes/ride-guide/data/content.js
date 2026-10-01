/* 乘車導覽原型的地方內容。
 * 規則：每一則事實都要有來源（sources 的 id）；查不到的寫「待查核／待補」，不自己填。
 * 查核日期 checkedOn＝這批內容最後一次逐則打開來源核對的日期。
 * 英文為展示用翻譯，忠於中文來源內容。 */
window.RIDE_CONTENT = {
  checkedOn: '2026-10-01',

  lines: {
    pingxi: { name: { zh: '平溪線', en: 'Pingxi Line' }, desc: { zh: '八斗子—瑞芳—三貂嶺—菁桐直通車（深澳線、宜蘭線、平溪線）', en: 'Through trains Badouzi – Ruifang – Sandiaoling – Jingtong (Shen’ao, Yilan and Pingxi lines)' } },
    huadong: { name: { zh: '臺東線（花東縱谷）', en: 'Taitung Line (East Rift Valley)' }, desc: { zh: '花蓮—玉里，沿花東縱谷南下', en: 'Hualien – Yuli, south through the East Rift Valley' } },
    haixian: { name: { zh: '海線', en: 'Coast Line' }, desc: { zh: '竹南—彰化，沿台灣海峽的西部幹線海線', en: 'Zhunan – Changhua, the western main line along the Taiwan Strait' } },
  },

  // 站名（中英）由 data/routes.js 提供，來源是 repo 的 i18n/stations.json

  sources: {
    'klzz-badouzi': { name: { zh: '基隆市中正區公所：八斗子車站', en: 'Zhongzheng District Office, Keelung: Badouzi Station (zh)' }, url: 'https://www.klzz.klcg.gov.tw/tw/klzz/973-99589.html' },
    'cna-2016-badouzi': { name: { zh: '中央社 2016-12-28：八斗子站啟用', en: 'CNA, 2016-12-28: Badouzi Station opens (zh)' }, url: 'https://www.cna.com.tw/news/ahel/201612285006.aspx' },
    'cna-2025-shenao': { name: { zh: '中央社 2025-02-25：深澳線全線恢復行駛', en: 'CNA, 2025-02-25: Shen’ao Line fully reopens (zh)' }, url: 'https://www.cna.com.tw/news/ahel/202502250204.aspx' },
    'tcmb-power-plant': { name: { zh: '國家文化記憶庫：北部火力發電廠（基隆市文化局）', en: 'Taiwan Cultural Memory Bank: Northern Thermal Power Plant (zh)' }, url: 'https://tcmb.culture.tw/zh-tw/detail?indexCode=Culture_Place&id=179122' },
    'nmmst-about': { name: { zh: '國立海洋科技博物館：館史', en: 'National Museum of Marine Science & Technology: history (zh)' }, url: 'https://mscloud.nmmst.gov.tw/chhtml/opencontenttab.aspx?tdid=177' },
    'taiwannet-shenao': { name: { zh: '交通部觀光署：深澳線', en: 'Tourism Administration: Shen’ao Line (zh)' }, url: 'https://www.taiwan.net.tw/m1.aspx?sNo=0027028' },
    'taiwannet-nmmst': { name: { zh: '交通部觀光署：國立海洋科技博物館', en: 'Tourism Administration: NMMST (zh)' }, url: 'https://www.taiwan.net.tw/m1.aspx?sNo=0001105&id=A12-00221' },
    'ruifang-office': { name: { zh: '新北市瑞芳區公所：地名由來', en: 'Ruifang District Office: origin of the name (zh)' }, url: 'https://www.ruifang.ntpc.gov.tw/home.jsp?id=e32fc9bbd6f35420' },
    'tcmb-gold': { name: { zh: '國家文化記憶庫：七堵鐵橋與砂金（基隆市文化局）', en: 'Taiwan Cultural Memory Bank: gold found at the Qidu bridge (zh)' }, url: 'https://tcmb.culture.tw/zh-tw/detail?id=302185&indexCode=Culture_Object' },
    'ntpc-houtong-stn': { name: { zh: '新北市觀光旅遊網：猴硐車站', en: 'New Taipei Travel: Houtong Station (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/112146' },
    'ntpc-ruisan': { name: { zh: '新北市觀光旅遊網：瑞三鑛業整煤廠', en: 'New Taipei Travel: Ruisan coal preparation plant (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/110750' },
    'tcmb-ruisan': { name: { zh: '國家文化記憶庫：瑞三鑛業整煤廠', en: 'Taiwan Cultural Memory Bank: Ruisan coal plant (zh)' }, url: 'https://tcmb.culture.tw/zh-tw/detail?indexCode=Culture_Place&id=313163' },
    'ntpc-catvillage': { name: { zh: '新北市觀光旅遊網：猴硐貓村', en: 'New Taipei Travel: Houtong Cat Village (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/403148' },
    'ntpc-sandiaoling': { name: { zh: '新北市觀光旅遊網：三貂嶺車站', en: 'New Taipei Travel: Sandiaoling Station (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/110702' },
    'ntpc-lingjiao-stn': { name: { zh: '新北市觀光旅遊網：嶺腳車站', en: 'New Taipei Travel: Lingjiao Station (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/110703' },
    'ntpc-tunnel': { name: { zh: '新北市施政成果網：三貂嶺生態友善隧道', en: 'New Taipei City Government: Sandiaoling eco-friendly tunnel (zh)' }, url: 'https://wedid.ntpc.gov.tw/Governance/Detail/ajRxlaQmlXAg' },
    'ntpc-dahua-stn': { name: { zh: '新北市觀光旅遊網：大華車站', en: 'New Taipei Travel: Dahua Station (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/110701' },
    'ntpc-dahua-potholes': { name: { zh: '新北市觀光旅遊網：大華壺穴', en: 'New Taipei Travel: Dahua potholes (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/110053' },
    'ntpc-wanggu-stn': { name: { zh: '新北市觀光旅遊網：望古車站', en: 'New Taipei Travel: Wanggu Station (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/110700' },
    'ntpc-wanggu-falls': { name: { zh: '新北市觀光旅遊網：望古瀑布', en: 'New Taipei Travel: Wanggu Falls (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/302751' },
    'taiwannet-pingxi-line': { name: { zh: '交通部觀光署：平溪線', en: 'Tourism Administration: Pingxi Line (zh)' }, url: 'https://www.taiwan.net.tw/m1.aspx?sNo=0027026' },
    'tra-schedule': { name: { zh: '臺鐵開放資料：逐日時刻表', en: 'TRA open data: daily timetable (zh)' }, url: 'https://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/railway_schedule/JSON/list' },

    // ── 十分 ──
    'ntpc-shifen-stn': { name: { zh: '新北市觀光旅遊網：十分車站', en: 'New Taipei Travel: Shifen Station (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/110699' },
    'ntpc-shifen-oldst': { name: { zh: '新北市觀光旅遊網：十分老街', en: 'New Taipei Travel: Shifen Old Street (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/110037' },
    'ntpc-shifen-area': { name: { zh: '新北市觀光旅遊網：十分風景特定區', en: 'New Taipei Travel: Shifen Scenic Area (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/111423' },
    'ntpc-shifen-falls': { name: { zh: '新北市觀光旅遊網：十分瀑布公園', en: 'New Taipei Travel: Shifen Waterfall Park (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/109612' },
    'ntpc-jingan': { name: { zh: '新北市觀光旅遊網：靜安吊橋', en: 'New Taipei Travel: Jingan Suspension Bridge (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/110039' },
    'ntpc-tour39': { name: { zh: '新北市觀光旅遊網：十分推薦行程', en: 'New Taipei Travel: Shifen suggested itinerary (zh)' }, url: 'https://newtaipei.travel/zh-tw/tour/39' },
    'ntpc-news-2013': { name: { zh: '新北市觀光旅遊網：十分新聞稿（112.5.30）', en: 'New Taipei Travel: Shifen press release, 2023-05-30 (zh)' }, url: 'https://newtaipei.travel/zh-tw/news/detail/2013' },
    'pingxi-office-jingan': { name: { zh: '新北市平溪區公所：靜安吊橋', en: 'Pingxi District Office: Jingan Bridge (zh)' }, url: 'https://www.pingxi.ntpc.gov.tw/home.jsp?id=ce44096e0f12fec9&act=be4f48068b2b0031&dataserno=824ed35dab265753bb8e4ddcaea6304b' },
    'tra-tip-pingxi-line': { name: { zh: '臺鐵觀光資訊：平溪線', en: 'TRA tourism info: Pingxi Line (zh)' }, url: 'https://tip.railway.gov.tw/tra-tip-web/tip/tip00H/tipH21/view?tripNo=b1ff1ce6049c47378b9be785b0d93b0b' },
    'taiwantrip-795-shifen': { name: { zh: '台灣好行：795 木柵平溪線（往十分）', en: 'Taiwan Tourist Shuttle: 795 Muzha–Pingxi (to Shifen)' }, url: 'https://www.taiwantrip.com.tw/Frontend/Route/Select_p?RouteID=R0020' },
    'taiwantrip-s11333': { name: { zh: '台灣好行：十分老街（A9 十分寮站）', en: 'Taiwan Tourist Shuttle: Shifen Old Street stop (zh)' }, url: 'https://www.taiwantrip.com.tw/Frontend/Attractions/TripSpecialp/S11333' },
    'taiwantrip-s11334': { name: { zh: '台灣好行：十分瀑布（A10 十分遊客中心站）', en: 'Taiwan Tourist Shuttle: Shifen Waterfall stop (zh)' }, url: 'https://www.taiwantrip.com.tw/Frontend/Attractions/TripSpecialp/S11334' },
    'ebus-846': { name: { zh: '臺北市公車動態：846 瑞芳—平溪', en: 'Taipei e-bus: route 846 Ruifang–Pingxi (zh)' }, url: 'https://ebus.gov.taipei/EBus/VsSimpleMap?routeid=0400084600&gb=0' },
    'tra-stn-shifen': { name: { zh: '臺鐵：十分站資訊', en: 'TRA: Shifen Station info (zh)' }, url: 'https://www.railway.gov.tw/tra-tip-web/tip/tip00H/tipH41/viewStaInfo/7332' },

    // ── 平溪 ──
    'ntpc-pingxi-stn': { name: { zh: '新北市觀光旅遊網：平溪車站', en: 'New Taipei Travel: Pingxi Station (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/110038' },
    'ntpc-pingxi-oldst': { name: { zh: '新北市觀光旅遊網：平溪老街', en: 'New Taipei Travel: Pingxi Old Street (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/110030' },
    'nchdb-lantern': { name: { zh: '文化部文化資產局：平溪天燈節（民俗）', en: 'Bureau of Cultural Heritage: Pingxi Sky Lantern Festival (zh)' }, url: 'https://nchdb.boch.gov.tw/assets/advanceSearch/folklore/20080528000001' },
    'ntpc-tour38': { name: { zh: '新北市觀光旅遊網：平溪推薦行程', en: 'New Taipei Travel: Pingxi suggested itinerary (zh)' }, url: 'https://newtaipei.travel/zh-tw/tour/38' },
    'pingxi-office-mailbox': { name: { zh: '新北市平溪區公所：平溪老郵筒', en: 'Pingxi District Office: the old postbox (zh)' }, url: 'https://www.pingxi.ntpc.gov.tw/home.jsp?id=ce44096e0f12fec9&act=be4f48068b2b0031&dataserno=824ed35dab2657539de21d681fac0e95' },
    'osm-pingxi-po': { name: { zh: 'OpenStreetMap：平溪郵局座標', en: 'OpenStreetMap: Pingxi post office' }, url: 'https://www.openstreetmap.org/way/281261985' },
    'ntpc-xiaozi': { name: { zh: '新北市觀光旅遊網：平溪孝子山', en: 'New Taipei Travel: Xiaozi Mountain (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/110036' },
    'ntpc-news-1480': { name: { zh: '新北市觀光旅遊網：步道封閉公告（115.9.30 更新）', en: 'New Taipei Travel: trail closure notice, updated 2026-09-30 (zh)' }, url: 'https://newtaipei.travel/zh-tw/news/detail/1480' },
    'taiwantrip-795-pingxi': { name: { zh: '台灣好行：795 木柵平溪線（往平溪）', en: 'Taiwan Tourist Shuttle: 795 Muzha–Pingxi (to Pingxi)' }, url: 'https://www.taiwantrip.com.tw/Frontend/Route/Select_p?RouteID=R0036' },
    'taiwantrip-s11335': { name: { zh: '台灣好行：平溪老街（A6 平溪老街站）', en: 'Taiwan Tourist Shuttle: Pingxi Old Street stop (zh)' }, url: 'https://www.taiwantrip.com.tw/Frontend/Attractions/TripSpecialp/S11335' },
    'tra-stn-pingxi': { name: { zh: '臺鐵：平溪站資訊', en: 'TRA: Pingxi Station info (zh)' }, url: 'https://www.railway.gov.tw/tra-tip-web/tip/tip00H/tipH41/viewStaInfo/7335' },
    'ntpc-lantern-2026': { name: { zh: '新北市觀光旅遊網：2026 平溪天燈節', en: 'New Taipei Travel: 2026 Pingxi Sky Lantern Festival (zh)' }, url: 'https://newtaipei.travel/zh-tw/calendar/detail/3691' },
    'ntpc-lantern-law': { name: { zh: '新北市法規：新北市天燈施放管理辦法', en: 'New Taipei City regulations on releasing sky lanterns (zh)' }, url: 'https://web.law.ntpc.gov.tw/Scripts/FLAWDAT0202.aspx?fcode=C0260006' },

    // ── 菁桐 ──
    'ntpc-jingtong-stn': { name: { zh: '新北市觀光旅遊網：菁桐車站', en: 'New Taipei Travel: Jingtong Station (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/110042' },
    'nchdb-jingtong-stn': { name: { zh: '文化部文化資產局：菁桐車站（直轄市定古蹟）', en: 'Bureau of Cultural Heritage: Jingtong Station, municipal monument (zh)' }, url: 'https://nchdb.boch.gov.tw/assets/advanceSearch/monument/20030501000001' },
    'museum-jingtong': { name: { zh: '新北市立博物館：菁桐礦業生活館', en: 'New Taipei City museums: Jingtong Mining Industry Life Pavilion (zh)' }, url: 'https://www.museum.ntpc.gov.tw/xmdoc/cont?xsmsid=0G275735901206394658&sid=0G297833792570223136' },
    'nchdb-guesthouse': { name: { zh: '文化部文化資產局：臺陽礦業公司平溪招待所（直轄市定古蹟）', en: 'Bureau of Cultural Heritage: Taiyang Mining Pingxi Guest House (zh)' }, url: 'https://nchdb.boch.gov.tw/assets/advanceSearch/monument/20030925000001' },
    'pingxi-office-shaft': { name: { zh: '新北市平溪區公所：石底大斜坑', en: 'Pingxi District Office: Shidi Inclined Shaft (zh)' }, url: 'https://www.pingxi.ntpc.gov.tw/home.jsp?id=ce44096e0f12fec9&act=be4f48068b2b0031&dataserno=824ed35dab2657536a537ec122554dd4' },
    'ntpc-coal-park': { name: { zh: '新北市觀光旅遊網：菁桐煤礦紀念公園', en: 'New Taipei Travel: Jingtong Coal Memorial Park (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/110926' },
    'ntpc-mining-hall': { name: { zh: '新北市觀光旅遊網：菁桐礦業生活館', en: 'New Taipei Travel: Jingtong Mining Industry Life Pavilion (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/110044' },
    'ntpc-jingtong-oldst': { name: { zh: '新北市觀光旅遊網：菁桐老街', en: 'New Taipei Travel: Jingtong Old Street (zh)' }, url: 'https://newtaipei.travel/zh-tw/attractions/detail/110043' },
    'taiwantrip-s11302': { name: { zh: '台灣好行：菁桐（A5 菁桐坑站）', en: 'Taiwan Tourist Shuttle: Jingtongkeng stop (zh)' }, url: 'https://www.taiwantrip.com.tw/Frontend/Attractions/TripSpecialp/S11302' },
    'tra-stn-jingtong': { name: { zh: '臺鐵：菁桐站資訊', en: 'TRA: Jingtong Station info (zh)' }, url: 'https://www.railway.gov.tw/tra-tip-web/tip/tip00H/tipH41/viewStaInfo/7336' },
  },

  // 照片：全部來自 Wikimedia Commons，授權逐張以 Commons API 核對（img/CREDITS.json 為同一份紀錄）
  photos: {
    'shifen-hero': { file: 'img/shifen-hero.jpg', author: 'AMN47', license: 'CC BY 3.0', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/', sourceUrl: 'https://commons.wikimedia.org/wiki/File:TRA_DRC1027_on_Shifen_Old_Street_20101024.jpg',
      caption: { zh: '平溪線列車行經十分老街（2010）', en: 'A Pingxi Line train in Shifen Old Street (2010)' }, alt: { zh: '黃色柴油客車沿著十分老街店家門前的鐵軌停靠，上方掛著天燈造型燈籠', en: 'A yellow diesel railcar on the track running between shopfronts on Shifen Old Street, with lantern-shaped lights overhead' }, modified: { zh: '已縮圖', en: 'resized' } },
    'shifen-falls': { file: 'img/shifen-falls.jpg', author: 'lumoplank', license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Shifen_-_Shifen4812.jpg',
      caption: { zh: '十分瀑布', en: 'Shifen Waterfall' }, alt: { zh: '從高處看寬闊的簾幕式十分瀑布與下方的基隆河', en: 'The wide curtain of Shifen Waterfall and the Keelung River seen from above' }, modified: { zh: '已縮圖', en: 'resized' } },
    'pingxi-hero': { file: 'img/pingxi-hero.jpg', author: 'Solomon203', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', sourceUrl: 'https://commons.wikimedia.org/wiki/File:TRA_Pingxi_Station_outside_stairs_20190914a.jpg',
      caption: { zh: '平溪車站與站外階梯（2019）', en: 'Pingxi Station and its hillside stairway (2019)' }, alt: { zh: '山坡上的平溪車站與通往站房的階梯', en: 'Pingxi Station on the hillside with the stairway up to it' }, modified: { zh: '已縮圖', en: 'resized' } },
    'jingtong-hero': { file: 'img/jingtong-hero.jpg', author: 'MiNe', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/', sourceUrl: 'https://commons.wikimedia.org/wiki/File:TRA_Jingtong_Station_20121221.jpg',
      caption: { zh: '菁桐車站木造站房（2012）', en: 'Jingtong Station’s wooden building (2012)' }, alt: { zh: '日式木造的菁桐車站站房正面', en: 'The front of the Japanese-style wooden Jingtong Station building' }, modified: { zh: '已縮圖', en: 'resized' } },
    houtong: { file: 'img/houtong.jpg', author: '阿道', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Coal_Preparation_Plant_of_Ruisan_Coal_Mine_01_20260427.jpg',
      caption: { zh: '猴硐瑞三鑛業整煤廠（2026）', en: 'Ruisan coal preparation plant, Houtong (2026)' }, alt: { zh: '修復後的瑞三鑛業整煤廠建築', en: 'The restored Ruisan coal preparation plant buildings' }, modified: { zh: '已縮圖', en: 'resized' } },
    sandiaoling: { file: 'img/sandiaoling.jpg', author: 'Ken Marshall', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Side_view_of_the_Third_Keelung_River_Bridge_on_12_March_2017.jpg',
      caption: { zh: '三貂嶺：第三基隆河橋與隧道口（2017）', en: 'Sandiaoling: the Third Keelung River Bridge and tunnel portal (2017)' }, alt: { zh: '跨越基隆河的鐵橋與山壁上的隧道口', en: 'A railway bridge over the Keelung River leading to a tunnel portal in the hillside' }, modified: { zh: '已縮圖', en: 'resized' } },
    train: { file: 'img/train.jpg', author: 'Takeshi Aida', license: 'CC BY-SA 2.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Taiwan_DR1000,_Pingxi,_Pingxi_Line_(20181225b)_(53566149437).jpg',
      caption: { zh: '平溪線 DR1000 柴油客車（2018）', en: 'A Pingxi Line DR1000 diesel railcar (2018)' }, alt: { zh: '柴油客車行駛在河上的鐵橋，旁邊有一座人行吊橋', en: 'A diesel railcar on a river bridge next to a pedestrian suspension bridge' }, modified: { zh: '已縮圖', en: 'resized' } },
  },

  stations: {
    /* ═════════ 十分 ═════════ */
    shifen: {
      railisland: { zh: 'https://railisland.tw/stations/shifen/', en: 'https://railisland.tw/en/stations/shifen/' },
      hero: 'shifen-hero',
      tagline: { zh: '火車從老街中間開過，台灣最寬的簾幕式瀑布就在附近', en: 'Trains down the old street, and Taiwan’s widest curtain waterfall nearby' },
      themes: [{ icon: 'train', label: { zh: '火車門前過', en: 'Trains at the door' } }, { icon: 'water', label: { zh: '瀑布', en: 'Waterfall' } }, { icon: 'bridge', label: { zh: '運煤吊橋', en: 'Coal-era bridge' } }],
      stay: { zh: '2–3 小時', en: '2–3 hours' },
      highlights: [
        { id: 'oldst', icon: 'train', lat: 25.04269, lon: 121.77667,
          name: { zh: '十分老街', en: 'Shifen Old Street' },
          teaser: { zh: '火車不時從街道中央緩緩駛過。', en: 'Trains roll slowly down the middle of the street.' },
          desc: { zh: ['火車不時從十分老街中央緩緩駛過，形成「火車門前過」的景象。老街旁的十分廣場是每年平溪天燈節的主場之一。', '老街中間就是行車中的鐵軌，請遵照交通警示標示通行，不要隨意跨越鐵軌。'], en: ['Trains roll slowly down the middle of Shifen Old Street, right past people’s doors. Shifen Square beside it is one of the main venues of the annual Pingxi Sky Lantern Festival.', 'Live tracks run down the middle of the street. Follow the warning signs and do not cross the tracks at random.'] },
          src: ['ntpc-shifen-oldst'] },
        { id: 'falls', icon: 'water', photo: 'shifen-falls', lat: 25.04897, lon: 121.78746,
          name: { zh: '十分瀑布公園', en: 'Shifen Waterfall Park' },
          teaser: { zh: '高 20 公尺、寬 40 公尺，台灣最寬的簾幕式瀑布。', en: '20 m high and 40 m wide, Taiwan’s widest curtain waterfall.' },
          desc: { zh: ['十分瀑布高 20 公尺、寬 40 公尺，是台灣最寬的簾幕式瀑布，有「台灣尼加拉瀑布」之稱。'], en: ['Shifen Waterfall is 20 m high and 40 m wide, the widest curtain-type waterfall in Taiwan, sometimes called “Taiwan’s Niagara”.'] },
          travel: { text: { zh: '從老街步行約 20 分鐘', en: 'about 20 min on foot from the old street' }, src: ['ntpc-tour39'] },
          hours: { text: { zh: '10–5 月 09:00–17:00、6–9 月 09:00–18:00；免費', en: 'Oct–May 09:00–17:00, Jun–Sep 09:00–18:00; free' }, src: ['ntpc-shifen-falls'] },
          src: ['ntpc-shifen-area', 'ntpc-shifen-falls'] },
        { id: 'jingan', icon: 'bridge', lat: 25.04129, lon: 121.77616,
          name: { zh: '靜安吊橋', en: 'Jingan Suspension Bridge' },
          teaser: { zh: '1947 年為運煤而建，全長 128 公尺。', en: 'Built in 1947 to carry coal, 128 m long.' },
          desc: { zh: ['靜安吊橋全長 128 公尺，連接十分里與南山里，1947 年為了運送煤礦而建造。'], en: ['The Jingan Suspension Bridge is 128 m long and links Shifen and Nanshan villages. It was built in 1947 to carry coal.'] },
          src: ['ntpc-jingan', 'pingxi-office-jingan'] },
      ],
      intro: {
        text: {
          zh: '十分車站是平溪線的第一大站。車站周邊就是十分老街和靜安吊橋，火車不時從老街中央緩緩駛過；附近的十分瀑布高 20 公尺、寬 40 公尺，是台灣最寬的簾幕式瀑布。',
          en: 'Shifen is the largest station on the Pingxi Line. Shifen Old Street and the Jingan Suspension Bridge are right by the station, and trains roll slowly down the middle of the old street. Nearby Shifen Waterfall is 20 m high and 40 m wide, the widest curtain-type waterfall in Taiwan.',
        },
        src: ['ntpc-shifen-stn', 'ntpc-shifen-oldst', 'ntpc-shifen-area'],
      },
      stories: [
        {
          id: 'token', photo: 'train',
          title: { zh: '平溪線第一大站與銅製路牌', en: 'The line’s biggest station and its brass token' },
          teaser: { zh: '火車在這裡交換路牌；這條運煤鐵路 1992 年起規劃為觀光路線。', en: 'Trains swap the running token here, on a coal railway turned tourist line in 1992.' },
          body: {
            zh: [
              '新北市觀光旅遊網介紹，十分車站是臺鐵平溪線的第一大站；火車停靠時，司機員會在這裡交換古老的銅製路牌，也就是火車行駛的通行證。',
              '平溪線原本是臺陽株式會社的石底線，從三貂嶺到菁桐全長 12.9 公里，由礦業鉅子顏雲年為運煤而興建。1921 年通車，1929 年由臺灣總督府鐵道部收歸公營。',
              '1989 年平溪線曾被計畫廢除，1992 年改規劃為觀光路線。',
            ],
            en: [
              'According to New Taipei Travel, Shifen is the largest station on the Pingxi Line. When a train stops here, the driver exchanges an old brass token, the train’s permit to run on the next section.',
              'The line began as the Shidi Line of the Taiyang company: 12.9 km from Sandiaoling to Jingtong, built by mining magnate Yan Yun-nian to carry coal. It opened in 1921, and the colonial Railway Department took it into public ownership in 1929.',
              'In 1989 there were plans to close the line. In 1992 it was redesignated as a tourist line.',
            ],
          },
          src: ['ntpc-shifen-stn', 'nchdb-jingtong-stn', 'tra-tip-pingxi-line'],
        },
        {
          id: 'film',
          title: { zh: '火車門前過，與《戀戀風塵》', en: 'Trains at the front door, and “Dust in the Wind”' },
          teaser: { zh: '火車貼著民宅開過的這一段，是侯孝賢電影的取景地。', en: 'The stretch where trains pass inches from homes appears in a Hou Hsiao-hsien film.' },
          body: {
            zh: [
              '火車不時從十分老街中央緩緩駛過，形成「火車門前過」的景象。',
              '平溪線火車經過比鄰民宅的這一段，也是 1986 年侯孝賢導演《戀戀風塵》裡，青梅竹馬準備離鄉背井的取景地。',
              '老街旁的十分廣場，是每年平溪天燈節的主場之一。',
            ],
            en: [
              'Trains roll slowly down the middle of Shifen Old Street, passing right in front of people’s doors.',
              'This stretch, where Pingxi Line trains pass right beside houses, is where the childhood sweethearts prepare to leave home in Hou Hsiao-hsien’s 1986 film “Dust in the Wind”.',
              'Shifen Square, beside the old street, is one of the main venues of the annual Pingxi Sky Lantern Festival.',
            ],
          },
          src: ['ntpc-shifen-oldst', 'ntpc-news-2013'],
        },
        {
          id: 'jingan',
          title: { zh: '靜安吊橋：當年的運煤吊橋', en: 'Jingan Bridge: built to carry coal' },
          teaser: { zh: '128 公尺長的吊橋，1947 年為運煤而建。', en: 'A 128 m suspension bridge built in 1947 for coal.' },
          body: {
            zh: ['靜安吊橋全長 128 公尺，連接十分里與南山里，1947 年為了運送煤礦而建造。'],
            en: ['The Jingan Suspension Bridge is 128 m long and links Shifen and Nanshan villages. It was built in 1947 to carry coal.'],
          },
          src: ['ntpc-jingan', 'pingxi-office-jingan'],
        },
      ],
      walk: {
        name: { zh: '老街、吊橋到十分瀑布', en: 'Old street, suspension bridge, waterfall' },
        summary: { zh: '依新北市官方推薦行程的順序', en: 'In the order of New Taipei’s official itinerary' },
        loop: true,
        stops: [
          { name: { zh: '十分老街', en: 'Shifen Old Street' }, lat: 25.04269, lon: 121.77667,
            desc: { zh: '看火車從老街中央緩緩駛過。', en: 'Watch trains roll down the middle of the street.' }, src: ['ntpc-shifen-oldst'] },
          { name: { zh: '靜安吊橋', en: 'Jingan Suspension Bridge' }, lat: 25.04129, lon: 121.77616,
            desc: { zh: '1947 年的運煤吊橋，全長 128 公尺。', en: 'A 1947 coal-carrying bridge, 128 m long.' }, src: ['ntpc-jingan'] },
          { name: { zh: '十分瀑布公園', en: 'Shifen Waterfall Park' }, lat: 25.04897, lon: 121.78746,
            desc: { zh: '台灣最寬的簾幕式瀑布，免費入園；開放時間見「實用資訊」。', en: 'Taiwan’s widest curtain waterfall. Free entry; see “Good to know” for hours.' }, src: ['ntpc-shifen-falls'] },
        ],
        legs: [
          { min: null, note: { zh: '老街就在車站周邊', en: 'the old street is right by the station' }, src: ['ntpc-shifen-stn'] },
          { min: null },
          { min: null },
          { min: null },
        ],
        // 官方只給「老街到瀑布」一段的時間，橫跨兩段腿
        spans: [{ from: 1, to: 3, min: 20, src: ['ntpc-tour39'] }],
        coordSrc: ['ntpc-shifen-oldst', 'ntpc-jingan', 'ntpc-shifen-falls'],
        src: ['ntpc-tour39'],
      },
      access: [
        { label: { zh: '出口', en: 'Exit' }, tbd: true, text: { zh: '十分車站該走哪一側出口，官方資料沒有寫明，待查核。', en: 'Official sources do not say which side of Shifen Station to exit; not yet verified.' } },
        { label: { zh: '老街鐵軌', en: 'Tracks in the old street' }, text: { zh: '老街中間就是行車中的鐵軌。請遵照交通警示標示通行，不要隨意跨越鐵軌。', en: 'Live tracks run down the middle of the old street. Follow the warning signs and do not cross the tracks at random.' }, src: ['ntpc-shifen-oldst'] },
        { label: { zh: '步行', en: 'On foot' }, text: { zh: '十分老街、靜安吊橋都在車站周邊；從老街到十分瀑布步行約 20 分鐘。', en: 'Shifen Old Street and the Jingan Bridge are right by the station. From the old street to Shifen Waterfall is about 20 minutes on foot.' }, src: ['ntpc-shifen-stn', 'ntpc-tour39'] },
        { label: { zh: '台灣好行 795 木柵平溪線', en: 'Taiwan Tourist Shuttle 795 Muzha–Pingxi' },
          text: { zh: '往十分的班次來往捷運動物園站與十分遊客中心。在「十分寮」站（A9）下車，步行約 2 分鐘到十分老街；「十分遊客中心」站（A10）靠近十分瀑布。每段全票 15 元，全程 45 元；各班次都是無障礙低地板公車。',
            en: 'The “to Shifen” service runs between MRT Taipei Zoo Station and Shifen Visitor Center. Get off at Shifenliao (A9) for a 2-minute walk to Shifen Old Street; Shifen Visitor Center (A10) is near the waterfall. NT$15 per fare section, NT$45 end to end; all buses are low-floor and accessible.' },
          src: ['taiwantrip-795-shifen', 'taiwantrip-s11333', 'taiwantrip-s11334'] },
        { label: { zh: '新北市公車 846（瑞芳—平溪）', en: 'New Taipei bus 846 (Ruifang–Pingxi)' },
          text: { zh: '停靠十分瀑布、十分寮等站。瑞芳發車：平日 05:45、11:15、14:45、17:15；假日 09:15、15:15（2026-10-01 查核）。',
            en: 'Stops include Shifen Waterfall and Shifenliao. Departures from Ruifang: weekdays 05:45, 11:15, 14:45, 17:15; weekends 09:15, 15:15 (checked 2026-10-01).' },
          src: ['ebus-846'] },
      ],
      practical: [
        { label: { zh: '十分瀑布公園', en: 'Shifen Waterfall Park' },
          text: { zh: '10 月到 5 月 09:00–17:00（16:30 最後入園）；6 月到 9 月 09:00–18:00（17:30 最後入園）。免費入園。',
            en: 'October–May 09:00–17:00 (last entry 16:30); June–September 09:00–18:00 (last entry 17:30). Free entry.' }, src: ['ntpc-shifen-falls'] },
        { label: { zh: '十分遊客中心', en: 'Shifen Visitor Center' },
          text: { zh: '每日 08:00–18:00；農曆除夕 08:00–12:00。', en: 'Daily 08:00–18:00; Lunar New Year’s Eve 08:00–12:00.' }, src: ['ntpc-shifen-area'] },
        { label: { zh: '十分站營業時間', en: 'Shifen Station hours' },
          text: { zh: '05:10–23:00（臺鐵公告）。', en: '05:10–23:00 (TRA).' }, src: ['tra-stn-shifen'] },
      ],
    },

    /* ═════════ 平溪 ═════════ */
    pingxi: {
      railisland: { zh: 'https://railisland.tw/stations/pingxi/', en: null },
      hero: 'pingxi-hero',
      tagline: { zh: '放天燈的老街，火車從頭頂的鐵道橋轟隆駛過', en: 'A sky-lantern street with trains rumbling overhead' },
      themes: [{ icon: 'lantern', label: { zh: '天燈', en: 'Sky lanterns' } }, { icon: 'train', label: { zh: '鐵道橋', en: 'Railway bridge' } }, { icon: 'mountain', label: { zh: '山城老街', en: 'Hill town' } }],
      stay: { zh: '1–2 小時', en: '1–2 hours' },
      highlights: [
        { id: 'oldst', icon: 'train', lat: 25.02533, lon: 121.73882,
          name: { zh: '平溪老街', en: 'Pingxi Old Street' },
          teaser: { zh: '火車從老街上方高聳的鐵道橋駛過。', en: 'Trains cross a tall bridge above the street.' },
          desc: { zh: ['每當火車通過老街上方高聳的鐵道橋，「轟隆轟隆」的聲響就是平溪老街的獨特環境音。這裡也是電影《那些年，我們一起追的女孩》放天燈許願的場景。'], en: ['When a train crosses the tall bridge above the street, its rumble is the sound of Pingxi Old Street. It is also where the leads of “You Are the Apple of My Eye” release a sky lantern.'] },
          src: ['ntpc-pingxi-oldst', 'ntpc-tour38'] },
        { id: 'postbox', icon: 'pin', lat: 25.02595, lon: 121.73853,
          name: { zh: '平溪老郵筒', en: 'The old postbox' },
          teaser: { zh: '區公所記載：相傳從日治時期用到現在。', en: 'Said by the district office to date from Japanese rule.' },
          desc: { zh: ['平溪區公所介紹：平溪郵局前方的直立式郵筒相傳從日據時期使用至今，因為位在地勢較高的坡地而被保存下來。以上是區公所記載的相傳說法。'], en: ['The Pingxi District Office says the upright postbox in front of Pingxi Post Office is said to have been in use since Japanese rule and survived because it stands on higher ground. This is the office’s account of a local tradition.'] },
          src: ['pingxi-office-mailbox', 'osm-pingxi-po'] },
        { id: 'xiaozi', icon: 'mountain', lat: 25.02302, lon: 121.73945,
          name: { zh: '孝子山', en: 'Xiaozi Mountain' },
          teaser: { zh: '荒野探險型步道，不是輕鬆散步。', en: 'A wilderness trail, not a casual stroll.' },
          desc: { zh: ['官方分級為「荒野探險型」步道，路線全長約 2.76 公里。'], en: ['Officially graded a “wilderness adventure” trail, about 2.76 km long.'] },
          src: ['ntpc-xiaozi'] },
      ],
      intro: {
        text: {
          zh: '平溪車站早年稱為「石底驛」。出站沿著中華街往下走就是平溪老街，火車從老街上方高聳的鐵道橋轟隆駛過；這裡也是電影《那些年，我們一起追的女孩》男女主角放天燈許願的場景。',
          en: 'Pingxi Station was once called Shidi Station. Walk down Zhonghua Street from the station to Pingxi Old Street, where trains rumble across a tall railway bridge overhead. It is also where the leads of the film “You Are the Apple of My Eye” release a sky lantern and make a wish.',
        },
        src: ['ntpc-pingxi-stn', 'ntpc-pingxi-oldst'],
      },
      stories: [
        {
          id: 'lantern',
          title: { zh: '平溪天燈：耆老口述的由來', en: 'Pingxi sky lanterns: an oral tradition' },
          teaser: { zh: '天燈原是平安返家的信號——這是當地耆老代代相傳的說法。', en: 'Lanterns once signalled it was safe to come home, as local elders tell it.' },
          body: {
            zh: [
              '2008 年，當時的臺北縣公告登錄「平溪天燈節」為民俗文化資產。',
              '文化資產紀錄引述當地耆老口述：平溪天燈始自清道光年間。當時移居開墾的村民常受盜匪騷擾，需要避難山中；危機解除後，留守的壯丁就施放天燈為號，通知村人返家。後來時局漸定，放天燈成了平溪特有的民俗。',
              '這是口述傳統，不是文獻紀錄。1990 年代，平溪選定天燈作為地方的特色民俗活動。',
            ],
            en: [
              'In 2008 the then Taipei County registered the Pingxi Sky Lantern Festival as folk cultural heritage.',
              'The heritage record quotes local elders: Pingxi’s lanterns date back to the Daoguang reign of the Qing dynasty. Settlers here were often raided by bandits and had to shelter in the hills. When the danger passed, the men who had stayed behind released a lantern as a signal for everyone to come home. As times grew calmer, releasing lanterns became Pingxi’s own folk custom.',
              'This is oral tradition rather than documented history. In the 1990s Pingxi chose sky lanterns as its signature folk activity.',
            ],
          },
          src: ['nchdb-lantern', 'ntpc-pingxi-oldst'],
        },
        {
          id: 'shidi',
          title: { zh: '石底驛與三坑溪鐵橋', en: 'Shidi Station and the Sankeng Creek bridge' },
          teaser: { zh: '往菁桐的列車會過一座鐵橋，在老街上則看火車從頭頂駛過。', en: 'Trains to Jingtong cross a bridge you can watch from the street below.' },
          body: {
            zh: [
              '平溪車站早年稱為「石底驛」，雖是簡易車站，但歷史悠久、風景秀麗。',
              '列車往菁桐開去，會經過一座橫跨三坑溪的鐵橋，從車上可以俯瞰平溪與石底聚落；在老街上，則能看著火車從頭頂的鐵橋駛過，「轟隆轟隆」是平溪老街的獨特聲響。',
            ],
            en: [
              'Pingxi Station was once called Shidi Station. It is a simple station, but an old one in a beautiful setting.',
              'Heading on to Jingtong, the train crosses a bridge over Sankeng Creek with a view down onto the Pingxi and Shidi settlements. From the old street you can watch trains cross the bridge overhead; their rumble is the sound of Pingxi Old Street.',
            ],
          },
          src: ['ntpc-pingxi-stn', 'ntpc-tour38', 'ntpc-pingxi-oldst'],
        },
        {
          id: 'postbox',
          title: { zh: '老郵筒（區公所記載的相傳說法）', en: 'The old postbox (as the district office tells it)' },
          teaser: { zh: '相傳從日治時期用到現在，被稱為全台灣最老的郵筒。', en: 'Said to have been in use since Japanese rule.' },
          body: {
            zh: [
              '平溪區公所介紹：平溪郵局前方的直立式郵筒，相傳從日據時期使用至今，因為位在地勢較高的坡地而被保存下來，成為全台灣最老的郵筒。',
              '以上是區公所記載的相傳說法。',
            ],
            en: [
              'The Pingxi District Office says the upright postbox in front of Pingxi Post Office is said to have been in use since Japanese rule, survived because it stands on higher ground, and is the oldest postbox in Taiwan.',
              'This is the district office’s account of a local tradition.',
            ],
          },
          src: ['pingxi-office-mailbox'],
        },
      ],
      walk: {
        name: { zh: '下坡到老街，看火車過頭頂', en: 'Down to the old street to watch trains overhead' },
        summary: { zh: '出站沿中華街往下走', en: 'Down Zhonghua Street from the station' },
        loop: true,
        stops: [
          { name: { zh: '平溪老街', en: 'Pingxi Old Street' }, lat: 25.02533, lon: 121.73882,
            desc: { zh: '看火車從老街上方的鐵道橋駛過。', en: 'Watch trains cross the railway bridge above the street.' }, src: ['ntpc-pingxi-oldst', 'ntpc-tour38'] },
          { name: { zh: '平溪老郵筒（平溪郵局前）', en: 'The old postbox (Pingxi Post Office)' }, lat: 25.02595, lon: 121.73853,
            desc: { zh: '區公所記載的「相傳最老郵筒」。', en: 'Said by the district office to be Taiwan’s oldest postbox.' }, src: ['pingxi-office-mailbox'] },
        ],
        legs: [
          { min: null, note: { zh: '出站就是中華街，沿緩坡往下走到與平溪街交叉處一帶', en: 'leave the station onto Zhonghua Street and walk down the gentle slope to Pingxi Street' }, src: ['ntpc-pingxi-stn'] },
          { min: null },
          { min: null },
        ],
        coordSrc: ['ntpc-pingxi-oldst', 'osm-pingxi-po'],
      },
      access: [
        { label: { zh: '出口', en: 'Exit' }, text: { zh: '一出站就是中華街；沿著緩坡往下走，到與平溪街交叉處，這一帶就是老街。', en: 'The station opens onto Zhonghua Street. Walk down the gentle slope to where it meets Pingxi Street; that area is the old street.' }, src: ['ntpc-pingxi-stn'] },
        { label: { zh: '台灣好行 795 木柵平溪線', en: 'Taiwan Tourist Shuttle 795 Muzha–Pingxi' },
          text: { zh: '往平溪的班次來往捷運動物園站與平溪老街。在「平溪老街」站（A6）下車，步行約 3 分鐘到平溪老街。', en: 'The “to Pingxi” service runs between MRT Taipei Zoo Station and Pingxi Old Street. From the Pingxi Old Street stop (A6) it is about a 3-minute walk to the old street.' },
          src: ['taiwantrip-795-pingxi', 'taiwantrip-s11335'] },
        { label: { zh: '新北市公車 846（瑞芳—平溪）', en: 'New Taipei bus 846 (Ruifang–Pingxi)' },
          text: { zh: '停靠平溪、孝子山、平溪國中等站；班次見十分站的說明（2026-10-01 查核）。', en: 'Stops include Pingxi, Xiaozi Mountain and Pingxi Junior High; times as listed under Shifen (checked 2026-10-01).' }, src: ['ebus-846'] },
      ],
      practical: [
        { label: { zh: '放天燈的規定', en: 'Rules for sky lanterns' },
          text: { zh: '新北市只有平溪區劃定的範圍可以放天燈；晚上 10 點到隔天早上 6 點禁止施放；不可附掛爆竹煙火；未滿 14 歲要有成年人陪同。',
            en: 'In New Taipei, sky lanterns may only be released in designated parts of Pingxi District. No releases from 10 pm to 6 am, no firecrackers attached, and under-14s must be accompanied by an adult.' }, src: ['ntpc-lantern-law'] },
        { label: { zh: '平溪天燈節', en: 'Pingxi Sky Lantern Festival' },
          text: { zh: '2026 年在 2 月 27 日（平溪國中場）與 3 月 3 日（十分廣場場）舉辦，都有接駁車。下一屆日期以官方公告為準。', en: 'In 2026 it was held on 27 February (Pingxi Junior High) and 3 March (Shifen Square), each with shuttle buses. Check official announcements for next year’s dates.' }, src: ['ntpc-lantern-2026'] },
        { label: { zh: '步道封閉', en: 'Trail closures' },
          text: { zh: '觀音巖寺往觀音巖公園路段、觀音巖寺旁八仙洞目前封閉（2026-09-30 公告）。', en: 'The path from Guanyinyan Temple to Guanyinyan Park and the Baxian Cave beside the temple are closed (notice of 2026-09-30).' }, src: ['ntpc-news-1480'] },
        { label: { zh: '孝子山', en: 'Xiaozi Mountain' },
          text: { zh: '官方分級為「荒野探險型」步道，全長約 2.76 公里，不是輕鬆散步。', en: 'Officially graded a “wilderness adventure” trail, about 2.76 km long. Not a casual stroll.' }, src: ['ntpc-xiaozi'] },
        { label: { zh: '平溪站營業時間', en: 'Pingxi Station hours' },
          text: { zh: '05:17–20:37；售票 08:20–15:40（臺鐵公告）。', en: '05:17–20:37; ticket sales 08:20–15:40 (TRA).' }, src: ['tra-stn-pingxi'] },
      ],
    },

    /* ═════════ 菁桐 ═════════ */
    jingtong: {
      railisland: { zh: 'https://railisland.tw/stations/jingtong/', en: 'https://railisland.tw/en/stations/jingtong/' },
      hero: 'jingtong-hero',
      tagline: { zh: '平溪線終點：木造古蹟車站與安靜的礦業小鎮', en: 'End of the line: a wooden heritage station and a quiet mining town' },
      themes: [{ icon: 'shrine', label: { zh: '古蹟車站', en: 'Heritage station' } }, { icon: 'factory', label: { zh: '礦業遺跡', en: 'Mining heritage' } }, { icon: 'train', label: { zh: '終點站', en: 'End of the line' } }],
      stay: { zh: '1–2 小時', en: '1–2 hours' },
      highlights: [
        { id: 'station', icon: 'shrine', photo: 'jingtong-hero', lat: 25.0238742, lon: 121.7239214,
          name: { zh: '菁桐車站', en: 'Jingtong Station' },
          teaser: { zh: '1929 年興建的木造站房，市定古蹟。', en: 'A 1929 wooden station, now a municipal monument.' },
          desc: { zh: ['1929 年臺灣總督府鐵道部買下平溪線後，同年興建菁桐車站；2003 年指定為縣定古蹟，今為新北市市定古蹟。站內仍保有路牌閉塞器設施。'], en: ['The Railway Department bought the Pingxi Line in 1929 and built Jingtong Station that year. It was designated a monument in 2003 and still has its token block instruments.'] },
          src: ['nchdb-jingtong-stn'] },
        { id: 'museum', icon: 'factory', lat: 25.02396, lon: 121.72429,
          name: { zh: '菁桐礦業生活館', en: 'Mining Industry Life Pavilion' },
          teaser: { zh: '出站左轉就到，免費參觀。', en: 'Left out of the station; free.' },
          desc: { zh: ['介紹菁桐礦業與礦工生活的展館，在菁桐車站下車，出車站左轉步行可達。'], en: ['A small museum of Jingtong’s mining life. Turn left out of the station.'] },
          hours: { text: { zh: '週二至週日 09:30–17:00；週一、國定假日休館（來源頁 2021 年更新）', en: 'Tue–Sun 09:30–17:00; closed Mondays and national holidays (source page updated 2021)' }, src: ['museum-jingtong'] },
          src: ['museum-jingtong', 'ntpc-mining-hall'] },
        { id: 'coal', icon: 'factory', lat: 25.02484, lon: 121.72446,
          name: { zh: '菁桐煤礦紀念公園', en: 'Jingtong Coal Memorial Park' },
          teaser: { zh: '選洗煤場、石底大斜坑遺址。', en: 'Coal preparation plant and the Shidi inclined shaft.' },
          desc: { zh: ['園區有選洗煤場、總辦事處遺址與石底大斜坑遺址。菁桐車站、選洗煤場與平溪招待所，在 2001 年被列入文建會「臺灣歷史百景」。'], en: ['The park holds the coal preparation plant, the former head office site and the Shidi inclined shaft. The station, the plant and the guest house were listed among Taiwan’s 100 historic scenes in 2001.'] },
          src: ['ntpc-coal-park', 'ntpc-mining-hall'] },
        { id: 'guesthouse', icon: 'shrine', lat: 25.022536, lon: 121.722198,
          name: { zh: '平溪招待所（石底俱樂部）', en: 'Pingxi Guest House (Shidi Club)' },
          teaser: { zh: '1939 年起建，西式玄關、和式貴賓室。', en: 'Built from 1939; Western entrance, Japanese guest rooms.' },
          desc: { zh: ['臺陽公司的平溪招待所又稱「石底俱樂部」，1939 年開始興建，供職員休閒住宿與招待貴賓；今為新北市市定古蹟。入內參觀的方式待查核。'], en: ['Taiyang’s guest house, the Shidi Club, was begun in 1939 for staff and important guests. It is a municipal monument; current visiting arrangements are not yet verified.'] },
          src: ['nchdb-guesthouse'] },
      ],
      intro: {
        text: {
          zh: '菁桐是平溪線的終點站，比十分、平溪安靜。緊鄰老街的日式木造菁桐車站是市定古蹟；這裡出產的石底煤品質優良，曾被稱為「臺灣煤」的代表。',
          en: 'Jingtong is the end of the Pingxi Line, and quieter than Shifen or Pingxi. The Japanese-style wooden station beside the old street is a municipal monument. The Shidi coal mined here was so good it was held up as the model of “Taiwan coal”.',
        },
        src: ['ntpc-jingtong-stn', 'nchdb-jingtong-stn', 'museum-jingtong'],
      },
      stories: [
        {
          id: 'station',
          title: { zh: '菁桐車站：市定古蹟', en: 'Jingtong Station: a municipal monument' },
          teaser: { zh: '1929 年興建，至今仍保有路牌閉塞器。', en: 'Built in 1929, still fitted with its token instruments.' },
          body: {
            zh: [
              '1929 年臺灣總督府鐵道部買下平溪線後，同年興建菁桐車站。',
              '車站在 2003 年 5 月 1 日被指定為縣定古蹟，今為新北市市定古蹟。指定理由包括站內仍保有路牌閉塞器設施，以及傳統的客貨兩用車站型制。',
              '各單位對建站年份說法不一，這裡採用文化資產局紀錄的 1929 年。',
            ],
            en: [
              'The colonial Railway Department bought the Pingxi Line in 1929 and built Jingtong Station the same year.',
              'It was designated a county monument on 1 May 2003 and is now a New Taipei municipal monument. The reasons cited include its surviving token block instruments and its traditional layout as a combined passenger and freight station.',
              'Sources disagree on the year the station was built; this card follows the Bureau of Cultural Heritage record (1929).',
            ],
          },
          src: ['nchdb-jingtong-stn'],
        },
        {
          id: 'guesthouse',
          title: { zh: '石底俱樂部：臺陽礦業平溪招待所', en: 'The Shidi Club: Taiyang Mining’s guest house' },
          teaser: { zh: '1939 年興建，玄關是西式、貴賓室是和式。', en: 'Built from 1939, Western at the entrance and Japanese in the guest rooms.' },
          body: {
            zh: [
              '臺陽公司的平溪招待所又稱「石底俱樂部」，1939 年開始興建、施工一年，供公司職員休閒、住宿，也用來招待貴賓。',
              '玄關、圖書室與康樂室是西式設計，貴賓室與宿舍則是和式。2003 年 9 月 25 日公告為古蹟，今為新北市市定古蹟。',
            ],
            en: [
              'Taiyang’s Pingxi guest house, also known as the Shidi Club, was begun in 1939 and took a year to build. Staff used it for leisure and lodging, and the company received important guests here.',
              'The entrance hall, library and recreation room are Western in style; the guest rooms and dormitory are Japanese. It was declared a monument on 25 September 2003 and is now a New Taipei municipal monument.',
            ],
          },
          src: ['nchdb-guesthouse'],
        },
        {
          id: 'coal',
          title: { zh: '石底煤與大斜坑', en: 'Shidi coal and the great inclined shaft' },
          teaser: { zh: '「臺灣煤」的代表；車站、洗煤場、招待所都列入臺灣歷史百景。', en: 'A byword for Taiwan coal, and three sites on Taiwan’s 100 historic scenes.' },
          body: {
            zh: [
              '菁桐的石底煤礦品質優良，被稱為「臺灣煤」的代表。',
              '石底大斜坑位在菁桐火車站上方，當年為了節省搬運成本而開鑿，改變了原本的坑外搬運系統。開鑿年份在不同官方資料中有 1935、1937 年等說法，待查核。',
              '菁桐車站、選洗煤場與平溪招待所，在 2001 年被列入文建會「臺灣歷史百景」。',
            ],
            en: [
              'The Shidi coal mined at Jingtong was of such quality that it was held up as the model of “Taiwan coal”.',
              'The Shidi inclined shaft, above Jingtong Station, was dug to cut haulage costs and changed how coal was moved above ground. Official sources give different years for it (1935, 1937); not yet verified.',
              'Jingtong Station, the coal preparation plant and the Pingxi guest house were listed among the Council for Cultural Affairs’ 100 historic scenes of Taiwan in 2001.',
            ],
          },
          src: ['museum-jingtong', 'pingxi-office-shaft', 'ntpc-mining-hall'],
        },
      ],
      walk: {
        name: { zh: '礦業小鎮一圈', en: 'A loop around the mining town' },
        summary: { zh: '生活館、煤礦遺址、招待所外觀，再回老街', en: 'Mining museum, coal heritage, the guest house from outside, then the old street' },
        loop: true,
        stops: [
          { name: { zh: '菁桐礦業生活館', en: 'Jingtong Mining Industry Life Pavilion' }, lat: 25.02396, lon: 121.72429,
            desc: { zh: '免費參觀；開放時間見「實用資訊」。', en: 'Free; see “Good to know” for hours.' }, src: ['museum-jingtong'] },
          { name: { zh: '菁桐煤礦紀念公園', en: 'Jingtong Coal Memorial Park' }, lat: 25.02484, lon: 121.72446,
            desc: { zh: '選洗煤場、總辦事處遺址、石底大斜坑遺址。', en: 'The coal preparation plant, former head office site and the Shidi inclined shaft.' }, src: ['ntpc-coal-park'] },
          { name: { zh: '平溪招待所（外觀）', en: 'Pingxi Guest House (exterior)' }, lat: 25.022536, lon: 121.722198,
            desc: { zh: '市定古蹟；入內參觀的方式待查核。', en: 'Municipal monument; current visiting arrangements not yet verified.' }, src: ['nchdb-guesthouse'] },
          { name: { zh: '菁桐老街', en: 'Jingtong Old Street' }, lat: 25.02378, lon: 121.72329,
            desc: { zh: '就在車站出口。', en: 'Right outside the station.' }, src: ['ntpc-jingtong-oldst'] },
        ],
        legs: [
          { min: null, note: { zh: '出車站左轉步行可達', en: 'turn left out of the station' }, src: ['museum-jingtong'] },
          { min: null },
          { min: null },
          { min: null },
          { min: null, note: { zh: '老街就在車站出口處', en: 'the old street is at the station exit' }, src: ['ntpc-jingtong-oldst'] },
        ],
        coordSrc: ['ntpc-mining-hall', 'ntpc-coal-park', 'nchdb-guesthouse', 'ntpc-jingtong-oldst'],
      },
      access: [
        { label: { zh: '出口', en: 'Exit' }, text: { zh: '菁桐最熱鬧的老街就在車站出口處；菁桐礦業生活館在出站後左轉。', en: 'Jingtong’s busiest street starts at the station exit. For the Mining Industry Life Pavilion, turn left out of the station.' }, src: ['ntpc-jingtong-oldst', 'museum-jingtong'] },
        { label: { zh: '台灣好行 795 木柵平溪線', en: 'Taiwan Tourist Shuttle 795 Muzha–Pingxi' },
          text: { zh: '停靠「菁桐坑」站（A5）。', en: 'Stops at Jingtongkeng (A5).' }, src: ['taiwantrip-s11302'] },
        { label: { zh: '新北市公車 846', en: 'New Taipei bus 846' },
          text: { zh: '不停靠菁桐（2026-10-01 查核路線停靠站）。', en: 'Does not serve Jingtong (route stops checked 2026-10-01).' }, src: ['ebus-846'] },
      ],
      practical: [
        { label: { zh: '菁桐礦業生活館', en: 'Mining Industry Life Pavilion' },
          text: { zh: '週二至週日 09:30–17:00；週一、國定假日、選舉日與天然災害停班日休館。免費。來源頁面最後更新於 2021 年，出發前請再確認。', en: 'Tuesday–Sunday 09:30–17:00; closed Mondays, national holidays, election days and typhoon days. Free. The source page was last updated in 2021, so check before you go.' }, src: ['museum-jingtong'] },
        { label: { zh: '平溪招待所', en: 'Pingxi Guest House' }, tbd: true,
          text: { zh: '文化資產紀錄寫「週二至週日 10:00–17:00 預約參觀」，目前是否仍這樣開放待查核。', en: 'The heritage record says “visits by appointment, Tuesday–Sunday 10:00–17:00”. Whether this still applies is not yet verified.' }, src: ['nchdb-guesthouse'] },
        { label: { zh: '菁桐站營業時間', en: 'Jingtong Station hours' },
          text: { zh: '05:11–20:31；售票 08:20–15:40（臺鐵公告）。', en: '05:11–20:31; ticket sales 08:20–15:40 (TRA).' }, src: ['tra-stn-jingtong'] },
      ],
    },
  },

  // 沿途故事：依地點掛在站上，畫面依「這班車」的停靠順序排列（去程、回程都適用）
  along: [
    {
      id: 'badouzi-sea', station: 'badouzi',
      title: { zh: '北台灣的「多良車站」', en: 'The “Duoliang Station” of northern Taiwan' },
      teaser: { zh: '出站就是遼闊海景；深澳線停駛 25 年後才恢復載客。', en: 'The sea right outside the station, on a line that carried no passengers for 25 years.' },
      body: {
        zh: [
          '八斗子車站位在新北市瑞芳區與基隆市中正區交界，一出站就是遼闊海景，因此有「北台灣多良車站」的美譽。',
          '深澳線全線在 1989 年 8 月 21 日停辦客運，2014 年 1 月 9 日才恢復載客；八斗子站在 2016 年 12 月 28 日正式啟用。',
          '2024 年 4 月起，海科館到八斗子這段因邊坡改善工程停駛，2025 年 2 月 26 日全線恢復行駛。',
        ],
        en: [
          'Badouzi Station sits on the border between Ruifang District (New Taipei) and Zhongzheng District (Keelung). The open sea is right outside, which earned it the nickname “Northern Taiwan’s Duoliang Station”.',
          'Passenger service on the Shen’ao Line ended on 21 August 1989 and resumed on 9 January 2014. Badouzi Station opened on 28 December 2016.',
          'From April 2024 the Haikeguan–Badouzi section was closed for slope stabilisation work. Full service resumed on 26 February 2025.',
        ],
      },
      src: ['klzz-badouzi', 'cna-2016-badouzi', 'cna-2025-shenao'],
    },
    {
      id: 'haikeguan-plant', station: 'haikeguan',
      title: { zh: '從火力發電廠到海洋博物館', en: 'From power plant to marine museum' },
      teaser: { zh: '1939 年落成的北部火力發電廠，成了海科館的主建築。', en: 'A 1939 thermal power plant became the museum’s main building.' },
      body: {
        zh: [
          '海科館的主建築原本是北部火力發電廠，1937 年動工、1939 年落成；1981 年除役，1997 年撥交教育部，作為國立海洋科技博物館籌備處使用。',
          '館方說，這是全世界第一座由火力發電所改建成的海洋科技博物館。深澳線也因應海科館啟用，在 2014 年 1 月 9 日恢復客運，這裡有全臺唯一的博物館車站月臺。',
        ],
        en: [
          'The museum’s main building was the Northern Thermal Power Plant. Construction began in 1937 and it opened in 1939. It was decommissioned in 1981 and handed to the Ministry of Education in 1997 to house the museum’s preparatory office.',
          'The museum describes it as the world’s first marine science museum converted from a thermal power plant. The Shen’ao Line resumed passenger service on 9 January 2014 for the museum’s opening, and the platform here is described as Taiwan’s only museum station platform.',
        ],
      },
      src: ['tcmb-power-plant', 'nmmst-about', 'taiwannet-shenao', 'taiwannet-nmmst'],
    },
    {
      id: 'ruifang-name', station: 'ruifang',
      title: { zh: '一間雜貨店，變成了地名', en: 'A general store that became a place name' },
      teaser: { zh: '「去瑞芳」原本是去一家店；砂金則是在造鐵橋時被發現。', en: '“Going to Ruifang” once meant going to a shop, and gold turned up while a railway bridge was being built.' },
      body: {
        zh: [
          '清代往來臺北與噶瑪蘭、或上山採金的人，會經過基隆河的接駁渡口。渡口附近有家鋪號「瑞芳」的雜貨店，大家相約「去瑞芳」、「從瑞芳回來」，店名就成了地名。',
          '據基隆市文化局資料，1890 年代興建七堵鐵橋時，一名有採金經驗的工人清洗飯盒時發現砂金，後來循線找到九份、金瓜石一帶的金礦。',
        ],
        en: [
          'In the Qing era, travellers between Taipei and Kavalan (Yilan), and prospectors heading into the hills, crossed the Keelung River at a ferry. A general store near the ferry was called “Ruifang”. People arranged to “go to Ruifang” or “come back from Ruifang”, and the shop’s name became the place name.',
          'According to the Keelung City Cultural Affairs Bureau, in the 1890s a worker with gold-panning experience found gold dust while washing his lunch box during construction of the Qidu railway bridge. Tracing it upstream led to the gold deposits around Jiufen and Jinguashi.',
        ],
      },
      src: ['ruifang-office', 'tcmb-gold'],
    },
    {
      id: 'houtong-coal', station: 'houtong', photo: 'houtong',
      title: { zh: '從臺灣最大煤礦到貓村', en: 'From Taiwan’s largest coal company to a cat village' },
      teaser: { zh: '全盛時每天五百多名礦工進坑；礦業沒落後，志工讓貓村出了名。', en: 'Over 500 miners a day at its peak; volunteers later made it famous for cats.' },
      body: {
        zh: [
          '猴硐舊名「猴洞」，清乾隆末年時山中洞穴多藏有猴群。1920 年瑞芳到猴洞段鐵路開始營業，1962 年改站名為猴硐。',
          '車站旁的瑞三鑛業曾是臺灣第一大煤礦公司，全盛時期每天有超過 500 名礦工進坑。整煤廠 1990 年停業，2005 年登錄為新北市歷史建築。',
          '礦業沒落後，一位愛貓網友發起志工隊改善村內環境，猴硐貓村後來獲 CNN 推薦為全球六大賞貓景點。',
        ],
        en: [
          'Houtong was once written 猴洞, “monkey cave”: in the late Qianlong era the caves in these hills held troops of monkeys. The Ruifang–Houtong section of railway opened in 1920, and the station took its current name in 1962.',
          'Ruisan Mining, next to the station, was Taiwan’s largest coal company. At its peak more than 500 miners went underground every day. The coal preparation plant closed in 1990 and was registered as a New Taipei historic building in 2005.',
          'After mining declined, a cat-loving netizen organised volunteers to improve the village. Houtong Cat Village was later recommended by CNN as one of the world’s six best places to see cats.',
        ],
      },
      src: ['ntpc-houtong-stn', 'ntpc-ruisan', 'tcmb-ruisan', 'ntpc-catvillage'],
    },
    {
      id: 'sandiaoling-junction', station: 'sandiaoling', photo: 'sandiaoling',
      title: { zh: '沒有公路的車站，平溪線從這裡出發', en: 'The station with no road, where the Pingxi Line begins' },
      teaser: { zh: '臺鐵唯一沒有連外公路的車站；平溪線原本是運煤鐵路。', en: 'TRA’s only station without a road connection, and the start of a former coal railway.' },
      body: {
        zh: [
          '1922 年啟用的三貂嶺車站，是臺鐵唯一一座沒有連外公路的車站。日治時期的鐵路旅遊指南形容這裡「峰巒嶂壁前後屹立，基隆川溪谷的小仙境」。',
          '這裡是宜蘭線與平溪線的交會點。平溪線由台陽礦業株式會社在 1919 年開工、1921 年完工，原本用來運煤；1929 年 10 月 1 日由鐵道部收購，增辦客運。',
          '附近塵封 37 年的舊三貂嶺隧道，改建為「三貂嶺生態友善隧道」，2022 年 10 月 1 日起正式營運。',
        ],
        en: [
          'Sandiaoling Station opened in 1922 and is the only TRA station with no connecting road. A Japanese-era railway guide described it as “a little fairyland in the Keelung River gorge”, ringed by peaks and cliffs.',
          'The Yilan Line and the Pingxi Line meet here. Taiyang Mining Co. began building the Pingxi Line in 1919 and finished it in 1921 to carry coal. The government Railway Department bought it on 1 October 1929 and added passenger service.',
          'The old Sandiaoling tunnel nearby, sealed for 37 years, reopened as the Sandiaoling Eco-friendly Tunnel and has operated since 1 October 2022.',
        ],
      },
      src: ['ntpc-sandiaoling', 'ntpc-lingjiao-stn', 'taiwannet-pingxi-line', 'ntpc-tunnel'],
    },
    {
      id: 'dahua-potholes', station: 'dahua',
      title: { zh: '河床上的壺穴', en: 'Potholes in the riverbed' },
      teaser: { zh: '因煤礦而設的小站；站下方是基隆河壺穴最密集的一段。', en: 'A stop built for a coal mine, above the densest potholes on the Keelung River.' },
      body: {
        zh: [
          '大華地區如今剩下不到十戶人家，原本沒有車站，因開採大華煤礦在 1949 年設站，1994 年改為無站務人員的招呼站。',
          '從平溪到三貂嶺的基隆河床上有許多圓滑的坑洞，叫做壺穴：岩層硬度不均，夾帶細沙的河水沖出坑洞，再由坑裡的小漩渦反覆侵蝕成壺狀。大華車站以下的壺穴群最密集。',
        ],
        en: [
          'Fewer than ten households remain in Dahua. There was no station until 1949, when one was opened for the Dahua coal mine. It became an unstaffed flag stop in 1994.',
          'The Keelung River bed between Pingxi and Sandiaoling is dotted with smooth hollows called potholes. Where rock hardness varies, sand-laden water scours a hollow, and small whirlpools inside it keep grinding it into a pot shape. The densest cluster lies below Dahua Station.',
        ],
      },
      src: ['ntpc-dahua-stn', 'ntpc-dahua-potholes'],
    },
    {
      id: 'wanggu-falls', station: 'wanggu',
      title: { zh: '運煤招呼站與簾幕式瀑布', en: 'A coal flag stop and a curtain waterfall' },
      teaser: { zh: '最初叫「慶和車站」；附近的吊橋是礦業時代的遺跡。', en: 'First called Qinghe Station; the suspension bridge nearby dates from the mining era.' },
      body: {
        zh: [
          '1972 年，為了運送慶和煤礦而設立招呼站，最初命名為慶和車站。臨近車站的慶和吊橋，是當年煤礦業繁榮的遺跡。',
          '望古瀑布因為水平狀的岩層和軟硬質差異，形成簾幕式的瀑布景觀。',
        ],
        en: [
          'A flag stop opened here in 1972 to carry coal from the Qinghe mine, and was first named Qinghe Station. The Qinghe suspension bridge near the station is a relic of the mining boom.',
          'Wanggu Falls is a curtain-type waterfall formed by horizontal rock layers of differing hardness.',
        ],
      },
      src: ['ntpc-wanggu-stn', 'ntpc-wanggu-falls'],
    },
    {
      id: 'lingjiao-name', station: 'lingjiao',
      title: { zh: '山嶺腳下的小站', en: 'The stop at the foot of the ridge' },
      teaser: { zh: '站名來自北邊的姜子寮山；嶺腳瀑布就在車站附近。', en: 'Named for the mountain to the north; Lingjiao Falls is next to the station.' },
      body: {
        zh: [
          '嶺腳位在海拔七百公尺以上的姜子寮山南邊，所以以「嶺腳」為名，1962 年 12 月 15 日改稱嶺腳站。',
          '嶺腳瀑布就在車站附近。',
        ],
        en: [
          'Lingjiao means “foot of the ridge”: it lies south of Jiangziliao Mountain, which rises above 700 m. The station took the name Lingjiao on 15 December 1962.',
          'Lingjiao Falls is close to the station.',
        ],
      },
      src: ['ntpc-lingjiao-stn'],
    },
  ],

  about: {
    sections: [
      {
        title: { zh: '這是什麼', en: 'What this is' },
        items: {
          zh: [
            '軌島「乘車導覽模式」的互動展示原型，給鐵道業者、觀光單位與地方內容伙伴評估用。',
            '獨立於軌島正式網站：沒有部署上線，也沒有改動正式站。',
          ],
          en: [
            'An interactive prototype of Rail Island’s “ride guide mode”, for rail operators, tourism bodies and local content partners to evaluate.',
            'Separate from the live Rail Island site: it is not deployed and does not change the live site.',
          ],
        },
      },
      {
        title: { zh: '哪些是示範資料', en: 'What is sample data' },
        items: {
          zh: [
            '班次 4816（往菁桐）與 4827（往八斗子）的停靠站與時刻，取自臺鐵開放資料逐日時刻表（2026-09-27 抓取，適用 2026-09-27～10-10）。',
            '列車位置是依時刻表手動推進的示範位置，不是即時位置，也沒有速度或誤點。',
            '地圖的軌道線形取自 OpenStreetMap（ODbL），畫成示意圖；散步圖的點是真實座標，但點與點之間是直線，不是步行路徑。',
            '地方內容由官方或權威公開來源整理，每則附來源，查核日期 2026-10-01。查不到的資訊標示「待查核」或「待補」，沒有自行填寫。',
            '照片來自 Wikimedia Commons，依各自的 CC 授權標示作者與授權。',
            '英文是展示用翻譯。QR code 圖樣是示意，不可掃描；railisland.tw/ride/ 這個網址目前不存在。',
          ],
          en: [
            'Stops and times for trains 4816 (to Jingtong) and 4827 (to Badouzi) come from the TRA open-data daily timetable (fetched 2026-09-27, valid 2026-09-27 to 10-10).',
            'The train position is a demo you step through by hand along the timetable. It is not a live location and has no speed or delay data.',
            'Track geometry on the map comes from OpenStreetMap (ODbL) and is drawn as a schematic. Walk maps use real coordinates, but the straight lines between points are not walking paths.',
            'Local content is compiled from official or authoritative public sources, each with a link, checked on 2026-10-01. Anything we could not verify is marked “not yet verified” or “to be added”, never filled in.',
            'Photos come from Wikimedia Commons and are credited with their author and CC licence.',
            'The English text is a demo translation. The QR patterns are mock-ups and cannot be scanned; railisland.tw/ride/ does not exist yet.',
          ],
        },
      },
      {
        title: { zh: '尚未串接', en: 'Not connected yet' },
        items: {
          zh: [
            '即時列車位置、誤點與月台資訊（未接 TDX 或臺鐵即時 API）。',
            '自動定位：第一版刻意不做，沿途故事由旅客手動點選。',
            '內容後台：業者、觀光單位、地方伙伴供稿與審核流程。',
            '真實 QR code 產生，以及 QR 與車廂、班次的對應。',
            '營業時間等會變動的資訊的定期重新查核。',
            '登入、訂票、付款、廣告與車廂硬體。',
          ],
          en: [
            'Live train position, delays and platforms (no TDX or TRA real-time API).',
            'Automatic location: deliberately left out of version one; riders tap stories themselves.',
            'A content back office for operators, tourism bodies and local partners to supply and review content.',
            'Real QR code generation and the mapping from a QR code to a car and train.',
            'Regular re-checking of details that change, such as opening hours.',
            'Login, ticketing, payment, advertising and on-board hardware.',
          ],
        },
      },
      {
        title: { zh: '合作與授權聲明', en: 'Partnerships and licensing' },
        items: {
          zh: [
            '本展示沒有與臺鐵、新北市政府或任何觀光、地方單位合作，也沒有取得資料授權；畫面沒有使用任何業者標誌。',
            '引用的公開資料以連結註明出處。展示不放店家廣告。',
            '後續可能的模式：業者、觀光單位或地方伙伴提供並審核內容，軌島負責旅程介面與呈現。',
          ],
          en: [
            'This demo has no partnership with TRA, the New Taipei City Government or any tourism or local body, and no data licence from them. No operator logos are used.',
            'Public sources are credited with links. The demo carries no shop advertising.',
            'A possible model later: operators, tourism bodies or local partners supply and review content, and Rail Island provides the journey interface.',
          ],
        },
      },
    ],
  },
};
