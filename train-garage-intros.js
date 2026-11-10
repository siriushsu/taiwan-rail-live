// 車庫介紹：每座場景、每款車一段（約 150 字），四語寫在同一份（zh-TW／en／ja／ko），顯示在兌換視窗、場景頁的「介紹」與車款詳情。
// 手維護。年份、數字與「最早／唯一」這類說法都要有出處，出處清單在 docs/garage-intros-sources.md。
// profileLabels／profiles：車款詳情的「車款檔案」（綽號、規格、小故事），每一格都要對得到公開來源（維基百科等），逐筆網址在同一份出處文件。
// App 由 native tools/gen_garage_intros.mjs 從網頁釘版讀這份產生，改了這裡 App 要重產。
window.RailGarageIntros = {
scenes: {
  "paddy": {
    "zh-TW": "軌島的預設車庫，不對應哪一座真實車站，而是把台灣鄉間火車站的日常揉在一起：木造小站旁有一處平交道，環線中間是稻田、三合院和埤塘，路邊一座掛著燈籠的土地公廟；一頭的彎道跨過溪上的鋼鈑梁橋，另一頭鑽進小山的隧道。所有車款都能開進來跑，免費、永遠開放，晴日、黃昏收工、小站夜燈三種時段隨你切換。",
    "en": "Railisland’s default depot doesn’t represent any one real station. Instead it blends the everyday scenes of a Taiwanese country stop: a small wooden station beside a level crossing, a loop of track around rice paddies, a traditional three-sided farmhouse and a farm pond, and a roadside Earth God shrine hung with lanterns. At one end a curve crosses a stream on a steel plate-girder bridge; at the other the line disappears into a hillside tunnel. Every train can run here, and the depot is free and always open. Switch between three times of day: a sunny day, dusk at closing time, and the station’s night lights.",
    "ja": "軌島の預設ガレージで、実在の駅ではなく、台湾の田舎の駅の日常を一つにまとめた場面です。木造の小さな駅のそばに踏切があり、線路の輪の内側には田んぼ、三合院（伝統的な中庭式の民家）、ため池が広がり、道端には提灯を下げた土地公廟（土地の神様のお堂）が建っています。一方のカーブは小川にかかる鋼板桁橋を渡り、もう一方は小山のトンネルへ入っていきます。どの車両も走らせることができ、無料でいつでも利用できます。晴れの日、夕暮れの仕事終わり、駅の夜灯の三つの時間帯を切り替えられます。",
    "ko": "궤도섬의 기본 차고로, 실제 어느 역을 옮긴 것이 아니라 대만 시골 기차역의 일상을 한데 엮은 장면이에요. 목조 간이역 옆에 건널목이 있고, 선로가 도는 한가운데에는 논과 삼합원(전통 가옥), 연못이 있어요. 길가에는 등롱을 단 토지공 사당도 서 있지요. 한쪽 끝 커브는 개울 위의 강판 거더교를 건너고, 다른 쪽 끝은 작은 산의 터널로 들어가요. 모든 차량이 들어와 달릴 수 있고, 무료이며 언제나 열려 있어요. 맑은 낮, 해 질 녘 퇴근 시간, 간이역의 밤 조명 세 가지 시간대를 마음대로 바꿔 볼 수 있어요.",
  },
  "south-coast": {
    "zh-TW": "南迴線從屏東枋寮到台東，全長約 98 公里，1992 年通車，補上環島鐵路的最後一段，2020 年底完成電氣化。沿線一邊是山、一邊是太平洋，也是藍皮普快車最後跑的路線。這座場景是南迴沿線靠山面海的印象，不是哪一座真實車站：椰子和檳榔長在山坡上，海邊一排紅欄杆，小站月台上有候車的旅客和站務員，入夜後木路燈和窗子一起亮起來。",
    "en": "The South Link Line runs about 98 km from Fangliao in Pingtung to Taitung. It opened in 1992, closing the last gap in the round-island railway, and was electrified at the end of 2020. Mountains rise on one side and the Pacific lies on the other, and this is also the route where the old blue-painted ordinary trains made their final runs. The scene is an impression of the coast along the line, not any real station: coconut palms and betel nut trees grow on the hillside, a row of red railings follows the shore, and passengers and station staff wait on the small platform. After dark, wooden lamp posts and windows light up together.",
    "ja": "南廻線は屏東の枋寮から台東までの全長約98キロメートルで、1992年に開通し、環島鉄道の最後の区間を埋めました。2020年末には電化が完了しています。沿線は片側が山、もう片側が太平洋で、藍皮普快車が最後に走った路線でもあります。この場面は特定の駅ではなく、山を背に海に面した南廻沿線のイメージです。山の斜面にはヤシとビンロウが育ち、海辺には赤い手すりが並び、小さな駅のホームには列車を待つ乗客と駅員がいて、夜になると木の街灯と窓の明かりがともります。",
    "ko": "남회선은 핑둥 팡랴오에서 타이둥까지 이어지는 약 98km 구간으로, 1992년에 개통해 환도 철도의 마지막 구간을 채웠고 2020년 말에 전철화를 마쳤어요. 한쪽은 산, 한쪽은 태평양인 노선이며, 파란색 객차의 보통열차가 마지막으로 달린 길이기도 해요. 이 장면은 특정 역이 아니라 남회선 주변의 산과 바다를 낀 인상을 담았어요. 산비탈에는 야자나무와 빈랑나무가 자라고, 바닷가에는 빨간 난간이 줄지어 있어요. 간이역 승강장에는 열차를 기다리는 승객과 역무원이 있고, 밤이 되면 나무 가로등과 창문에 불이 함께 켜져요.",
  },
  "shifen": {
    "zh-TW": "平溪線最早是為了運煤而築的鐵路，煤礦沒落後成了熱門的觀光支線。十分車站是全線唯一能讓兩列車交會的車站，站外的十分老街房子緊貼著鐵軌，火車就從店門前擦身而過。這座場景裡，燈籠串橫過街心，遊客捧著天燈退到店門口等火車開過，再讓天燈從街上升起；後直線外是基隆河，河上的靜安吊橋通往對岸長滿樹的山。",
    "en": "The Pingxi Line was first built to carry coal, and after the mines declined it became a popular sightseeing branch. Shifen is the only station on the line where two trains can pass each other. Outside it, the houses of Shifen Old Street crowd right up against the tracks, and trains brush past shop doorways. In this scene, strings of lanterns hang across the street, and visitors holding sky lanterns step back to the shop fronts to let the train go by, then send the lanterns up from the street. Beyond the straight stretch of track is the Keelung River, and the Jing’an Suspension Bridge leads over it to a tree-covered hill on the far bank.",
    "ja": "平渓線はもともと石炭を運ぶために造られた鉄道で、炭鉱が衰退したあとは人気の観光支線になりました。十分駅は全線で唯一、2本の列車が行き違える駅です。駅の外の十分老街では家々が線路すれすれに建ち、列車は店の軒先をかすめて通ります。この場面では、提灯の連なりが通りを横切り、観光客は天灯（ランタン）を抱えて店先に下がって列車をやり過ごし、そのあと天灯が通りから空へ上がっていきます。奥の直線の先には基隆河が流れ、川にかかる静安吊橋が木々の茂る対岸の山へと続いています。",
    "ko": "핑시선은 원래 석탄을 나르려고 놓은 철도인데, 탄광이 쇠퇴한 뒤 인기 있는 관광 지선이 되었어요. 스펀역은 전 구간에서 유일하게 열차 두 대가 교행할 수 있는 역이에요. 역 밖 스펀 옛 거리는 집들이 선로에 바짝 붙어 있어서, 열차가 가게 앞을 스치듯 지나가요. 이 장면에서는 등롱 줄이 거리를 가로지르고, 관광객들이 천등을 들고 가게 앞으로 물러나 열차가 지나가길 기다렸다가 천등을 거리에서 띄워 올려요. 직선 구간 뒤로는 지룽강이 흐르고, 강 위의 징안 조교가 나무가 우거진 건너편 산으로 이어져요.",
  },
  "viaduct": {
    "zh-TW": "台灣不少城市把鐵路抬上高架，拆掉一個個平交道，車站也從地面搬到橋上，像台中車站就在 2016 年換成了高架新站。這座場景是高架車站的微縮印象，不是哪一座真實車站：列車在防音牆圍著的高架橋上繞行，月台撐著薄薄的平頂雨棚，地面站房接著天橋；橋下是停車場和一排機車，站前大馬路兩旁是高高低低的透天厝，種著小葉欖仁、鳳凰木和台灣欒樹，遠方就是海。",
    "en": "Many Taiwanese cities have lifted their railways onto viaducts, removing level crossings one by one and moving stations from the ground up onto the bridge. Taichung Station, for example, was replaced by a new elevated station in 2016. This scene is a miniature impression of an elevated station, not any real one: trains circle on a viaduct lined with noise barriers, platforms carry thin flat canopies, and a ground-level station building connects to a footbridge. Under the viaduct are a car park and a row of scooters. The broad road in front of the station is flanked by townhouses of varying heights, planted with Indian almond, flame trees, and Taiwan golden rain trees, and the sea lies in the distance.",
    "ja": "台湾では多くの都市で鉄道が高架化され、踏切が一つずつ取り除かれて、駅も地上から橋の上へ移りました。台中駅も2016年に高架の新駅に変わっています。この場面は特定の駅ではなく、高架駅をミニチュアにしたイメージです。列車は防音壁に囲まれた高架橋を周回し、ホームは薄い平らな屋根で覆われ、地上の駅舎は跨線橋につながっています。橋の下には駐車場とバイクの列があり、駅前の大通りの両側には高さの異なる間口の狭い住宅が並び、モモタマナ、ホウオウボク、モクゲンジが植えられていて、遠くには海が見えます。",
    "ko": "대만의 많은 도시가 철도를 고가로 올려 건널목을 하나씩 없앴고, 역도 지상에서 다리 위로 옮겼어요. 타이중역은 2016년에 고가 신역으로 바뀌었지요. 이 장면은 특정 역이 아니라 고가역을 작게 줄인 인상이에요. 열차는 방음벽이 둘러싼 고가교 위를 돌고, 승강장에는 얇은 평지붕 캐노피가 얹혀 있으며, 지상 역사는 육교로 이어져요. 다리 밑은 주차장과 오토바이 한 줄이고, 역 앞 큰길 양옆으로는 높고 낮은 타운하우스가 서 있어요. 소엽람인수, 봉황목, 대만 모감주나무가 심겨 있고 멀리에는 바다가 보여요.",
  },
  "alishan": {
    "zh-TW": "阿里山林業鐵路 1912 年開始把山上的木材運下山，軌距只有 762 公釐，一路從平地爬上兩千多公尺的高山。坡太陡的地方，列車走「之字形」折返：開到盡頭停下、換個方向倒退上另一層，就這樣一前一後往上爬。2009 年莫拉克颱風重創全線，直到 2024 年 7 月才全線恢復通車。這座場景就是之字形折返的三層山坡，有山腳和山上兩座小站、柳杉與紅檜林和一棵神木，黃昏有雲海，夜裡有螢火蟲。",
    "en": "The Alishan Forest Railway began hauling timber down the mountain in 1912. Its gauge is only 762 mm, and it climbs from the lowlands to a mountain more than 2,000 meters high. Where the slope is too steep, trains use switchbacks: they run to the end of a spur, stop, and reverse up onto the next level, moving forward and backward as they climb. Typhoon Morakot badly damaged the entire line in 2009, and full service did not resume until July 2024. This scene is a three-level switchback hillside with two small stations, one at the foot and one on the mountain, Japanese cedar and red cypress forest, and one ancient giant tree. A sea of clouds appears at dusk and fireflies at night.",
    "ja": "阿里山森林鉄道は1912年から山の木材を麓へ運び出してきました。軌間はわずか762ミリメートルで、平地から標高2,000メートル余りの高山まで登ります。勾配が急な区間では、列車は「スイッチバック」で折り返します。行き止まりまで進んで停まり、向きを変えて後ろ向きに別の段へ上がり、前進と後退を繰り返しながら登っていきます。2009年の台風モーラコット（莫拉克）で全線が大きな被害を受け、2024年7月にようやく全線で運転が再開されました。この場面はスイッチバックの三段の山腹で、麓と山上の二つの小さな駅、スギと紅檜の林、一本の神木があり、夕方には雲海が広がり、夜にはホタルが飛びます。",
    "ko": "아리산 임업철도는 1912년부터 산의 목재를 실어 내렸어요. 궤간이 762mm밖에 안 되고, 평지에서 2,000m가 넘는 고산까지 올라가요. 경사가 너무 가파른 곳에서는 열차가 ‘지그재그’로 스위치백을 해요. 끝까지 가서 멈춘 뒤 방향을 바꿔 뒤로 다른 층으로 올라가는 식으로, 앞뒤를 번갈아 가며 올라가지요. 2009년 모라꼿 태풍으로 전 구간이 큰 피해를 입었고, 2024년 7월에야 전 구간 운행이 재개되었어요. 이 장면은 지그재그 스위치백의 3층 산비탈로, 산기슭과 산 위의 작은 역 두 곳, 삼나무와 홍편백 숲, 신목 한 그루가 있어요. 해 질 녘에는 운해가 끼고 밤에는 반딧불이가 날아요.",
  },
  "duoliang": {
    "zh-TW": "多良車站在台東太麻里，1992 年隨南迴線通車啟用，月台架在海邊，往外看就是一整片太平洋，常被稱為台灣最美的車站。2006 年起不再辦理客運，火車只過站不停，站房屋頂改成觀景台，成了看海、拍火車的熱門景點。場景照著站房的樣子做：奶油黃的洗石子牆、一排木窗、藍色扶手的長樓梯，觀景台上擠滿遊客，攝影者舉著相機跟著車廂轉；列車從山洞鑽出、沿著海岸彎過去。",
    "en": "Duoliang Station is in Taimali, Taitung. It opened in 1992 with the South Link Line, and its platform sits right by the sea, facing an unbroken stretch of the Pacific. It is often called the most beautiful station in Taiwan. Since 2006 it has no longer handled passengers; trains pass through without stopping, and the station roof has been turned into an observation deck, making it a popular place to watch the sea and photograph trains. The scene follows the station building: cream-yellow washed-stone walls, a row of wooden windows, and a long staircase with blue handrails. The deck is crowded with visitors, and photographers swing their cameras to follow the carriages. The train emerges from a tunnel and curves along the coast.",
    "ja": "多良駅は台東の太麻里にあり、1992年に南廻線の開通とともに使われ始めました。ホームは海辺にあり、外には太平洋が一面に広がることから、台湾で最も美しい駅とよく呼ばれます。2006年からは旅客の取り扱いをやめ、列車は停車せずに通過するだけです。駅舎の屋根は展望台に改められ、海を眺めたり列車を撮ったりする人気スポットになりました。この場面は駅舎の姿を再現しています。クリーム色の洗い出し仕上げの壁、一列の木の窓、青い手すりの長い階段があり、展望台は観光客でにぎわい、カメラを構えた撮影者が車両を目で追っています。列車は山のトンネルから出て、海岸沿いにカーブしていきます。",
    "ko": "둬량역은 타이둥 타이마리에 있는 역으로, 1992년 남회선과 함께 문을 열었어요. 승강장이 바닷가에 놓여 있어서 밖을 내다보면 태평양이 한눈에 펼쳐지고, 흔히 대만에서 가장 아름다운 역으로 불려요. 2006년부터는 여객 업무를 하지 않아 열차가 서지 않고 지나가기만 해요. 역사 지붕이 전망대로 바뀌어, 바다를 보고 기차를 찍는 인기 명소가 되었어요. 이 장면은 역사의 모습을 따랐어요. 크림빛 노란 세석 마감 벽, 한 줄로 늘어선 나무 창, 파란 난간이 달린 긴 계단이 있고, 전망대에는 관광객이 가득하며 사진가들은 카메라를 들고 열차 칸을 따라 몸을 돌려요. 열차는 산굴에서 나와 해안을 따라 굽어 돌아가요.",
  },
  "crossing": {
    "zh-TW": "「噹噹噹」的警鈴響起、黃黑相間的遮斷桿放下來，是台灣人再熟悉不過的街景。依法規，平交道分成派人看守、自動遮斷、只立警告標誌等幾種，這座是不派人看守、靠自動警報和遮斷器運作的那一種。列車接近時紅燈閃、桿子降下，汽車和機車停在線後等，車一過桿子升起，大家再一起出發。背後是一排有騎樓的店面，早餐店、機車行、五金行的招牌都是自編的，路邊還有水塔、冷氣和一塊「停看聽」。",
    "en": "The clanging of the warning bell and the yellow-and-black barrier arms coming down are a street scene every Taiwanese person knows well. Under the regulations, level crossings come in several kinds: staffed, automatic-barrier, and those with only a warning sign. This one is unstaffed and relies on automatic alarms and barriers. As a train approaches, the red lights flash and the arms lower; cars and scooters wait behind the line, and once the train has passed the arms rise and everyone sets off together. Behind is a row of shophouses with covered walkways. The signs for the breakfast shop, scooter shop, and hardware store are all invented, and by the roadside there are a water tower, air conditioners, and a “Stop, Look, Listen” sign.",
    "ja": "「カンカンカン」と警報機が鳴り、黄色と黒の遮断桿が降りてくるのは、台湾の人にとってなじみ深い街の光景です。法規では踏切は、係員が配置されるもの、自動遮断式のもの、警告標識だけのものなどに分けられ、この場面は係員を置かず、自動警報機と遮断機で動くタイプです。列車が近づくと赤いランプが点滅して遮断桿が降り、車やバイクは線の手前で待ちます。列車が通り過ぎると遮断桿が上がり、みんな一斉に動き出します。背後にはアーケードのある商店が並び、朝食店、バイク店、金物店の看板はすべて軌島が考えたものです。道端には給水タンクとエアコンの室外機、そして「止まれ・見て・聞け」の標識もあります。",
    "ko": "‘땡땡땡’ 경보음이 울리고 노란색과 검은색이 섞인 차단기가 내려오는 것은 대만 사람에게 아주 익숙한 거리 풍경이에요. 법규상 건널목은 간수가 지키는 것, 자동 차단기, 경고 표지만 세운 것 등으로 나뉘는데, 이 장면은 간수 없이 자동 경보기와 차단기로 움직이는 종류예요. 열차가 다가오면 빨간 불이 깜박이고 차단기가 내려오며, 자동차와 오토바이는 정지선 뒤에서 기다려요. 열차가 지나가면 차단기가 올라가고 모두 함께 다시 출발해요. 뒤쪽으로는 아케이드(기루)가 있는 가게들이 늘어서 있는데, 아침식사 가게, 오토바이 가게, 철물점의 간판은 모두 직접 지어낸 이름이에요. 길가에는 물탱크와 에어컨 실외기, ‘멈추고 보고 듣기’ 표지판도 있어요.",
  },
  "guanghua": {
    "zh-TW": "台南市區的光華街有一座低矮的鐵路涵洞：上面是雙線的鐵路橋，底下一條窄巷壓低身子鑽過去，是附近居民騎機車抄近路的捷徑。2026 年 10 月台南市區鐵路改走地下，這座鐵路橋也將走入歷史。這座場景留下地下化之前的樣子：灰色混凝土翼牆帶著水漬，洞口上緣是黃黑斜紋的警示梁，機車騎士一趟趟穿過涵洞，洞口前有人舉著相機等火車從頭頂開過，四周的透天厝照著航照圖排列。",
    "en": "On Guanghua Street in downtown Tainan there is a low railway culvert. Above it is a double-track railway bridge, and below it a narrow lane ducks under, a shortcut that nearby residents take by scooter. In October 2026 the railway through downtown Tainan moves underground, and this railway bridge will pass into history. The scene keeps the way things were before the move underground: gray concrete wing walls streaked with water stains, a yellow-and-black striped warning beam across the top of the opening, and scooter riders passing through the culvert again and again. In front of the opening, people hold up cameras and wait for a train to pass overhead, and the townhouses around are laid out according to aerial photographs.",
    "ja": "台南市街の光華街には、低い鉄道のガードがあります。上は複線の鉄道橋で、下を狭い路地が身をかがめてくぐり抜け、近所の人がバイクで近道に使っています。2026年10月に台南市街の鉄道が地下に移り、この鉄道橋も歴史の幕を閉じます。この場面は地下化前の姿を残しています。灰色のコンクリートの袖壁には水のしみがあり、入口の上縁には黄色と黒の斜線の警告梁がかかっています。バイクの人が何度もガードをくぐり抜け、入口の前ではカメラを持った人が頭上を列車が通るのを待っています。周囲の間口の狭い住宅は航空写真をもとに並べました。",
    "ko": "타이난 시내 광화가에는 낮은 철도 암거가 하나 있어요. 위에는 복선 철도교가 지나가고, 그 밑으로 좁은 골목이 몸을 낮추고 빠져나가는데, 근처 주민이 오토바이로 지름길 삼아 다니는 길이에요. 2026년 10월 타이난 시내 철도가 지하로 들어가면 이 철도교도 역사 속으로 사라질 예정이에요. 이 장면은 지하화 이전의 모습을 남겼어요. 물 얼룩이 진 회색 콘크리트 날개벽, 입구 위쪽의 노란색과 검은색 사선 경고 보, 암거를 몇 번이고 지나가는 오토바이 운전자들이 있어요. 입구 앞에서는 사람들이 카메라를 들고 머리 위로 지나갈 기차를 기다려요. 주변의 타운하우스는 항공사진을 보고 그대로 배치했어요.",
  },
  "taipei-metro": {
    "zh-TW": "劍潭站是台北捷運淡水線最早一批通車的車站，1997 年啟用，站址過去是台鐵淡水線的停靠站。它最有名的是那片兩頭上翹的長屋頂，形狀像一艘龍舟，夜裡燈一亮，整片屋頂從裡面透出光來。這座場景把劍潭周邊的地標拉進同一個畫面：站前是士林夜市的街口和攤車，旁邊是北藝中心的玻璃方塊與銀色球體劇場，後方隔著基隆河，對岸山頭上是紅柱金瓦的圓山大飯店。",
    "en": "Jiantan Station opened in 1997 as one of the first stations on Taipei Metro’s Tamsui Line, on the site of a former Taiwan Railway Tamsui Line stop. It is best known for its long roof with both ends curving upward, shaped like a dragon boat, which glows from within when the lights come on at night. This scene brings the landmarks around Jiantan into one view: in front of the station are the corner of Shilin Night Market and its food carts; beside it are the glass cube and silver spherical theater of the Taipei Performing Arts Center; and behind, across the Keelung River, on the far hilltop stands the Grand Hotel with its red columns and golden tiles.",
    "ja": "剣潭駅は台北MRT淡水信義線の最初期に開業した駅の一つで、1997年に使われ始めました。敷地はかつて台湾鉄道（台鉄）淡水線の停車場でした。最も有名なのは両端が反り上がった長い屋根で、形がドラゴンボートに似ており、夜に明かりがつくと屋根全体が内側から光ります。この場面は剣潭周辺のランドマークを一つの画面に集めています。駅前には士林夜市の入口と屋台があり、隣には台北パフォーミングアーツセンターのガラスの箱と銀色の球体劇場が見え、基隆河をはさんだ対岸の山の上には、赤い柱と金色の瓦の圓山大飯店が建っています。",
    "ko": "젠탄역은 타이베이 MRT 단수이선의 첫 개통 구간 역 가운데 하나로, 1997년에 문을 열었어요. 이 자리는 예전에 대만철도 단수이선의 정차역이었어요. 가장 유명한 것은 양 끝이 위로 치켜 올라간 긴 지붕으로, 모양이 용선(용주)을 닮았고 밤에 불이 켜지면 지붕 전체가 안쪽에서 빛나요. 이 장면은 젠탄 주변의 랜드마크를 한 화면에 모았어요. 역 앞에는 스린 야시장 입구와 포장마차가 있고, 옆에는 타이베이 퍼포밍아츠센터의 유리 큐브와 은빛 구형 극장이 있어요. 뒤쪽으로 지룽강을 사이에 둔 건너편 산 위에는 붉은 기둥에 금빛 기와를 얹은 위안산 대반점이 보여요.",
  },
  "wenhu": {
    "zh-TW": "動物園站是文湖線的南端終點。文湖線的前身木柵線 1996 年通車，是台北捷運最早營運的路線，列車用膠輪行駛、全程無人駕駛。2007 年起，貓空纜車也從站旁出發，一路吊上種茶的貓空山頭。這座場景把木柵的招牌都放了進來：高架月台的淺拱屋頂和全高月台門，站前動物園大門裡有兩隻長頸鹿和一頭大象，貓空纜車的彩色車廂掛在纜線上，後山是一排排茶樹。",
    "en": "Taipei Zoo Station is the southern terminus of the Wenhu Line. Its predecessor, the Muzha Line, opened in 1996 as Taipei Metro’s first line in service; its trains run on rubber tires and are fully driverless. Since 2007 the Maokong Gondola has also started beside the station, lifting passengers up to the tea-growing hills of Maokong. The scene packs in the trademarks of Muzha: the elevated platform’s shallow arched roof and full-height platform doors, two giraffes and an elephant inside the zoo gates in front of the station, the colorful gondola cabins hanging on their cable, and rows of tea bushes on the hill behind.",
    "ja": "動物園駅は文湖線の南の終点です。文湖線の前身である木柵線は1996年に開通し、台北MRTで最初に営業を始めた路線でした。列車はゴムタイヤで走り、全区間が無人運転です。2007年からは猫空ロープウェイも駅のそばから出発し、茶畑の広がる猫空の山頂へ上っていきます。この場面には木柵の名所がすべて入っています。高架ホームの浅いアーチ屋根とフルハイトのホームドア、駅前の動物園の門の中には2頭のキリンと1頭のゾウがいて、猫空ロープウェイのカラフルなゴンドラがケーブルに下がり、裏山には茶の木が列をなしています。",
    "ko": "동물원역은 원후선의 남쪽 종점이에요. 원후선의 전신인 무자선은 1996년에 개통한 타이베이 MRT 최초의 운영 노선으로, 열차가 고무 타이어로 달리고 전 구간이 무인 운전이에요. 2007년부터는 마오콩 곤돌라도 역 옆에서 출발해 차밭이 있는 마오콩 산꼭대기까지 올라가요. 이 장면은 무자의 상징을 모두 넣었어요. 고가 승강장의 얕은 아치 지붕과 전고 승강장 스크린도어, 역 앞 동물원 정문 안의 기린 두 마리와 코끼리 한 마리, 케이블에 매달린 마오콩 곤돌라의 알록달록한 캐빈, 그리고 뒷산에 줄지어 선 찻나무가 있어요.",
  },
  "airport-mrt": {
    "zh-TW": "山鼻站在桃園蘆竹的田野間，2017 年隨桃園機場捷運通車啟用，離機場第一航廈只有兩站。站名原本預定叫「山腳」，在地居民爭取後改成現在的名字。這座場景替車站做了一片機翼剖面的屋頂，前緣一條機捷紫，玻璃站體旁是轉乘停車場；四周是一格格稻田、農舍與防風林，後方埤塘裡有荷葉和三隻白鷺鷥，天上一架客機正準備降落。",
    "en": "Shanbi Station sits among the fields of Luzhu, Taoyuan. It opened in 2017 with the Taoyuan Airport MRT and is only two stations from Terminal 1. The station was originally to be named Shanjiao, and it was renamed after local residents campaigned for its current name. The scene gives the station a roof shaped like an aircraft wing section, with an Airport MRT purple band along the leading edge, and a park-and-ride lot beside the glass station building. Around it are a patchwork of rice paddies, farmhouses, and windbreak trees. In the pond behind are lotus leaves and three egrets, and an airliner is coming in to land overhead.",
    "ja": "山鼻駅は桃園の蘆竹の田園地帯にあり、2017年に桃園空港MRTの開通とともに開業しました。空港第一ターミナルからはわずか2駅です。駅名はもともと「山腳」とする予定でしたが、地元住民の働きかけで現在の名前になりました。この場面では、駅に翼の断面を模した屋根をつけ、前縁には空港MRTの紫の線が一本入っています。ガラス張りの駅舎の隣には乗換用の駐車場があり、周囲は一枚ずつ区切られた田んぼ、農家、防風林で、奥のため池にはハスの葉と3羽の白サギがいて、空では旅客機が着陸の準備をしています。",
    "ko": "산비역은 타오위안 루주의 들판 가운데 있는 역으로, 2017년 타오위안 공항 MRT와 함께 문을 열었고 공항 제1터미널까지 두 정거장 거리예요. 역 이름은 원래 ‘산자오(山腳)’로 정해질 예정이었는데, 지역 주민이 요청해 지금의 이름으로 바뀌었어요. 이 장면에서는 역에 비행기 날개 단면 모양의 지붕을 얹었고, 앞쪽 가장자리에는 공항 MRT의 보라색 줄이 한 가닥 들어가요. 유리 역사 옆에는 환승 주차장이 있어요. 주위는 바둑판 같은 논과 농가, 방풍림이고, 뒤쪽 연못에는 연잎과 백로 세 마리가 있으며, 하늘에서는 여객기 한 대가 착륙을 준비하고 있어요.",
  },
  "ntpc-metro": {
    "zh-TW": "新北捷運三鶯線串起三峽和鶯歌，2026 年通車，陶瓷老街站就在鶯歌陶瓷老街旁。鶯歌做陶已有兩百多年，有「台灣景德鎮」之稱，老街上滿是陶藝店和窯場。這座場景替車站換上一身陶鄉的打扮：紅磚柱、拱窗站體，頂著人字形的陶瓦屋頂；站前紅磚騎樓下擺著陶器攤和大陶瓶，站後有隧道窯、方煙囪和清水混凝土的陶瓷博物館，後方山頭上立著鶯歌石。",
    "en": "New Taipei Metro’s Sanying Line links Sanxia and Yingge and opens in 2026. Ceramics Old Street Station stands right beside Yingge Ceramics Old Street. Yingge has made pottery for more than 200 years and is called the “Jingdezhen of Taiwan”; the old street is lined with pottery shops and kilns. The scene dresses the station in the style of a pottery town: red brick columns, a station building with arched windows, and a pitched clay-tile roof. Under the red brick arcade in front are stalls of pottery and big ceramic jars. Behind the station are a tunnel kiln, a square chimney, and a raw-concrete ceramics museum, and on the hill beyond stands Yingge Rock.",
    "ja": "新北MRT三鶯線は三峡と鶯歌を結ぶ路線で、2026年に開通しました。陶瓷老街駅は鶯歌の陶瓷老街のすぐそばにあります。鶯歌は200年以上にわたって陶器を作ってきた町で、「台湾の景徳鎮」と呼ばれ、老街には陶芸店や窯元がぎっしり並んでいます。この場面は、駅を陶器の町らしい装いにしています。赤レンガの柱とアーチ窓の駅舎に、切妻の陶瓦の屋根をのせました。駅前の赤レンガのアーケードの下には陶器の露店と大きな壺が置かれ、駅の裏にはトンネル窯、四角い煙突、打ち放しコンクリートの陶瓷博物館があり、奥の山の上には鶯歌石が立っています。",
    "ko": "신베이 MRT 싼잉선은 싼샤와 잉거를 잇는 노선으로 2026년에 개통했고, 도자기 옛 거리역은 잉거 도자기 옛 거리 바로 옆에 있어요. 잉거는 200년 넘게 도자기를 구워 와서 ‘대만의 징더전’이라고 불리고, 옛 거리에는 도예 가게와 가마터가 가득해요. 이 장면은 역을 도자기 마을 차림으로 바꿨어요. 붉은 벽돌 기둥과 아치 창이 있는 역사 위에 맞배 모양의 도기와 지붕을 얹었어요. 역 앞 붉은 벽돌 아케이드 아래에는 도기 노점과 큰 항아리가 놓여 있고, 역 뒤에는 터널 가마와 네모난 굴뚝, 노출 콘크리트로 지은 도자기박물관이 있어요. 뒤쪽 산꼭대기에는 잉거 바위가 서 있어요.",
  },
  "ntpc-lrt": {
    "zh-TW": "淡海輕軌是新北市第一條輕軌，2018 年綠山線先通車，2020 年 11 月藍海線接著開到淡水漁人碼頭，通車典禮就辦在這一站。這座場景把漁人碼頭的風景收進來：輕軌在草皮軌道上跑，月台上方是白色波浪雨棚；站前漁港停著漁船，單支斜塔的情人橋跨過港池，岸邊木棧道通往情人塔，左岸是白牆藍瓦的海鮮餐廳，後方是海景飯店和山丘。",
    "en": "The Danhai Light Rail is New Taipei’s first light rail. The Green Mountain Line opened first in 2018, and in November 2020 the Blue Coast Line followed, reaching Tamsui Fisherman’s Wharf, where the opening ceremony was held at this very station. The scene brings in the scenery of Fisherman’s Wharf: light rail trains run on grass track under a white wave-shaped canopy over the platform. In front of the station, fishing boats are moored in the harbor, the single-pylon Lover’s Bridge spans the basin, and a boardwalk along the shore leads to Lover’s Tower. On the left bank is a seafood restaurant with white walls and blue tiles, with a seaside hotel and hills behind.",
    "ja": "淡海ライトレールは新北市で最初のライトレールで、2018年に緑山線が先に開通し、2020年11月に藍海線が淡水漁人碼頭まで延びました。開通式はこの駅で行われました。この場面には漁人碼頭の風景が収められています。ライトレールは芝生の軌道を走り、ホームの上には白い波形の屋根がかかっています。駅前の漁港には漁船が停まり、一本の斜めの塔を持つ情人橋が港の水面をまたいでいて、岸の木のデッキは情人塔へ続きます。左岸には白壁に青い瓦のシーフードレストランがあり、奥にはオーシャンビューのホテルと丘が見えます。",
    "ko": "단하이 경전철은 신베이시 최초의 경전철이에요. 2018년에 뤼산선이 먼저 개통했고, 2020년 11월에 란하이선이 단수이 어인부두까지 이어졌으며, 개통식도 이 역에서 열렸어요. 이 장면은 어인부두의 풍경을 담았어요. 경전철은 잔디 궤도 위를 달리고, 승강장 위에는 하얀 물결 모양 캐노피가 있어요. 역 앞 어항에는 어선이 정박해 있고, 주탑이 하나인 비스듬한 연인교가 항구 수면을 가로지르며, 물가 목재 데크는 연인탑으로 이어져요. 왼쪽 기슭에는 흰 벽에 파란 기와를 얹은 해산물 식당이 있고, 뒤쪽에는 오션뷰 호텔과 언덕이 있어요.",
  },
  "taichung-metro": {
    "zh-TW": "台中捷運綠線是台中第一條捷運，2021 年 4 月正式營運，文心森林公園站就緊鄰同名公園和公園裡的圓滿戶外劇場。這座場景的車站頂著一片白色弧形大屋頂，把月台和軌道一起罩住，底下一排樹枝狀的柱子撐著；站前是公園裡的圓形劇場，白色殼頂下有舞台和扇形草坡看台，旁邊有荷葉水池和涼亭，環內是透天厝和小學操場，後方一排住宅大樓。",
    "en": "Taichung Metro’s Green Line is Taichung’s first metro line and began regular service in April 2021. Wenxin Forest Park Station sits right next to the park of the same name and the Yuanman Outdoor Theater inside it. The station in this scene wears a large white curved roof that covers the platform and tracks together, held up by a row of tree-branch-shaped columns. In front of the station is the park’s round amphitheater, with a stage under a white shell roof and fan-shaped grass seating. Beside it are a lotus pond and a pavilion. Inside the loop are townhouses and a primary school playground, and a row of apartment towers stands behind.",
    "ja": "台中メトロ緑線は台中で最初のMRTで、2021年4月に正式に営業を始めました。文心森林公園駅は、同名の公園とその中にある圓滿戸外劇場のすぐ隣にあります。この場面の駅は、白い弧を描く大きな屋根がホームと線路をまとめて覆い、その下を枝のような形の柱が一列に支えています。駅前は公園の円形劇場で、白い殻状の屋根の下に舞台と扇形の芝生の観覧席があります。隣にはハスの葉の浮かぶ池とあずまやがあり、環の内側には間口の狭い住宅と小学校のグラウンド、奥には住宅ビルが並んでいます。",
    "ko": "타이중 MRT 그린라인은 타이중 최초의 도시철도로 2021년 4월에 정식 운영을 시작했어요. 원신삼림공원역은 같은 이름의 공원과 그 안의 위안만 야외극장 바로 옆에 있어요. 이 장면의 역은 승강장과 선로를 함께 덮는 흰색 곡면 대형 지붕을 이고 있고, 그 밑에서 나뭇가지 모양 기둥들이 줄지어 받치고 있어요. 역 앞은 공원 안의 원형 극장으로, 흰 쉘 지붕 밑에 무대와 부채꼴 잔디 관람석이 있어요. 옆에는 연잎 연못과 정자가 있고, 순환선 안쪽은 타운하우스와 초등학교 운동장이며 뒤쪽에는 주거용 고층 건물이 줄지어 있어요.",
  },
  "kaohsiung-metro": {
    "zh-TW": "美麗島站是高雄捷運紅線與橘線交會的轉乘站，2008 年啟用。大廳頂上的「光之穹頂」由義大利藝術家水仙大師（Narcissus Quagliata）花了四年半完成，曾被國外旅遊網站評為全球最美的地鐵站之一。這座場景把地下車站切開來看：兩股紅線穿過月台，牆上另有橘線的隧道口；大廳中央四根柱子撐起彩色玻璃穹頂（圖案是軌島自己排的色塊），街面上有四座像雙手合十的玻璃出入口，遠方是 85 大樓。",
    "en": "Formosa Boulevard Station is the interchange where Kaohsiung Metro’s Red and Orange Lines cross, and it opened in 2008. The “Dome of Light” above the concourse was made by Italian artist Narcissus Quagliata over four and a half years, and a foreign travel website once ranked it among the most beautiful metro stations in the world. The scene cuts the underground station open: two red-line tracks pass through the platform, and the wall also has the tunnel mouth of the Orange Line. In the middle of the concourse, four columns hold up a stained-glass dome (the pattern is Railisland’s own arrangement of colored blocks). At street level are four glass entrances shaped like hands pressed together in prayer, and the 85 Sky Tower stands in the distance.",
    "ja": "美麗島駅は高雄メトロの紅線と橘線が交わる乗換駅で、2008年に開業しました。コンコースの天井にある「光之穹頂（光のドーム）」は、イタリア人アーティストのナルシサス・クアグリアータ（Narcissus Quagliata）が4年半かけて完成させたもので、海外の旅行サイトで世界で最も美しい地下鉄駅の一つに選ばれたこともあります。この場面は地下駅を断面にして見せています。2本の紅線がホームを通り抜け、壁には橘線のトンネル口もあります。コンコースの中央では4本の柱がステンドグラスのドームを支えていて（模様は軌島が独自に並べた色の面です）、地上には両手を合わせたような形のガラスの出入口が4つあり、遠くには85ビルが見えます。",
    "ko": "메이리다오역은 가오슝 MRT 레드라인과 오렌지라인이 만나는 환승역으로 2008년에 문을 열었어요. 대합실 천장의 ‘빛의 돔’은 이탈리아 예술가 나르키소스 콰글리아타(Narcissus Quagliata)가 4년 반에 걸쳐 완성했고, 해외 여행 사이트에서 세계에서 가장 아름다운 지하철역 중 하나로 꼽힌 적이 있어요. 이 장면은 지하 역을 단면으로 잘라 보여 줘요. 레드라인 두 가닥이 승강장을 지나가고, 벽에는 오렌지라인의 터널 입구가 따로 있어요. 대합실 한가운데에서는 기둥 네 개가 스테인드글라스 돔을 받치고 있는데, 무늬는 궤도섬이 직접 배열한 색 블록이에요. 지상에는 두 손을 모은 듯한 유리 출입구 네 곳이 있고, 멀리 85 타워가 보여요.",
  },
  "kaohsiung-lrt": {
    "zh-TW": "高雄輕軌是台灣第一條輕軌，2015 年開始營運，2024 年元旦繞成完整的環狀線。為了不讓電線切過市區景觀，它沿線不架電車線，列車停靠車站時充電再出發。駁二大義站 2017 年通車，就在港邊舊倉庫改成的駁二藝術特區。場景裡，鐵皮屋頂的大義倉庫一字排開，草地上擺著貨櫃堆、紅色圓環雕塑和鋼板機器人；碼頭邊停著貨輪，右後方是一群白色六角塔，舊調車場還留著幾節老貨車。",
    "en": "The Kaohsiung Light Rail is Taiwan’s first light rail. It began service in 2015 and became a complete loop on New Year’s Day 2024. So that overhead wires would not cut across the city’s views, it runs without overhead lines along its route, and trains charge while stopped at stations before setting off again. Dayi Pier-2 Station opened in 2017, beside the Pier-2 Art Center, an arts district made from old harbor warehouses. In the scene, the tin-roofed Dayi warehouses stand in a row. On the grass are stacked shipping containers, a red ring sculpture, and a steel-plate robot. A cargo ship is moored at the dock, to the right rear is a cluster of white hexagonal towers, and a few old freight cars remain in the former shunting yard.",
    "ja": "高雄ライトレールは台湾で最初のライトレールで、2015年に営業を始め、2024年の元日に環状線として全線がつながりました。街の景観を電線が横切らないよう、沿線には架線がなく、列車は駅に停まっている間に充電して出発します。駁二大義駅は2017年に開通し、港沿いの古い倉庫を改装した駁二芸術特区のすぐそばにあります。場面では、トタン屋根の大義倉庫が一列に並び、芝生にはコンテナの山、赤い円環の彫刻、鋼板のロボットが置かれています。埠頭には貨物船が停まり、右奥には白い六角形の塔が集まっていて、古い操車場には老朽化した貨車が数両残っています。",
    "ko": "가오슝 경전철은 대만 최초의 경전철로 2015년에 운행을 시작했고, 2024년 1월 1일에 완전한 순환선으로 이어졌어요. 시내 경관 위로 전선이 가로지르지 않게 하려고 노선 내내 가공선을 설치하지 않았고, 열차가 역에 정차할 때 충전하고 출발해요. 보얼다이역은 2017년에 개통했으며, 항구의 옛 창고를 개조한 보얼 예술특구 바로 옆에 있어요. 장면에는 함석 지붕의 다이 창고가 일렬로 늘어서 있고, 잔디밭에는 컨테이너 더미, 붉은 원환 조형물, 강판 로봇이 놓여 있어요. 부두에는 화물선이 정박해 있고, 오른쪽 뒤에는 흰 육각 탑 무리가 있으며, 옛 조차장에는 낡은 화차 몇 량이 남아 있어요.",
  },
  "thsr": {
    "zh-TW": "高鐵新竹站其實位在竹北六家，2007 年隨台灣高鐵通車啟用，和台鐵六家線的六家站相連。車站由建築師姚仁喜設計，大屋頂的曲線取意客家圍龍屋，也帶著晶圓的意象。場景裡的屋頂只取印象，做成一片由桅杆和拉索撐起的風帆；站前有接駁公車、計程車排班和一支大風車呼應「風城」，站後是有伯公廟和半月池的客家三合院，遠方立著三支風力發電機。",
    "en": "Taiwan High Speed Rail’s Hsinchu Station is actually in Liujia, Zhubei. It opened in 2007 with Taiwan High Speed Rail and connects to Liujia Station on the Taiwan Railway Liujia Line. The station was designed by architect C.Y. Lee, and the curve of its large roof draws on Hakka round-house roofs, while also suggesting a silicon wafer. In the scene the roof is only an impression, made as a sail held up by masts and stays. In front of the station are shuttle buses, a taxi rank, and a big windmill echoing Hsinchu’s nickname “Windy City”. Behind it is a Hakka three-sided farmhouse with a shrine to the local Earth God and a half-moon pond, and three wind turbines stand in the distance.",
    "ja": "台湾高速鉄道の新竹駅は、実は竹北の六家にあり、2007年に台湾高速鉄道の開通とともに開業しました。台鉄六家線の六家駅と接続しています。駅は建築家の姚仁喜が設計し、大屋根の曲線は客家の円楼（囲龍屋）に着想を得ていて、ウェハーのイメージも込められています。場面の屋根はイメージだけを取り入れ、マストとケーブルで支えた帆のような形にしました。駅前にはシャトルバス、タクシー乗り場、そして「風の街」にちなむ大きな風車が1基あり、駅の裏には伯公廟と半月池のある客家の三合院が建っていて、遠くには3基の風力発電機が立っています。",
    "ko": "고속철도 신주역은 사실 주베이 류자에 있고, 2007년 대만 고속철도와 함께 문을 열었으며 대만철도 류자선의 류자역과 이어져 있어요. 역은 건축가 야오런시가 설계했는데, 큰 지붕의 곡선은 객가의 원형 토루(웨이룽우)에서 뜻을 따왔고 웨이퍼의 이미지도 담고 있어요. 장면 속 지붕은 인상만 가져와 돛대와 케이블이 받치는 돛 모양으로 만들었어요. 역 앞에는 셔틀버스와 택시 대기 줄이 있고, ‘바람의 도시’를 떠올리게 하는 커다란 풍차가 하나 서 있어요. 역 뒤에는 백공묘와 반달 연못이 있는 객가 삼합원이 있고, 멀리 풍력발전기 세 기가 서 있어요.",
  },
  "hsinchu": {
    "zh-TW": "新竹車站現在的站房 1913 年完工，出自建築師松崎萬長之手，揉合巴洛克與德式哥德風格，中央鐘塔配上陡斜的屋頂，一百多年來仍天天迎送旅客，也是國定古蹟。站前的中正路一路通到迎曦門，也就是新竹的東門城。這座場景把迎曦門和一段護城河搬到廣場左前方，讓它和車站同框；廣場上有圓形花台、計程車排班和公車，四周是騎樓街屋和百貨大樓。",
    "en": "The current Hsinchu Station building was completed in 1913, designed by architect Matsugasaki Tsumunaga. It blends Baroque and German Gothic styles, with a central clock tower and steep roofs, and for more than a hundred years it has welcomed and sent off passengers every day. It is also a national historic site. Zhongzheng Road in front of the station runs straight to Yingxi Gate, the east gate of Hsinchu’s old city wall. The scene moves Yingxi Gate and a stretch of the moat to the front left of the plaza so that it shares the frame with the station. On the plaza are a round flower bed, a taxi rank, and buses, and around it are shophouses with covered walkways and a department store.",
    "ja": "新竹駅の現在の駅舎は1913年に完成し、建築家の松崎萬長の設計です。バロックとドイツ風ゴシックを融合させ、中央の時計塔に急勾配の屋根を組み合わせています。100年あまりにわたって毎日旅客を迎え送り、国定古蹟にもなっています。駅前の中正路は迎曦門、つまり新竹の東門まで一直線に続いています。この場面では、迎曦門と一部の堀を広場の左手前に移して、駅と同じ画面に収めました。広場には円形の花壇、タクシー乗り場、バスがあり、周囲にはアーケードのある町屋と百貨店のビルが並んでいます。",
    "ko": "신주역의 현재 역사는 1913년에 완공되었고 건축가 마쓰가사키 쓰무나가의 작품이에요. 바로크와 독일 고딕 양식을 섞었으며, 중앙 시계탑에 가파른 지붕을 얹어 100년 넘게 매일 승객을 맞고 보내고 있고 국가지정 고적이기도 해요. 역 앞 중정로는 신주의 동문성인 잉시먼까지 곧장 이어져요. 이 장면은 잉시먼과 해자 일부를 광장 왼쪽 앞으로 옮겨 와 역과 한 화면에 담았어요. 광장에는 원형 화단과 택시 대기 줄, 버스가 있고, 주변은 아케이드가 있는 상가 건물과 백화점 빌딩이에요.",
  },
  "tainan": {
    "zh-TW": "台南車站的第二代站房 1936 年落成，兩層樓的外觀簡潔大方，二樓曾經是台南鐵道飯店的客房和餐廳，現在是國定古蹟。2026 年 10 月台南市區鐵路改走地下，列車從此在地底進出，老站房則保存下來進行修復。這座場景留住它還在地面迎送火車的模樣：站前是圓環和噴水池，左邊是像成大榕園那樣的老榕樹，街邊種著鳳凰木，右邊是一排騎樓街屋。",
    "en": "The second-generation Tainan Station building was completed in 1936. Its two-story exterior is simple and dignified, and the second floor used to hold the rooms and restaurant of the Tainan Railway Hotel. It is now a national historic site. In October 2026 the railway through downtown Tainan moves underground, so trains will come and go below ground, and the old station building will be preserved and restored. The scene keeps it as it looked when it still welcomed trains at ground level: in front of the station are a traffic circle and a fountain; on the left is an old banyan tree like those of the Banyan Garden at National Cheng Kung University; flame trees line the street; and on the right is a row of shophouses with covered walkways.",
    "ja": "台南駅の二代目駅舎は1936年に完成しました。2階建ての外観はすっきりと品があり、2階はかつて台南鉄道ホテルの客室とレストランでしたが、いまは国定古蹟です。2026年10月に台南市街の鉄道が地下に移り、列車はそれ以降、地下を出入りするようになり、古い駅舎は保存されて修復が進められます。この場面は、まだ地上で列車を迎え送っていたころの姿をとどめています。駅前には円形広場と噴水があり、左側には成功大学の榕園のような古いガジュマルの木、通り沿いにはホウオウボクが植えられていて、右側にはアーケードのある町屋が一列に並んでいます。",
    "ko": "타이난역의 2대째 역사는 1936년에 완공되었어요. 2층 건물의 외관이 간결하고 단정하며, 2층은 한때 타이난 철도호텔의 객실과 식당이었고 지금은 국가지정 고적이에요. 2026년 10월 타이난 시내 철도가 지하로 들어가면서 열차는 이제 지하로 드나들게 되고, 옛 역사는 보존되어 복원 공사를 하게 돼요. 이 장면은 아직 지상에서 열차를 맞고 보내던 모습을 붙잡아 두었어요. 역 앞에는 로터리와 분수가 있고, 왼쪽에는 청궁대학 용원처럼 오래된 용나무가 있으며, 길가에는 봉황목이 심겨 있어요. 오른쪽에는 아케이드가 있는 상가 건물이 줄지어 있어요.",
  },
  "taichung-old": {
    "zh-TW": "台中舊站 1917 年落成，紅磚牆配白色飾帶，中央立著鐘塔，和總統府同屬「辰野式」風格，現在是國定古蹟。2016 年 10 月台中鐵路高架化，旁邊的新站接手營運，老站房就此退休。這座場景讓新舊兩代站在一起：前面是紅磚舊站，後方是頂著白色大拱頂的高架新站，列車在高架上進出；地面上的舊軌道留了下來，變成長滿草皮的綠空鐵道步道。",
    "en": "The old Taichung Station was completed in 1917. Its red brick walls with white trim bands and central clock tower are in the Tatsuno style, shared with the Presidential Office Building, and it is now a national historic site. In October 2016 the Taichung railway was elevated, and the new station beside it took over operations, so the old building retired. This scene puts the two generations of stations together. In front is the red-brick old station, and behind it is the elevated new station with its large white arched roof, with trains coming and going on the viaduct. The old tracks on the ground have been kept, and have become the grassy Green Park Railway Trail.",
    "ja": "旧台中駅は1917年に完成しました。赤レンガの壁に白い装飾帯が走り、中央には時計塔が立っています。総統府と同じ「辰野式」の様式で、いまは国定古蹟です。2016年10月に台中の鉄道が高架化され、隣の新駅が営業を引き継いで、古い駅舎は役目を終えました。この場面では、新旧二つの駅が並んでいます。手前は赤レンガの旧駅で、奥には白い大きなアーチ屋根の高架新駅があり、列車は高架を出入りしています。地上の古い線路は残され、芝生に覆われた緑空鉄道の遊歩道になっています。",
    "ko": "타이중 옛 역은 1917년에 완공되었어요. 붉은 벽돌 벽에 흰 띠 장식을 두르고 중앙에 시계탑을 세웠으며, 총통부와 같은 ‘다쓰노식’ 양식이라 지금은 국가지정 고적이에요. 2016년 10월 타이중 철도가 고가화되면서 옆의 신역이 운영을 이어받았고, 옛 역사는 그렇게 은퇴했어요. 이 장면은 신구 두 세대의 역을 한자리에 세웠어요. 앞에는 붉은 벽돌의 옛 역이, 뒤에는 흰색 대형 아치 지붕을 이고 있는 고가 신역이 있고 열차는 고가 위로 드나들어요. 지상의 옛 선로는 남아서 잔디가 자란 녹공철도 산책로가 되었어요.",
  },
  "chiayi": {
    "zh-TW": "嘉義車站現在的站房 1933 年完工，鋼筋混凝土造，正面門廊立著四根落地大柱，樸素又穩重。這裡也是阿里山林業鐵路的起點，林鐵的小火車從嘉義出發，一路從平地爬上高山。這座場景照站房原貌做：站邊留著一座四腳撐起的老水塔，站後的窄軌上停著紅色車身、白色車頂的林鐵小車；站前廣場有花台、計程車、機車和 YouBike，兩旁是騎樓街屋。",
    "en": "The current Chiayi Station building was completed in 1933. It is built of reinforced concrete, and four tall columns stand on the ground at its front portico, plain yet steady. It is also the starting point of the Alishan Forest Railway, whose small trains leave Chiayi and climb from the lowlands to the high mountains. The scene follows the station building’s original appearance. Beside the station is an old water tower on four legs, and on the narrow-gauge track behind it stand small forest-railway cars with red bodies and white roofs. The plaza in front has a flower bed, taxis, scooters, and YouBike, and is flanked by shophouses with covered walkways.",
    "ja": "嘉義駅の現在の駅舎は1933年に完成した鉄筋コンクリート造で、正面の車寄せには4本の大きな柱が立ち、飾り気がなく落ち着いた姿をしています。ここは阿里山森林鉄道の起点でもあり、森林鉄道の小さな列車は嘉義から出発して、平地から高山まで登っていきます。この場面は駅舎のもとの姿に合わせて作ってあります。駅のそばには四本脚で支えた古い給水塔が残り、駅の裏の狭軌線路には、赤い車体に白い屋根の森林鉄道の小さな車両が停まっています。駅前広場には花壇、タクシー、バイク、YouBikeがあり、両側にはアーケードのある町屋が並んでいます。",
    "ko": "자이역의 현재 역사는 1933년에 완공된 철근 콘크리트 건물로, 정면 현관에 바닥부터 솟은 큰 기둥 네 개가 서 있어서 소박하면서도 묵직해요. 이곳은 아리산 임업철도의 출발점이기도 해서, 임철의 작은 열차가 자이에서 출발해 평지에서 고산까지 올라가요. 이 장면은 역사 원래 모습대로 만들었어요. 역 옆에는 다리 네 개로 받친 오래된 급수탑이 남아 있고, 역 뒤 협궤 선로에는 빨간 차체에 흰 지붕을 얹은 임철 소형 열차가 서 있어요. 역 앞 광장에는 화단, 택시, 오토바이, YouBike가 있고 양옆은 아케이드가 있는 상가 건물이에요.",
  },
  "baoan": {
    "zh-TW": "保安車站在台南仁德，1909 年遷到現址，木造站房是台南市定古蹟。站名來自村裡的保安宮，1962 年才改成現在的名字。從「永康」站買到「保安」站的車票，連起來念就是「永保安康」，成了大家搶著收藏的祝福車票。這座場景裡，站前有紅底的「永保安康」紀念牌和木長椅，路旁一排大王椰子，站後是稻田、甘蔗田和農舍。",
    "en": "Bao’an Station is in Rende, Tainan. It moved to its present site in 1909, and its wooden station building is a municipal historic site of Tainan. The station takes its name from the Bao’an Temple in the village, and received its current name only in 1962. A ticket from Yongkang Station to Bao’an Station reads “Yong Bao An Kang” when put together, which means “forever safe and healthy”, and it became a blessing ticket that everyone wants to collect. In the scene, in front of the station are a red commemorative sign reading “Yong Bao An Kang” and a wooden bench. A row of royal palms lines the road, and behind the station are rice paddies, sugarcane fields, and farmhouses.",
    "ja": "保安駅は台南の仁徳にあり、1909年に現在の場所へ移りました。木造の駅舎は台南市の市定古蹟です。駅名は村の保安宮に由来し、1962年に現在の名前に改められました。「永康」駅から「保安」駅までの切符を買うと、つなげて読むと「永保安康（いつまでも安らかで健やかに）」になり、みんなが集めたがる縁起のよい切符になりました。この場面では、駅前に赤地の「永保安康」記念プレートと木の長いベンチがあり、道沿いにはダイオウヤシが並んでいます。駅の裏には田んぼ、サトウキビ畑、農家が広がっています。",
    "ko": "바오안역은 타이난 런더에 있고, 1909년에 지금의 자리로 옮겼어요. 목조 역사는 타이난시 지정 고적이에요. 역 이름은 마을의 바오안궁에서 왔고, 1962년에야 지금의 이름으로 바뀌었어요. ‘융캉(永康)’역에서 ‘바오안(保安)’역까지 가는 승차권을 사면 이어서 읽을 때 ‘융바오안캉(永保安康, 늘 평안하고 건강하길)’이 되어서, 모두가 앞다퉈 모으는 축복의 승차권이 되었어요. 이 장면에서는 역 앞에 빨간 바탕의 ‘융바오안캉’ 기념 간판과 나무 장의자가 있고, 길가에는 왕야자나무가 한 줄로 서 있어요. 역 뒤는 논과 사탕수수밭, 농가예요.",
  },
  "jiji": {
    "zh-TW": "集集線是台鐵最長的支線，1922 年通車，當年是為了運送興建日月潭水力發電廠的物資。集集車站的檜木站房 1930 年完工，是從縱貫線的舊楊梅車站拆遷過來的；1999 年九二一地震把它震得傾斜，2001 年照原貌重建。這座場景裡，單線、沒有電車線的鐵路從站後經過，站前廣場展示著一台黑色蒸汽機車和紅輪台車，馬路兩旁的大樟樹夾成綠色隧道，再過去是檳榔和香蕉園。",
    "en": "The Jiji Line is the longest branch line of Taiwan Railway. It opened in 1922, originally to carry the materials for building the Sun Moon Lake hydroelectric power plant. Jiji Station’s cypress station building was completed in 1930, moved from the old Yangmei Station on the Western Line. The 1999 Chi-Chi earthquake left it tilted, and it was rebuilt to its original appearance in 2001. In this scene a single-track railway with no overhead wires passes behind the station. The plaza in front displays a black steam locomotive and a red-wheeled handcar, large camphor trees on both sides of the road form a green tunnel, and beyond are betel nut and banana plantations.",
    "ja": "集集線は台鉄で最も長い支線で、1922年に開通しました。当時は日月潭水力発電所の建設資材を運ぶためでした。集集駅のヒノキ造りの駅舎は1930年に完成したもので、縦貫線の旧楊梅駅から移築されました。1999年の九二一大地震で傾きましたが、2001年にもとの姿どおりに再建されています。この場面では、単線で架線のない鉄道が駅の裏を通り、駅前広場には黒い蒸気機関車と赤い車輪のトロッコが展示されています。道の両側の大きなクスノキが緑のトンネルをつくり、その先にはビンロウとバナナの畑が広がっています。",
    "ko": "지지선은 대만철도에서 가장 긴 지선으로 1922년에 개통했어요. 당시 르웨탄 수력발전소를 짓는 데 쓸 물자를 나르기 위해서였지요. 지지역의 편백나무 역사는 1930년에 완공되었는데, 종관선의 옛 양메이역을 옮겨 온 것이에요. 1999년 9·21 지진으로 기울었다가 2001년에 원래 모습대로 다시 지었어요. 이 장면에서는 단선에 전차선이 없는 철도가 역 뒤로 지나가고, 역 앞 광장에는 검은색 증기기관차와 붉은 바퀴의 수레(대차)가 전시되어 있어요. 길 양옆의 큰 녹나무가 초록 터널을 이루고, 그 너머는 빈랑나무와 바나나 농원이에요.",
  },
  "dongshan": {
    "zh-TW": "冬山車站在宜蘭，1919 年設站時叫「冬瓜山」，隔年才改名冬山。2008 年改建成東部幹線第一座高架車站，一道道白色鋼拱撐起半透明的頂棚，遠看就像一座放大的瓜棚，正好呼應老地名。這座場景照著這個造型做：列車從瓜棚底下穿過，橋下是紅磚站房，站前廣場有一面五色馬賽克牆；四周是蘭陽平原的水田和農舍，後面靠著山。",
    "en": "Dongshan Station in Yilan was opened in 1919 under the name “Dongguashan”, meaning “winter melon mountain”, and was renamed Dongshan the following year. In 2008 it was rebuilt as the first elevated station on the Eastern Trunk Line, with white steel arches holding up a translucent canopy that, from afar, looks like an enlarged melon trellis, echoing the old place name. The scene follows this form: trains pass beneath the trellis, a red-brick station building lies under the bridge, and the plaza in front has a wall of five-colored mosaic. Around it are the paddies and farmhouses of the Lanyang Plain, with mountains behind.",
    "ja": "冬山駅は宜蘭にあり、1919年に設置されたときの名前は「冬瓜山」で、翌年に冬山と改められました。2008年に東部幹線で最初の高架駅に建て替えられ、白い鋼のアーチが半透明の屋根を支えていて、遠くから見ると大きくした瓜棚のようで、古い地名とよく響き合っています。この場面はその形を再現しています。列車は瓜棚の下を通り抜け、橋の下には赤レンガの駅舎があり、駅前広場には五色のモザイク壁があります。周囲は蘭陽平原の水田と農家で、後ろは山に寄りかかっています。",
    "ko": "둥산역은 이란에 있고, 1919년에 역이 생겼을 때는 ‘둥과산(冬瓜山, 동과 산)’이라고 불렀다가 이듬해 둥산으로 이름을 바꿨어요. 2008년에는 동부 간선 최초의 고가역으로 개축되었는데, 흰색 강철 아치들이 반투명 지붕을 받쳐서 멀리서 보면 확대한 오이 덩굴 시렁처럼 보이고, 옛 지명과 딱 맞아요. 이 장면은 그 모양을 따라 만들었어요. 열차가 시렁 밑을 통과하고, 다리 밑에는 붉은 벽돌 역사가 있으며, 역 앞 광장에는 다섯 가지 색 모자이크 벽이 있어요. 주변은 란양평원의 논과 농가이고, 뒤로는 산이 기대어 있어요.",
  },
  "kaohsiung-old": {
    "zh-TW": "高雄車站的舊站房 1941 年啟用，在西式樓身上加了東方式的屋頂，是少見的「帝冠式」建築。2002 年為了鐵路地下化，整棟站房被平移了 82.6 公尺，等新車站蓋好，又搬回中軸線上，成了新站的入口。這座場景把軌道層切開來看：地底下是月台和兩股鐵軌，地面上老站房旁邊是新站白色鋁板拼成的雲朵天棚；原本鐵路經過的地方，上面變成了種滿樹的綠園道。",
    "en": "The old Kaohsiung Station building opened in 1941, a rare “Imperial Crown style” building that puts an East Asian roof on a Western-style body. In 2002, for the railway undergrounding, the whole building was moved 82.6 meters. When the new station was finished, it was moved back onto the central axis and became the new station’s entrance. This scene cuts open the track level: underground are the platforms and two tracks, while above ground, beside the old station building, is the new station’s cloud-like canopy of white aluminum panels. Where the railway used to run, the surface has become a tree-lined green boulevard.",
    "ja": "高雄駅の旧駅舎は1941年に使われ始めました。西洋風の建物に東洋風の屋根をのせた、珍しい「帝冠式」建築です。2002年に鉄道の地下化のため、駅舎全体が82.6メートル移動され、新しい駅が完成すると中軸線上に戻って、新駅の入口になりました。この場面では線路の階層を断面にして見せています。地下にはホームと2本の線路があり、地上の旧駅舎の隣には、白いアルミ板を組み合わせた雲のような新駅の天蓋があります。かつて鉄道が通っていた場所は、木々の茂る緑の並木道に変わりました。",
    "ko": "가오슝역의 옛 역사는 1941년에 사용을 시작했는데, 서양식 건물 몸체 위에 동양식 지붕을 얹어서 보기 드문 ‘제관식’ 건축이에요. 2002년 철도 지하화 공사로 역사 건물 전체가 82.6m 평행 이동되었고, 새 역이 지어진 뒤 다시 중심축으로 돌아와 새 역의 출입구가 되었어요. 이 장면은 선로층을 잘라서 보여 줘요. 지하에는 승강장과 선로 두 가닥이 있고, 지상에는 옛 역사 옆으로 새 역의 흰색 알루미늄 패널이 이어 붙은 구름 모양 천막 지붕이 있어요. 철도가 지나던 자리는 나무가 가득한 녹지 산책로로 바뀌었어요.",
  },
  "haixian": {
    "zh-TW": "台鐵海線上有五座 1920 年代留下的木造小站，被稱為「海線五寶」，苗栗後龍的大山車站就是其中之一。它 1922 年開業時叫「大山腳」，1962 年才改成現在的名字，站內的台語廣播到現在還是念「大山腳」。這座場景照站房原貌做：日式木造站房旁是鄉間小廣場、雜貨店和農舍，鐵道後面是防風林、沙灘和台灣海峽，海岸線上立著三支白色風力發電機。",
    "en": "Along Taiwan Railway’s Coastal Line there are five wooden stations left from the 1920s, known as the “Five Treasures of the Coastal Line”, and Dashan Station in Houlong, Miaoli, is one of them. It opened in 1922 under the name “Dashanjiao” and was renamed only in 1962, though the Taiwanese-language announcements in the station still say “Dashanjiao” today. The scene follows the station building’s original appearance: next to the Japanese-era wooden station are a small country square, a grocery store, and farmhouses. Behind the tracks are windbreak trees, a beach, and the Taiwan Strait, and three white wind turbines stand on the coastline.",
    "ja": "台鉄の海線には、1920年代から残る木造の小さな駅が5つあり、「海線五宝」と呼ばれています。苗栗の後龍にある大山駅はその一つです。1922年に開業したときの名前は「大山腳」で、現在の名前になったのは1962年です。駅構内の台湾語のアナウンスは、いまも「大山腳」と読み上げています。この場面は駅舎のもとの姿に合わせて作ってあります。日本式の木造駅舎の隣には田舎の小さな広場、よろず屋、農家があり、線路の後ろには防風林、砂浜、台湾海峡が広がっていて、海岸線には3基の白い風力発電機が立っています。",
    "ko": "대만철도 해안선에는 1920년대에 지어져 남은 목조 간이역 다섯 곳이 있어서 ‘해안선 오보’라고 불리는데, 먀오리 허우룽의 다산역이 그중 하나예요. 1922년에 문을 열 때는 ‘다산자오(大山腳)’였다가 1962년에야 지금의 이름으로 바뀌었고, 역 안의 대만어 방송에서는 지금도 ‘다산자오’라고 불러요. 이 장면은 역사 원래 모습대로 만들었어요. 일본식 목조 역사 옆에 시골 작은 광장과 구멍가게, 농가가 있고, 철길 뒤로는 방풍림과 모래사장, 대만 해협이 이어져요. 해안선에는 흰색 풍력발전기 세 기가 서 있어요.",
  },
  "shengxing": {
    "zh-TW": "勝興車站在苗栗三義的舊山線上，1907 年先設為「十六份信號場」，後來才升格為車站。它海拔 402.326 公尺，是台鐵海拔最高的車站，站內立著「台灣鐵路最高點」的紀念碑。1998 年新山線通車後舊山線停駛，木造小站反而成了熱門景點。這座場景裡，單線、不電化的鐵道緊貼著小站，旁邊是紅磚山洞口；站前小老街掛著紅燈籠，不遠處是龍騰斷橋那樣的紅磚拱橋斷墩。",
    "en": "Shengxing Station is on the old Mountain Line in Sanyi, Miaoli. It was first set up in 1907 as the “Shiliufen signal station” and was later upgraded to a station. At 402.326 meters above sea level it is the highest station on Taiwan Railway, and a monument inside the station marks the “highest point of Taiwan’s railways”. After the new Mountain Line opened in 1998, service on the old line stopped, and the small wooden station became a popular attraction. In this scene a single, non-electrified track hugs the station, with a red-brick tunnel portal beside it. The small old street in front hangs red lanterns, and not far away stand the broken red-brick arch piers like those of the Longteng Bridge.",
    "ja": "勝興駅は苗栗の三義にある旧山線の駅で、1907年にまず「十六份信号場」として設けられ、のちに駅に昇格しました。標高は402.326メートルで、台鉄で最も標高の高い駅であり、構内には「台湾鉄道の最高地点」の記念碑が立っています。1998年に新山線が開通すると旧山線は運行を休止し、木造の小さな駅はかえって人気の観光地になりました。この場面では、単線で電化されていない線路が小さな駅に寄り添い、隣には赤レンガのトンネル口があります。駅前の小さな老街には赤い提灯が下がり、少し離れたところには龍騰断橋のような赤レンガのアーチ橋の橋脚が残っています。",
    "ko": "성싱역은 먀오리 싼이의 옛 산선에 있어요. 1907년에 먼저 ‘스류펀 신호장’으로 설치되었다가 나중에 역으로 승격되었지요. 해발 402.326m로 대만철도에서 가장 높은 역이며, 역 안에는 ‘대만 철로 최고점’ 기념비가 서 있어요. 1998년 신산선이 개통되며 옛 산선의 운행이 멈추자, 목조 간이역은 오히려 인기 명소가 되었어요. 이 장면에서는 단선에 전철화되지 않은 선로가 간이역에 바짝 붙어 있고, 옆에는 붉은 벽돌 터널 입구가 있어요. 역 앞 작은 옛 거리에는 붉은 등롱이 걸려 있고, 멀지 않은 곳에는 룽텅 단교 같은 붉은 벽돌 아치교의 끊어진 교각이 있어요.",
  },
  "taipei-under": {
    "zh-TW": "1989 年，台北市區的鐵路鑽進地底，同年啟用的台北車站有著傳統中式的大屋頂，台鐵和高鐵的月台都在地下二樓。原本地面上的鐵道拆掉後，變成貫穿市中心的市民大道。這座場景把車站切開來看：地底下是島式月台和兩股鐵軌，地面上是橘褐色大屋簷的站房（比例縮小過），站前忠孝西路有公車專用道和計程車，遠方是一排摩天大樓。",
    "en": "In 1989, the railway in downtown Taipei went underground, and Taipei Station, which opened the same year, has a traditional Chinese-style large roof, with both Taiwan Railway and High Speed Rail platforms on the second basement level. After the old above-ground tracks were removed, they became Civic Boulevard, running through the city center. This scene cuts the station open: underground are island platforms and two tracks, and above ground is the station building with its orange-brown big eaves (scaled down). In front of the station, Zhongxiao West Road has bus lanes and taxis, and a row of skyscrapers stands in the distance.",
    "ja": "1989年に台北市街の鉄道が地下に入りました。同じ年に使われ始めた台北駅は、伝統的な中国風の大屋根を持ち、台鉄と台湾高速鉄道のホームはどちらも地下2階にあります。地上にあった線路が撤去されたあとは、市の中心を貫く市民大道になりました。この場面は駅を断面にして見せています。地下には島式ホームと2本の線路があり、地上にはオレンジがかった茶色の大きな軒の駅舎が建っています（縮尺は小さくしてあります）。駅前の忠孝西路にはバス専用レーンとタクシーがあり、遠くには超高層ビルが並んでいます。",
    "ko": "1989년, 타이베이 시내 철도가 땅속으로 들어갔고 같은 해에 문을 연 타이베이역은 전통 중국식 큰 지붕을 얹었어요. 대만철도와 고속철도의 승강장은 모두 지하 2층에 있어요. 지상의 철길이 철거된 자리는 도심을 가로지르는 시민대로가 되었어요. 이 장면은 역을 단면으로 잘라서 보여 줘요. 지하에는 섬식 승강장과 선로 두 가닥이 있고, 지상에는 주황빛 갈색의 큰 처마를 가진 역사가 있는데 비율은 줄여서 만들었어요. 역 앞 중샤오시로에는 버스전용차로와 택시가 있고, 멀리 고층 빌딩이 줄지어 서 있어요.",
  },
},
cars: {
  "dr3000": {
    "zh-TW": "DR3000 是柴聯自強號家族的一員，自帶柴油引擎，不必靠電車線也能跑，在花東與北迴線上載著旅客往返台北與東部。柴聯自強號是東部幹線最早的自強號；2023 年 4 月，DR3000 和前輩 DR2800、DR2900 一起跑完最後的紀念列車，由新世代的 EMU3000 接棒。",
    "en": "The DR3000 is part of the diesel Tze-Chiang family. With its own diesel engines, it can run without overhead wires, carrying passengers between Taipei and eastern Taiwan on the Hualien–Taitung and North-Link lines. The diesel Tze-Chiang was the earliest Tze-Chiang service on the Eastern Trunk Line. In April 2023, the DR3000 ran a farewell commemorative train together with its predecessors, the DR2800 and DR2900, and the new-generation EMU3000 took over.",
    "ja": "DR3000はディーゼル自強号ファミリーの一員で、ディーゼルエンジンを自前で備えているので、架線がなくても走れ、花東線や北廻線で台北と東部を結ぶ旅客を乗せていました。ディーゼル自強号は東部幹線で最初の自強号です。2023年4月、DR3000は先輩のDR2800、DR2900とともに最後の記念列車を走らせ終え、新世代のEMU3000に役目を譲りました。",
    "ko": "DR3000은 디젤 동차 쯔창호 계열의 한 형식으로, 자체 디젤 엔진을 갖추고 있어서 전차선 없이도 달릴 수 있고, 화둥 지역과 베이후이선에서 타이베이와 동부를 오가는 승객을 태웠어요. 디젤 동차 쯔창호는 동부 간선에서 가장 먼저 도입된 쯔창호예요. 2023년 4월 DR3000은 선배 DR2800, DR2900과 함께 마지막 기념 열차를 운행했고, 신세대 EMU3000이 바통을 이어받았어요.",
  },
  "ct250": {
    "zh-TW": "CT250 是日本 C55 型客運蒸汽機車的台灣同型車，1935 和 1938 年在日本製造，一共 9 輛，當年在縱貫線上牽引旅客列車。西部幹線電氣化後，蒸汽機車退居二線，CT250 在 1982 年正式報廢。如今只留下兩輛：CT251 保存在台南，CT259 在 2011 年運回高雄，展示在舊打狗驛故事館，讓人還能近看蒸汽時代的大動輪。",
    "en": "The CT250 is Taiwan’s counterpart of Japan’s Class C55 passenger steam locomotive. 9 were built in Japan in 1935 and 1938, and they hauled passenger trains on the Western Line. After the Western Trunk Line was electrified, steam locomotives were moved to secondary duties, and the CT250 was officially scrapped in 1982. Only two remain today: the CT251 is preserved in Tainan, and the CT259 was brought to Kaohsiung in 2011 and is displayed at the Takao Railway Museum, where visitors can still see the big driving wheels of the steam age up close.",
    "ja": "CT250は日本のC55形旅客用蒸気機関車の台湾における同形機で、1935年と1938年に日本で製造され、全部で9両が作られました。当時は縦貫線で旅客列車を牽引していました。西部幹線の電化後、蒸気機関車は第一線を退き、CT250は1982年に正式に廃車となりました。現在残っているのは2両だけです。CT251は台南に保存され、CT259は2011年に高雄へ運ばれ、旧打狗駅故事館に展示されていて、蒸気時代の大きな動輪を間近に見ることができます。",
    "ko": "CT250은 일본 C55형 여객용 증기기관차의 대만 동형 차량으로, 1935년과 1938년에 일본에서 제작되었고 모두 9량이었어요. 당시 종관선에서 여객 열차를 끌었지요. 서부 간선이 전철화되면서 증기기관차는 일선에서 물러났고, CT250은 1982년에 정식으로 폐차되었어요. 지금은 두 량만 남아 있어요. CT251은 타이난에 보존되어 있고, CT259는 2011년에 가오슝으로 옮겨 와 옛 다거우역 이야기관에 전시되어 있어서, 증기 시대의 커다란 동륜을 가까이에서 볼 수 있어요.",
  },
  "fuxing": {
    "zh-TW": "復興號是台鐵的冷氣對號列車，1981 年正式定名，取「復興中華文化」之意。票價比莒光號便宜，陪許多人通勤、上學和返鄉。2010 年底它退出西部幹線，只在東部繼續服役；2022 年 3 月 29 日，最後一班正班復興號 605 次從花蓮開往樹林，畫下句點。",
    "en": "The Fu-Hsing Express was Taiwan Railway’s air-conditioned reserved-seat train, officially named in 1981, meaning “revive Chinese culture”. Fares were lower than the Chu-Kuang Express, and it accompanied many people commuting, going to school, and heading home. It left the Western Trunk Line at the end of 2010 and kept running only in the east. On March 29, 2022, the last regularly scheduled Fu-Hsing train, No. 605, ran from Hualien to Shulin, bringing it to an end.",
    "ja": "復興号は台鉄の冷房付き座席指定列車で、1981年に正式に命名されました。名前には「中華文化を復興する」という意味が込められています。運賃は莒光号より安く、多くの人の通勤、通学、帰省に寄り添ってきました。2010年末に西部幹線から退き、東部だけで運用が続きました。2022年3月29日、最後の定期復興号となる605次が花蓮から樹林へ走り、幕が下ろされました。",
    "ko": "푸싱호는 대만철도의 에어컨 좌석지정 열차로, 1981년에 정식으로 이름이 붙었어요. ‘중화 문화를 부흥한다’는 뜻을 땄지요. 요금은 쥐광호보다 저렴해서 많은 사람의 통근, 통학, 귀향길을 함께했어요. 2010년 말에 서부 간선에서 물러나 동부에서만 운행을 이어 갔고, 2022년 3월 29일 마지막 정규 푸싱호인 605열차가 화롄에서 수린으로 달리면서 막을 내렸어요.",
  },
  "emu300": {
    "zh-TW": "EMU300 是義大利製的自強號，流線型的車頭和俐落的線條，讓它有「義大利美女」的雅稱。服役三十多年後，2021 年接連故障停駛，隨後退出營運；現在只留下一輛 EMC307，保存在國家鐵道博物館。",
    "en": "The EMU300 is an Italian-built Tze-Chiang train. Its streamlined nose and clean lines earned it the nickname “Italian beauty”. After more than thirty years of service, repeated breakdowns in 2021 took it out of service, and it then retired. Today only one car, the EMC307, remains, preserved at the National Railway Museum.",
    "ja": "EMU300はイタリア製の自強号で、流線形の先頭部とすっきりした線から、「イタリアの美女」という愛称がつきました。30年あまり走ったあと、2021年に故障が相次いで運行を停止し、その後営業から退きました。現在は1両のEMC307だけが残り、国家鉄道博物館に保存されています。",
    "ko": "EMU300은 이탈리아에서 제작한 쯔창호로, 유선형 앞부분과 깔끔한 선 덕분에 ‘이탈리아 미녀’라는 애칭을 얻었어요. 30년 넘게 복무한 뒤 2021년에 잇따라 고장으로 운행이 멈췄고 이어서 영업에서 물러났으며, 지금은 EMC307 한 량만 국립철도박물관에 보존되어 있어요.",
  },
  "tengyun": {
    "zh-TW": "騰雲號是台灣最早的蒸汽機車之一，1887 年由德國 Hohenzollern 公司製造，隔年運抵台灣，在清朝巡撫劉銘傳興建的台灣第一條鐵路上服役。它一路跑到 1924 年才退休，經過修復後，現在展示在台北二二八和平紀念公園、國立臺灣博物館旁，是台灣鐵道史的起點。",
    "en": "Teng-Yun was one of Taiwan’s earliest steam locomotives. Built in 1887 by Hohenzollern of Germany, it arrived in Taiwan the following year and served on Taiwan’s first railway, built under Qing governor Liu Mingchuan. It ran until its retirement in 1924. After restoration, it is now displayed at Taipei 228 Peace Memorial Park next to the National Taiwan Museum, a starting point of Taiwan’s railway history.",
    "ja": "騰雲号は台湾で最も早い時期の蒸気機関車の一つで、1887年にドイツのHohenzollern社が製造し、翌年に台湾へ届きました。清朝の巡撫・劉銘伝が敷いた台湾初の鉄道で活躍しました。1924年まで走って引退し、修復を経て、現在は台北の二二八和平公園の、国立台湾博物館のそばに展示されています。台湾鉄道史の出発点です。",
    "ko": "텅윈호는 대만에서 가장 오래된 증기기관차 가운데 하나로, 1887년 독일 호엔촐레른사가 제작해 이듬해 대만에 도착했어요. 청나라 순무 류밍촨이 건설한 대만 최초의 철도에서 복무했지요. 1924년까지 달리다 퇴역했고, 복원을 거쳐 지금은 타이베이 2·28 평화기념공원의 국립대만박물관 옆에 전시되어 있어요. 대만 철도 역사의 출발점이에요.",
  },
  "c301": {
    "zh-TW": "C301 是台北捷運第一代的高運量電聯車。因為合約條款，車廂在美國紐約州揚克斯組裝，再漂洋過海運來台灣，被戲稱為「還沒營運就先環遊世界的列車」。它在 1997 年 3 月 28 日隨淡水線通車載客，2012 年起換上新的推進系統，至今仍在紅線上服務。",
    "en": "The C301 was the first generation of high-capacity Taipei Metro trains. Because of contract terms, the cars were assembled in Yonkers, New York, in the United States and then shipped across the ocean to Taiwan, which led to the joking description “the train that traveled around the world before it ever carried passengers”. It carried passengers from March 28, 1997, when the Tamsui Line opened. Since 2012 it has been fitted with a new propulsion system and still serves on the Red Line.",
    "ja": "C301は台北MRT初代の高運量電車です。契約条項の関係で、車両はアメリカのニューヨーク州ヨンカーズで組み立てられ、そこから海を渡って台湾へ運ばれたため、「営業前に世界を一周した列車」と冗談めかして呼ばれています。1997年3月28日に淡水線の開通とともに旅客を乗せ始めました。2012年から新しい推進システムに換装され、いまも紅線で活躍しています。",
    "ko": "C301은 타이베이 MRT 1세대 고수송량 전동차예요. 계약 조건 때문에 차량은 미국 뉴욕주 용커스에서 조립한 뒤 바다를 건너 대만으로 운반되어서, ‘운행도 하기 전에 세계 일주를 한 열차’라는 별명이 붙었어요. 1997년 3월 28일 단수이선 개통과 함께 승객을 태우기 시작했어요. 2012년부터 새 추진 시스템으로 바꿔 지금도 레드라인에서 운행하고 있어요.",
  },
  "c321": {
    "zh-TW": "C321 是行駛板南線的電聯車，1999 年 5 月 10 日投入服務。製造時車體一度在側撞測試中出現永久變形，西門子追加材料補強，所以它比 C301 還重。車頭面板是全白色，和灰色車頭的 C301、C371 很好分辨。2024 年起，它陸續換上新的推進系統。",
    "en": "The C321 is the electric multiple unit that runs on the Bannan Line. It entered service on May 10, 1999. During manufacturing, the car body once showed permanent deformation in a side-impact test, and Siemens added material to reinforce it, so it is heavier than the C301. Its front panel is all white, which makes it easy to tell apart from the C301 and C371 with their gray fronts. From 2024 it has gradually been fitted with a new propulsion system.",
    "ja": "C321は板南線を走る電車で、1999年5月10日に営業を始めました。製造時、車体が側面衝突試験で永久変形を起こしたため、シーメンスが材料を追加して補強し、C301より重くなっています。先頭の前面パネルは全面が白で、灰色の先頭部を持つC301やC371とは簡単に見分けられます。2024年から順次、新しい推進システムに換装されています。",
    "ko": "C321은 반난선을 달리는 전동차로, 1999년 5월 10일에 운행을 시작했어요. 제작 중 차체가 측면 충돌 시험에서 영구 변형된 적이 있어서 지멘스가 재료를 추가해 보강했고, 그래서 C301보다 더 무거워요. 앞면 패널이 전부 흰색이라, 회색 앞면의 C301, C371과 쉽게 구분돼요. 2024년부터 차례로 새 추진 시스템으로 교체하고 있어요.",
  },
  "c341": {
    "zh-TW": "C341 不是北捷直接買的：它是土城線的承包商大陸工程，以約新台幣 22.48 億元向西門子購買，2005 年 1 月開始在板南線營運。和 C321 的另一個差別，是車廂之間的連結風擋改成金屬蛇腹型。2022 年，北捷在它身上推出「Smart Display Metro」數位列車，讓車廂多了顯示資訊的新玩法。",
    "en": "The C341 was not bought directly by Taipei Metro: it was purchased from Siemens by Continental Engineering, the contractor of the Tucheng Line, for about NT$2.248 billion, and has run on the Bannan Line since January 2005. Another difference from the C321 is that the gangways between cars are the metal bellows type. In 2022, Taipei Metro launched the “Smart Display Metro” digital train on it, giving the cars a new way of showing information.",
    "ja": "C341は台北MRTが直接買ったものではありません。土城線の請負業者である大陸工程が、約22.48億ニュー台湾ドルでシーメンスから購入し、2005年1月に板南線で営業を始めました。C321とのもう一つの違いは、車両間の連結部の幌が金属の蛇腹型に変わっていることです。2022年には、台北MRTがこの車両で「Smart Display Metro」のデジタル列車を打ち出し、車内に情報を表示する新しい楽しみ方が加わりました。",
    "ko": "C341은 타이베이 MRT가 직접 산 것이 아니에요. 투청선 시공사인 다루 공정이 지멘스에서 약 22.48억 대만 달러에 사들였고, 2005년 1월부터 반난선에서 운행을 시작했어요. C321과의 또 다른 차이는 객차 사이를 잇는 연결 통로가 금속 주름 형태로 바뀌었다는 점이에요. 2022년에는 타이베이 MRT가 이 열차에 ‘Smart Display Metro’ 디지털 열차를 선보여, 객실에서 정보를 보여 주는 새로운 즐거움이 생겼어요.",
  },
  "c371": {
    "zh-TW": "C371 是台北捷運數量最多的電聯車，型號名稱來自當年的採購案號 CK371。2006 年起陸續上線：六節一列的行駛松山新店線與中和新蘆線，三節一列的則在新北投支線和小碧潭支線上短程來回，是許多人每天通勤都會搭到的列車。",
    "en": "The C371 is the most numerous electric multiple unit on Taipei Metro. The model name comes from the procurement case number at the time, CK371. It came online gradually from 2006: the six-car sets run on the Songshan–Xindian Line and the Zhonghe–Xinlu Line, while the three-car sets shuttle on the Xinbeitou and Xiaobitan branch lines, and it is a train many people ride on their daily commute.",
    "ja": "C371は台北MRTで最も数の多い電車です。形式名は当時の調達案件番号CK371に由来します。2006年から順次運行に入りました。6両編成は松山新店線と中和新蘆線を走り、3両編成は新北投支線と小碧潭支線を短距離で往復していて、毎日の通勤で乗る人が多い列車です。",
    "ko": "C371은 타이베이 MRT에서 가장 수가 많은 전동차예요. 형식 이름은 당시 조달 사업 번호인 CK371에서 왔어요. 2006년부터 차례로 투입되었는데, 6량 편성은 쑹산신뎬선과 중허신루선을 달리고, 3량 편성은 신베이터우 지선과 샤오비탄 지선에서 짧은 구간을 오가요. 많은 사람이 매일 출퇴근길에 타는 열차예요.",
  },
  "c381": {
    "zh-TW": "C381 是台北捷運從 C301 算起的第五款高運量電聯車，2012 年起投入服務。車頭改成較流線的圓弧造型，下緣也加上裙板。它和 C371 有多達一半的零件可以互用，現在行駛淡水信義線與松山新店線。",
    "en": "The C381 is Taipei Metro’s fifth type of high-capacity electric multiple unit counting from the C301, in service since 2012. The front has a more streamlined rounded shape, and skirts were added along the lower edge. As many as half its parts can be interchanged with the C371, and it now runs on the Tamsui–Xinyi Line and the Songshan–Xindian Line.",
    "ja": "C381は台北MRTでC301から数えて5番目の高運量電車で、2012年から運行に入りました。先頭部はより流線形の丸みのある形になり、下端にはスカートも付きました。C371とは部品の半分近くが共通で使えます。いまは淡水信義線と松山新店線を走っています。",
    "ko": "C381은 C301부터 세어 타이베이 MRT의 다섯 번째 고수송량 전동차로, 2012년부터 투입되었어요. 앞부분이 더 유선형인 둥근 호 모양으로 바뀌었고 아래쪽에는 스커트도 달렸어요. C371과는 부품의 절반이나 서로 호환되고, 지금은 단수이신이선과 쑹산신뎬선을 달려요.",
  },
  "wenhu": {
    "zh-TW": "這是文湖線的 INNOVIA APM 256 型電聯車，北捷內部稱為「370 型」，2009 年 7 月內湖線通車時引進。它主要在美國匹茲堡製造，其中 51 對在台灣的唐榮組裝。鋁合金車身、膠輪、全自動無人駕駛；車廂內高度只有 190 公分，比老前輩 VAL256 稍矮一些。",
    "en": "This is the INNOVIA APM 256 train on the Wenhu Line, which Taipei Metro internally calls the “370 type”. It was introduced when the Neihu Line opened in July 2009. It was mainly built in Pittsburgh in the United States, with 51 pairs assembled by Tang Eng in Taiwan. It has an aluminum alloy body, rubber tires, and fully automatic driverless operation. The interior height is only 190 cm, slightly lower than its predecessor, the VAL256.",
    "ja": "これは文湖線のINNOVIA APM 256形電車で、台北MRTの社内では「370型」と呼ばれています。2009年7月に内湖線が開通したときに導入されました。主にアメリカのピッツバーグで製造され、そのうち51対は台湾の唐栄で組み立てられました。アルミ合金の車体、ゴムタイヤ、全自動の無人運転で、車内の高さは190センチメートルしかなく、先輩のVAL256より少し低くなっています。",
    "ko": "이 열차는 원후선의 INNOVIA APM 256형 전동차로, 타이베이 MRT 내부에서는 ‘370형’이라고 불러요. 2009년 7월 네이후선이 개통할 때 도입되었어요. 주로 미국 피츠버그에서 제작했고, 그중 51쌍은 대만 탕룽에서 조립했어요. 알루미늄 합금 차체에 고무 타이어, 완전 자동 무인 운전이며, 객실 내부 높이는 190cm로 선배 VAL256보다 조금 낮아요.",
  },
  "val256": {
    "zh-TW": "VAL256 是台北捷運最早載客的列車，1996 年 3 月 28 日隨木柵線通車上路。名字裡的 256，來自它 2.56 公尺的車寬。它採全自動無人駕駛、使用膠輪；2009 年起配合新的號誌系統改造，2010 年底重新載客，現在仍和龐巴迪的列車一起行駛文湖線。",
    "en": "The VAL256 is the first train that carried passengers on Taipei Metro. It entered service on March 28, 1996, when the Muzha Line opened. The 256 in its name comes from its car width of 2.56 meters. It is fully automatic and driverless and uses rubber tires. Starting in 2009 it was modified to work with the new signaling system and returned to passenger service at the end of 2010, and it still runs on the Wenhu Line alongside the Bombardier trains.",
    "ja": "VAL256は台北MRTで最初に旅客を乗せた列車で、1996年3月28日に木柵線の開通とともに走り始めました。名前の256は、車幅が2.56メートルであることに由来します。全自動の無人運転でゴムタイヤを使います。2009年から新しい信号システムに合わせて改造され、2010年末に営業運転に復帰し、いまもボンバルディアの列車とともに文湖線を走っています。",
    "ko": "VAL256은 타이베이 MRT에서 가장 먼저 승객을 태운 열차로, 1996년 3월 28일 무자선 개통과 함께 운행을 시작했어요. 이름의 256은 차폭 2.56m에서 따왔어요. 완전 자동 무인 운전에 고무 타이어를 쓰며, 2009년부터 새 신호 시스템에 맞춰 개조해 2010년 말에 다시 승객을 태웠고, 지금도 봄바르디어 열차와 함께 원후선을 달려요.",
  },
  "airportlocal": {
    "zh-TW": "這是桃園機場捷運的普通車（1000 型），2017 年 3 月 2 日隨機場線通車投入服務。車廂採沿著車窗的長條座椅，站立空間多，也設有行李架，方便帶著行李的旅客。它每站都停，載著通勤族與旅客往返台北與桃園。",
    "en": "This is the commuter train of the Taoyuan Airport MRT (1000 series). It entered service on March 2, 2017, when the Airport Line opened. The cars have bench seats along the windows, leaving plenty of standing room, and luggage racks for passengers traveling with bags. It stops at every station, carrying commuters and travelers between Taipei and Taoyuan.",
    "ja": "これは桃園空港MRTの普通車（1000形）で、2017年3月2日の空港線開通とともに営業を始めました。車内は窓に沿って長いベンチシートが並んで立てるスペースが広く、荷物棚もあり、荷物を持った旅客に便利です。各駅に停まり、通勤客と旅行者を乗せて台北と桃園を往復しています。",
    "ko": "이 열차는 타오위안 공항 MRT의 보통열차(1000형)로, 2017년 3월 2일 공항선 개통과 함께 운행을 시작했어요. 객실은 창을 따라 길게 놓인 좌석이라 서서 갈 공간이 넓고, 짐칸도 있어서 짐을 든 승객이 편해요. 모든 역에 서며, 통근객과 여행객을 태우고 타이베이와 타오위안을 오가요.",
  },
  "airportexpress": {
    "zh-TW": "這是桃園機場捷運的直達車（2000 型）。車身配色以台灣特有種鳥類「紫嘯鶇」為意象；座椅橫向排列，椅背還有折疊小桌。為了爬上機場線的陡坡，每一節都有動力。",
    "en": "This is the express train of the Taoyuan Airport MRT (2000 series). Its color scheme takes inspiration from the Taiwan whistling thrush, a bird endemic to Taiwan. Seats face sideways, and the seat backs have fold-down tables. To climb the steep grades of the airport line, every car is powered.",
    "ja": "これは桃園空港MRTの直通列車（2000形）です。車体の配色は台湾固有種の鳥ルリチョウ（紫嘯鶇）をイメージしています。座席は横向きに並び、背もたれには折りたたみ式の小さなテーブルもついています。空港線の急勾配を登るため、すべての車両に動力があります。",
    "ko": "이 열차는 타오위안 공항 MRT의 급행열차(2000형)예요. 차체 색은 대만 고유종 새인 대만휘파람지빠귀를 모티프로 했어요. 좌석은 가로로 배열되어 있고, 등받이에는 접이식 작은 테이블이 달려 있어요. 공항선의 급경사를 오르기 위해 모든 객차에 동력이 있어요.",
  },
  "y100": {
    "zh-TW": "這是捷運環狀線的 610 型電聯車，2020 年 1 月 31 日隨環狀線第一階段通車投入服務。車頭參考海豚的外型，以 20 度傾斜的流線造型設計。車身以黃白色為主，另有藝術家艾曼紐・莫侯（Emmanuelle Moureaux）設計的公共藝術塗裝。",
    "en": "This is the 610 series electric multiple unit of the Circular Line. It entered service on January 31, 2020, when the first phase of the Circular Line opened. The front takes the shape of a dolphin, in a streamlined form tilted at 20 degrees. The body is mainly yellow and white, and some trains carry a public-art livery designed by the artist Emmanuelle Moureaux.",
    "ja": "これは環状線の610形電車で、2020年1月31日に環状線の第一期開通とともに営業を始めました。先頭部はイルカの姿を参考にしており、20度傾いた流線形に設計されています。車体は黄色と白が中心で、このほかアーティストのエマニュエル・ムホー（Emmanuelle Moureaux）がデザインしたパブリックアートのラッピングもあります。",
    "ko": "이 열차는 MRT 환상선의 610형 전동차로, 2020년 1월 31일 환상선 1단계 개통과 함께 운행을 시작했어요. 앞부분은 돌고래 모양을 참고해 20도 기울어진 유선형으로 설계했어요. 차체는 노랑과 흰색이 중심이고, 예술가 에마뉘엘 무로(Emmanuelle Moureaux)가 디자인한 공공 예술 래핑 차량도 따로 있어요.",
  },
  "sanying": {
    "zh-TW": "這是新北捷運三鶯線的電聯車，由日立軌道義大利設計、日本日立在山口縣下松市的笠戶工廠製造，兩節一列，共 29 列。2023 年 8 月首列從日本出發，運抵台北港後趁夜運進三峽機廠。外觀塗裝經過 2018 年票選，由「萬里藍天，悠遊峽谷」勝出；2026 年 6 月 30 日隨三鶯線通車開始載客。",
    "en": "This is the electric multiple unit of New Taipei Metro’s Sanying Line, designed by Hitachi Rail Italy and built by Hitachi at its Kasado plant in Kudamatsu, Yamaguchi, Japan, in two-car sets, with 29 trainsets. In August 2023 the first set left Japan, and after arriving at Taipei Port it was moved at night to the Sanxia depot. The livery was chosen by a vote in 2018, and “Endless Blue Skies, Cruising the Gorge” won; it began carrying passengers on June 30, 2026, when the Sanying Line opened.",
    "ja": "これは新北メトロ三鶯線の電車で、日立レールイタリアが設計し、日本の日立製作所が山口県下松市の笠戸工場で製造しました。2両編成で全部で29編成です。2023年8月に第1編成が日本を出発し、台北港に到着したあと、夜のうちに三峡車両基地へ運び込まれました。外観の塗装は2018年の投票で、「萬里藍天，悠遊峽谷（果てしない青空、峡谷をゆったりと）」が選ばれました。2026年6月30日に三鶯線の開通とともに旅客を乗せ始めました。",
    "ko": "이 열차는 신베이 MRT 싼잉선의 전동차로, 히타치 레일 이탈리아가 설계하고 일본 히타치가 야마구치현 구다마쓰시의 가사도 공장에서 제작했어요. 2량 1편성이며 모두 29편성이에요. 2023년 8월에 첫 편성이 일본에서 출발해 타이베이항에 도착한 뒤 밤을 틈타 싼샤 차량기지로 옮겨졌어요. 외관 도색은 2018년 투표를 거쳐 ‘만 리 푸른 하늘, 협곡을 거닐다’가 선정되었고, 2026년 6월 30일 싼잉선 개통과 함께 승객을 태우기 시작했어요.",
  },
  "taichung": {
    "zh-TW": "這是台中捷運綠線的電聯車，2021 年 4 月 25 日正式營運。外觀以「新芽綻放」為主題；車廂每側有 5 組車門，方便旅客快速上下車，推進系統則採用三菱電機的碳化矽（SiC）變頻器。",
    "en": "This is the electric multiple unit of Taichung Metro’s Green Line, in regular service since April 25, 2021. Its look follows the theme “new buds blooming”. Each side of a car has 5 sets of doors so passengers can get on and off quickly, and the propulsion system uses silicon carbide (SiC) inverters from Mitsubishi Electric.",
    "ja": "これは台中メトロ緑線の電車で、2021年4月25日に正式に営業を始めました。外観は「新芽が開く」をテーマにしています。車内は片側に5組のドアがあり、乗客がすばやく乗り降りできます。推進システムには三菱電機の炭化ケイ素（SiC）インバーターが使われています。",
    "ko": "이 열차는 타이중 MRT 그린라인의 전동차로, 2021년 4월 25일에 정식 운영에 들어갔어요. 외관은 ‘새싹이 피어나다’를 주제로 했어요. 객실 한쪽에 문이 5개씩 있어서 승객이 빠르게 타고 내릴 수 있고, 추진 시스템에는 미쓰비시 전기의 탄화규소(SiC) 인버터를 썼어요.",
  },
  "kaohsiung": {
    "zh-TW": "這是高雄捷運紅線與橘線的電聯車，在西門子的奧地利工廠組裝。綠白配色的不鏽鋼車身以機器人焊接，設計壽命 30 年。當年高雄車站臨時站的月台只有 66 公尺，初期只能停三節，後來運量也還沒到加長的標準，所以至今仍是三節一列。",
    "en": "This is the electric multiple unit of Kaohsiung Metro’s Red and Orange Lines, assembled by Siemens at its plant in Austria. The green-and-white stainless steel body was welded by robots and has a design life of 30 years. At the time, the platform at Kaohsiung Station’s temporary station was only 66 meters long, so at first only three cars could stop there, and later ridership never reached the level needed for lengthening, so it is still three cars per train today.",
    "ja": "これは高雄メトロの紅線と橘線の電車で、シーメンスのオーストリアの工場で組み立てられました。緑と白の配色のステンレス車体はロボットで溶接され、設計寿命は30年です。当時、高雄駅の仮駅のホームは66メートルしかなく、当初は3両までしか停められず、その後も輸送量が増備の基準に届かなかったため、いまも3両編成のままです。",
    "ko": "이 열차는 가오슝 MRT 레드라인과 오렌지라인의 전동차로, 지멘스의 오스트리아 공장에서 조립했어요. 초록과 흰색 배색의 스테인리스 차체는 로봇으로 용접했고, 설계 수명은 30년이에요. 당시 가오슝역 임시역의 승강장이 66m밖에 안 되어 초기에는 3량만 설 수 있었고, 이후에도 수송량이 증결 기준에 이르지 못해서 지금까지 3량 1편성이에요.",
  },
  "700t": {
    "zh-TW": "700T 是台灣高鐵的第一代列車，設計源自日本新幹線 700 系，T 代表 Taiwan。2007 年 1 月 5 日開始營運，是新幹線技術第一次外銷海外。每列 977 個座位，車頭比原型的 700 系短了約 1 公尺。",
    "en": "The 700T is the first generation of Taiwan High Speed Rail trains. Its design is derived from Japan’s Shinkansen 700 series, with the T standing for Taiwan. It began service on January 5, 2007, the first overseas export of Shinkansen technology. Each train has 977 seats, and the nose is about 1 meter shorter than that of the original 700 series.",
    "ja": "700Tは台湾高速鉄道の第一世代の列車で、日本の新幹線700系を原型として設計されており、Tは台湾（Taiwan）を表します。2007年1月5日に営業を始め、新幹線の技術が初めて海外に輸出された例です。1編成は977席で、先頭部は原型の700系より約1メートル短くなっています。",
    "ko": "700T는 대만 고속철도의 1세대 열차로, 일본 신칸센 700계에서 설계가 유래했고 T는 Taiwan을 뜻해요. 2007년 1월 5일에 영업을 시작했고, 신칸센 기술이 처음으로 해외에 수출된 사례예요. 한 편성은 977석이고, 앞부분은 원형인 700계보다 약 1m 짧아요.",
  },
  "dl25": {
    "zh-TW": "DL25～34 是阿里山林業鐵路的 25 噸級柴油機車，由日本新三菱重工製造，DL25～30 在 1969 年引進，DL31～34 在 1972 年引進。DL 取自英文 Diesel Locomotive 的字首，這批機車帶著林鐵告別蒸汽機車的年代。它們打破日治時期以來車頭必塗黑色的慣例，改用紅底配白線；其中 DL34 在 2023 年還出借到英國的窄軌鐵路。",
    "en": "The DL25–34 are the 25-ton diesel locomotives of the Alishan Forest Railway, built by Shin Mitsubishi Heavy Industries of Japan. DL25–30 were introduced in 1969 and DL31–34 in 1972. DL stands for the English “Diesel Locomotive”, and this batch carried the forest railway out of the steam era. They broke the custom, in place since the Japanese colonial period, that locomotives must be painted black, and instead use a red body with white stripes. In 2023, the DL34 was even lent to a narrow-gauge railway in Britain.",
    "ja": "DL25〜34は阿里山森林鉄道の25トン級ディーゼル機関車で、新三菱重工が製造しました。DL25〜30は1969年、DL31〜34は1972年に導入されています。DLは英語のDiesel Locomotiveの頭文字から取られ、このグループの機関車が、森林鉄道を蒸気機関車の時代から送り出しました。日本統治時代から続く機関車は黒に塗るという慣例を破り、赤地に白線を採用しています。そのうちDL34は2023年にイギリスの狭軌鉄道へ貸し出されました。",
    "ko": "DL25~34는 아리산 임업철도의 25톤급 디젤 기관차로, 일본 신미쓰비시중공업이 제작했어요. DL25~30은 1969년에, DL31~34는 1972년에 도입되었어요. DL은 영어 Diesel Locomotive의 머리글자에서 땄고, 이 기관차들이 임철을 증기기관차 시대와 작별하게 했어요. 일제강점기 이래 기관차는 검은색으로 칠한다는 관례를 깨고 빨간 바탕에 흰 선으로 바꾸었어요. 그중 DL34는 2023년에 영국의 협궤 철도에 대여되기도 했어요.",
  },
  "dl38": {
    "zh-TW": "DL38 是阿里山林業鐵路的柴油機車，1980 年由日本車輛製造，25 噸級、510 匹馬力，是同一代裡唯一的一輛 25 噸試作車。在它之前，主線上用的西德製機車因設計複雜、保養困難，上路沒幾年就退出主線。DL38 至今仍在服役，配屬嘉義的北門車庫。",
    "en": "The DL38 is a diesel locomotive of the Alishan Forest Railway, built by Nippon Sharyo of Japan in 1980. It is a 25-ton, 510-horsepower unit and the only 25-ton prototype of its generation. Before it, the West German locomotives used on the main line were complex in design and hard to maintain, and they were withdrawn from the main line after only a few years. The DL38 is still in service today and is based at the Beimen depot in Chiayi.",
    "ja": "DL38は阿里山森林鉄道のディーゼル機関車で、1980年に日本車輌製造が製造した25トン級、510馬力で、同じ世代の中で唯一の25トン級試作機です。これより前に本線で使われていた西ドイツ製の機関車は、設計が複雑で整備が難しく、運行を始めて数年で本線から退きました。DL38はいまも現役で、嘉義の北門車庫に配属されています。",
    "ko": "DL38은 아리산 임업철도의 디젤 기관차로, 1980년 닛폰샤료가 제작했고 25톤급, 510마력이며 같은 세대에서 유일한 25톤급 시작차예요. 그 이전에 본선에서 쓰던 서독제 기관차는 설계가 복잡하고 정비가 어려워서 운행한 지 몇 년 만에 본선에서 물러났어요. DL38은 지금도 운행 중이며, 자이의 베이먼 차고에 배속되어 있어요.",
  },
  "dl39": {
    "zh-TW": "DL39～43 是阿里山林業鐵路的 28 噸級柴油機車，1982 年由日本車輛製造，550 匹馬力。1980 年阿里山公路通車後，林鐵改推有冷氣的列車班次，這批機車因此配備了供應客車空調的電源。1984 年，林鐵第一款冷氣客車「阿里山號」開始營業。這批機車至今仍在林鐵上服役。",
    "en": "The DL39–43 are 28-ton diesel locomotives of the Alishan Forest Railway, built by Nippon Sharyo of Japan in 1982, with 550 horsepower. After the Alishan Highway opened in 1980, the forest railway began offering air-conditioned services, so this batch was equipped with a power supply for the air conditioning of the coaches. In 1984, the forest railway’s first air-conditioned coaches, the “Alishan Express”, began service. These locomotives are still in service on the forest railway today.",
    "ja": "DL39〜43は阿里山森林鉄道の28トン級ディーゼル機関車で、1982年に日本車輌製造が製造し、550馬力です。1980年に阿里山公路が開通すると、森林鉄道は冷房付き列車の運行に力を入れるようになり、この機関車には客車の空調に電力を供給する設備が備わりました。1984年には、森林鉄道初の冷房付き客車「阿里山号」が営業を始めました。この機関車たちはいまも森林鉄道で活躍しています。",
    "ko": "DL39~43은 아리산 임업철도의 28톤급 디젤 기관차로, 1982년 닛폰샤료가 제작했고 550마력이에요. 1980년 아리산 공로가 개통되자 임철은 에어컨 열차 운행을 늘렸고, 이 기관차들은 그래서 객차 에어컨에 전원을 공급하는 장치를 갖추었어요. 1984년에는 임철 최초의 에어컨 객차인 ‘아리산호’가 영업을 시작했어요. 이 기관차들은 지금도 임철에서 운행하고 있어요.",
  },
  "dl45": {
    "zh-TW": "DL45～51 是阿里山林業鐵路近年引進的柴油機車，由日本車輛製造，DL45、46 在 2006 年交車，DL47～51 在 2007 年交車並由台灣車輛組裝。30 噸級、750 匹馬力，可以推拉運轉。編號裡沒有 DL44；其中 DL46 是觀光列車栩悅號的專用機車，DL47 也換上栩悅號塗裝當備用車。",
    "en": "The DL45–51 are diesel locomotives that the Alishan Forest Railway introduced in recent years, built by Nippon Sharyo of Japan. DL45 and DL46 were delivered in 2006, and DL47–51 in 2007 and assembled by Taiwan Car. They are 30-ton, 750-horsepower units and can operate in push–pull mode. There is no DL44 in the numbering. DL46 is the dedicated locomotive for the Xuyue sightseeing train, and DL47 has also been repainted in the Xuyue livery as a spare.",
    "ja": "DL45〜51は阿里山森林鉄道が近年導入したディーゼル機関車で、日本車輌製造が製造しました。DL45、46は2006年、DL47〜51は2007年に納入され、台湾車輌が組み立てています。30トン級、750馬力で、プッシュプル運転ができます。番号にDL44はありません。そのうちDL46は観光列車「栩悦号」の専用機関車で、DL47も栩悦号の塗装に変わって予備機になっています。",
    "ko": "DL45~51은 아리산 임업철도가 최근 도입한 디젤 기관차로, 닛폰샤료가 제작했어요. DL45, 46은 2006년에 인도되었고, DL47~51은 2007년에 인도되어 대만차량이 조립했어요. 30톤급, 750마력이며 푸시풀 운전이 가능해요. 번호에 DL44는 없어요. 그중 DL46은 관광열차 쉬웨호의 전용 기관차이고, DL47도 쉬웨호 도색을 입고 예비차로 대기해요.",
  },
  "alicoach": {
    "zh-TW": "阿里山號是阿里山林業鐵路第一款裝冷氣的客車，由台北機械廠製造，1984 年 1 月 27 日開始營業，一列共有 108 個座位。阿里山公路通車後，林鐵改推舒適的冷氣列車，阿里山號從此載著一批又一批的遊客，從嘉義平原一路爬上海拔兩千多公尺的阿里山。",
    "en": "The Alishan Express was the first air-conditioned coach on the Alishan Forest Railway, built by the Taipei Machinery Factory. It began service on January 27, 1984, with 108 seats on a train. After the Alishan Highway opened, the forest railway switched to comfortable air-conditioned trains, and the Alishan Express has since carried one group of visitors after another from the Chiayi plain up to Alishan, more than 2,000 meters above sea level.",
    "ja": "阿里山号は阿里山森林鉄道で最初に冷房を備えた客車で、台北機械廠が製造し、1984年1月27日に営業を始めました。1編成の座席は108席です。阿里山公路の開通後、森林鉄道は快適な冷房付き列車に力を入れるようになり、阿里山号はそれ以来、多くの観光客を乗せて、嘉義平野から標高2,000メートル余りの阿里山まで登ってきました。",
    "ko": "아리산호는 아리산 임업철도 최초의 에어컨 객차로, 타이베이 기계공장이 제작했고 1984년 1월 27일에 영업을 시작했어요. 한 편성에 좌석이 108석이에요. 아리산 공로가 개통된 뒤 임철은 쾌적한 에어컨 열차를 선보였고, 아리산호는 그때부터 수많은 관광객을 태우고 자이 평원에서 해발 2,000m가 넘는 아리산까지 올라가고 있어요.",
  },
  "hinoki": {
    "zh-TW": "檜木列車是林務局請台灣車輛用台灣檜木打造的客車，設計參考昔日台鐵為日本皇室準備的貴賓車，2005 年完成 8 輛，同年 12 月投入服務。整節車廂以檜木打造，帶著溫潤的木頭質感；2007 年起還有蒸汽機車牽引的班次。2009 年莫拉克風災讓本線中斷後，它也在山上的沼平線運用。",
    "en": "The Cypress Train consists of coaches that the Forestry Bureau had Taiwan Car build from Taiwan cypress, with a design modeled on the VIP cars that Taiwan Railway once prepared for the Japanese imperial family. 8 cars were completed in 2005, and they entered service in December of that year. The whole car is made of cypress, with a warm wooden feel, and since 2007 some services have been hauled by steam locomotives. After Typhoon Morakot cut the main line in 2009, it was also used on the Zhaoping Line on the mountain.",
    "ja": "檜の列車は、林務局が台湾車輌に頼んで台湾ヒノキで造らせた客車で、かつて台鉄が日本の皇族のために用意した貴賓車を参考に設計されました。2005年に8両が完成し、同年12月に運行を始めています。車内全体がヒノキで造られていて、やわらかな木の質感があります。2007年からは蒸気機関車が牽引する列車も走りました。2009年の台風モーラコットの被害で本線が不通になったあとは、山上の沼平線でも使われています。",
    "ko": "편백나무 열차는 린우국(임업 관리 기관)이 대만차량에 의뢰해 대만산 편백나무로 만든 객차예요. 설계는 예전에 대만철도가 일본 황실을 위해 마련했던 귀빈차를 참고했고, 2005년에 8량이 완성되어 같은 해 12월에 운행을 시작했어요. 객차 전체를 편백나무로 만들어 따뜻한 나무 질감이 있어요. 2007년부터는 증기기관차가 끄는 운행도 있었어요. 2009년 모라꼿 태풍 피해로 본선이 끊긴 뒤에는 산 위의 자오핑선에서도 쓰였어요.",
  },
  "fushen": {
    "zh-TW": "福森號是阿里山林業鐵路新一代的檜木列車，以阿里山紅檜與扁柏在鋼構車體上打造，由台灣車輛製造，2024 年夏天啟用。一列有吧檯車廂、一般車廂等不同車廂，黑色窗框配上紅色金屬窗台，相當醒目。設計上用「木、林、森」區分低、中、高海拔的意象，由雄獅旅遊規劃行程與販售。",
    "en": "Fusen is the new generation of cypress train on the Alishan Forest Railway, built on steel-frame bodies with Alishan red cypress and Taiwan yellow cypress, made by Taiwan Car and put into service in the summer of 2024. A train has different cars, including a bar car and standard cars, and the black window frames with red metal sills are eye-catching. In the design, “wood, grove, forest” mark the low, middle, and high elevations, and Lion Travel plans and sells the itineraries.",
    "ja": "福森号は阿里山森林鉄道の新世代の檜の列車で、阿里山の紅檜とヒノキを鋼構造の車体に使って台湾車輌が製造し、2024年夏に運行を始めました。1編成にはバーカウンター車両や一般車両など、異なる車両があり、黒い窓枠に赤い金属の窓台が組み合わされていて、とても目を引きます。設計では「木・林・森」で低・中・高標高のイメージを分けており、雄獅旅遊が旅程の企画と販売を担当しています。",
    "ko": "푸선호는 아리산 임업철도의 새 세대 편백나무 열차로, 아리산 홍편백과 편백을 강철 구조 차체에 입혀 만들었어요. 대만차량이 제작해 2024년 여름에 운행을 시작했어요. 한 편성에는 바 객차, 일반 객차 등 서로 다른 객차가 있고, 검은 창틀에 붉은 금속 창턱이 눈에 확 띄어요. 설계에서는 ‘나무, 숲, 삼림’으로 저·중·고지대의 이미지를 나누었고, 슝스 여행사가 일정을 기획하고 판매해요.",
  },
  "xuyue": {
    "zh-TW": "栩悅號 Vivid Express 是阿里山林業鐵路的觀光列車，由舊的阿里山號車廂重新彩繪改裝，2024 年 5 月 24 日首航。一列 5 節車廂只有 60 個座位，有半隱私的包廂席，以及可以 360 度旋轉的瞭望席。外觀以號稱「阿里山迎賓鳥」的栗背林鴝為概念，藍白為底、點綴黃橘色，牽引它的是專用的 DL46 機車。",
    "en": "The Xuyue Vivid Express is a sightseeing train on the Alishan Forest Railway, rebuilt and repainted from old Alishan Express coaches, and it made its first run on May 24, 2024. A train of 5 cars has only 60 seats, with semi-private compartment seats and observation seats that can rotate 360 degrees. The livery is based on the collared bush robin known as the “Alishan welcome bird”, in a blue-and-white base with yellow-orange accents, and it is pulled by its dedicated DL46 locomotive.",
    "ja": "栩悦号（Vivid Express）は阿里山森林鉄道の観光列車で、古い阿里山号の車両を塗り直して改造したもので、2024年5月24日に初運行しました。1編成は5両で座席は60席しかなく、半個室のボックス席と、360度回転する展望席があります。外観は「阿里山の迎賓鳥」と呼ばれるアリサンヒタキ（栗背林鴝）をコンセプトに、青と白を基調に黄色とオレンジをあしらっています。牽引するのは専用のDL46機関車です。",
    "ko": "쉬웨호 Vivid Express는 아리산 임업철도의 관광열차로, 옛 아리산호 객차를 새로 칠하고 개조해 2024년 5월 24일에 첫 운행을 했어요. 한 편성 5량에 좌석이 60석뿐이고, 반개인 칸막이석과 360도 회전하는 전망석이 있어요. 외관은 ‘아리산의 환영 새’로 불리는 대만울새를 콘셉트로, 파랑과 흰색 바탕에 노랑과 주황색을 곁들였어요. 이 열차를 끄는 것은 전용 DL46 기관차예요.",
  },
  "danhai": {
    "zh-TW": "這是淡海輕軌的電聯車，由德國福伊特提供技術支援。造型在 2015 年票選，從「智多星」「行武者」「海精靈」三案中勝出；原本設計是黃色，設計團隊實地走訪後，改成符合淡水特色的水藍色。2018 年 12 月 23 日綠山線通車，它開始載客。",
    "en": "This is the electric multiple unit of the Danhai Light Rail, with technical support from Voith of Germany. The design was chosen by a public vote in 2015, winning over the “Zhiduoxing”, “Xingwuzhe”, and “Haijingling” proposals. It was originally designed in yellow, but after the design team visited the area, it was changed to a water blue that suits Tamsui. It began carrying passengers when the Green Mountain Line opened on December 23, 2018.",
    "ja": "これは淡海ライトレールの電車で、ドイツのフォイトが技術支援を行いました。デザインは2015年の投票で、「智多星」「行武者」「海精霊」の三案の中から選ばれました。もとは黄色の設計でしたが、デザインチームが現地を歩いたあと、淡水の特色に合う水色に改められました。2018年12月23日に緑山線が開通し、旅客を乗せ始めました。",
    "ko": "이 열차는 단하이 경전철의 전동차로, 독일 보이트가 기술을 지원했어요. 디자인은 2015년 투표에서 ‘지다오싱’, ‘싱우저’, ‘하이징링’ 세 안 가운데 선정되었어요. 처음에는 노란색 설계였는데, 디자인 팀이 현지를 답사한 뒤 단수이의 특색에 맞는 물색(청록빛 파랑)으로 바꾸었어요. 2018년 12월 23일 뤼산선이 개통하면서 승객을 태우기 시작했어요.",
  },
  "ankeng": {
    "zh-TW": "這是安坑輕軌的電聯車。車身的「光耀金」塗裝是 2018 年票選出來的，從光耀金、祥紅金、高雅紫、青翠綠四款中勝出。首列在 2021 年 9 月深夜出廠，2023 年 2 月 10 日隨安坑輕軌通車投入服務；2025 年底還有三列調去淡海輕軌支援。",
    "en": "This is the electric multiple unit of the Ankeng Light Rail. The “gold” livery was chosen by a vote in 2018, winning over four options: radiant gold, auspicious red-gold, elegant purple, and verdant green. The first set rolled out late at night in September 2021 and entered service on February 10, 2023, when the Ankeng Light Rail opened. At the end of 2025, three sets were also sent to support the Danhai Light Rail.",
    "ja": "これは安坑ライトレールの電車です。車体の「光耀金」の塗装は2018年の投票で選ばれたもので、光耀金、祥紅金、高雅紫、青翠緑の4案の中から勝ち残りました。第1編成は2021年9月の深夜に出場し、2023年2月10日に安坑ライトレールの開通とともに運行を始めています。2025年末には、3編成が淡海ライトレールの応援に回されました。",
    "ko": "이 열차는 안컹 경전철의 전동차예요. 차체의 ‘빛나는 금빛’ 도색은 2018년 투표로 정해졌는데, 빛나는 금빛, 상서로운 빨강 금빛, 우아한 보라, 푸른 초록 네 가지 중에서 선정되었어요. 첫 편성은 2021년 9월 심야에 공장을 나왔고, 2023년 2월 10일 안컹 경전철 개통과 함께 운행을 시작했어요. 2025년 말에는 세 편성이 단하이 경전철로 옮겨 지원 근무를 해요.",
  },
  "caf": {
    "zh-TW": "這是高雄環狀輕軌第一階段的 Urbos 3 型列車，是台灣第一款正式載客的輕軌列車。它不靠架空電線，而是用車上的超級電容，在停靠車站時快速充電，所以沿線看不到電線。綠白相間的塗裝，讓它有了「小綠綠」的暱稱。",
    "en": "This is the Urbos 3 train of the first phase of the Kaohsiung Circular Light Rail, the first light rail train in Taiwan to carry passengers in regular service. It does not rely on overhead wires; instead it uses on-board supercapacitors that charge quickly while the train is stopped at stations, so no wires can be seen along the route. Its green-and-white livery has earned it the nickname “Little Green Green”.",
    "ja": "これは高雄環状ライトレール第一期のUrbos 3形車両で、台湾で初めて正式に旅客を乗せたライトレール車両です。架線に頼らず、車上のスーパーキャパシタを使って、駅に停まるあいだに素早く充電するため、沿線には架線が見えません。緑と白の塗装から、「小緑緑」という愛称がつきました。",
    "ko": "이 열차는 가오슝 환상 경전철 1단계의 Urbos 3형 열차로, 대만에서 처음으로 정식 승객을 태운 경전철 열차예요. 가공 전선 없이 차량에 탑재한 슈퍼 커패시터를 써서 역에 정차하는 동안 빠르게 충전하기 때문에 노선을 따라 전선이 보이지 않아요. 초록과 흰색이 섞인 도색 덕분에 ‘작은 초록이’라는 애칭이 붙었어요.",
  },
  "citadis": {
    "zh-TW": "這是高雄環狀輕軌第二階段的 Citadis X05（305 系）列車，由中鋼得標。2020 年 11 月 2 日起，它在籬仔內到哈瑪星的路段上開始載客。黑綠色的塗裝和比較扁平的車頭，讓它有了「小黑綠」的暱稱，正好和第一階段的「小綠綠」湊成一對。",
    "en": "This is the Citadis X05 (305 series) train of the second phase of the Kaohsiung Circular Light Rail, won by China Steel. From November 2, 2020, it began carrying passengers on the section from Lizainei to Hamasen. The black-and-green livery and flatter nose have earned it the nickname “Little Black Green”, which pairs neatly with the first phase’s “Little Green Green”.",
    "ja": "これは高雄環状ライトレール第二期のCitadis X05（305系）車両で、中鋼が落札しました。2020年11月2日から、籬仔内から哈瑪星までの区間で旅客を乗せ始めました。黒と緑の塗装と、やや平たい先頭部から「小黒緑」という愛称がつき、第一期の「小緑緑」とちょうど一対になっています。",
    "ko": "이 열차는 가오슝 환상 경전철 2단계의 Citadis X05(305계) 열차로, 중국강철이 수주했어요. 2020년 11월 2일부터 리자네이에서 하마싱까지 구간에서 승객을 태우기 시작했어요. 검은 초록 도색과 비교적 납작한 앞부분 덕분에 ‘작은 검은 초록이’라는 애칭이 붙었고, 1단계의 ‘작은 초록이’와 딱 한 쌍이 돼요.",
  },
  "haifeng": {
    "zh-TW": "海風號是台鐵與雄獅旅遊合作的觀光列車，由 EMU500 通勤電聯車改造，四節車廂約 60 個座位。2024 年 12 月 7 日首航，先行駛新竹到台中的海線，2025 年 4 月起又加開南港到宜蘭的路線。馬卡龍色系的車廂以湛藍海水為設計靈感，車上供應的餐點很受歡迎，被旅客暱稱為「甜點專車」。",
    "en": "Haifeng is a sightseeing train run by Taiwan Railway in partnership with Lion Travel, converted from EMU500 commuter trains, with four cars and about 60 seats. It made its first run on December 7, 2024, first running on the Coastal Line from Hsinchu to Taichung, and from April 2025 an additional route from Nangang to Yilan was added. The macaron-colored cars are inspired by deep blue seawater, and the meals served on board are very popular, earning the train the nickname “dessert special”.",
    "ja": "海風号は台鉄と雄獅旅遊が協力した観光列車で、EMU500通勤電車を改造したものです。4両編成で、座席は約60席です。2024年12月7日に初運行し、まず新竹から台中への海線を走りました。2025年4月からは南港から宜蘭への路線も加わっています。マカロン色の車両は青い海水をデザインの着想としており、車内で提供される食事が人気で、旅客から「スイーツ専用列車」と呼ばれています。",
    "ko": "하이펑호는 대만철도와 슝스 여행사가 협력한 관광열차로, EMU500 통근 전동차를 개조했고 4량 편성에 좌석이 약 60석이에요. 2024년 12월 7일에 첫 운행을 했고, 먼저 신주에서 타이중까지 해안선을 달렸으며 2025년 4월부터는 난강에서 이란까지 노선도 추가했어요. 마카롱 색조의 객차는 짙푸른 바닷물에서 디자인 영감을 얻었고, 차 안에서 내놓는 음식이 인기가 많아서 승객들이 ‘디저트 전용 열차’라는 애칭으로 불러요.",
  },
  "shanlan": {
    "zh-TW": "山嵐號是台鐵與雄獅旅遊合作的觀光列車，和海風號一樣由 EMU500 改造，四節車廂共 60 個座位。2025 年 4 月 19 日首航，從花蓮開往池上，沿途停靠壽豐、玉里等站，穿行花東縱谷。外觀是清新的黃綠色，內裝則是深綠色；車上還有「列車共鳴室」，用香氣帶來嗅覺上的旅行體驗。",
    "en": "Shanlan is a sightseeing train run by Taiwan Railway in partnership with Lion Travel. Like Haifeng, it was converted from the EMU500, with four cars and 60 seats in all. It made its first run on April 19, 2025, from Hualien to Chishang, stopping at stations such as Shoufeng and Yuli along the way and running through the East Rift Valley. The exterior is a fresh yellow-green and the interior is dark green; the train also has a “resonance room” that offers a travel experience of scent.",
    "ja": "山嵐号は台鉄と雄獅旅遊が協力した観光列車で、海風号と同じくEMU500から改造され、4両編成で座席は合わせて60席です。2025年4月19日に初運行し、花蓮から池上へ向かい、沿線では壽豐、玉里などに停まって、花東縦谷を走り抜けます。外観はさわやかな黄緑色で、内装は深緑色です。車内には「列車共鳴室」があり、香りによって嗅覚での旅の体験を届けます。",
    "ko": "산란호는 대만철도와 슝스 여행사가 협력한 관광열차로, 하이펑호처럼 EMU500을 개조했으며 4량 편성에 좌석은 모두 60석이에요. 2025년 4월 19일에 첫 운행을 했고, 화롄에서 츠상까지 가는 길에 서우펑, 위리 등의 역에 정차하며 화둥 종곡을 가로질러 달려요. 외관은 산뜻한 연두색이고 내부는 짙은 초록색이에요. 차 안에는 ‘열차 공명실’도 있어서 향기로 후각 여행을 선사해요.",
  },
  "emu500": {
    "zh-TW": "EMU500 是台鐵的通勤電聯車，1995 年 10 月 10 日在台中車站舉行啟用典禮。西部幹線的普通車停駛後，通勤旅客就改搭這款不鏽鋼電聯車。現在多數完成機電更新繼續服役，其中兩組還改造成觀光列車海風號和山嵐號。",
    "en": "The EMU500 is a Taiwan Railway commuter electric multiple unit, and an inauguration ceremony was held at Taichung Station on October 10, 1995. After ordinary slow trains stopped running on the Western Trunk Line, commuters rode these stainless steel electric multiple units. Most have now had their electrical and mechanical systems renewed and remain in service, and two sets have been converted into the sightseeing trains Haifeng and Shanlan.",
    "ja": "EMU500は台鉄の通勤電車で、1995年10月10日に台中駅で使用開始式が行われました。西部幹線の普通列車が運休になってから、通勤客はこのステンレス製の電車に乗るようになりました。現在は多くが機電更新を終えて運行を続けており、そのうち2編成は観光列車の海風号と山嵐号に改造されました。",
    "ko": "EMU500은 대만철도의 통근 전동차로, 1995년 10월 10일 타이중역에서 운행 개시식을 열었어요. 서부 간선의 보통열차 운행이 중단된 뒤 통근객들은 이 스테인리스 전동차를 타게 되었어요. 지금은 대부분 전기·기계 부품 교체를 마치고 계속 운행하고 있으며, 그중 두 편성은 관광열차 하이펑호와 산란호로 개조되었어요.",
  },
  "emu600": {
    "zh-TW": "EMU600 是為了宜蘭線與北迴線電氣化而購入的通勤電聯車，其中兩組依合約在台灣的唐榮組裝。2001 年 12 月它投入正班營運，可以和 EMU500 連結在一起，組成更長的列車。",
    "en": "The EMU600 is a commuter electric multiple unit purchased for the electrification of the Yilan Line and the North-Link Line, two sets of which were assembled in Taiwan by Tang Eng under the contract. It entered regular service in December 2001 and can be coupled with the EMU500 to form longer trains.",
    "ja": "EMU600は宜蘭線と北廻線の電化に合わせて購入された通勤電車で、そのうち2編成は契約により台湾の唐栄で組み立てられました。2001年12月に定期運行に入り、EMU500と連結して、より長い編成を組むことができます。",
    "ko": "EMU600은 이란선과 베이후이선 전철화를 위해 구입한 통근 전동차로, 그중 두 편성은 계약에 따라 대만 탕룽에서 조립했어요. 2001년 12월에 정규 영업 운행에 들어갔고, EMU500과 연결해 더 긴 열차를 이룰 수도 있어요.",
  },
  "dr2700": {
    "zh-TW": "DR2700 是台灣第一款不鏽鋼車身的鐵路車輛，所以被叫作「白鐵仔」。它以「光華號」為名開行，在縱貫線電氣化之前，是當時台灣陸上最快的交通工具。最後一趟從玉里開到花蓮，結束近 48 年的服役。",
    "en": "The DR2700 was the first rail vehicle in Taiwan with a stainless steel body, so it was nicknamed “Bai Tie Zai” (“stainless steelie”). It ran under the name “Guanghua Express”, and before the Western Line was electrified, it was the fastest land transport in Taiwan at the time. Its last run was from Yuli to Hualien, ending nearly 48 years of service.",
    "ja": "DR2700は台湾で初めてのステンレス車体の鉄道車両なので、「白鉄仔」という愛称で呼ばれました。「光華号」の名で運行され、縦貫線の電化前には、当時の台湾の陸上交通で最も速いものでした。最後の運行は玉里から花蓮まで走り、およそ48年にわたる活躍を終えました。",
    "ko": "DR2700은 대만 최초의 스테인리스 차체 철도 차량이어서 ‘바이톄자이(백철이)’라는 애칭이 붙었어요. ‘광화호’라는 이름으로 운행했으며, 종관선이 전철화되기 전에는 당시 대만 육상에서 가장 빠른 교통수단이었어요. 마지막 운행은 위리에서 화롄까지 달리며 48년 가까운 복무를 마쳤어요.",
  },
  "dr1000": {
    "zh-TW": "DR1000 是台鐵跑支線的柴油客車，前兩輛由日本車輛製造，其餘在台灣的唐榮鐵工廠組裝。不鏽鋼車身比自強號短、也比較窄，才能配合支線的路線條件。現在平溪、內灣、集集和深澳線上，常見兩三輛連成一列，在山間小站之間來回。",
    "en": "The DR1000 is a diesel railcar that Taiwan Railway uses on branch lines. The first two were built by Nippon Sharyo of Japan, and the rest were assembled in Taiwan by Tang Eng Iron Works. The stainless steel body is shorter and narrower than the Tze-Chiang so that it fits the conditions of branch lines. Today on the Pingxi, Neiwan, Jiji, and Shen’ao lines, two or three cars are often coupled together, shuttling between small mountain stations.",
    "ja": "DR1000は台鉄の支線を走るディーゼル客車で、最初の2両は日本車輌製造が製造し、残りは台湾の唐栄鉄工廠で組み立てられました。ステンレス車体は自強号より短くて幅も狭く、支線の路線条件に合わせています。いまは平渓線、内湾線、集集線、深澳線で、2〜3両がつながって山あいの小さな駅の間を往復する姿がよく見られます。",
    "ko": "DR1000은 대만철도가 지선에서 운행하는 디젤 객차로, 앞의 두 량은 닛폰샤료가 제작했고 나머지는 대만의 탕룽 철공장에서 조립했어요. 스테인리스 차체는 쯔창호보다 짧고 폭도 좁아서 지선의 노선 조건에 맞추었어요. 지금은 핑시선, 네이완선, 지지선, 선아오선에서 두세 량을 이어 붙인 열차가 산골 간이역 사이를 오가는 모습을 흔히 볼 수 있어요.",
  },
  "dr3100": {
    "zh-TW": "DR3100 是柴聯自強號家族的一員，1998 年 8 月在東部幹線上路。2023 年起它退出西部幹線和宜蘭線，仍在東部幹線上服役，是柴聯自強號裡還在跑的一型。",
    "en": "The DR3100 is part of the diesel Tze-Chiang family. It started running on the Eastern Trunk Line in August 1998. Since 2023 it has been withdrawn from the Western Trunk Line and the Yilan Line, but it still serves on the Eastern Trunk Line, the one type of diesel Tze-Chiang still running.",
    "ja": "DR3100はディーゼル自強号ファミリーの一員で、1998年8月に東部幹線で運行を始めました。2023年から西部幹線と宜蘭線では運行を退きましたが、東部幹線ではいまも活躍していて、ディーゼル自強号の中でまだ走っている形式です。",
    "ko": "DR3100은 디젤 동차 쯔창호 계열의 한 형식으로, 1998년 8월 동부 간선에서 운행을 시작했어요. 2023년부터 서부 간선과 이란선에서 물러났지만 동부 간선에서는 여전히 운행 중이며, 디젤 동차 쯔창호 가운데 아직 달리고 있는 형식이에요.",
  },
  "emu100": {
    "zh-TW": "EMU100 是初代自強號，也是台鐵最早的電聯車。它在西部幹線電氣化的年代上路，載著旅客南來北往，被鐵道迷暱稱為「英國婆」。服役三十多年後，它在 2010 年前後退出營運，如今只剩少數車廂保存下來。",
    "en": "The EMU100 is the first-generation Tze-Chiang train, and also Taiwan Railway’s first electric multiple unit. It went into service in the years when the Western Trunk Line was electrified, carrying passengers north and south, and railfans nicknamed it the “British Lady”. After more than thirty years of service, it was withdrawn around 2010, and only a few cars are preserved today.",
    "ja": "EMU100は初代の自強号で、台鉄で最初の電車でもあります。西部幹線の電化の時代に登場し、旅客を乗せて南北を行き来しました。鉄道ファンからは「英国婆」という愛称で呼ばれています。30年あまり走ったあと、2010年前後に営業を退き、いまは一部の車両だけが保存されています。",
    "ko": "EMU100은 1세대 쯔창호이자 대만철도 최초의 전동차예요. 서부 간선이 전철화되던 시기에 투입되어 승객을 태우고 남북을 오갔고, 철도 팬들은 ‘영국 할머니’라는 애칭으로 불렀어요. 30년 넘게 복무한 뒤 2010년 전후로 영업에서 물러났고, 지금은 일부 객차만 보존되어 있어요.",
  },
  "emu1200": {
    "zh-TW": "EMU1200 是由舊款 EMU200 改造而成的自強號，由台灣車輛翻新。白色車身配上紅色下緣，是「紅斑馬」這個綽號的由來；車內設有嬰兒室，牆上還掛著壁毯。2022 年 3 月它退出服務，1207、1208 保存在潮州鐵道園區，1202 在苗栗火車頭園區。",
    "en": "The EMU1200 is a Tze-Chiang train rebuilt from the older EMU200, refurbished by Taiwan Car. The white body with a red lower edge is where the nickname “Red Zebra” comes from; inside there is a nursing room, and tapestries hang on the walls. It was withdrawn in March 2022, with the 1207 and 1208 preserved at the Chaozhou Railway Park and the 1202 at the Locomotive Park in Miaoli.",
    "ja": "EMU1200は古いEMU200を改造した自強号で、台湾車輌が改修しました。白い車体に赤い裾の組み合わせが、「赤いシマウマ」という愛称の由来です。車内には授乳室があり、壁にはタペストリーも掛かっています。2022年3月に運行を退き、1207、1208は潮州鉄道園区、1202は苗栗の火車頭園区に保存されています。",
    "ko": "EMU1200은 옛 EMU200을 개조한 쯔창호로, 대만차량이 리뉴얼했어요. 흰 차체에 붉은색 하단을 두른 모습이 ‘붉은 얼룩말’이라는 별명의 유래예요. 차 안에는 수유실이 있고 벽에는 태피스트리가 걸려 있었어요. 2022년 3월에 운행에서 물러났고, 1207, 1208은 차오저우 철도원구에, 1202는 먀오리 기관차원구에 보존되어 있어요.",
  },
  "emu700": {
    "zh-TW": "EMU700 是台鐵的區間車，最早幾組由日本車輛製造，之後由台灣車輛組裝。車廂裡有到站顯示器，告訴旅客下一站在哪裡。現在它仍配屬新竹機務段，在西部幹線的通勤時段來回穿梭。",
    "en": "The EMU700 is a Taiwan Railway local train. The first few sets were built by Nippon Sharyo of Japan, and the rest were assembled by Taiwan Car. Inside the cars are displays showing the arriving station, telling passengers where the next stop is. It is still assigned to the Hsinchu depot and shuttles back and forth on the Western Trunk Line during commuting hours.",
    "ja": "EMU700は台鉄の区間車で、最初の数編成は日本車輌製造が製造し、その後は台湾車輌が組み立てました。車内には到着駅の表示器があり、次の駅を乗客に知らせます。いまも新竹機務段に配属されていて、西部幹線の通勤時間帯に行き来しています。",
    "ko": "EMU700은 대만철도의 구간열차로, 처음 몇 편성은 닛폰샤료가 제작했고 이후에는 대만차량이 조립했어요. 객실에는 도착역 표시기가 있어서 다음 역이 어디인지 알려 줘요. 지금도 신주 기관차 사무소에 배속되어 서부 간선의 출퇴근 시간대를 오가고 있어요.",
  },
  "emu800": {
    "zh-TW": "EMU800 是 2014 年 1 月開始載客的區間車，如今是區間車與區間快車的主力之一。",
    "en": "The EMU800 is a local train that began carrying passengers in January 2014, and is now one of the mainstays of local and semi-express services.",
    "ja": "EMU800は2014年1月に旅客を乗せ始めた区間車で、いまは区間車と区間快車の主力の一つです。",
    "ko": "EMU800은 2014년 1월부터 승객을 태운 구간열차로, 지금은 구간열차와 구간쾌속열차의 주력 중 하나예요.",
  },
  "emu800r": {
    "zh-TW": "這是 EMU800 的增備車款，外型和原版幾乎一樣，車身的黃色比例變多，黃帶下方還多了一條藍帶。車廂裡也有改變：第 2 到第 7 車改成沿著車窗排列的長條座椅，博愛座也改叫「優先席」。在車庫裡，可以把它和原版 EMU800 放在一起，比比看差在哪裡。",
    "en": "This is the supplementary batch of the EMU800. Its appearance is nearly identical to the original, but the body has more yellow, with an extra blue stripe below the yellow band. The interior changed too: cars 2 to 7 now have bench seats along the windows, and the “courtesy seats” are now called “priority seats”. In the depot, you can place it next to the original EMU800 and compare the differences.",
    "ja": "これはEMU800の増備車で、外観はもとの形式とほとんど同じですが、車体の黄色の割合が増え、黄色い帯の下に青い帯がもう一本加わりました。車内にも変化があり、2号車から7号車は窓に沿った長いベンチシートに改められ、「博愛座」も「優先席」という呼び方に変わりました。ガレージでは、もとのEMU800と並べて、どこが違うか見比べることができます。",
    "ko": "이 열차는 EMU800의 추가 도입 차량으로, 외관이 원래 형식과 거의 같지만 차체의 노란색 비율이 늘었고, 노란 띠 아래에 파란 띠가 하나 더 있어요. 객실에도 변화가 있어요. 2~7호차는 창을 따라 길게 놓인 좌석으로 바뀌었고, 노약자석은 ‘우선석’으로 이름이 바뀌었어요. 차고에서는 원래 EMU800과 나란히 세워 두고 어디가 다른지 비교해 볼 수 있어요.",
  },
  "emu900": {
    "zh-TW": "EMU900 是 2021 年 4 月投入服務的區間車。外觀以「A Smiling Welcome」為設計主題，車頭的線條帶著笑意。頭尾兩節車廂設有直立式自行車架，每列最多可放 12 輛單車；車上還有粉紅色的孕婦優先座「好孕到」。",
    "en": "The EMU900 is a local train that entered service in April 2021. The look follows the design theme “A Smiling Welcome”, and the lines of the front have a hint of a smile. The first and last cars have upright bicycle racks, holding up to 12 bicycles per train, and the train also has pink priority seats for expectant mothers, called “Hao Yun Dao”, a pun on “good luck arrives”.",
    "ja": "EMU900は2021年4月に運行に入った区間車です。外観は「A Smiling Welcome」をデザインテーマにしており、先頭部の線に笑みが感じられます。先頭と最後尾の車両には立て掛け式の自転車ラックがあり、1編成で最大12台の自転車を置けます。車内にはピンク色の妊婦優先席「好孕到」もあります。",
    "ko": "EMU900은 2021년 4월에 운행을 시작한 구간열차예요. 외관은 ‘A Smiling Welcome’을 디자인 주제로 삼아 앞부분의 선에 미소가 담겨 있어요. 양 끝 객차에는 세워서 거치하는 자전거 거치대가 있어서 한 편성에 최대 12대까지 실을 수 있고, 차 안에는 ‘하오윈다오’라는 분홍색 임산부 우선석도 있어요.",
  },
  "temu1000": {
    "zh-TW": "TEMU1000 太魯閣號是傾斜式列車，2007 年 5 月以自強號身分上路。過彎時車身最多可傾斜 5 度，比一般列車快上一截，讓北迴線上的彎道也能跑得更順。名字取自花蓮的太魯閣。",
    "en": "The TEMU1000 Taroko Express is a tilting train that began service as a Tze-Chiang train in May 2007. It can tilt up to 5 degrees through curves, which makes it faster than ordinary trains and lets it run more smoothly on the curves of the North-Link Line. The name comes from Taroko in Hualien.",
    "ja": "TEMU1000太魯閣号は振り子式の列車で、2007年5月に自強号として運行を始めました。カーブでは車体が最大5度傾き、一般の列車より速く走れるので、北廻線のカーブもよりスムーズに走ることができます。名前は花蓮の太魯閣にちなんでいます。",
    "ko": "TEMU1000 타이루거호는 틸팅 열차로, 2007년 5월에 쯔창호로 운행을 시작했어요. 곡선을 지날 때 차체가 최대 5도까지 기울어서 일반 열차보다 훨씬 빠르게 달릴 수 있고, 베이후이선의 급커브도 더 부드럽게 달려요. 이름은 화롄의 타이루거에서 땄어요.",
  },
  "temu2000": {
    "zh-TW": "TEMU2000 普悠瑪號是傾斜式列車，2013 年 2 月以自強號身分營運。它用空氣彈簧讓車身在彎道微微傾斜，奔馳在北迴線與東部幹線上。名字是 2012 年全國徵名選出的，來自卑南族的語言，象徵「團結」與「集中」。",
    "en": "The TEMU2000 Puyuma Express is a tilting train that has run as a Tze-Chiang train since February 2013. It uses air springs to tilt the body slightly in curves, and runs on the North-Link Line and the Eastern Trunk Line. The name was chosen in a nationwide naming contest in 2012 and comes from the language of the Puyuma people, symbolizing “unity” and “concentration”.",
    "ja": "TEMU2000普悠瑪号は振り子式の列車で、2013年2月に自強号として営業を始めました。空気ばねによってカーブで車体をわずかに傾け、北廻線と東部幹線を駆け抜けています。名前は2012年に全国から募集して選ばれたもので、卑南族の言葉に由来し、「団結」と「集中」を表しています。",
    "ko": "TEMU2000 푸유마호는 틸팅 열차로, 2013년 2월에 쯔창호로 운행했어요. 공기 스프링으로 곡선에서 차체를 살짝 기울이며 베이후이선과 동부 간선을 달려요. 이름은 2012년 전국 공모로 정해졌고 베이난족의 말에서 왔어요. ‘단결’과 ‘집중’을 상징해요.",
  },
  "emu3000": {
    "zh-TW": "EMU3000 在 2021 年 12 月 29 日上路。設計主題是「Silent flow」，安靜流動的意象，拿下日本優良設計 BEST100、德國紅點設計獎和台灣金點設計獎。第 6 車是商務車廂「騰雲座艙」，座位排成 2+1，名字和清代的蒸汽機車騰雲號相同。",
    "en": "The EMU3000 began service on December 29, 2021. The design theme is “Silent flow”, evoking quiet motion, and it won the Good Design Award BEST100 in Japan, the Red Dot Design Award in Germany, and the Golden Pin Design Award in Taiwan. Car 6 is a business car, the “Teng-Yun Cabin”, with seats arranged 2+1, named after the Qing-era steam locomotive Teng-Yun.",
    "ja": "EMU3000は2021年12月29日に運行を始めました。デザインテーマは「Silent flow」、静かに流れるイメージで、日本のグッドデザインBEST100、ドイツのレッドドット・デザイン賞、台湾のゴールデンピン・デザイン賞を受賞しました。6号車はビジネス車両の「騰雲座艙」で、座席は2+1の配置になっており、名前は清代の蒸気機関車の騰雲号と同じです。",
    "ko": "EMU3000은 2021년 12월 29일에 운행을 시작했어요. 디자인 주제는 ‘Silent flow’로, 조용히 흐르는 이미지를 담았고 일본 굿디자인 BEST100, 독일 레드닷 디자인상, 대만 골든핀 디자인상을 받았어요. 6호차는 비즈니스 객차 ‘텅윈 좌석’으로, 좌석이 2+1로 배열되어 있고 이름은 청나라 시대 증기기관차 텅윈호와 같아요.",
  },
  "e200": {
    "zh-TW": "E200 是陪著西部幹線走進電氣化時代的電力機車。它和 E300、E400 是同一家族，外觀幾乎一樣，要看車號才分得出來。六軸六馬達的它牽引客車與貨物列車跑了四十多年，如今正由新一代的 E500 逐步接班。",
    "en": "The E200 is an electric locomotive that accompanied the Western Trunk Line into the electrification era. It belongs to the same family as the E300 and E400, and they look almost identical, so only the locomotive number can tell them apart. With six axles and six motors, it has hauled passenger and freight trains for more than forty years, and is now being gradually succeeded by the new-generation E500.",
    "ja": "E200は西部幹線が電化の時代に入るのに寄り添ってきた電気機関車です。E300、E400と同じファミリーで、外観はほとんど同じなので、車番を見ないと区別できません。6軸6モーターで、客車と貨物列車を牽引して40年あまり走り、いまは新世代のE500が順次引き継いでいます。",
    "ko": "E200은 서부 간선이 전철화 시대로 들어서는 길을 함께한 전기기관차예요. E300, E400과 같은 계열이고 외관이 거의 같아서 차량 번호를 봐야 구분돼요. 6축 6모터로 객차와 화물열차를 끌며 40년 넘게 달렸고 지금은 새 세대 E500이 차례로 이어받고 있어요.",
  },
  "e300": {
    "zh-TW": "E300 是 E200 家族的電力機車，車身外型和 E200、E400 幾乎一樣。因為沒有電動發電機組，車頭的連接線比較少，懂門道的鐵道迷就從這裡分辨。它在西部幹線上服役超過四十年，其中 E308 已靜態保存在苗栗的火車頭園區。",
    "en": "The E300 is an electric locomotive of the E200 family, and its body looks almost identical to the E200 and E400. Because it has no motor-generator set, there are fewer connecting cables on the front, which knowledgeable railfans use to tell them apart. It has served on the Western Trunk Line for more than forty years; one of them, the E308, is statically preserved at the Locomotive Park in Miaoli.",
    "ja": "E300はE200ファミリーの電気機関車で、車体の外形はE200、E400とほとんど同じです。電動発電機セットがないため、先頭部の接続線が少なく、詳しい鉄道ファンはここで見分けます。西部幹線で40年以上活躍し、そのうちE308は苗栗の火車頭園区に静態保存されています。",
    "ko": "E300은 E200 계열의 전기기관차로, 차체 외형이 E200, E400과 거의 같아요. 전동 발전기 세트가 없어서 앞부분의 연결선이 비교적 적고, 내공 있는 철도 팬들은 여기서 구분해요. 서부 간선에서 40년 넘게 복무했고, 그중 E308은 먀오리의 기관차원구에 정적 보존되어 있어요.",
  },
  "e400": {
    "zh-TW": "E400 是 E200 家族中最晚登場的一型，1980 到 1982 年間引進。它原本是三兄弟裡跑得最快的，後來多數調降為時速 110 公里。2020 年，E405 和 E417 兩輛被選為鳴日號觀光列車的專用車頭，跑出另一段新生活。",
    "en": "The E400 is the latest member of the E200 family, introduced between 1980 and 1982. It was originally the fastest of the three siblings, though most were later lowered to 110 km/h. In 2020, two of them, the E405 and E417, were chosen as the dedicated locomotives of the Future sightseeing train, giving them a new life.",
    "ja": "E400はE200ファミリーの中で最も遅く登場した形式で、1980年から1982年にかけて導入されました。もともとは3兄弟の中でいちばん速かったのですが、のちに多くが時速110キロメートルに下げられました。2020年には、E405とE417の2両が鳴日号観光列車の専用先頭車に選ばれ、新しい活躍の場を得ました。",
    "ko": "E400은 E200 계열 중 가장 늦게 등장한 형식으로, 1980년부터 1982년 사이에 도입되었어요. 원래는 세 형제 중 가장 빨랐지만 나중에 대부분 시속 110km로 낮추었어요. 2020년에는 E405와 E417 두 량이 밍르호 관광열차의 전용 기관차로 뽑혀 또 다른 새 삶을 살고 있어요.",
  },
  "mingri": {
    "zh-TW": "這是鳴日號觀光列車的專用車頭。2020 年 8 月起，台鐵選用 E405 和 E417 兩輛電力機車作為鳴日號專屬機車，和黑色車身、莒光橘線條的車廂成套出場。後來鳴日號也換上新一代的 E500 型機車牽引。老機車配上新設計，是鳴日號最有味道的組合。",
    "en": "This is the dedicated locomotive of the Future sightseeing train. From August 2020, Taiwan Railway chose two electric locomotives, the E405 and E417, as the exclusive locomotives for Future, appearing as a set with the coaches with black bodies and Chu-Kuang orange stripes. Later, Future was also pulled by the new-generation E500 locomotives. An old locomotive with a new design is the most characterful combination of Future.",
    "ja": "これは鳴日号観光列車の専用先頭車です。2020年8月から、台鉄はE405とE417の2両の電気機関車を選び、鳴日号の専用機関車として、黒い車体と莒光橙の線をあしらった客車と組にして走らせました。その後、鳴日号は新世代のE500形機関車の牽引にも変わっています。古い機関車に新しいデザインを組み合わせたこの姿が、鳴日号の最も味わい深い組み合わせです。",
    "ko": "이 기관차는 밍르호 관광열차의 전용 기관차예요. 2020년 8월부터 대만철도가 E405와 E417 두 량의 전기기관차를 밍르호 전용 기관차로 골랐고, 검은 차체에 쥐광 주황색 선을 두른 객차와 한 벌로 등장해요. 나중에 밍르호는 새 세대 E500형 기관차도 끌게 되었어요. 낡은 기관차에 새 디자인을 입힌 것이 밍르호에서 가장 멋스러운 조합이에요.",
  },
  "e500": {
    "zh-TW": "E500 是台鐵新一代的電力機車，共 88 輛，出力 3,888 千瓦、設計時速 140 公里，拿下 2023 年日本優良設計 BEST100。它正逐步接替 E200 家族，2026 年 7 月起也接手 E1000，牽引推拉式自強號；鳴日號等觀光列車同樣由它擔任車頭。",
    "en": "The E500 is Taiwan Railway’s new-generation electric locomotive, with 88 units in all. It has an output of 3,888 kW and a design speed of 140 km/h, and it won the Good Design Award BEST100 in Japan in 2023. It is gradually replacing the E200 family; from July 2026 it also took over the E1000’s work, hauling push–pull Tze-Chiang trains, and sightseeing trains such as Future are also led by it.",
    "ja": "E500は台鉄の新世代の電気機関車で、全部で88両あります。出力は3,888キロワット、設計速度は時速140キロメートルで、2023年の日本のグッドデザインBEST100も受賞しています。E200ファミリーを順次引き継いでいて、2026年7月からはE1000の仕事も引き受け、プッシュプル式の自強号を牽引しています。鳴日号などの観光列車でも、同じく先頭車を務めます。",
    "ko": "E500은 대만철도의 새 세대 전기기관차로 모두 88량이에요. 출력은 3,888kW, 설계 속도는 시속 140km이고 2023년 일본 굿디자인 BEST100도 받았어요. E200 계열을 차례로 대체하고 있으며, 2026년 7월부터는 E1000의 일도 이어받아 푸시풀 쯔창호를 끌고, 밍르호 같은 관광열차의 기관차 역할도 맡아요.",
  },
  "e1000": {
    "zh-TW": "E1000 是推拉式自強號頭尾的電力機車，中間夾著韓國現代精工製造的客車，1996 年中秋假期開始載客。流線型的車頭在當年相當新潮。2026 年 7 月 1 日改點後，它退出定期營運，轉為預備車，由 E500 接手牽引。",
    "en": "The E1000 is the electric locomotive at the ends of the push–pull Tze-Chiang, with coaches made by Hyundai Precision of Korea in between, and they began carrying passengers over the Mid-Autumn Festival holiday in 1996. The streamlined nose was quite fashionable at the time. After the timetable change on July 1, 2026, it left regular service and became a standby unit, with the E500 taking over hauling.",
    "ja": "E1000はプッシュプル式自強号の前後につく電気機関車で、その間に韓国の現代精工が製造した客車をはさんで、1996年の中秋の連休に旅客を乗せ始めました。流線形の先頭部は当時とても斬新でした。2026年7月1日のダイヤ改正で定期運行から退き、予備車に回り、E500が牽引を引き継ぎました。",
    "ko": "E1000은 푸시풀 쯔창호의 앞뒤를 맡는 전기기관차로, 그 사이에 한국 현대정공이 만든 객차를 끼우고 1996년 추석 연휴에 승객을 태우기 시작했어요. 유선형 앞부분은 당시에는 꽤 세련된 모습이었어요. 2026년 7월 1일 시간표 개정 이후 정기 운행에서 물러나 예비차가 되었고 E500이 견인을 이어받았어요.",
  },
  "r200": {
    "zh-TW": "R200 是台鐵最新的柴電機車，2024 年 6 月在花蓮站舉行首航見面會。車上裝有 4G 故障回傳系統，維修人員能即時掌握狀況。它將接替 R20、R100、R150 等老機車，負責貨運與救援等任務。",
    "en": "The R200 is Taiwan Railway’s newest diesel-electric locomotive, and a first-run presentation was held at Hualien Station in June 2024. It carries a 4G fault-reporting system so maintenance staff can follow its condition in real time. It will take over from older locomotives such as the R20, R100, and R150, handling freight, rescue, and other duties.",
    "ja": "R200は台鉄で最も新しいディーゼル電気機関車で、2024年6月に花蓮駅で初運行のお披露目会が開かれました。4G故障通報システムを備えているので、整備担当者が状況をリアルタイムで把握できます。R20、R100、R150などの古い機関車を引き継ぎ、貨物輸送や救援などの任務を担当する予定です。",
    "ko": "R200은 대만철도의 가장 새로운 디젤전기 기관차로, 2024년 6월 화롄역에서 첫 운행 공개 행사를 열었어요. 4G 고장 전송 시스템을 갖추어 정비 요원이 상태를 실시간으로 파악할 수 있어요. R20, R100, R150 같은 낡은 기관차를 이어받아 화물 수송과 구원 등의 임무를 맡을 예정이에요.",
  },
  "r20": {
    "zh-TW": "R20 是台鐵最早實用化的柴電機車，在蒸汽機車逐漸退場的年代撐起了客貨運輸。其中 R21 被列為文化保存車，R50 則在 1991 年牽引了東勢線最後一班客運列車。",
    "en": "The R20 was the first diesel-electric locomotive that Taiwan Railway put into practical use. It carried passenger and freight traffic in the years when steam locomotives were gradually retiring. The R21 has been designated as a cultural preservation locomotive, and the R50 hauled the last passenger train on the Dongshi Line in 1991.",
    "ja": "R20は台鉄で最初に実用化されたディーゼル電気機関車で、蒸気機関車が次第に姿を消していく時代に、旅客と貨物の輸送を支えました。そのうちR21は文化保存車に指定され、R50は1991年に東勢線の最後の旅客列車を牽引しました。",
    "ko": "R20은 대만철도에서 가장 먼저 실용화된 디젤전기 기관차로, 증기기관차가 서서히 물러나던 시기에 여객과 화물 수송을 떠받쳤어요. 그중 R21은 문화 보존 차량으로 지정되었고, R50은 1991년 둥스선의 마지막 여객열차를 끌었어요.",
  },
  "r100": {
    "zh-TW": "R100 是為了開行莒光號而引進的柴電機車，1970 年 2 月 3 日第一班莒光號就是由它牽引出發。它只有單邊駕駛室，後來也成為台鐵訓練新進司機員的駕駛訓練車。退役的 R100 有些保存了下來，像是台中鐵道文化園區的 R111、車埕的 R114。",
    "en": "The R100 is a diesel-electric locomotive introduced to run the Chu-Kuang Express. The first Chu-Kuang Express on February 3, 1970, was hauled by one of them. It has a cab at one end only, and later also became a driver training locomotive for new Taiwan Railway drivers. Some retired R100s have been preserved, such as the R111 at the Taichung Railway Cultural Park and the R114 at Checheng.",
    "ja": "R100は莒光号を走らせるために導入されたディーゼル電気機関車です。1970年2月3日の最初の莒光号は、この機関車が牽引して出発しました。運転台は片側だけで、のちに台鉄が新人運転士を訓練するための運転訓練車にもなりました。退役したR100の一部は保存されており、台中鉄道文化園区のR111、車埕のR114などがあります。",
    "ko": "R100은 쥐광호 운행을 위해 도입된 디젤전기 기관차예요. 1970년 2월 3일 첫 쥐광호는 바로 이 기관차가 끌고 출발했어요. 운전실이 한쪽에만 있고, 나중에는 대만철도가 신입 기관사를 가르치는 운전 훈련차로도 쓰였어요. 퇴역한 R100 중 일부는 보존되어 있는데, 타이중 철도문화원구의 R111과 처청의 R114가 그 예예요.",
  },
  "blue": {
    "zh-TW": "這是牽引藍皮解憂號的 R100 型柴電機車，換回早年的海軍藍塗裝，配上同樣是藍色的復古客車，在南迴線上奔馳。藍皮解憂號每天往返枋寮與台東，車窗可以打開，讓旅客吹著太平洋的海風，慢慢看山看海。",
    "en": "This is the R100-class diesel-electric locomotive that hauls the Breezy Blue train. Repainted in the early navy blue livery and paired with vintage coaches in the same blue, it runs on the South Link Line. The Breezy Blue makes a round trip between Fangliao and Taitung every day, and its windows can be opened so that passengers can feel the Pacific sea breeze and take in the mountains and sea at a slow pace.",
    "ja": "これは藍皮解憂号を牽引するR100形ディーゼル電気機関車で、昔のネイビーブルーの塗装に戻され、同じく青いレトロ客車と組んで南廻線を走っています。藍皮解憂号は毎日、枋寮と台東を往復し、窓を開けられるので、乗客は太平洋の海風を受けながら、山と海をゆっくり眺められます。",
    "ko": "이 기관차는 브리지 블루 열차를 끄는 R100형 디젤전기 기관차로, 옛 네이비 블루 도색으로 돌아가 같은 파란색의 복고 객차와 함께 남회선을 달려요. 브리지 블루는 매일 팡랴오와 타이둥을 왕복하며, 창문을 열 수 있어서 승객이 태평양 바닷바람을 맞으며 느긋하게 산과 바다를 바라볼 수 있어요.",
  },
  "dhl100": {
    "zh-TW": "DHL100 是台鐵的調車機車，專門在車站和機務段裡推拉車廂、編組列車，用來取代老舊的調車機車。",
    "en": "The DHL100 is a Taiwan Railway shunting locomotive, used to push and pull cars and assemble trains in stations and depots, to replace the aging shunting locomotives.",
    "ja": "DHL100は台鉄の入換機関車で、駅や機務段の中で車両を押したり引いたりして、列車を編成するための機関車です。古くなった入換機関車の置き換えに使われました。",
    "ko": "DHL100은 대만철도의 입환 기관차로, 역과 기관차 사무소에서 객차를 밀고 끌어 열차를 편성하는 일을 전담하며, 낡은 입환 기관차를 대체하는 데 쓰였어요.",
  },
  "juguang": {
    "zh-TW": "莒光號是 1970 年 2 月 3 日開行的對號特快車，第一班從台北開往台中，由 R100 柴電機車牽引。名字取自「毋忘在莒」；首班票價 117 元，是普通車的三倍。早期是白底淺藍塗裝，電氣化後改成橘色加白線。2026 年 7 月改點後只剩 7 個班次，預計 2028 年底前全數退役。",
    "en": "The Chu-Kuang Express was a reserved-seat express train that began running on February 3, 1970. The first service ran from Taipei to Taichung, hauled by an R100 diesel-electric locomotive. The name comes from the saying “Never forget Ju”. The fare for the first service was NT$117, three times that of an ordinary train. In the early days it had a white-and-light-blue livery, which became orange with a white stripe after electrification. After the timetable change in July 2026, only 7 services remain, and all are expected to be retired by the end of 2028.",
    "ja": "莒光号は1970年2月3日に運行を始めた座席指定の特急列車で、最初の列車は台北から台中へ向かい、R100ディーゼル電気機関車が牽引しました。名前は「毋忘在莒」から取られています。最初の運賃は117元で、普通車の3倍でした。初期は白地に水色の塗装で、電化後はオレンジ色に白線へ変わりました。2026年7月のダイヤ改正後は7本だけが残り、2028年末までにすべて退役する見込みです。",
    "ko": "쥐광호는 1970년 2월 3일에 운행을 시작한 좌석지정 특급열차로, 첫 열차는 타이베이에서 타이중으로 달렸고 R100 디젤전기 기관차가 끌었어요. 이름은 ‘毋忘在莒(거 땅을 잊지 말자)’에서 땄어요. 첫 열차 요금은 117위안으로 보통열차의 세 배였어요. 초기에는 흰 바탕에 연한 파랑 도색이었고, 전철화 이후 주황색에 흰 선으로 바뀌었어요. 2026년 7월 시간표 개정 이후 7개 운행만 남았고 2028년 말까지 전량 퇴역할 예정이에요.",
  },
  "ppcoach": {
    "zh-TW": "這是推拉式自強號裡的 40PPD2500 型車廂。它原本是由廠商經營的速簡餐車，幾個月後就因虧損解約。",
    "en": "This is the 40PPD2500 coach in the push–pull Tze-Chiang train. It was originally a quick-snack buffet car run by a contractor, but the contract was ended after a few months because of losses.",
    "ja": "これはプッシュプル式自強号の40PPD2500形客車です。もとは簡易食堂車として業者が運営していましたが、数か月後に赤字で契約を解除されました。",
    "ko": "이 객차는 푸시풀 쯔창호의 40PPD2500형이에요. 원래는 간편 식당차로 업체가 운영했지만 몇 달 만에 적자로 계약이 해지되었어요.",
  },
  "bluecoach": {
    "zh-TW": "藍皮解憂號的客車，前身是南迴線上的普快車。2020 年 12 月普快車停駛後，車廂送到屏東南州整修，2021 年 10 月 23 日以觀光列車重新上路，由雄獅旅行社經營，每天往返枋寮與台東一趟。車窗可以打開、車頂掛著老電扇、座椅是綠色的，外觀也恢復早年的「浪漫藍」，重溫吹著海風的慢車時光。",
    "en": "The coaches of the Breezy Blue train were formerly the ordinary slow trains on the South Link Line. After the slow trains stopped running in December 2020, the cars were sent to Nanzhou, Pingtung, for refurbishment. On October 23, 2021, they returned as a sightseeing train, run by Lion Travel, making one round trip between Fangliao and Taitung every day. The windows can be opened, old ceiling fans hang from the roof, and the seats are green. The exterior has also been restored to the early “romantic blue”, to relive the slow-train days with the sea breeze.",
    "ja": "藍皮解憂号の客車で、前身は南廻線の普快車です。2020年12月に普快車の運行が止まったあと、車両は屏東の南州に送られて整備され、2021年10月23日に観光列車として再出発しました。雄獅旅行社が運営し、毎日、枋寮と台東を1往復します。窓は開けることができ、天井には古い扇風機がかかり、座席は緑色で、外観も昔の「ロマンチックブルー」に戻され、海風を受けながらゆっくり走る各駅停車の時間を味わえます。",
    "ko": "브리지 블루의 객차로, 전신은 남회선의 보통열차였어요. 2020년 12월 보통열차 운행이 중단된 뒤 객차는 핑둥 난저우로 보내져 정비를 받았고, 2021년 10월 23일에 관광열차로 다시 달리기 시작했어요. 슝스 여행사가 운영하며 매일 팡랴오와 타이둥을 한 번 왕복해요. 창문을 열 수 있고, 천장에는 옛 선풍기가 달려 있으며, 좌석은 초록색이에요. 외관도 옛 ‘낭만 블루’로 돌아가, 바닷바람을 맞으며 달리던 완행열차의 시간을 다시 느끼게 해요.",
  },
  "mingricoach": {
    "zh-TW": "鳴日號的客車由舊車廂改造而成，柏成設計操刀、台灣車輛施工，2019 年 11 月出廠，2020 年底首航。車廂分成商務車、餐車和客廳車，座位寬敞，可以邊用餐邊看窗外風景。黑色車身配上莒光橘，夕景車廂拿下 2020 年日本優良設計獎。現在由雄獅旅遊營運，以套裝行程帶旅客搭火車遊台灣。",
    "en": "The coaches of Future were converted from old cars, designed by Pocheng Design and built by Taiwan Car. They rolled out in November 2019 and made their first run at the end of 2020. The train is divided into business cars, a dining car, and lounge cars, with roomy seats, so you can look at the scenery outside while you dine. The black body with Chu-Kuang orange won the Good Design Award in Japan in 2020 for its sunset-themed cars. It is now operated by Lion Travel, taking passengers around Taiwan by train on package tours.",
    "ja": "鳴日号の客車は古い車両を改造したもので、柏成設計が手がけ、台湾車輌が施工し、2019年11月に出場し、2020年末に初運行しました。車両はビジネス車、食堂車、リビング車に分かれ、座席はゆったりしていて、食事をしながら窓の外の景色を楽しめます。黒い車体に莒光橙があしらわれ、夕景車両は2020年の日本のグッドデザイン賞を受賞しました。いまは雄獅旅遊が運営しており、パッケージツアーで乗客を台湾の鉄道旅行へ案内します。",
    "ko": "밍르호의 객차는 옛 객차를 개조한 것으로, 바이청 디자인이 설계하고 대만차량이 시공해 2019년 11월에 출고되었으며 2020년 말에 첫 운행을 했어요. 객차는 비즈니스석, 식당차, 거실차로 나뉘고 좌석이 널찍해서 식사를 하며 창밖 풍경을 볼 수 있어요. 검은 차체에 쥐광 주황색을 더했고, 석양 객차는 2020년 일본 굿디자인상을 받았어요. 지금은 슝스 여행사가 운영하며 패키지 상품으로 승객을 태우고 기차로 대만을 여행해요.",
  },
  "ck124": {
    "zh-TW": "CK124 屬於 CK120 型水櫃式蒸汽機車，是日本 C12 型的台灣同型車，由日本車輛製造，1936 年引進，同型共 7 輛，現在只剩它一輛。1979 年電氣化後停駛，經過修復，在 2001 年 6 月 9 日重新復駛。它平時保存在彰化扇形車庫，2012 年與 JR 北海道的 C11 171 締結為姊妹車，也在電影《KANO》的殺青影片中亮相。",
    "en": "The CK124 belongs to the CK120 class of tank steam locomotives and is Taiwan’s counterpart of Japan’s Class C12. Built by Nippon Sharyo of Japan, it was introduced in 1936. There were 7 in the class, and it is now the only one left. It was taken out of service after electrification in 1979, and after restoration it returned to service on June 9, 2001. It is normally kept at the Changhua roundhouse. In 2012 it was twinned with JR Hokkaido’s C11 171 as a sister locomotive, and it also appeared in the wrap-up video of the film “KANO”.",
    "ja": "CK124はCK120形タンク式蒸気機関車に属し、日本のC12形の台湾における同形機で、日本車輌製造が製造し、1936年に導入されました。同形は全部で7両ありましたが、いま残っているのはこの1両だけです。1979年の電化後に運行を止めましたが、修復を経て、2001年6月9日に運行を再開しました。普段は彰化の扇形車庫に保存されており、2012年にはJR北海道のC11 171と姉妹機の提携を結び、映画『KANO』のクランクアップ映像にも登場しました。",
    "ko": "CK124는 CK120형 탱크식 증기기관차에 속하며, 일본 C12형의 대만 동형 차량이에요. 닛폰샤료가 제작해 1936년에 도입했고, 같은 형식은 모두 7량이었는데 지금은 이 한 량만 남았어요. 1979년 전철화로 운행이 멈췄다가 복원을 거쳐 2001년 6월 9일에 다시 달리기 시작했어요. 평소에는 장화 부채꼴 기관고에 보존되어 있고, 2012년에는 JR 홋카이도의 C11 171과 자매 기관차를 맺었으며, 영화 《KANO》의 종영 영상에도 등장했어요.",
  },
  "dt668": {
    "zh-TW": "DT668 屬於 DT650 型蒸汽機車，是日本 D51 型的台灣同型車，同型共 37 輛，在 1939 到 1951 年間陸續製造。DT668 在 1984 年停用後，曾在屏東麟洛運動公園展示；2010 年整修，2011 年 11 月 11 日配合內灣線復駛重新上路，2018 年還到南迴線出巡。同型車目前只留下四輛。",
    "en": "The DT668 belongs to the DT650 class of steam locomotives and is Taiwan’s counterpart of Japan’s Class D51. There were 37 in the class, built between 1939 and 1951. After the DT668 was taken out of use in 1984, it was displayed at Linluo Sports Park in Pingtung. It was refurbished in 2010 and returned to the rails on November 11, 2011, to coincide with the return of the Neiwan Line, and in 2018 it even toured the South Link Line. Only four of the class remain today.",
    "ja": "DT668はDT650形蒸気機関車に属し、日本のD51形の台湾における同形機で、同形は全部で37両あり、1939年から1951年にかけて次々に製造されました。DT668は1984年に使用を止めたあと、屏東の麟洛運動公園で展示されていました。2010年に整備され、2011年11月11日に内湾線の運行再開に合わせて再び走り出し、2018年には南廻線にも遠征しました。同形機で現在残っているのは4両だけです。",
    "ko": "DT668은 DT650형 증기기관차에 속하며, 일본 D51형의 대만 동형 차량이에요. 같은 형식은 모두 37량으로 1939년부터 1951년 사이에 차례로 제작되었어요. DT668은 1984년 운행을 멈춘 뒤 핑둥 린뤄 운동공원에 전시되었고, 2010년에 정비해 2011년 11월 11일 네이완선 복선 운행에 맞추어 다시 달렸으며, 2018년에는 남회선 순회 운행도 했어요. 같은 형식 차량은 현재 네 량만 남아 있어요.",
  },
  "ct273": {
    "zh-TW": "CT273 屬於 CT270 型蒸汽機車，是日本 C57 型的台灣同型車，1942 到 1953 年間共引進 14 輛。它外形修長，有「貴婦人」與「蒸汽機車女王」的美名，最高時速可達 100 公里。1979 年縱貫線電氣化後停用，2014 年鐵路節重新復駛；近年每到暑假，會以「仲夏寶島號」行駛在臺東線上。",
    "en": "The CT273 belongs to the CT270 class of steam locomotives and is Taiwan’s counterpart of Japan’s Class C57. 14 were introduced between 1942 and 1953. With its slender shape, it is known as the “Lady” and the “Queen of Steam Locomotives”, with a top speed of up to 100 km/h. It was taken out of use after the Western Line was electrified in 1979 and returned to service on Railway Day in 2014. In recent years, every summer vacation it runs on the Taitung Line as the “Midsummer Treasure Island Express”.",
    "ja": "CT273はCT270形蒸気機関車に属し、日本のC57形の台湾における同形機で、1942年から1953年にかけて合計14両が導入されました。すらりとした姿から、「貴婦人」や「蒸気機関車の女王」と称えられ、最高時速は100キロメートルに達します。1979年に縦貫線が電化されて使用を止めましたが、2014年の鉄道節に運行を再開しました。近年は夏休みになると、「仲夏宝島号」として台東線を走ります。",
    "ko": "CT273은 CT270형 증기기관차에 속하며, 일본 C57형의 대만 동형 차량으로 1942년부터 1953년 사이에 모두 14량이 도입되었어요. 날씬한 외형 덕분에 ‘귀부인’과 ‘증기기관차의 여왕’이라는 이름을 얻었고, 최고 속도는 시속 100km에 이르러요. 1979년 종관선 전철화 이후 운행을 멈췄다가 2014년 철도절에 다시 달렸고, 근래에는 여름방학마다 ‘한여름 보물섬호’로 타이둥선에서 운행하고 있어요.",
  },
  "r150": {
    "zh-TW": "R150 是台鐵至今仍在服役的柴電機車。最早一批漆成海軍藍，西部幹線電氣化後才改成橘色；1982 年追加的那批則是一出廠就漆成橘色。",
    "en": "The R150 is a diesel-electric locomotive still in service on Taiwan Railway today. The earliest batch was painted navy blue and only became orange after the Western Trunk Line was electrified, while the batch added in 1982 was painted orange from the factory.",
    "ja": "R150は台鉄でいまも活躍しているディーゼル電気機関車です。最初のグループはネイビーブルーに塗られ、西部幹線の電化後にオレンジ色へ改められました。1982年に追加されたグループは出場時からオレンジ色です。",
    "ko": "R150은 대만철도에서 지금도 복무하고 있는 디젤전기 기관차예요. 가장 처음 들어온 차량은 네이비 블루로 칠했고 서부 간선이 전철화된 뒤에야 주황색으로 바뀌었어요. 1982년에 추가된 차량은 출고될 때부터 주황색이었어요.",
  },
  "r180": {
    "zh-TW": "R180 與 R190 是同一系列的柴電機車，其中 R193 到 R196 是由台灣水泥出資購買的。重聯時最多可以五輛由一人總控。",
    "en": "The R180 and R190 are diesel-electric locomotives of the same series; R193 to R196 were bought with funding from Taiwan Cement. When coupled, up to five can be controlled by one driver.",
    "ja": "R180とR190は同じ系列のディーゼル電気機関車で、そのうちR193からR196は、台湾セメントが出資して購入したものです。重連運転のときは、最大5両までを1人で総括制御できます。",
    "ko": "R180과 R190은 같은 계열의 디젤전기 기관차로, 그중 R193부터 R196까지는 대만 시멘트가 출자해 구입했어요. 중련할 때는 최대 다섯 량까지 한 사람이 총괄 제어할 수 있어요.",
  },
  "emu200": {
    "zh-TW": "EMU200 是台鐵的自強號電聯車，後來被改造成 9 輛一組的 EMU1200，車門也從手動摺疊門換成滑軌式自動門，成了另一種模樣的自強號。",
    "en": "The EMU200 is a Taiwan Railway Tze-Chiang electric multiple unit. It was later rebuilt into the 9-car EMU1200, and the manual folding doors gave way to sliding automatic doors, making it a different-looking Tze-Chiang train.",
    "ja": "EMU200は台鉄の自強号用電車で、のちに9両1編成のEMU1200に改造され、手動の折戸もスライド式の自動ドアに替わり、別の姿の自強号になりました。",
    "ko": "EMU200은 대만철도의 쯔창호 전동차로, 나중에 9량 1편성의 EMU1200으로 개조되면서 수동 접이문도 미닫이식 자동문으로 바뀌어, 또 다른 모습의 쯔창호가 되었어요.",
  },
  "dr2800": {
    "zh-TW": "DR2800 是台鐵第一款裝有冷氣的柴油客車，不鏽鋼車體採用美國 Budd 公司授權的技術，1982 年 6 月以自強號之姿上路。2023 年 4 月它退出營運，在東部服務了四十多年。",
    "en": "The DR2800 was Taiwan Railway’s first diesel railcar with air conditioning, with a stainless steel body made under licence from Budd of the United States. It took to the rails as a Tze-Chiang train in June 1982. It left service in April 2023, after more than forty years in the east.",
    "ja": "DR2800は台鉄で初めて冷房を備えたディーゼルカーで、ステンレス車体にはアメリカのBudd社から許諾を受けた技術が使われています。1982年6月に自強号として走り始めました。2023年4月に営業から退き、東部で40年あまり活躍しました。",
    "ko": "DR2800은 대만철도에서 처음으로 에어컨을 갖춘 디젤 동차로, 스테인리스 차체에는 미국 버드사에서 허가받은 기술을 썼어요. 1982년 6월 쯔창호로 달리기 시작했어요. 2023년 4월에 운행을 마칠 때까지 동부에서 40년 넘게 활약했어요.",
  },
  "e100": {
    "zh-TW": "E100 是台鐵第一批引進的電力機車，為西部幹線電氣化而訂購。後來陸續退役報廢，只有 E101 被指定保存，是這型唯一完整留下的一輛。",
    "en": "The E100 was the first batch of electric locomotives Taiwan Railway ever brought in, ordered for the electrification of the Western Trunk Line. They were later retired and scrapped one by one, and only E101 was designated for preservation, the one complete survivor of the class.",
    "ja": "E100は台鉄が初めて導入した電気機関車で、西部幹線の電化に合わせて発注されました。その後は順次廃車となり、保存車に指定されたのはE101だけで、この形式で完全な形で残る唯一の1両です。",
    "ko": "E100은 대만철도가 처음 들여온 전기기관차로, 서부 간선 전철화를 위해 주문했어요. 이후 차례로 퇴역해 폐차되었고 보존 차량으로 지정된 것은 E101뿐이라, 이 형식에서 온전히 남은 유일한 한 량이에요.",
  },
  "s200": {
    "zh-TW": "S200 是台鐵柴油化初期的柴電機車。2018 年 9 月後它不再跑臨港線，現在還有幾輛保存下來，其中 S210 在哈瑪星鐵道園區動態展示。",
    "en": "The S200 is a diesel-electric locomotive from the early days of Taiwan Railway’s switch to diesel. It stopped running the Kaohsiung harbor line after September 2018. A few are preserved today, and S210 is on running display at the Hamasen Railway Park.",
    "ja": "S200は台鉄がディーゼル化を進めた初期のディーゼル電気機関車です。2018年9月以降は臨港線を走らなくなり、いまは数両が保存されていて、S210は哈瑪星鉄道園区で動態展示されています。",
    "ko": "S200은 대만철도가 디젤화를 시작하던 초기의 디젤전기 기관차예요. 2018년 9월 이후에는 린강선을 달리지 않으며, 지금은 몇 량이 보존되어 있고 그중 S210은 하마싱 철도공원에서 동태 전시되고 있어요.",
  },
  "shay31": {
    "zh-TW": "阿里山林鐵的 31 號是一部 Shay 式蒸汽機車，約在 1910 年代出廠。Shay 的齒輪傳動是配合登山鐵路需要的設計，讓它能噴著白煙慢慢爬進山裡。",
    "en": "Number 31 of the Alishan Forest Railway is a Shay-type steam locomotive, built around the 1910s. The Shay’s geared drive is a design made for the needs of a mountain railway, letting it puff white steam slowly up into the mountains.",
    "ja": "阿里山森林鉄道の31号はシェイ式蒸気機関車で、1910年代ごろに製造されました。シェイ式のギア駆動は登山鉄道のための設計で、白い蒸気を上げながらゆっくり山を登れます。",
    "ko": "아리산 임업철도의 31호는 쉐이(Shay)식 증기기관차로, 1910년대쯤 제작되었어요. 쉐이의 기어 구동은 산악 철도에 맞춘 설계로, 하얀 증기를 내뿜으며 천천히 산을 오를 수 있어요.",
  },
  "tsc346": {
    "zh-TW": "346 號是台糖的蒸汽機車，現在在溪湖糖廠牽引觀光小火車，來回全程約 7 公里、大約 50 分鐘，帶著遊客回味糖鐵的年代。",
    "en": "No. 346 is a Taiwan Sugar steam locomotive that now hauls the tourist train at the Xihu Sugar Mill, on a round trip of about 7 km that takes about 50 minutes, letting visitors relive the age of the sugar railways.",
    "ja": "346号は台糖の蒸気機関車で、いまは渓湖糖廠で観光列車を牽引しています。往復約7キロメートル、約50分の道のりで、糖鉄の時代を味わえます。",
    "ko": "346호는 대만 설탕회사(타이탕)의 증기기관차로, 지금은 시후 제당소에서 관광 열차를 끌고 있으며, 왕복 약 7km를 50분쯤 달려서 설탕 철도의 시대를 되새길 수 있어요.",
  },
  "wufen": {
    "zh-TW": "五分車是台灣糖業鐵路的小火車，路線普遍採用 762 公釐軌距，車廂小巧。除了運甘蔗，糖鐵也有對外開放客貨運輸的營業線；北港線停駛後，糖鐵客運就此結束。如今台糖的營業線共有 5 處，都是觀光用途。",
    "en": "The “five-fen train” (wufen che) is the little train of Taiwan’s sugar railways, which mostly ran on a gauge of 762 mm, with small, compact cars. Besides hauling sugarcane, they had public lines open to passengers and freight; after the Beigang Line stopped running, passenger service on the sugar railways came to an end. Today Taiwan Sugar runs 5 lines, all for tourism.",
    "ja": "五分車（ウーフェンチャー）は台湾の糖業鉄道の小さな列車で、路線の多くは軌間762ミリメートル、車両もこぢんまりしています。甘蔗を運ぶほか、旅客と貨物を扱う営業線もありました。北港線が運行を終え、糖鉄の旅客輸送は幕を閉じました。いま台糖の営業線は5か所あり、どれも観光用です。",
    "ko": "우펀처(五分車)는 대만 제당 철도의 작은 열차로, 노선 대부분이 762mm 궤간이고 객차도 아담해요. 사탕수수를 나르는 한편 승객과 화물을 받는 영업선도 있었어요. 베이강선이 운행을 멈추면서 제당 철도의 여객 운송도 끝났어요. 지금 타이탕의 영업선은 다섯 곳이고 모두 관광용이에요.",
  },
  "s400": {
    "zh-TW": "S400 是七堵駝峰調車場的專用柴電機車。駝峰調車是把車廂推上一段小坡，再讓它們順著坡溜進各股道編組。",
    "en": "The S400 is a diesel-electric locomotive for the Qidu hump yard. In hump shunting, cars are pushed up a small rise and then roll down it into the yard tracks to be sorted.",
    "ja": "S400は七堵の「ハンプヤード（駝峰調車場）」専用のディーゼル電気機関車です。ハンプ入換とは、貨車を小さな坂の上へ押し上げ、坂を転がらせて各線へ振り分ける作業です。",
    "ko": "S400은 치두의 험프 조차장(駝峰調車場) 전용 디젤전기 기관차예요. 험프 입환은 화차를 작은 언덕 위로 밀어 올린 뒤 비탈을 따라 굴러 내려가 각 선로로 나뉘게 하는 작업이에요.",
  },
  "emu400": {
    "zh-TW": "EMU400 是台鐵的通勤電聯車，接手縱貫線上原有的柴油快車服務。每輛有 60 個座位，站位可容納約 120 人。2015 年 3 月它全數退出定期營運，國家鐵道博物館保存了其中的 EMC410。",
    "en": "The EMU400 is a Taiwan Railway commuter electric multiple unit, taking over from the diesel express trains on the Western Trunk Line. Each car has 60 seats and room for about 120 standing passengers. All units left scheduled service in March 2015, and the National Railway Museum now preserves one of them, EMC410.",
    "ja": "EMU400は台鉄の通勤型電車で、縦貫線でそれまでのディーゼル急行に代わって走りました。1両の座席は60席、立ち席には約120人が乗れます。2015年3月にすべてが定期運行から退き、いまは国立鉄道博物館にEMC410が保存されています。",
    "ko": "EMU400은 대만철도의 통근형 전동차로, 종관선에서 달리던 디젤 급행열차를 대신했어요. 한 량에 좌석 60석, 서서 타는 자리는 약 120명이에요. 2015년 3월에 모든 편성이 정기 운행에서 물러났으며, 지금은 국립철도박물관에 EMC410이 보존되어 있어요.",
  },
  "pc32701": {
    "zh-TW": "35PC32701 是台鐵的客廳車，特色是車尾有開放式的瞭望台，旅客可以站在欄杆旁看鐵軌向後延伸。車庫裡它跟在 E200 電力機車和莒光號客車後面，瞭望台朝外。",
    "en": "The 35PC32701 is a Taiwan Railway parlor car. Its distinctive feature is an open observation platform at the rear, where passengers can stand at the railing and watch the track stretch away behind. In the depot it trails an E200 electric locomotive and Chu-Kuang coaches, with the observation platform facing out.",
    "ja": "35PC32701は台鉄の客廳車（パーラーカー）です。特徴は後端にある開放式の展望台で、乗客は手すりのそばに立って、後ろへ伸びていく線路を眺められます。ガレージではE200電気機関車と莒光号の客車の後ろにつながり、展望台は外側を向いています。",
    "ko": "35PC32701은 대만철도의 객청차(파를러 카)예요. 가장 큰 특징은 뒤쪽 끝에 있는 개방형 전망대로, 난간 옆에 서서 뒤로 뻗어 가는 선로를 바라볼 수 있어요. 차고에서는 E200 전기기관차와 쥐광호 객차 뒤에 붙어 전망대가 바깥쪽을 향해요.",
  },
  "sa32820": {
    "zh-TW": "35SA32820 是台鐵的總統花車。這裡的「花車」不是載花，而是專為首長貴賓打造的高級鐵路車廂；編號裡的 SA 是英文 Saloon 的簡寫。它由觀光號客車改裝而成，車內有會議室、會客室、男女兩間臥室和盥洗室。車庫裡它掛在 E200 電力機車和莒光號客車後面。",
    "en": "The 35SA32820 is Taiwan Railway’s presidential saloon car. Here a “flower car” (huache) doesn’t carry flowers: it is a luxury railway car built for leaders and VIP guests, and the SA in its number is short for the English word “saloon”. It was converted from a Sightseeing Express coach, and inside are a meeting room, a reception room, separate bedrooms for men and women, and a washroom. In the depot it trails an E200 electric locomotive and Chu-Kuang coaches.",
    "ja": "35SA32820は台鉄の総統花車です。ここでの「花車」は花を運ぶ車ではなく、要人や貴賓のために造られた高級な鉄道車両のことで、番号のSAは英語の「Saloon」の略です。観光号の客車を改造したもので、車内には会議室、応接室、男性用と女性用の2つの寝室、洗面所があります。ガレージではE200電気機関車と莒光号の客車の後ろにつながっています。",
    "ko": "35SA32820은 대만철도의 총통 화처(花車)예요. 여기서 ‘화처’는 꽃을 싣는 차가 아니라 요인과 귀빈을 위해 만든 고급 철도 차량을 뜻하고, 번호의 SA는 영어 ‘Saloon’의 줄임말이에요. 관광호 객차를 개조해 만들었고, 안에는 회의실, 응접실, 남녀 침실 두 칸, 세면실이 있어요. 차고에서는 E200 전기기관차와 쥐광호 객차 뒤에 연결돼요.",
  },
  "shinkansen0": {
    "zh-TW": "這是日本新幹線 0 系的 21-5035 號車廂，陳列在高鐵台南站前的花魁車地景公園。0 系是世界上第一種高速鐵路車輛，全球只有兩輛位於日本境外：其中一輛 2001 年捐給英國的鐵道博物館，另一輛就是它，2004 年由台灣高鐵公司在興建期間引進，當作工程用的限界測量車，俗稱「花魁車」。如今它靜靜停在站旁，讓人看見高速鐵路最早的模樣。",
    "en": "This is car 21-5035 of the Japanese Shinkansen Series 0, on display in the Huakui Car Landscape Park in front of Taiwan High Speed Rail’s Tainan Station. The Series 0 was the world’s first high-speed rail vehicle, and only two cars are outside Japan. One was donated in 2001 to a railway museum in Britain; the other is this one, brought to Taiwan in 2004 by Taiwan High Speed Rail during construction to serve as a clearance-measuring work car, and commonly called the “Huakui car”. It now rests quietly beside the station, showing what the earliest high-speed trains looked like.",
    "ja": "これは日本の新幹線0系の21-5035号車で、台湾高速鉄道の台南駅前にある「花魁車地景公園」に展示されています。0系は世界で最初の高速鉄道車両で、日本国外にあるのは世界でも2両だけです。うち1両は2001年にイギリスの鉄道博物館へ寄贈され、もう1両がこの車両で、台湾高速鉄道が建設中の2004年に台湾へ導入し、建築限界を測る工事用の車両として使いました。「花魁車」の通称で知られています。いまは駅のそばで静かに休み、高速鉄道の最初の姿を伝えています。",
    "ko": "이 차는 일본 신칸센 0계의 21-5035호 차량으로, 대만 고속철도 타이난역 앞 ‘화쿠이 차 지경 공원’에 전시되어 있어요. 0계는 세계 최초의 고속철도 차량이고, 일본 밖에 있는 것은 전 세계에서 두 량뿐이에요. 한 량은 2001년 영국의 철도박물관에 기증되었고, 다른 한 량이 바로 이 차로, 대만 고속철도회사가 건설 중이던 2004년에 들여와 건축한계를 재는 공사용 차량으로 썼어요. 흔히 ‘화쿠이 차(花魁車)’라고 불려요. 지금은 역 옆에서 조용히 쉬면서 고속철도의 가장 이른 모습을 전하고 있어요.",
  },
},
profileLabels: {
  "zh-TW": {
    "title": "車款檔案",
    "nick": "綽號",
    "maker": "製造",
    "year": "引進",
    "count": "數量",
    "formation": "編組",
    "power": "出力",
    "speed": "最高速度",
    "source": "資料參考：維基百科等公開資料"
  },
  "en": {
    "title": "Vehicle Profile",
    "nick": "Nickname",
    "maker": "Builder",
    "year": "Introduced",
    "count": "Quantity",
    "formation": "Formation",
    "power": "Output",
    "speed": "Top Speed",
    "source": "Sources: Wikipedia and other public sources"
  },
  "ja": {
    "title": "車両データ",
    "nick": "愛称",
    "maker": "製造",
    "year": "導入",
    "count": "数量",
    "formation": "編成",
    "power": "出力",
    "speed": "最高速度",
    "source": "資料参考：ウィキペディアなどの公開資料"
  },
  "ko": {
    "title": "차량 정보",
    "nick": "별명",
    "maker": "제조",
    "year": "도입",
    "count": "수량",
    "formation": "편성",
    "power": "출력",
    "speed": "최고 속도",
    "source": "자료 참고: 위키백과 등 공개 자료"
  }
},
profiles: {
  "r20": {
    "zh-TW": {
      "maker": "美國 GM-EMD（原廠型號 G12）",
      "year": "1960～1966 年",
      "count": "52 輛（R21～R72）",
      "power": "1,425 匹馬力",
      "speed": "100 km/h"
    },
    "en": {
      "maker": "GM-EMD, USA (model G12)",
      "year": "1960–1966",
      "count": "52 units (R21–R72)",
      "power": "1,425 hp",
      "speed": "100 km/h"
    },
    "ja": {
      "maker": "アメリカ GM-EMD（原型式 G12）",
      "year": "1960～1966年",
      "count": "52両（R21～R72）",
      "power": "1,425馬力",
      "speed": "100 km/h"
    },
    "ko": {
      "maker": "미국 GM-EMD(원래 형식 G12)",
      "year": "1960~1966년",
      "count": "52량(R21~R72)",
      "power": "1,425마력",
      "speed": "100 km/h"
    }
  },
  "r100": {
    "zh-TW": {
      "maker": "美國 GM-EMD（原廠型號 G22U）",
      "year": "1969 年",
      "count": "39 輛（R101～R139）",
      "power": "1,650 匹馬力",
      "speed": "100 km/h",
      "notes": [
        "塗裝從海軍藍換成橘色，近年又有幾輛漆回深藍色。"
      ]
    },
    "en": {
      "maker": "GM-EMD, USA (model G22U)",
      "year": "1969",
      "count": "39 units (R101–R139)",
      "power": "1,650 hp",
      "speed": "100 km/h",
      "notes": [
        "The livery changed from navy blue to orange, and in recent years a few have been repainted dark blue."
      ]
    },
    "ja": {
      "maker": "アメリカ GM-EMD（原型式 G22U）",
      "year": "1969年",
      "count": "39両（R101～R139）",
      "power": "1,650馬力",
      "speed": "100 km/h",
      "notes": [
        "塗装は紺色から橙色に変わり、近年は数両が濃紺に塗り戻されています。"
      ]
    },
    "ko": {
      "maker": "미국 GM-EMD(원래 형식 G22U)",
      "year": "1969년",
      "count": "39량(R101~R139)",
      "power": "1,650마력",
      "speed": "100 km/h",
      "notes": [
        "도색은 네이비 블루에서 주황색으로 바뀌었고, 최근에는 몇 량이 짙은 파랑으로 다시 칠해졌어요."
      ]
    }
  },
  "blue": {
    "zh-TW": {
      "maker": "美國 GM-EMD（R100 型）",
      "year": "1969 年",
      "count": "R100 型共 39 輛",
      "power": "1,650 匹馬力",
      "speed": "100 km/h",
      "notes": [
        "藍皮解憂號由 R100 型柴電機車牽引；2021 年下旬為了這個需求，R122、R127、R135 塗裝恢復成海軍藍。"
      ]
    },
    "en": {
      "maker": "GM-EMD, USA (R100 class)",
      "year": "1969",
      "count": "39 units of the R100 class",
      "power": "1,650 hp",
      "speed": "100 km/h",
      "notes": [
        "The Breezy Blue train is hauled by R100-class diesel-electric locomotives; in late 2021, for this purpose, R122, R127 and R135 were repainted back into navy blue."
      ]
    },
    "ja": {
      "maker": "アメリカ GM-EMD（R100形）",
      "year": "1969年",
      "count": "R100形は計39両",
      "power": "1,650馬力",
      "speed": "100 km/h",
      "notes": [
        "藍皮解憂号はR100形ディーゼル電気機関車が牽引します。2021年の下旬にはこの運用のため、R122、R127、R135の塗装が海軍ブルーに戻されました。"
      ]
    },
    "ko": {
      "maker": "미국 GM-EMD(R100형)",
      "year": "1969년",
      "count": "R100형 모두 39량",
      "power": "1,650마력",
      "speed": "100 km/h",
      "notes": [
        "브리지 블루 열차는 R100형 디젤전기 기관차가 끌어요. 2021년 하반기에 이 용도로 R122, R127, R135의 도색을 다시 해군 남색으로 되돌렸어요."
      ]
    }
  },
  "r150": {
    "zh-TW": {
      "maker": "美國 GM-EMD（原廠型號 G22CU）",
      "year": "1973、1982 年",
      "count": "25 輛（R151～R175）",
      "power": "1,650 匹馬力",
      "speed": "110 km/h",
      "notes": [
        "六根車軸全都有動力，牽引力比 R100 大。",
        "1982 年加買的 5 輛，是為了北迴線通車與台東線拓寬。"
      ]
    },
    "en": {
      "maker": "GM-EMD, USA (model G22CU)",
      "year": "1973, 1982",
      "count": "25 units (R151–R175)",
      "power": "1,650 hp",
      "speed": "110 km/h",
      "notes": [
        "All six axles are powered, giving greater tractive effort than the R100.",
        "The five units bought in 1982 were for the opening of the North-Link Line and the widening of the Taitung Line."
      ]
    },
    "ja": {
      "maker": "アメリカ GM-EMD（原型式 G22CU）",
      "year": "1973、1982年",
      "count": "25両（R151～R175）",
      "power": "1,650馬力",
      "speed": "110 km/h",
      "notes": [
        "6本の車軸すべてに動力があり、牽引力はR100より大きいです。",
        "1982年に追加した5両は、北廻線の開通と台東線の拡幅のためのものでした。"
      ]
    },
    "ko": {
      "maker": "미국 GM-EMD(원래 형식 G22CU)",
      "year": "1973, 1982년",
      "count": "25량(R151~R175)",
      "power": "1,650마력",
      "speed": "110 km/h",
      "notes": [
        "여섯 개 차축 모두에 동력이 있어 견인력이 R100보다 커요.",
        "1982년에 추가로 산 5량은 베이후이선 개통과 타이둥선 확장을 위한 것이었어요."
      ]
    }
  },
  "r180": {
    "zh-TW": {
      "maker": "美國 GM（引擎在美國製造、車體在加拿大組裝）",
      "year": "1992～2001 年",
      "count": "16 輛（R180 型 10 輛、R190 型 6 輛）",
      "power": "1,650 匹馬力",
      "notes": [
        "台鐵第一次向加拿大進口的柴電機車，牽引馬達與車體在加拿大組裝。",
        "有總控重聯裝置，常在北迴線上兩輛重聯牽引貨物列車。"
      ]
    },
    "en": {
      "maker": "GM, USA (engines made in the US, bodies assembled in Canada)",
      "year": "1992–2001",
      "count": "16 units (10 R180, 6 R190)",
      "power": "1,650 hp",
      "notes": [
        "Taiwan Railway’s first diesel-electric locomotives imported from Canada, with the traction motors and carbody assembled in Canada.",
        "It has multiple-unit control equipment, and two locomotives are often coupled together to haul freight trains on the North-Link Line."
      ]
    },
    "ja": {
      "maker": "アメリカ GM（エンジンはアメリカ製、車体はカナダで組み立て）",
      "year": "1992～2001年",
      "count": "16両（R180形10両、R190形6両）",
      "power": "1,650馬力",
      "notes": [
        "台鉄がカナダから初めて輸入したディーゼル電気機関車で、牽引モーターと車体はカナダで組み立てられました。",
        "総括制御の重連装置を備えていて、北廻線では2両を重連にして貨物列車を牽引することがよくあります。"
      ]
    },
    "ko": {
      "maker": "미국 GM(엔진은 미국 제작, 차체는 캐나다 조립)",
      "year": "1992~2001년",
      "count": "16량(R180형 10량, R190형 6량)",
      "power": "1,650마력",
      "notes": [
        "대만철도가 캐나다에서 처음 들여온 디젤전기 기관차로, 견인 전동기와 차체를 캐나다에서 조립했어요.",
        "총괄 제어 중련 장치가 있어서, 베이후이선에서 두 량을 중련으로 연결해 화물 열차를 끄는 모습을 자주 볼 수 있어요."
      ]
    }
  },
  "r200": {
    "zh-TW": {
      "maker": "Stadler（西班牙瓦倫西亞廠）",
      "year": "2023 年起",
      "count": "34 輛",
      "power": "2,700 匹馬力",
      "notes": [
        "這是 Stadler 在亞太地區的第一筆訂單。",
        "引擎配了尿素混合系統與廢氣處理系統，防護空污與噪音。"
      ]
    },
    "en": {
      "maker": "Stadler (Valencia plant, Spain)",
      "year": "From 2023",
      "count": "34 units",
      "power": "2,700 hp",
      "notes": [
        "This was Stadler’s first order in the Asia-Pacific region.",
        "The engine is fitted with a urea mixing system and an exhaust after-treatment system to protect against air pollution and noise."
      ]
    },
    "ja": {
      "maker": "Stadler（スペイン・バレンシア工場）",
      "year": "2023年から",
      "count": "34両",
      "power": "2,700馬力",
      "notes": [
        "Stadlerにとって、アジア太平洋地域で初めての受注です。",
        "エンジンには尿素混合システムと排気ガス処理システムを備え、大気汚染と騒音を抑えています。"
      ]
    },
    "ko": {
      "maker": "슈타들러(스페인 발렌시아 공장)",
      "year": "2023년부터",
      "count": "34량",
      "power": "2,700마력",
      "notes": [
        "슈타들러가 아시아·태평양 지역에서 처음 수주한 사례예요.",
        "엔진에 요소수 혼합 시스템과 배기가스 처리 시스템을 달아서 대기오염과 소음을 막아 줘요."
      ]
    }
  },
  "dhl100": {
    "zh-TW": {
      "maker": "日本新潟鐵工（原型車）、台灣車輛（組裝）",
      "year": "2002～2003 年",
      "count": "16 輛（DHL101～DHL116）",
      "power": "1,200 匹馬力",
      "speed": "75 km/h",
      "notes": [
        "是台鐵第一款專為調車設計的柴油液體傳動機車，牽引力足以拉完整 15 節的推拉式自強號。",
        "曾在平溪線擔任專列的補機、牽引過深澳線貨物列車，集集線也看得到它。"
      ]
    },
    "en": {
      "maker": "Niigata Engineering, Japan (prototype); Taiwan Car (assembly)",
      "year": "2002–2003",
      "count": "16 units (DHL101–DHL116)",
      "power": "1,200 hp",
      "speed": "75 km/h",
      "notes": [
        "Taiwan Railway’s first diesel-hydraulic locomotive designed specifically for shunting, with enough tractive effort to haul a full 15-car push-pull Tze-Chiang train.",
        "It has served as a helper locomotive on special trains on the Pingxi Line and hauled freight trains on the Shen’ao Line; it can also be seen on the Jiji Line."
      ]
    },
    "ja": {
      "maker": "日本 新潟鉄工所（原型）、台湾車輌（組み立て）",
      "year": "2002～2003年",
      "count": "16両（DHL101～DHL116）",
      "power": "1,200馬力",
      "speed": "75 km/h",
      "notes": [
        "台鉄で初めて入換専用に設計されたディーゼル液体式機関車で、牽引力は15両編成のプッシュプル式自強号をまるごと牽けるほどです。",
        "平渓線では専用列車の補機を務め、深澳線では貨物列車を牽引したことがあります。集集線でも見かけます。"
      ]
    },
    "ko": {
      "maker": "일본 니가타철공(원형), 대만차량(조립)",
      "year": "2002~2003년",
      "count": "16량(DHL101~DHL116)",
      "power": "1,200마력",
      "speed": "75 km/h",
      "notes": [
        "대만철도 최초로 입환 전용으로 설계된 디젤 액체식 기관차로, 15량짜리 푸시풀 쯔창호 한 편성을 통째로 끌 만큼 견인력이 충분해요.",
        "핑시선에서는 전용 열차의 보조 기관차를 맡았고 선아오선에서는 화물 열차를 끈 적이 있어요. 지지선에서도 볼 수 있어요."
      ]
    }
  },
  "e200": {
    "zh-TW": {
      "maker": "美國奇異（GE）",
      "year": "1978～1992 年",
      "count": "40 輛（E201～E240）",
      "power": "2,800 kW",
      "notes": [
        "全數裝有電動發電機組，可直接供應空調客車所需的冷氣與照明電力，不必另掛電源車。",
        "台鐵從 GE 購入 E200、E300、E400 共 97 輛電力機車，1975～1982 年間陸續交車。"
      ]
    },
    "en": {
      "maker": "General Electric (GE), USA",
      "year": "1978–1992",
      "count": "40 units (E201–E240)",
      "power": "2,800 kW",
      "notes": [
        "Every unit is fitted with a motor-generator set that supplies the air conditioning and lighting power for the coaches directly, so no separate power car needs to be coupled.",
        "Taiwan Railway bought a total of 97 electric locomotives from GE, the E200, E300 and E400, delivered in stages between 1975 and 1982."
      ]
    },
    "ja": {
      "maker": "アメリカ ゼネラル・エレクトリック（GE）",
      "year": "1978～1992年",
      "count": "40両（E201～E240）",
      "power": "2,800 kW",
      "notes": [
        "全車に電動発電機を搭載していて、客車の冷房と照明に必要な電力を直接供給できるので、電源車を別につなぐ必要がありません。",
        "台鉄はGEからE200、E300、E400の電気機関車を合わせて97両購入し、1975～1982年にかけて順次納入されました。"
      ]
    },
    "ko": {
      "maker": "미국 제너럴 일렉트릭(GE)",
      "year": "1978~1992년",
      "count": "40량(E201~E240)",
      "power": "2,800 kW",
      "notes": [
        "전 차량에 전동 발전기 세트를 달아서 객차의 에어컨과 조명에 필요한 전력을 바로 공급할 수 있어요. 전원차를 따로 달 필요가 없어요.",
        "대만철도는 GE에서 E200, E300, E400 전기 기관차를 모두 97량 사 왔고, 1975~1982년에 걸쳐 차례로 인도받았어요."
      ]
    }
  },
  "e300": {
    "zh-TW": {
      "maker": "美國奇異（GE）",
      "year": "1977 年起",
      "count": "39 輛（E301～E339）",
      "power": "2,800 kW",
      "notes": [
        "原廠沒裝電動發電機組，牽引空調列車時要加掛電源行李車。",
        "交車比 E200 早一年；因為沒有電動發電機組，主要在電氣化區間牽引貨物列車，也擔任救援機車。"
      ]
    },
    "en": {
      "maker": "General Electric (GE), USA",
      "year": "From 1977",
      "count": "39 units (E301–E339)",
      "power": "2,800 kW",
      "notes": [
        "It came from the factory without a motor-generator set, so when hauling air-conditioned trains it needs a power-and-baggage car coupled on.",
        "It was delivered one year before the E200; with no motor-generator set, it mainly hauls freight trains on electrified sections and also serves as a rescue locomotive."
      ]
    },
    "ja": {
      "maker": "アメリカ ゼネラル・エレクトリック（GE）",
      "year": "1977年から",
      "count": "39両（E301～E339）",
      "power": "2,800 kW",
      "notes": [
        "工場出荷時には電動発電機がなく、冷房付きの列車を牽くときは電源荷物車を増結する必要があります。",
        "納入はE200より1年早く、電動発電機がないため、おもに電化区間で貨物列車を牽引し、救援用の機関車も務めます。"
      ]
    },
    "ko": {
      "maker": "미국 제너럴 일렉트릭(GE)",
      "year": "1977년부터",
      "count": "39량(E301~E339)",
      "power": "2,800 kW",
      "notes": [
        "공장에서 나올 때 전동 발전기가 없어서, 에어컨 열차를 끌 때는 전원 수하물차를 따로 달아야 해요.",
        "E200보다 1년 먼저 인도됐어요. 전동 발전기가 없어서 주로 전철화 구간에서 화물 열차를 끌고, 구원 기관차 역할도 해요."
      ]
    }
  },
  "e400": {
    "zh-TW": {
      "maker": "美國奇異（GE）",
      "count": "18 輛（E401～E418）",
      "power": "2,800 kW",
      "speed": "130 km/h（設計）",
      "notes": [
        "為了高速行駛，E400 的齒輪比調高、車重降到 92 公噸，起動牽引力與爬坡能力比 E200、E300 差。"
      ]
    },
    "en": {
      "maker": "General Electric (GE), USA",
      "count": "18 units (E401–E418)",
      "power": "2,800 kW",
      "speed": "130 km/h (design)",
      "notes": [
        "For high-speed running, the E400 has a raised gear ratio and its weight was cut to 92 tonnes; its starting tractive effort and hill-climbing ability are weaker than the E200 and E300."
      ]
    },
    "ja": {
      "maker": "アメリカ ゼネラル・エレクトリック（GE）",
      "count": "18両（E401～E418）",
      "power": "2,800 kW",
      "speed": "130 km/h（設計）",
      "notes": [
        "高速走行のため、E400は歯車比を高くし、車体重量を92トンまで軽くしました。そのぶん起動時の牽引力と登坂能力はE200、E300より劣ります。"
      ]
    },
    "ko": {
      "maker": "미국 제너럴 일렉트릭(GE)",
      "count": "18량(E401~E418)",
      "power": "2,800 kW",
      "speed": "130 km/h(설계)",
      "notes": [
        "고속 주행을 위해 E400은 기어비를 높이고 차체 무게를 92톤으로 줄였어요. 그래서 기동 견인력과 오르막 성능은 E200, E300보다 떨어져요."
      ]
    }
  },
  "mingri": {
    "zh-TW": {
      "maker": "美國奇異（GE，E400 型）",
      "count": "E400 型共 18 輛",
      "power": "2,800 kW",
      "speed": "130 km/h（設計）",
      "notes": [
        "鳴日號的夕景塗裝不只用在 E400：E200 型的 E237～E239 也漆過同一套。"
      ]
    },
    "en": {
      "maker": "General Electric (GE), USA (E400 class)",
      "count": "18 units of the E400 class",
      "power": "2,800 kW",
      "speed": "130 km/h (design)",
      "notes": [
        "The sunset-scene livery of the Future train is not used only on the E400: E237–E239 of the E200 class have also been painted in the same scheme."
      ]
    },
    "ja": {
      "maker": "アメリカ ゼネラル・エレクトリック（GE、E400形）",
      "count": "E400形は計18両",
      "power": "2,800 kW",
      "speed": "130 km/h（設計）",
      "notes": [
        "鳴日号の夕景塗装はE400形だけのものではありません。E200形のE237～E239も同じ塗装になっています。"
      ]
    },
    "ko": {
      "maker": "미국 제너럴 일렉트릭(GE, E400형)",
      "count": "E400형 모두 18량",
      "power": "2,800 kW",
      "speed": "130 km/h(설계)",
      "notes": [
        "밍르호의 석양 풍경 도색은 E400에만 쓰인 게 아니에요. E200형의 E237~E239도 같은 도색으로 칠했어요."
      ]
    }
  },
  "e500": {
    "zh-TW": {
      "maker": "日本東芝",
      "year": "2023 年起",
      "notes": [
        "第一輛 E501 在 2023 年 9 月抵達花蓮港，預計整備約 95 天。",
        "2024 年 9 月 30 日的啟航列車是 121 次自強號，從七堵開往屏東。"
      ]
    },
    "en": {
      "maker": "Toshiba, Japan",
      "year": "From 2023",
      "notes": [
        "The first unit, E501, arrived at Hualien Port in September 2023, with about 95 days of preparation planned.",
        "The inaugural run on September 30, 2024 was Tze-Chiang No. 121, from Qidu to Pingtung."
      ]
    },
    "ja": {
      "maker": "日本 東芝",
      "year": "2023年から",
      "notes": [
        "1両目のE501は2023年9月に花蓮港へ到着し、約95日間の整備が予定されていました。",
        "2024年9月30日の出発式の列車は自強号121次で、七堵から屏東へ向かいました。"
      ]
    },
    "ko": {
      "maker": "일본 도시바",
      "year": "2023년부터",
      "notes": [
        "첫 번째 E501은 2023년 9월 화롄항에 도착했고, 정비에 약 95일이 걸릴 예정이었어요.",
        "2024년 9월 30일 출범 열차는 쯔창호 121편으로, 치두에서 핑둥으로 달렸어요."
      ]
    }
  },
  "e1000": {
    "zh-TW": {
      "maker": "南非 UCW（機電：GEC-Alsthom）",
      "year": "1996～1997 年",
      "count": "64 輛（E1001～E1064）",
      "speed": "130 km/h",
      "notes": [
        "專為推拉式自強號設計，每輛只有一端設駕駛台，兩輛一組、一頭拉一頭推。"
      ]
    },
    "en": {
      "maker": "UCW, South Africa (electrical: GEC-Alsthom)",
      "year": "1996–1997",
      "count": "64 units (E1001–E1064)",
      "speed": "130 km/h",
      "notes": [
        "Designed for the push-pull Tze-Chiang, each unit has a driving cab at only one end; two units form a pair, one pulling at the head and one pushing at the rear."
      ]
    },
    "ja": {
      "maker": "南アフリカ UCW（電機：GEC-Alsthom）",
      "year": "1996～1997年",
      "count": "64両（E1001～E1064）",
      "speed": "130 km/h",
      "notes": [
        "プッシュプル式自強号のために設計され、運転台は1両につき片側だけです。2両が1組になり、一方が先頭で牽引し、もう一方が後ろから押します。"
      ]
    },
    "ko": {
      "maker": "남아프리카 UCW(전기 장치: GEC-Alsthom)",
      "year": "1996~1997년",
      "count": "64량(E1001~E1064)",
      "speed": "130 km/h",
      "notes": [
        "푸시풀 쯔창호를 위해 설계됐고, 한 량에는 한쪽 끝에만 운전대가 있어요. 두 량이 한 조로, 한쪽은 앞에서 끌고 한쪽은 뒤에서 밀어요."
      ]
    }
  },
  "dr1000": {
    "zh-TW": {
      "maker": "日本車輛",
      "year": "1998 年",
      "count": "36 輛（DR1001～DR1036）",
      "power": "350 匹馬力（主引擎）",
      "notes": [
        "除了主引擎，車上另有一具發電引擎供冷氣與照明，所以單獨一輛就能跑。"
      ]
    },
    "en": {
      "maker": "Nippon Sharyo",
      "year": "1998",
      "count": "36 units (DR1001–DR1036)",
      "power": "350 hp (main engine)",
      "notes": [
        "Besides the main engine, each car carries a separate generator engine for air conditioning and lighting, so even a single car can run alone."
      ]
    },
    "ja": {
      "maker": "日本車輌製造",
      "year": "1998年",
      "count": "36両（DR1001～DR1036）",
      "power": "350馬力（主機関）",
      "notes": [
        "主機関のほかに、冷房と照明のための発電用エンジンも載せているので、1両だけでも走れます。"
      ]
    },
    "ko": {
      "maker": "닛폰샤료",
      "year": "1998년",
      "count": "36량(DR1001~DR1036)",
      "power": "350마력(주 엔진)",
      "notes": [
        "주 엔진 외에 에어컨과 조명용 발전 엔진이 따로 있어서 한 량만으로도 달릴 수 있어요."
      ]
    }
  },
  "dr2700": {
    "zh-TW": {
      "nick": "白鐵仔",
      "maker": "日本東急車輛（美國 Budd 公司授權）",
      "year": "1966 年",
      "power": "335 匹馬力（原裝引擎）",
      "speed": "110 km/h",
      "notes": [
        "車內是草綠色旋轉椅和月洞門，車窗下方還有茶杯架。",
        "2014 年 7 月 15 日退出常態營運；2020 年檢修時發現車架鏽蝕嚴重，動態保存也跟著結束。"
      ]
    },
    "en": {
      "nick": "Bai Tie Zai (“White Iron”)",
      "maker": "Tokyu Car, Japan (licensed by the Budd Company, USA)",
      "year": "1966",
      "power": "335 hp (original engine)",
      "speed": "110 km/h",
      "notes": [
        "Inside were grass-green swivel seats and moon-gate-style doorways, with cup holders below the windows.",
        "It left regular service on July 15, 2014; during an overhaul in 2020 severe corrosion of the frame was found, which also ended its heritage operation."
      ]
    },
    "ja": {
      "nick": "白鉄仔",
      "maker": "日本 東急車輛製造（アメリカ・バッド社のライセンス）",
      "year": "1966年",
      "power": "335馬力（導入時のエンジン）",
      "speed": "110 km/h",
      "notes": [
        "車内は若草色の回転式シートと円形の出入り口を備え、窓の下にはカップホルダーもありました。",
        "2014年7月15日に定期運用を外れました。2020年の検査で台枠の腐食がひどいことがわかり、動態保存も終わりました。"
      ]
    },
    "ko": {
      "nick": "바이톄자이(백철이)",
      "maker": "일본 도큐차량(미국 버드사 라이선스)",
      "year": "1966년",
      "power": "335마력(도입 당시 엔진)",
      "speed": "110 km/h",
      "notes": [
        "내부는 연초록색 회전 의자와 둥근 달 모양 출입문이 있었고, 창문 아래에는 컵 홀더도 있었어요.",
        "2014년 7월 15일에 정기 운행에서 물러났어요. 2020년 검수 때 차대 부식이 심한 것이 발견되어 동태 보존도 함께 끝났어요."
      ]
    }
  },
  "dr3000": {
    "zh-TW": {
      "maker": "日本日立",
      "year": "1990 年",
      "count": "81 輛（27 組）",
      "formation": "3 輛一組",
      "notes": [
        "DR3000 和 DR2900 外觀幾乎一樣，早年只能靠車身上的台鐵局徽分辨。"
      ]
    },
    "en": {
      "maker": "Hitachi, Japan",
      "year": "1990",
      "count": "81 cars (27 sets)",
      "formation": "3 cars per set",
      "notes": [
        "The DR3000 and DR2900 look almost identical; in the early years the only way to tell them apart was the Taiwan Railway emblem on the body."
      ]
    },
    "ja": {
      "maker": "日本 日立製作所",
      "year": "1990年",
      "count": "81両（27編成）",
      "formation": "3両1編成",
      "notes": [
        "DR3000とDR2900は見た目がほとんど同じで、当初は車体の台鉄のエンブレムでしか見分けられませんでした。"
      ]
    },
    "ko": {
      "maker": "일본 히타치",
      "year": "1990년",
      "count": "81량(27편성)",
      "formation": "3량 1편성",
      "notes": [
        "DR3000과 DR2900은 생김새가 거의 같아서, 초기에는 차체에 붙은 대만철도 로고로만 구분할 수 있었어요."
      ]
    }
  },
  "dr3100": {
    "zh-TW": {
      "maker": "日本車輛、唐榮鐵工廠",
      "year": "1998 年",
      "count": "30 輛（10 組）",
      "formation": "3 輛一組",
      "notes": [
        "每節車廂前後都有車門，車內也取消了早期柴聯車的月洞門裝飾。",
        "DR3100 主要取代原由 DR2800～DR3000 跑的車次，釋出的編組可加掛到其他班次，紓解假日一票難求。"
      ]
    },
    "en": {
      "maker": "Nippon Sharyo, Tang Eng Iron Works",
      "year": "1998",
      "count": "30 cars (10 sets)",
      "formation": "3 cars per set",
      "notes": [
        "Every car has doors at both the front and the rear, and the moon-gate-style interior doorways of earlier diesel railcars were dropped.",
        "The DR3100 mainly took over services previously run by the DR2800–DR3000; the sets it freed up can be added to other trains, easing the holiday scramble for tickets."
      ]
    },
    "ja": {
      "maker": "日本車輌製造、唐栄鉄工廠",
      "year": "1998年",
      "count": "30両（10編成）",
      "formation": "3両1編成",
      "notes": [
        "各車両の前後に出入り口があり、車内には初期のディーゼルカーにあった円形の出入り口の装飾もなくなりました。",
        "DR3100は、おもにDR2800～DR3000が走っていた列車を置き換えました。空いた編成は他の列車に増結できるので、休日の切符が取りにくい状況が和らぎました。"
      ]
    },
    "ko": {
      "maker": "닛폰샤료, 탕룽 철공장",
      "year": "1998년",
      "count": "30량(10편성)",
      "formation": "3량 1편성",
      "notes": [
        "모든 객차의 앞뒤에 출입문이 있고, 차 안에서는 초기 디젤 동차에 있던 둥근 달 모양 출입문 장식도 없어졌어요.",
        "DR3100은 주로 DR2800~DR3000이 달리던 열차를 대체했어요. 남은 편성을 다른 열차에 연결할 수 있게 되어, 휴일에 표 구하기 어려운 상황이 줄었어요."
      ]
    }
  },
  "emu100": {
    "zh-TW": {
      "maker": "英國 GEC（電機）、英國 BREL（車體）",
      "year": "1978 年",
      "count": "13 組 65 輛",
      "formation": "5 輛一組",
      "speed": "120 km/h",
      "notes": [
        "1979 年西部幹線全線電氣化通車後，台北到高雄只要 4 小時 10 分；1981 年起，車頭改塗橘紅與黃色的貓頭鷹警示色。"
      ]
    },
    "en": {
      "maker": "GEC, UK (electrical); BREL, UK (bodies)",
      "year": "1978",
      "count": "13 sets, 65 cars",
      "formation": "5 cars per set",
      "speed": "120 km/h",
      "notes": [
        "After the Western Trunk Line was fully electrified in 1979, Taipei to Kaohsiung took only 4 hours 10 minutes; from 1981 the front ends were repainted in orange-red and yellow “owl” warning colors."
      ]
    },
    "ja": {
      "maker": "イギリス GEC（電機）、イギリス BREL（車体）",
      "year": "1978年",
      "count": "13編成65両",
      "formation": "5両1編成",
      "speed": "120 km/h",
      "notes": [
        "1979年に西部幹線が全線電化されると、台北～高雄は4時間10分で結ばれました。1981年からは先頭部が、橙赤と黄色のフクロウ警戒色に塗り替えられました。"
      ]
    },
    "ko": {
      "maker": "영국 GEC(전기 장치), 영국 BREL(차체)",
      "year": "1978년",
      "count": "13편성 65량",
      "formation": "5량 1편성",
      "speed": "120 km/h",
      "notes": [
        "1979년 서부 간선이 전 구간 전철화된 뒤 타이베이~가오슝이 4시간 10분이면 갈 수 있게 됐어요. 1981년부터는 앞부분을 주황빛 빨강과 노랑의 ‘부엉이’ 경계색으로 다시 칠했어요."
      ]
    }
  },
  "emu1200": {
    "zh-TW": {
      "nick": "紅斑馬",
      "maker": "南非聯邦鐵路客貨車公司（原車 EMU200）",
      "year": "2002～2004 年改造",
      "count": "原車 11 組 33 輛",
      "formation": "改造後 9 輛固定編組",
      "notes": [
        "前身 EMU200 是向南非訂購的，共 11 組 33 輛。",
        "通道門原本是紅外線感應式，改造時換成觸摸式開關。"
      ]
    },
    "en": {
      "nick": "Red Zebra",
      "maker": "UCW, South Africa (original EMU200)",
      "year": "Rebuilt 2002–2004",
      "count": "11 original sets, 33 cars",
      "formation": "Fixed 9-car sets after rebuild",
      "notes": [
        "Its predecessor, the EMU200, was ordered from South Africa: 11 sets, 33 cars in all.",
        "The gangway doors were originally infrared-sensor type; during the rebuild they were replaced with touch-operated switches."
      ]
    },
    "ja": {
      "nick": "赤いシマウマ",
      "maker": "南アフリカ ユニオン・キャリッジ・アンド・ワゴン（原型はEMU200）",
      "year": "2002～2004年に改造",
      "count": "改造前は11編成33両",
      "formation": "改造後は9両固定編成",
      "notes": [
        "前身のEMU200は南アフリカに発注したもので、11編成33両です。",
        "貫通路のドアはもともと赤外線センサー式でしたが、改造のときにタッチ式スイッチに替えられました。"
      ]
    },
    "ko": {
      "nick": "붉은 얼룩말",
      "maker": "남아프리카 유니언 캐리지 앤드 왜건(원래 차량은 EMU200)",
      "year": "2002~2004년 개조",
      "count": "개조 전 11편성 33량",
      "formation": "개조 후 9량 고정 편성",
      "notes": [
        "전신인 EMU200은 남아프리카에 주문한 것으로, 모두 11편성 33량이에요.",
        "통로 문은 원래 적외선 센서식이었는데, 개조할 때 터치식 스위치로 바꿨어요."
      ]
    }
  },
  "emu300": {
    "zh-TW": {
      "maker": "義大利 SOCIMI（車體）、英國 Brush（機電）",
      "year": "1989 年",
      "count": "8 組 24 輛",
      "formation": "3 輛一組",
      "notes": [
        "海線 1019 次曾用它在約 3 小時 47 分跑完台北到高雄，這個紀錄據稱直到 2016 年才被 TEMU2000 超越。",
        "和外型相似的 EMU200 比，EMU300 最明顯的差異是車頭比較傾斜。"
      ]
    },
    "en": {
      "maker": "SOCIMI, Italy (bodies); Brush, UK (electrical)",
      "year": "1989",
      "count": "8 sets, 24 cars",
      "formation": "3 cars per set",
      "notes": [
        "On the Coast Line, Train 1019 once ran Taipei–Kaohsiung in about 3 hours 47 minutes with it, a record said to have stood until the TEMU2000 surpassed it in 2016.",
        "Compared with the similar-looking EMU200, the most obvious difference of the EMU300 is its more sharply sloped front end."
      ]
    },
    "ja": {
      "maker": "イタリア SOCIMI（車体）、イギリス Brush（電機）",
      "year": "1989年",
      "count": "8編成24両",
      "formation": "3両1編成",
      "notes": [
        "海線の1019次はこの電車で台北～高雄を約3時間47分で走ったことがあり、この記録は2016年にTEMU2000が上回るまで破られなかったとされています。",
        "見た目が似ているEMU200と比べて、EMU300のいちばん目立つ違いは、先頭部の傾斜が大きいことです。"
      ]
    },
    "ko": {
      "maker": "이탈리아 SOCIMI(차체), 영국 Brush(전기 장치)",
      "year": "1989년",
      "count": "8편성 24량",
      "formation": "3량 1편성",
      "notes": [
        "해안선 1019편이 이 열차로 타이베이~가오슝을 약 3시간 47분에 달린 적이 있고, 이 기록은 2016년 TEMU2000이 넘어설 때까지 이어졌다고 해요.",
        "생김새가 비슷한 EMU200과 비교하면, EMU300의 가장 눈에 띄는 차이는 앞부분이 더 비스듬하다는 점이에요."
      ]
    }
  },
  "emu500": {
    "zh-TW": {
      "maker": "韓國大宇重工（機電：德國西門子）",
      "year": "1995～1997 年",
      "count": "86 組 344 輛",
      "formation": "4 輛一組",
      "speed": "110 km/h",
      "notes": [
        "每側三扇門的設計成為台鐵日後通勤電聯車的標準；1998 年 5 月 26 日全面停駛西部幹線普通車。",
        "部分編組做過內裝優化，座椅換成高椅背絨布座椅。"
      ]
    },
    "en": {
      "maker": "Daewoo Heavy Industries, Korea (electrical: Siemens, Germany)",
      "year": "1995–1997",
      "count": "86 sets, 344 cars",
      "formation": "4 cars per set",
      "speed": "110 km/h",
      "notes": [
        "The three-doors-per-side design became the standard for later Taiwan Railway commuter EMUs; on May 26, 1998, ordinary-coach services on the Western Trunk Line were fully withdrawn.",
        "Some sets have had their interiors upgraded, with the seats replaced by high-backed velour seats."
      ]
    },
    "ja": {
      "maker": "韓国 大宇重工（電機：ドイツ シーメンス）",
      "year": "1995～1997年",
      "count": "86編成344両",
      "formation": "4両1編成",
      "speed": "110 km/h",
      "notes": [
        "片側3か所のドアという設計は、のちの台鉄の通勤電車の標準になりました。1998年5月26日には、西部幹線の普通客車の運行が全面的に終わりました。",
        "一部の編成は内装が改良され、座席が背もたれの高いベロア地のものに替えられました。"
      ]
    },
    "ko": {
      "maker": "한국 대우중공업(전기 장치: 독일 지멘스)",
      "year": "1995~1997년",
      "count": "86편성 344량",
      "formation": "4량 1편성",
      "speed": "110 km/h",
      "notes": [
        "한쪽에 문이 세 개인 설계는 이후 대만철도 통근 전동차의 표준이 됐어요. 1998년 5월 26일에는 서부 간선의 보통 객차 운행이 전면 중단됐어요.",
        "일부 편성은 내부를 개선해서 좌석을 등받이가 높은 벨벳 좌석으로 바꿨어요."
      ]
    }
  },
  "emu600": {
    "zh-TW": {
      "maker": "韓國 Rotem（機電：日本東芝）",
      "year": "2001～2002 年",
      "count": "14 組 56 輛",
      "formation": "4 輛一組",
      "speed": "110 km/h",
      "notes": [
        "機電系統採用日本東芝產品，加速性能與 EMU500 並列為台鐵啟動加速度最快的車種。"
      ]
    },
    "en": {
      "maker": "Rotem, Korea (electrical: Toshiba, Japan)",
      "year": "2001–2002",
      "count": "14 sets, 56 cars",
      "formation": "4 cars per set",
      "speed": "110 km/h",
      "notes": [
        "Its electrical equipment comes from Toshiba of Japan, and its acceleration ties with the EMU500 as the fastest starting acceleration of any Taiwan Railway type."
      ]
    },
    "ja": {
      "maker": "韓国 Rotem（電機：日本 東芝）",
      "year": "2001～2002年",
      "count": "14編成56両",
      "formation": "4両1編成",
      "speed": "110 km/h",
      "notes": [
        "電機システムは日本の東芝製で、加速性能はEMU500と並んで、台鉄で起動加速度がもっとも高い形式です。"
      ]
    },
    "ko": {
      "maker": "한국 Rotem(전기 장치: 일본 도시바)",
      "year": "2001~2002년",
      "count": "14편성 56량",
      "formation": "4량 1편성",
      "speed": "110 km/h",
      "notes": [
        "전기 시스템은 일본 도시바 제품이고, 가속 성능은 EMU500과 함께 대만철도에서 기동 가속도가 가장 빠른 차종이에요."
      ]
    }
  },
  "emu700": {
    "zh-TW": {
      "nick": "阿福號、戽斗車、小夫",
      "maker": "日本車輛、台灣車輛；機電：日本東芝",
      "year": "2007 年起",
      "count": "160 輛",
      "speed": "110 km/h（營運；設計 120 km/h）",
      "notes": [
        "2007 年 8 月 29 日起，台鐵的區間快車改由這類通勤電聯車行駛，原本是電力機車牽引的客車編組。",
        "車頭前端有連結器罩，造型被認為像《哆啦A夢》小夫（舊譯阿福）的尖嘴，因此有「阿福號」「戽斗車」等綽號。"
      ]
    },
    "en": {
      "nick": "A-Fu train, Underbite Car (Hudou), Suneo",
      "maker": "Nippon Sharyo, Taiwan Car; electrical: Toshiba, Japan",
      "year": "Since 2007",
      "count": "160 cars",
      "speed": "110 km/h (in service; 120 km/h design)",
      "notes": [
        "From August 29, 2007, Taiwan Railway’s Fast Local services were taken over by this type of commuter EMU; they had previously been locomotive-hauled coach sets.",
        "A coupler cover at the front is thought to resemble the pointed mouth of Suneo from Doraemon (formerly translated in Taiwan as A-Fu), hence nicknames like “A-Fu train” and “Underbite Car”."
      ]
    },
    "ja": {
      "nick": "阿福号、戽斗車、スネ夫",
      "maker": "日本車輌製造、台湾車輌、電機：日本 東芝",
      "year": "2007年から",
      "count": "160両",
      "speed": "110 km/h（営業運転。設計は120 km/h）",
      "notes": [
        "2007年8月29日から、台鉄の区間快車はこのタイプの通勤電車が走るようになりました。それまでは電気機関車が牽引する客車編成でした。",
        "先頭部の連結器カバーの形が、『ドラえもん』のスネ夫（台湾での旧訳は「阿福」）のとがった口に似ているとされ、「阿福号」「戽斗車」といった愛称がつきました。"
      ]
    },
    "ko": {
      "nick": "아푸호, 주걱턱 차(후더우), 비실이(스네오)",
      "maker": "닛폰샤료, 대만차량, 전기 장치: 일본 도시바",
      "year": "2007년부터",
      "count": "160량",
      "speed": "110 km/h(운행 기준, 설계 120 km/h)",
      "notes": [
        "2007년 8월 29일부터 대만철도의 구간쾌속은 이 통근 전동차가 맡게 됐어요. 그 전에는 전기 기관차가 끄는 객차 편성이었어요.",
        "앞부분의 연결기 덮개 모양이 《도라에몽》 비실이(스네오)의 뾰족한 입을 닮았다고 해서 ‘아푸호’, ‘주걱턱 차’ 같은 별명이 붙었어요. ‘아푸’는 비실이의 예전 대만 번역명이에요."
      ]
    }
  },
  "emu800": {
    "zh-TW": {
      "nick": "微笑號",
      "maker": "台灣車輛、日本車輛（機電：日本東芝）",
      "year": "2013～2016 年",
      "count": "43 列 344 輛",
      "formation": "8 輛一列",
      "speed": "130 km/h",
      "notes": [
        "預算一度增加為 370 輛，多次流標後縮減為 296 輛，後來又增購 6 列 48 輛。",
        "車側黃色帶往車頭弧形下收，看起來像一張笑臉，車頭側面還繪有結合自行車圖案的「800」標誌。"
      ]
    },
    "en": {
      "nick": "Smile train",
      "maker": "Taiwan Car, Nippon Sharyo (electrical: Toshiba, Japan)",
      "year": "2013–2016",
      "count": "43 trains, 344 cars",
      "formation": "8 cars per train",
      "speed": "130 km/h",
      "notes": [
        "The budget once grew to 370 cars, was cut to 296 cars after repeated failed tenders, and later 6 more sets, 48 cars, were added.",
        "The yellow stripe along the side curves downward at the front end like a smiling face, and the side of the nose also carries an “800” emblem combined with a bicycle design."
      ]
    },
    "ja": {
      "nick": "微笑号",
      "maker": "台湾車輌、日本車輌製造（電機：日本 東芝）",
      "year": "2013～2016年",
      "count": "43編成344両",
      "formation": "8両1編成",
      "speed": "130 km/h",
      "notes": [
        "予算は一時370両に増えましたが、入札が何度も不調に終わって296両に縮小され、のちに6編成48両が追加されました。",
        "側面の黄色い帯が先頭部で弧を描いて下がり、笑顔のように見えます。先頭部の側面には、自転車の絵柄と組み合わせた「800」のマークもあります。"
      ]
    },
    "ko": {
      "nick": "스마일호",
      "maker": "대만차량, 닛폰샤료(전기 장치: 일본 도시바)",
      "year": "2013~2016년",
      "count": "43편성 344량",
      "formation": "8량 1편성",
      "speed": "130 km/h",
      "notes": [
        "예산이 한때 370량으로 늘었다가 입찰이 여러 번 유찰되면서 296량으로 줄었고, 나중에 6편성 48량을 더 샀어요.",
        "옆면의 노란 띠가 앞부분에서 호를 그리며 내려와 웃는 얼굴처럼 보이고, 앞부분 옆면에는 자전거 그림과 합친 ‘800’ 마크도 그려져 있어요."
      ]
    }
  },
  "emu800r": {
    "zh-TW": {
      "count": "增購 48 輛",
      "formation": "8 輛一列",
      "speed": "130 km/h",
      "notes": [
        "EMU800 的增購車，車頭端面的黃、藍色塗裝和原車對調。"
      ]
    },
    "en": {
      "count": "48 supplementary cars",
      "formation": "8 cars per train",
      "speed": "130 km/h",
      "notes": [
        "The supplementary batch of the EMU800; the yellow and blue paint on the front end is swapped compared with the original cars."
      ]
    },
    "ja": {
      "count": "増備48両",
      "formation": "8両1編成",
      "speed": "130 km/h",
      "notes": [
        "EMU800の増備車で、先頭部の黄色と青の塗装がもとの車両と入れ替わっています。"
      ]
    },
    "ko": {
      "count": "추가 도입 48량",
      "formation": "8량 1편성",
      "speed": "130 km/h",
      "notes": [
        "EMU800의 추가 도입 차량으로, 앞부분의 노랑·파랑 도색이 원래 차량과 서로 바뀌어 있어요."
      ]
    }
  },
  "emu900": {
    "zh-TW": {
      "maker": "韓國現代 Rotem（機電：日本東芝）",
      "year": "2020 年起",
      "count": "52 列 520 輛",
      "formation": "10 輛一列",
      "notes": [
        "內外設計由現代 Rotem 和法國 MBD 設計團隊合作。"
      ]
    },
    "en": {
      "maker": "Hyundai Rotem, Korea (electrical: Toshiba, Japan)",
      "year": "From 2020",
      "count": "52 trains, 520 cars",
      "formation": "10 cars per train",
      "notes": [
        "The interior and exterior were designed jointly by Hyundai Rotem and the French design team MBD."
      ]
    },
    "ja": {
      "maker": "韓国 現代ロテム（電機：日本 東芝）",
      "year": "2020年から",
      "count": "52編成520両",
      "formation": "10両1編成",
      "notes": [
        "内外装のデザインは、現代ロテムとフランスのMBDデザインチームが共同で手がけました。"
      ]
    },
    "ko": {
      "maker": "한국 현대로템(전기 장치: 일본 도시바)",
      "year": "2020년부터",
      "count": "52편성 520량",
      "formation": "10량 1편성",
      "notes": [
        "내외부 디자인은 현대로템과 프랑스 MBD 디자인 팀이 함께 맡았어요."
      ]
    }
  },
  "emu3000": {
    "zh-TW": {
      "nick": "新自強號",
      "maker": "日本日立",
      "year": "2021 年起",
      "count": "50 列 600 輛",
      "formation": "12 輛一列",
      "speed": "130 km/h（設計 150）",
      "notes": [
        "不做傾斜機構，是台鐵再度引進的非傾斜式城際列車。",
        "車身以白色為主，車廂連接處附近上緣點綴彩色邊條。"
      ]
    },
    "en": {
      "nick": "New Tze-Chiang",
      "maker": "Hitachi, Japan",
      "year": "From 2021",
      "count": "50 trains, 600 cars",
      "formation": "12 cars per train",
      "speed": "130 km/h (design 150)",
      "notes": [
        "It has no tilting mechanism; it is the non-tilting intercity train that Taiwan Railway has introduced once again.",
        "The body is mainly white, with colored stripes along the upper edge near the car joints."
      ]
    },
    "ja": {
      "nick": "新自強号",
      "maker": "日本 日立製作所",
      "year": "2021年から",
      "count": "50編成600両",
      "formation": "12両1編成",
      "speed": "130 km/h（設計150）",
      "notes": [
        "車体傾斜装置はなく、台鉄が再び導入した非振り子式の都市間列車です。",
        "車体は白が基調で、車両の連結部付近の上部にカラーのラインがあしらわれています。"
      ]
    },
    "ko": {
      "nick": "신형 쯔창호",
      "maker": "일본 히타치",
      "year": "2021년부터",
      "count": "50편성 600량",
      "formation": "12량 1편성",
      "speed": "130 km/h(설계 150)",
      "notes": [
        "틸팅 장치가 없는, 대만철도가 다시 들여온 비틸팅식 도시 간 열차예요.",
        "차체는 흰색이 기본이고, 객차 연결부 근처 윗부분에 색깔 띠가 포인트로 들어가요."
      ]
    }
  },
  "temu1000": {
    "zh-TW": {
      "maker": "日本日立",
      "year": "2006～2007 年（2016 年增購）",
      "count": "8 列 64 輛",
      "formation": "8 輛一列",
      "speed": "130 km/h",
      "notes": [
        "「太魯閣號」這個名字是公開徵名選出來的。",
        "設計源自日本 JR 九州的 885 系電聯車。"
      ]
    },
    "en": {
      "maker": "Hitachi, Japan",
      "year": "2006–2007 (more bought in 2016)",
      "count": "8 trains, 64 cars",
      "formation": "8 cars per train",
      "speed": "130 km/h",
      "notes": [
        "The name “Taroko” was chosen through a public naming contest.",
        "The design is derived from JR Kyushu’s Series 885 EMU."
      ]
    },
    "ja": {
      "maker": "日本 日立製作所",
      "year": "2006～2007年（2016年に増備）",
      "count": "8編成64両",
      "formation": "8両1編成",
      "speed": "130 km/h",
      "notes": [
        "「太魯閣号」という名前は、一般公募で選ばれました。",
        "デザインはJR九州の885系電車に由来します。"
      ]
    },
    "ko": {
      "maker": "일본 히타치",
      "year": "2006~2007년(2016년 추가 도입)",
      "count": "8편성 64량",
      "formation": "8량 1편성",
      "speed": "130 km/h",
      "notes": [
        "‘타이루거호’라는 이름은 공개 모집으로 정해졌어요.",
        "디자인은 일본 JR 규슈의 885계 전동차에서 유래했어요."
      ]
    }
  },
  "temu2000": {
    "zh-TW": {
      "maker": "日本車輛（機電：日本東芝）",
      "year": "2012～2015 年",
      "count": "19 列 152 輛",
      "formation": "8 輛一列",
      "speed": "130 km/h",
      "notes": [
        "2016 年引進的列車車頭旁加了「猴」字塗裝。",
        "2015 年底增購的兩列配置了半主動懸吊系統。"
      ]
    },
    "en": {
      "maker": "Nippon Sharyo, Japan (electrical: Toshiba, Japan)",
      "year": "2012–2015",
      "count": "19 trains, 152 cars",
      "formation": "8 cars per train",
      "speed": "130 km/h",
      "notes": [
        "Trains introduced in 2016 carry a “猴” (monkey) character painted beside the nose.",
        "The two sets added at the end of 2015 are fitted with a semi-active suspension system."
      ]
    },
    "ja": {
      "maker": "日本車輌製造（電機：日本 東芝）",
      "year": "2012～2015年",
      "count": "19編成152両",
      "formation": "8両1編成",
      "speed": "130 km/h",
      "notes": [
        "2016年に導入された列車には、先頭部の脇に「猴」（さる）の字が塗られています。",
        "2015年末に増備された2編成には、セミアクティブサスペンションが装備されています。"
      ]
    },
    "ko": {
      "maker": "닛폰샤료(전기 장치: 일본 도시바)",
      "year": "2012~2015년",
      "count": "19편성 152량",
      "formation": "8량 1편성",
      "speed": "130 km/h",
      "notes": [
        "2016년에 들여온 열차에는 앞부분 옆에 ‘猴’(원숭이) 글자가 칠해져 있어요.",
        "2015년 말에 추가로 도입한 두 편성에는 반능동식 현가 장치가 달려 있어요."
      ]
    }
  },
  "700t": {
    "zh-TW": {
      "maker": "日本川崎重工、日本車輛、日立",
      "year": "2007 年",
      "count": "34 列（先 30 列，後增購 4 列）",
      "formation": "12 節一列",
      "speed": "300 km/h",
      "notes": [
        "台灣高鐵 1999 年重新招標核心技術合約；日本政府當時提議，若改採新幹線技術將提供低利貸款。",
        "車門要先由司機員按下「車門釋放」鍵，列車長才能開門。"
      ]
    },
    "en": {
      "maker": "Kawasaki Heavy Industries, Nippon Sharyo, Hitachi, Japan",
      "year": "2007",
      "count": "34 trains (30 at first, 4 added later)",
      "formation": "12 cars per train",
      "speed": "300 km/h",
      "notes": [
        "Taiwan High Speed Rail re-tendered its core technology contract in 1999; Japan’s government proposed at the time to offer low-interest loans if Shinkansen technology were adopted.",
        "The driver must first press the “door release” button before the train manager can open the doors."
      ]
    },
    "ja": {
      "maker": "日本 川崎重工、日本車輌製造、日立製作所",
      "year": "2007年",
      "count": "34編成（当初30編成、のちに4編成増備）",
      "formation": "12両1編成",
      "speed": "300 km/h",
      "notes": [
        "台湾高速鉄道は1999年に中核技術の契約を再入札しました。当時、日本政府は新幹線の技術を採用すれば低利の融資を提供すると提案しました。",
        "ドアは、まず運転士が「ドア解放」ボタンを押してからでないと、車掌が開けられません。"
      ]
    },
    "ko": {
      "maker": "일본 가와사키 중공업, 닛폰샤료, 히타치",
      "year": "2007년",
      "count": "34편성(처음 30편성, 이후 4편성 추가)",
      "formation": "12량 1편성",
      "speed": "300 km/h",
      "notes": [
        "대만 고속철도는 1999년에 핵심 기술 계약을 다시 입찰에 부쳤어요. 당시 일본 정부는 신칸센 기술을 채택하면 저리 대출을 제공하겠다고 제안했어요.",
        "문은 기관사가 먼저 ‘문 해제’ 버튼을 눌러야 차장이 열 수 있어요."
      ]
    }
  },
  "c301": {
    "zh-TW": {
      "maker": "日本川崎重工、美國 URC",
      "year": "1992～1993 年",
      "count": "22 列 132 輛",
      "formation": "6 輛一列",
      "notes": [
        "台灣首款行駛於標準軌的列車。"
      ]
    },
    "en": {
      "maker": "Kawasaki Heavy Industries, Japan; URC, USA",
      "year": "1992–1993",
      "count": "22 trains, 132 cars",
      "formation": "6 cars per train",
      "notes": [
        "Taiwan’s first train to run on standard gauge."
      ]
    },
    "ja": {
      "maker": "日本 川崎重工、アメリカ URC",
      "year": "1992～1993年",
      "count": "22編成132両",
      "formation": "6両1編成",
      "notes": [
        "台湾で初めて標準軌を走った列車です。"
      ]
    },
    "ko": {
      "maker": "일본 가와사키 중공업, 미국 URC",
      "year": "1992~1993년",
      "count": "22편성 132량",
      "formation": "6량 1편성",
      "notes": [
        "대만 최초로 표준궤를 달린 열차예요."
      ]
    }
  },
  "c321": {
    "zh-TW": {
      "maker": "德國西門子（南非聯邦鐵路客貨車公司、中鋼組裝）",
      "year": "1998～1999 年",
      "count": "36 列 216 輛",
      "formation": "6 輛一列",
      "notes": [
        "原本各條高運量路線都有配屬，2009 年 3 月全數移交到板南線，統一維修與調度。"
      ]
    },
    "en": {
      "maker": "Siemens, Germany (assembled by UCW of South Africa and China Steel)",
      "year": "1998–1999",
      "count": "36 trains, 216 cars",
      "formation": "6 cars per train",
      "notes": [
        "Originally it was assigned to each high-capacity line; in March 2009 all units were transferred to the Bannan Line for unified maintenance and dispatch."
      ]
    },
    "ja": {
      "maker": "ドイツ シーメンス（南アフリカ ユニオン・キャリッジ・アンド・ワゴン、中鋼が組み立て）",
      "year": "1998～1999年",
      "count": "36編成216両",
      "formation": "6両1編成",
      "notes": [
        "もとは各高運量路線に配置されていましたが、2009年3月に整備と運用を一本化するため、全車が板南線に移されました。"
      ]
    },
    "ko": {
      "maker": "독일 지멘스(남아프리카 유니언 캐리지 앤드 왜건, 중국강철이 조립)",
      "year": "1998~1999년",
      "count": "36편성 216량",
      "formation": "6량 1편성",
      "notes": [
        "원래는 각 고수송량 노선에 배치됐는데, 2009년 3월에 정비와 운용을 통일하려고 전 차량을 반난선으로 옮겼어요."
      ]
    }
  },
  "c341": {
    "zh-TW": {
      "maker": "德國西門子",
      "year": "2003 年",
      "count": "6 列 36 輛",
      "formation": "6 輛一列",
      "notes": [
        "外觀和 C321 大致相同，341 型車身較容易反光，車頭逃生門的外框線條也較粗。"
      ]
    },
    "en": {
      "maker": "Siemens, Germany",
      "year": "2003",
      "count": "6 trains, 36 cars",
      "formation": "6 cars per train",
      "notes": [
        "It looks much like the C321, but the Type 341 body reflects light more easily and the frame lines around the front escape door are thicker."
      ]
    },
    "ja": {
      "maker": "ドイツ シーメンス",
      "year": "2003年",
      "count": "6編成36両",
      "formation": "6両1編成",
      "notes": [
        "外観はC321とほぼ同じですが、341形は車体が光を反射しやすく、先頭部の非常口の枠線も太めです。"
      ]
    },
    "ko": {
      "maker": "독일 지멘스",
      "year": "2003년",
      "count": "6편성 36량",
      "formation": "6량 1편성",
      "notes": [
        "겉모습은 C321과 거의 같지만, 341형은 차체가 빛을 더 잘 반사하고 앞부분 비상문의 테두리 선도 더 굵어요."
      ]
    }
  },
  "c371": {
    "zh-TW": {
      "maker": "日本川崎重工、台灣車輛",
      "year": "2005～2009 年",
      "count": "321 輛（6 節 52 列、3 節 3 列）",
      "formation": "6 輛或 3 輛一列",
      "notes": [
        "車組編號分 3 系與 4 系，4 系車主要行駛中和新蘆線。",
        "399 號車組是溫泉主題彩繪列車，行駛新北投支線。"
      ]
    },
    "en": {
      "maker": "Kawasaki Heavy Industries, Japan; Taiwan Car",
      "year": "2005–2009",
      "count": "321 cars (52 six-car trains, 3 three-car trains)",
      "formation": "6 or 3 cars per train",
      "notes": [
        "Trainset numbers are split into the 3-series and the 4-series; the 4-series cars mainly run on the Zhonghe–Xinlu Line.",
        "Trainset 399 is a hot-spring-themed painted train and runs on the Xinbeitou branch."
      ]
    },
    "ja": {
      "maker": "日本 川崎重工、台湾車輌",
      "year": "2005～2009年",
      "count": "321両（6両編成52本、3両編成3本）",
      "formation": "6両または3両1編成",
      "notes": [
        "編成番号は3系と4系に分かれ、4系は主に中和新蘆線を走っています。",
        "399編成は温泉をテーマにしたラッピング列車で、新北投支線を走っています。"
      ]
    },
    "ko": {
      "maker": "일본 가와사키 중공업, 대만차량",
      "year": "2005~2009년",
      "count": "321량(6량 편성 52개, 3량 편성 3개)",
      "formation": "6량 또는 3량 1편성",
      "notes": [
        "편성 번호는 3번대와 4번대로 나뉘고, 4번대 열차는 주로 중허신루선을 달려요.",
        "399 편성은 온천을 주제로 한 래핑 열차로, 신베이터우 지선을 달려요."
      ]
    }
  },
  "c381": {
    "zh-TW": {
      "maker": "日本川崎重工、台灣車輛",
      "year": "2010～2013 年",
      "count": "24 列 144 輛",
      "formation": "6 輛一列",
      "notes": [
        "擋風玻璃採立體曲面設計，車輛連結處增設防墜擋板。",
        "為配合松山線及信義線興建而增備的電聯車。"
      ]
    },
    "en": {
      "maker": "Kawasaki Heavy Industries, Japan; Taiwan Car",
      "year": "2010–2013",
      "count": "24 trains, 144 cars",
      "formation": "6 cars per train",
      "notes": [
        "The windshield has a three-dimensional curved design, and anti-fall barriers have been added at the car joints.",
        "These EMUs were added to match the construction of the Songshan and Xinyi lines."
      ]
    },
    "ja": {
      "maker": "日本 川崎重工、台湾車輌",
      "year": "2010～2013年",
      "count": "24編成144両",
      "formation": "6両1編成",
      "notes": [
        "前面ガラスは立体曲面の設計で、車両の連結部には転落防止板が追加されています。",
        "松山線と信義線の建設に合わせて増備された電車です。"
      ]
    },
    "ko": {
      "maker": "일본 가와사키 중공업, 대만차량",
      "year": "2010~2013년",
      "count": "24편성 144량",
      "formation": "6량 1편성",
      "notes": [
        "앞유리는 입체 곡면 설계이고, 객차 연결부에는 추락 방지 판이 추가됐어요.",
        "쑹산선과 신이선 건설에 맞춰 추가로 도입한 전동차예요."
      ]
    }
  },
  "val256": {
    "zh-TW": {
      "maker": "法國馬特拉、阿爾斯通",
      "year": "1990～1993 年",
      "count": "51 組 102 輛",
      "formation": "2 輛一組，可連掛成 4 輛",
      "notes": [
        "1997 年馬特拉與台北市捷運局起合約糾紛、撤走技術人員，時任市長陳水扁留下「馬特拉不拉，我們自己拉」這句話。"
      ]
    },
    "en": {
      "maker": "Matra and Alstom, France",
      "year": "1990–1993",
      "count": "51 sets, 102 cars",
      "formation": "2 cars per set, can be coupled into 4 cars",
      "notes": [
        "In 1997 Matra fell into a contract dispute with the Taipei Department of Rapid Transit Systems and withdrew its technicians; then-mayor Chen Shui-bian left the line “If Matra won’t pull, we’ll pull ourselves.”"
      ]
    },
    "ja": {
      "maker": "フランス マトラ、アルストム",
      "year": "1990～1993年",
      "count": "51編成102両",
      "formation": "2両1組、連結して4両にもできる",
      "notes": [
        "1997年にマトラと台北市捷運局が契約をめぐって対立し、マトラは技術者を引き揚げました。当時の陳水扁市長は「マトラが引かないなら、われわれが自分で引く」という言葉を残しました。"
      ]
    },
    "ko": {
      "maker": "프랑스 마트라, 알스톰",
      "year": "1990~1993년",
      "count": "51편성 102량",
      "formation": "2량 1조, 연결해서 4량으로 운행 가능",
      "notes": [
        "1997년 마트라와 타이베이시 지하철국이 계약 분쟁을 벌여 마트라가 기술자를 철수시켰어요. 당시 천수이볜 시장은 ‘마트라가 안 끌면 우리가 직접 끈다’는 말을 남겼어요."
      ]
    }
  },
  "wenhu": {
    "zh-TW": {
      "maker": "龐巴迪",
      "year": "2006～2009 年",
      "count": "101 組 202 輛",
      "formation": "4 輛一列"
    },
    "en": {
      "maker": "Bombardier",
      "year": "2006–2009",
      "count": "101 sets, 202 cars",
      "formation": "4 cars per train"
    },
    "ja": {
      "maker": "ボンバルディア",
      "year": "2006～2009年",
      "count": "101対202両",
      "formation": "4両1編成"
    },
    "ko": {
      "maker": "봄바르디어",
      "year": "2006~2009년",
      "count": "101편성 202량",
      "formation": "4량 1편성"
    }
  },
  "y100": {
    "zh-TW": {
      "maker": "日立軌道義大利、台灣車輛",
      "year": "2017～2018 年",
      "count": "17 列 68 輛",
      "formation": "4 輛一列",
      "notes": [
        "使用與高運量列車相同的鋼輪行駛。"
      ]
    },
    "en": {
      "maker": "Hitachi Rail Italy, Taiwan Car",
      "year": "2017–2018",
      "count": "17 trains, 68 cars",
      "formation": "4 cars per train",
      "notes": [
        "It runs on the same steel wheels as the high-capacity trains."
      ]
    },
    "ja": {
      "maker": "日立レール・イタリア、台湾車輌",
      "year": "2017～2018年",
      "count": "17編成68両",
      "formation": "4両1編成",
      "notes": [
        "高運量電車と同じ鉄車輪で走ります。"
      ]
    },
    "ko": {
      "maker": "히타치 레일 이탈리아, 대만차량",
      "year": "2017~2018년",
      "count": "17편성 68량",
      "formation": "4량 1편성",
      "notes": [
        "고수송량 열차와 같은 강철 바퀴로 달려요."
      ]
    }
  },
  "danhai": {
    "zh-TW": {
      "nick": "行武者",
      "maker": "台灣車輛",
      "year": "2016～2017 年",
      "count": "15 列",
      "formation": "5 節一列",
      "notes": [
        "是台灣邁向「國車國造」的重要里程碑之一。",
        "102、105、109 號列車的車廂裡，有插畫家幾米的彩繪。"
      ]
    },
    "en": {
      "nick": "Xingwuzhe",
      "maker": "Taiwan Car",
      "year": "2016–2017",
      "count": "15 trains",
      "formation": "5 modules per train",
      "notes": [
        "It is one of the important milestones on Taiwan’s road to “domestically built trains”.",
        "Trains 102, 105 and 109 carry artwork by illustrator Jimmy Liao inside the cars."
      ]
    },
    "ja": {
      "nick": "行武者",
      "maker": "台湾車輌",
      "year": "2016～2017年",
      "count": "15編成",
      "formation": "5モジュール1編成",
      "notes": [
        "台湾が「国産車両」へ向かううえでの重要な節目のひとつです。",
        "102・105・109号編成の車内には、イラストレーター幾米（ジミー・リャオ）の絵が描かれています。"
      ]
    },
    "ko": {
      "nick": "싱우저",
      "maker": "대만차량",
      "year": "2016~2017년",
      "count": "15편성",
      "formation": "5모듈 1편성",
      "notes": [
        "대만이 ‘국산 차량’으로 나아가는 길의 중요한 이정표 가운데 하나예요.",
        "102·105·109호 열차 안에는 일러스트레이터 지미(幾米)의 그림이 그려져 있어요."
      ]
    }
  },
  "ankeng": {
    "zh-TW": {
      "maker": "台灣車輛",
      "count": "15 列",
      "formation": "5 節一列",
      "notes": [
        "編組設計和淡海輕軌電聯車相同。"
      ]
    },
    "en": {
      "maker": "Taiwan Car",
      "count": "15 trains",
      "formation": "5 modules per train",
      "notes": [
        "The trainset design is the same as that of the Danhai Light Rail trains."
      ]
    },
    "ja": {
      "maker": "台湾車輌",
      "count": "15編成",
      "formation": "5モジュール1編成",
      "notes": [
        "編成の設計は淡海ライトレールの電車と同じです。"
      ]
    },
    "ko": {
      "maker": "대만차량",
      "count": "15편성",
      "formation": "5모듈 1편성",
      "notes": [
        "편성 설계는 단하이 경전철 전동차와 같아요."
      ]
    }
  },
  "airportlocal": {
    "zh-TW": {
      "maker": "日本川崎重工、台灣車輛",
      "year": "2011～2012 年、2015 年",
      "count": "20 列 80 輛",
      "formation": "4 輛一列（全是動力車）"
    },
    "en": {
      "maker": "Kawasaki Heavy Industries, Japan; Taiwan Car",
      "year": "2011–2012, 2015",
      "count": "20 trains, 80 cars",
      "formation": "4 cars per train (all motor cars)"
    },
    "ja": {
      "maker": "日本 川崎重工、台湾車輌",
      "year": "2011～2012年、2015年",
      "count": "20編成80両",
      "formation": "4両1編成（全車動力車）"
    },
    "ko": {
      "maker": "일본 가와사키 중공업, 대만차량",
      "year": "2011~2012년, 2015년",
      "count": "20편성 80량",
      "formation": "4량 1편성(전부 동력차)"
    }
  },
  "airportexpress": {
    "zh-TW": {
      "maker": "日本川崎重工",
      "year": "2011～2013 年",
      "count": "11 列 55 輛",
      "formation": "5 輛一列（全是動力車）",
      "notes": [
        "5 節編組中的第 5 節是行李車廂；機場線分普通車（1000 型）與直達車（2000 型）。"
      ]
    },
    "en": {
      "maker": "Kawasaki Heavy Industries, Japan",
      "year": "2011–2013",
      "count": "11 trains, 55 cars",
      "formation": "5 cars per train (all motor cars)",
      "notes": [
        "The fifth car of the 5-car set is a baggage car; the Airport Line runs both local trains (Type 1000) and express trains (Type 2000)."
      ]
    },
    "ja": {
      "maker": "日本 川崎重工",
      "year": "2011～2013年",
      "count": "11編成55両",
      "formation": "5両1編成（全車動力車）",
      "notes": [
        "5両編成の5両目は荷物車両です。空港線には普通車（1000形）と直達車（2000形）があります。"
      ]
    },
    "ko": {
      "maker": "일본 가와사키 중공업",
      "year": "2011~2013년",
      "count": "11편성 55량",
      "formation": "5량 1편성(전부 동력차)",
      "notes": [
        "5량 편성 중 5번째 칸은 수하물 객차예요. 공항선에는 보통 열차(1000형)와 직통 열차(2000형)가 있어요."
      ]
    }
  },
  "taichung": {
    "zh-TW": {
      "maker": "日本川崎重工、台灣車輛",
      "year": "2017 年",
      "count": "18 列 36 輛",
      "formation": "2 輛一列"
    },
    "en": {
      "maker": "Kawasaki Heavy Industries, Japan; Taiwan Car",
      "year": "2017",
      "count": "18 trains, 36 cars",
      "formation": "2 cars per train"
    },
    "ja": {
      "maker": "日本 川崎重工、台湾車輌",
      "year": "2017年",
      "count": "18編成36両",
      "formation": "2両1編成"
    },
    "ko": {
      "maker": "일본 가와사키 중공업, 대만차량",
      "year": "2017년",
      "count": "18편성 36량",
      "formation": "2량 1편성"
    }
  },
  "kaohsiung": {
    "zh-TW": {
      "maker": "德國西門子",
      "year": "2005～2007 年",
      "count": "42 列 126 輛",
      "formation": "3 輛一列（可擴充到 6 輛）"
    },
    "en": {
      "maker": "Siemens, Germany",
      "year": "2005–2007",
      "count": "42 trains, 126 cars",
      "formation": "3 cars per train (expandable to 6)"
    },
    "ja": {
      "maker": "ドイツ シーメンス",
      "year": "2005～2007年",
      "count": "42編成126両",
      "formation": "3両1編成（6両まで増結可能）"
    },
    "ko": {
      "maker": "독일 지멘스",
      "year": "2005~2007년",
      "count": "42편성 126량",
      "formation": "3량 1편성(6량까지 늘릴 수 있음)"
    }
  },
  "caf": {
    "zh-TW": {
      "maker": "西班牙 CAF",
      "year": "2014 年起（首列 2014 年 9 月運抵臺灣）",
      "count": "9 列 45 輛",
      "formation": "5 節一列",
      "notes": [
        "高雄環狀輕軌是臺灣第一條輕軌路線。"
      ]
    },
    "en": {
      "maker": "CAF, Spain",
      "year": "From 2014 (the first train arrived in Taiwan in September 2014)",
      "count": "9 trains, 45 cars",
      "formation": "5 modules per train",
      "notes": [
        "The Kaohsiung Circular Light Rail is Taiwan’s first light-rail line."
      ]
    },
    "ja": {
      "maker": "スペイン CAF",
      "year": "2014年から（1編成目は2014年9月に台湾へ到着）",
      "count": "9編成45両",
      "formation": "5モジュール1編成",
      "notes": [
        "高雄環状ライトレールは台湾で最初のライトレール路線です。"
      ]
    },
    "ko": {
      "maker": "스페인 CAF",
      "year": "2014년부터(첫 편성은 2014년 9월 대만에 도착)",
      "count": "9편성 45량",
      "formation": "5모듈 1편성",
      "notes": [
        "가오슝 순환 경전철은 대만 최초의 경전철 노선이에요."
      ]
    }
  },
  "citadis": {
    "zh-TW": {
      "maker": "法國阿爾斯通",
      "year": "2018～2019 年交車",
      "count": "15 列 75 輛",
      "formation": "5 節一列"
    },
    "en": {
      "maker": "Alstom, France",
      "year": "Delivered 2018–2019",
      "count": "15 trains, 75 cars",
      "formation": "5 modules per train"
    },
    "ja": {
      "maker": "フランス アルストム",
      "year": "2018～2019年に納入",
      "count": "15編成75両",
      "formation": "5モジュール1編成"
    },
    "ko": {
      "maker": "프랑스 알스톰",
      "year": "2018~2019년 인도",
      "count": "15편성 75량",
      "formation": "5모듈 1편성"
    }
  },
  "juguang": {
    "zh-TW": {
      "maker": "日本車輛、日立（35SP32850 型）",
      "year": "1970 年起",
      "notes": [
        "1970 年代的莒光號車廂內裝有地毯與絲絨沙發座椅。",
        "1995 年之後新造或改造的莒光號配置了雙車門（自動門）與 LED 裝置，10400 系列是新造車。"
      ]
    },
    "en": {
      "maker": "Nippon Sharyo and Hitachi, Japan (Type 35SP32850)",
      "year": "From 1970",
      "notes": [
        "The interiors of 1970s Chu-Kuang coaches had carpet and velvet sofa-style seats.",
        "Chu-Kuang coaches built or rebuilt after 1995 have dual doors (automatic doors) and LED displays; the 10400 series are newly built cars."
      ]
    },
    "ja": {
      "maker": "日本車輌製造、日立製作所（35SP32850形）",
      "year": "1970年から",
      "notes": [
        "1970年代の莒光号の車内には、じゅうたんとビロード張りのソファ風シートがありました。",
        "1995年以降に新造または改造された莒光号には、2か所のドア（自動ドア）とLED表示装置が備えられました。10400系は新造車両です。"
      ]
    },
    "ko": {
      "maker": "닛폰샤료, 히타치(35SP32850형)",
      "year": "1970년부터",
      "notes": [
        "1970년대 쥐광호 객차 내부에는 카펫과 벨벳 소파형 좌석이 있었어요.",
        "1995년 이후 새로 만들었거나 개조한 쥐광호에는 이중 출입문(자동문)과 LED 장치가 갖춰졌어요. 10400계는 새로 만든 차량이에요."
      ]
    }
  },
  "ppcoach": {
    "zh-TW": {
      "maker": "唐榮鐵工廠",
      "year": "2001～2002 年",
      "count": "32 輛",
      "notes": [
        "一開始是半客室、半餐車設計，後來因餐車營運績效不彰，改成快遞及自行車載運車。",
        "2017 年將其中 20 輛改造為親子車廂，其餘改為附壁掛式自行車架的多用途車廂。"
      ]
    },
    "en": {
      "maker": "Tang Eng Iron Works",
      "year": "2001–2002",
      "count": "32 cars",
      "notes": [
        "It started out as a half-passenger, half-dining-car design; later, because the dining service performed poorly, it was converted into express-parcel and bicycle-carrying cars.",
        "In 2017, 20 of them were converted into family cars, and the rest into multi-purpose cars with wall-mounted bicycle racks."
      ]
    },
    "ja": {
      "maker": "唐栄鉄工廠",
      "year": "2001～2002年",
      "count": "32両",
      "notes": [
        "最初は半分が客室、半分が食堂車という設計でしたが、のちに食堂車の営業成績が振るわず、宅配荷物車と自転車運搬車に改造されました。",
        "2017年にそのうち20両が親子車両に、残りが壁掛け式の自転車ラックつきの多目的車両に改造されました。"
      ]
    },
    "ko": {
      "maker": "탕룽 철공장",
      "year": "2001~2002년",
      "count": "32량",
      "notes": [
        "처음에는 반은 객실, 반은 식당차인 설계였는데, 나중에 식당차 영업 실적이 좋지 않아 택배차와 자전거 운반차로 바뀌었어요.",
        "2017년에 그중 20량은 가족 칸으로, 나머지는 벽걸이식 자전거 거치대가 달린 다목적 칸으로 개조했어요."
      ]
    }
  },
  "fuxing": {
    "zh-TW": {
      "maker": "唐榮鐵工廠",
      "year": "1980 年起",
      "count": "20000 系 120 輛",
      "notes": [
        "最早以莒光號附掛的「冷氣對號」稱呼，塗裝與新莒光號相同；1985 年改為天藍色與白色塗裝。"
      ]
    },
    "en": {
      "maker": "Tang Eng Iron Works",
      "year": "From 1980",
      "count": "120 cars of the 20000 series",
      "notes": [
        "It was first called the “air-conditioned reserved-seat” car attached to Chu-Kuang trains, with the same livery as the new Chu-Kuang; in 1985 it was repainted sky blue and white."
      ]
    },
    "ja": {
      "maker": "唐栄鉄工廠",
      "year": "1980年から",
      "count": "20000系120両",
      "notes": [
        "最初は莒光号に連結される「冷房付き指定席」と呼ばれ、塗装は新しい莒光号と同じでした。1985年に空色と白の塗装に改められました。"
      ]
    },
    "ko": {
      "maker": "탕룽 철공장",
      "year": "1980년부터",
      "count": "20000계 120량",
      "notes": [
        "처음에는 쥐광호에 연결하는 ‘에어컨 지정석’이라고 불렸고, 도색은 새 쥐광호와 같았어요. 1985년에 하늘색과 흰색 도색으로 바꿨어요."
      ]
    }
  },
  "mingricoach": {
    "zh-TW": {
      "notes": [
        "鳴日號的商務車廂是 35BCK10700 型；這型是 2005 年由 10500 系的 7 輛客車改造成商務車廂而來。"
      ]
    },
    "en": {
      "notes": [
        "The business car of the Future train is the Type 35BCK10700; this type was converted in 2005 from 7 coaches of the 10500 series into business cars."
      ]
    },
    "ja": {
      "notes": [
        "鳴日号のビジネス車両は35BCK10700形です。この形式は2005年に10500系の客車7両をビジネス車両に改造したものです。"
      ]
    },
    "ko": {
      "notes": [
        "밍르호의 비즈니스 객차는 35BCK10700형이에요. 이 형식은 2005년에 10500계 객차 7량을 비즈니스 객차로 개조한 것이에요."
      ]
    }
  },
  "alicoach": {
    "zh-TW": {
      "notes": [
        "1963 年，中興號開始在阿里山林鐵行駛。",
        "2024 年 7 月 6 日，歷經 15 年修復的阿里山本線（嘉義－阿里山）全線直通復駛。"
      ]
    },
    "en": {
      "notes": [
        "In 1963, the Chung-Hsing train began running on the Alishan Forest Railway.",
        "On July 6, 2024, after 15 years of restoration, the Alishan main line (Chiayi–Alishan) resumed through service along its full length."
      ]
    },
    "ja": {
      "notes": [
        "1963年に、中興号が阿里山森林鉄道で走り始めました。",
        "2024年7月6日、15年にわたる復旧を経て、阿里山本線（嘉義～阿里山）が全線で直通運転を再開しました。"
      ]
    },
    "ko": {
      "notes": [
        "1963년에 중싱호가 아리산 삼림철도에서 달리기 시작했어요.",
        "2024년 7월 6일, 15년에 걸친 복구 끝에 아리산 본선(자이~아리산)이 전 구간 직통 운행을 재개했어요."
      ]
    }
  },
  "emu200": {
    "zh-TW": {
      "maker": "南非 UC&W（車體）、英國 GEC（電機）",
      "year": "1987 年",
      "count": "11 組 33 輛",
      "formation": "3 輛一組",
      "speed": "120 km/h",
      "notes": [
        "3 輛一組，動力車與拖車比例是 2 比 1，加速比前一代 EMU100 更好，最高速度維持 120 km/h。",
        "駕駛端是「貓頭鷹」警戒色；2002 到 2004 年改造成 EMU1200 後，車身換成白底、下緣紅色的塗裝，被鐵道迷稱為「紅斑馬」。"
      ]
    },
    "en": {
      "maker": "UCW, South Africa (bodies); GEC, UK (electrical equipment)",
      "year": "1987",
      "count": "11 sets, 33 cars",
      "formation": "3 cars per set",
      "speed": "120 km/h",
      "notes": [
        "Each set has 3 cars with a 2-to-1 ratio of motor cars to trailers. It accelerates better than the earlier EMU100, while the top speed stays at 120 km/h.",
        "The driver’s end wore the “owl” warning livery. After the 2002–2004 rebuild into the EMU1200, the body was painted white with red along the bottom, and railfans call it the “red zebra”."
      ]
    },
    "ja": {
      "maker": "南アフリカ UC&W（車体）、イギリス GEC（電機）",
      "year": "1987年",
      "count": "11編成33両",
      "formation": "3両1編成",
      "speed": "120 km/h",
      "notes": [
        "3両1編成で、電動車と付随車の比率は2対1です。先代のEMU100より加速がよく、最高速度は120 km/hのままです。",
        "運転台側は「フクロウ」の警戒色でした。2002年から2004年にEMU1200へ改造されると、白地で裾が赤い塗装になり、鉄道ファンから「赤シマウマ」と呼ばれています。"
      ]
    },
    "ko": {
      "maker": "남아프리카 UC&W(차체), 영국 GEC(전기 장비)",
      "year": "1987년",
      "count": "11편성 33량",
      "formation": "3량 1편성",
      "speed": "120 km/h",
      "notes": [
        "3량 1편성이며 전동차와 부수차의 비율은 2대 1이에요. 이전 세대 EMU100보다 가속이 좋고, 최고 속도는 120 km/h를 유지해요.",
        "운전대 쪽은 ‘부엉이’ 경고색이었어요. 2002~2004년 EMU1200으로 개조된 뒤에는 흰 바탕에 아랫단이 붉은 도장이 되어, 철도 팬들은 ‘붉은 얼룩말’이라고 불러요."
      ]
    }
  },
  "dr2800": {
    "zh-TW": {
      "maker": "日本東急車輛",
      "year": "1982 年（首批 10 組）",
      "count": "15 組 45 輛",
      "formation": "3 輛一組（兩端動力車、中間電源拖車）",
      "speed": "110 km/h",
      "notes": [
        "1982 年投入台北到花蓮、台東的路線後，座位經常供不應求。",
        "最多可以 5 組 15 輛重聯，由一處總控運轉。"
      ]
    },
    "en": {
      "maker": "Tokyu Car, Japan",
      "year": "1982 (first 10 sets)",
      "count": "15 sets, 45 cars",
      "formation": "3 cars per set (driving power cars at the ends, generator trailer in the middle)",
      "speed": "110 km/h",
      "notes": [
        "After it began running from Taipei to Hualien and Taitung in 1982, its seats were often in short supply.",
        "Up to 5 sets, 15 cars, can be coupled together and driven from a single cab."
      ]
    },
    "ja": {
      "maker": "日本 東急車輛",
      "year": "1982年（最初の10編成）",
      "count": "15編成45両",
      "formation": "3両1編成（両端が動力車、中間が電源付随車）",
      "speed": "110 km/h",
      "notes": [
        "1982年に台北から花蓮、台東へ走り始めると、座席はしばしば足りなくなりました。",
        "最大5編成15両を連結し、1か所の運転台からまとめて運転できます。"
      ]
    },
    "ko": {
      "maker": "일본 도큐차량",
      "year": "1982년(첫 10편성)",
      "count": "15편성 45량",
      "formation": "3량 1편성(양 끝 동력차, 가운데 전원 부수차)",
      "speed": "110 km/h",
      "notes": [
        "1982년 타이베이에서 화롄, 타이둥으로 달리기 시작한 뒤로 좌석이 자주 모자랐어요.",
        "최대 5편성 15량까지 연결해 한 운전대에서 한꺼번에 운전할 수 있어요."
      ]
    }
  },
  "e100": {
    "zh-TW": {
      "maker": "英國 GEC（電機）、南非 UC&W（車體組裝）",
      "year": "1976 年",
      "count": "20 輛（E101～E120）",
      "power": "2,750 匹馬力",
      "speed": "110 km/h",
      "notes": [
        "英國和南非的電氣化規格跟台鐵不同，沒辦法在當地試車，運到台灣後只能在台北機廠外的試車線測試，早期故障不斷。",
        "車軸配置是 Bo-Bo：兩個轉向架各兩軸，每一軸都有自己的馬達。"
      ]
    },
    "en": {
      "maker": "GEC, UK (electrical equipment); UC&W, South Africa (body assembly)",
      "year": "1976",
      "count": "20 units (E101–E120)",
      "power": "2,750 hp",
      "speed": "110 km/h",
      "notes": [
        "Because the electrification standards in Britain and South Africa differed from Taiwan Railway’s, the locomotives could not be test-run where they were built. In Taiwan they could only be tested on the track outside the Taipei Workshop, and early on they broke down again and again.",
        "The wheel arrangement is Bo-Bo: two bogies with two axles each, every axle driven by its own motor."
      ]
    },
    "ja": {
      "maker": "イギリス GEC（電機）、南アフリカ UC&W（車体組立）",
      "year": "1976年",
      "count": "20両（E101～E120）",
      "power": "2,750馬力",
      "speed": "110 km/h",
      "notes": [
        "イギリスと南アフリカの電化方式が台鉄と違ったため、現地では試運転ができず、台湾に着いてから台北機廠の外の試運転線で試験するしかありませんでした。初期は故障が続きました。",
        "軸配置はBo-Boで、2つの台車にそれぞれ2軸があり、すべての軸に専用のモーターが付いています。"
      ]
    },
    "ko": {
      "maker": "영국 GEC(전기 장비), 남아프리카 UC&W(차체 조립)",
      "year": "1976년",
      "count": "20량(E101～E120)",
      "power": "2,750마력",
      "speed": "110 km/h",
      "notes": [
        "영국과 남아프리카의 전철화 규격이 대만철도와 달라 현지에서는 시운전을 할 수 없었고, 대만에 도착한 뒤 타이베이 공장 밖의 시운전선에서만 시험할 수 있었어요. 초기에는 고장이 끊이지 않았어요.",
        "축 배치는 Bo-Bo로, 대차 두 개에 각각 축이 두 개씩 있고 모든 축에 따로 모터가 달려 있어요."
      ]
    }
  },
  "s200": {
    "zh-TW": {
      "maker": "美國 GM-EMD（原廠型號 GL8）",
      "year": "1960～1961 年",
      "count": "12 輛（S201～S212）",
      "speed": "100 km/h",
      "notes": [
        "GM-EMD 當時推出的新款 GL8 型配有總控重連裝置，能和 G12 型機車重連運轉。",
        "2001 到 2002 年 DHL100 型加入後，調度任務減少，主要改拉臨港線和屏東線的列車，也常在高雄機廠擔任調動機車。"
      ]
    },
    "en": {
      "maker": "GM-EMD, USA (original model GL8)",
      "year": "1960–1961",
      "count": "12 units (S201–S212)",
      "speed": "100 km/h",
      "notes": [
        "The GL8, then a new model from GM-EMD, had multiple-unit control and could run coupled with G12 locomotives.",
        "After the DHL100 arrived in 2001–2002, shunting duties declined and it mainly hauled trains on the harbor and Pingtung lines, and often worked as a shunter at the Kaohsiung Works."
      ]
    },
    "ja": {
      "maker": "アメリカ GM-EMD（原型式 GL8）",
      "year": "1960～1961年",
      "count": "12両（S201～S212）",
      "speed": "100 km/h",
      "notes": [
        "GL8形は当時GM-EMDが出した新形式で、総括制御の装置を備え、G12形と重連で運転できました。",
        "2001～2002年にDHL100形が加わると入換の仕事が減り、主に臨港線と屏東線の列車を牽引し、高雄機廠でも入換機としてよく働きました。"
      ]
    },
    "ko": {
      "maker": "미국 GM-EMD(원형식 GL8)",
      "year": "1960～1961년",
      "count": "12량(S201～S212)",
      "speed": "100 km/h",
      "notes": [
        "GL8형은 당시 GM-EMD가 내놓은 새 형식으로, 총괄 제어 장치를 갖춰 G12형 기관차와 중련 운전을 할 수 있었어요.",
        "2001～2002년 DHL100형이 들어온 뒤 입환 임무가 줄어서 주로 린강선과 핑둥선 열차를 끌었고, 가오슝 기관차 공장에서 입환 기관차로도 자주 일했어요."
      ]
    }
  },
  "shay31": {
    "zh-TW": {
      "maker": "美國 Lima 公司",
      "notes": [
        "28 噸級，用三個直立式汽缸，再經傘形齒輪傳動軸把動力傳到車輪。",
        "2005 年整修後復駛，跟 25 號同屬 28 噸級的 Shay。"
      ]
    },
    "en": {
      "maker": "Lima, USA",
      "notes": [
        "A 28-ton class engine with three vertical cylinders, whose power reaches the wheels through bevel-geared drive shafts.",
        "It returned to service after a 2005 overhaul and, like No. 25, is a 28-ton class Shay."
      ]
    },
    "ja": {
      "maker": "アメリカ Lima社",
      "notes": [
        "28トン級で、3本の垂直シリンダーの力を傘歯車の伝動軸で車輪に伝えます。",
        "2005年に整備を終えて復活し、25号と同じ28トン級のシェイです。"
      ]
    },
    "ko": {
      "maker": "미국 리마사",
      "notes": [
        "28톤급으로, 수직 실린더 세 개의 힘을 베벨 기어 전동축으로 바퀴에 전달해요.",
        "2005년 정비를 마치고 복귀했으며, 25호와 같은 28톤급 쉐이예요."
      ]
    }
  },
  "tsc346": {
    "zh-TW": {
      "maker": "比利時 AFB",
      "year": "1948 年",
      "notes": [
        "先配屬彰化溪洲糖廠，後來成了溪湖糖廠的鎮廠之寶；1977 年因台糖鐵道柴油化而停用，修復後 2007 年起重新牽引觀光小火車。"
      ]
    },
    "en": {
      "maker": "AFB, Belgium",
      "year": "1948",
      "notes": [
        "It was first assigned to the Xizhou Sugar Mill in Changhua and later became the pride of the Xihu Sugar Mill. It was taken out of service in 1977 when Taiwan Sugar converted its railways to diesel, and after restoration it has pulled the tourist train again since 2007."
      ]
    },
    "ja": {
      "maker": "ベルギー AFB",
      "year": "1948年",
      "notes": [
        "最初は彰化の渓洲糖廠に配属され、のちに渓湖糖廠の宝となりました。1977年に台糖の鉄道がディーゼル化されたため運用を外れ、修復後の2007年から再び観光列車を牽引しています。"
      ]
    },
    "ko": {
      "maker": "벨기에 AFB",
      "year": "1948년",
      "notes": [
        "처음에는 장화의 시저우 제당소에 배속되었고 나중에는 시후 제당소의 보물이 되었어요. 1977년 타이탕 철도가 디젤화되면서 운행에서 빠졌고, 복원된 뒤 2007년부터 다시 관광 열차를 끌고 있어요."
      ]
    }
  },
  "wufen": {
    "zh-TW": {
      "notes": [
        "「五分車」名稱的由來有好幾種說法，常見的一種是糖鐵軌距約為標準軌的一半，所以叫「五分」。",
        "全盛時期總長度超過 3,000 公里；戰後統計的營業線有 627.1 公里（含臺車營業線），最後一條在 1982 年停駛。"
      ]
    },
    "en": {
      "notes": [
        "There are several stories about where the name “five-fen train” comes from; a common one is that the sugar railway gauge is about half of standard gauge, hence “five fen” (five tenths).",
        "At their peak the sugar railways added up to more than 3,000 km. A post-war count put the public lines at 627.1 km (including hand-pushed trolley lines), and the last of them stopped running in 1982."
      ]
    },
    "ja": {
      "notes": [
        "「五分車」という名前の由来にはいくつかの説があり、よく知られているのは、糖鉄の軌間が標準軌のほぼ半分なので「五分」と呼ぶという説です。",
        "最盛期の総延長は3,000キロメートルを超えました。戦後の統計では営業線は627.1キロメートル（台車の営業線を含む）で、最後の路線は1982年に運行を終えました。"
      ]
    },
    "ko": {
      "notes": [
        "‘우펀처(五分車)’라는 이름의 유래에는 여러 설이 있는데, 흔히 알려진 것은 제당 철도의 궤간이 표준궤의 절반쯤이라 ‘오푼(五分)’이라고 불렀다는 설이에요.",
        "전성기에는 총길이가 3,000km를 넘었어요. 전후 통계로 영업선은 627.1km(손으로 미는 대차 영업선 포함)였고, 마지막 노선은 1982년에 운행을 멈췄어요."
      ]
    }
  },
  "s400": {
    "zh-TW": {
      "maker": "美國 GM-EMD（原廠型號 GA18）",
      "year": "1969 年",
      "count": "5 輛（S401～S405）",
      "power": "1,100 匹馬力（柴油機額定；牽引約 1,000 匹）",
      "speed": "75 km/h",
      "notes": [
        "以第二次世界銀行貸款購入，是七堵駝峰調車場的駝峰調車專用機車。",
        "外型和 S300 型相近；退役後 S405 以原本的藍色塗裝修復保存。"
      ]
    },
    "en": {
      "maker": "GM-EMD, USA (original model GA18)",
      "year": "1969",
      "count": "5 units (S401–S405)",
      "power": "1,100 bhp (engine rating; about 1,000 hp for traction)",
      "speed": "75 km/h",
      "notes": [
        "Bought with Taiwan Railway’s second World Bank loan, it was dedicated to hump shunting at the Qidu hump yard.",
        "It looks much like the S300. After retirement, S405 was restored and preserved in its original blue livery."
      ]
    },
    "ja": {
      "maker": "アメリカ GM-EMD（原型の形式はGA18）",
      "year": "1969年",
      "count": "5両（S401～S405）",
      "power": "1,100馬力（機関の定格。牽引用は約1,000馬力）",
      "speed": "75 km/h",
      "notes": [
        "2回目の世界銀行の融資で購入され、七堵のハンプヤードでのハンプ入換に専用で使われました。",
        "外観はS300とよく似ています。引退後、S405が登場時の青い塗装に修復されて保存されています。"
      ]
    },
    "ko": {
      "maker": "미국 GM-EMD(원래 형식 GA18)",
      "year": "1969년",
      "count": "5량(S401～S405)",
      "power": "1,100마력(엔진 정격, 견인용은 약 1,000마력)",
      "speed": "75 km/h",
      "notes": [
        "두 번째 세계은행 차관으로 구입했고, 치두 험프 조차장의 험프 입환 전용 기관차였어요.",
        "외관은 S300과 닮았어요. 퇴역한 뒤 S405가 처음의 파란색 도장으로 복원되어 보존되고 있어요."
      ]
    }
  },
  "emu400": {
    "zh-TW": {
      "maker": "南非 UC&W（車體）、英國 GEC（電機）",
      "year": "1990 年",
      "count": "12 組 48 輛",
      "formation": "4 輛一組",
      "power": "1,920 kW（2,574 匹馬力）",
      "speed": "110 km/h（營運）",
      "notes": [
        "1990 年 11 月開始正式營運，負責縱貫線新竹到基隆間的通勤列車。",
        "最終設計每側只設 2 個車門；塗裝後來從群青色逐漸改成深藍色。"
      ]
    },
    "en": {
      "maker": "UC&W, South Africa (bodies); GEC, UK (electrical equipment)",
      "year": "1990",
      "count": "12 sets, 48 cars",
      "formation": "4 cars per set",
      "power": "1,920 kW (2,574 hp)",
      "speed": "110 km/h (in service)",
      "notes": [
        "It entered regular service in November 1990, running commuter trains between Hsinchu and Keelung on the Western Trunk Line.",
        "The final design has only 2 doors on each side; the livery was later changed from ultramarine to dark blue."
      ]
    },
    "ja": {
      "maker": "南アフリカ UC&W（車体）、イギリス GEC（電機）",
      "year": "1990年",
      "count": "12編成48両",
      "formation": "4両1編成",
      "power": "1,920 kW（2,574馬力）",
      "speed": "110 km/h（営業）",
      "notes": [
        "1990年11月に営業運転を始め、縦貫線の新竹から基隆の間で通勤列車を担当しました。",
        "最終設計ではドアは片側2か所だけです。塗装はのちに群青色から濃い青色へ変わりました。"
      ]
    },
    "ko": {
      "maker": "남아프리카 UC&W(차체), 영국 GEC(전기 장비)",
      "year": "1990년",
      "count": "12편성 48량",
      "formation": "4량 1편성",
      "power": "1,920 kW(2,574마력)",
      "speed": "110 km/h(영업)",
      "notes": [
        "1990년 11월에 영업 운행을 시작해 종관선 신주에서 지룽 사이의 통근열차를 맡았어요.",
        "최종 설계에서는 한쪽에 문을 2개만 두었어요. 도장은 나중에 군청색에서 짙은 파란색으로 바뀌었어요."
      ]
    }
  },
  "pc32701": {
    "zh-TW": {
      "maker": "台灣唐榮鐵工廠（改造）",
      "year": "1972 年（改造）",
      "count": "1 輛",
      "speed": "100 km/h",
      "notes": [
        "原本是 1957 年以美援自日本進口的 35SP32700 型客車之一（35SP32712），1972 年由唐榮鐵工廠改成客廳車；1993 年底由台北機廠換上莒光號的 1.8 公尺寬車窗。",
        "35PC32700 型只有這一輛，座位 30 個；現在提供民間包租，附掛在莒光號列車上。"
      ]
    },
    "en": {
      "maker": "Tangrong Ironworks, Taiwan (conversion)",
      "year": "1972 (conversion)",
      "count": "1 car",
      "speed": "100 km/h",
      "notes": [
        "It began as one of the 35SP32700-type coaches imported from Japan with US aid in 1957 (35SP32712), and was converted into a parlor car by the Tangrong Ironworks in 1972. At the end of 1993 the Taipei Workshop fitted it with the 1.8 m wide windows of the Chu-Kuang coaches.",
        "It is the only car of the 35PC32700 type, with 30 seats. Today it is available for private charter and coupled to Chu-Kuang trains."
      ]
    },
    "ja": {
      "maker": "台湾 唐榮鉄工廠（改造）",
      "year": "1972年（改造）",
      "count": "1両",
      "speed": "100 km/h",
      "notes": [
        "もとは1957年に米国の援助で日本から輸入された35SP32700型客車の1両（35SP32712）で、1972年に唐榮鉄工廠で客廳車に改造されました。1993年末には台北機廠で莒光号と同じ幅1.8メートルの窓に改められました。",
        "35PC32700型はこの1両だけで、座席は30席です。いまは民間の貸切に使われ、莒光号の列車につながれます。"
      ]
    },
    "ko": {
      "maker": "대만 탕룽 철공장(개조)",
      "year": "1972년(개조)",
      "count": "1량",
      "speed": "100 km/h",
      "notes": [
        "원래는 1957년 미국 원조로 일본에서 수입한 35SP32700형 객차 가운데 한 량(35SP32712)이었고, 1972년 탕룽 철공장에서 객청차로 개조되었어요. 1993년 말에는 타이베이 공장에서 쥐광호와 같은 폭 1.8m 창문으로 바꿨어요.",
        "35PC32700형은 이 한 량뿐이고 좌석은 30석이에요. 지금은 민간 대절용으로 쓰이며 쥐광호 열차에 연결돼요."
      ]
    }
  },
  "sa32820": {
    "zh-TW": {
      "nick": "花車",
      "year": "1967 年（改裝）",
      "count": "1 輛",
      "speed": "100 km/h",
      "notes": [
        "台鐵現存的花車共有三輛，分別在 1904 年、1912 年和 1967 年完工，通稱「總督花車」「天皇花車」和這輛「總統花車」。",
        "1991 年南迴鐵路竣工後才執行首次任務，載送總統環島視察；2024 年首次開放民眾搭乘，以郵輪式列車行駛花東。"
      ]
    },
    "en": {
      "nick": "Huache (“flower car”)",
      "year": "1967 (conversion)",
      "count": "1 car",
      "speed": "100 km/h",
      "notes": [
        "Taiwan Railway has three surviving flower cars, completed in 1904, 1912 and 1967, known as the “Governor-General’s car”, the “Emperor’s car” and this “President’s car”.",
        "Its first mission came only after the South Link Line was completed in 1991, carrying the president on a tour of the island; in 2024 it was opened to the public for the first time, running cruise-style trips along the east coast."
      ]
    },
    "ja": {
      "nick": "花車",
      "year": "1967年（改造）",
      "count": "1両",
      "speed": "100 km/h",
      "notes": [
        "台鉄に現存する花車は3両で、それぞれ1904年、1912年、1967年に完成し、「総督花車」「天皇花車」、そしてこの「総統花車」と呼ばれています。",
        "1991年に南廻線が完成してから初めての任務に就き、総統を乗せて島を一周する視察に使われました。2024年には初めて一般公開され、クルーズ式の列車として花東を走りました。"
      ]
    },
    "ko": {
      "nick": "화처(花車)",
      "year": "1967년(개조)",
      "count": "1량",
      "speed": "100 km/h",
      "notes": [
        "대만철도에 남아 있는 화처는 세 량으로, 각각 1904년, 1912년, 1967년에 완성되었고 ‘총독 화처’ ‘천황 화처’, 그리고 이 ‘총통 화처’라고 불러요.",
        "1991년 난후이선이 완공된 뒤에야 첫 임무를 맡아 총통을 태우고 섬을 한 바퀴 돌았어요. 2024년에는 처음으로 일반에 공개되어 크루즈식 열차로 화롄·타이둥 구간을 달렸어요."
      ]
    }
  }
},
};
