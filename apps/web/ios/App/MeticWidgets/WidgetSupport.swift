import SwiftUI
import WidgetKit

extension Color {
    /// Metic brand orange — matches the app header dot (#d77100).
    static let meticBrand = Color(red: 0.843, green: 0.443, blue: 0.0)
}

/// The "Metic." wordmark as a single Text run so the dot keeps its baseline.
/// The dot is ~1.5× the word size and uses the brand orange, mirroring the app.
func meticWordmark(baseSize: CGFloat) -> Text {
    Text("Metic")
        .font(.system(size: baseSize, weight: .bold))
        .foregroundStyle(.secondary)
    + Text(".")
        .font(.system(size: baseSize * 1.5, weight: .bold))
        .foregroundStyle(Color.meticBrand)
}

/// Metic header shown on every widget, pinned to the top edge.
struct MeticHeader: View {
    var trailing: String?
    var baseSize: CGFloat = 12
    var body: some View {
        HStack(spacing: 4) {
            meticWordmark(baseSize: baseSize)
            Spacer(minLength: 0)
            if let trailing {
                Text(trailing)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}

/// Profile image loaded from the App Group cache, falling back to a monogram.
struct ProfileImageView: View {
    let favourite: Favourite
    var size: CGFloat = 44

    private var monogram: String {
        let initials = favourite.name
            .split(separator: " ")
            .prefix(2)
            .compactMap { $0.first }
        return initials.isEmpty ? "?" : String(initials).uppercased()
    }

    var body: some View {
        Group {
            if let url = AppGroupStore().imageURL(for: favourite),
               let data = try? Data(contentsOf: url),
               let ui = UIImage(data: data) {
                Image(uiImage: ui).resizable().scaledToFill()
            } else {
                ZStack {
                    Rectangle().fill(.tint.opacity(0.18))
                    Text(monogram)
                        .font(.system(size: size * 0.4, weight: .semibold))
                        .foregroundStyle(.tint)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/// Subtitle: target weight · temp when known.
func favouriteSubtitle(_ fav: Favourite) -> String? {
    var parts: [String] = []
    if let w = fav.targetWeightG { parts.append("\(Int(w))g") }
    if let t = fav.targetTempC { parts.append("\(Int(t))°") }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
}

/// A single tappable favourite tile. Starts in the background, or foregrounds
/// the app via a metic:// link when openAppOnStart is set.
struct FavouriteTile: View {
    let favourite: Favourite
    var openAppOnStart: Bool
    var imageSize: CGFloat = 40
    var compact: Bool = false

    var body: some View {
        if openAppOnStart, let url = URL(string: "metic://start?profileId=\(favourite.id)") {
            Link(destination: url) { content }
        } else {
            Button(intent: StartProfileIntent(profileId: favourite.id)) { content }
                .buttonStyle(.plain)
        }
    }

    private var content: some View {
        HStack(spacing: 8) {
            ProfileImageView(favourite: favourite, size: imageSize)
            VStack(alignment: .leading, spacing: 1) {
                Text(favourite.name)
                    .font(compact ? .caption2 : .footnote).bold()
                    .lineLimit(1)
                if let sub = favouriteSubtitle(favourite) {
                    Text(sub)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(6)
        .background(.fill.quaternary, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// Hero tile — a single large favourite filling a small widget.
struct FavouriteHeroTile: View {
    let favourite: Favourite
    var openAppOnStart: Bool

    var body: some View {
        if openAppOnStart, let url = URL(string: "metic://start?profileId=\(favourite.id)") {
            Link(destination: url) { content }
        } else {
            Button(intent: StartProfileIntent(profileId: favourite.id)) { content }
                .buttonStyle(.plain)
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 6) {
            ProfileImageView(favourite: favourite, size: 56)
            Spacer(minLength: 0)
            Text(favourite.name)
                .font(.headline)
                .lineLimit(2)
            if let sub = favouriteSubtitle(favourite) {
                Text(sub)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

/// Empty-state prompt when there are no favourites yet.
struct FavouritesEmptyState: View {
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "star")
                .font(.title2)
                .foregroundStyle(.secondary)
            Text("Add favourites in Metic")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
