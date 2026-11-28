import SwiftUI

extension UsageProvider {
    var accent: Color {
        switch self {
        case .claude: return Color(nsColor: .systemOrange)
        case .agy: return Color(nsColor: .systemGreen)
        case .copilot: return Color(nsColor: .systemPurple)
        case .codex: return Color(nsColor: .systemTeal)
        }
    }
}

final class UsagePanelState: ObservableObject {
    struct Content {
        var snapshot: Snapshot?
        var message = "Loading Agent Usage…"
        var unavailable = false
        var starting = false
        var fetching = false
        var now = Date()
    }

    @Published var content = Content()
    @Published var provider: UsageProvider?
}

struct UsagePanel: View {
    @ObservedObject var state: UsagePanelState
    let icons: [String: NSImage]
    let openDashboard: () -> Void
    let refresh: () -> Void
    let quit: () -> Void
    let startServer: () -> Void
    var selectionChanged: () -> Void = {}
    @AppStorage("tabLabels") private var tabLabels = true

    static let width: CGFloat = 406

    static func preferredHeight(for content: UsagePanelState.Content, provider: UsageProvider?) -> CGFloat {
        guard let snapshot = content.snapshot else { return 250 }
        let rows = snapshot.quota.filter { row in provider.map { row.provider == $0.rawValue } ?? true }
        let windowHeight = provider == nil ? 36 : 70
        // Reserve room for wrapped route reasons and credits; long lists can scroll.
        let footer = snapshot.hasClaudeCredit(at: content.now) ? 284 : 251
        let preferred = rows.reduce(footer) { height, row in height + 82 + windowHeight * row.windows.count }
        return CGFloat(min(preferred, provider == nil ? 820 : 670))
    }

    private var snapshot: Snapshot? { state.content.snapshot }
    private var now: Date { state.content.now }
    private var calendar: Calendar { .autoupdatingCurrent }

