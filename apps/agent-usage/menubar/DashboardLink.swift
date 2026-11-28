import Foundation

enum DashboardLink {
    /// nil opens the dashboard; "" opens Settings; a name (general, notifications, accounts, auto-route) selects that section.
    static func url(base: URL, settingsSection: String? = nil) -> URL {
        guard let settingsSection else { return base }
        var parts = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        parts.fragment = settingsSection.isEmpty ? "settings" : "settings/\(settingsSection)"
        return parts.url!
    }
}
