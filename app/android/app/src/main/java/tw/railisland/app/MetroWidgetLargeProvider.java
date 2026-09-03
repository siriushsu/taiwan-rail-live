package tw.railisland.app;

/**
 * 捷運看板・大（預設 4×4，主角一班＋接下來七班）。與 MetroWidgetProvider 同一份邏輯（更新、鬧鐘、設定頁、偏好鍵全部沿用），只是在小工具選單上
 * 獨立成一項、加進桌面時預設大小不同（見 res/xml 對應的 *_info.xml）。
 * 🔴 不要在這裡加任何邏輯：家族內三個 provider 必須行為一致，差異只准存在於 provider info。
 */
public final class MetroWidgetLargeProvider extends MetroWidgetProvider {
}
