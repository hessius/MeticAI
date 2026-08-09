import WidgetKit
import SwiftUI

// MARK: - Timeline

struct HeroEntry: TimelineEntry {
    let date: Date
    let favourites: [Favourite]
    let openAppOnStart: Bool
}

struct HeroProvider: TimelineProvider {
    func placeholder(in context: Context) -> HeroEntry {
        HeroEntry(date: .now, favourites: [], openAppOnStart: false)
    }

    func getSnapshot(in context: Context, completion: @escaping (HeroEntry) -> Void) {
        let store = AppGroupStore()
        completion(HeroEntry(date: .now, favourites: store.favourites(),
                             openAppOnStart: store.openAppOnStart()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HeroEntry>) -> Void) {
        let store = AppGroupStore()
        let entry = HeroEntry(date: .now, favourites: store.favourites(),
                              openAppOnStart: store.openAppOnStart())
        completion(Timeline(entries: [entry], policy: .never))
    }
}

// MARK: - Views

private struct HeroWidgetView: View {
    let entry: HeroEntry
    let count: Int
    let columns: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            MeticHeader()
            grid
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .containerBackground(.fill.tertiary, for: .widget)
    }

    private func rows(_ favs: [Favourite]) -> [[Favourite]] {
        stride(from: 0, to: favs.count, by: columns).map {
            Array(favs[$0 ..< min($0 + columns, favs.count)])
        }
    }

    // Row-based layout (rather than a LazyVGrid whose cells size to their own
    // content): every row shares the remaining height equally and every card
    // fills its row, so all hero cards are the same size regardless of how long
    // their profile names are.
    @ViewBuilder private var grid: some View {
        let favs = Array(entry.favourites.prefix(count))
        if favs.isEmpty {
            FavouritesEmptyState()
        } else {
            VStack(spacing: 10) {
                ForEach(Array(rows(favs).enumerated()), id: \.offset) { _, row in
                    HStack(spacing: 10) {
                        ForEach(row) { fav in
                            FavouriteHeroTile(favourite: fav, openAppOnStart: entry.openAppOnStart,
                                              imageSize: 44, fillHeight: true)
                                .padding(10)
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                                .background(.fill.quaternary,
                                            in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                        // Keep widths consistent if the last row is short.
                        ForEach(0 ..< (columns - row.count), id: \.self) { _ in
                            Color.clear.frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

// MARK: - Widgets

struct MediumHeroWidget: Widget {
    static let kind = "MediumHeroWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: HeroProvider()) { entry in
            HeroWidgetView(entry: entry, count: 2, columns: 2)
        }
        .configurationDisplayName("Metic. Hero (2)")
        .description("Two favourites shown large.")
        .supportedFamilies([.systemMedium])
    }
}

struct LargeHeroWidget: Widget {
    static let kind = "LargeHeroWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: HeroProvider()) { entry in
            HeroWidgetView(entry: entry, count: 4, columns: 2)
        }
        .configurationDisplayName("Metic. Hero (4)")
        .description("Four favourites shown large.")
        .supportedFamilies([.systemLarge])
    }
}

// MARK: - Previews

#Preview("Medium Hero", as: .systemMedium) {
    MediumHeroWidget()
} timeline: {
    HeroEntry(date: .now, favourites: (1...2).map {
        Favourite(id: "\($0)", name: "Profile \($0)", targetTempC: 93, targetWeightG: 40)
    }, openAppOnStart: false)
}

#Preview("Large Hero", as: .systemLarge) {
    LargeHeroWidget()
} timeline: {
    HeroEntry(date: .now, favourites: (1...4).map {
        Favourite(id: "\($0)", name: "Profile \($0)", targetTempC: 93, targetWeightG: 40)
    }, openAppOnStart: false)
}
