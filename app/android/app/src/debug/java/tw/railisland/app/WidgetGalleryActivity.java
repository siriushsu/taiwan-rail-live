package tw.railisland.app;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
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
 */
public final class WidgetGalleryActivity extends Activity {

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        String size = getIntent().getStringExtra("size");
        String kind = getIntent().getStringExtra("kind");
        if (size == null) size = "4x2";
        boolean board = "board".equals(kind);
        int layoutRes = board
            ? ("4x3".equals(size) ? R.layout.widget_board_4x3
                : "2x2".equals(size) ? R.layout.widget_board_2x2 : R.layout.widget_board_4x2)
            : ("4x3".equals(size) ? R.layout.widget_plate_4x3
                : "2x2".equals(size) ? R.layout.widget_plate_2x2 : R.layout.widget_plate_4x2);
        int widthDp = "2x2".equals(size) ? 155 : 320;
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
                : board
                ? MetroWidgetPlateRender.board(this, layoutRes, rows, "4x3".equals(size) ? 3 : 2,
                    head(rows[0]), "單位分鐘", rows[0].footRight, rows[0].band, rows[0].bandBad)
                : MetroWidgetPlateRender.plate(this, layoutRes, sample.plates()[0], "2x2".equals(sizeKey));
            LinearLayout holder = new LinearLayout(this);
            holder.setGravity(Gravity.START);
            holder.addView(views.apply(this, holder),
                new LinearLayout.LayoutParams(dp(widthDp), ViewGroup.LayoutParams.WRAP_CONTENT));
            column.addView(holder);
        }

        ScrollView scroll = new ScrollView(this);
        scroll.addView(column);
        setContentView(scroll);
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
