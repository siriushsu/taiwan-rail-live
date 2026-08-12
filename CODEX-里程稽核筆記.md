# codex-milepost 量測筆記

## 2026-08-10 初始反推

- 工作範圍固定在本 worktree；起始 `git status --porcelain` 為空，未修改 `index.html`。
- `index.html:4014-4020` 的 `haversineKm` 與 `index.html:4148-4184` 的現行契約已確認：`ensureCum()` 先以相鄰 shape 點的 haversine 累加沿線里程；`buildLineSchedule()` 的 `hasShape` 是 `!!(ln.shape && ln.stations[0].d != null)`。一條線只要不滿足這個 line-level 條件，該線所有站間才進 haversine 退路；不是逐區間各自判斷。
- 網站直接載入 `data/*.json` 的 `lines[].stations` 順序；沒有在 `buildLineSchedule()` 另排站序或另做站名 join。稽核會以這個本地站序為準。
- 現有站名正規化可直接沿用 `index.html:13471-13473` 的 `traStnKey()`：`臺→台`、剝除尾端半形括號註記並 trim。一般轉乘 join 另有 `index.html:10466-10468` 的 NFKC／車站字尾規則，但 TRA 現有時刻表與站碼資料的契約是前者，產出的 TRA 查表採前者，避免過度剝字造成碰撞。
- 已盤點網站使用的本地線：TRA 16、THSR 1、AFR 4、捷運／輕軌 18，共 39 線；目視資料摘要顯示 39 線都有 shape，且第一站都有數值 `d`，預期 `buildLineSchedule()` 的 haversine 退路為 0，仍待正式稽核腳本逐線證實。
- TDX 原始 StationOfLine 有分支壓在單一陣列的情形（如 TRTC G/O/R、NTDLRT V），因此官方區間不按陣列首尾粗暴套用；會以本地線的相鄰站序為主，在同系統官方資料中找同一對相鄰端點並取 CumulativeDistance 差。
- 外部常數驗證來源選用台鐵公開的「營業里程」PDF（`https://tip-tr4cdn.cdn.hinet.net/tra-tip-web/static/file/T-table1140508/mile.pdf`）：臺北 28.5、板橋 35.7、臺中 193.1、彰化 210.9 km，可形成臺北–板橋 7.2 km、臺北–臺中 164.6 km、臺中–彰化 17.8 km 三個非由本產物反推的檢核值。

## 2026-08-10 首次完整稽核結果

- `node scripts/audit_seg_distance.mjs` 已直接跑完並產生 `data/seg_distance_audit.json` 與 `data/tra_seg_cumdist.json`。
- 全站 39 線、567 個本地相鄰站間全部走 `hasShape`，`haversineKm` 退路是 **0 線、0 區間、0.0%**；因此這輪原始假說「找出仍以直線距離推算的位置」在現有資料上不成立。
- 566 個區間有官方 CumulativeDistance 可比較；唯一缺官方值的是 AFR 本線 `二萬平→神木`，因本地線終點是神木，而 TDX AFR 主線終點是阿里山、神木另屬支線，不能安全用同一官方線兩端相減。
- TRA 16 線共 244 區間全部有官方值；現行 shape vs 官方里程絕對誤差（Type-7 分位數）：中位 **0.046293 km**、p90 **0.122864 km**、最大 **0.373153 km**；百分比：中位 **1.179159%**、p90 **3.970921%**、最大 **28.704082%**。最大是短區間 `汐止→汐科`（現行 0.926847、官方 1.3 km）。
- 全系統統計會被上游資料異常污染：TDX THSR 檔中 `雲林 221.78 → 嘉義 218.88 → 台南 317.16` 非單調，造成 `雲林→嘉義` 官方 2.9 km、`嘉義→台南` 98.28 km；TRTC G/R 又把支線累積值用不同基準附在主線尾端，直接相減會讓 `七張→小碧潭` 變 0.07 km、`北投→新北投` 變 17.14 km。這些必須在最終風險中明示，不能把全系統最大誤差解讀成現行 shape 錯誤。
- TRA 查表目前涵蓋 **16 線、244 區間**，所有站名已套 `traStnKey` 同款正規化；下一步由獨立 verify 腳本檢查鏈連續、TDX endpoint-span 總長、外部 PDF 常數與 audit 具名覆蓋率斷言。

## 2026-08-10 查表驗證

- `node scripts/verify_seg_cumdist.mjs` 首次完整執行結果：**PASS 40，FAIL 0**。
- 16 條 TRA 本地線各自通過連續鏈檢查；每線區間總和也各自等於獨立由 TDX CumulativeDistance 起訖 span 算出的總長。跨官方線的本地線有具名拆段，例如屏東線 `WL:高雄→屏東 + SL:屏東→枋寮 = 61.2 km`、內灣線 `WL:新竹→北新竹 + NW:北新竹→內灣 = 27.9 km`。
- 244 段逐筆值皆與原始 TDX 兩端累積里程差相符；扁平 lookup 也是 244 個唯一 key；具名覆蓋率斷言 `table=244 == audit.TRA.officialSegments=244` 通過。
- 三組外部常數全數差 0 km：臺北–板橋 7.2、臺北–臺中 164.6、臺中–彰化 17.8 km。驗證來源與容差理由已寫在 verifier 檔頭，不靠本產物自證。

## 2026-08-10 最終邊界檢查

- 最終 verification loop 再跑一次：audit exit 0 且印出總計；verify exit 0，仍為 **PASS 40／FAIL 0**。
- `git status --porcelain` 只有本輪 5 個新檔：本筆記、兩支 scripts、兩份 data JSON；`index.html` 未出現在清單。
- 對 5 個新檔掃描 TDX env assignment、client secret、Bearer token、JWT、64 字元 hex 與 80 字元 opaque token：**0 命中**。
