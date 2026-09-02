package tw.railisland.app;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import java.util.ArrayList;
import java.util.List;

public final class MetroWidgetConfigActivity extends AppCompatActivity {
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private MetroWidgetData.Catalog catalog;
    private Spinner systemSpinner;
    private Spinner stationSpinner;
    private Spinner directionSpinner;
    private Spinner layoutSpinner;
    private Spinner freqSpinner;
    private FrameLayout preview;
    private TextView passNote;
    private final List<MetroWidgetData.StationInfo> visibleStations = new ArrayList<>();
    /** 方向 spinner 每一列對應的終點值(第 0 列是「全部方向」＝空字串)。選擇一律查這張表,
     *  不再拿 spinner 的索引去對「當下車站」的 destinations——車站剛換時那兩者不是同一份。 */
    private final List<String> directionValues = new ArrayList<>();

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setResult(RESULT_CANCELED);
        widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return; }
        try { catalog = MetroWidgetData.catalog(this); }
        catch (Exception error) { finish(); return; }
        buildUi();
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(28), dp(24), dp(24));
        root.setBackgroundColor(getColor(R.color.wg_paper));

        TextView title = text("捷運看板小工具", 24, getColor(R.color.wg_ink));
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        root.addView(title, matchWrap(0));
        TextView hint = text("選一個車站，桌面就會顯示官方的下一班還有幾分鐘。", 14, getColor(R.color.wg_ink_soft));
        LinearLayout.LayoutParams hintLp = matchWrap(dp(8));
        hintLp.bottomMargin = dp(18);
        root.addView(hint, hintLp);

        // 預覽卡：直接把真的 RemoteViews 貼進來，不畫一張假的示意圖——
        // 設定頁看到的就是桌面上會長出來的那張版面（版型與路線色都是即時的）。
        preview = new FrameLayout(this);
        LinearLayout.LayoutParams previewLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        previewLp.bottomMargin = dp(20);
        root.addView(preview, previewLp);

        root.addView(label("系統"), matchWrap(0));
        systemSpinner = new Spinner(this);
        List<String> systemLabels = new ArrayList<>();
        for (MetroWidgetData.SystemInfo system : catalog.systems) systemLabels.add(system.label);
        systemSpinner.setAdapter(adapter(systemLabels));
        root.addView(systemSpinner, matchWrap(dp(4)));

        root.addView(label("車站"), matchWrap(dp(16)));
        stationSpinner = new Spinner(this);
        root.addView(stationSpinner, matchWrap(dp(4)));

        root.addView(label("方向（可留空）"), matchWrap(dp(16)));
        directionSpinner = new Spinner(this);
        root.addView(directionSpinner, matchWrap(dp(4)));

        root.addView(label("版型"), matchWrap(dp(16)));
        layoutSpinner = new Spinner(this);
        layoutSpinner.setAdapter(adapter(java.util.Arrays.asList("琺瑯站牌（一站一班）", "夜行看板（多方向並排）")));
        root.addView(layoutSpinner, matchWrap(dp(4)));

        root.addView(label("更新頻率"), matchWrap(dp(16)));
        freqSpinner = new Spinner(this);
        freqSpinner.setAdapter(adapter(java.util.Arrays.asList(
            "省電（5 分鐘，進站前 2 分鐘）", "標準（1 分鐘，進站前 30 秒）", "積極（30 秒）")));
        root.addView(freqSpinner, matchWrap(dp(4)));

        passNote = text("", 13, getColor(R.color.wg_warn));
        LinearLayout.LayoutParams noteLp = matchWrap(dp(16));
        root.addView(passNote, noteLp);

        Button done = new Button(this);
        done.setText(RailNativeL10n.text(this, "加到桌面"));
        done.setTextSize(16);
        done.setTextColor(getColor(R.color.wg_on_accent));
        done.setAllCaps(false);
        done.setBackgroundColor(getColor(R.color.wg_navy));
        LinearLayout.LayoutParams buttonLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(52));
        buttonLp.topMargin = dp(24);
        root.addView(done, buttonLp);

        systemSpinner.setOnItemSelectedListener(new SimpleSelection() {
            @Override public void selected(int position) { updateStations(position); }
        });
        stationSpinner.setOnItemSelectedListener(new SimpleSelection() {
            @Override public void selected(int position) { updateDirections(position); refreshPreview(); }
        });
        directionSpinner.setOnItemSelectedListener(new SimpleSelection() {
            @Override public void selected(int position) { refreshPreview(); }
        });
        layoutSpinner.setOnItemSelectedListener(new SimpleSelection() {
            @Override public void selected(int position) { refreshPreview(); }
        });
        done.setOnClickListener(v -> save());

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(scroll);
        restore();
    }

    /** 重設既有小工具時，把它現在的選擇讀回來——不要每次都跳回台北車站。 */
    private void restore() {
        SharedPreferences prefs = getSharedPreferences(MetroWidgetProvider.PREFS, Context.MODE_PRIVATE);
        String sys = prefs.getString("sys_" + widgetId, "trtc");
        int sysIndex = 0;
        for (int i = 0; i < catalog.systems.size(); i++) if (catalog.systems.get(i).id.equals(sys)) sysIndex = i;
        systemSpinner.setSelection(sysIndex);
        updateStations(sysIndex);
        String station = prefs.getString("station_" + widgetId, null);
        int stationAt = 0;
        if (station != null) {
            if (MetroWidgetData.AUTO.equals(station)) stationSpinner.setSelection(0);
            else for (int i = 0; i < visibleStations.size(); i++) {
                if (visibleStations.get(i).name.equals(station)) { stationAt = i + 1; stationSpinner.setSelection(i + 1); }
            }
        }
        // 方向:先同步重建清單再選回存過的值。使用者 2026-09-02 回報「選了方向就取消不了」——
        // 舊版 restore() 根本沒讀回方向,重開設定頁永遠顯示「全部方向」,存檔卻還是舊方向。
        // 🔴 車站 spinner 的 listener 會在下一個 layout 再呼叫一次 updateDirections(),
        //    那一次靠「重建時保留已選」把這裡選好的值留住(見 updateDirections)。
        updateDirections(stationAt);
        int directionAt = directionValues.indexOf(prefs.getString("direction_" + widgetId, ""));
        directionSpinner.setSelection(Math.max(0, directionAt));
        layoutSpinner.setSelection(MetroWidgetProvider.LAYOUT_BOARD
            .equals(prefs.getString("layout_" + widgetId, MetroWidgetProvider.LAYOUT_PLATE)) ? 1 : 0);
        String freq = prefs.getString("freq_" + widgetId, "std");
        freqSpinner.setSelection("eco".equals(freq) ? 0 : "max".equals(freq) ? 2 : 1);
        boolean plus = prefs.getBoolean("plus_active", false);
        String free = prefs.getString("free_station", null);
        passNote.setText(RailNativeL10n.text(this, plus
            ? "通行證已啟用：可以放多站，也可以用自動選站。"
            : (free == null ? "免費版可以固定一站；多站與自動選站需要軌島通行證。"
                            : "免費版的那一站已經在用了。要再加一站請開通軌島通行證。")
              + "（點這裡看通行證）"));
        passNote.setOnClickListener(plus ? null : v -> openPass());
        refreshPreview();
    }

    private void updateStations(int systemIndex) {
        visibleStations.clear();
        List<String> labels = new ArrayList<>();
        labels.add("自動（最近的站・通行證）");
        if (systemIndex >= 0 && systemIndex < catalog.systems.size()) {
            visibleStations.addAll(catalog.systems.get(systemIndex).stations);
            for (MetroWidgetData.StationInfo station : visibleStations) labels.add(station.name);
        }
        stationSpinner.setAdapter(adapter(labels));
        int taipei = labels.indexOf("台北車站");
        if (taipei >= 0) stationSpinner.setSelection(taipei);
    }

    private void updateDirections(int position) {
        // 重建前記住現在選的終點;新清單裡還有它就選回去(換到同一條線的另一站,方向不該被打掉;
        // 換到別條線它自然不在清單裡,回到「全部方向」)。restore() 選好的值也是靠這條留住的。
        String keep = selectedDirection();
        List<String> directions = new ArrayList<>();
        directionValues.clear();
        directions.add("全部方向");
        directionValues.add("");
        if (position > 0 && position - 1 < visibleStations.size()) {
            for (String dest : visibleStations.get(position - 1).destinations) {
                directions.add("往 " + dest);
                directionValues.add(dest);
            }
        }
        directionSpinner.setAdapter(adapter(directions));
        int at = keep.isEmpty() ? -1 : directionValues.indexOf(keep);
        if (at > 0) directionSpinner.setSelection(at);
    }

    /** 預覽用的示範值：站名／站號／英文名／路線色都是真的，只有「還有幾分鐘」是示範用的 4 分。 */
    private void refreshPreview() {
        if (preview == null) return;
        preview.removeAllViews();
        int sysIndex = systemSpinner.getSelectedItemPosition();
        int stationIndex = stationSpinner.getSelectedItemPosition();
        MetroWidgetData.SystemInfo system = sysIndex >= 0 && sysIndex < catalog.systems.size()
            ? catalog.systems.get(sysIndex) : null;
        MetroWidgetData.StationInfo info = stationIndex > 0 && stationIndex - 1 < visibleStations.size()
            ? visibleStations.get(stationIndex - 1) : null;
        String dest = selectedDirection();

        MetroWidgetPlate.Input in = new MetroWidgetPlate.Input();
        in.texts = RailNativeL10n.plateTexts(this);
        in.nowEpochSec = System.currentTimeMillis() / 1000.0;
        in.station = info == null ? "自動選站" : info.name;
        in.stationEn = info == null || "en".equals(RailNativeL10n.language(this)) ? null : info.en;
        in.dest = dest;
        in.etaEpochSec = in.nowEpochSec + 4 * 60 + 20;
        in.secondMinutes = 9;
        in.thirdMinutes = 15;
        in.dataAtEpochSec = in.nowEpochSec;
        if (info != null && system != null && !info.lineIds.isEmpty()) {
            String lineId = info.lineIds.get(0);
            in.stationCode = info.codeForLine(lineId);
            in.lineLabel = system.lineLabels.get(lineId);
            in.lineColor = system.lineColors.get(lineId);
            String[] neighbors = system.neighbors(info.name, lineId);
            in.prevStation = neighbors[0];
            in.nextStation = neighbors[1];
            // 沒指定方向時，示範用「這條線的遠端終點」——不要取跨線合併的 destinations[0]，
            // 那會讓淡水信義線的徽章配上板南線的終點站。
            if (in.dest.isEmpty()) {
                java.util.List<String> order = system.lineOrder.get(lineId);
                if (order != null && order.size() > 1) {
                    int at = order.indexOf(info.name);
                    in.dest = at < order.size() / 2 ? order.get(order.size() - 1) : order.get(0);
                }
            }
        }
        MetroWidgetPlate plate = MetroWidgetPlate.of(in);
        // 🔴 預覽卡不准長得像即時資料：站名／站號／英文名／路線色都是官方真值，但「還有幾分鐘」
        //    是示範用的。掛著綠色 LIVE 會讓人以為這一站真的有車 4 分鐘後到 ⇒ chip 換成灰色「預覽」、
        //    時戳清掉。這是設定頁的顯示層決定，不進共用的 MetroWidgetPlate（桌面上那張仍是 LIVE）。
        plate.chip = MetroWidgetPlate.Chip.PLAIN;
        plate.chipText = RailNativeL10n.text(this, "預覽");
        plate.stamp = "";
        boolean board = layoutSpinner.getSelectedItemPosition() == 1;
        android.widget.RemoteViews views = board
            ? MetroWidgetPlateRender.board(this, R.layout.widget_board_4x2,
                new MetroWidgetPlate[] { plate, plate }, 2,
                (plate.badge == null ? "" : plate.badge + " ") + plate.station,
                RailNativeL10n.text(this, "單位分鐘"), plate.footRight, null, false)
            : MetroWidgetPlateRender.plate(this, R.layout.widget_plate_4x2, plate);
        preview.addView(views.apply(this, preview));
    }

    private String selectedDirection() {
        int index = directionSpinner == null ? 0 : directionSpinner.getSelectedItemPosition();
        return index > 0 && index < directionValues.size() ? directionValues.get(index) : "";
    }

    private void save() {
        int sysIndex = systemSpinner.getSelectedItemPosition();
        int stationIndex = stationSpinner.getSelectedItemPosition();
        if (sysIndex < 0 || sysIndex >= catalog.systems.size() || stationIndex < 0) return;
        MetroWidgetData.SystemInfo system = catalog.systems.get(sysIndex);
        String station = stationIndex == 0 ? MetroWidgetData.AUTO : visibleStations.get(stationIndex - 1).name;
        String direction = selectedDirection();
        SharedPreferences prefs = getSharedPreferences(MetroWidgetProvider.PREFS, Context.MODE_PRIVATE);
        String previousSys = prefs.getString("sys_" + widgetId, null);
        String previousStation = prefs.getString("station_" + widgetId, null);
        String previousKey = previousSys == null || previousStation == null || MetroWidgetData.AUTO.equals(previousStation)
            ? null : previousSys + "|" + previousStation;
        String selectedKey = MetroWidgetData.AUTO.equals(station) ? null : system.id + "|" + station;
        SharedPreferences.Editor editor = prefs.edit()
            .putString("sys_" + widgetId, system.id)
            .putString("station_" + widgetId, station)
            .putString("direction_" + widgetId, direction)
            .putString("layout_" + widgetId, layoutSpinner.getSelectedItemPosition() == 1
                ? MetroWidgetProvider.LAYOUT_BOARD : MetroWidgetProvider.LAYOUT_PLATE)
            .putString("freq_" + widgetId, freqSpinner.getSelectedItemPosition() == 0 ? "eco"
                : freqSpinner.getSelectedItemPosition() == 2 ? "max" : "std");
        // 使用者重設的正是免費站時，名額跟著同一顆小工具搬到新站，不殘留在舊站。
        if (previousKey != null && previousKey.equals(prefs.getString("free_station", null))) {
            if (selectedKey == null) editor.remove("free_station");
            else editor.putString("free_station", selectedKey);
        }
        editor.commit();
        MetroWidgetProvider.reconcileFreeStation(this);
        AppWidgetManager manager = AppWidgetManager.getInstance(this);
        MetroWidgetProvider.updateOneAsync(this, manager, widgetId);
        Intent result = new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        setResult(RESULT_OK, result);
        finish();
    }

    /** 免費版想再加一站時，設定頁直接把通行證入口給出來（不要只寫「需要通行證」就沒有下一步）。 */
    void openPass() {
        Uri uri = new Uri.Builder().scheme("railisland").authority("pass").build();
        startActivity(new Intent(Intent.ACTION_VIEW, uri, this, MainActivity.class));
    }

    private ArrayAdapter<String> adapter(List<String> values) {
        List<String> localized = new ArrayList<>();
        for (String value : values) localized.add(RailNativeL10n.option(this, value));
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, localized);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        return adapter;
    }

    private TextView label(String value) {
        TextView label = text(value, 13, getColor(R.color.wg_ink_soft));
        label.setTypeface(label.getTypeface(), android.graphics.Typeface.BOLD);
        return label;
    }

    private TextView text(String value, int sp, int color) {
        TextView view = new TextView(this);
        view.setText(RailNativeL10n.text(this, value));
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setLineSpacing(0, 1.15f);
        return view;
    }

    private LinearLayout.LayoutParams matchWrap(int top) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = top;
        return lp;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private abstract static class SimpleSelection implements AdapterView.OnItemSelectedListener {
        abstract void selected(int position);
        @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) { selected(position); }
        @Override public void onNothingSelected(AdapterView<?> parent) {}
    }
}
