package tw.railisland.app;

/**
 * 車站收集・小（預設 2×2）。與 CollectionWidgetProvider 同一份邏輯（更新、設定頁、偏好鍵全部沿用），只是在小工具選單上
 * 獨立成一項、加進桌面時預設大小不同（見 res/xml/collection_widget_small_info.xml）。
 * 🔴 不要在這裡加任何邏輯：家族內兩個 provider 必須行為一致，差異只准存在於 provider info。
 */
public final class CollectionWidgetSmallProvider extends CollectionWidgetProvider {
}
