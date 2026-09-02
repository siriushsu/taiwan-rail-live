#!/usr/bin/env node
// 驗 Android 小工具的八種狀態（設計稿 1a）。
//
// 🔴 為什麼驗得起來：MetroWidgetPlate.java 一個 android.* 都沒有 import ⇒ javac 就能單獨編，
//    不必模擬器、不必 gradle、不必把小工具放到桌面。改版前這八種狀態【只有真機看得到】，
//    等於沒有人驗過（iOS 那兩張 Live Activity 是同一個病）。
// 🔴 這支只驗「狀態判定與文案」。版面（RemoteViews）另外由模擬器上的預覽頁算繪，
//    兩件事不要混在一起——混在一起就會出現「編得過就算過」。
//
// 用法：node app/scripts/verify_metro_plate_states.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../android/app/src/main/java/tw/railisland/app/MetroWidgetPlate.java');
const work = resolve(here, '../../tmp/plate-gate');

const plate = readFileSync(src, 'utf8');
// 一道很便宜的前置閘門：這個檔一旦開始 import android.*，上面那個「javac 編得起來」的前提
// 就沒了，而症狀會是一堆看不懂的編譯錯誤而不是「前提壞了」。
if (/^import\s+android/m.test(plate)) {
  throw new Error('MetroWidgetPlate.java 開始 import android.* 了 ⇒ 這支驗收腳本的前提已經不成立');
}

// 官方公告的路線色（設計稿「路線色（官方公告值）」那一節逐字抄）。
// 設計稿：「環狀線 #FFDB00 在琺瑯紙上對比不足，站號徽章需改用深墨字，其餘路線色一律白字。」
const LINES = [
  ['淡水信義線 R', '#D90023', false],
  ['板南線 BL', '#0070BD', false],
  ['松山新店線 G', '#107547', false],
  ['中和新蘆線 O', '#F5A818', false],
  ['文湖線 BR', '#C48C31', false],
  ['環狀線 Y', '#FFDB00', true],
  ['機場捷運 A', '#8246AF', false],
  ['台中綠線 TG', '#79BB29', false],
  ['高雄紅線 R', '#E4002B', false],
];

