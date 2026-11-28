import AppKit
import SwiftUI

private final class StatusTitleView: NSStackView {
    // The status button handles clicks across the whole title.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

private final class StatusPercentBadge: NSView {
    private let fill: NSColor

    init(label: NSTextField, fill: NSColor) {
        self.fill = fill
        super.init(frame: .zero)
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 3),
            label.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -3),
            label.topAnchor.constraint(equalTo: topAnchor),
            label.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func draw(_ dirtyRect: NSRect) {
        let capsule = bounds.insetBy(dx: 0, dy: 1)
        let radius = capsule.height / 2
        fill.setFill()
        NSBezierPath(roundedRect: capsule, xRadius: radius, yRadius: radius).fill()
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }
}

@main
private final class StatusBar: NSObject, NSApplicationDelegate {
    private let base = URL(string: "http://127.0.0.1:43127")!
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let popover = NSPopover()
    private let panelState = UsagePanelState()
    private let primaryFont = NSFont.systemFont(ofSize: 11, weight: .medium)
    private let secondaryFont = NSFont.systemFont(ofSize: 9)
    private lazy var icons: [String: NSImage] = UsageProvider.allCases.reduce(into: [:]) { images, provider in
        guard let url = Bundle.main.url(forResource: provider.rawValue, withExtension: "png", subdirectory: "ProviderIcons"),
              let image = NSImage(contentsOf: url) else { return }
        image.isTemplate = true
        images[provider.rawValue] = image
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
        item.button?.target = self
        item.button?.action = #selector(togglePanel)
        item.button?.setAccessibilityLabel("Agent Usage")
        item.button?.setAccessibilityIdentifier("agent-usage-status")
        popover.behavior = .transient
        popover.contentViewController = NSHostingController(rootView: UsagePanel(
            state: panelState, icons: icons,
            openDashboard: { [weak self] in self?.openDashboard() },
            refresh: { [weak self] in self?.refresh() },
            quit: { NSApp.terminate(nil) },
            startServer: { [weak self] in self?.startServer() },
            selectionChanged: { [weak self] in self?.resizePanel() }
        ))
        render()
        refresh()
        let poll = Timer(timeInterval: 30, target: self, selector: #selector(refresh), userInfo: nil, repeats: true)
        RunLoop.main.add(poll, forMode: .common)
    }

    @objc private func togglePanel() {
        if popover.isShown {
            popover.performClose(nil)
            return
        }
        guard let button = item.button else { return }
        panelState.provider = nil
        resizePanel()
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
    }

    private func resizePanel() {
        let availableHeight = item.button?.window?.screen?.visibleFrame.height ?? 720
        let preferredHeight = UsagePanel.preferredHeight(for: panelState.content, provider: panelState.provider)
        popover.contentSize = NSSize(width: UsagePanel.width, height: min(preferredHeight, availableHeight - 28))
    }

    @objc private func refresh() {
        guard !fetching else { return }
        fetching = true
        panelState.content.fetching = true
        let request = URLRequest(url: base.appendingPathComponent("api/quota"),
                                 cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 45)
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            let result: Snapshot?
            if (response as? HTTPURLResponse)?.statusCode == 200, let data {
                result = try? JSONDecoder().decode(Snapshot.self, from: data)
            } else {
                result = nil
            }
            DispatchQueue.main.async {
                guard let self else { return }
                self.fetching = false
                self.snapshot = result
                self.unavailable = result == nil
                if result != nil { self.startError = nil }
                self.render()
            }
        }.resume()
    }

    private func render() {
        let now = Date()
        panelState.content = UsagePanelState.Content(
            snapshot: snapshot,
            message: unavailable ? startError ?? "Agent Usage server unavailable" : "Loading Agent Usage…",
            unavailable: unavailable, starting: starting, fetching: fetching, now: now
        )
        renderStatus(now: now)
        if popover.isShown { resizePanel() }
    }

