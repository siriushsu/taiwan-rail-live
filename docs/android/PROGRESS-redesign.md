# Android × App 版面重整：進度與基準

> 派工單：[`codex-prompt-redesign.md`](./codex-prompt-redesign.md)
> 這份檔案是**隨做隨落檔**用的（派工單鐵則 5）。連線斷掉時它是唯一存活的成果。

---

## 一、合併前的基準（版面線 `build/redesign-901`，2026-08-27 深夜實測）

合併後在**同一棵樹**重跑同一批腳本。

🔴 **比法是「FAIL 名單逐項比對」，不是數字比大小。** 這些腳本有一部分的紅是**時段相依**的
（深夜台鐵收班、捷運收班就整組沒車可量），所以同一棵樹在早上跑跟半夜跑，總數本來就不一樣，
拿數字比會得到假訊號。正確的判準只有一個：

> **合併後出現的 FAIL，每一項都要能在下面這兩份原始輸出裡找到同名的那一條。**
> 出現新名字＝合併把東西弄掉了，不管總數是多少。

原始輸出（合併前，2026-08-27 03:0x 實測，逐行完整保留）：
- `docs/android/_baseline-font-scale.txt`
- `docs/android/_baseline-landscape.txt`

> 🔴 **這兩份基準停在 `0514242` 那一輪，之後的「頂列收成一顆」那顆已經讓它們過期**：
> `verify_font_scale` 多了一整個 TB 段（+329 條），A／X／Y 段的判準名稱也因為四顆分頁收合而改過
> （`A1 正向對照:群組切換器量得到…`），`verify_landscape` 的 `L10` 改名成「分組切換」。
> **派 Codex 之前要先在這棵樹重跑一次全矩陣重產這兩份檔**，否則 `comm -13` 會把「改過名字的判準」
> 一律報成新的紅（心得 32：拿釘死的舊產物當比對基準，全綠與全紅都是假的）。
> 重產指令：
>
> ```bash
> PORT=5741 node scripts/verify_font_scale.mjs > docs/android/_baseline-font-scale.txt 2>&1
> node scripts/verify_landscape.mjs > docs/android/_baseline-landscape.txt 2>&1
> ```

取 FAIL 名單的指令：

```bash
grep '^FAIL' docs/android/_baseline-font-scale.txt | sed 's/ — .*//' | sort > /tmp/before.txt
grep '^FAIL' <合併後的輸出>                        | sed 's/ — .*//' | sort > /tmp/after.txt
comm -13 /tmp/before.txt /tmp/after.txt   # 這裡有東西＝新的紅＝要查
```

| 腳本 | 通過／總數 | 紅的那些是什麼 |
|---|---|---|
| `scripts/verify_font_scale.mjs`（全段，chromium＋webkit） | **1058／1080** | 全部 22 條都是 `V` 段（`V1`–`V6`、`V12`–`V15` 各兩個引擎，外加該段拋例外的 `V✱`）＝深夜捷運收班、古亭看板沒有列可量。另外 `E4c`／`E4e` 在台鐵只剩一班時也會紅（同一晚較早那輪就紅過，這輪台鐵班次變了就綠了）——**同一棵樹不同時段紅的組成會變，這正是不能用數字比大小的原因** |
| `scripts/verify_landscape.mjs`（全尺寸，chromium＋webkit） | **33／91** | 12× `L0`、12× `L13`、6× `L5`、6× `L10`、2× `F0`、2× `V1`、6× `V4`、2× `P4`（全部自報「深夜無台鐵車＝環境條件」）＋2× `L9`／`L15b`（前面沒車可量的下游覆蓋率）＋6× `L6/L7`（既有的零回歸差異） |
| `scripts/verify_sheet_sizes.mjs` | **37／37** | — |
| `scripts/verify_merge_no_loss.mjs` | 對照組全綠、突變組逐項轉紅 | — |

**這些紅不是本批造成的——已經用控制組證明過（心得 34 的分辨實驗）：**
在**乾淨的基線樹**（`.claude/worktrees/redesign-base`，detached 在 `23ac887`、零未 commit 改動）
跑同一支 `verify_landscape.mjs`，得 25／83，而兩邊的 **FAIL 名單逐項完全相同**
（58 條同名、只在工作樹紅的 0 條、只在基線樹紅的 0 條）。
83→91 那 8 條差額，正好是本輪新增而且全綠的 `L4s1`–`L4s4`（兩個引擎各一份）。

### 已知的環境相依紅（不是回歸，不要照著改期望值）

深夜捷運收班之後，古亭站看板沒有列可量 ⇒ `verify_font_scale` 的 **V 段**（捷運看板組標題那批：
`V1`–`V6`、`V12`–`V15`，兩個引擎各一份，外加該段拋例外的 `V✱`）整批轉紅；台鐵班次剩一班時
`E4c`／`E4e`（看板重繪的正向對照與對照組）也會紅。

**分辨方法（派工單鐵則 7）**：把同一批段別對「合併前的樹」再跑一次，
FAIL 清單**逐項相同**＝環境條件，不是回歸。2026-08-27 就是這樣分辨的——
基線樹（`23ac887`）與工作樹跑 `SECTIONS=E,L,V`，FAIL 名單一字不差。

`L12`（展開段那一頁不是透明的）在其中一輪 full run 出現過一次紅，同一支腳本連跑兩輪各 25/25 通過，
基線樹也沒有——**間歇性**，不是本批造成的。再看到它先重跑一次再判斷。

`I6`（徽章藏起來 ⇒ 該列整列消失）也曾在 full run 的 chromium 紅過一次、單獨重跑兩輪全綠。
這一條**已經找到根因並修掉**，不再是間歇性：`updateLiveBadge()` 每一拍都重寫
`liveBadge.hidden`，而測試的 `open()` 中間有 600ms 等待 ⇒ 產品的下一拍會把測試設的 `hidden`
撤銷，`I6` 就以 `drawn=true h=48`（跟 `I7` 的期望值一模一樣）報一個**假的產品失敗**。
修法是量測期間把那支重繪凍住，並新增 `I6a` 這條**前置條件斷言**（心得 17：前置沒成立就不能
拿結果當產品判準）。突變測試已確認 `I6` 仍有牙：把 `.ms-stat` 改成 `display:flex !important`
之後，`I6` 兩個引擎都紅而 `I6a` 保持綠。

---

## 二、合併與驗收進度（Codex 隨做隨填）

| # | 事項 | 狀態 | 證據 |
|---|---|---|---|
| 0 | 環境自檢（網路／git／server／playwright） | ☐ | |
| 1 | 建分支 `codex/android-redesign-v17` | ☐ | |
| 2 | `git merge build/redesign-901` 並解衝突 | ☐ | |
| 3 | `verify_merge_no_loss.mjs` 兩側聯集零缺 | ☐ | |
| 4 | 平台適配（派工單第五節逐項） | ☐ | |
| 5 | 本機 gitignored 檔就位 | ☐ | |
| 6 | 網頁層三支腳本 | ☐ | |
| 7 | `RAIL_VERIFY_NATIVE=android npm run verify` | ☐ | |
| 8 | Gradle bundleRelease／assembleRelease | ☐ | |
| 9 | 模擬器／真機七項驗收 | ☐ | |
| 10 | AAB／APK 路徑與 SHA-256 | ☐ | |

---

## 三、風險與未確定點（Codex 隨時追加）

- `versionCode 16` 到底有沒有上傳過 Play？決定這顆是 16 還是 17（派工單第五節 7）。
- v16 線的 `worker.js`／`privacy.html`／`terms.html` 改動與版面線是否有實質衝突。
