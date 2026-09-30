package tw.railisland.app;

import android.content.Context;
import android.util.JsonReader;
import android.util.JsonToken;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;

/**
 * collection.json 的驗證與原子寫入。驗證跟 iOS RailCollectionPlugin.swift 同一套：
 * 缺、空、>512KB、不是物件、v≠1 一律 reject；只驗形狀，不解碼內容（小工具端自己解碼，格式演進不用動這裡）。
 *
 * 刻意用 android.util.JsonReader（預設嚴格）而不是 org.json：org.json 會放行單引號、註解、
 * 沒有引號的鍵，還會無視物件後面的多餘文字；iOS 的 JSONSerialization 全部拒絕。
 * 寫成純靜態、不碰 Capacitor，讓 instrumentation 測試可以直接打。
 */
final class CollectionStore {
    private CollectionStore() {}

    /** 539 座站的 payload 約 20 KB；512 KB 是「明顯不對勁」的保險絲，不是預期值。 */
    static final int MAX_BYTES = 512 * 1024;
    static final int SUPPORTED_VERSION = 1;
    private static final Object LOCK = new Object();

    /** 驗證通過回 null；否則回 reject 訊息（與 iOS 訊息一一對應）。 */
    static String validate(String json) {
        if (json == null) return "Missing json string";
        byte[] data = json.getBytes(StandardCharsets.UTF_8);
        if (data.length == 0) return "Empty json";
        if (data.length > MAX_BYTES) {
            return "Payload too large (" + data.length + " bytes, limit " + MAX_BYTES + ")";
        }
        Double version = null;
        try (JsonReader reader = new JsonReader(new StringReader(json))) {
            reader.setLenient(false);
            if (reader.peek() != JsonToken.BEGIN_OBJECT) return "Payload is not a JSON object";
            reader.beginObject();
            while (reader.hasNext()) {
                String name = reader.nextName();
                if ("v".equals(name)) {
                    // 重複的鍵以最後一個為準（與 JSONSerialization 一致）；v 不是數字（含 true、"1"）一律當版本不對。
                    if (reader.peek() == JsonToken.NUMBER) version = Double.valueOf(reader.nextString());
                    else { version = null; reader.skipValue(); }
                } else {
                    reader.skipValue();
                }
            }
            reader.endObject();
            // 物件後面不准有東西
            if (reader.peek() != JsonToken.END_DOCUMENT) return "Payload is not a JSON object";
        } catch (Exception error) {
            return "Payload is not a JSON object";
        }
        if (version == null || version.doubleValue() != (double) SUPPORTED_VERSION) {
            return "Unsupported payload version (expected v == " + SUPPORTED_VERSION + ")";
        }
        return null;
    }

    /** 原子寫入：先寫同目錄暫存檔、fsync，再 rename 蓋過去。失敗回 false。 */
    static boolean write(Context context, String json) {
        synchronized (LOCK) {
            File dest = CollectionData.file(context);
            File tmp = new File(dest.getParentFile(), FILE_NAME_TMP);
            try {
                try (FileOutputStream out = new FileOutputStream(tmp)) {
                    out.write(json.getBytes(StandardCharsets.UTF_8));
                    out.getFD().sync();
                }
                if (!tmp.renameTo(dest)) {
                    tmp.delete();
                    return false;
                }
                return true;
            } catch (IOException error) {
                tmp.delete();
                return false;
            }
        }
    }

    private static final String FILE_NAME_TMP = CollectionData.FILE_NAME + ".tmp";

    /** 讀回整份字串；沒有檔案回 null。 */
    static String read(Context context) {
        synchronized (LOCK) {
            File file = CollectionData.file(context);
            if (!file.isFile()) return null;
            try (InputStream in = new FileInputStream(file); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                for (int n; (n = in.read(buffer)) >= 0;) out.write(buffer, 0, n);
                return new String(out.toByteArray(), StandardCharsets.UTF_8);
            } catch (IOException error) {
                return null;
            }
        }
    }
}
