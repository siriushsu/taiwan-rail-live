#!/bin/bash
# 併入巡檢的排程殼（2026-08-24 使用者要求：「看有沒有遺漏沒有併進去的功能，或是進度落在外面」）。
# 由 launchd 每天叫一次，見 ~/Library/LaunchAgents/com.sirius.railisland.mergescan.plist
#
# 刻意只告警不自動併：合併 index.html 是這個 repo 最危險的動作之一（2026-08-23 就是一顆
# 整檔取單邊的合併把 18 項只活在 App 線的東西靜默吃掉，見 memory ship-regression-evil-merge）。
# 要併哪一條、怎麼併，一律由人看過明細再決定。
#
# 🔴 只在「跟上次比多了新東西」時才發通知。首跑就有 57 條分支帶著未併的東西——如果每天照樣
# 響一次，這個通知一週內就會被當成背景雜訊而沒人看，那等於沒有這支巡檢。
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
ROOT="$(pwd)"

LOG="$HOME/.railisland-mergescan.log"
OUTDIR="$HOME/.railisland-mergescan"
mkdir -p "$OUTDIR"
STAMP="$(date +%Y%m%d-%H%M)"
TXT="$OUTDIR/$STAMP.txt"
JSON="$OUTDIR/$STAMP.json"
SIG="$OUTDIR/.signature"          # 上一次看到的項目集合
SIGNEW="$OUTDIR/.signature.new"

# launchd 給的 PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin，找不到 /usr/local/bin/node
NODE="${NODE_BIN:-/usr/local/bin/node}"
[ -x "$NODE" ] || NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  printf '%s exit=2 找不到 node\n' "$(date '+%F %T')" >> "$LOG"; exit 2
fi

# 這棵樹是 detached 追 origin/main。追不上（本機有改動）就記一行警告、照舊跑手上這版，
# 不要靜默失敗——腳本自己還會再印一次「我是哪一版」的 md5 自檢（judgment 心得 32）。
if ! { git -C "$ROOT" fetch --quiet origin 2>/dev/null && \
       git -C "$ROOT" checkout --detach --quiet origin/main 2>/dev/null; }; then
  printf '%s ⚠️ 併入巡檢樹沒能追上 origin/main，跑的是 %s\n' "$(date '+%F %T')" \
    "$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')" >> "$LOG"
fi

# 尾端不接管道，保留真實離開碼（管道會把它換成最後一段的，見 model-dispatch 心得 7）
OUT="$("$NODE" "$ROOT/scripts/scan_merge_gaps.mjs" --days 21 --json "$JSON" 2>&1)"
CODE=$?
printf '%s\n' "$OUT" > "$TXT"

# 網路類失敗只影響 D（正式站比對），A/B/C 是純本機 git，照樣可信 ⇒ 不因為斷網就整支判失敗。
# 掃描本身沒跑起來（讀不到 origin/main、node 爆掉）才是 2。
if [ "$CODE" -eq 2 ]; then
  printf '%s exit=2 掃描沒跑起來\n' "$(date '+%F %T')" >> "$LOG"
  printf '%s\n' "$OUT" > "$OUTDIR/last-failure.txt"
  osascript -e 'display notification "掃描沒跑起來,見 ~/.railisland-mergescan/last-failure.txt" with title "軌島併入巡檢" sound name "Basso"' >/dev/null 2>&1
  exit 2
fi

# ── 新舊比對：只有「這次多出來的項目」才值得吵人 ──────────────────────────────
"$NODE" -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const s=new Set();
for(const [ref,rec] of Object.entries(j.branches||{})){
  for(const x of rec.ids||[]) s.add(`id ${ref} ${x.cat} ${x.id}`);
  for(const f of rec.files||[]) s.add(`file ${ref} ${f}`);
}
for(const u of j.unpushed||[]) s.add(`unpushed ${u.ref}`);
for(const d of j.dirty||[]) s.add(`dirty ${d.wt}`);
fs.writeFileSync(process.argv[2],[...s].sort().join("\n")+"\n");
' "$JSON" "$SIGNEW" 2>/dev/null

NEW=0
if [ -f "$SIG" ]; then
  NEW="$(comm -13 "$SIG" "$SIGNEW" 2>/dev/null | wc -l | tr -d ' ')"
  NEWLIST="$(comm -13 "$SIG" "$SIGNEW" 2>/dev/null | head -3 | tr '\n' ' ')"
else
  NEW="$(wc -l < "$SIGNEW" | tr -d ' ')"           # 首跑：全部都是新的
  NEWLIST="首次巡檢"
fi
mv -f "$SIGNEW" "$SIG" 2>/dev/null

SUMMARY="$(printf '%s\n' "$OUT" | grep -E '^[✅❌⚠️]' | tr '\n' ' ')"
printf '%s exit=%s new=%s %s\n' "$(date '+%F %T')" "$CODE" "$NEW" "$SUMMARY" >> "$LOG"
cp -f "$TXT" "$OUTDIR/last-report.txt"

# 只留最近 60 份明細（每天一份，約兩個月）
ls -1t "$OUTDIR"/*.txt 2>/dev/null | tail -n +61 | while read -r f; do rm -f "$f"; done
ls -1t "$OUTDIR"/*.json 2>/dev/null | tail -n +61 | while read -r f; do rm -f "$f"; done

if [ "$NEW" -gt 0 ]; then
  osascript -e "display notification \"多了 ${NEW} 項未併/未收的東西。${NEWLIST//\"/}\" with title \"軌島併入巡檢\" sound name \"Submarine\"" >/dev/null 2>&1
fi

exit "$CODE"
