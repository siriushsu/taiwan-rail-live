package tw.railisland.app;

/**
 * 一格小工具要顯示的東西（純值）＋八種狀態的判定。
 *
 * 🔴 為什麼是純 Java、一個 android.* 都不 import：RemoteViews 只能在裝置上算繪，狀態若寫在
 *    binder 裡就【只有上真機才看得到】——iOS 那兩張 Live Activity 就是這樣拖到改版才被發現
 *    五種狀態從來沒被看過。攤成純值之後，八種狀態可以用 javac 單獨編起來跑斷言
 *    （app/scripts/verify_metro_plate_states.mjs），出貨路徑與驗收走同一個 of(...)。
 *
 * 設計稿的骨架規則：「任何狀態都不改版面骨架，只換右側主角與註腳兩處。」
 * 主角只有四種形態：數字＋分、實心「進站」、灰字（暫無資料／已收班）、以及狀態 5 的警示帶。
 * 這四種以外不要再發明第五種——所以 Hero 是列舉不是字串。
 */
final class MetroWidgetPlate {

    /** 設計稿的八種狀態。優先序＝由上到下（先命中的贏）。 */
    enum State {
        UNSET,        // 6 · 未設定車站（空狀態）
        SUSPENDED,    // 5 · 服務中斷（唯一用紅的狀態）
        STALE,        // 3 · 資料延遲／離線
        CLOSED,       // 8 · 深夜無班次
        LAST_TRAIN,   // 4 · 末班車
        ARRIVING,     // 2 · 即將進站
        PASS_LIMITED, // 7 · 通行證限制（不擋住第一站）
        NORMAL        // 1 · 正常候車
    }

    /** 四種主角形態。第五種不存在。 */
    enum Hero { MINUTES, ARRIVING, TEXT, NONE }

    /** header 右邊那顆狀態 chip。 */
    enum Chip { LIVE, RECONNECT, LAST, ALERT, PASS, PLAIN }

    /** 主角與註腳的顏色語意。紅只給真異常。 */
    enum Tone { INK, OK, WARN, BAD, FAINT }

    // ── header ──
    String badge;            // 官方站號 R10／BL12。對不到就 null ⇒ 不畫徽章（不編一個假的）
    String badgeColor;       // 路線色（徽章底）
    boolean badgeDarkInk;    // 環狀線 #FFDB00 在紙上對比不足 ⇒ 徽章改深墨字
    String lineLabel;
    Chip chip = Chip.LIVE;
    String chipText = "LIVE";
    String stamp = "";

    // ── body ──
    String station = "";
    String stationEn = "";   // 官方英文站名，全大寫（設計稿的站名牌字樣）
    String dest = "";
    Hero hero = Hero.MINUTES;
    String heroValue = "";
    Tone heroTone = Tone.INK;

    // ── 註腳與警示帶 ──
    String footLeft = "";
    String footRight = "";
    Tone footLeftTone = Tone.FAINT;
    Tone footRightTone = Tone.FAINT;
    int[] crowd;             // 六節車廂。null ⇒ 這個系統沒有擁擠度資料，整條不畫
    String band;             // 只有 SUSPENDED 與「本站觀測」提醒會有
    boolean bandBad;         // true＝紅（營運方公告的真異常）；false＝琥珀（本站觀測／資料類）
    State state = State.NORMAL;

    // ── 4×3 的前後站帶（同一條線上的鄰站，目錄裡的站序本來就有序）──
    String prevStation;
    String nextStation;

    // ── 1b 夜行看板那一列的第二、三個數字（純分鐘，不帶單位；單位寫在註腳「單位分鐘」）──
    String boardSecond;
    String boardThird;

