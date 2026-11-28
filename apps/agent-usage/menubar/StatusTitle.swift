import Foundation

struct StatusTitle: Encodable {
    struct Thresholds {
        let warning: Double
        let critical: Double

        init(warning: Double? = nil, critical: Double? = nil) {
            self.warning = warning ?? 60
            self.critical = critical ?? 30
        }
    }

    struct Source: Decodable {
        let provider: String
        let windows: [QuotaWindow]
    }

    struct Line: Encodable {
        enum Badge: String, Encodable {
            case warning, critical
        }

        let label: String
        let amount: String
        let reset: String?
        let badge: Badge?

        init(_ window: QuotaWindow, thresholds: Thresholds, clock: QuotaClock) {
            label = window.short == "7d" ? "W" : window.short == "monthly" ? "M" : window.short
            amount = window.knownRemaining.map { "\(Int($0))%" } ?? "—"
            reset = window.reset.map { clock.label($0) }
            if let remaining = window.knownRemaining, remaining < thresholds.warning {
                badge = remaining < thresholds.critical ? .critical : .warning
            } else {
                badge = nil
            }
        }

        var resetSuffix: String? { reset.map { "· \($0)" } }

        func text(compact: Bool) -> String {
            if compact { return amount }
            return "\(label) \(amount)" + (resetSuffix.map { " \($0)" } ?? "")
        }
    }

    struct Layout: Encodable {
        let titles: [StatusTitle]
        let compact: Bool
    }

    let provider: String
    let session: Line?
    let longest: Line?

    /// Fraction (0...1) for a provider tab's mini bar: the lowest session (5h) remaining across its
    /// accounts, or its lowest other window when it has no session window (Copilot's monthly).
    static func tabFraction(rows: [Source], provider: String) -> Double? {
        let windows = rows.filter { $0.provider == provider }.flatMap(\.windows)
        let session = windows.filter { $0.short == "5h" }.compactMap(\.knownRemaining)
        let pool = session.isEmpty ? windows.compactMap(\.knownRemaining) : session
        return pool.min().map { $0 / 100 }
    }

    static func select(rows: [Source], active: [String], now: Date, calendar: Calendar,
                       thresholds: Thresholds = Thresholds(), titleProviders: [String: Bool] = [:]) -> [StatusTitle] {
        let eligible = rows.filter { titleProviders[$0.provider] != false }
        var providers = active.filter { titleProviders[$0] != false }
        if providers.isEmpty {
            let idle = eligible.flatMap { row in
                row.windows.compactMap { window in window.knownRemaining.map { (row.provider, $0) } }
            }.min { $0.1 < $1.1 }?.0
            providers = idle.map { [$0] } ?? []
        }
        let windowsByProvider = Dictionary(grouping: eligible, by: \.provider)
        let clock = QuotaClock(now: now, calendar: calendar)

        return providers.map { provider in
            let windows = windowsByProvider[provider, default: []].flatMap(\.windows)
            func line(_ short: String) -> Line? {
                windows.filter { $0.short == short }.min {
                    ($0.knownRemaining ?? .infinity) < ($1.knownRemaining ?? .infinity)
                }.map { Line($0, thresholds: thresholds, clock: clock) }
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