const gate = `package tw.railisland.app;

public final class PlateGate {
    static int fail = 0;

    static void ok(boolean cond, String what) {
        if (!cond) { System.out.println("FAIL " + what); fail++; }
    }

    static MetroWidgetPlate.Input base(double now) {
        MetroWidgetPlate.Input in = new MetroWidgetPlate.Input();
        in.station = "台北車站";
        in.stationEn = "Taipei Main Station";
        in.stationCode = "R10";
        in.lineLabel = "淡水信義線";
        in.lineColor = "#D90023";
        in.dest = "淡水";
        in.etaEpochSec = now + 150;
        in.secondMinutes = 7;
        in.thirdMinutes = 14;
        in.crowd = new int[] {1, 1, 2, 2, 1, 1};
        in.dataAtEpochSec = now - 8;
        in.nowEpochSec = now;
        return in;
    }

    public static void main(String[] args) {
        // 固定時鐘：08:00:00 +08（不用 now，否則跨午夜與跨日的斷言會隨執行時間飄）。
        double now = 1786000000;

        // ── 狀態 1 · 正常候車 ──
        MetroWidgetPlate p1 = MetroWidgetPlate.of(base(now));
        ok(p1.state == MetroWidgetPlate.State.NORMAL, "正常候車應為 NORMAL，實得 " + p1.state);
        ok(p1.hero == MetroWidgetPlate.Hero.MINUTES && p1.heroValue.equals("2"),
           "150 秒應顯示「2」（floor 不 ceil），實得 " + p1.heroValue);
        ok(p1.chipText.equals("LIVE"), "正常候車的 chip 應為 LIVE");
        ok(p1.footLeft.equals("再下班 7 分 · 14 分"), "註腳左邊應列再下班兩班，實得 " + p1.footLeft);
        ok(p1.footRight.equals("舒適"), "擁擠度必須附一個詞（顏色不獨立表意），實得 " + p1.footRight);
        ok(p1.stationEn.equals("TAIPEI MAIN STATION"), "英文站名要全大寫（站名牌字樣）");

        // ── eta2 推導列 · 精度紅線 ──
        MetroWidgetPlate.Input approx = base(now);
        approx.secondMinutes = 4; approx.secondApprox = true; approx.thirdMinutes = null;
        MetroWidgetPlate pa = MetroWidgetPlate.of(approx);
        ok(pa.footLeft.equals("再下班 約 4 分"),
           "eta2 次班只准顯示「約 N 分」，實得 " + pa.footLeft);
        ok("約 4".equals(pa.boardSecond),
           "夜行看板的 eta2 次班也必須帶「約」，實得 " + pa.boardSecond);
        ok(!pa.footLeft.matches(".*[0-9]{1,2}:[0-9]{2}.*")
              && !pa.boardSecond.matches(".*[0-9]{1,2}:[0-9]{2}.*"),
           "eta2 次班絕不准出現 mm:ss 秒級倒數");
        MetroWidgetPlate.Input officialSecond = base(now);
        officialSecond.secondMinutes = 4; officialSecond.secondApprox = false; officialSecond.thirdMinutes = null;
        MetroWidgetPlate po = MetroWidgetPlate.of(officialSecond);
        ok(po.footLeft.equals("再下班 4 分") && "4".equals(po.boardSecond),
           "官方次班要維持原樣，不准被一起降級成約分鐘，實得 " + po.footLeft);

        // ── 狀態 2 · 即將進站 ──
        MetroWidgetPlate.Input a = base(now); a.etaEpochSec = now + 40;
        MetroWidgetPlate p2 = MetroWidgetPlate.of(a);
        ok(p2.state == MetroWidgetPlate.State.ARRIVING, "剩 40 秒應為 ARRIVING，實得 " + p2.state);
        ok(p2.hero == MetroWidgetPlate.Hero.ARRIVING && p2.heroValue.equals("進站"),
           "不足一分鐘要用實心「進站」不是秒數，實得 " + p2.heroValue);
        // 分界兩側：59 進站、61 分鐘。門檻寫死在 gate 裡不讀受測物的常數。
        a.etaEpochSec = now + 59;
        ok(MetroWidgetPlate.of(a).hero == MetroWidgetPlate.Hero.ARRIVING, "剩 59 秒該是進站");
        a.etaEpochSec = now + 61;
        ok(MetroWidgetPlate.of(a).hero == MetroWidgetPlate.Hero.MINUTES, "剩 61 秒該是分鐘");
        ok(MetroWidgetPlate.ARRIVING_SECONDS == 60, "進站門檻被改動（設計稿是不足一分鐘）");

        // ── 狀態 3 · 資料延遲／離線 ──
        MetroWidgetPlate.Input s = base(now); s.dataAtEpochSec = now - 91;
        MetroWidgetPlate p3 = MetroWidgetPlate.of(s);
        ok(p3.state == MetroWidgetPlate.State.STALE, "資料 91 秒應為 STALE，實得 " + p3.state);
        ok(p3.hero == MetroWidgetPlate.Hero.TEXT && p3.heroValue.equals("暫無資料"),
           "過期要拿掉主角數字（留著不再變動的數字比空白更危險），實得 " + p3.heroValue);
        ok(p3.chipText.equals("連線中"), "過期的 chip 應為「連線中」");
        ok(p3.footLeft.contains("最後資料"), "過期要講清楚畫面上是哪一刻的資料，實得 " + p3.footLeft);
        ok(p3.crowd == null, "過期不可以留著舊的擁擠度——那是那一刻的事實，不是現在的");
        MetroWidgetPlate.Input fresh = base(now); fresh.dataAtEpochSec = now - 89;
        ok(MetroWidgetPlate.of(fresh).state != MetroWidgetPlate.State.STALE, "資料 89 秒不該被判過期");
        ok(MetroWidgetPlate.STALE_SECONDS == 90, "過期門檻被改動（設計稿是 90 秒）");
        MetroWidgetPlate.Input failed = base(now); failed.fetchFailed = true;
        ok(MetroWidgetPlate.of(failed).state == MetroWidgetPlate.State.STALE, "抓不到資料也算 STALE");

        // ── 狀態 4 · 末班車 ──
        MetroWidgetPlate.Input l = base(now); l.lastTrainTime = "23:58"; l.etaEpochSec = now + 480;
        MetroWidgetPlate p4 = MetroWidgetPlate.of(l);
        ok(p4.state == MetroWidgetPlate.State.LAST_TRAIN, "末班應為 LAST_TRAIN，實得 " + p4.state);
        ok(p4.heroTone == MetroWidgetPlate.Tone.WARN, "末班的主角用琥珀（紅只給真異常）");
        ok(p4.dest.contains("23:58"), "末班要講發車時刻，實得 " + p4.dest);
        ok(p4.footLeft.equals("本日最後一班"), "註腳要明講這是今天最後一班");
        // 末班車正在進站：主角要是實心「進站」，不可以退化成「0 分」
        l.etaEpochSec = now + 30;
        MetroWidgetPlate p4b = MetroWidgetPlate.of(l);
        ok(p4b.state == MetroWidgetPlate.State.LAST_TRAIN, "末班進站時狀態仍是末班");
        ok(p4b.hero == MetroWidgetPlate.Hero.ARRIVING,
           "末班進站要走實心「進站」，不是「0 分」，實得 " + p4b.heroValue);

        // ── 狀態 5 · 服務中斷（唯一用紅的狀態）──
        MetroWidgetPlate.Input x = base(now);
        x.alertTitle = "中山—淡水 區間電力事故，恢復時間未定"; x.alertFromOperator = true;
        MetroWidgetPlate p5 = MetroWidgetPlate.of(x);
        ok(p5.state == MetroWidgetPlate.State.SUSPENDED, "營運方公告應為 SUSPENDED，實得 " + p5.state);
        ok(p5.hero == MetroWidgetPlate.Hero.NONE, "服務中斷時不畫倒數（沒有可信的下一班）");
        ok(p5.band != null && p5.bandBad, "服務中斷要有紅色警示帶");
        // 🔴 官方公告可能是延誤、單向不停靠、恢復時間未定——一律照抄標題原文，
        //    不准自己在畫面上升級成「暫停營運」這種更嚴重的說法。
        ok(x.alertTitle.equals(p5.band), "警示帶必須是官方標題原文，實得 " + p5.band);
        ok(!p5.dest.contains("暫停") && !p5.dest.contains("停駛"),
           "不准自己推論成停駛／暫停營運，實得 " + p5.dest);
        ok(p5.crowd == null, "主角與註腳都空了，擁擠度不可以自己留在版面上");
        ok(p5.boardSecond == null && p5.boardThird == null,
           "看板：主角不是數字時後面兩班要一起收掉（不可以左邊說沒資料、右邊報得出班次）");
        MetroWidgetPlate.Input staleBoard = base(now);
        staleBoard.dataAtEpochSec = now - 400;
        MetroWidgetPlate pStaleBoard = MetroWidgetPlate.of(staleBoard);
        ok(pStaleBoard.boardSecond == null && pStaleBoard.boardThird == null,
           "看板：資料延遲時後面兩班也要收掉，實得 " + pStaleBoard.boardSecond);
        MetroWidgetPlate pNumeric = MetroWidgetPlate.of(base(now));
        ok(pNumeric.boardSecond != null,
           "正向對照：正常候車時後面兩班【要】有數字，否則上面那兩條斷言等於什麼都沒驗");
        // 本站觀測的提醒不是營運異常：不可以用紅，也不可以蓋掉倒數
        MetroWidgetPlate.Input self = base(now);
        self.alertTitle = "列車位置暫時改用班表推估"; self.alertFromOperator = false;
        MetroWidgetPlate pSelf = MetroWidgetPlate.of(self);
        ok(pSelf.state == MetroWidgetPlate.State.NORMAL, "本站觀測的提醒不是服務中斷，實得 " + pSelf.state);
        ok(pSelf.band != null && !pSelf.bandBad, "本站觀測用琥珀不用紅（紅只給真異常）");
        ok(pSelf.hero == MetroWidgetPlate.Hero.MINUTES, "本站觀測不可以把倒數拿掉");

        // ── 狀態 6 · 未設定車站 ──
        MetroWidgetPlate.Input u = base(now); u.station = null;
        MetroWidgetPlate p6 = MetroWidgetPlate.of(u);
        ok(p6.state == MetroWidgetPlate.State.UNSET, "沒有站應為 UNSET，實得 " + p6.state);
        ok(p6.badge == null && p6.hero == MetroWidgetPlate.Hero.NONE,
           "空狀態不可以畫出空的站號徽章或空的倒數");

        // ── 狀態 7 · 通行證限制（不擋住第一站）──
        MetroWidgetPlate.Input g = base(now); g.passLimited = true;
        MetroWidgetPlate p7 = MetroWidgetPlate.of(g);
        ok(p7.state == MetroWidgetPlate.State.PASS_LIMITED, "免費版單站應為 PASS_LIMITED，實得 " + p7.state);
        ok(p7.hero == MetroWidgetPlate.Hero.MINUTES && p7.heroValue.equals("2"),
           "通行證提示【不可以】擋住第一站的倒數，實得 " + p7.heroValue);
        ok(p7.footLeft.contains("通行證"), "要講清楚第 2 站起才需要通行證");

        // ── 狀態 8 · 深夜無班次 ──
        MetroWidgetPlate.Input c = base(now);
        c.etaEpochSec = null; c.minutes = null; c.serviceClosed = true; c.firstTrainTime = "06:00";
        MetroWidgetPlate p8 = MetroWidgetPlate.of(c);
        ok(p8.state == MetroWidgetPlate.State.CLOSED, "收班後應為 CLOSED，實得 " + p8.state);
        ok(p8.hero == MetroWidgetPlate.Hero.TEXT && p8.heroValue.equals("已收班"),
           "收班要用灰字「已收班」，實得 " + p8.heroValue);
        ok(p8.footLeft.equals("首班 06:00"), "有官方首班值就要照抄，實得 " + p8.footLeft);
        ok(p8.footRight.startsWith("還有"), "要算出還有多久才有車，實得 " + p8.footRight);
        // 官方首班有分歧的鍵在資料建置階段就不輸出 ⇒ 這裡拿到 null，不准自己編一個
        c.firstTrainTime = null;
        MetroWidgetPlate p8b = MetroWidgetPlate.of(c);
        ok(p8b.footLeft.isEmpty() && p8b.footRight.isEmpty(),
           "沒有官方首班值就整行留白，不可以編一個時刻，實得 " + p8b.footLeft + "／" + p8b.footRight);

        // ── 主角只有四種形態 ──
        ok(MetroWidgetPlate.Hero.values().length == 4,
           "主角形態變成 " + MetroWidgetPlate.Hero.values().length + " 種（設計稿：四種以外不要再發明第五種）");
        // 八種狀態全部被上面走過一遍（少一種就是有狀態沒人驗）
        java.util.EnumSet<MetroWidgetPlate.State> seen = java.util.EnumSet.of(
            p1.state, p2.state, p3.state, p4.state, p5.state, p6.state, p7.state, p8.state);
        ok(seen.size() == MetroWidgetPlate.State.values().length,
           "只涵蓋 " + seen.size() + "/" + MetroWidgetPlate.State.values().length + " 種狀態");

        // ── 站號徽章的字色：設計稿只有環狀線改深墨字，其餘一律白字 ──
${LINES.map(([name, hex, pale]) =>
  `        ok(MetroWidgetPlate.isPaleLine("${hex}") == ${pale},\n` +
  `           "${name} ${hex} 的徽章字色判定與設計稿不符（應為${pale ? '深墨字' : '白字'}）");`).join('\n')}

        // ── 整數分鐘系統要有「約」字（精度差異在畫面上的唯一顯形處）──
        MetroWidgetPlate.Input m = base(now); m.etaEpochSec = null; m.minutes = 6;
        MetroWidgetPlate pm = MetroWidgetPlate.of(m);
        ok(pm.heroValue.equals("約 6"), "只有整數分鐘的系統要顯示「約」，實得 " + pm.heroValue);

        if (fail == 0) System.out.println("八種狀態 gate 全過（含分界兩側與九條路線色）");
        System.exit(fail == 0 ? 0 : 1);
    }
}
`;

rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, 'tw/railisland/app'), { recursive: true });
// 🔴 複製而不是 symlink：javac 的輸出目錄與來源目錄混在一起會把 .class 寫回工作樹。
writeFileSync(join(work, 'tw/railisland/app/MetroWidgetPlate.java'), plate);
writeFileSync(join(work, 'tw/railisland/app/PlateGate.java'), gate);

const javac = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin/javac') : 'javac';
const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin/java') : 'java';
execFileSync(javac, ['-encoding', 'UTF-8', '-d', join(work, 'out'),
  join(work, 'tw/railisland/app/MetroWidgetPlate.java'),
  join(work, 'tw/railisland/app/PlateGate.java')], { stdio: 'inherit' });
execFileSync(java, ['-Dfile.encoding=UTF-8', '-cp', join(work, 'out'), 'tw.railisland.app.PlateGate'],
  { stdio: 'inherit' });
