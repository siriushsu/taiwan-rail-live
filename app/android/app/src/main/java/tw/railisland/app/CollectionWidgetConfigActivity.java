package tw.railisland.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
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
 * 讓使用者一加上小工具就能先選好。退回清單與「全台」用網頁的簡稱（見 scopeName），開 App 前後看到的名稱一樣。
 * 可重新設定（widgetFeatures=reconfigurable）：開頁時把這一格現在的選擇讀回來。
 * 預覽卡直接把真的 RemoteViews 貼進來，設定頁看到的就是桌面上會長出來的那張版面。
 */
public final class CollectionWidgetConfigActivity extends AppCompatActivity {
    /** collection.json v1 的系統代碼與繁中簡稱，順序固定（契約固定值，與 iOS CollectionScopeName.systems 同一份）。 */
    static final String[][] FALLBACK_SYSTEMS = {
        { "tra", "台鐵" }, { "thsr", "高鐵" }, { "trtc", "北捷" }, { "tymc", "機捷" }, { "tmrt", "中捷" },
        { "krtc", "高捷" }, { "ntdlrt", "淡海" }, { "ntalrt", "安坑" }, { "sanying", "三鶯" }, { "afr", "林鐵" },
    };
    static final String ALL_TAIWAN = "全台";
    /**
     * 範圍選單名稱在原生目錄裡的 key 前綴。網站字典已有「台鐵／高鐵／北捷」，譯的是全名（High Speed Rail、台湾鉄路…），
     * 其他小工具在用，不能被簡稱覆寫，所以簡稱另開一組 key。
     */
    static final String SCOPE_KEY_PREFIX = "範圍・";

    /**
     * 繁中簡稱在 App 語言（RailNativeL10n.language：存的優先、沒存看系統語言）的寫法，三語與網頁 COLLECT_SYS 同一組。
     * 繁中、或目錄查不到，一律回繁中簡稱本身，不露出帶前綴的 key。
     */
    static String scopeName(Context context, String zh) {
        String key = SCOPE_KEY_PREFIX + zh;
        String value = RailNativeL10n.text(context, key);
        return value.equals(key) ? zh : value;
    }

    /** 選單項目 {存值, 名稱}：全台在最前面；有 payload 的系統名稱照抄，沒有才用退回清單。 */
    static List<String[]> scopeMenu(Context context, CollectionData data) {
        List<String[]> items = new ArrayList<>();
        items.add(new String[] { CollectionData.ALL, scopeName(context, ALL_TAIWAN) });
        if (data != null && !data.sys.isEmpty()) {
            for (CollectionData.Sys s : data.sys) items.add(new String[] { s.k, s.label });
        } else {
            for (String[] s : FALLBACK_SYSTEMS) items.add(new String[] { s[0], scopeName(context, s[1]) });
        }
        return items;
    }

    /**
     * 這次開設定頁是「重新設定已經在桌面上的小工具」，還是「剛拖上桌面、launcher 等設定完才放上去」。
     * Android 沒有旗標分辨這兩種（launcher 都是帶同一個 appWidgetId 開這一頁），只能推：
     *  - 這一格存過範圍＝設定過，一定是重新設定；
     *  - API 31 起 provider 同時宣告 reconfigurable＋configuration_optional（兩款都有）：照這兩個旗標走的 launcher
     *    （Launcher3 系）放上桌面時不開設定頁，沒存過範圍卻開了這一頁＝使用者事後按「設定」；
     *  - API 31 以前沒有 configuration_optional，放上桌面時一定先開這一頁，沒存過範圍就是新加。
     * 不理 configuration_optional、放上時仍開設定頁的 launcher，新加時也會看到「完成」——字義仍對，只是少了「加到桌面」的提示。
     */
    static boolean isReconfigure(boolean scopeSaved, int sdk, int widgetFeatures) {
        if (scopeSaved) return true;
        int optional = AppWidgetProviderInfo.WIDGET_FEATURE_RECONFIGURABLE | AppWidgetProviderInfo.WIDGET_FEATURE_CONFIGURATION_OPTIONAL;
        return sdk >= Build.VERSION_CODES.S && (widgetFeatures & optional) == optional;
    }

    /** 底部按鈕的字：新加寫「加到桌面」；重新設定寫「完成」（小工具已經在桌面上，按了只是換範圍）。 */
    static String doneLabel(Context context, boolean reconfigure) {
        return RailNativeL10n.text(context, reconfigure ? "完成" : "加到桌面");
    }

    /** 這一格綁的 provider 宣告的 widgetFeatures；API 31 以前（沒有 configuration_optional）或查不到都當 0。 */
    private static int widgetFeatures(Context context, int id) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return 0;
        AppWidgetProviderInfo info = AppWidgetManager.getInstance(context).getAppWidgetInfo(id);
        return info == null ? 0 : info.widgetFeatures;
    }

    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private final List<String> keys = new ArrayList<>();
    private final List<String> labels = new ArrayList<>();
    private Spinner scopeSpinner;
    private FrameLayout preview;
    private String family = WidgetFamily.MEDIUM;
    private boolean reconfigure;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setResult(RESULT_CANCELED);
        widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return; }
        family = WidgetFamily.of(this, widgetId);
        boolean scopeSaved = getSharedPreferences(CollectionWidgetProvider.PREFS, Context.MODE_PRIVATE)
            .contains(CollectionWidgetProvider.scopeKey(widgetId));
        reconfigure = isReconfigure(scopeSaved, Build.VERSION.SDK_INT, widgetFeatures(this, widgetId));
        loadScopes();
        buildUi();
    }

    private void loadScopes() {
        keys.clear();
        labels.clear();
        for (String[] item : scopeMenu(this, CollectionData.load(this))) { keys.add(item[0]); labels.add(item[1]); }
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
        done.setText(doneLabel(this, reconfigure));
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
