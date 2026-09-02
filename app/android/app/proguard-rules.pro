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

# 2026-09-02（開 R8 後第一次真的打 release 才炸出來的）：
# @capacitor-firebase/authentication 內建 FacebookAuthProviderHandler，它 import Facebook SDK，
# 而本 App 沒有 Facebook 登入、也就沒有把那個 SDK 列為相依 ⇒ R8 判定「缺類別」直接讓
# :app:minifyReleaseWithR8 失敗（build 31 以前 minifyEnabled 是 false，所以從來沒現形）。
# 這幾條就是 AGP 自己產在 build/outputs/mapping/release/missing_rules.txt 的原文。
# 不是 keep 而是 dontwarn：那些路徑執行期本來就到不了（沒有 Facebook 登入入口），
# 未混淆的 19～31 也一樣沒有那些類別卻跑得好好的，所以只要讓 R8 別把它當硬錯。
-dontwarn com.facebook.CallbackManager$Factory
-dontwarn com.facebook.CallbackManager
-dontwarn com.facebook.FacebookCallback
-dontwarn com.facebook.login.LoginManager
-dontwarn com.facebook.login.widget.LoginButton