    /** of(...) 的輸入。全部是已經取好的原始值，這個類別不做任何 I/O。 */
    static final class Input {
        String station;          // null ⇒ 還沒設定
        String stationEn;
        String stationCode;
        String lineLabel;
        String lineColor;
        String dest;
        Double etaEpochSec;      // 官方秒級到站時刻（北捷）
        Integer minutes;         // 只有整數分鐘的系統（高捷／機捷）
        Integer secondMinutes;   // 再下班
        Integer thirdMinutes;
        int[] crowd;
        double dataAtEpochSec;   // 這份資料的時刻（不是讀取端時鐘）
        boolean fetchFailed;
        String lastTrainTime;    // 官方末班時刻字面值 HH:MM，沒有就 null
        String firstTrainTime;   // 官方首班時刻字面值 HH:MM（分歧的鍵不會有值）
        boolean serviceClosed;   // 已過末班或還沒到首班
        String alertTitle;       // 營運通阻公告（status != 1）
        boolean alertFromOperator;  // true＝營運方公告 ⇒ 紅；false＝本站觀測 ⇒ 琥珀
        boolean passLimited;     // 免費版：這一格是唯一可用的那站
        String prevStation;
        String nextStation;
        double nowEpochSec;
    }

    /** 資料過期門檻：與 iOS 候車卡同一個 90 秒（設計稿：超過就把倒數換成「暫無資料」）。 */
    static final double STALE_SECONDS = 90;
    /** 不足一分鐘一律收斂成「進站」。 */
    static final double ARRIVING_SECONDS = 60;

