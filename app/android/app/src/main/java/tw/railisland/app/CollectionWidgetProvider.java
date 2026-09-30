package tw.railisland.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.widget.RemoteViews;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 「車站收集」小工具（Android 只做小、中兩款，沒有大卡；iOS 另有鎖定畫面兩款，Android 沒有）。
 * 邏輯全在這個類別（＝中），小卡是空殼子類 CollectionWidgetSmallProvider，見 WidgetFamily。
 *
 * 資料流：網頁算好整包（同護照「車站 N 座」的同一個函式）→ RailCollectionPlugin 驗過原子寫入
 * files/collection.json → CollectionWidgetProvider.updateAll。這裡只讀不算，沒有任何網路請求。
 * 內容只在 App 寫檔或切語言時才會變（RailCollectionPlugin／RailLanguagePlugin 都直接呼叫 updateAll）；
 * updatePeriodMillis（6 小時，與 iOS 時間軸一致）只是保險（檔案被外力換掉時自癒）。
 *
 * 點小工具：開 railisland://passport（旅程護照），與 iOS 一致；RailMetroWaitPlugin 把它轉成 waitOpen 事件。
 * 「蓋章」按鈕（整條按鈕：小卡在文字欄最下面、中卡在地圖欄最下面，寬＝所在欄寬；wc_stamp 是 28dp 高的膠囊，可點的是外面那層透明容器
 * wc_stamp_hit，至少 48dp 高）另綁 railisland://checkin：打開 App 後由網頁判定附近車站並蓋章，
 * 同樣經 RailMetroWaitPlugin 轉成 waitOpen { view: "checkin" }。
 */
// 不是 final：小卡是空殼子類（CollectionWidgetSmallProvider），見 WidgetFamily。
public class CollectionWidgetProvider extends AppWidgetProvider {
    static final String PREFS = "collection_widget";
    private static final String TAG = "CollectionWidget";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    static String scopeKey(int id) { return "scope_" + id; }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) updateOneAsync(context, manager, id);
    }

    /** 31 以下沒有尺寸桶，拉大拉小要重畫一張（中卡的列數與地圖大小都依高度取捨）。 */
    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        updateOneAsync(context, manager, id);
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        SharedPreferences.Editor editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        for (int id : ids) editor.remove(scopeKey(id));
        editor.apply();
    }

    /** 小、中兩族的全部 appWidgetId 一起更新（只查本類會漏掉小卡）。 */
    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        for (int id : WidgetFamily.ids(context, manager, WidgetFamily.COLLECTION)) updateOneAsync(context, manager, id);
    }

    static void updateOneAsync(Context context, AppWidgetManager manager, int id) {
        Context app = context.getApplicationContext();
        EXECUTOR.execute(() -> updateOne(app, manager, id));
    }

    /** 這一格現在該長什麼樣（不碰 AppWidgetManager.updateAppWidget，測試與設定頁預覽也用它）。 */
    static RemoteViews views(Context context, int id, String family, String scope, int widthDp, int heightDp) {
        CollectionData data = CollectionData.load(context);
        RemoteViews views = CollectionWidgetRender.build(context, family, data, scope, widthDp, heightDp);
        views.setOnClickPendingIntent(R.id.wc_root, openPassport(context, id));
        // 「打開軌島一次」訊息版面沒有按鈕，只有小、中兩張資料版面有
        int layout = views.getLayoutId();
        if (layout == R.layout.widget_collect_small || layout == R.layout.widget_collect_medium) {
            views.setOnClickPendingIntent(R.id.wc_stamp_hit, openCheckin(context, id));
        }
        return views;
    }

    private static void updateOne(Context context, AppWidgetManager manager, int id) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String scope = prefs.getString(scopeKey(id), CollectionData.ALL);
            String family = WidgetFamily.of(context, id);
            Bundle options = manager.getAppWidgetOptions(id);
            // launcher 回報兩組尺寸：MIN_WIDTH／MAX_HEIGHT＝直放時的格子，MAX_WIDTH／MIN_HEIGHT＝橫放時的格子。
            // 只取 MIN_* 會把直放的高度低估（Pixel 2×2 直放 219dp 高、橫放只剩 137dp），中卡的列數就少放了。
            // 依目前螢幕方向挑對應那組；沒回報（0）就給 0，讓 render 用保底。
            boolean landscape = context.getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
            int w = 0, h = 0;
            if (options != null) {
                int minW = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
                int maxW = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0);
                int minH = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
                int maxH = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
                w = landscape ? (maxW > 0 ? maxW : minW) : minW;
                h = landscape ? minH : (maxH > 0 ? maxH : minH);
            }
            Log.i(TAG, "更新 id=" + id + " family=" + family + " scope=" + scope + " 採用 " + w + "x" + h + "dp（" + (landscape ? "橫" : "直")
                + "放；options=" + options + "）");
            manager.updateAppWidget(id, views(context, id, family, scope, w, h));
        } catch (Exception error) {
            // 畫失敗（例如 Bitmap 超過 RemoteViews 上限）不能留下一張過期或空白的卡：退回中性訊息卡，並留下 log。
            Log.e(TAG, "更新失敗 id=" + id, error);
            try {
                RemoteViews fallback = CollectionWidgetRender.unavailable(context, WidgetFamily.SMALL.equals(WidgetFamily.of(context, id)));
                fallback.setOnClickPendingIntent(R.id.wc_root, openPassport(context, id));
                manager.updateAppWidget(id, fallback);
            } catch (Exception ignored) {
                Log.e(TAG, "連退路都失敗 id=" + id, ignored);
            }
        }
    }

    /**
     * 點小工具＝開旅程護照。request code 用 id+46000（既有的 41000～45000 已被其他小工具占用）。
     */
    static PendingIntent openPassport(Context context, int id) {
        return openDeepLink(context, "passport", id + 46000);
    }

    /**
     * 「蓋章」按鈕＝開 railisland://checkin（自動蓋附近車站）。request code 用 id+47000：其餘小工具已占用
     * 31000～33000（看板）、41000～45000（混合看板）、46000（本類的護照）、48000／49000／81000（捷運小工具），
     * 46300 以上另有兩則通知的固定碼；47000 段沒人用，且與護照那一顆的 URI 不同（PendingIntent 以 URI 區分），兩顆不會互相覆蓋。
     */
    static PendingIntent openCheckin(Context context, int id) {
        return openDeepLink(context, "checkin", id + 47000);
    }

    /** 🔴 URI 只有 scheme＋host，不帶任何參數：網頁端不需要參數，帶了 App 端還得處理。指名 MainActivity、FLAG_IMMUTABLE。 */
    private static PendingIntent openDeepLink(Context context, String host, int requestCode) {
        Uri uri = new Uri.Builder().scheme("railisland").authority(host).build();
        Intent intent = new Intent(Intent.ACTION_VIEW, uri, context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
