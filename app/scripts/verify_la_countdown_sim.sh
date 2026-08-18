#!/bin/bash
# Live Activity「到站倒數」自走驗收（iOS 模擬器，可重跑）
# 兩張卡共用：LA_CARD=follow（臺鐵跟車，預設）／LA_CARD=wait（捷運等車）。
#
# 要證的事【不是】「卡片開得起來」，而是：
#   在【零推播、而且 App 已經被終止】的狀態下，鎖定畫面上的分鐘數會不會自己往下掉。
# 所以流程刻意是：起卡 → simctl terminate → 鎖屏 → 隔 65／60 秒各截一張。
# 只有這樣，t0/t1/t2 三個數字的差異才【只可能】來自系統自己重繪，
# 不可能來自 App 前景 update，也不可能來自伺服器推播。
#
# ── 三個非做不可的環境前提（每一條都是實際撞出來的，改掉就會得到假結果）──
# 1. 🔴 App 必須帶著 `aps-environment` 進模擬器，所以 build【不可以】關掉簽章。
#    plugin 用 `Activity.request(..., pushType: .token)`（RailLiveActivityPlugin.swift:99-103），
#    少了那個 entitlement，liveactivitiesd 直接回
#      「tw.railisland.app does not specify an APS environment name」，卡片【根本沒有建立】。
#    模擬器的 entitlement 不住在簽章裡，是連結期塞進二進位的 `__TEXT,__entitlements`
#    （`-Xlinker -sectcreate … App.app-Simulated.xcent`）⇒
#      · `CODE_SIGNING_ALLOWED=NO` ⇒ 那一段根本不會被塞進去 ⇒ 卡片開不了；
#      · 事後用 `codesign --force --sign - --entitlements` 補簽【救不了而且更糟】，
#        實測 App 直接 launch 不起來（RBSRequestErrorDomain 5 / NSPOSIXErrorDomain 163）。
#      · `codesign -d --entitlements -` 對模擬器 build 永遠印空的，不是證據；
#        要驗就驗 `__TEXT,__entitlements` 這一段（本腳本 install 的 gate 就是驗它）。
#    ⇒ build 一律【不帶任何簽章覆寫】：
#       xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug \
#         -sdk iphonesimulator -destination "id=$UDID" -derivedDataPath "$DD" ENABLE_PREVIEWS=NO build
#    失敗的樣子很惡毒：build 綠、App 跑得好好的、只有卡片安靜地不存在。
# 2. 🔴 兩張卡走 UI 都開不了：跟車卡沒有深連結而且 liveActivityAllowed() 要通行證資格；
#    等車卡雖然有深連結（railisland://metro-wait，AppDelegate.swift:66-70 → RailMetroWaitPlugin
#    .handleOpen），但那條路只是把事件轉給 JS，開卡前仍要過 metroWaitEnabled() 的資格閘門，
#    而且卡片內容取決於當下真的有沒有官方班次（深夜／上游中斷就開不成，量到的會是假紅）。
#    ⇒ 兩張都改注入模擬器容器內那份 index.html 直接呼叫 plugin：
#      follow → window.RAIL_NATIVE_LIVEACTIVITY.start(...)
#      wait   → window.Capacitor.Plugins.RailMetroWait.start(...)（JS 端的正式呼叫點同一個，
#               見 index.html 的 metroWaitStartFor()）
#    被繞過的只有「誰有資格開卡」與「這一刻有沒有班次」，卡片怎麼畫仍然是出貨的原生程式碼。
# 3. 🔴 這台不能用 osascript 送 ⌘L 鎖屏（System Events 回 1002「不允許傳送按鍵」），
#    simctl 也沒有鎖屏指令 ⇒ 鎖屏這一步必須由呼叫端做，所以拆成 arm／shots 兩段。
#    呼叫端可用 Claude Code iOS Simulator MCP 的 `button LOCK`，或人工按 ⌘L。
#
# 用法：
#   app/scripts/verify_la_countdown_sim.sh install            # 重簽＋安裝已 build 好的 App.app
#   app/scripts/verify_la_countdown_sim.sh arm     <tag>      # 注入→重啟→開卡→驗卡片真的建立→終止 App
#   （呼叫端在這裡鎖屏）
#   app/scripts/verify_la_countdown_sim.sh shots   <tag>      # t0 / +65s t1 / +60s t2 三張截圖
#   app/scripts/verify_la_countdown_sim.sh restore            # 還原容器內的 index.html
#
# 環境變數：
#   SIM_UDID                模擬器 UDID（預設取第一台 booted）
#   DERIVED_DATA            xcodebuild 的 -derivedDataPath（install 用）
#   SHOT_DIR                截圖輸出目錄（預設 app/tmp/la-shots）
#   LA_CARD                 follow（臺鐵跟車，預設）或 wait（捷運等車）
#   LA_ARRIVAL_OFFSET_SEC   到站＝現在＋這麼多秒（預設 960＝16 分；邊界情境用 75 與 -30）
#   LA_DEPARTED_OFFSET_SEC  上一站發車＝現在＋這麼多秒（預設 -660）；只有 follow 用
#   LA_SECOND_OFFSET_SEC    次班到站＝現在＋這麼多秒（預設 ARR+300）；只有 wait 用
#   LA_WAIT1 / LA_WAIT2     t0→t1、t1→t2 的間隔秒（預設 65 / 60）
set -euo pipefail

