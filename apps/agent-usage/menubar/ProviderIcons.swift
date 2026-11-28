import AppKit

final class ProviderIcons {
    private struct Art: Decodable {
        let width: CGFloat
        let height: CGFloat
        let evenOdd: Bool
        let paths: [String]
    }

    private let artwork: [String: Art]
    private var images: [String: NSImage] = [:]

    init(resource: URL? = Bundle.main.url(forResource: "provider-icons", withExtension: "json")) {
        if let resource, let data = try? Data(contentsOf: resource),
           let decoded = try? JSONDecoder().decode([String: Art].self, from: data) {
            artwork = decoded
        } else {
            artwork = [:]
        }
    }

    func template(for provider: String) -> NSImage? {
        if let image = images[provider] { return image }
        guard let art = artwork[provider], art.width > 0, art.height > 0 else { return nil }
        let paths = art.paths.map { SVGPathParser.path(from: $0) }.filter { !$0.isEmpty }
        guard !paths.isEmpty else { return nil }
        let image = NSImage(size: NSSize(width: 16, height: 16), flipped: false) { rect in
            guard let context = NSGraphicsContext.current?.cgContext else { return false }
            let scale = min(rect.width / art.width, rect.height / art.height)
            let x = rect.midX - art.width * scale / 2
            let y = rect.midY - art.height * scale / 2
            var transform = CGAffineTransform(translationX: x, y: y)
                .scaledBy(x: scale, y: scale)
                .translatedBy(x: 0, y: art.height)
                .scaledBy(x: 1, y: -1)
            context.setFillColor(NSColor.white.cgColor)
            for path in paths {
                if let scaledPath = path.copy(using: &transform) {
                    context.addPath(scaledPath)
                    context.fillPath(using: art.evenOdd ? .evenOdd : .winding)
                }
            }
            return true
        }
        image.isTemplate = true
        images[provider] = image
        return image
    }

    static func monogram(for provider: String) -> String {
        let letters = String(provider.filter(\.isLetter).uppercased().prefix(2))
        return letters.isEmpty ? "AG" : letters
    }
}
