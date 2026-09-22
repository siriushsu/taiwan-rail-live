package tw.railisland.app;

import java.util.Map;

/**
 * 「最近的站」解析的【純判定層】——捷運、台鐵、(單元 C 之後的)公車三個小工具共用同一份。
 *
 * 🔴 一個 {@code android.*} 都不准 import。理由與 {@link MetroWidgetPlate} 相同：
 *    javac 就能單獨編、單獨跑（app/scripts/verify_widget_nearest.mjs），不必模擬器、不必 gradle。
 *    這一層要是混進 Context／Location，服務範圍那個比較就只有真機看得到＝等於沒有人驗過。
 *
 * 🔴 與 iOS {@code MetroNearestMath} 是姊妹：三態語意（可用／範圍外／沒有位置）、退快取旗標、
 *    「確認範圍外就清快取」這三條決定逐條對齊，兩端不可各自演化。
 */
final class WidgetNearestMath {
    private WidgetNearestMath() {}

    /** 運具鍵。半徑逐運具各一個值（見 MetroWidgetData.json 的 serviceRadii）。 */
    static final String METRO = "metro";
    static final String RAIL = "rail";

    /**
     * 「自動（最近的站）」的哨兵值。🔴 唯一一份——{@link MetroWidgetData#AUTO} 與
     * {@link RailWidgetData#AUTO} 都指過來（改版前是兩個各自寫死的 "__auto__" 字面值）。
     */
    static final String AUTO = "__auto__";

    /**
     * 這個 (sys, station) 可不可以進深連結。
     *
     * 🔴 哨兵 {@code __auto__} 與空值都【不准】進 URL：自動選站還沒解析出站的三種狀態
     *    （沒有位置／範圍外／目錄拋錯）如果照抄設定值，點下卡片會開 App 去查一個名叫
     *    「__auto__」的車站，等車卡當場落空。不帶參數＝「開 App，不指定站」。
     * 🔴 住在純層是為了驗得到：寫在 provider 的 Uri.Builder 旁邊時，這個判斷只有真機看得見。
     */
    static boolean linkable(String sys, String station) {
        return sys != null && !sys.isEmpty()
            && station != null && !station.isEmpty() && !AUTO.equals(station);
    }

    /**
     * 定位新鮮度窗。超過這個歲數的座標只能當「上次位置」用，不能當「現在在哪」。
     *
     * 🔴 Android 這一端【結構上】拿不到即時定位：小工具刷新跑在背景，而我們不申請
     *    ACCESS_BACKGROUND_LOCATION（Google Play 高風險審查，否決會擋更新並涵蓋所有測試軌道）。
     *    所以來源只有兩個：App 在前景時主動寫進來的那一筆，與系統的 last known。兩者都會過期，
     *    窗要比 iOS 的 600 秒寬得多——iOS 的 widget 可以自己 requestLocation()，我們不行。
     * 🔴 30 分鐘是取捨不是量測：再短一點，通勤族早上開一次 App、中午看小工具就變「上次位置」；
     *    再長一點，跨城市移動之後還會用舊座標解析。落在這之外時卡面【一定】會標示，
     *    所以選錯的代價是「標示得太早／太晚」，不是「畫了一個假的現在」。
     */
    static final long FIX_MAX_AGE_MS = 30 * 60 * 1000L;

    /** 一次定位。{@code fromApp} ＝ App 前景主動推進來的（對照：系統 last known）。 */
    static final class Fix {
        final double lat;
        final double lon;
        final long at;
        final boolean fromApp;

        Fix(double lat, double lon, long at, boolean fromApp) {
            this.lat = lat; this.lon = lon; this.at = at; this.fromApp = fromApp;
        }
    }

    /** 掃某一個運具的目錄之後，「最近的是誰、多遠」。誰最近與夠不夠近刻意分兩支。 */
    static final class Hit {
        final String key;
        final double meters;

        Hit(String key, double meters) { this.key = key; this.meters = meters; }
    }

