#!/bin/bash
# 地圖動畫定時巡檢（2026-08-17 使用者要求：「需要有一個定時掃過的機制，確認地圖上的動畫
# 是否正常，若有問題才能及時重置」）。由 launchd 每小時叫一次，見
# ~/Library/LaunchAgents/com.sirius.railisland.mapscan.plist
#
# 刻意只告警不自動重置：重置＝清掉 D1 的 official_roster_v4 讓它冷啟動，那會把全線的
# 車重排一次，是有代價的動作。要不要重置該由人看過明細再決定，不是掃描器自己決定。
#
# 營運時段判斷放在排程層（plist 只掛 06–23 點），掃描器本身保持單純：它對「畫面零台車」
# 一律回 2，那在收班後是正常的、不該變成每天半夜一次的假警報。
set -uo pipefail

# 不依賴呼叫端的 cwd（launchd 給的 cwd 是 /）
cd "$(dirname "$0")/.." || exit 2
ROOT="$(pwd)"

URL="${TRTC_SCAN_URL:-https://railisland.tw/}"
LOG="$HOME/.railisland-mapscan.log"
OUTDIR="$HOME/.railisland-mapscan"
mkdir -p "$OUTDIR"
STAMP="$(date +%Y%m%d-%H%M)"
JSON="$OUTDIR/$STAMP.json"

# node 走絕對路徑：launchd 給的 PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin，找不到 /usr/local/bin/node
NODE="${NODE_BIN:-/usr/local/bin/node}"
[ -x "$NODE" ] || NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  printf '%s exit=2 找不到 node\n' "$(date '+%F %T')" >> "$LOG"; exit 2
fi

# 尾端不接管道，保留真實離開碼（管道會把它換成最後一段的）
OUT="$("$NODE" "$ROOT/scripts/scan_map_health.mjs" "$URL" --json "$JSON" --gap 25 2>&1)"
CODE=$?

SUMMARY="$(printf '%s\n' "$OUT" | grep -E '^[✅❌]' | tr '\n' ' ')"
printf '%s exit=%s %s\n' "$(date '+%F %T')" "$CODE" "$SUMMARY" >> "$LOG"

# 只留最近 200 份明細，其餘刪掉（每小時一份，約八天）
ls -1t "$OUTDIR"/*.json 2>/dev/null | tail -n +201 | while read -r f; do rm -f "$f"; done

if [ "$CODE" -ne 0 ]; then
  # 全文留檔，通知只帶一行——通知欄放不下，也不該逼人在通知裡讀明細
  printf '%s\n' "$OUT" > "$OUTDIR/last-failure.txt"
  TITLE="軌島地圖巡檢：$([ "$CODE" = 2 ] && echo '掃描沒跑起來' || echo '偵測到異常')"
  MSG="$(printf '%s\n' "$OUT" | grep -E '^❌' | head -2 | tr '\n' ' ')"
  osascript -e "display notification \"${MSG//\"/}\" with title \"${TITLE}\" sound name \"Basso\"" >/dev/null 2>&1
fi

exit "$CODE"
