import Foundation

struct QuotaWindow: Decodable {
    let short: String
    let remaining: Double?
    let resetsAt: TimeInterval?
    let state: String?

    var knownRemaining: Double? {
        remaining.flatMap { (0...100).contains($0) ? $0 : nil }
    }

    var reset: Date? {
        resetsAt.flatMap { $0.isFinite ? Date(timeIntervalSince1970: $0) : nil }
    }

    var displayName: String {
        switch short {
        case "5h": return "Session"
        case "7d": return "Weekly"
        case "monthly": return "Monthly"
        default: return short
        }
    }
}

struct QuotaPace: Encodable {
    enum Tone: String, Encodable {
        case unknown, onPace, close, behind
    }

    static let sessionLength: TimeInterval = 5 * 3600
    private static let weeklyLength: TimeInterval = 7 * 24 * 3600

    let expectedRemaining: Double?
    let reserve: Double?
    let exhaustsAt: Date?
    let lastsUntilReset: Bool?
    let tone: Tone

    init(window: QuotaWindow, now: Date, calendar: Calendar) {
        guard let remaining = window.knownRemaining, let reset = window.reset,
              let start = Self.start(of: window.short, endingAt: reset, calendar: calendar),
              start <= now, now < reset else {
            expectedRemaining = nil
            reserve = nil
            exhaustsAt = nil
            lastsUntilReset = nil
            tone = .unknown
            return
        }

        let elapsed = now.timeIntervalSince(start)
        let expected = reset.timeIntervalSince(now) / reset.timeIntervalSince(start)
        let fraction = remaining / 100
        let margin = fraction - expected
        expectedRemaining = expected
        reserve = max(0, margin)
        if fraction == 1 {
            exhaustsAt = nil
            lastsUntilReset = true
            tone = .onPace
        } else if fraction == 0 || elapsed > 0 {
            // Before exhaustion the time left is the remaining quota divided by observed usage per second.
            let onPace = margin >= -1e-10
            exhaustsAt = onPace ? nil : now.addingTimeInterval(elapsed * fraction / (1 - fraction))
            lastsUntilReset = onPace
            tone = onPace ? (margin < 0.05 ? .close : .onPace) : .behind
        } else {
            exhaustsAt = nil
            lastsUntilReset = nil
            tone = .unknown
        }
    }

    private static func start(of window: String, endingAt reset: Date, calendar: Calendar) -> Date? {
        switch window {
        case "5h": return reset.addingTimeInterval(-sessionLength)
        case "7d": return reset.addingTimeInterval(-weeklyLength)
        case "monthly": return calendar.date(byAdding: .month, value: -1, to: reset)
        default: return nil
        }
    }

    static func weeklyCapacity(weekly: QuotaWindow, session: QuotaWindow?, cost: Double?, now: Date)
        -> (quotas: Double, windows: Int)? {
        guard weekly.short == "7d", session?.short == "5h", session?.knownRemaining != nil,
              let remaining = weekly.knownRemaining, let reset = weekly.reset,
              let cost, cost.isFinite, cost >= 1, cost <= 100 else { return nil }
        let timeLeft = reset.timeIntervalSince(now)
        guard timeLeft > 0, timeLeft <= weeklyLength else { return nil }
        return (remaining / cost, Int(ceil(timeLeft / sessionLength)))
    }
}

struct QuotaClock {
    private let formatter: DateFormatter
    private let calendar: Calendar
    private let now: Date

    init(now: Date, calendar: Calendar) {
        self.now = now
        self.calendar = calendar
        formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
    }

    func label(_ date: Date, full: Bool = false) -> String {
        formatter.dateFormat = full ? "d MMM yyyy 'at' HH:mm"
            : (calendar.isDate(date, inSameDayAs: now) ? "HH:mm" : "d MMM HH:mm")
        return formatter.string(from: date)
    }
}
