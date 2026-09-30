package tw.railisland.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.appwidget.AppWidgetHost;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.ParcelFileDescriptor;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.SpinnerAdapter;

import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * 車站收集小工具設定頁（CollectionWidgetConfigActivity）的測試。
 *
 * 期望值全是手寫的（範圍名稱＝網頁 COLLECT_SYS 的簡稱三語），不從 Java 常數或字串目錄產生——同源時「相等」是零資訊。
 * 要開設定頁的案例會真的綁一個收集小工具：先用 `appwidget grantbind` 讓測試 App 能綁，收尾時刪掉 id 並撤銷（revokebind）。
 * App 語言與 files/collection.json 開測前存一份、收尾還原，不影響同一輪其他測試類別。
 */
@RunWith(AndroidJUnit4.class)
public final class CollectionWidgetConfigInstrumentedTest {
    /** 選單順序：全台、再十個系統。繁中簡稱（也是查表的輸入）。 */
    private static final String[] ZH = { "全台", "台鐵", "高鐵", "北捷", "機捷", "中捷", "高捷", "淡海", "安坑", "三鶯", "林鐵" };
    private static final String[] EN = { "All Taiwan", "TRA", "THSR", "Taipei", "Airport", "Taichung", "Kaohsiung",
        "Danhai", "Ankeng", "Sanying", "Alishan" };
    private static final String[] JA = { "台湾全体", "台鉄", "高鉄", "台北", "空港", "台中", "高雄", "淡海", "安坑", "三鶯", "阿里山" };
    private static final String[] KEYS = { "all", "tra", "thsr", "trtc", "tymc", "tmrt", "krtc", "ntdlrt", "ntalrt", "sanying", "afr" };
    private static final String[] LANGS = { "zh-TW", "en", "ja" };
    private static final String[][] NAMES = { ZH, EN, JA };

    /** 合格的 collection.json；兩個系統的 label 故意跟退回清單的任何語言都不同，才分得出「照抄 payload」。 */
    private static final String PAYLOAD = "{\"v\":1,\"aspect\":0.5516,\"n\":3,\"total\":5,"
        + "\"sys\":[{\"k\":\"trtc\",\"label\":\"北捷（payload）\",\"v\":2,\"n\":3},{\"k\":\"ntdlrt\",\"label\":\"Danhai payload\",\"v\":1,\"n\":2}],"
        + "\"recent\":[],\"pts\":[[100,200,\"#E4572E\",2,0],[300,400,\"#2E6FB0\",1,1]]}";

    /** RailNativeL10n 存語言的位置（它的 PREFS／KEY_LANGUAGE 是 private，這裡照抄；只用來存回開測前的值）。 */
    private static final String L10N_PREFS = "rail_native_l10n";
    private static final String L10N_KEY = "rail.language";
    private static final int HOST_ID = 0x0C011EC7;

    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    private String savedLanguage;
    private byte[] savedCollection;
    private AppWidgetHost host;
    private final List<Integer> hostIds = new ArrayList<>();
    private boolean granted;

    @Before
    public void snapshot() throws Exception {
        savedLanguage = context.getSharedPreferences(L10N_PREFS, Context.MODE_PRIVATE).getString(L10N_KEY, null);
        File file = CollectionData.file(context);
        savedCollection = file.exists() ? readBytes(file) : null;
    }

    @After
    public void restore() throws Exception {
        if (host != null) for (int id : hostIds) host.deleteAppWidgetId(id);
        if (granted) shell("appwidget revokebind --package " + context.getPackageName() + " --user " + userId());
        SharedPreferences.Editor editor = context.getSharedPreferences(L10N_PREFS, Context.MODE_PRIVATE).edit();
        if (savedLanguage == null) editor.remove(L10N_KEY); else editor.putString(L10N_KEY, savedLanguage);
        editor.commit();
        File file = CollectionData.file(context);
        if (savedCollection == null) file.delete(); else writeBytes(file, savedCollection);
    }

    // ── P3-11：範圍選單名稱 ──────────────────────────────────────────────────────

    @Test
    public void scopeNamesAreWebShortNamesInAllThreeLanguages() {
        for (int l = 0; l < LANGS.length; l++) {
            assertTrue(RailNativeL10n.setLanguage(context, LANGS[l]));
            for (int i = 0; i < ZH.length; i++) {
                assertEquals(LANGS[l] + " " + ZH[i], NAMES[l][i], CollectionWidgetConfigActivity.scopeName(context, ZH[i]));
            }
        }
    }

    @Test
    public void unknownNameFallsBackToTraditionalChineseWithoutPrefix() {
        for (String lang : LANGS) {
            assertTrue(RailNativeL10n.setLanguage(context, lang));
            // 對照組：直接查目錄，查不到就原樣吐回帶前綴的 key——scopeName 必須把它擋下來
            assertEquals(lang, "範圍・測試用不存在的系統", RailNativeL10n.text(context, "範圍・測試用不存在的系統"));
            assertEquals(lang, "測試用不存在的系統", CollectionWidgetConfigActivity.scopeName(context, "測試用不存在的系統"));
            for (String zh : ZH) {
                assertFalse(lang + " " + zh + " 露出了前綴", CollectionWidgetConfigActivity.scopeName(context, zh).contains("範圍"));
            }
        }
    }