    var body: some View {
        let clock = QuotaClock(now: now, calendar: calendar)
        VStack(spacing: 0) {
            tabs.padding(.horizontal, 12).padding(.vertical, 8)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let snapshot {
                        sections(snapshot, clock: clock)
                        Divider()
                        routeSummary(snapshot, clock: clock)
                    } else {
                        statusMessage
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .id(state.provider)
            Divider()
            actions
        }
        .frame(width: Self.width)
    }

    private var tabs: some View {
        HStack(spacing: 4) {
            tab(nil)
            ForEach(UsageProvider.allCases, id: \.self) { tab($0) }
        }
        .accessibilityLabel("Quota views")
        .contextMenu {
            Picker("Tabs", selection: $tabLabels) {
                Text("Icon only").tag(false)
                Text("Icon with label").tag(true)
            }
            .pickerStyle(.inline)
        }
    }

    /// Mini usage bar under a provider tab; the overview tab keeps a plain accent line.
    private func tabBar(_ provider: UsageProvider?, accent: Color, selected: Bool) -> some View {
        let fraction = provider.flatMap { provider in
            snapshot.flatMap { StatusTitle.tabFraction(rows: $0.quota.map(\.titleSource), provider: provider.rawValue) }
        }
        return GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(provider == nil ? accent.opacity(selected ? 1 : 0.72) : accent.opacity(0.22))
                if let fraction {
                    Capsule().fill(accent).frame(width: geometry.size.width * min(1, max(0, fraction)))
                }
            }
        }
        .frame(height: selected ? 3 : 2)
        .padding(.horizontal, 5)
        .help(fraction.map { "\(Int(($0 * 100).rounded()))% left" } ?? "")
    }

    private func tab(_ provider: UsageProvider?) -> some View {
        let selected = state.provider == provider
        let name = provider?.name ?? "Overview"
        let accent = provider?.accent ?? .accentColor
        return Button {
            select(provider)
        } label: {
            VStack(spacing: 4) {
                Group {
                    if let provider {
                        if let icon = icons[provider.rawValue] {
                            Image(nsImage: icon).resizable().renderingMode(.template).scaledToFit()
                        } else {
                            Text(provider.glyph).font(.caption.weight(.bold))
                        }
                    } else {
                        Image(systemName: "square.grid.2x2").font(.system(size: 13, weight: .medium))
                    }
                }
                .frame(width: 16, height: 16)
                if tabLabels {
                    Text(name)
                        .font(.caption.weight(selected ? .semibold : .medium))
                        .lineLimit(1)
                }
                tabBar(provider, accent: accent, selected: selected)
            }
            .help(tabLabels ? "" : name)
            .foregroundStyle(selected ? .primary : .secondary)
            .padding(.top, 6)
            .padding(.bottom, 4)
            .frame(maxWidth: .infinity)
            .background {
                RoundedRectangle(cornerRadius: 7)
                    .fill(selected ? accent.opacity(0.15) : .clear)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(name)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("usage-tab-\(provider?.rawValue ?? "overview")")
    }

    private func select(_ provider: UsageProvider?) {
        state.provider = provider
        selectionChanged()
    }

    private var statusMessage: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(state.content.message).foregroundStyle(.secondary)
            if state.content.unavailable {
                Button(state.content.starting ? "Starting Agent Usage…" : "Start Agent Usage", action: startServer)
                    .disabled(state.content.starting)
                    .accessibilityIdentifier("usage-start-server")
            }
        }
    }

    private func sections(_ snapshot: Snapshot, clock: QuotaClock) -> some View {
        let rows = snapshot.quota.filter { row in
            state.provider.map { row.provider == $0.rawValue } ?? true
        }
        return VStack(alignment: .leading, spacing: 12) {
            if rows.isEmpty {
                Text(state.provider.map { "\($0.name) is disabled" } ?? "No providers enabled")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(rows.indices, id: \.self) { index in
                if index > 0 { Divider() }
                section(rows[index], clock: clock, cost: snapshot.settings?.cost)
            }
        }
    }

    private func section(_ row: Snapshot.Row, clock: QuotaClock, cost: Double?) -> some View {
        let provider = UsageProvider(rawValue: row.provider)
        return VStack(alignment: .leading, spacing: 9) {
            if state.provider == nil, let provider {
                Button {
                    select(provider)
                } label: {
                    heading(row, chevron: true)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("usage-open-\(row.provider)-\(row.accountId ?? "default")")
            } else {
                heading(row, chevron: false)
            }
            if let error = row.error {
                Text("Quota check: \(error)").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(row.windows.indices, id: \.self) { index in
                let window = row.windows[index]
                quotaBar(window, accent: provider?.accent ?? .accentColor, clock: clock,
                         session: row.windows.first { $0.short == "5h" }, cost: cost)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func heading(_ row: Snapshot.Row, chevron: Bool) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline) {
                Text(row.title).font(.headline)
                Spacer(minLength: 6)
                if let plan = row.plan { Text(plan).font(.caption).foregroundStyle(.secondary) }
                if chevron {
                    Image(systemName: "chevron.right").font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary).accessibilityHidden(true)
                }
            }
            Text(updatedLabel(row.capturedAt)).font(.caption).foregroundStyle(.secondary)
            if let login = row.login {
                Text(login).font(.caption).foregroundStyle(.secondary)
                    .lineLimit(2).help(login)
            }
        }
    }

    private func updatedLabel(_ capturedAt: TimeInterval?) -> String {
        guard let capturedAt, capturedAt.isFinite, capturedAt > 0 else { return "No quota update yet" }
        let minutes = Int(max(0, now.timeIntervalSince1970 - capturedAt) / 60)
        return minutes == 0 ? "Updated just now" : "Updated \(minutes) min ago"
    }

    private func quotaBar(_ window: QuotaWindow, accent: Color, clock: QuotaClock,
                          session: QuotaWindow?, cost: Double?) -> some View {
        let detail = state.provider != nil
        let pace = QuotaPace(window: window, now: now, calendar: calendar)
        let reset = window.reset.map {
            let prefix = window.state == "reset_assumed" ? "Last reported reset" : "Resets"
            return "\(prefix) \(clock.label($0))"
        } ?? "Reset time unavailable"
        let amount = window.knownRemaining.map { "\(Int($0))% left" } ?? "Unavailable"
        return VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(window.displayName) \(amount)")
                    .font(detail ? .callout.weight(.semibold) : .caption.weight(.semibold))
                Spacer(minLength: 8)
                if detail { Text(reset).font(.caption).foregroundStyle(.secondary) }
                if window.state == "aging" {
                    Text("Stale").font(.caption2).foregroundStyle(.secondary)
                }
            }
            GeometryReader { geometry in
                let width = geometry.size.width
                ZStack(alignment: .leading) {
                    Capsule().fill(.primary.opacity(0.12))
                    Capsule().fill(accent).frame(width: width * (window.knownRemaining ?? 0) / 100)
                    if let expected = pace.expectedRemaining {
                        Capsule()
                            .fill(pace.tone == .behind || pace.tone == .unknown ? Color.red : Color.green)
                            .frame(width: 3, height: detail ? 14 : 10)
                            .overlay { Capsule().strokeBorder(.background, lineWidth: 0.7) }
                            .offset(x: max(0, min(width - 3, width * expected - 1.5)))
                    }
                }
            }
            .frame(height: detail ? 12 : 7)
            .accessibilityHidden(true)
            .help(pace.expectedRemaining.map { "Expected \(Int(($0 * 100).rounded()))% left at an even pace" } ?? reset)

            if detail {
                let capacity = QuotaPace.weeklyCapacity(weekly: window, session: session, cost: cost, now: now)
                if let reserve = pace.reserve {
                    let outlook = pace.exhaustsAt.map { "Runs out ~\(clock.label($0))" }
                        ?? (pace.lastsUntilReset == true ? "Lasts until reset" : "Projection unavailable")
                    Text("\(Int((reserve * 100).rounded()))% in reserve · \(outlook)")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let capacity {
                    let count = capacity.quotas.formatted(.number.precision(.fractionLength(0...1)))
                    let windows = capacity.windows == 1 ? "1 window" : "\(capacity.windows) windows"
                    Text("Est. \(count) session quotas left · \(windows) until reset")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func routeSummary(_ snapshot: Snapshot, clock: QuotaClock) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("Auto-Route").font(.caption.weight(.semibold))
            ForEach(snapshot.routeLabels, id: \.self) { line in
                Text(line).font(.caption).foregroundStyle(.secondary)
            }
            let credits = snapshot.creditLabels(at: now, clock: clock)
            ForEach(credits.indices, id: \.self) { index in
                Text(credits[index]).font(.caption).foregroundStyle(.secondary)
            }
            if snapshot.hasClaudeCredit(at: now), let usage = URL(string: "https://claude.ai/settings/usage") {
                Link("Open claude.ai usage", destination: usage)
                    .font(.caption)
                    .accessibilityIdentifier("usage-open-claude-usage")
            }
        }
    }

    private var actions: some View {
        HStack(spacing: 8) {
            Button("Open dashboard", action: openDashboard)
                .accessibilityIdentifier("usage-open-dashboard")
            Spacer()
            Button("Refresh", action: refresh)
                .disabled(state.content.fetching)
                .accessibilityIdentifier("usage-refresh")
            Button("Quit", action: quit)
                .accessibilityIdentifier("usage-quit")
        }
        .controlSize(.small)
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
    }
}
