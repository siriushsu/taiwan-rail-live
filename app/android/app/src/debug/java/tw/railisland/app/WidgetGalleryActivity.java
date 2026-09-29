package tw.railisland.app;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.RemoteViews;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

/**
 * 只存在於 debug build 的狀態畫廊：把八種狀態 × 三種尺寸的 RemoteViews 真的 inflate 出來，
 * 好在模擬器上一次截圖驗完。
 *
 * 🔴 為什麼需要它：RemoteViews 只有在真機／模擬器上才算得出畫面，而「把小工具一個一個放到桌面、
 *    再想辦法讓它進入末班車或斷線狀態」在自動化裡辦不到。這支把 provider 的資料層旁路掉、
 *    直接餵 MetroWidgetPlate.Input，於是每一種狀態都看得到。狀態判定本身另有 javac 斷言
 *    （app/scripts/verify_metro_plate_states.mjs）——這裡驗的是「畫出來長什麼樣」。
 *
 *    在 src/debug 而不是用 BuildConfig.DEBUG 包起來：後者會把這些示範值一起編進正式版。
 *
 * 用法：adb shell am start -n tw.railisland.app/.WidgetGalleryActivity --es size 4x2 --es kind plate
 *       size 可為 2x2／4x2／4x3／4x4（4x4＝大張卡片，兩種 kind 都走同一張 widget_board_4x4）
 *       雙看板（--es kind mixed）另收：--ei w／--ei h 卡片寬高 dp（launcher 回報的那個尺寸）、
 *       --ef scale 畫面縮放（Samsung One UI 先照回報尺寸排版、再整張縮小，A54 實測 0.8333）、
 *       --es state normal／suspended／norail／nometro／failed（資料延遲）／stale（上次位置）、--ez plus 暫時切換通行證旗標（畫完就還原）、
 *       --es lang zh-TW／en／ja 切換原生字串語言（寫進 debug App 自己的偏好，與正式版無關）。
 *       鐵路看板（--es kind rail）另收：--es size 2x2／4x2／4x4、--es bg model／scene／plain（小工具背景）、
 *       --ei w／--ei h 卡片寬高 dp、--es origin 起站、--es dest 目的站（直達模式）、--es type 第一班車種、
 *       --es sys tra／thsr（預設台鐵＋高鐵共站）。
 */
public final class WidgetGalleryActivity extends Activity {

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        String size = getIntent().getStringExtra("size");
        String kind = getIntent().getStringExtra("kind");
        if (size == null) size = "4x2";
        if ("rail".equals(kind) || "mixed".equals(kind)) {
            showParity("mixed".equals(kind));
            return;
        }
        boolean board = "board".equals(kind);
        int layoutRes = board
            ? ("4x3".equals(size) ? R.layout.widget_board_4x3
                : "2x2".equals(size) ? R.layout.widget_board_2x2 : R.layout.widget_board_4x2)
            : ("4x3".equals(size) ? R.layout.widget_plate_4x3
                : "2x2".equals(size) ? R.layout.widget_plate_2x2 : R.layout.widget_plate_4x2);
        int widthDp = getIntent().getIntExtra("w", "2x2".equals(size) ? 155 : 320);
        final String sizeKey = size;

        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setBackgroundColor(Color.rgb(90, 96, 104));   // 桌布替身：看得出卡片自己的邊界
        column.setPadding(dp(10), dp(10), dp(10), dp(10));

