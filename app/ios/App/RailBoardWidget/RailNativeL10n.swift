import Foundation

/// Widget／Live Activity 共用的輕量翻譯入口。
///
/// 固定字串、站名、路線名與後端訊息都經過這裡，才能優先採用網頁內的手動語言選擇。
/// 找不到時 Bundle 會原樣回傳繁中，與網站「繁中完整 fallback」的契約一致。
enum RailNativeL10n {
    private static let suite = UserDefaults(suiteName: "group.tw.railisland.app")

    static var language: String {
        switch suite?.string(forKey: "rail.language") {
        case "en": return "en"
        case "ja": return "ja"
        default: return "zh-TW"
        }
    }

    static var locale: Locale { Locale(identifier: language) }

    private static var bundle: Bundle {
        guard language != "zh-TW",
              let path = Bundle.main.path(forResource: language, ofType: "lproj"),
              let localized = Bundle(path: path) else { return .main }
        return localized
    }

    static func text(_ key: String, _ values: [String: String] = [:]) -> String {
        var result = bundle.localizedString(forKey: key, value: key, table: nil)
        for (name, value) in values {
            result = result.replacingOccurrences(of: "{\(name)}", with: value)
        }
        return result
    }

    /// 官方站名、路線名、車種共用同一份目錄；使用者自行命名的地點不要呼叫這支。
    static func name(_ source: String) -> String {
        let exact = text(source)
        if exact != source { return exact }
        let arrow = source.components(separatedBy: " → ")
        if arrow.count == 2 { return "\(name(arrow[0])) → \(name(arrow[1]))" }
        for suffix in ["車站", "站"] where source.hasSuffix(suffix) {
            let base = String(source.dropLast(suffix.count))
            let translated = text(base)
            if translated != base { return translated }
        }
        return source
    }

    /// AppIntent 選單的組合字串（班數、方向、到站時刻、車種＋車次）。
    static func option(_ source: String) -> String {
        let exact = text(source)
        if exact != source { return exact }
        if source.hasPrefix("往 "), source.hasSuffix(" 方向") {
            let station = String(source.dropFirst(2).dropLast(3))
            return text("往 {station} 方向", ["station": name(station)])
        }
        if source.hasSuffix(" 班"), let n = source.split(separator: " ").first, Int(n) != nil {
            return text("{n} 班", ["n": String(n)])
        }
        if source.hasSuffix(" 抵達") {
            return text("{time} 抵達", ["time": String(source.dropLast(3))])
        }
        if source.hasPrefix("往"), source.count > 1 {
            return text("往{station}", ["station": name(String(source.dropFirst()))])
        }
        if source.hasPrefix("通過 · 往") {
            return text("通過 · 往{station}", ["station": name(String(source.dropFirst(6)))])
        }
        if source.hasPrefix("1.5 公里內 "), source.hasSuffix(" 條路線") {
            let n = String(source.dropFirst("1.5 公里內 ".count).dropLast(" 條路線".count))
            return text("1.5 公里內 {n} 條路線", ["n": n])
        }
        if let marker = source.range(of: " · 往") {
            let line = String(source[..<marker.lowerBound])
            let station = String(source[marker.upperBound...])
            return text("{line} · 往{station}", ["line": name(line), "station": name(station)])
        }
        if let marker = source.range(of: " · "), source.hasSuffix(" 班") {
            let line = String(source[..<marker.lowerBound])
            let tail = String(source[marker.upperBound...].dropLast(2))
            return text("{line} · {n} 班", ["line": name(line), "n": tail])
        }
        let parts = source.components(separatedBy: "　")
        if parts.count == 2 {
            let train = parts[1].split(separator: " ", maxSplits: 1).map(String.init)
            if train.count == 2 { return "\(parts[0])　\(name(train[0])) \(train[1])" }
        }
        return name(source)
    }

    static func time(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter.string(from: date)
    }
}
