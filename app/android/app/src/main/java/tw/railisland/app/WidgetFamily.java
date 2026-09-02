package tw.railisland.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;

import java.util.ArrayList;
import java.util.List;

/**
 * 小／中／大三種尺寸各自一個 provider（選單一項一張，跟 iOS 藝廊一對一；使用者 2026-09-02 裁示
 * 「種類要跟 iOS 一樣多」），邏輯全在「中」那個類別，小／大只是空殼子類。這裡放兩件跨類別要一致的事：
 *  (1) 同一家族的 id 要三個 provider 一起數——只數本類會漏掉小／大兩種，免費站名額與 updateAll 都會漏；
 *  (2) API 31 以下沒有 setSizeSpecificViewLayouts，要靠「這一格綁的是哪個 provider」挑版面。
 */
final class WidgetFamily {
    private WidgetFamily() {}

    static final String SMALL = "small";
    static final String MEDIUM = "medium";
    static final String LARGE = "large";

    static final Class<?>[] METRO = { MetroWidgetProvider.class, MetroWidgetSmallProvider.class, MetroWidgetLargeProvider.class };
    static final Class<?>[] RAIL = { RailBoardWidgetProvider.class, RailBoardWidgetSmallProvider.class, RailBoardWidgetLargeProvider.class };

    /** 同一家族三個 provider 綁著的全部 appWidgetId。 */
    static int[] ids(Context context, AppWidgetManager manager, Class<?>[] family) {
        List<Integer> out = new ArrayList<>();
        for (Class<?> cls : family) {
            for (int id : manager.getAppWidgetIds(new ComponentName(context, cls))) out.add(id);
        }
        int[] ids = new int[out.size()];
        for (int i = 0; i < ids.length; i++) ids[i] = out.get(i);
        return ids;
    }

    /** 這一格屬於哪個尺寸（照 provider 類名的尾巴判；查不到當「中」，與舊版行為相同）。 */
    static String of(Context context, int id) {
        AppWidgetProviderInfo info = AppWidgetManager.getInstance(context).getAppWidgetInfo(id);
        String name = info == null || info.provider == null ? "" : info.provider.getClassName();
        return name.endsWith("SmallProvider") ? SMALL : name.endsWith("LargeProvider") ? LARGE : MEDIUM;
    }
}
