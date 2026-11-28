import Foundation

@main
enum StatusTitleMain {
    struct Input: Decodable {
        let rows: [StatusTitle.Source]
        let active: [String]
        let now: Date
        let width: Double
        let window: QuotaWindow?
        let session: QuotaWindow?
        let cost: Double?
        let timeZone: String
    }

    static func main() throws {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        let input = try decoder.decode(Input.self, from: FileHandle.standardInput.readDataToEndOfFile())
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: input.timeZone)!
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        if let window = input.window {
            if let cost = input.cost {
                let capacity = QuotaPace.weeklyCapacity(weekly: window, session: input.session, cost: cost, now: input.now)
                let result = capacity.map { [$0.quotas, Double($0.windows)] }
                FileHandle.standardOutput.write(try encoder.encode(result))
            } else {
                let pace = QuotaPace(window: window, now: input.now, calendar: calendar)
                FileHandle.standardOutput.write(try encoder.encode(pace))
            }
            return
        }
        let titles = StatusTitle.select(rows: input.rows, active: input.active, now: input.now, calendar: calendar)
        let fit = StatusTitle.fit(titles, maxWidth: input.width, spacing: 8) { title, compact in
            [title.session, title.longest].compactMap { $0?.text(compact: compact).count }.max().map {
                Double(12 + $0 * 6)
            } ?? 12
        }
        FileHandle.standardOutput.write(try encoder.encode(fit))
    }
}