    @Test
    public void menuWithoutPayloadIsAllTaiwanThenTenSystemsInContractOrder() {
        for (int l = 0; l < LANGS.length; l++) {
            assertTrue(RailNativeL10n.setLanguage(context, LANGS[l]));
            List<String[]> menu = CollectionWidgetConfigActivity.scopeMenu(context, null);
            assertEquals(LANGS[l], Arrays.asList(KEYS), column(menu, 0));
            assertEquals(LANGS[l], Arrays.asList(NAMES[l]), column(menu, 1));
        }
    }

    @Test
    public void menuWithPayloadCopiesPayloadLabelsVerbatim() {
        CollectionData data = CollectionData.decode(PAYLOAD);
        assertNotNull("測試前提：payload 解得開", data);
        for (int l = 0; l < LANGS.length; l++) {
            assertTrue(RailNativeL10n.setLanguage(context, LANGS[l]));
            List<String[]> menu = CollectionWidgetConfigActivity.scopeMenu(context, data);
            assertEquals(LANGS[l], Arrays.asList("all", "trtc", "ntdlrt"), column(menu, 0));
            assertEquals(LANGS[l], Arrays.asList(NAMES[l][0], "北捷（payload）", "Danhai payload"), column(menu, 1));
        }
    }

    /** 真的開設定頁：還沒有 collection.json 時選單是簡稱（跟著 App 語言），有了之後照抄 payload。 */
    @Test
    public void settingsScreenMenuFollowsAppLanguageBeforePayloadAndCopiesPayloadAfter() throws Exception {
        int id = bindCollectionWidget(CollectionWidgetProvider.class);
        CollectionData.file(context).delete();
        assertTrue(RailNativeL10n.setLanguage(context, "en"));
        assertEquals(Arrays.asList(EN), spinnerLabels(id));
        assertTrue(RailNativeL10n.setLanguage(context, "ja"));
        assertEquals(Arrays.asList(JA), spinnerLabels(id));
        assertTrue(CollectionStore.write(context, PAYLOAD));
        assertEquals(Arrays.asList("台湾全体", "北捷（payload）", "Danhai payload"), spinnerLabels(id));
    }

    // ── 工具 ────────────────────────────────────────────────────────────────────

    private static List<String> column(List<String[]> rows, int index) {
        List<String> out = new ArrayList<>();
        for (String[] row : rows) out.add(row[index]);
        return out;
    }

    /** 綁一個收集小工具（小或中），回傳 appWidgetId；收尾時刪掉。 */
    private int bindCollectionWidget(Class<?> provider) throws Exception {
        if (!granted) {
            shell("appwidget grantbind --package " + context.getPackageName() + " --user " + userId());
            granted = true;
        }
        if (host == null) host = new AppWidgetHost(context, HOST_ID);
        int id = host.allocateAppWidgetId();
        hostIds.add(id);
        assertTrue("測試前提：綁得上 " + provider.getSimpleName(),
            AppWidgetManager.getInstance(context).bindAppWidgetIdIfAllowed(id, new ComponentName(context, provider)));
        return id;
    }

    /** 這個測試 App 所在的使用者（uid ÷ 100000）。`--user current` 在 API 35 的 appwidget 指令會被砍掉（rc=137），所以寫數字。 */
    private static int userId() {
        return android.os.Process.myUid() / 100000;
    }

    private ActivityScenario<CollectionWidgetConfigActivity> open(int widgetId) {
        Intent intent = new Intent(context, CollectionWidgetConfigActivity.class)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        return ActivityScenario.launchActivityForResult(intent);
    }

    /** 設定頁版面的最外層 LinearLayout（ScrollView 的唯一子 View）：標題、說明、預覽、範圍、選單、按鈕都是它的直接子 View。 */
    private static ViewGroup form(CollectionWidgetConfigActivity activity) {
        ViewGroup content = activity.findViewById(android.R.id.content);
        ScrollView scroll = (ScrollView) content.getChildAt(0);
        return (ViewGroup) scroll.getChildAt(0);
    }

    /** 表單直接子 View 裡第一個 type（不往預覽卡裡面找：預覽卡是 RemoteViews 貼進來的，可能也有同型別的 View）。 */
    private static <T extends View> T child(CollectionWidgetConfigActivity activity, Class<T> type) {
        ViewGroup form = form(activity);
        for (int i = 0; i < form.getChildCount(); i++) {
            if (type.isInstance(form.getChildAt(i))) return type.cast(form.getChildAt(i));
        }
        throw new AssertionError("設定頁沒有 " + type.getSimpleName());
    }

    private List<String> spinnerLabels(int widgetId) {
        List<String> out = new ArrayList<>();
        try (ActivityScenario<CollectionWidgetConfigActivity> scenario = open(widgetId)) {
            assertEquals("設定頁應該開著", Lifecycle.State.RESUMED, scenario.getState());
            scenario.onActivity(activity -> {
                SpinnerAdapter adapter = child(activity, Spinner.class).getAdapter();
                for (int i = 0; i < adapter.getCount(); i++) out.add(String.valueOf(adapter.getItem(i)));
            });
        }
        return out;
    }

    private static String shell(String command) throws Exception {
        ParcelFileDescriptor pfd = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);
        try (InputStream in = new ParcelFileDescriptor.AutoCloseInputStream(pfd)) {
            return new String(readAll(in), "UTF-8");
        }
    }

    private static byte[] readBytes(File file) throws Exception {
        try (InputStream in = new FileInputStream(file)) { return readAll(in); }
    }

    private static void writeBytes(File file, byte[] bytes) throws Exception {
        try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); }
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
        return out.toByteArray();
    }
}
