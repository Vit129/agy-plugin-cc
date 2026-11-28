import Foundation

struct StatusTitle: Encodable {
    struct Source: Decodable {
        let provider: String
        let windows: [QuotaWindow]
    }

    struct Line: Encodable {
        let label: String
        let amount: String
        let reset: String?
        let tone: QuotaPace.Tone

        init(_ window: QuotaWindow, now: Date, calendar: Calendar, clock: QuotaClock) {
            label = window.short == "7d" ? "W" : window.short == "monthly" ? "M" : window.short
            amount = window.knownRemaining.map { "\(Int($0))%" } ?? "—"
            reset = window.reset.map { clock.label($0) }
            tone = QuotaPace(window: window, now: now, calendar: calendar).tone
        }

        func text(compact: Bool) -> String {
            if compact { return amount }
            return "\(label) \(amount)" + (reset.map { " · \($0)" } ?? "")
        }
    }

    struct Layout: Encodable {
        let titles: [StatusTitle]
        let compact: Bool
    }

    let provider: String
    let session: Line?
    let longest: Line?

    static func select(rows: [Source], active: [String], now: Date, calendar: Calendar) -> [StatusTitle] {
        let idle = rows.flatMap { row in
            row.windows.compactMap { window in window.knownRemaining.map { (row.provider, $0) } }
        }.min { $0.1 < $1.1 }?.0
        let providers = active.isEmpty ? idle.map { [$0] } ?? [] : active
        let windowsByProvider = Dictionary(grouping: rows, by: \.provider)
        let clock = QuotaClock(now: now, calendar: calendar)

        return providers.map { provider in
            let windows = windowsByProvider[provider, default: []].flatMap(\.windows)
            func line(_ short: String) -> Line? {
                windows.filter { $0.short == short }.min {
                    ($0.knownRemaining ?? .infinity) < ($1.knownRemaining ?? .infinity)
                }.map { Line($0, now: now, calendar: calendar, clock: clock) }
            }
            return StatusTitle(provider: provider, session: line("5h"), longest: line("7d") ?? line("monthly"))
        }
    }

    static func fit(_ titles: [StatusTitle], maxWidth: Double, spacing: Double,
                    measure: (StatusTitle, Bool) -> Double) -> Layout {
        func width(_ titles: [StatusTitle], compact: Bool) -> Double {
            titles.reduce(0) { $0 + measure($1, compact) } + Double(max(0, titles.count - 1)) * spacing
        }
        if width(titles, compact: false) <= maxWidth {
            return Layout(titles: titles, compact: false)
        }
        var visible = titles
        while visible.count > 1 && width(visible, compact: true) > maxWidth {
            visible.removeLast()
        }
        return Layout(titles: visible, compact: true)
    }
}
