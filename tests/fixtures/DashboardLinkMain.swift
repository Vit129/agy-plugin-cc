import Foundation

@main
enum DashboardLinkMain {
    static func main() throws {
        let base = URL(string: "http://127.0.0.1:43127")!
        let urls = [
            DashboardLink.url(base: base),
            DashboardLink.url(base: base, settingsSection: ""),
            DashboardLink.url(base: base, settingsSection: "notifications"),
        ].map(\.absoluteString)
        let snapshot = try JSONDecoder().decode(Snapshot.self, from: FileHandle.standardInput.readDataToEndOfFile())
        let output: [String: [String]] = ["urls": urls, "routeLabels": snapshot.routeLabels]
        print(String(data: try JSONEncoder().encode(output), encoding: .utf8)!)
    }
}
