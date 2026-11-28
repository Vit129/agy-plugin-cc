import Foundation

struct Snapshot: Decodable {
    struct Row: Decodable {
        struct ResetCredits: Decodable {
            struct Credit: Decodable {
                let provider: String?
                let title: String?
                let status: String?
                let expiresAt: TimeInterval?

                func isPending(at now: Date) -> Bool {
                    (status == "available" || (provider == "claude" && status == "unknown")) &&
                    (expiresAt.map { $0 > now.timeIntervalSince1970 } ?? true)
                }
            }

            let availableCount: Int?
            let credits: [Credit]?
        }

        let provider: String
        let label: String
        let accountId: String?
        let login: String?
        let plan: String?
        let capturedAt: TimeInterval?
        let windows: [QuotaWindow]
        let error: String?
        let rateLimitResetCredits: ResetCredits?

        var title: String {
            accountId == nil ? UsageProvider(rawValue: provider)?.name ?? label : label
        }

        var titleSource: StatusTitle.Source { .init(provider: provider, windows: windows) }
    }

    struct Routes: Decodable {
        struct Decision: Decodable {
            let requested: String
            let target: String
            let reason: String
        }

        let claudeToAgy, agyToClaude: Decision
    }

    struct Activity: Decodable {
        let provider: String
    }

    struct LegacyMenu: Decodable {
        struct Indicator: Decodable {
            let provider: String
            let dimmed: Bool
        }

        let status: [Indicator]
    }

    struct Settings: Decodable {
        let cost: Double?
        let low: Double?
        let critical: Double?
        let titleProviders: [String: Bool]?
        let autoRoute: Bool?

        var titleThresholds: StatusTitle.Thresholds { .init(warning: low, critical: critical) }
    }

    let quota: [Row]
    let routes: Routes
    let active: [Activity]?
    let menu: LegacyMenu?
    let settings: Settings?

    var activeProviders: [String] {
        active?.map(\.provider) ?? menu?.status.filter { !$0.dimmed }.map(\.provider) ?? []
    }

    var routeLabels: [String] {
        [routeLabel("Claude → agy", routes.claudeToAgy), routeLabel("agy → Claude", routes.agyToClaude)]
    }

    private func routeLabel(_ label: String, _ route: Routes.Decision) -> String {
        let status = settings?.autoRoute == false ? "Off" : route.target == route.requested ? "Allowed" : "Diverted"
        return "\(label) · \(status) · \(route.reason)"
    }

    func hasClaudeCredit(at now: Date) -> Bool {
        quota.contains { row in
            row.rateLimitResetCredits?.credits?.contains { $0.provider == "claude" && $0.isPending(at: now) } ?? false
        }
    }

    func creditLabels(at now: Date, clock: QuotaClock) -> [String] {
        let credits = quota.flatMap { row -> [(String, TimeInterval?)] in
            guard let summary = row.rateLimitResetCredits else { return [] }
            if summary.credits == nil, let count = summary.availableCount, count > 0 {
                return [("\(row.label) · \(count) reset credits available · expiry details unavailable", nil)]
            }
            return (summary.credits ?? []).filter { $0.isPending(at: now) }.map { credit in
                let title = credit.title.flatMap { $0.isEmpty ? nil : $0 } ?? "Rate limit reset"
                let label = "\(row.label) · \(title)"
                return (credit.expiresAt == nil ? "\(label) · No expiry reported" : label, credit.expiresAt)
            }
        }
        return credits.sorted { ($0.1 ?? .infinity) < ($1.1 ?? .infinity) }.map { label, expiry in
            guard let expiry else { return label }
            let date = Date(timeIntervalSince1970: expiry)
            let seconds = date.timeIntervalSince(now)
            let relative = seconds > 86_400 ? "\(Int(ceil(seconds / 86_400)))d"
                : seconds >= 3600 ? "\(Int(ceil(seconds / 3600)))h" : "\(Int(ceil(seconds / 60)))m"
            return "\(label) · Expires \(clock.label(date, full: true)) (in \(relative))"
        }
    }
}

enum UsageProvider: String, CaseIterable {
    case claude, agy, copilot, codex

    var name: String {
        switch self {
        case .claude: return "Claude"
        case .agy: return "Antigravity"
        case .copilot: return "Copilot"
        case .codex: return "Codex"
        }
    }
}
