import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Configuration

enum SmallStyle: String, AppEnum {
    case hero
    case grid
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Small Style"
    static var caseDisplayRepresentations: [SmallStyle: DisplayRepresentation] = [
        .hero: "Hero (single)",
        .grid: "Grid (2×2)",
    ]
}

enum LargeDensity: String, AppEnum {
    case sixUp
    case eightUp
    case tenUp
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Large Density"
    static var caseDisplayRepresentations: [LargeDensity: DisplayRepresentation] = [
        .sixUp: "6 profiles (2×3)",
        .eightUp: "8 profiles (2×4)",
        .tenUp: "10 profiles (2×5)",
    ]
}

struct FavouritesConfigIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Favourite Profiles"
    static var description = IntentDescription("Start a favourite profile from the home screen.")

    @Parameter(title: "Small style", default: .hero) var smallStyle: SmallStyle
    @Parameter(title: "Large density", default: .tenUp) var largeDensity: LargeDensity
}

// MARK: - Timeline

struct FavouritesEntry: TimelineEntry {
    let date: Date
    let favourites: [Favourite]
    let openAppOnStart: Bool
    let config: FavouritesConfigIntent
}

struct FavouritesProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> FavouritesEntry {
        FavouritesEntry(date: .now, favourites: [], openAppOnStart: false, config: FavouritesConfigIntent())
    }

    func snapshot(for config: FavouritesConfigIntent, in context: Context) async -> FavouritesEntry {
        let store = AppGroupStore()
        return FavouritesEntry(date: .now, favourites: store.favourites(),
                               openAppOnStart: store.openAppOnStart(), config: config)
    }

    func timeline(for config: FavouritesConfigIntent, in context: Context) async -> Timeline<FavouritesEntry> {
        let store = AppGroupStore()
        let entry = FavouritesEntry(date: .now, favourites: store.favourites(),
                                    openAppOnStart: store.openAppOnStart(), config: config)
        return Timeline(entries: [entry], policy: .never)
    }
}

// MARK: - Views

struct FavouritesWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: FavouritesEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            MeticHeader()
            Spacer(minLength: 6)
            content
            Spacer(minLength: 6)
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }

    @ViewBuilder private var content: some View {
        let favs = entry.favourites
        if favs.isEmpty {
            FavouritesEmptyState()
        } else {
            switch family {
            case .systemSmall:
                if entry.config.smallStyle == .hero {
                    FavouriteHeroTile(favourite: favs[0], openAppOnStart: entry.openAppOnStart)
                } else {
                    grid(Array(favs.prefix(4)), columns: 2, compact: true)
                }
            case .systemMedium:
                grid(Array(favs.prefix(4)), columns: 2, compact: false)
            case .systemLarge:
                grid(Array(favs.prefix(largeCount)), columns: 2,
                     compact: entry.config.largeDensity == .tenUp)
            default:
                grid(Array(favs.prefix(4)), columns: 2, compact: false)
            }
        }
    }

    private var largeCount: Int {
        switch entry.config.largeDensity {
        case .sixUp: return 6
        case .eightUp: return 8
        case .tenUp: return 10
        }
    }

    private func grid(_ favs: [Favourite], columns: Int, compact: Bool) -> some View {
        let cols = Array(repeating: GridItem(.flexible(), spacing: 6), count: columns)
        return LazyVGrid(columns: cols, spacing: 6) {
            ForEach(favs) { fav in
                FavouriteTile(favourite: fav, openAppOnStart: entry.openAppOnStart,
                              imageSize: compact ? 28 : 34, compact: compact)
            }
        }
    }
}

// MARK: - Widget

struct FavouriteProfilesWidget: Widget {
    static let kind = "FavouriteProfilesWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: Self.kind,
                               intent: FavouritesConfigIntent.self,
                               provider: FavouritesProvider()) { entry in
            FavouritesWidgetView(entry: entry)
        }
        .configurationDisplayName("Metic. Favourites")
        .description("Start a favourite profile from the home screen.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

// MARK: - Previews

#Preview("Small · Hero", as: .systemSmall) {
    FavouriteProfilesWidget()
} timeline: {
    FavouritesEntry(date: .now, favourites: [
        Favourite(id: "1", name: "Slow-Mo Blossom", targetTempC: 92, targetWeightG: 36),
    ], openAppOnStart: false, config: FavouritesConfigIntent())
}

#Preview("Large · 6", as: .systemLarge) {
    FavouriteProfilesWidget()
} timeline: {
    FavouritesEntry(date: .now, favourites: (1...6).map {
        Favourite(id: "\($0)", name: "Profile \($0)", targetTempC: 93, targetWeightG: 40)
    }, openAppOnStart: false, config: FavouritesConfigIntent())
}
