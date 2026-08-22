# 軌島 Android v14 進度

更新：2026-08-22

## 目前結論

- **環境自檢通過，v14 開始實作。**
- 指定 worktree、分支與基底正確；JDK 21／Gradle 正常；預置依賴與簽章設定存在。
- 正確主站 API `https://railisland.tw/api/trtc-live` 在提高權限後可連線。
- 任務提供的快照契約成立：`board[]` 318 列，其中 225 列帶 `eta2`、93 列沒有。

## 關鍵證據

工作樹與 Git：

```text
pwd
/Users/xuxiang/Code/捷運小動畫/.claude/worktrees/android-v14/app/android

git branch --show-current
codex/android-1.4.9-v14

git rev-parse --short=7 HEAD
4ae2cf1
```

Gradle／Java：

```text
Gradle 8.14.3
Launcher JVM: 21.0.12 (Homebrew 21.0.12)
Daemon JVM: /opt/homebrew/Cellar/openjdk@21/21.0.12/libexec/openjdk.jdk/Contents/Home
OS: Mac OS X 27.0 aarch64
```

預置項目：

```text
app/node_modules=present
app/android/key.properties=present
app/android/app/google-services.json=present
```

網路與 fixture 自檢：

```text
GET https://railisland.tw/api/trtc-live
HTTP 回應 JSON，src=trtc

docs/android/fixtures/trtc-live-sample-20260822.json
bytes=449250 board=318 eta2=225 withoutEta2=93
```

## 待辦與風險

- 待完成 Android `eta2` approx 解析、快取 round-trip 與渲染精度判準。
- 待重建 web bundle、同步 Capacitor、建置簽章 release 產物並完成模擬器 E2E。