CMD="${1:-}"
TAG="${2:-run}"
CARD="${LA_CARD:-follow}"
case "$CARD" in
  follow) ATTRS=RailFollowAttributes ;;
  wait)   ATTRS=MetroWaitAttributes ;;
  *) echo "LA_CARD 只能是 follow 或 wait，收到：$CARD"; exit 1 ;;
esac
BUNDLE=tw.railisland.app
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHOT_DIR="${SHOT_DIR:-$HERE/../tmp/la-shots}"
UDID="${SIM_UDID:-$(xcrun simctl list devices booted -j | /usr/bin/python3 -c 'import json,sys;d=json.load(sys.stdin)["devices"];print(next(x["udid"] for v in d.values() for x in v))')}"

ARR="${LA_ARRIVAL_OFFSET_SEC:-960}"
DEP="${LA_DEPARTED_OFFSET_SEC:--660}"
SEC="${LA_SECOND_OFFSET_SEC:-$((ARR + 300))}"
W1="${LA_WAIT1:-65}"
W2="${LA_WAIT2:-60}"

mkdir -p "$SHOT_DIR"
shot() {
  xcrun simctl io "$UDID" screenshot "$SHOT_DIR/${TAG}_$1.png" >/dev/null 2>&1
  echo "[harness] shot ${TAG}_$1.png"
}

case "$CMD" in

install)
  DD="${DERIVED_DATA:?請設 DERIVED_DATA=<xcodebuild 的 -derivedDataPath>}"
  APP="$DD/Build/Products/Debug-iphonesimulator/App.app"
  [ -d "$APP" ] || { echo "找不到 $APP，先跑 xcodebuild"; exit 1; }
  # 前提 1 的 gate：驗連結期塞進去的 __TEXT,__entitlements 有沒有 aps-environment。
  # 沒有就停手——否則之後量到的「卡片沒出現」會被誤讀成產品缺陷。
  for exe in "$APP/App" "$APP/PlugIns/RailBoardWidgetExtension.appex/RailBoardWidgetExtension"; do
    /usr/bin/python3 - "$exe" <<'PY' || exit 1
import re, subprocess, sys
exe = sys.argv[1]
out = subprocess.run(["otool", "-X", "-s", "__TEXT", "__entitlements", exe],
                     capture_output=True, text=True).stdout
words = []
for line in out.splitlines():
    p = line.split()
    if len(p) >= 2 and re.fullmatch(r'[0-9a-f]{8,16}', p[0]):
        words += p[1:]
# otool 印的是小端 4-byte word ⇒ 逐字反轉才是原文
blob = b"".join(bytes.fromhex(w)[::-1] for w in words if re.fullmatch(r'[0-9a-f]{8}', w))
txt = blob.decode("utf-8", "replace")
name = exe.rsplit("/", 1)[-1]
if "aps-environment" not in txt:
    print(f"[harness] ✗ {name} 的 __TEXT,__entitlements 沒有 aps-environment"
          f"——build 是不是帶了 CODE_SIGNING_ALLOWED=NO / CODE_SIGN_IDENTITY 覆寫？")
    sys.exit(1)
print(f"[harness] ✓ {name} 帶有 aps-environment"
      f"{'＋app-group' if 'application-groups' in txt else ''}")
PY
  done
  xcrun simctl uninstall "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
  xcrun simctl install "$UDID" "$APP"
  echo "[harness] installed"
  ;;