    static MetroWidgetPlate of(Input in) {
        MetroWidgetPlate p = new MetroWidgetPlate();
        if (in.station == null || in.station.isEmpty()) {
            p.state = State.UNSET;
            p.hero = Hero.NONE;
            return p;
        }
        p.station = in.station;
        p.stationEn = in.stationEn == null ? "" : in.stationEn.toUpperCase();
        p.badge = in.stationCode;
        p.badgeColor = in.lineColor;
        p.badgeDarkInk = isPaleLine(in.lineColor);
        p.lineLabel = in.lineLabel;
        p.dest = in.dest == null || in.dest.isEmpty() ? "" : "往 " + in.dest;
        p.crowd = in.crowd;
        p.prevStation = in.prevStation;
        p.nextStation = in.nextStation;

        Double left = in.etaEpochSec == null ? null : in.etaEpochSec - in.nowEpochSec;
        boolean arriving = left != null && left < ARRIVING_SECONDS;
        // 🔴 過期看【資料時刻】不看讀取端時鐘：後者對「被某層快取餵了舊主體」永遠是新鮮的，
        //    結構上不可能報壞（這個專案在原生用戶端吃過一次）。
        double age = in.dataAtEpochSec > 0 ? in.nowEpochSec - in.dataAtEpochSec : 0;
        boolean stale = in.fetchFailed || (in.dataAtEpochSec > 0 && age > STALE_SECONDS);
        boolean hasReading = in.etaEpochSec != null || in.minutes != null;

        // ── 狀態判定（設計稿的優先序）──
        if (in.alertTitle != null && !in.alertTitle.isEmpty() && in.alertFromOperator) {
            p.state = State.SUSPENDED;
        } else if (stale || !hasReading && !in.serviceClosed) {
            p.state = State.STALE;
        } else if (in.serviceClosed && !hasReading) {
            p.state = State.CLOSED;
        } else if (in.lastTrainTime != null && !in.lastTrainTime.isEmpty()) {
            p.state = State.LAST_TRAIN;
        } else if (arriving) {
            p.state = State.ARRIVING;
        } else if (in.passLimited) {
            p.state = State.PASS_LIMITED;
        } else {
            p.state = State.NORMAL;
        }

        // ── 主角：狀態決定形態，形態決定字 ──
        switch (p.state) {
            case SUSPENDED:
                p.hero = Hero.NONE;
                break;
            case STALE:
                p.hero = Hero.TEXT; p.heroValue = "暫無資料"; p.heroTone = Tone.FAINT;
                break;
            case CLOSED:
                p.hero = Hero.TEXT; p.heroValue = "已收班"; p.heroTone = Tone.FAINT;
                break;
            default:
                if (arriving) {
                    // 末班車進站時也要走實心「進站」，不是「0 分」——所以主角不是純狀態表，
                    // 而是狀態＋還剩幾秒一起決定的。
                    p.hero = Hero.ARRIVING; p.heroValue = "進站";
                } else {
                    p.hero = Hero.MINUTES;
                    p.heroValue = minutesText(left, in.minutes);
                    p.heroTone = p.state == State.LAST_TRAIN ? Tone.WARN : Tone.INK;
                }
        }

        // ── chip 與註腳：一個狀態一列，沒有交叉 ──
        switch (p.state) {
            case SUSPENDED:
                p.chip = Chip.ALERT; p.chipText = "營運異常"; p.stamp = "";
                // 🔴 這裡【不准】自己寫「暫停營運」：官方公告可能是延誤、可能是單向不停靠，
                //    寫死一個更嚴重的說法就是拿官方值去推論。要說什麼由 band 裡的官方標題原文說。
                p.band = in.alertTitle; p.bandBad = true;
                p.footLeft = ""; p.footRight = "";
                p.crowd = null;   // 主角與註腳都空了，擁擠度不要一個人留在版面上
                break;
            case STALE:
                p.chip = Chip.RECONNECT; p.chipText = "連線中";
                p.stamp = in.dataAtEpochSec > 0 ? hhmm(in.dataAtEpochSec) + " 資料" : "";
                p.footLeft = in.dataAtEpochSec > 0 ? "顯示 " + hhmm(in.dataAtEpochSec) + " 最後資料" : "尚未取得資料";
                p.footRight = "正在重新連線";
                p.footLeftTone = Tone.WARN;
                p.crowd = null;   // 舊的擁擠度不要跟著留在畫面上，它是那一刻的事實不是現在的
                break;
            case CLOSED:
                p.chip = Chip.PLAIN; p.chipText = ""; p.stamp = hhmm(in.nowEpochSec);
                // 首班只有在官方值【沒有分歧】時才有（分歧的鍵在資料建置階段就不輸出），
                // 所以這裡不必判斷、也不准自己挑一個。
                p.footLeft = in.firstTrainTime == null ? "" : "首班 " + in.firstTrainTime;
                p.footRight = in.firstTrainTime == null ? "" : untilText(in.firstTrainTime, in.nowEpochSec);
                p.crowd = null;
                break;
            case LAST_TRAIN:
                p.chip = Chip.LAST; p.chipText = "末班"; p.stamp = in.lastTrainTime;
                if (!p.dest.isEmpty()) p.dest = p.dest + " · " + in.lastTrainTime + " 發車";
                p.footLeft = "本日最後一班"; p.footLeftTone = Tone.WARN;
                p.footRight = "請預留進站時間";
                break;
            case PASS_LIMITED:
                p.chip = Chip.PASS; p.chipText = "通行證"; p.stamp = "";
                p.footLeft = "第 2 站起需要通行證"; p.footLeftTone = Tone.WARN;
                p.footRight = "了解";
                p.crowd = null;   // 註腳右邊被「了解」占用了，擁擠度不硬塞
                break;
            default:
                p.chip = Chip.LIVE; p.chipText = "LIVE"; p.stamp = hhmm(in.dataAtEpochSec);
                p.footLeft = nextText(in.secondMinutes, in.thirdMinutes);
                p.footRight = crowdWord(in.crowd);
        }

        // 看板那一列的第二、三個數字。設計稿把單位提到註腳（「單位分鐘」）⇒ 這裡只放數字。
        // 🔴 主角不是數字（暫無資料／已收班／營運異常）時，後面兩個數字要一起收掉——
        //    否則畫面會變成「— 9 15」：左邊說沒有資料，右邊卻報得出兩班車。
        boolean numeric = p.hero == Hero.MINUTES || p.hero == Hero.ARRIVING;
        p.boardSecond = !numeric || in.secondMinutes == null ? null : String.valueOf(in.secondMinutes);
        p.boardThird = !numeric || in.thirdMinutes == null ? null : String.valueOf(in.thirdMinutes);

        // 本站觀測／資料類提醒：不是營運異常，不能用紅（設計稿：紅只給真異常）。
        if (p.band == null && in.alertTitle != null && !in.alertTitle.isEmpty() && !in.alertFromOperator) {
            p.band = in.alertTitle;
            p.bandBad = false;
        }
        return p;
    }

