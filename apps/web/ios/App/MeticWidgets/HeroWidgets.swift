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
        VStack(alignment: .leading, spacing: 0) {
            MeticHeader()
            Spacer(minLength: 8)
            content
            Spacer(minLength: 8)
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }

    @ViewBuilder private var content: some View {
        let favs = entry.favourites
        if favs.isEmpty {
            FavouritesEmptyState()
        } else {
            let cols = Array(repeating: GridItem(.flexible(), spacing: 10), count: columns)
            LazyVGrid(columns: cols, spacing: 10) {
                ForEach(Array(favs.prefix(count))) { fav in
                    FavouriteHeroTile(favourite: fav, openAppOnStart: entry.openAppOnStart)
                        .padding(10)
                        .background(.fill.quaternary, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
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
