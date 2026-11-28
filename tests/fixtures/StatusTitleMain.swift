import Foundation

@main
enum StatusTitleMain {
    struct Input: Decodable {
        let amount: String
        let windows: [QuotaWindow]
        let glyph: String?
        let timeZone: String
    }

    static func main() throws {
        let input = try JSONDecoder().decode(Input.self, from: FileHandle.standardInput.readDataToEndOfFile())
        let title = StatusTitle(amount: input.amount, windows: input.windows, glyph: input.glyph,
                                timeZone: TimeZone(identifier: input.timeZone)!)
        let lines: [String?] = [title.line1, title.line2]
        FileHandle.standardOutput.write(try JSONEncoder().encode(lines))
    }
}
