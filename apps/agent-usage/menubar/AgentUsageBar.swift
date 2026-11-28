import AppKit

private struct Snapshot: Decodable {
    struct Row: Decodable {
        struct Window: Decodable {
            let short: String
            let remaining: Double?
            let resetsAt: TimeInterval?
            let level: String
            let state: String
        }

        struct ResetCredits: Decodable {
            struct Credit: Decodable {
                let title: String?
                let status: String?
                let expiresAt: TimeInterval?
            }
            let availableCount: Int?
            let credits: [Credit]?
        }

        let label: String
        let windows: [Window]
        let rateLimitResetCredits: ResetCredits?
    }

    struct Routes: Decodable {
        struct Decision: Decodable {
            let requested: String
            let target: String
            let reason: String
        }
        let claudeToAgy: Decision
        let agyToClaude: Decision
    }

    let quota: [Row]
    let routes: Routes
}

private final class StatusBar: NSObject, NSApplicationDelegate {
    private let base = URL(string: "http://127.0.0.1:43127")!
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let menu = NSMenu()
    private let clock = DateFormatter()
    private var snapshot: Snapshot?
    private var unavailable = false
    private var fetching = false
    private var starting = false
    private var startError: String?

    func applicationDidFinishLaunching(_ notification: Notification) {
        clock.dateStyle = .medium
        clock.timeStyle = .short
        menu.autoenablesItems = false
        item.menu = menu
        item.button?.setAccessibilityLabel("Agent Usage")
        item.button?.toolTip = "Agent Usage"
        render()
        refresh()
        let poll = Timer(timeInterval: 60, target: self, selector: #selector(refresh), userInfo: nil, repeats: true)
        RunLoop.main.add(poll, forMode: .common)
    }

    @objc private func refresh() {
        guard !fetching else { return }
        fetching = true
        let request = URLRequest(url: base.appendingPathComponent("api/quota"),
                                 cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 45)
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            let result: Snapshot?
            if (response as? HTTPURLResponse)?.statusCode == 200, let data = data {
                result = try? JSONDecoder().decode(Snapshot.self, from: data)
            } else {
                result = nil
            }
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.fetching = false
                self.snapshot = result
                self.unavailable = result == nil
                if result != nil { self.startError = nil }
                self.render()
            }
        }.resume()
    }

    private func render() {
        let known = snapshot?.quota.flatMap(\.windows).compactMap { window -> (Double, String)? in
            guard let value = window.remaining, (0...100).contains(value) else { return nil }
            return (value, window.level)
        } ?? []
        let colors: [String: NSColor] = ["healthy": .systemGreen, "watch": .systemYellow,
                                         "low": .systemOrange, "critical": .systemRed]
        if let lowest = known.min(by: { $0.0 < $1.0 }) {
            let percent = Int(lowest.0)
            item.button?.attributedTitle = NSAttributedString(
                string: "● \(percent)%", attributes: [.foregroundColor: colors[lowest.1] ?? .labelColor])
            item.button?.setAccessibilityValue("\(percent)% remaining, \(lowest.1)")
        } else {
            item.button?.attributedTitle = NSAttributedString(string: "—")
            item.button?.setAccessibilityValue("Quota unavailable")
        }

        menu.removeAllItems()
        if let snapshot = snapshot {
            if snapshot.quota.isEmpty { addLine("No providers enabled") }
            for row in snapshot.quota {
                for window in row.windows { addLine(windowLabel(row, window)) }
            }
            menu.addItem(.separator())
            addLine(routeLabel("Claude → agy", snapshot.routes.claudeToAgy))
            addLine(routeLabel("agy → Claude", snapshot.routes.agyToClaude))
            let credits = creditLabels(snapshot.quota, at: Date())
            if !credits.isEmpty {
                menu.addItem(.separator())
                credits.forEach(addLine)
            }
        } else if unavailable {
            addLine(startError ?? "Agent Usage server unavailable")
            addAction(starting ? "Starting Agent Usage…" : "Start Agent Usage", #selector(startServer), enabled: !starting)
        } else {
            addLine("Loading Agent Usage…")
        }
        menu.addItem(.separator())
        addAction("Open dashboard", #selector(openDashboard))
        addAction("Refresh", #selector(refresh))
        addAction("Quit", #selector(quit))
    }

    private func windowLabel(_ row: Snapshot.Row, _ window: Snapshot.Row.Window) -> String {
        let amount = window.remaining.map { "\(Int($0))%" } ?? "—"
        let reset = window.resetsAt.map { "Resets \(clock.string(from: Date(timeIntervalSince1970: $0)))" }
            ?? "Reset time unavailable"
        let stale = window.state == "aging" ? " · Stale" : ""
        return "\(row.label) · \(window.short) · \(amount) remaining · \(reset)\(stale)"
    }

    private func routeLabel(_ label: String, _ route: Snapshot.Routes.Decision) -> String {
        let status = route.target == route.requested ? "Allowed" : "Diverted"
        return "\(label) · \(status) · \(route.reason)"
    }

    private func creditLabels(_ rows: [Snapshot.Row], at now: Date) -> [String] {
        let credits = rows.flatMap { row -> [(String, TimeInterval?)] in
            guard let summary = row.rateLimitResetCredits else { return [] }
            if summary.credits == nil, (summary.availableCount ?? 0) > 0 {
                return [("\(row.label) · \(summary.availableCount ?? 0) reset credits available · expiry details unavailable", nil)]
            }
            return (summary.credits ?? []).filter { credit in
                credit.status == "available" && (credit.expiresAt.map { $0 > now.timeIntervalSince1970 } ?? true)
            }.map { credit in
                let title = credit.title.flatMap { $0.isEmpty ? nil : $0 } ?? "Rate limit reset"
                let label = "\(row.label) · \(title)"
                return (credit.expiresAt == nil ? "\(label) · No expiry reported" : label, credit.expiresAt)
            }
        }
        return credits.sorted { ($0.1 ?? .infinity) < ($1.1 ?? .infinity) }.map { label, expiry in
            guard let expiry = expiry else { return label }
            let date = Date(timeIntervalSince1970: expiry)
            let seconds = date.timeIntervalSince(now)
            let relative = seconds > 86_400 ? "\(Int(ceil(seconds / 86_400)))d"
                : seconds >= 3600 ? "\(Int(ceil(seconds / 3600)))h" : "\(Int(ceil(seconds / 60)))m"
            return "\(label) · Expires \(clock.string(from: date)) (in \(relative))"
        }
    }

    private func addLine(_ label: String) {
        let line = NSMenuItem(title: label, action: nil, keyEquivalent: "")
        line.isEnabled = false
        menu.addItem(line)
    }

    private func addAction(_ label: String, _ action: Selector, enabled: Bool = true) {
        let line = NSMenuItem(title: label, action: action, keyEquivalent: "")
        line.target = self
        line.isEnabled = enabled
        menu.addItem(line)
    }

    @objc private func openDashboard() { NSWorkspace.shared.open(base) }
    @objc private func quit() { NSApp.terminate(nil) }

    @objc private func startServer() {
        guard !starting else { return }
        let launch = Process()
        launch.executableURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/bin/agent-usage")
        launch.arguments = ["ensure-running"]
        launch.terminationHandler = { [weak self] process in
            let success = process.terminationStatus == 0
            DispatchQueue.main.async { self?.serverStarted(success) }
        }
        starting = true
        startError = nil
        render()
        do { try launch.run() } catch { serverStarted(false) }
    }

    private func serverStarted(_ success: Bool) {
        starting = false
        startError = success ? nil : "Could not start Agent Usage. Check the local launcher."
        render()
        if success { refresh() }
    }
}

let application = NSApplication.shared
private let statusBar = StatusBar()
application.setActivationPolicy(.accessory)
application.delegate = statusBar
application.run()