arm)
  APPDIR="$(xcrun simctl get_app_container "$UDID" "$BUNDLE" app)"
  IDX="$APPDIR/public/index.html"
  [ -f "$IDX" ] || { echo "找不到 $IDX"; exit 1; }
  # 只保留一份原稿；重跑先還原，否則注入層層疊加、第二輪起分不清跑的是哪一版。
  if [ -f "$IDX.orig" ]; then cp "$IDX.orig" "$IDX"; else cp "$IDX" "$IDX.orig"; fi
  echo "[harness] udid=$UDID tag=$TAG card=$CARD arrival=+${ARR}s departed=${DEP}s second=+${SEC}s"
  echo "[harness] bundle=$APPDIR"
  echo "[harness] web $(grep -o "BUILD *= *'[^']*'" "$IDX" | head -1) index.md5=$(md5 -q "$IDX")"

  /usr/bin/python3 - "$IDX" "$ARR" "$DEP" "$SEC" "$CARD" <<'PY'
import sys, io
path, arr, dep, sec, card = sys.argv[1:6]
# payload 欄位：
#   follow → RailLiveActivityPlugin.swift:46-60,82-121（notice 刻意不帶，那是後端欄位）
#   wait   → RailMetroWaitPlugin.swift:93-116（欄位名與 index.html 的 metroWaitPayload 一致）
#
# 🔴 wait 這邊刻意【只帶 nextEta／secondEta 不帶 nextMinutes】：北捷走的就是官方秒級絕對
#    時刻那條路，帶了分鐘數會落到「整數分鐘系統」那條退路，量到的就不是要驗的東西。
# 🔴 dataAt 給「現在」：卡片的過期判定是 dataAt 超過 90 秒（MetroWaitDisplay.expirySeconds），
#    給舊值會讓主角在測試中途變成「暫無資料」，那時倒數不動是【設計】不是缺陷，控制組
#    與修後會長得一樣而分不出勝負。
FOLLOW = """
<script>
// ── 驗收注入（verify_la_countdown_sim.sh）：直接開一張跟車 Live Activity ──
(function () {
  var ARR = %(arr)s, DEP = %(dep)s, tries = 0;
  function iso(off) { return new Date(Date.now() + off * 1000).toISOString(); }
  function go() {
    // 🔴 不要等 window.load：首次安裝時 146MB bundle 的 load 事件可能拖過一分鐘
    //    （首訪教學卡＋定位授權對話框期間資源還在載），等它就會量到「卡片沒開成」的假紅。
    //    橋接物件由 native-bridge.js 同步建立，一到手就開卡。
    var api = window.RAIL_NATIVE_LIVEACTIVITY;
    if (!api) { if (++tries < 600) return setTimeout(go, 100); console.log('[LAHARNESS] no bridge'); return; }
    var p = {
      key: 'harness', trainNo: '0625', kind: '高鐵', sys: 'thsr_sched', color: '#F27300',
      terminus: '左營', nextStop: '台中', prevStop: '新竹',
      arrivalIso: iso(ARR), departedIso: iso(DEP), delaySec: 0, stopping: false,
    };
    console.log('[LAHARNESS] start ' + JSON.stringify(p));
    Promise.resolve(api.start(p))
      .then(function (r) { console.log('[LAHARNESS] result ' + JSON.stringify(r)); })
      .catch(function (e) { console.log('[LAHARNESS] failed ' + e); });
  }
  setTimeout(go, 500);
})();
</script>
</body>"""
WAIT = """
<script>
// ── 驗收注入（verify_la_countdown_sim.sh）：直接開一張捷運等車 Live Activity ──
(function () {
  var ARR = %(arr)s, SEC = %(sec)s, tries = 0;
  function epoch(off) { return Math.round(Date.now() / 1000) + off; }
  function go() {
    // 同 follow：不等 window.load（見上）。等車卡走 Capacitor 自製 plugin，
    // 註冊時機沒有 window.RAIL_NATIVE_* 那種同步保證 ⇒ 一樣輪詢到手為止。
    var p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.RailMetroWait;
    if (!p) { if (++tries < 600) return setTimeout(go, 100); console.log('[LAHARNESS] no plugin'); return; }
    var payload = {
      key: 'harness', sys: 'trtc', station: '龍山寺', lineLabel: '板南線', color: '#0070BD',
      durationMin: 90,
      nextDest: '頂埔', nextEta: epoch(ARR),
      secondDest: '南港展覽館', secondEta: epoch(SEC),
      crowd: [1, 1, 2, 2, 1, 1], dataAt: epoch(0),
    };
    console.log('[LAHARNESS] start ' + JSON.stringify(payload));
    Promise.resolve(p.start(payload))
      .then(function (r) { console.log('[LAHARNESS] result ' + JSON.stringify(r)); })
      .catch(function (e) { console.log('[LAHARNESS] failed ' + e); });
  }
  setTimeout(go, 500);
})();
</script>
</body>"""
snippet = (WAIT if card == 'wait' else FOLLOW) % {'arr': arr, 'dep': dep, 'sec': sec}
src = io.open(path, encoding='utf-8').read()
i = src.rfind('</body>')
if i < 0: raise SystemExit('index.html 裡找不到 </body>，注入點不存在')
io.open(path, 'w', encoding='utf-8').write(src[:i] + snippet + src[i + len('</body>'):])
print('[harness] injected at </body>')
PY

  # 卡片建立與否的觀測管道：先開 realtime log stream 再啟動 App。
  # 🔴 不可以用 `log show --start`：(a) 它吃【本機時間】，給 UTC 會往前多撈八小時；
  #    (b) 模擬器整機 log 一分鐘 200MB 以上，不下 predicate 每輪 dump 十幾秒；
  #    (c) 最毒的是——log store 有數十秒的落地延遲，request 明明發生了 `log show` 還讀不到
  #        ⇒ gate 先超時，把「環境還沒同步」誤判成「卡片沒開成」（實測踩到兩次）。
  #    log stream 是即時的，沒有這三個問題。
  STREAM_LOG="$(mktemp -t la_arm_log)"
  xcrun simctl spawn "$UDID" log stream --style compact \
    --predicate 'process == "App" OR process == "liveactivitiesd"' > "$STREAM_LOG" 2>/dev/null &
  STREAM_PID=$!
  # 只收自己起的那顆 PID（絕不用行程名比對去殺別人的東西）
  trap 'kill "$STREAM_PID" 2>/dev/null || true' EXIT
  sleep 3

  # 乾淨重啟（模擬器 stale-restore：launch 對既存行程只是帶到前景，boot 不重跑）
  xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
  sleep 1
  xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
  echo "[harness] launched，等卡片建立…"

  # gate：卡片真的建立了嗎？沒建立就停手——不要讓「卡片不存在」偽裝成「倒數不會動」。
  ok=0
  for i in $(seq 1 24); do
    sleep 5
    if grep -q "does not specify an APS environment name" "$STREAM_LOG"; then
      echo "[harness] ✗ entitlement 缺 aps-environment ⇒ 卡片沒建立。先跑 install 再重來。"; exit 1
    fi
    if grep -q "Requesting an activity.*$ATTRS" "$STREAM_LOG"; then ok=1; break; fi
  done
  [ "$ok" = 1 ] || { echo "[harness] ✗ 120 秒內沒看到 $ATTRS 的 activity request，卡片沒開成"; exit 1; }
  echo "[harness] ✓ ActivityKit 收到 $ATTRS 的 request"
  sleep 3
  shot di0     # 解鎖態（動態島 compact）

  # 🔴 關鍵：殺掉 App。Live Activity 留在系統上，之後不可能再有任何本機 update。
  xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
  echo "[harness] App 已終止（之後零本機更新）。請鎖屏，再跑：$0 shots $TAG"
  ;;

shots)
  shot t0
  sleep "$W1"; shot t1
  sleep "$W2"; shot t2
  # 🔴 ${} 不可省：後面緊接全形「（」，裸 $SHOT_DIR 會把那個多位元組字元的頭一個 byte
  #    吃進變數名，在 set -u 下變成 "SHOT_DIR?: unbound variable" 而讓整支腳本在最後一行失敗。
  echo "[harness] 三張截圖完成，在 ${SHOT_DIR}（前綴 ${TAG}_）"
  ;;

restore)
  APPDIR="$(xcrun simctl get_app_container "$UDID" "$BUNDLE" app)"
  [ -f "$APPDIR/public/index.html.orig" ] && cp "$APPDIR/public/index.html.orig" "$APPDIR/public/index.html"
  echo "[harness] index.html 已還原"
  ;;

*)
  sed -n '2,40p' "${BASH_SOURCE[0]}"
  exit 1
  ;;
esac