    /** 設計稿：環狀線 #FFDB00 在琺瑯紙上對比不足，站號徽章需改深墨字，「其餘路線色一律白字」。
     *  判準用亮度不用白名單，免得下次多一條淺色路線又要回來改程式。
     *
     *  🔴 門檻 190 是量出來的，不是猜的：九條官方路線色算下來，最亮的兩個是
     *     環狀線 #FFDB00＝205（要深墨字）與中和新蘆線 #F5A818＝174（設計稿要白字），
     *     門檻必須落在這兩個值之間。第一版寫 170 就讓中和新蘆線一起變深墨字，
     *     被 verify_metro_plate_states.mjs 的逐線斷言抓到——那支 gate 是逐條線對設計稿的
     *     結論，不是對這個數字，所以下次色票變了它還是會說話。 */
    static boolean isPaleLine(String hex) {
        int rgb = parseHex(hex);
        if (rgb < 0) return false;
        int r = (rgb >> 16) & 0xFF, g = (rgb >> 8) & 0xFF, b = rgb & 0xFF;
        return (0.299 * r + 0.587 * g + 0.114 * b) > 190;
    }

    static int parseHex(String hex) {
        if (hex == null) return -1;
        String s = hex.startsWith("#") ? hex.substring(1) : hex;
        if (s.length() != 6) return -1;
        try { return Integer.parseInt(s, 16); } catch (NumberFormatException e) { return -1; }
    }

    /** 分鐘取 floor 不取 ceil（與 iOS 同一條）：ceil 會讓「1 分」只出現一秒就跳掉。
     *  整數分鐘的系統多一個「約」字——那是精度差異在畫面上的唯一顯形處，不可省。 */
    static String minutesText(Double leftSec, Integer minutes) {
        if (leftSec != null) return String.valueOf((int) Math.floor(leftSec / 60));
        if (minutes != null) return "約 " + minutes;
        return "—";
    }

    static String nextText(Integer second, Integer third) {
        if (second == null) return "";
        if (third == null) return "再下班 " + second + " 分";
        return "再下班 " + second + " 分 · " + third + " 分";
    }

    /** 擁擠度旁邊固定附一個詞（顏色不獨立表意）。 */
    static String crowdWord(int[] crowd) {
        if (crowd == null || crowd.length == 0) return "";
        int sum = 0;
        for (int c : crowd) sum += c;
        double avg = (double) sum / crowd.length;
        if (avg < 1.6) return "舒適";
        if (avg < 2.6) return "略擠";
        return "擁擠";
    }

    static String hhmm(double epochSec) {
        if (epochSec <= 0) return "";
        // 固定台北時間，不吃裝置時區（與全專案同一條）。
        long sec = (long) (epochSec + 8 * 3600) % 86400;
        return String.format("%02d:%02d", sec / 3600, (sec % 3600) / 60);
    }

    /** 「還有 4 小時 48 分」。跨午夜就加一天，不會算出負數。 */
    static String untilText(String hhmm, double nowEpochSec) {
        if (hhmm == null || hhmm.length() < 4 || hhmm.indexOf(':') < 0) return "";
        String[] parts = hhmm.split(":");
        int target;
        try { target = Integer.parseInt(parts[0]) * 60 + Integer.parseInt(parts[1]); }
        catch (NumberFormatException e) { return ""; }
        long nowMin = (long) ((nowEpochSec + 8 * 3600) % 86400) / 60;
        long diff = target - nowMin;
        if (diff < 0) diff += 24 * 60;
        long h = diff / 60, m = diff % 60;
        if (h == 0) return "還有 " + m + " 分";
        return "還有 " + h + " 小時 " + m + " 分";
    }
}
