package tw.railisland.app;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import java.util.ArrayList;
import java.util.List;

/**
 * 車站收集小工具的設定頁：只有一個選項「範圍」＝全台＋十個系統（存值與 iOS CollectionIntent 相同：`all` 或 sys[].k）。
 * 選單名稱優先用 collection.json 裡的 sys[].label（網頁當下語言）；還沒有檔案（App 沒開過）時退回固定的十個系統，
 * 讓使用者一加上小工具就能先選好。可重新設定（widgetFeatures=reconfigurable）：開頁時把這一格現在的選擇讀回來。
 * 預覽卡直接把真的 RemoteViews 貼進來，設定頁看到的就是桌面上會長出來的那張版面。
 */
public final class CollectionWidgetConfigActivity extends AppCompatActivity {
    /** collection.json v1 的系統順序與代碼（契約固定值，與 iOS CollectionScopeOptionsProvider.fallbackSystems 同一份）。 */
    static final String[][] FALLBACK_SYSTEMS = {
        { "tra", "台鐵" }, { "thsr", "高鐵" }, { "trtc", "北捷" }, { "tymc", "機捷" }, { "tmrt", "中捷" },
        { "krtc", "高捷" }, { "ntdlrt", "淡海" }, { "ntalrt", "安坑" }, { "sanying", "三鶯" }, { "afr", "林鐵" },
    };

    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private final List<String> keys = new ArrayList<>();
    private final List<String> labels = new ArrayList<>();
    private Spinner scopeSpinner;
    private FrameLayout preview;
    private String family = WidgetFamily.MEDIUM;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setResult(RESULT_CANCELED);
        widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return; }
        family = WidgetFamily.of(this, widgetId);
        loadScopes();
        buildUi();
    }

    private void loadScopes() {
        keys.clear();
        labels.clear();
        keys.add(CollectionData.ALL);
        labels.add(RailNativeL10n.text(this, "全台"));
        CollectionData data = CollectionData.load(this);
        if (data != null && !data.sys.isEmpty()) {
            for (CollectionData.Sys s : data.sys) { keys.add(s.k); labels.add(s.label); }
        } else {
            for (String[] s : FALLBACK_SYSTEMS) { keys.add(s[0]); labels.add(RailNativeL10n.name(this, s[1])); }
        }
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(28), dp(24), dp(24));
        root.setBackgroundColor(getColor(R.color.wg_paper));

        TextView title = text("車站收集小工具", 24, getColor(R.color.wg_ink));
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        root.addView(title, matchWrap(0));
        TextView hint = text("看你收集了幾成鐵道車站；範圍可選全台或單一系統。", 14, getColor(R.color.wg_ink_soft));
        LinearLayout.LayoutParams hintLp = matchWrap(dp(8));
        hintLp.bottomMargin = dp(18);
        root.addView(hint, hintLp);

        preview = new FrameLayout(this);
        boolean small = WidgetFamily.SMALL.equals(family);
        LinearLayout.LayoutParams previewLp = new LinearLayout.LayoutParams(
            small ? dp(150) : LinearLayout.LayoutParams.MATCH_PARENT, dp(small ? 150 : 170));
        previewLp.bottomMargin = dp(20);
        root.addView(preview, previewLp);

        TextView label = text("範圍", 13, getColor(R.color.wg_ink_soft));
        label.setTypeface(label.getTypeface(), android.graphics.Typeface.BOLD);
        root.addView(label, matchWrap(0));
        scopeSpinner = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, labels);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        scopeSpinner.setAdapter(adapter);
        root.addView(scopeSpinner, matchWrap(dp(4)));

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

        scopeSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) { refreshPreview(); }
            @Override public void onNothingSelected(AdapterView<?> parent) {}
        });
        done.setOnClickListener(v -> save());

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        // 內容延伸到系統列後面（target 35 起強制 edge-to-edge）：標題不能被狀態列蓋住，底色要鋪滿到導覽列後面。
        scroll.setBackgroundColor(getColor(R.color.wg_paper));
        scroll.setClipToPadding(false);
        ViewCompat.setOnApplyWindowInsetsListener(scroll, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        setContentView(scroll);
        // 底色是米白（淺色）／深藍（深色）：狀態列與導覽列的圖示要反過來，不然淺色底上時鐘是白色的、看不見。
        boolean night = (getResources().getConfiguration().uiMode
            & android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES;
        WindowCompat.getInsetsController(getWindow(), scroll).setAppearanceLightStatusBars(!night);
        WindowCompat.getInsetsController(getWindow(), scroll).setAppearanceLightNavigationBars(!night);
        restore();
    }

    /** 重設既有小工具時，把它現在的選擇讀回來——不要每次都跳回全台。讀到不認得的值（系統被拿掉）當全台。 */
    private void restore() {
        SharedPreferences prefs = getSharedPreferences(CollectionWidgetProvider.PREFS, Context.MODE_PRIVATE);
        int at = keys.indexOf(prefs.getString(CollectionWidgetProvider.scopeKey(widgetId), CollectionData.ALL));
        scopeSpinner.setSelection(Math.max(0, at));
        refreshPreview();
    }

    private String selectedScope() {
        int at = scopeSpinner == null ? 0 : scopeSpinner.getSelectedItemPosition();
        return at >= 0 && at < keys.size() ? keys.get(at) : CollectionData.ALL;
    }

    private void refreshPreview() {
        if (preview == null) return;
        preview.removeAllViews();
        boolean small = WidgetFamily.SMALL.equals(family);
        // 🔴 application context：AppCompat 的 inflater 會把 ImageView 換成不吃 setImageViewBitmap 的
        //    AppCompatImageView，設定頁當場閃退（見 MetroWidgetConfigActivity 的同一段註解）。
        android.widget.RemoteViews views = CollectionWidgetProvider.views(getApplicationContext(), widgetId, family,
            selectedScope(), small ? 150 : 340, small ? 150 : 170);
        preview.addView(views.apply(getApplicationContext(), preview));
    }

    private void save() {
        SharedPreferences prefs = getSharedPreferences(CollectionWidgetProvider.PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(CollectionWidgetProvider.scopeKey(widgetId), selectedScope()).commit();
        CollectionWidgetProvider.updateOneAsync(this, AppWidgetManager.getInstance(this), widgetId);
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
        finish();
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
}
