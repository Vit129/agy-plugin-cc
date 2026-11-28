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

        let provider: String
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

    struct MenuModel: Decodable {
        struct Indicator: Decodable {
            let provider: String
            let label: String
            let amount: String
            let dimmed: Bool
        }

        struct Group: Decodable {
            struct Window: Decodable {
                let label: String
                let amount: String
                let level: String
                let resetLabel: String
                let resetsAt: TimeInterval?
                let suffix: String?
            }

            let label: String
            let secondary: String?
            let windows: [Window]
        }

        let status: [Indicator]
        let groups: [Group]

        // A status item can start while the previously installed server is still running.
        init(legacy rows: [Row]) {
            let values = rows.flatMap { row in
                row.windows.compactMap { window -> (Row, Double)? in
                    guard let value = window.remaining, (0...100).contains(value) else { return nil }
                    return (row, value)
                }
            }
            status = values.min(by: { $0.1 < $1.1 }).map { row, value in
                [Indicator(provider: row.provider, label: row.label, amount: "\(Int(value))%", dimmed: true)]
            } ?? []
            groups = rows.map { row in
                Group(label: row.label, secondary: nil, windows: row.windows.map { window in
                    let value = window.remaining.flatMap { (0...100).contains($0) ? "\(Int($0))%" : nil }
                    return Group.Window(label: "\(window.short) · ", amount: value ?? "—", level: window.level,
                                        resetLabel: window.resetsAt == nil ? "Reset time unavailable" : "Resets",
                                        resetsAt: window.resetsAt, suffix: window.state == "aging" ? " · Stale" : nil)
                })
            }
        }
    }

    let quota: [Row]
    let routes: Routes
    let menu: MenuModel?
}

private final class StatusBar: NSObject, NSApplicationDelegate {
    private let base = URL(string: "http://127.0.0.1:43127")!
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let menu = NSMenu()
    private let clock = DateFormatter()
    private let levelColors: [String: NSColor] = ["healthy": .systemGreen, "watch": .systemYellow,
                                                   "low": .systemOrange, "critical": .systemRed]
    private let glyphs = ["claude": "C", "agy": "A", "copilot": "G", "codex": "O"]
    private lazy var icons: [String: NSImage] = glyphs.reduce(into: [:]) { images, entry in
        guard let url = Bundle.main.url(forResource: entry.key, withExtension: "png", subdirectory: "ProviderIcons"),
              let image = NSImage(contentsOf: url) else { return }
        image.isTemplate = true
        images[entry.key] = image
    }
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
        let poll = Timer(timeInterval: 30, target: self, selector: #selector(refresh), userInfo: nil, repeats: true)
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
        let model = snapshot.map { $0.menu ?? Snapshot.MenuModel(legacy: $0.quota) }
        renderStatus(model?.status ?? [])

        menu.removeAllItems()
        if let snapshot = snapshot, let model = model {
            if model.groups.isEmpty { addLine("No providers enabled") }
            for group in model.groups {
                let title = NSMutableAttributedString(string: group.label, attributes: [
                    .foregroundColor: NSColor.labelColor, .font: NSFont.boldSystemFont(ofSize: NSFont.menuFont(ofSize: 0).pointSize),
                ])
                if let secondary = group.secondary { title.append(text(secondary, color: .secondaryLabelColor)) }
                addLine(title)
                for window in group.windows { addLine(windowTitle(window), indent: 1) }
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

    private func text(_ title: String, color: NSColor = .labelColor) -> NSAttributedString {
        NSAttributedString(string: title, attributes: [.foregroundColor: color])
    }

    private func renderStatus(_ indicators: [Snapshot.MenuModel.Indicator]) {
        guard let button = item.button else { return }
        guard !indicators.isEmpty else {
            button.attributedTitle = text("—")
            button.setAccessibilityValue("Quota unavailable")
            return
        }

        let title = NSMutableAttributedString()
        var accessibility: [String] = []
        for indicator in indicators {
            if title.length > 0 { title.append(text("  ")) }
            let color: NSColor = indicator.dimmed ? .secondaryLabelColor : .labelColor
            if let icon = icons[indicator.provider] {
                // Text attachments don't inherit the status button's template image tint.
                let tinted = NSImage(size: NSSize(width: 14, height: 14), flipped: false) { rect in
                    guard let context = NSGraphicsContext.current?.cgContext else { return false }
                    icon.draw(in: rect)
                    context.saveGState()
                    context.setBlendMode(.sourceIn)
                    context.setFillColor(color.cgColor)
                    context.fill(rect)
                    context.restoreGState()
                    return true
                }
                let attachment = NSTextAttachment()
                attachment.attachmentCell = NSTextAttachmentCell(imageCell: tinted)
                title.append(NSAttributedString(attachment: attachment))
            } else {
                title.append(text(glyphs[indicator.provider] ?? "?", color: color))
            }
            title.append(text(" \(indicator.amount)", color: color))
            let quota = indicator.amount == "—" ? "quota unavailable" : "\(indicator.amount) remaining"
            accessibility.append("\(indicator.label), \(quota)")
        }
        button.attributedTitle = title
        button.setAccessibilityValue(accessibility.joined(separator: "; "))
    }

    private func windowTitle(_ window: Snapshot.MenuModel.Group.Window) -> NSAttributedString {
        let title = NSMutableAttributedString(attributedString: text(window.label))
        title.append(text(window.amount, color: levelColors[window.level] ?? .labelColor))
        title.append(text(" remaining · "))
        let reset = window.resetsAt.map { "\(window.resetLabel) \(clock.string(from: Date(timeIntervalSince1970: $0)))" }
            ?? window.resetLabel
        title.append(text(reset + (window.suffix ?? ""), color: .secondaryLabelColor))
        return title
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

    private func addLine(_ label: String) { addLine(text(label)) }

    private func addLine(_ title: NSAttributedString, indent: Int = 0) {
        let line = NSMenuItem(title: title.string, action: #selector(readOnlyLine), keyEquivalent: "")
        line.attributedTitle = title
        line.target = self
        line.isEnabled = true
        line.indentationLevel = indent
        menu.addItem(line)
    }

    @objc private func readOnlyLine() {}

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