    private func renderStatus(now: Date) {
        guard let button = item.button else { return }
        statusTitleView?.removeFromSuperview()
        statusTitleView = nil

        let rows = snapshot?.quota ?? []
        let active = snapshot?.activeProviders ?? []
        let calendar = Calendar.autoupdatingCurrent
        let clock = QuotaClock(now: now, calendar: calendar)
        let details = rows.map { row in
            let windows = row.windows.map { window in
                let amount = window.knownRemaining.map { "\(Int($0))% left" } ?? "Unavailable"
                let reset = window.reset.map { clock.label($0, full: true) } ?? "Reset time unavailable"
                return "\(window.displayName) \(amount) · \(reset)"
            }
            return ([row.label] + windows).joined(separator: "\n")
        }.joined(separator: "\n\n")
        button.toolTip = details.isEmpty ? "Agent Usage" : details

        let settings = snapshot?.settings
        let titles = StatusTitle.select(rows: rows.map(\.titleSource), active: active, now: now, calendar: calendar,
                                        thresholds: settings?.titleThresholds ?? .init(),
                                        titleProviders: settings?.titleProviders ?? [:])
        guard !titles.isEmpty else {
            item.length = NSStatusItem.variableLength
            button.title = "—"
            button.setAccessibilityValue("Quota unavailable")
            return
        }

        let spacing: CGFloat = 8
        let inset: CGFloat = 10
        let layout = StatusTitle.fit(titles, maxWidth: 360 - inset, spacing: spacing) { title, compact in
            self.column(title, compact: compact).fittingSize.width
        }
        let columns = layout.titles.map { column($0, compact: layout.compact) }
        let content = StatusTitleView(views: columns)
        content.orientation = .horizontal
        content.alignment = .top
        content.spacing = spacing
        content.translatesAutoresizingMaskIntoConstraints = false
        button.title = ""
        button.addSubview(content)
        NSLayoutConstraint.activate([
            content.centerXAnchor.constraint(equalTo: button.centerXAnchor),
            content.centerYAnchor.constraint(equalTo: button.centerYAnchor),
        ])
        item.length = ceil(content.fittingSize.width) + inset
        statusTitleView = content
        button.setAccessibilityValue(details.isEmpty ? titles.map {
            UsageProvider(rawValue: $0.provider)?.name ?? $0.provider
        }.joined(separator: ", ") : details)
    }

    private func column(_ title: StatusTitle, compact: Bool) -> NSStackView {
        let top = NSStackView()
        top.orientation = .horizontal
        top.alignment = .centerY
        top.spacing = 3
        if let icon = icons[title.provider] {
            let imageView = NSImageView(image: icon)
            imageView.contentTintColor = .labelColor
            imageView.imageScaling = .scaleProportionallyUpOrDown
            imageView.setAccessibilityElement(false)
            top.addArrangedSubview(imageView)
            imageView.widthAnchor.constraint(equalToConstant: 11).isActive = true
            imageView.heightAnchor.constraint(equalToConstant: 11).isActive = true
        } else {
            top.addArrangedSubview(statusLabel(UsageProvider(rawValue: title.provider)?.glyph ?? "?", font: primaryFont))
        }
        if let session = title.session {
            top.addArrangedSubview(statusLine(session, compact: compact, font: primaryFont))
        }
        let bottom = title.longest.map { statusLine($0, compact: compact, font: secondaryFont) }
            ?? statusLabel(" ", font: secondaryFont)
        let column = NSStackView(views: [top, bottom])
        column.orientation = .vertical
        column.alignment = .centerX
        column.spacing = -3
        return column
    }

    private func statusLine(_ line: StatusTitle.Line, compact: Bool, font: NSFont) -> NSView {
        guard let badge = line.badge else {
            return statusLabel(line.text(compact: compact), font: font)
        }
        let isCritical = badge == .critical
        let percent = StatusPercentBadge(label: statusLabel(line.amount, font: font, color: isCritical ? .white : .black),
                                        fill: isCritical ? .systemRed : .systemYellow)
        if compact { return percent }

        let row = NSStackView(views: [statusLabel(line.label, font: font), percent])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 2
        if let suffix = line.resetSuffix { row.addArrangedSubview(statusLabel(suffix, font: font)) }
        return row
    }

    private func statusLabel(_ value: String, font: NSFont, color: NSColor = .labelColor) -> NSTextField {
        let label = NSTextField(labelWithAttributedString: .init(string: value, attributes: [.font: font, .foregroundColor: color]))
        label.setAccessibilityElement(false)
        return label
    }

    private func openDashboard() {
        popover.performClose(nil)
        NSWorkspace.shared.open(base)
    }

    private func startServer() {
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
