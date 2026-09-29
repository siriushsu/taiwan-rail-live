package tw.railisland.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 「車站收集」小工具的資料通道：網頁 JS 算好一包 JSON 字串（資料格式 v1，
 * 見 docs/superpowers/plans/2026-09-29-車站收集小工具.md），這裡驗過就原樣寫進
 * App 私有儲存的 files/collection.json，再通知小、中兩個 provider 重畫。
 *
 * 與 iOS RailCollectionPlugin.swift 同一套驗證（見 CollectionStore.validate）。
 * 只做「驗形狀＋原子寫入」，不解碼內容，也不碰看板／地點等別的檔——收集資料與發車看板無關。
 */
@CapacitorPlugin(name = "RailCollection")
public final class RailCollectionPlugin extends Plugin {
    @PluginMethod
    public void sync(PluginCall call) {
        String json = call.getString("json");
        String problem = CollectionStore.validate(json);
        if (problem != null) {
            call.reject(problem);
            return;
        }
        if (!CollectionStore.write(getContext(), json)) {
            call.reject("Unable to persist collection");
            return;
        }
        CollectionWidgetProvider.updateAll(getContext());
        call.resolve();
    }
}
