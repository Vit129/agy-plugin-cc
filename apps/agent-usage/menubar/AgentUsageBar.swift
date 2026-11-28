import AppKit

private struct Snapshot: Decodable {
    struct Row: Decodable {
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
        let windows: [QuotaWindow]
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
                    window.knownRemaining.map { (row, $0) }
                }
            }
            status = values.min(by: { $0.1 < $1.1 }).map { row, value in
                [Indicator(provider: row.provider, label: row.label, amount: "\(Int(value))%", dimmed: true)]
            } ?? []
            groups = rows.map { row in
                Group(label: row.label, secondary: nil, windows: row.windows.map { window in
                    let value = window.knownRemaining.map { "\(Int($0))%" }
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

private final class StatusTitleView: NSStackView {
    // The status button continues to handle menu clicks across the whole title.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

@main
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
    private var statusTitleView: StatusTitleView?

    static func main() {
        let application = NSApplication.shared
        let statusBar = StatusBar()
        application.setActivationPolicy(.accessory)
        application.delegate = statusBar
        withExtendedLifetime(statusBar) { application.run() }
    }

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
        renderStatus(model?.status ?? [], rows: snapshot?.quota ?? [])

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

    private func renderStatus(_ indicators: [Snapshot.MenuModel.Indicator], rows: [Snapshot.Row]) {
        guard let button = item.button else { return }
        statusTitleView?.removeFromSuperview()
        statusTitleView = nil
        guard !indicators.isEmpty else {
            item.length = NSStatusItem.variableLength
            button.attributedTitle = text("—")
            button.setAccessibilityValue("Quota unavailable")
            return
        }

        let windowsByProvider = Dictionary(grouping: rows, by: \.provider)
        let titles = indicators.map { indicator in
            let glyph = icons[indicator.provider] == nil ? glyphs[indicator.provider] ?? "?" : nil
            let windows = windowsByProvider[indicator.provider, default: []].flatMap(\.windows)
            return StatusTitle(amount: indicator.amount, windows: windows, glyph: glyph)
        }
        let stacked = titles.contains { $0.line2 != nil }
        let primaryFont = stacked ? NSFont.systemFont(ofSize: 11, weight: .medium) : .menuBarFont(ofSize: 0)
        var accessibility: [String] = []
        let columns = zip(indicators, titles).map { indicator, title in
            let primary = statusLabel(title.line1, font: primaryFont)
            let top = NSStackView()
            top.orientation = .horizontal
            top.alignment = .centerY
            top.spacing = 3
            if let icon = icons[indicator.provider] {
                let imageView = NSImageView(image: icon)
                imageView.contentTintColor = .labelColor
                imageView.imageScaling = .scaleProportionallyUpOrDown
                imageView.setAccessibilityElement(false)
                top.addArrangedSubview(imageView)
                let size: CGFloat = stacked ? 11 : 14
                imageView.widthAnchor.constraint(equalToConstant: size).isActive = true
                imageView.heightAnchor.constraint(equalToConstant: size).isActive = true
            }
            top.addArrangedSubview(primary)
            let column = NSStackView(views: [top])
            column.orientation = .vertical
            column.alignment = .centerX
            column.spacing = -3
            column.alphaValue = indicator.dimmed ? 0.75 : 1
            let quota = indicator.amount == "—" ? "quota unavailable" : "\(indicator.amount) remaining"
            var description = "\(indicator.label), \(quota)"
            if let reset = title.line2 {
                column.addArrangedSubview(statusLabel(reset, font: .systemFont(ofSize: 9)))
                description += ", \(reset)"
            }
            accessibility.append(description)
            return column
        }

        let content = StatusTitleView(views: columns)
        content.orientation = .horizontal
        content.alignment = .top
        content.spacing = 8
        content.translatesAutoresizingMaskIntoConstraints = false
        button.attributedTitle = NSAttributedString()
        button.addSubview(content)
        NSLayoutConstraint.activate([
            content.centerXAnchor.constraint(equalTo: button.centerXAnchor),
            content.centerYAnchor.constraint(equalTo: button.centerYAnchor),
        ])
        item.length = ceil(content.fittingSize.width) + 10
        statusTitleView = content
        button.setAccessibilityValue(accessibility.joined(separator: "; "))
    }

    private func statusLabel(_ value: String, font: NSFont) -> NSTextField {
        let label = NSTextField(labelWithString: value)
        label.font = font
        label.textColor = .labelColor
        label.setAccessibilityElement(false)
        return label
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