    /** 解析的三態＋兩個旗標。與 iOS MetroNearest.resolve 的回傳逐項對齊。 */
    static final class Outcome {
        /** 可以照常走看板流程的站鍵。範圍外與完全沒有位置時是 null。 */
        final String key;
        /** 最近站在服務範圍外。卡面要講得出「最近的是誰、多遠」，故另外帶著。 */
        final boolean outOfRange;
        final String farKey;
        final double farMeters;
        /**
         * key 來自快取而不是這一輪的定位。
         * 🔴 一路帶到卡面。不標示的話，退化狀態與正常狀態長得一模一樣，
         *    使用者只會覺得「壞了」而無從分辨（2026-08-30 iOS 側回報的同一件事）。
         */
        final boolean stale;
        /**
         * 呼叫端要把快取【清掉】。
         * 🔴 只有「確認人在範圍外」才會是 true。留著的話下一輪定位失敗會退回幾百公里外那一站，
         *    卡上繼續畫它的倒數——那比直說範圍外更隱蔽，因為畫面看起來完全正常。
         */
        final boolean clearCache;

        private Outcome(String key, boolean outOfRange, String farKey, double farMeters,
                        boolean stale, boolean clearCache) {
            this.key = key; this.outOfRange = outOfRange; this.farKey = farKey;
            this.farMeters = farMeters; this.stale = stale; this.clearCache = clearCache;
        }

        static Outcome serviceable(String key) { return new Outcome(key, false, null, 0, false, false); }

        static Outcome outOfRange(String farKey, double meters) {
            return new Outcome(null, true, farKey, meters, false, true);
        }

        static Outcome fromCache(String key) { return new Outcome(key, false, null, 0, true, false); }

        static Outcome unavailable() { return new Outcome(null, false, null, 0, false, false); }

        /** 沒有位置也沒有快取：卡面走「還不知道你在哪」。三態的第三態。 */
        boolean noLocation() { return key == null && !outOfRange; }
    }

    /**
     * 🔴 服務範圍的【唯一】比較點。三個小工具、所有呼叫路徑都走這一支。
     *
     * 為什麼要獨立成一個具名函式（而不是寫在 decide 裡）：比較住在被測物下游時，把
     * {@code <=} 寫成 {@code >=} 照樣可以全綠——判準只量得到上游的「距離算得對」與
     * 「半徑是多少」。iOS 側 MetroNearestMath.classify 的註解記的是同一件事。
     */
    static boolean inRange(double meters, double radiusMeters) {
        return meters <= radiusMeters;
    }

    /** 這一筆定位還能不能當「現在在哪」。未來時戳（裝置時鐘跳動）一律視為新鮮。 */
    static boolean fresh(Fix fix, long nowMillis) {
        return fix != null && nowMillis - fix.at <= FIX_MAX_AGE_MS;
    }

    /** 兩個來源取比較新的那一筆。任一為 null 就取另一個。 */
    static Fix fresher(Fix a, Fix b) {
        if (a == null) return b;
        if (b == null) return a;
        return b.at > a.at ? b : a;
    }

    /** 逐運具取半徑。查不到或不是正數回 0 ⇒ 全部落在範圍外、卡面當場說話（不留字面值預設）。 */
    static double radiusOf(Map<String, Double> table, String modality) {
        Double value = table == null ? null : table.get(modality);
        return value == null || !(value > 0) ? 0 : value;
    }

    /**
     * 三態判定。呼叫端只負責「取位」與「掃自己的目錄」，判定與快取語意全在這裡。
     *
     * @param fix          這一輪能拿到的最新定位（可能是 null 或已過期）
     * @param hit          對 fix 掃出來的最近站（fix 為 null 時呼叫端給 null）
     * @param cachedKey    上次解析出來的站鍵（快取的是【站】不是座標：座標過期難判斷，
     *                     站名短時間內幾乎不變）
     */
    static Outcome decide(Fix fix, long nowMillis, Hit hit, double radiusMeters, String cachedKey) {
        if (!fresh(fix, nowMillis) || hit == null || hit.key == null || hit.key.isEmpty()) {
            return cachedKey == null || cachedKey.isEmpty()
                ? Outcome.unavailable()
                : Outcome.fromCache(cachedKey);
        }
        return inRange(hit.meters, radiusMeters)
            ? Outcome.serviceable(hit.key)
            : Outcome.outOfRange(hit.key, hit.meters);
    }

    /**
     * 範圍外時卡面那一行。距離【無條件進位】到公里：四捨五入會印出「約 12 公里」，
     * 而 12 公里正好是門檻值，使用者看了會覺得自己明明在範圍內卻被擋。
     * 文案與 iOS MetroNearestMath.outOfRangeHint 逐字相同。
     */
    static String outOfRangeKm(double meters) {
        return String.valueOf((long) Math.ceil(meters / 1000.0));
    }
}