        for (Case sample : cases()) {
            TextView caption = new TextView(this);
            caption.setText(sample.name);
            caption.setTextColor(Color.WHITE);
            caption.setTextSize(11);
            caption.setPadding(0, dp(6), 0, dp(3));
            column.addView(caption);

            MetroWidgetPlate[] rows = board ? withSecondDirection(sample.plates()) : sample.plates();
            RemoteViews views = sample.message != null ? sample.message
                : "4x4".equals(size)
                ? MetroWidgetPlateRender.large(this, R.layout.widget_board_4x4, rows,
                    head(rows[0]), "單位分鐘", rows[0].footRight, rows[0].band, rows[0].bandBad, follows(rows))
                : board
                ? MetroWidgetPlateRender.board(this, layoutRes, rows, "4x3".equals(size) ? 3 : 2,
                    head(rows[0]), "單位分鐘", rows[0].footRight, rows[0].band, rows[0].bandBad)
                : MetroWidgetPlateRender.plate(this, layoutRes, sample.plates()[0], "2x2".equals(sizeKey));
            // --es bg model／plain：示範站是板南線台北車站 ⇒ 代表車 C341（WidgetBackground.metroCar）。
            if (sample.message == null) {
                MetroWidgetPlateRender.backdrop(views, board || "4x4".equals(sizeKey), "2x2".equals(sizeKey),
                    !WidgetBackground.PLAIN.equals(getIntent().getStringExtra("bg")),
                    // --es msys krtc --es line C：高捷輕軌 Citadis（最扁長的車，看車與字的間距）。
                    WidgetBackground.metroCar(getIntent().getStringExtra("msys") == null ? "trtc"
                        : getIntent().getStringExtra("msys"), getIntent().getStringExtra("line") == null ? "BL"
                        : getIntent().getStringExtra("line")));
            }
            LinearLayout holder = new LinearLayout(this);
            holder.setGravity(Gravity.START);
            // --ei h：固定卡片高度（桌面實測 5×2≈180dp、5×4≈377dp），看列數在真實高度下會不會被切。
            holder.addView(views.apply(this, holder),
                new LinearLayout.LayoutParams(dp(widthDp), getIntent().hasExtra("h")
                    ? dp(getIntent().getIntExtra("h", 0)) : ViewGroup.LayoutParams.WRAP_CONTENT));
            column.addView(holder);
        }

