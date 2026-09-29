package tw.railisland.app;

import android.content.SharedPreferences;

import java.util.Collection;

/**
 * 小工具背景：A 車模頭帶／C 小世界場景／素色（使用者 2026-09-23 裁示「就用 A 跟 C」「三題都照建議」）。
 *
 * 🔴 選項名稱、順序、存值與 iOS 完全相同（iOS 的 AppIntent「背景」參數）；改任何一邊都要同步：
 *    台鐵／高鐵看板＝車模、場景、素色；捷運卡＝車模、素色（現有三個場景都是台鐵題材）；
 *    雙看板這一批兩平台都不加。沒設定過的格子（含舊版放上去的）一律當「車模」，與 iOS 參數預設值相同。
 */
final class WidgetBackground {
    private WidgetBackground() {}

    static final String MODEL = "model";
    static final String SCENE = "scene";
    static final String PLAIN = "plain";

    static final String[] RAIL_VALUES = { MODEL, SCENE, PLAIN };
    static final String[] RAIL_LABELS = { "車模", "場景", "素色" };
    static final String[] METRO_VALUES = { MODEL, PLAIN };
    static final String[] METRO_LABELS = { "車模", "素色" };

    static String key(int id) { return "bg_" + id; }

    /** 讀這一格的背景；讀到不認得的值（或捷運卡讀到場景）一律退回預設的車模，不畫猜的東西。 */
    static String read(SharedPreferences prefs, int id, boolean metro) {
        String value = prefs.getString(key(id), MODEL);
        String[] allowed = metro ? METRO_VALUES : RAIL_VALUES;
        for (String one : allowed) if (one.equals(value)) return value;
        return MODEL;
    }

    /**
     * 鐵路看板實際要畫的背景（與 iOS RailBoardEntryView.backdrop 同一條規則）：
     * 好讀版一律素色——頭帶／站名牌會再吃掉一列以上，字大與列數優先；
     * 「我的地點」的站會跟著位置換，頭帶的車與站名牌都綁不住那個語意，也是素色。
     */
    static String effective(SharedPreferences prefs, int id, String origin, boolean readable) {
        if (readable || RailWidgetData.isPlace(origin)) return PLAIN;
        return read(prefs, id, false);
    }

    /**
     * 車種 → 代表車（與 iOS 同一份對照表）。小工具資料只有車種（區間車／自強／區間快／莒光/復興／其他／高鐵），
     * 沒有細到車型的欄位 ⇒ 依裁示用車種代表車。莒光/復興畫 E400 機車頭（斜角看客車只是一個橘色箱子），
     * 其他畫藍皮 R135（「其他」多半是普快，畫 EMU900 會被看成區間車）。
     */
    static int railCar(String sys, String type) {
        if ("thsr".equals(sys)) return R.drawable.wg_car_700t;
        if (type == null) return R.drawable.wg_car_blue;
        switch (type) {
            case "自強": return R.drawable.wg_car_emu3000;
            case "區間車": return R.drawable.wg_car_emu900;
            case "區間快": return R.drawable.wg_car_emu800;
            case "莒光/復興":
            case "莒光":
            case "復興": return R.drawable.wg_car_e400;
            default: return R.drawable.wg_car_blue;
        }
    }

    /** 捷運路線 → 代表車；0＝不畫車（頭帶照留）。Android 捷運目錄只有 trtc／krtc／tymc。 */
    static int metroCar(String sys, String lineId) {
        if (sys == null || lineId == null) return 0;
        switch (sys) {
            case "trtc":
                switch (lineId) {
                    case "R": case "R_XBT": case "G": case "G_XBT": return R.drawable.wg_car_c381;
                    // 官方 trains[].stn 只給得出主代碼 O（字首字母），目錄才拆兩支 ⇒ 三個鍵都要認。
                    case "O": case "O_XINZHUANG": case "O_LUZHOU": return R.drawable.wg_car_c371;
                    case "BL": return R.drawable.wg_car_c341;
                    case "BR": return R.drawable.wg_car_val256;
                    case "Y": return R.drawable.wg_car_y100;
                    default: return 0;
                }
            case "krtc":
                switch (lineId) {
                    case "KR": case "KO": return R.drawable.wg_car_kaohsiung;
                    case "C": return R.drawable.wg_car_citadis;
                    default: return 0;
                }
            case "tymc": return R.drawable.wg_car_airportlocal;
            default: return 0;
        }
    }

    /**
     * 下一班是哪條線已知就畫那條線的車；不知道（轉乘站、資料沒帶線別）就看這一站所有候選路線：
     * 全部對到同一台車才畫，對到不同車就不畫——畫錯車比不畫更糟（與 iOS 同一條規則）。
     */
    static int metroCar(String sys, String lineId, Collection<String> stationLines) {
        int known = metroCar(sys, lineId);
        if (known != 0 || stationLines == null) return known;
        int only = 0;
        for (String line : stationLines) {
            int car = metroCar(sys, line);
            if (car == 0) continue;
            if (only != 0 && only != car) return 0;
            only = car;
        }
        return only;
    }
}
