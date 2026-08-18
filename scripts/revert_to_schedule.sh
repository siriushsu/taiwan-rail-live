#!/bin/bash
# 一鍵把北捷列車位置退回「班表推估」並部署正式站。
#
# 什麼時候用：晨間觀察（或任何時候）出現奇怪的疊車、列車消失、位置明顯亂跳。
# 使用者裁示（2026-08-18）：「如果又有奇怪的疊車、消失現象，就回到班表推估，但是要像昨天一樣有通知。」
#
# 做法：revert 掉「預設翻開」那一顆（af51956），**保留**文湖線倒數定位與跨車間距兩顆——
# 那兩顆在旗標關著時本來就不會生效，退掉它們只會多冒風險。
#
#   bash scripts/revert_to_schedule.sh          # 實際執行（會 push + 部署）
#   bash scripts/revert_to_schedule.sh --dry    # 只做到產生 commit 與驗證，不 push 不部署
#
# 退回後要復原：git revert 那顆 revert，或直接改回 trtcOfficialRosterEnabled 的預設值。
set -euo pipefail

REPO=/Users/xuxiang/Code/捷運小動畫
FLIP=af51956            # feat(北捷): 列車位置預設改回官方即時(v0818a)
DRY=${1:-}
STAMP=$(date +%Y%m%d-%H%M%S)
WT="$REPO/.claude/worktrees/revert-$STAMP"

echo "== 1. 開乾淨工作樹（不從別人的樹出貨）=="
git -C "$REPO" fetch --quiet origin
git -C "$REPO" worktree add -q "$WT" -b "revert/schedule-$STAMP" origin/main
ln -sfn "$REPO/node_modules" "$WT/node_modules"

echo "== 2. revert 旗標那一顆 =="
git -C "$WT" revert --no-edit "$FLIP"

echo "== 3. 驗旗標真的關回去了（兩側都驗）=="
node -e '
const fs=require("fs"), vm=require("vm");
const src=fs.readFileSync(process.argv[1],"utf8");
const grab=n=>{const s=src.indexOf(`function ${n}(`);let i=src.indexOf("{",s),d=0;
  for(;i<src.length;i++){if(src[i]==="{")d++;else if(src[i]==="}"&&--d===0)return src.slice(s,i+1);}};
const ctx={URLSearchParams,location:{search:""}};vm.createContext(ctx);
vm.runInContext(grab("trtcOfficialRosterEnabled")+grab("trtcCensusRosterEnabled")+
  ";globalThis.__a={trtcOfficialRosterEnabled,trtcCensusRosterEnabled}",ctx);
const a=ctx.__a, bad=[];
if(a.trtcOfficialRosterEnabled("")!==false) bad.push("預設仍為開");
if(a.trtcCensusRosterEnabled("")!==false) bad.push("census 預設仍為開");
if(a.trtcOfficialRosterEnabled("?officialroster=1")!==true) bad.push("?officialroster=1 打不開(逃生口壞了)");
if(bad.length){console.error("❌ "+bad.join("；"));process.exit(1);}
console.log("✅ 旗標已關回班表模式，且 ?officialroster=1 仍能單機打開");
' "$WT/index.html"

echo "== 4. 跑前端驗收 =="
(cd "$WT" && node scripts/verify_official_roster_frontend.mjs 2>&1 | tail -2)

if [ "$DRY" = "--dry" ]; then
  echo "== DRY RUN：到此為止，未 push、未部署 =="
  echo "   工作樹保留在 $WT（用完請 git worktree remove）"
  exit 0
fi

echo "== 5. push main =="
git -C "$WT" push origin HEAD:main

echo "== 6. 部署 =="
(cd "$WT" && arch -arm64 node ./node_modules/wrangler/bin/wrangler.js deploy 2>&1 | tail -6)

echo "== 7. 驗正式站真的換了（逐 byte）=="
sleep 8
TMP=$(mktemp -d)
/usr/bin/curl -sL -H 'Cache-Control: no-cache' "https://railisland.tw/index.html?cb=$(date +%s)" -o "$TMP/live.html"
if cmp -s "$WT/index.html" "$TMP/live.html"; then
  echo "✅ 正式站已退回班表推估（與 $(git -C "$WT" rev-parse --short HEAD) 逐 byte 相同）"
else
  echo "❌ 正式站內容與出貨檔不同——部署可能沒生效，手動查 md5:"
  echo "   線上 $(md5 -q "$TMP/live.html") vs 出貨 $(md5 -q "$WT/index.html")"
  exit 1
fi

osascript -e 'display notification "北捷列車位置已退回班表推估" with title "軌島：自動退版完成"' 2>/dev/null || true
echo "完成。工作樹 $WT 可保留供查驗，用完 git worktree remove。"
