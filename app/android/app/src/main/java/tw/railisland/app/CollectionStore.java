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
 * 另外巢狀超過 MAX_DEPTH 也 reject——存檔時擋掉，舊的好資料才不會被一份小工具讀不了的 payload 蓋掉。
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
    /** 巢狀深度上限（{ 與 [ 合計）。真實 payload 最深 3 層（最外層物件 → pts 陣列 → 一個點），64 同樣是「明顯不對勁」的保險絲。 */
    static final int MAX_DEPTH = 64;
    private static final Object LOCK = new Object();

    /**
     * 掃一遍字串，巢狀深度超過 MAX_DEPTH 回 false。解析前先擋：org.json 是遞迴解析，極深的巢狀會丟 StackOverflowError
     * （那是 Error 不是 Exception，一般的 catch 接不到，在小工具更新裡就是整個 App 閃退）。
     * 只數括號、不驗語法；雙引號字串裡的括號不算，字串內的跳脫（\" 與 \\）照 JSON 規則連同下一個字元吃掉。
     * 用迴圈、不遞迴，輸入多深都安全。對嚴格 JSON 是精確的；org.json 放行的單引號字串這裡不認得，
     * 那種非標準寫法可能騙過這一關，所以呼叫端外層另外接 StackOverflowError 當保險。
     */
    static boolean nestingWithinLimit(String json) {
        int depth = 0;
        boolean inString = false;
        for (int i = 0, n = json.length(); i < n; i++) {
            char c = json.charAt(i);
            if (inString) {
                if (c == '\\') i++;
                else if (c == '"') inString = false;
            } else if (c == '"') {
                inString = true;
            } else if (c == '{' || c == '[') {
                if (++depth > MAX_DEPTH) return false;
            } else if (c == '}' || c == ']') {
                if (depth > 0) depth--;
            }
        }
        return true;
    }

    /** 驗證通過回 null；否則回 reject 訊息（與 iOS 訊息一一對應；巢狀太深沿用「不是 JSON 物件」那一則）。 */
    static String validate(String json) {
        if (json == null) return "Missing json string";
        byte[] data = json.getBytes(StandardCharsets.UTF_8);
        if (data.length == 0) return "Empty json";
        if (data.length > MAX_BYTES) {
            return "Payload too large (" + data.length + " bytes, limit " + MAX_BYTES + ")";
        }
        if (!nestingWithinLimit(json)) return "Payload is not a JSON object";
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
        } catch (Exception | StackOverflowError error) {
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
