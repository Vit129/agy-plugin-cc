import AppKit

@main
struct ProviderIconsMain {
    static func main() throws {
        let artwork = URL(fileURLWithPath: CommandLine.arguments[1])
        let icons = ProviderIcons(resource: artwork)
        let providers = ["claude", "codex", "copilot", "agy"]
        let coverage = providers.map { provider in
            guard let image = icons.template(for: provider), image.isTemplate,
                  let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) else { return 0 }
            return (0..<bitmap.pixelsWide).reduce(0) { count, x in
                count + (0..<bitmap.pixelsHigh).filter { y in
                    (bitmap.colorAt(x: x, y: y)?.alphaComponent ?? 0) > 0.5
                }.count
            }
        }
        precondition(icons.template(for: "aider") == nil)
        precondition(ProviderIcons(resource: nil).template(for: "claude") == nil)
        let result: [String: Any] = ["coverage": coverage, "aider": ProviderIcons.monogram(for: "aider")]
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result))
    }
}
