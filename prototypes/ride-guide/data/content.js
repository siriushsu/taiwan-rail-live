/* 乘車導覽原型的地方內容。
 * 規則：每一則事實都要有來源（sources 的 id）；查不到的寫「待查核／待補」，不自己填。
 * 查核日期 checkedOn＝這批內容最後一次逐則打開來源核對的日期。
 * 英文為展示用翻譯，忠於中文來源內容。 */
window.RIDE_CONTENT = {
  checkedOn: '2026-10-01',

  lines: { pingxi: { name: { zh: '平溪線', en: 'Pingxi Line' } } },

  // 英文站名與 repo i18n/stations.json 一致
  stationNames: {
    badouzi: { zh: '八斗子', en: 'Badouzi' }, haikeguan: { zh: '海科館', en: 'Haikeguan' }, ruifang: { zh: '瑞芳', en: 'Ruifang' },
    houtong: { zh: '猴硐', en: 'Houtong' }, sandiaoling: { zh: '三貂嶺', en: 'Sandiaoling' }, dahua: { zh: '大華', en: 'Dahua' },
    shifen: { zh: '十分', en: 'Shifen' }, wanggu: { zh: '望古', en: 'Wanggu' }, lingjiao: { zh: '嶺腳', en: 'Lingjiao' },
    pingxi: { zh: '平溪', en: 'Pingxi' }, jingtong: { zh: '菁桐', en: 'Jingtong' },
  },

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
  },

  photos: {},

  stations: {},

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
      id: 'houtong-coal', station: 'houtong',
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
      id: 'sandiaoling-junction', station: 'sandiaoling',
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
