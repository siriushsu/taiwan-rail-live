# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# 混淆之後 Play Console 的當機堆疊要靠 mapping.txt 還原，保留行號才還原得出行數；
# 再把原始檔名抹成 SourceFile，只留行號不留檔名。
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# 這個檔到此為止是刻意的短——下面幾類東西「已經有人 keep 了」，不要重複加，
# 多餘的 keep 只會把 Play 量的模糊化比例壓回去：
#
# * 自家 8 個與第三方 6 個 Capacitor plugin
#   @capacitor/android 用 consumerProguardFiles 帶了
#   `-keep public class * extends com.getcapacitor.Plugin { *; }`，
#   涵蓋 PluginHandle 的 getDeclaredConstructor().newInstance() 與 getMethods() 兩處反射。
#
# * JS 與 native 的橋（MessageHandler / CapacitorHttp / CapacitorCookies 上的
#   @JavascriptInterface）：AGP 預設的 proguard-android.txt 有
#   `-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }`。
#
# * @CapacitorPlugin(name = "RailXxx") 這類 runtime 才讀的註解：同一個預設檔的
#   -keepattributes 已含 RuntimeVisibleAnnotations 與 AnnotationDefault。
#
# * 三個小工具 provider、三個設定 Activity、兩個 receiver 與 RailAudioService：
#   AndroidManifest 宣告過的元件，AGP 會自動產生 keep 規則。
#
# 自家 native 程式碼目前零反射、零 Gson、零 Serializable，JSON 全走 org.json 手動
# 取鍵，所以沒有別的要 keep。之後若加了用反射或序列化取值的程式碼，要回來補規則。
