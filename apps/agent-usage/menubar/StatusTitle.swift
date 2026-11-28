import Foundation

struct QuotaWindow: Decodable {
    let short: String
    let remaining: Double?
    let resetsAt: TimeInterval?
    let level: String
    let state: String

    var knownRemaining: Double? {
        remaining.flatMap { (0...100).contains($0) ? $0 : nil }
    }
}

struct StatusTitle {
    let line1: String
    let line2: String?

    init(amount: String, windows: [QuotaWindow], glyph: String?, timeZone: TimeZone = .autoupdatingCurrent) {
        line1 = glyph.map { "\($0) \(amount)" } ?? amount

        // Match the server's unrounded minimum, including first-in-order ties.
        let limiting = windows.compactMap { window in
            window.knownRemaining.map { (window: window, remaining: $0) }
        }.min { $0.remaining < $1.remaining }
        guard let limiting, "\(Int(limiting.remaining))%" == amount,
              let resetsAt = limiting.window.resetsAt, resetsAt.isFinite else {
            line2 = nil
            return
        }

        let windowLabels = ["7d": "W", "monthly": "M"]
        let windowLabel = windowLabels[limiting.window.short] ?? limiting.window.short
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "d MMM 'at' HH:mm"
        line2 = "\(windowLabel) −\(formatter.string(from: Date(timeIntervalSince1970: resetsAt)))"
    }
}