        ScrollView scroll = new ScrollView(this);
        scroll.addView(column);
        setContentView(scroll);
    }

    /** 新增的鐵路／雙看板真實 RemoteViews 預覽；只在 debug build 存在。 */
    private void showParity(boolean mixed) {
        long now = System.currentTimeMillis();
        String state = getIntent().getStringExtra("state");
        String lang = getIntent().getStringExtra("lang");
        if (lang != null) RailNativeL10n.setLanguage(this, lang);
        RailWidgetData.Snapshot rail = new RailWidgetData.Snapshot();
        String sysExtra = getIntent().getStringExtra("sys");
        rail.sys = sysExtra != null ? sysExtra : RailWidgetData.SYS_COMPOSITE;
        rail.systemLabel = "台鐵＋高鐵";
        rail.origin = getIntent().getStringExtra("origin") != null ? getIntent().getStringExtra("origin") : "板橋";
        rail.destination = getIntent().getStringExtra("dest") != null ? getIntent().getStringExtra("dest") : "";
        // 板橋在西部幹線上的兩個鄰站（南＝浮洲、北＝萬華）；換起站時就不帶，看單側／無帶子的樣子。
        if ("板橋".equals(rail.origin)) { rail.neighborSouth = "浮洲"; rail.neighborNorth = "萬華"; }
        rail.generatedAt = now;
        // 12 班＝RailWidgetData 一次最多給的班數，最高的格子也看得到「放滿」的樣子。
        String[] nos = { "123", "0567", "2551", "0812", "2733", "0149", "1234", "0655", "4003", "1181", "0671", "2557" };
        String[] types = { "自強", "高鐵", "區間車", "莒光", "區間快", "高鐵", "區間車", "高鐵", "自強", "區間車", "高鐵", "區間車" };
        String[] ends = { "花蓮", "南港", "基隆", "臺東", "蘇澳", "左營", "新竹", "南港", "樹林", "苗栗", "左營", "七堵" };
        if (getIntent().getStringExtra("type") != null) types[0] = getIntent().getStringExtra("type");
        for (int i = 0; i < nos.length && !"norail".equals(state); i++) {
            RailWidgetData.Row row = new RailWidgetData.Row();
            row.sys = "thsr".equals(sysExtra) || "高鐵".equals(types[i]) ? "thsr" : "tra";
            row.no = nos[i]; row.type = types[i]; row.terminus = ends[i];
            row.color = row.sys.equals("thsr") ? "#E85D0D" : i == 0 ? "#C0392B" : "#2E6FB0";
            row.relation = i == 4 ? RailWidgetData.Relation.PASS : RailWidgetData.Relation.DEPARTURE;
            row.scheduledAt = now + (i + 1) * 7 * 60_000L;
            row.delayMinutes = i == 2 ? Integer.valueOf(3)
                : i % 2 == 0 ? Integer.valueOf(0) : null;
            rail.rows.add(row);
        }

        RemoteViews views;
        int width = 340, height = 310;
        float scale = 1f;
        String caption = "台鐵／高鐵發車看板 · 4×4";
        if (mixed) {
            // 板橋捷運站的真實終點：板南線三個（含亞東醫院區間車）、環狀線兩個，依到站時刻排。
            MetroWidgetData.Snapshot metro = new MetroWidgetData.Snapshot();
            metro.sys = "trtc"; metro.systemLabel = "台北捷運"; metro.station = "板橋";
            metro.precision = "seconds"; metro.dataAt = now / 1000.0;
            String[][] trains = {
                { "南港展覽館", "BL", "120" }, { "頂埔", "BL", "300" }, { "新北產業園區", "Y", "420" },
                { "南港展覽館", "BL", "540" }, { "亞東醫院", "BL", "660" }, { "頂埔", "BL", "720" },
                { "大坪林", "Y", "780" }, { "南港展覽館", "BL", "960" }, { "新北產業園區", "Y", "1020" },
            };
            for (String[] train : trains) {
                MetroWidgetData.Row row = new MetroWidgetData.Row();
                boolean bl = "BL".equals(train[1]);
                row.dest = train[0]; row.eta = now / 1000.0 + Integer.parseInt(train[2]);
                row.color = bl ? "#0070BD" : "#FFDB00";
                row.lineLabel = bl ? "板南線" : "環狀線";
                row.lineId = train[1];
                metro.rows.add(row);
            }
            if ("suspended".equals(state)) {
                metro.alertTitle = "板南線因異物入侵，往南港展覽館方向延誤";
                metro.alertFromOperator = true;
            } else if ("nometro".equals(state)) {
                metro.rows.clear();
            } else if ("failed".equals(state)) {
                metro.failed = true;
            } else if ("stale".equals(state)) {
                metro.autoStale = true;
            }
            width = getIntent().getIntExtra("w", 401);
            height = getIntent().getIntExtra("h", 459);
            scale = getIntent().getFloatExtra("scale", 1f);
            SharedPreferences prefs = getSharedPreferences(MetroWidgetProvider.PREFS, MODE_PRIVATE);
            boolean hadPlus = prefs.contains("plus_active");
            boolean oldPlus = prefs.getBoolean("plus_active", false);
            if (getIntent().hasExtra("plus")) {
                prefs.edit().putBoolean("plus_active", getIntent().getBooleanExtra("plus", false)).commit();
            }
            try {
                views = MixedWidgetRender.boardAt(this, rail, metro, height);
            } finally {
                SharedPreferences.Editor restore = prefs.edit();
                if (hadPlus) restore.putBoolean("plus_active", oldPlus); else restore.remove("plus_active");
                restore.commit();
            }
            caption = String.format(java.util.Locale.US, "雙看板 · %d×%ddp · 縮放 %.3f · 字級 %.2f · 次列 %d",
                width, height, scale, getResources().getConfiguration().fontScale,
                MixedWidgetRender.slots(this, height));
        } else {
            String size = getIntent().getStringExtra("size");
            String bg = getIntent().getStringExtra("bg");
            if (bg == null) bg = WidgetBackground.PLAIN;
            boolean readable = getIntent().getBooleanExtra("readable", false);
            if (readable) bg = WidgetBackground.PLAIN;   // 與桌面同一條規則（WidgetBackground.effective）
            // --es state railfail／expired：註腳是警示時小卡要露出來（車模小卡同時收掉車）。
            if ("railfail".equals(state)) rail.failed = true;
            if ("expired".equals(state)) rail.scheduleNote = "依 09/16 同星期班表";
            // 與桌面同一條路：班數照卡片高度量（RailBoardWidgetProvider.at），--ei w／h 換格子大小。
            String tier = "2x2".equals(size) ? WidgetFamily.SMALL : "4x2".equals(size) ? WidgetFamily.MEDIUM : WidgetFamily.LARGE;
            if ("2x2".equals(size)) { width = 170; height = 170; }
            else if ("4x2".equals(size)) { width = 340; height = 160; }
            width = getIntent().getIntExtra("w", width);
            height = getIntent().getIntExtra("h", height);
            views = RailBoardWidgetProvider.at(this, tier, rail, readable, bg, width, height);
            caption = String.format(java.util.Locale.US, "發車看板 · %s · %s · %d×%ddp%s",
                size == null ? "4x4" : size, bg, width, height, readable ? " · 大字" : "");
        }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(Color.rgb(90, 96, 104));
        root.setPadding(dp(12), dp(20), dp(12), dp(20));
        TextView label = new TextView(this);
        label.setText(caption);
        label.setTextColor(Color.WHITE); label.setTextSize(14); label.setPadding(0, 0, 0, dp(8));
        root.addView(label);
        // 先照回報尺寸排版、再整張縮小（Samsung One UI 的做法）：外框是縮小後的大小，卡片本身仍是回報尺寸。
        FrameLayout frame = new FrameLayout(this);
        View card = views.apply(this, frame);
        card.setPivotX(0);
        card.setPivotY(0);
        card.setScaleX(scale);
        card.setScaleY(scale);
        frame.addView(card, new FrameLayout.LayoutParams(dp(width), dp(height)));
        root.addView(frame, new LinearLayout.LayoutParams(Math.round(dp(width) * scale), Math.round(dp(height) * scale)));
        setContentView(root);
    }

    /** 看板的第二、三列：同一站的另一個方向（真實情境就是這樣，一站兩三個終點）。 */
    private MetroWidgetPlate[] withSecondDirection(MetroWidgetPlate[] rows) {
        if (rows.length == 0) return rows;
        double now = System.currentTimeMillis() / 1000.0;
        MetroWidgetPlate second = MetroWidgetPlate.of(base(now, in -> {
            in.dest = "頂埔";
            in.etaEpochSec = now + 405;
            in.secondMinutes = 13;
            in.thirdMinutes = null;
        }));
        MetroWidgetPlate third = MetroWidgetPlate.of(base(now, in -> {
            in.dest = "亞東醫院";
            in.etaEpochSec = now + 730;
            in.secondMinutes = null;
            in.thirdMinutes = null;
        }));
        return new MetroWidgetPlate[] { rows[0], second, third };
    }

    /** 大張卡片「接下來」七列的示範值：拿樣本的兩個方向輪流排、分鐘數遞增（與 MetroWidgetProvider.large 同一個欄位順序）。 */
    private static List<String[]> follows(MetroWidgetPlate[] rows) {
        List<String[]> out = new ArrayList<>();
        for (int i = 1; i <= 7; i++) {
            MetroWidgetPlate p = rows[i % rows.length];
            out.add(new String[] { p.dest, p.lineLabel == null ? "" : p.lineLabel, String.valueOf(2 + i * 3), p.badgeColor });
        }
        return out;
    }

    private static String head(MetroWidgetPlate plate) {
        return (plate.badge == null || plate.badge.isEmpty() ? "" : plate.badge + " ") + plate.station;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static final class Case {
        final String name;
        final MetroWidgetPlate[] built;
        final RemoteViews message;
        Case(String name, MetroWidgetPlate... built) { this.name = name; this.built = built; this.message = null; }
        Case(String name, RemoteViews message) {
            this.name = name;
            this.built = new MetroWidgetPlate[0];
            this.message = message;
        }
        MetroWidgetPlate[] plates() { return built; }
    }

    /** 八種狀態，每一種都用真的 of(...) 算出來——這裡不准手工塞 plate 欄位。 */
    private List<Case> cases() {
        double now = System.currentTimeMillis() / 1000.0;
        List<Case> out = new ArrayList<>();
        out.add(new Case("1 正常候車", MetroWidgetPlate.of(base(now, in -> in.etaEpochSec = now + 260))));
        out.add(new Case("2 即將進站", MetroWidgetPlate.of(base(now, in -> in.etaEpochSec = now + 35))));
        out.add(new Case("3 資料延遲", MetroWidgetPlate.of(base(now, in -> {
            in.etaEpochSec = now + 260;
            in.dataAtEpochSec = now - 400;
        }))));
        out.add(new Case("4 末班車", MetroWidgetPlate.of(base(now, in -> {
            in.etaEpochSec = now + 480;
            in.lastTrainTime = "23:58";
        }))));
        out.add(new Case("5 服務中斷", MetroWidgetPlate.of(base(now, in -> {
            in.etaEpochSec = now + 260;
            in.alertTitle = "板南線因異物入侵，往南港展覽館方向延誤";
            in.alertFromOperator = true;
        }))));
        out.add(new Case("6 未設定車站", MetroWidgetPlateRender.unset(this)));
        out.add(new Case("6b 需要通行證", MetroWidgetPlateRender.passNeeded(this)));
        out.add(new Case("6c 連不上（無快取）", MetroWidgetPlateRender.offline(this, "台北車站")));
        out.add(new Case("6d 自動選站沒位置", MetroWidgetPlateRender.noLocation(this)));
        out.add(new Case("7 通行證限制", MetroWidgetPlate.of(base(now, in -> {
            in.etaEpochSec = now + 260;
            in.passLimited = true;
        }))));
        out.add(new Case("8 深夜無班次", MetroWidgetPlate.of(base(now, in -> {
            in.serviceClosed = true;
            in.firstTrainTime = "06:00";
        }))));
        out.add(new Case("本站觀測提醒（琥珀）", MetroWidgetPlate.of(base(now, in -> {
            in.etaEpochSec = now + 260;
            in.alertTitle = "本站觀測：官方資料更新較慢";
            in.alertFromOperator = false;
        }))));
        out.add(new Case("整數分鐘系統（高捷）", MetroWidgetPlate.of(base(now, in -> {
            in.etaEpochSec = null;
            in.minutes = 6;
            in.station = "美麗島";
            in.stationEn = "Formosa Boulevard";
            in.stationCode = null;          // 官方檔裡橘線這一站沒有站號 ⇒ 徽章要整顆消失
            in.lineLabel = "橘線";
            in.lineColor = "#F07C22";
            in.crowd = null;
        }))));
        out.add(new Case("環狀線徽章（深墨字）", MetroWidgetPlate.of(base(now, in -> {
            in.etaEpochSec = now + 260;
            in.station = "板橋";
            in.stationEn = "Banqiao";
            in.stationCode = "Y16";
            in.lineLabel = "環狀線";
            in.lineColor = "#FFDB00";
        }))));
        return out;
    }

    private interface Tweak { void apply(MetroWidgetPlate.Input in); }

    /** 板南線台北車站的一組真值，各情境只改自己要驗的那幾格。 */
    private static MetroWidgetPlate.Input base(double now, Tweak tweak) {
        MetroWidgetPlate.Input in = new MetroWidgetPlate.Input();
        in.station = "台北車站";
        in.stationEn = "Taipei Main Station";
        in.stationCode = "BL12";
        in.lineLabel = "板南線";
        in.lineColor = "#0070BD";
        in.dest = "南港展覽館";
        in.secondMinutes = 9;
        in.secondApprox = true;
        in.thirdMinutes = 15;
        in.crowd = new int[] { 1, 1, 2, 2, 3, 2 };
        in.dataAtEpochSec = now;
        in.prevStation = "西門";
        in.nextStation = "善導寺";
        in.nowEpochSec = now;
        tweak.apply(in);
        return in;
    }
}
