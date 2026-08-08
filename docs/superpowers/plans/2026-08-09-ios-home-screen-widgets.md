# iOS Home-Screen Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add iOS 17+ home-screen widgets (Favourite Profiles + Control Center) that start profiles and fire machine controls in the background over the LAN, backed by a new in-app Favourites concept and a `metic://` deep-link scheme.

**Architecture:** Three dependent phases. **Phase A** adds an in-app Favourites feature in shared TS (works in all runtimes, ships value on its own). **Phase B** adds the `metic://` deep-link handler, a `WidgetBridge` Capacitor plugin that mirrors favourites/machine-URL/settings into the shared App Group, an iOS-gated `useWidgetSync`, and the settings toggle. **Phase C** adds the native `MeticWidgets` WidgetKit extension (SwiftUI + App Intents + a direct-LAN `MachineClient`) that reads the App Group and talks to the machine.

**Tech Stack:** React + TypeScript (Vitest, react-i18next), Capacitor 7 (custom Swift plugin), Swift/SwiftUI, WidgetKit, App Intents, XCTest. Server backend is TypeScript (`apps/bun-server`) — **there is no Python on this branch**, and widgets have no server counterpart, so there is zero backend parity work.

**Spec:** `docs/superpowers/specs/2026-08-09-ios-home-screen-widgets-design.md`

**Conventions:** All user-facing web strings via `t()` and added to all 6 locales (`en, sv, de, es, fr, it`) under `apps/web/public/locales/{locale}/translation.json`. New code must include tests (success + edge paths). Conventional Commits with the `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` trailer.

**Test command (TS):** from `apps/web/`: `bunx vitest run <path>`.

---

## File Structure

**Phase A — Favourites (shared TS)**
- Create: `apps/web/src/services/favourites/favouritesStore.ts` — pure storage/logic (load/save/toggle/reorder/cap). One responsibility: favourites persistence + list ops.
- Create: `apps/web/src/services/favourites/favouritesStore.test.ts`
- Create: `apps/web/src/hooks/useFavourites.ts` — React binding over the store + change events.
- Create: `apps/web/src/hooks/useFavourites.test.ts`
- Modify: `apps/web/src/lib/constants.ts` — add `STORAGE_KEYS.FAVOURITES` + `FAVOURITES_CHANGED` event name.
- Modify: `apps/web/src/components/ProfileCatalogueView.tsx` — star toggle in `renderProfileCard`, a pinned Favourites section.
- Modify: `apps/web/public/locales/{en,sv,de,es,fr,it}/translation.json` — `favourites.*` keys.

**Phase B — Bridge + deep links + sync + settings**
- Create: `apps/web/src/services/widgets/deepLink.ts` — pure `metic://` parser.
- Create: `apps/web/src/services/widgets/deepLink.test.ts`
- Create: `apps/web/src/services/widgets/deepLinkHandler.ts` — dispatch a parsed deep link into `MachineService`.
- Create: `apps/web/src/services/widgets/deepLinkHandler.test.ts`
- Create: `apps/web/src/services/widgets/widgetBridge.ts` — `registerPlugin` typed interface + web no-op stub.
- Create: `apps/web/src/hooks/useWidgetSync.ts` — iOS-gated mirror into the bridge.
- Create: `apps/web/src/hooks/useWidgetSync.test.ts`
- Modify: `apps/web/src/App.tsx` — mount the `appUrlOpen` listener + `useWidgetSync()`.
- Create: `apps/web/ios/App/App/WidgetBridgePlugin.swift` — App-Group writes + image caching + `WidgetCenter` reload.
- Modify: `apps/web/ios/App/App/MeticulousViewController.swift` — register `WidgetBridgePlugin`.
- Create/Modify: `apps/web/ios/App/App/App.entitlements` — add App Group to the main app target.
- Modify: `apps/web/src/components/SettingsView.tsx` — iOS-only `openAppOnStart` toggle.
- Modify: `apps/web/public/locales/{6}/translation.json` — `settings.widgets.*` keys.

**Phase C — Native widget extension (Swift)**
- Create target `MeticWidgets` under `apps/web/ios/App/` with:
  - `MeticWidgets/MeticWidgetsBundle.swift`
  - `MeticWidgets/Info.plist`, `MeticWidgets/MeticWidgets.entitlements`
  - `MeticWidgets/FavouriteProfilesWidget.swift`
  - `MeticWidgets/ControlCenterWidget.swift`
  - `MeticWidgets/Intents/*.swift`
- Create shared `MeticKit/` sources compiled into the extension:
  - `MeticKit/AppGroup.swift` (keys + `AppGroupStore` read/write)
  - `MeticKit/Models.swift` (`Favourite`, `MachineSnapshot`, `MachineAction`)
  - `MeticKit/MachineClient.swift` (direct-LAN HTTP)
- Create XCTest target `MeticWidgetsTests` with `AppGroupStoreTests.swift`, `MachineClientTests.swift`.

---

## PHASE A — In-app Favourites (shared TS)

Ships a working, testable Favourites feature independent of any widget.

### Task A1: Favourites constants + store

**Files:**
- Modify: `apps/web/src/lib/constants.ts`
- Create: `apps/web/src/services/favourites/favouritesStore.ts`
- Test: `apps/web/src/services/favourites/favouritesStore.test.ts`

- [ ] **Step 1: Add constants**

In `apps/web/src/lib/constants.ts`, inside the `STORAGE_KEYS` object add after the `MACHINE_URL` line:

```ts
  // -- Favourites (#widgets) --
  FAVOURITES: 'meticai-favourites',
```

Then, near the other exported event-name constants at module scope (top level of the file), add:

```ts
/** Dispatched on window when the favourites list changes. */
export const FAVOURITES_CHANGED = 'favourites-changed'

/** Maximum number of favourites (bounds App-Group storage for widgets). */
export const FAVOURITES_MAX = 12
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/services/favourites/favouritesStore.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Favourite } from './favouritesStore'
import {
  loadFavourites,
  saveFavourites,
  toggleFavourite,
  reorderFavourites,
  isFavourite,
} from './favouritesStore'

// In-memory storage mock shared by the module under test.
const mem = new Map<string, string>()
vi.mock('@/services/storage/CapacitorStorage', () => ({
  capacitorStorage: {
    get: vi.fn(async (k: string) => (mem.has(k) ? mem.get(k)! : null)),
    set: vi.fn(async (k: string, v: string) => { mem.set(k, v) }),
    remove: vi.fn(async (k: string) => { mem.delete(k) }),
  },
}))

const fav = (id: string, name = id): Favourite => ({ id, name })

describe('favouritesStore', () => {
  beforeEach(() => { mem.clear() })

  it('returns [] when nothing stored', async () => {
    expect(await loadFavourites()).toEqual([])
  })

  it('round-trips saved favourites', async () => {
    await saveFavourites([fav('a'), fav('b')])
    expect((await loadFavourites()).map(f => f.id)).toEqual(['a', 'b'])
  })

  it('toggle adds when absent and removes when present', async () => {
    let list = await toggleFavourite(fav('a'))
    expect(list.map(f => f.id)).toEqual(['a'])
    list = await toggleFavourite(fav('a'))
    expect(list).toEqual([])
  })

  it('caps the list at FAVOURITES_MAX, dropping the oldest', async () => {
    for (let i = 0; i < 15; i++) await toggleFavourite(fav(`p${i}`))
    const list = await loadFavourites()
    expect(list).toHaveLength(12)
    expect(list[0].id).toBe('p3') // p0..p2 dropped
    expect(list[11].id).toBe('p14')
  })

  it('isFavourite reflects membership', async () => {
    await toggleFavourite(fav('a'))
    expect(await isFavourite('a')).toBe(true)
    expect(await isFavourite('z')).toBe(false)
  })

  it('reorder applies a new id order and ignores unknown ids', async () => {
    await saveFavourites([fav('a'), fav('b'), fav('c')])
    const list = await reorderFavourites(['c', 'a', 'b', 'zzz'])
    expect(list.map(f => f.id)).toEqual(['c', 'a', 'b'])
  })

  it('ignores corrupt JSON and returns []', async () => {
    mem.set('meticai-favourites', '{not json')
    expect(await loadFavourites()).toEqual([])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/web && bunx vitest run src/services/favourites/favouritesStore.test.ts`
Expected: FAIL — module `./favouritesStore` not found.

- [ ] **Step 4: Implement the store**

Create `apps/web/src/services/favourites/favouritesStore.ts`:

```ts
import { capacitorStorage } from '@/services/storage/CapacitorStorage'
import { STORAGE_KEYS, FAVOURITES_MAX, FAVOURITES_CHANGED } from '@/lib/constants'

export interface Favourite {
  id: string
  name: string
  /** Target temperature (°C) captured at favourite time, when known. */
  targetTempC?: number
  /** Target/final weight (g) captured at favourite time, when known. */
  targetWeightG?: number
  /** Source image URL/data URI (resolved). Native caches this for widgets. */
  imageUrl?: string
}

function emitChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(FAVOURITES_CHANGED))
  }
}

export async function loadFavourites(): Promise<Favourite[]> {
  const raw = await capacitorStorage.get(STORAGE_KEYS.FAVOURITES)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (f): f is Favourite => !!f && typeof f.id === 'string' && typeof f.name === 'string',
    )
  } catch {
    return []
  }
}

export async function saveFavourites(list: Favourite[]): Promise<Favourite[]> {
  const capped = list.slice(-FAVOURITES_MAX)
  await capacitorStorage.set(STORAGE_KEYS.FAVOURITES, JSON.stringify(capped))
  emitChanged()
  return capped
}

export async function isFavourite(id: string): Promise<boolean> {
  return (await loadFavourites()).some(f => f.id === id)
}

export async function toggleFavourite(fav: Favourite): Promise<Favourite[]> {
  const list = await loadFavourites()
  const idx = list.findIndex(f => f.id === fav.id)
  const next = idx >= 0
    ? list.filter(f => f.id !== fav.id)
    : [...list, fav]
  return saveFavourites(next)
}

export async function reorderFavourites(orderedIds: string[]): Promise<Favourite[]> {
  const list = await loadFavourites()
  const byId = new Map(list.map(f => [f.id, f]))
  const next = orderedIds
    .map(id => byId.get(id))
    .filter((f): f is Favourite => !!f)
  return saveFavourites(next)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && bunx vitest run src/services/favourites/favouritesStore.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/constants.ts apps/web/src/services/favourites/
git commit -m "feat(favourites): add favourites store and constants

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task A2: `useFavourites` hook

**Files:**
- Create: `apps/web/src/hooks/useFavourites.ts`
- Test: `apps/web/src/hooks/useFavourites.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/hooks/useFavourites.test.ts`:

```ts
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mem = new Map<string, string>()
vi.mock('@/services/storage/CapacitorStorage', () => ({
  capacitorStorage: {
    get: vi.fn(async (k: string) => (mem.has(k) ? mem.get(k)! : null)),
    set: vi.fn(async (k: string, v: string) => { mem.set(k, v) }),
    remove: vi.fn(async (k: string) => { mem.delete(k) }),
  },
}))

import { useFavourites } from './useFavourites'

describe('useFavourites', () => {
  beforeEach(() => { mem.clear() })

  it('loads empty then reflects a toggle', async () => {
    const { result } = renderHook(() => useFavourites())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.favourites).toEqual([])

    await act(async () => { await result.current.toggle({ id: 'a', name: 'Alpha' }) })
    await waitFor(() => expect(result.current.favourites.map(f => f.id)).toEqual(['a']))
    expect(result.current.isFavourite('a')).toBe(true)
  })

  it('two hook instances stay in sync via the change event', async () => {
    const h1 = renderHook(() => useFavourites())
    const h2 = renderHook(() => useFavourites())
    await waitFor(() => expect(h1.result.current.loading).toBe(false))
    await waitFor(() => expect(h2.result.current.loading).toBe(false))

    await act(async () => { await h1.result.current.toggle({ id: 'x', name: 'X' }) })
    await waitFor(() => expect(h2.result.current.isFavourite('x')).toBe(true))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && bunx vitest run src/hooks/useFavourites.test.ts`
Expected: FAIL — `./useFavourites` not found.

- [ ] **Step 3: Implement the hook**

Create `apps/web/src/hooks/useFavourites.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import {
  type Favourite,
  loadFavourites,
  toggleFavourite,
  reorderFavourites,
} from '@/services/favourites/favouritesStore'
import { FAVOURITES_CHANGED } from '@/lib/constants'

export function useFavourites() {
  const [favourites, setFavourites] = useState<Favourite[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setFavourites(await loadFavourites())
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    const onChange = () => { refresh() }
    window.addEventListener(FAVOURITES_CHANGED, onChange)
    return () => window.removeEventListener(FAVOURITES_CHANGED, onChange)
  }, [refresh])

  const toggle = useCallback(async (fav: Favourite) => {
    setFavourites(await toggleFavourite(fav))
  }, [])

  const reorder = useCallback(async (orderedIds: string[]) => {
    setFavourites(await reorderFavourites(orderedIds))
  }, [])

  const isFavourite = useCallback(
    (id: string) => favourites.some(f => f.id === id),
    [favourites],
  )

  return { favourites, loading, toggle, reorder, isFavourite, refresh }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && bunx vitest run src/hooks/useFavourites.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useFavourites.ts apps/web/src/hooks/useFavourites.test.ts
git commit -m "feat(favourites): add useFavourites hook

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task A3: Star toggle + Favourites section in the catalogue + i18n

**Files:**
- Modify: `apps/web/src/components/ProfileCatalogueView.tsx` (star button in `renderProfileCard` @ line ~512; pinned Favourites section)
- Modify: `apps/web/public/locales/{en,sv,de,es,fr,it}/translation.json`

- [ ] **Step 1: Add i18n keys (all 6 locales)**

Add a top-level `favourites` section. English (`en/translation.json`):

```json
  "favourites": {
    "sectionTitle": "Favourites",
    "add": "Add to favourites",
    "remove": "Remove from favourites",
    "empty": "Star a profile to add it to your favourites."
  },
```

`sv`:
```json
  "favourites": {
    "sectionTitle": "Favoriter",
    "add": "Lägg till i favoriter",
    "remove": "Ta bort från favoriter",
    "empty": "Stjärnmärk en profil för att lägga till den bland dina favoriter."
  },
```

`de`:
```json
  "favourites": {
    "sectionTitle": "Favoriten",
    "add": "Zu Favoriten hinzufügen",
    "remove": "Aus Favoriten entfernen",
    "empty": "Markiere ein Profil mit einem Stern, um es zu deinen Favoriten hinzuzufügen."
  },
```

`es`:
```json
  "favourites": {
    "sectionTitle": "Favoritos",
    "add": "Añadir a favoritos",
    "remove": "Quitar de favoritos",
    "empty": "Marca un perfil con una estrella para añadirlo a tus favoritos."
  },
```

`fr`:
```json
  "favourites": {
    "sectionTitle": "Favoris",
    "add": "Ajouter aux favoris",
    "remove": "Retirer des favoris",
    "empty": "Ajoutez une étoile à un profil pour l'ajouter à vos favoris."
  },
```

`it`:
```json
  "favourites": {
    "sectionTitle": "Preferiti",
    "add": "Aggiungi ai preferiti",
    "remove": "Rimuovi dai preferiti",
    "empty": "Aggiungi una stella a un profilo per inserirlo nei preferiti."
  },
```

- [ ] **Step 2: Verify i18n JSON validity**

Run: `cd apps/web && for l in en sv de es fr it; do node -e "JSON.parse(require('fs').readFileSync('public/locales/$l/translation.json','utf8'))" && echo "$l ok"; done`
Expected: `en ok` … `it ok` (all six).

- [ ] **Step 3: Add the star toggle to `renderProfileCard`**

In `apps/web/src/components/ProfileCatalogueView.tsx`:

Add imports near the top (with the other hook/icon imports):

```tsx
import { Star } from '@phosphor-icons/react'
import { useFavourites } from '@/hooks/useFavourites'
import { getProfileImageValue, resolveDisplayImage } from '@/hooks/useProfileImageSrc'
```

Inside the component body (near other hooks), add:

```tsx
  const { favourites, toggle: toggleFav, isFavourite } = useFavourites()
```

In `renderProfileCard(profile, draggable)`, add a star button. Place it in the card's action row (next to the existing rename/actions). Use `stopPropagation` so tapping the star does not open the profile:

```tsx
  <button
    type="button"
    aria-label={isFavourite(profile.id) ? t('favourites.remove') : t('favourites.add')}
    aria-pressed={isFavourite(profile.id)}
    className="p-2 rounded-md hover:bg-accent/50 transition-colors"
    onClick={(e) => {
      e.stopPropagation()
      toggleFav({
        id: profile.id,
        name: profile.name,
        imageUrl: resolveDisplayImage(getProfileImageValue(profile as unknown as { image?: string | null }), undefined) ?? undefined,
      })
    }}
  >
    <Star size={20} weight={isFavourite(profile.id) ? 'fill' : 'regular'} />
  </button>
```

> Note: `targetTempC`/`targetWeightG` are best-effort. If the `profile` object exposes them (e.g. `final_weight`, a temperature field), include them in the `toggleFav({...})` payload. Missing values are fine — the widget renders name + image and omits absent metrics.

- [ ] **Step 4: Add a pinned Favourites section**

Above the main profile list render, add a section that lists the favourites (reusing `renderProfileCard` where a matching `MachineProfile` exists in the loaded `profiles`):

```tsx
  {favourites.length > 0 && (
    <section aria-label={t('favourites.sectionTitle')} className="mb-4">
      <h2 className="text-sm font-semibold text-muted-foreground mb-2 px-1">
        {t('favourites.sectionTitle')}
      </h2>
      <div className="space-y-2">
        {favourites
          .map(f => profiles.find(p => p.id === f.id))
          .filter((p): p is MachineProfile => !!p)
          .map(p => renderProfileCard(p, false))}
      </div>
    </section>
  )}
```

> If `renderProfileCard` requires unique React keys and the same profile can appear in both the favourites section and the main list, wrap each rendered card in a keyed fragment: `<React.Fragment key={`fav-${p.id}`}>{renderProfileCard(p, false)}</React.Fragment>`.

- [ ] **Step 5: Typecheck + run catalogue-adjacent tests**

Run: `cd apps/web && bunx tsc --noEmit && bunx vitest run src/hooks/useFavourites.test.ts src/services/favourites/favouritesStore.test.ts`
Expected: no type errors; favourites tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ProfileCatalogueView.tsx apps/web/public/locales
git commit -m "feat(favourites): star toggle and favourites section in catalogue

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## PHASE B — Deep links, bridge, sync, settings

Leaves the JS↔native plumbing working and testable. Native pieces gated to iOS.

### Task B1: `metic://` deep-link parser

**Files:**
- Create: `apps/web/src/services/widgets/deepLink.ts`
- Test: `apps/web/src/services/widgets/deepLink.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/services/widgets/deepLink.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseMeticDeepLink } from './deepLink'

describe('parseMeticDeepLink', () => {
  it('parses a start link with a profileId', () => {
    expect(parseMeticDeepLink('metic://start?profileId=abc123'))
      .toEqual({ action: 'start', profileId: 'abc123' })
  })

  it('url-decodes the profileId', () => {
    expect(parseMeticDeepLink('metic://start?profileId=a%20b'))
      .toEqual({ action: 'start', profileId: 'a b' })
  })

  it('parses a bare open link', () => {
    expect(parseMeticDeepLink('metic://open')).toEqual({ action: 'open' })
  })

  it('returns null for a start link without profileId', () => {
    expect(parseMeticDeepLink('metic://start')).toBeNull()
  })

  it('returns null for the wrong scheme', () => {
    expect(parseMeticDeepLink('https://start?profileId=x')).toBeNull()
  })

  it('returns null for an unknown host', () => {
    expect(parseMeticDeepLink('metic://frobnicate')).toBeNull()
  })

  it('returns null for garbage input', () => {
    expect(parseMeticDeepLink('not a url')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && bunx vitest run src/services/widgets/deepLink.test.ts`
Expected: FAIL — `./deepLink` not found.

- [ ] **Step 3: Implement the parser**

Create `apps/web/src/services/widgets/deepLink.ts`:

```ts
export type MeticDeepLink =
  | { action: 'start'; profileId: string }
  | { action: 'open' }

export function parseMeticDeepLink(url: string): MeticDeepLink | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'metic:') return null

  // For custom schemes, the "host" is the first path segment (e.g. metic://start).
  const host = parsed.host || parsed.pathname.replace(/^\/+/, '').split('/')[0]

  switch (host) {
    case 'start': {
      const profileId = parsed.searchParams.get('profileId')
      return profileId ? { action: 'start', profileId } : null
    }
    case 'open':
      return { action: 'open' }
    default:
      return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && bunx vitest run src/services/widgets/deepLink.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/widgets/deepLink.ts apps/web/src/services/widgets/deepLink.test.ts
git commit -m "feat(widgets): add metic:// deep-link parser

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task B2: Deep-link dispatcher into MachineService

**Files:**
- Create: `apps/web/src/services/widgets/deepLinkHandler.ts`
- Test: `apps/web/src/services/widgets/deepLinkHandler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/services/widgets/deepLinkHandler.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { handleMeticDeepLink } from './deepLinkHandler'

function makeMachine() {
  return {
    loadProfile: vi.fn(async () => ({ ok: true })),
    startShot: vi.fn(async () => ({ ok: true })),
  }
}

describe('handleMeticDeepLink', () => {
  it('loads then starts on a start link, resolving id to a profile name', async () => {
    const machine = makeMachine()
    const lookupName = vi.fn(async (id: string) => (id === 'abc' ? 'Slow-Mo Blossom' : null))

    const result = await handleMeticDeepLink('metic://start?profileId=abc', { machine, lookupName })

    expect(result).toBe('started')
    expect(lookupName).toHaveBeenCalledWith('abc')
    expect(machine.loadProfile).toHaveBeenCalledWith('Slow-Mo Blossom')
    expect(machine.startShot).toHaveBeenCalledTimes(1)
    // load must precede start
    expect(machine.loadProfile.mock.invocationCallOrder[0])
      .toBeLessThan(machine.startShot.mock.invocationCallOrder[0])
  })

  it('does not start when the profile id cannot be resolved', async () => {
    const machine = makeMachine()
    const lookupName = vi.fn(async () => null)
    const result = await handleMeticDeepLink('metic://start?profileId=nope', { machine, lookupName })
    expect(result).toBe('profile-not-found')
    expect(machine.startShot).not.toHaveBeenCalled()
  })

  it('returns "opened" for a bare open link without touching the machine', async () => {
    const machine = makeMachine()
    const result = await handleMeticDeepLink('metic://open', { machine, lookupName: vi.fn() })
    expect(result).toBe('opened')
    expect(machine.loadProfile).not.toHaveBeenCalled()
  })

  it('returns "ignored" for a non-metic url', async () => {
    const machine = makeMachine()
    const result = await handleMeticDeepLink('https://example.com', { machine, lookupName: vi.fn() })
    expect(result).toBe('ignored')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && bunx vitest run src/services/widgets/deepLinkHandler.test.ts`
Expected: FAIL — `./deepLinkHandler` not found.

- [ ] **Step 3: Implement the dispatcher**

Create `apps/web/src/services/widgets/deepLinkHandler.ts`:

```ts
import { parseMeticDeepLink } from './deepLink'

export type DeepLinkResult =
  | 'started'
  | 'profile-not-found'
  | 'opened'
  | 'ignored'

interface MachineLike {
  loadProfile: (name: string) => Promise<unknown>
  startShot: () => Promise<unknown>
}

interface HandlerDeps {
  machine: MachineLike
  /** Resolve a machine profile id to the name loadProfile expects. */
  lookupName: (profileId: string) => Promise<string | null>
}

export async function handleMeticDeepLink(
  url: string,
  { machine, lookupName }: HandlerDeps,
): Promise<DeepLinkResult> {
  const link = parseMeticDeepLink(url)
  if (!link) return 'ignored'
  if (link.action === 'open') return 'opened'

  const name = await lookupName(link.profileId)
  if (!name) return 'profile-not-found'

  await machine.loadProfile(name)
  await machine.startShot()
  return 'started'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && bunx vitest run src/services/widgets/deepLinkHandler.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/widgets/deepLinkHandler.ts apps/web/src/services/widgets/deepLinkHandler.test.ts
git commit -m "feat(widgets): dispatch metic:// deep links into the machine service

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task B3: WidgetBridge TS interface + `useWidgetSync`

**Files:**
- Create: `apps/web/src/services/widgets/widgetBridge.ts`
- Create: `apps/web/src/hooks/useWidgetSync.ts`
- Test: `apps/web/src/hooks/useWidgetSync.test.ts`

- [ ] **Step 1: Implement the bridge interface (no test — thin declaration)**

Create `apps/web/src/services/widgets/widgetBridge.ts`:

```ts
import { registerPlugin } from '@capacitor/core'
import type { Favourite } from '@/services/favourites/favouritesStore'

export interface WidgetBridgePlugin {
  setFavourites(options: { favourites: Favourite[] }): Promise<void>
  setMachineUrl(options: { url: string }): Promise<void>
  setOpenAppOnStart(options: { enabled: boolean }): Promise<void>
  reloadWidgets(): Promise<void>
}

/**
 * On iOS the native `WidgetBridge` plugin is registered in
 * MeticulousViewController. On web/Android the methods resolve to no-ops
 * (registerPlugin returns a proxy that rejects, so we wrap defensively in
 * useWidgetSync via the iOS gate).
 */
export const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge')
```

- [ ] **Step 2: Write the failing test for the sync hook**

Create `apps/web/src/hooks/useWidgetSync.test.ts`:

```ts
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const setFavourites = vi.fn(async () => {})
const setMachineUrl = vi.fn(async () => {})
const setOpenAppOnStart = vi.fn(async () => {})
const reloadWidgets = vi.fn(async () => {})
vi.mock('@/services/widgets/widgetBridge', () => ({
  WidgetBridge: { setFavourites, setMachineUrl, setOpenAppOnStart, reloadWidgets },
}))

const getPlatform = vi.fn(() => 'ios')
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => getPlatform() } }))

vi.mock('@/services/favourites/favouritesStore', () => ({
  loadFavourites: vi.fn(async () => [{ id: 'a', name: 'Alpha' }]),
}))
vi.mock('@/services/machine/machineUrl', () => ({
  resolveMachineUrl: vi.fn(async () => 'http://machine.local:8080'),
  MACHINE_URL_CHANGED: 'machine-url-changed',
}))

import { useWidgetSync } from './useWidgetSync'

describe('useWidgetSync', () => {
  beforeEach(() => {
    setFavourites.mockClear(); setMachineUrl.mockClear()
    setOpenAppOnStart.mockClear(); reloadWidgets.mockClear()
    getPlatform.mockReturnValue('ios')
  })

  it('mirrors favourites + machine url on mount and reloads widgets (iOS)', async () => {
    renderHook(() => useWidgetSync({ openAppOnStart: false }))
    await waitFor(() => expect(setFavourites).toHaveBeenCalled())
    expect(setFavourites).toHaveBeenCalledWith({ favourites: [{ id: 'a', name: 'Alpha' }] })
    expect(setMachineUrl).toHaveBeenCalledWith({ url: 'http://machine.local:8080' })
    expect(setOpenAppOnStart).toHaveBeenCalledWith({ enabled: false })
    expect(reloadWidgets).toHaveBeenCalled()
  })

  it('is a no-op off iOS', async () => {
    getPlatform.mockReturnValue('android')
    renderHook(() => useWidgetSync({ openAppOnStart: true }))
    await new Promise(r => setTimeout(r, 20))
    expect(setFavourites).not.toHaveBeenCalled()
    expect(reloadWidgets).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/web && bunx vitest run src/hooks/useWidgetSync.test.ts`
Expected: FAIL — `./useWidgetSync` not found.

- [ ] **Step 4: Implement the sync hook**

Create `apps/web/src/hooks/useWidgetSync.ts`:

```ts
import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { WidgetBridge } from '@/services/widgets/widgetBridge'
import { loadFavourites } from '@/services/favourites/favouritesStore'
import { resolveMachineUrl, MACHINE_URL_CHANGED } from '@/services/machine/machineUrl'
import { FAVOURITES_CHANGED } from '@/lib/constants'

interface Options {
  openAppOnStart: boolean
}

export function useWidgetSync({ openAppOnStart }: Options): void {
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'ios') return

    let cancelled = false

    const pushFavourites = async () => {
      const favourites = await loadFavourites()
      if (cancelled) return
      await WidgetBridge.setFavourites({ favourites })
      await WidgetBridge.reloadWidgets()
    }

    const pushMachineUrl = async () => {
      const url = await resolveMachineUrl()
      if (cancelled) return
      await WidgetBridge.setMachineUrl({ url })
      await WidgetBridge.reloadWidgets()
    }

    // Initial mirror.
    pushFavourites()
    pushMachineUrl()
    WidgetBridge.setOpenAppOnStart({ enabled: openAppOnStart }).catch(() => {})

    window.addEventListener(FAVOURITES_CHANGED, pushFavourites)
    window.addEventListener(MACHINE_URL_CHANGED, pushMachineUrl)
    return () => {
      cancelled = true
      window.removeEventListener(FAVOURITES_CHANGED, pushFavourites)
      window.removeEventListener(MACHINE_URL_CHANGED, pushMachineUrl)
    }
  }, [openAppOnStart])
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && bunx vitest run src/hooks/useWidgetSync.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/services/widgets/widgetBridge.ts apps/web/src/hooks/useWidgetSync.ts apps/web/src/hooks/useWidgetSync.test.ts
git commit -m "feat(widgets): add WidgetBridge interface and iOS-gated useWidgetSync

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task B4: Mount deep-link listener + sync in App.tsx

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Add the `appUrlOpen` listener + sync mount**

In `apps/web/src/App.tsx`, near the existing Capacitor plugin hooks (see the "Capacitor plugin hooks" comments around lines 79/152), add an effect:

```tsx
  useEffect(() => {
    let remove: (() => void) | undefined
    import('@capacitor/app').then(({ App: CapApp }) => {
      CapApp.addListener('appUrlOpen', async ({ url }) => {
        const { handleMeticDeepLink } = await import('@/services/widgets/deepLinkHandler')
        await handleMeticDeepLink(url, {
          machine,               // existing MachineService instance in scope
          lookupName: async (id) => {
            // Reuse the existing direct-mode profile lookup already present in App.tsx
            // (see the "look up profile from the machine's profile list" path ~line 1013).
            const profile = await lookupProfileById(id)
            return profile?.name ?? null
          },
        })
      }).then((handle) => { remove = () => handle.remove() })
    })
    return () => { remove?.() }
  }, [])
```

> Wire `machine` and `lookupProfileById` to the identifiers already used in `App.tsx`. If no `lookupProfileById` helper exists, extract the existing inline lookup (~line 1013, "look up profile from the machine's profile list") into a small local async function and reuse it here. Do not duplicate the lookup logic.

Then mount the sync hook, reading the persisted `openAppOnStart` setting (add local state that loads it from `capacitorStorage` using the key defined in Task B5):

```tsx
  useWidgetSync({ openAppOnStart })
```

Add the import: `import { useWidgetSync } from '@/hooks/useWidgetSync'`.

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(widgets): handle metic:// deep links and mount widget sync in App

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task B5: Settings toggle (iOS-only) for `openAppOnStart`

**Files:**
- Modify: `apps/web/src/lib/constants.ts`
- Modify: `apps/web/src/components/SettingsView.tsx`
- Modify: `apps/web/public/locales/{6}/translation.json`

- [ ] **Step 1: Add the storage key**

In `apps/web/src/lib/constants.ts`, inside `STORAGE_KEYS`, add:

```ts
  OPEN_APP_ON_START: 'meticai-open-app-on-start',
```

- [ ] **Step 2: Add i18n keys (all 6 locales)**

Under the existing `settings` section, add a `widgets` sub-object. English:

```json
    "widgets": {
      "sectionTitle": "Home-screen widgets",
      "openAppOnStart": "Open Metic when starting a shot from a widget",
      "openAppOnStartHint": "When off, starting a profile from a widget runs in the background without opening the app."
    },
```

`sv`:
```json
    "widgets": {
      "sectionTitle": "Widgetar på hemskärmen",
      "openAppOnStart": "Öppna Metic när en shot startas från en widget",
      "openAppOnStartHint": "När detta är av startas en profil från en widget i bakgrunden utan att appen öppnas."
    },
```

`de`:
```json
    "widgets": {
      "sectionTitle": "Home-Bildschirm-Widgets",
      "openAppOnStart": "Metic öffnen, wenn ein Bezug über ein Widget gestartet wird",
      "openAppOnStartHint": "Wenn deaktiviert, wird ein Profil über ein Widget im Hintergrund gestartet, ohne die App zu öffnen."
    },
```

`es`:
```json
    "widgets": {
      "sectionTitle": "Widgets de la pantalla de inicio",
      "openAppOnStart": "Abrir Metic al iniciar una extracción desde un widget",
      "openAppOnStartHint": "Cuando está desactivado, iniciar un perfil desde un widget se ejecuta en segundo plano sin abrir la app."
    },
```

`fr`:
```json
    "widgets": {
      "sectionTitle": "Widgets de l'écran d'accueil",
      "openAppOnStart": "Ouvrir Metic au démarrage d'une extraction depuis un widget",
      "openAppOnStartHint": "Lorsque désactivé, démarrer un profil depuis un widget s'exécute en arrière-plan sans ouvrir l'application."
    },
```

`it`:
```json
    "widgets": {
      "sectionTitle": "Widget della schermata Home",
      "openAppOnStart": "Apri Metic quando avvii un'erogazione da un widget",
      "openAppOnStartHint": "Quando disattivato, avviare un profilo da un widget viene eseguito in background senza aprire l'app."
    },
```

- [ ] **Step 3: Validate all 6 locale JSON files**

Run: `cd apps/web && for l in en sv de es fr it; do node -e "JSON.parse(require('fs').readFileSync('public/locales/$l/translation.json','utf8'))" && echo "$l ok"; done`
Expected: all six `ok`.

- [ ] **Step 4: Add the iOS-only toggle in SettingsView**

In `apps/web/src/components/SettingsView.tsx`, add near the other imports:

```tsx
import { Capacitor } from '@capacitor/core'
import { capacitorStorage } from '@/services/storage/CapacitorStorage'
import { STORAGE_KEYS } from '@/lib/constants'
import { WidgetBridge } from '@/services/widgets/widgetBridge'
```

Add state + load/persist logic in the component:

```tsx
  const [openAppOnStart, setOpenAppOnStart] = useState(false)
  const isIOS = Capacitor.getPlatform() === 'ios'

  useEffect(() => {
    if (!isIOS) return
    capacitorStorage.get(STORAGE_KEYS.OPEN_APP_ON_START)
      .then(v => setOpenAppOnStart(v === 'true'))
  }, [isIOS])

  const handleOpenAppOnStart = async (enabled: boolean) => {
    setOpenAppOnStart(enabled)
    await capacitorStorage.set(STORAGE_KEYS.OPEN_APP_ON_START, String(enabled))
    try { await WidgetBridge.setOpenAppOnStart({ enabled }) } catch { /* non-iOS */ }
  }
```

Render the toggle only on iOS (follow the existing settings-row markup/toggle component in the file — reuse the same Switch/row pattern already used for other boolean settings):

```tsx
  {isIOS && (
    <section aria-label={t('settings.widgets.sectionTitle')}>
      <h3>{t('settings.widgets.sectionTitle')}</h3>
      <label className="flex items-center justify-between gap-4">
        <span>
          {t('settings.widgets.openAppOnStart')}
          <span className="block text-xs text-muted-foreground">
            {t('settings.widgets.openAppOnStartHint')}
          </span>
        </span>
        <Switch checked={openAppOnStart} onCheckedChange={handleOpenAppOnStart} />
      </label>
    </section>
  )}
```

> Use whatever `Switch` component the file already imports for other toggles. Match the existing visual pattern rather than introducing new markup conventions.

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/constants.ts apps/web/src/components/SettingsView.tsx apps/web/public/locales
git commit -m "feat(widgets): add iOS-only open-app-on-start setting

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task B6: Native `WidgetBridgePlugin` + registration + App Group entitlement

**Files:**
- Create: `apps/web/ios/App/App/WidgetBridgePlugin.swift`
- Modify: `apps/web/ios/App/App/MeticulousViewController.swift`
- Create/Modify: `apps/web/ios/App/App/App.entitlements` (main app target)

- [ ] **Step 1: Add the App Group entitlement to the main app**

Ensure `apps/web/ios/App/App/App.entitlements` contains (create if missing, and set it as `CODE_SIGN_ENTITLEMENTS` for the `App` target in `App.xcodeproj`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.application-groups</key>
	<array>
		<string>group.com.metic.app</string>
	</array>
</dict>
</plist>
```

- [ ] **Step 2: Implement the plugin**

Create `apps/web/ios/App/App/WidgetBridgePlugin.swift`:

```swift
import Capacitor
import Foundation
import WidgetKit

@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setFavourites", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMachineUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setOpenAppOnStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reloadWidgets", returnType: CAPPluginReturnPromise),
    ]

    private static let appGroup = "group.com.metic.app"
    private var defaults: UserDefaults? { UserDefaults(suiteName: Self.appGroup) }
    private var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup)
    }

    @objc func setFavourites(_ call: CAPPluginCall) {
        guard let favourites = call.getArray("favourites") as? [[String: Any]] else {
            call.reject("favourites array required"); return
        }
        // Cache images into the shared container and rewrite each entry with a filename.
        var stored: [[String: Any]] = []
        for fav in favourites {
            var entry = fav
            if let id = fav["id"] as? String, let imageUrl = fav["imageUrl"] as? String,
               let filename = cacheImage(id: id, from: imageUrl) {
                entry["imageFilename"] = filename
            }
            entry.removeValue(forKey: "imageUrl")
            stored.append(entry)
        }
        if let data = try? JSONSerialization.data(withJSONObject: stored) {
            defaults?.set(data, forKey: "favourites")
        }
        defaults?.set(1, forKey: "schemaVersion")
        call.resolve()
    }

    @objc func setMachineUrl(_ call: CAPPluginCall) {
        guard let url = call.getString("url") else { call.reject("url required"); return }
        defaults?.set(url, forKey: "machineUrl")
        call.resolve()
    }

    @objc func setOpenAppOnStart(_ call: CAPPluginCall) {
        defaults?.set(call.getBool("enabled") ?? false, forKey: "openAppOnStart")
        call.resolve()
    }

    @objc func reloadWidgets(_ call: CAPPluginCall) {
        if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }
        call.resolve()
    }

    /// Downloads a data-URI or http(s) image and writes it as favourites/<id>.png
    /// in the shared container. Returns the filename on success.
    private func cacheImage(id: String, from imageUrl: String) -> String? {
        guard let container = containerURL else { return nil }
        let favDir = container.appendingPathComponent("favourites", isDirectory: true)
        try? FileManager.default.createDirectory(at: favDir, withIntermediateDirectories: true)
        let filename = "\(id).png"
        let dest = favDir.appendingPathComponent(filename)

        var imageData: Data?
        if imageUrl.hasPrefix("data:image") {
            if let commaIdx = imageUrl.firstIndex(of: ",") {
                let b64 = String(imageUrl[imageUrl.index(after: commaIdx)...])
                imageData = Data(base64Encoded: b64)
            }
        } else if let url = URL(string: imageUrl) {
            imageData = try? Data(contentsOf: url) // LAN/synchronous; called off main by Capacitor
        }
        guard let data = imageData else { return nil }
        do { try data.write(to: dest); return filename } catch { return nil }
    }
}
```

- [ ] **Step 3: Register the plugin**

In `apps/web/ios/App/App/MeticulousViewController.swift`, inside `capacitorDidLoad()` (after the existing discovery-plugin registration), register the bridge the same way:

```swift
        let widgetBridge = WidgetBridgePlugin()
        if bridge.responds(to: registerSelector) {
            _ = bridge.perform(registerSelector, with: widgetBridge)
            NSLog("MeticAI: WidgetBridgePlugin registered successfully")
        }
```

> `bridge` and `registerSelector` are already in scope from the discovery-plugin registration block. Reuse them; do not re-derive.

- [ ] **Step 4: Verify the app still builds (or defer to Phase C build)**

If an iOS toolchain is available: `cd apps/web/ios/App && xcodebuild -scheme App -destination 'generic/platform=iOS' -quiet build`
Expected: BUILD SUCCEEDED. If no toolchain here, note it and validate during Phase C on a Mac with Xcode.

- [ ] **Step 5: Commit**

```bash
git add apps/web/ios/App/App/WidgetBridgePlugin.swift apps/web/ios/App/App/MeticulousViewController.swift apps/web/ios/App/App/App.entitlements
git commit -m "feat(widgets): add native WidgetBridge plugin and app group entitlement

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## PHASE C — iOS WidgetKit extension (Swift)

> **Environment note:** Phase C requires macOS + Xcode 16+ (iOS 17 SDK). Perform target creation in Xcode; commit the resulting project changes. Run `bunx cap sync ios` after web changes and confirm the new target survives sync (**Spike C0**).

### Task C0 (Spike): Snapshot status endpoint + cap-sync survival

**Files:** none (investigation; record findings in this plan's §Notes and in the spec's §13).

- [ ] **Step 1:** Determine the machine's one-shot status source. Options to test against a real machine at `http://<ip>:8080`:
  - Probe for a REST status endpoint (e.g. `GET /api/v1/status` or similar) returning current sensors (weight, temperature), machine `state`, and `loaded_profile`.
  - If none exists, plan a short-lived Socket.IO connection in Swift that reads one `status` frame then disconnects. (The web app receives live data via the `status` socket event: `sensors.w`, `boiler_temperature`, `state`, `loaded_profile`/`profile`.)
- [ ] **Step 2:** Confirm target temp/weight: derive from the loaded profile via `GET /api/v1/profile/get/{id}` (`final_weight`, temperature field) when not present in the status payload.
- [ ] **Step 3:** Confirm that adding the `MeticWidgets` target does not get clobbered by `bunx cap sync ios`. Document any `capacitor.config`/Podfile considerations.
- [ ] **Step 4:** Write the chosen approach into `MachineClient.snapshot()` (Task C3) — no placeholder; implement the concrete method.

### Task C1: Create the `MeticWidgets` extension target

- [ ] **Step 1:** In Xcode, File → New → Target → **Widget Extension**, name `MeticWidgets`, uncheck "Include Live Activity", check "Include Configuration Intent" (App Intents). Set deployment target **iOS 17.0**.
- [ ] **Step 2:** Add App Group capability `group.com.metic.app` to the `MeticWidgets` target. Create `apps/web/ios/App/MeticWidgets/MeticWidgets.entitlements` mirroring the ShareExtension entitlements:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.application-groups</key>
	<array>
		<string>group.com.metic.app</string>
	</array>
</dict>
</plist>
```

- [ ] **Step 3:** Create the shared `MeticKit` group and add its files to the `MeticWidgets` target (and the `App` target where the plugin needs the same keys — at minimum, keep the App-Group key strings identical between plugin and `MeticKit/AppGroup.swift`).
- [ ] **Step 4:** Commit the Xcode project + entitlements changes.

```bash
git add apps/web/ios/App/App.xcodeproj apps/web/ios/App/MeticWidgets
git commit -m "chore(widgets): scaffold MeticWidgets extension target (iOS 17)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task C2: `MeticKit` App-Group store + models + XCTest

**Files:**
- Create: `apps/web/ios/App/MeticKit/AppGroup.swift`
- Create: `apps/web/ios/App/MeticKit/Models.swift`
- Create: `apps/web/ios/App/MeticWidgets/MeticWidgetsTests/AppGroupStoreTests.swift`

- [ ] **Step 1: Models**

Create `apps/web/ios/App/MeticKit/Models.swift`:

```swift
import Foundation

public struct Favourite: Codable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public var targetTempC: Double?
    public var targetWeightG: Double?
    public var imageFilename: String?
}

public struct MachineSnapshot: Equatable {
    public let state: String            // "idle" | "heating" | "ready" | "brewing" | ...
    public let loadedProfileName: String?
    public let currentTempC: Double?
    public let targetTempC: Double?
    public let currentWeightG: Double?
    public let targetWeightG: Double?
}

public enum MachineAction: String {
    case start, stop, preheat, tare
}
```

- [ ] **Step 2: App-Group store**

Create `apps/web/ios/App/MeticKit/AppGroup.swift`:

```swift
import Foundation

public enum AppGroup {
    public static let identifier = "group.com.metic.app"
    public static let schemaVersion = 1

    public static var defaults: UserDefaults? {
        UserDefaults(suiteName: identifier)
    }

    public static var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier)
    }
}

public struct AppGroupStore {
    public init() {}

    public func favourites() -> [Favourite] {
        guard let data = AppGroup.defaults?.data(forKey: "favourites") else { return [] }
        return (try? JSONDecoder().decode([Favourite].self, from: data)) ?? []
    }

    public func machineURL() -> URL? {
        guard let s = AppGroup.defaults?.string(forKey: "machineUrl") else { return nil }
        return URL(string: s)
    }

    public func openAppOnStart() -> Bool {
        AppGroup.defaults?.bool(forKey: "openAppOnStart") ?? false
    }

    public func isSchemaCompatible() -> Bool {
        let v = AppGroup.defaults?.integer(forKey: "schemaVersion") ?? 0
        return v == AppGroup.schemaVersion
    }

    public func imageURL(for favourite: Favourite) -> URL? {
        guard let filename = favourite.imageFilename,
              let container = AppGroup.containerURL else { return nil }
        return container.appendingPathComponent("favourites/\(filename)")
    }
}
```

- [ ] **Step 3: XCTest for the codec**

Create `apps/web/ios/App/MeticWidgets/MeticWidgetsTests/AppGroupStoreTests.swift`:

```swift
import XCTest
@testable import MeticWidgetsExtension // adjust to the extension's module name

final class AppGroupStoreTests: XCTestCase {
    func testFavouriteRoundTrips() throws {
        let fav = Favourite(id: "a", name: "Alpha", targetTempC: 93, targetWeightG: 36, imageFilename: "a.png")
        let data = try JSONEncoder().encode([fav])
        let decoded = try JSONDecoder().decode([Favourite].self, from: data)
        XCTAssertEqual(decoded.first?.id, "a")
        XCTAssertEqual(decoded.first?.targetWeightG, 36)
    }

    func testDecodesFavouriteWithoutOptionalFields() throws {
        let json = Data(#"[{"id":"b","name":"Bravo"}]"#.utf8)
        let decoded = try JSONDecoder().decode([Favourite].self, from: json)
        XCTAssertEqual(decoded.first?.name, "Bravo")
        XCTAssertNil(decoded.first?.targetTempC)
    }
}
```

- [ ] **Step 4:** Run the extension test target in Xcode (⌘U) or `xcodebuild test -scheme MeticWidgets -destination 'platform=iOS Simulator,name=iPhone 15'`.
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/ios/App/MeticKit apps/web/ios/App/MeticWidgets/MeticWidgetsTests
git commit -m "feat(widgets): app-group store and models with tests

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task C3: `MachineClient` (direct-LAN HTTP) + XCTest

**Files:**
- Create: `apps/web/ios/App/MeticKit/MachineClient.swift`
- Create: `apps/web/ios/App/MeticWidgets/MeticWidgetsTests/MachineClientTests.swift`

- [ ] **Step 1: Implement the client**

Create `apps/web/ios/App/MeticKit/MachineClient.swift`. Endpoints mirror the web `DirectAdapter`: `POST /api/v1/action/{action}`, `GET /api/v1/profile/load/{id}`, `GET /api/v1/settings` (liveness), `GET /api/v1/profile/get/{id}` (targets). Implement `snapshot()` per the Task C0 spike outcome.

```swift
import Foundation

public struct MachineClient {
    public enum ClientError: Error { case unreachable, badResponse }

    private let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func actionURL(_ action: MachineAction) -> URL {
        baseURL.appendingPathComponent("api/v1/action/\(action.rawValue)")
    }

    public func loadProfileURL(id: String) -> URL {
        baseURL.appendingPathComponent("api/v1/profile/load/\(id)")
    }

    public var settingsURL: URL { baseURL.appendingPathComponent("api/v1/settings") }

    /// Fast liveness pre-flight.
    public func isReachable(timeout: TimeInterval = 2) async -> Bool {
        var req = URLRequest(url: settingsURL)
        req.timeoutInterval = timeout
        do {
            let (_, resp) = try await session.data(for: req)
            return (resp as? HTTPURLResponse).map { (200..<500).contains($0.statusCode) } ?? false
        } catch { return false }
    }

    @discardableResult
    public func perform(_ action: MachineAction, timeout: TimeInterval = 4) async throws -> Bool {
        guard await isReachable() else { throw ClientError.unreachable }
        var req = URLRequest(url: actionURL(action))
        req.httpMethod = "POST"
        req.timeoutInterval = timeout
        let (_, resp) = try await session.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ClientError.badResponse
        }
        return true
    }

    public func loadProfile(id: String, timeout: TimeInterval = 4) async throws {
        var req = URLRequest(url: loadProfileURL(id: id))
        req.timeoutInterval = timeout
        let (_, resp) = try await session.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ClientError.badResponse
        }
    }

    public func startProfile(id: String) async throws {
        guard await isReachable() else { throw ClientError.unreachable }
        try await loadProfile(id: id)
        try await perform(.start)
    }

    /// One-shot machine snapshot. Implementation determined by Spike C0.
    public func snapshot() async throws -> MachineSnapshot {
        // Implement against the endpoint/socket confirmed in Task C0.
        // Parse: state, loadedProfileName, current temp/weight; derive targets
        // from the loaded profile (GET /api/v1/profile/get/{id}) if absent.
        throw ClientError.badResponse
    }
}
```

- [ ] **Step 2: XCTest for URL construction + error mapping**

Create `apps/web/ios/App/MeticWidgets/MeticWidgetsTests/MachineClientTests.swift`:

```swift
import XCTest
@testable import MeticWidgetsExtension // adjust to the extension's module name

final class MachineClientTests: XCTestCase {
    private let base = URL(string: "http://machine.local:8080")!

    func testActionURL() {
        let c = MachineClient(baseURL: base)
        XCTAssertEqual(c.actionURL(.preheat).absoluteString,
                       "http://machine.local:8080/api/v1/action/preheat")
        XCTAssertEqual(c.actionURL(.tare).absoluteString,
                       "http://machine.local:8080/api/v1/action/tare")
    }

    func testLoadProfileURL() {
        let c = MachineClient(baseURL: base)
        XCTAssertEqual(c.loadProfileURL(id: "abc").absoluteString,
                       "http://machine.local:8080/api/v1/profile/load/abc")
    }

    func testSettingsURL() {
        let c = MachineClient(baseURL: base)
        XCTAssertEqual(c.settingsURL.absoluteString,
                       "http://machine.local:8080/api/v1/settings")
    }
}
```

- [ ] **Step 3:** Run tests (⌘U / `xcodebuild test`). Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/ios/App/MeticKit/MachineClient.swift apps/web/ios/App/MeticWidgets/MeticWidgetsTests/MachineClientTests.swift
git commit -m "feat(widgets): direct-LAN machine client with tests

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task C4: App Intents

**Files:**
- Create: `apps/web/ios/App/MeticWidgets/Intents/StartProfileIntent.swift`
- Create: `apps/web/ios/App/MeticWidgets/Intents/ControlIntents.swift`

- [ ] **Step 1: Start intent (honours openAppOnStart)**

Create `StartProfileIntent.swift`:

```swift
import AppIntents
import Foundation

struct StartProfileIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Profile"
    static var openAppWhenRun: Bool = false // decided at runtime via perform()

    @Parameter(title: "Profile ID") var profileId: String

    init() {}
    init(profileId: String) { self.profileId = profileId }

    func perform() async throws -> some IntentResult {
        let store = AppGroupStore()
        if store.openAppOnStart() {
            // Hand off to the app for a visible, confirmable start.
            guard let url = URL(string: "metic://start?profileId=\(profileId)") else {
                return .result()
            }
            return .result(opensIntent: OpenURLIntent(url))
        }
        guard let base = store.machineURL() else { return .result() }
        try? await MachineClient(baseURL: base).startProfile(id: profileId)
        return .result()
    }
}
```

> If `OpenURLIntent(_:)` is unavailable in the deployment SDK, set `static var openAppWhenRun` dynamically is not possible; instead implement a dedicated `OpenStartIntent` with `openAppWhenRun = true` that the widget wires to the profile tap when `openAppOnStart` is true (read at timeline-build time and choose the intent per-entry). Pick one approach in code — do not leave both.

- [ ] **Step 2: Control intents**

Create `ControlIntents.swift`:

```swift
import AppIntents

private func client() -> MachineClient? {
    guard let base = AppGroupStore().machineURL() else { return nil }
    return MachineClient(baseURL: base)
}

struct PreheatIntent: AppIntent {
    static var title: LocalizedStringResource = "Preheat"
    func perform() async throws -> some IntentResult {
        try? await client()?.perform(.preheat); return .result()
    }
}

struct TareIntent: AppIntent {
    static var title: LocalizedStringResource = "Tare"
    func perform() async throws -> some IntentResult {
        try? await client()?.perform(.tare); return .result()
    }
}

struct StopIntent: AppIntent {
    static var title: LocalizedStringResource = "Stop"
    func perform() async throws -> some IntentResult {
        try? await client()?.perform(.stop); return .result()
    }
}

struct SnapshotIntent: AppIntent {
    static var title: LocalizedStringResource = "Now"
    func perform() async throws -> some IntentResult {
        // Trigger a timeline reload; the provider reads a fresh snapshot and
        // renders the ~10s overlay, then a follow-up entry reverts.
        if #available(iOS 14.0, *) {
            WidgetKitReload.controlCenter()
        }
        return .result()
    }
}
```

Add a tiny reload helper `MeticWidgets/WidgetKitReload.swift`:

```swift
import WidgetKit
enum WidgetKitReload {
    static func controlCenter() { WidgetCenter.shared.reloadTimelines(ofKind: "ControlCenterWidget") }
}
```

- [ ] **Step 3:** Build the extension (⌘B). Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add apps/web/ios/App/MeticWidgets/Intents apps/web/ios/App/MeticWidgets/WidgetKitReload.swift
git commit -m "feat(widgets): app intents for start/preheat/tare/stop/now

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task C5: Favourite Profiles widget

**Files:**
- Create: `apps/web/ios/App/MeticWidgets/FavouriteProfilesWidget.swift`

- [ ] **Step 1: Configuration + provider + views**

Create `FavouriteProfilesWidget.swift`. Implement:
- `AppIntentConfiguration` with a configuration intent exposing **small style** (Hero/Grid) and **large density** (2×3/2×4) as an enum `@Parameter`, plus optional favourite selection (default = top of list).
- `TimelineProvider` that reads `AppGroupStore().favourites()`; single entry (static until app pushes a reload).
- SwiftUI views per family: `systemSmall` (Hero or Grid), `systemMedium` (4, 2×2), `systemLarge` (6 or 8). Each profile is a `Button(intent: StartProfileIntent(profileId:))` (or `Link` to `metic://start?...` per the C4 openApp path). Header shows **"Metic."**. Images loaded from `store.imageURL(for:)`; missing → monogram (initials) placeholder. SF Symbols only.

Provide a concrete skeleton (fill remaining families following the same pattern):

```swift
import WidgetKit
import SwiftUI
import AppIntents

enum SmallStyle: String, AppEnum {
    case hero, grid
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Small Style"
    static var caseDisplayRepresentations: [SmallStyle: DisplayRepresentation] =
        [.hero: "Hero", .grid: "Grid"]
}
enum LargeDensity: String, AppEnum {
    case sixUp, eightUp
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Large Density"
    static var caseDisplayRepresentations: [LargeDensity: DisplayRepresentation] =
        [.sixUp: "6 profiles", .eightUp: "8 profiles"]
}

struct FavouritesConfigIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Favourite Profiles"
    @Parameter(title: "Small style", default: .hero) var smallStyle: SmallStyle
    @Parameter(title: "Large density", default: .sixUp) var largeDensity: LargeDensity
}

struct FavouritesEntry: TimelineEntry {
    let date: Date
    let favourites: [Favourite]
    let config: FavouritesConfigIntent
}

struct FavouritesProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> FavouritesEntry {
        FavouritesEntry(date: .now, favourites: [], config: FavouritesConfigIntent())
    }
    func snapshot(for config: FavouritesConfigIntent, in context: Context) async -> FavouritesEntry {
        FavouritesEntry(date: .now, favourites: AppGroupStore().favourites(), config: config)
    }
    func timeline(for config: FavouritesConfigIntent, in context: Context) async -> Timeline<FavouritesEntry> {
        Timeline(entries: [FavouritesEntry(date: .now, favourites: AppGroupStore().favourites(), config: config)],
                 policy: .never)
    }
}

struct FavouritesWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: FavouritesEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Metic.").font(.caption2).bold().opacity(0.7)
            content
        }
        .padding(12)
        .containerBackground(.fill.tertiary, for: .widget)
    }
    @ViewBuilder private var content: some View {
        let favs = entry.favourites
        if favs.isEmpty {
            Text("Add favourites in Metic").font(.footnote).foregroundStyle(.secondary)
        } else {
            switch family {
            case .systemSmall:
                if entry.config.smallStyle == .hero { HeroTile(fav: favs[0]) }
                else { GridTiles(favs: Array(favs.prefix(4)), columns: 2) }
            case .systemMedium:
                GridRows(favs: Array(favs.prefix(4)), columns: 2)
            case .systemLarge:
                let n = entry.config.largeDensity == .sixUp ? 6 : 8
                GridRows(favs: Array(favs.prefix(n)), columns: 2)
            default:
                GridRows(favs: Array(favs.prefix(4)), columns: 2)
            }
        }
    }
}

struct FavouriteProfilesWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "FavouriteProfilesWidget",
                               intent: FavouritesConfigIntent.self,
                               provider: FavouritesProvider()) { entry in
            FavouritesWidgetView(entry: entry)
        }
        .configurationDisplayName("Metic. Favourites")
        .description("Start a favourite profile from the home screen.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
```

Implement `HeroTile`, `GridTiles`, `GridRows`, and a `ProfileImage` view (loads from the App-Group file URL or renders initials). Each tile wraps its content in `Button(intent: StartProfileIntent(profileId: fav.id)) { ... }.buttonStyle(.plain)`.

- [ ] **Step 2: SwiftUI previews** for each family/style as visual smoke tests.

- [ ] **Step 3:** Build + run in the simulator; add the widget in all sizes; verify rendering and that tapping a profile fires the intent.

- [ ] **Step 4: Commit**

```bash
git add apps/web/ios/App/MeticWidgets/FavouriteProfilesWidget.swift
git commit -m "feat(widgets): favourite profiles widget (small/medium/large)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task C6: Control Center widget

**Files:**
- Create: `apps/web/ios/App/MeticWidgets/ControlCenterWidget.swift`

- [ ] **Step 1:** Implement the widget with:
- Default face: control buttons (`Button(intent:)`) — small = 2×2 (Start, Preheat, Tare, Now); medium = 4-in-a-row; large = 6 favourites (2×3) + control row.
- **Now** button → `SnapshotIntent`. When a fresh snapshot exists (written by the provider after a reload), render the **overlay** state: status + loaded profile + current→target temp/weight, with a thin depleting bar; the timeline schedules a revert entry ~10s later (`Timeline(entries: [snapshotEntry, revertEntry(after: 10s)], policy: .never)`).
- Contextual **Stop**: if the snapshot reports `state == "brewing"`, the Start control renders as Stop (`StopIntent`).
- Header: **"Metic."**. SF Symbols only.

Concrete provider timeline for the snapshot lifecycle:

```swift
func timeline(for config: ControlConfigIntent, in context: Context) async -> Timeline<ControlEntry> {
    let store = AppGroupStore()
    // Attempt a fresh snapshot only when explicitly requested via the reload;
    // otherwise render the plain control face.
    if let base = store.machineURL(),
       let snap = try? await MachineClient(baseURL: base).snapshot() {
        let now = Date()
        let showing = ControlEntry(date: now, favourites: store.favourites(), snapshot: snap, config: config)
        let revert  = ControlEntry(date: now.addingTimeInterval(10), favourites: store.favourites(), snapshot: nil, config: config)
        return Timeline(entries: [showing, revert], policy: .never)
    }
    return Timeline(entries: [ControlEntry(date: .now, favourites: store.favourites(), snapshot: nil, config: config)], policy: .never)
}
```

- [ ] **Step 2:** SwiftUI previews: idle face + snapshot overlay, per family.

- [ ] **Step 3:** Simulator test: controls fire; Now shows overlay then reverts; unreachable machine shows the error state + Open Metic.

- [ ] **Step 4: Commit**

```bash
git add apps/web/ios/App/MeticWidgets/ControlCenterWidget.swift
git commit -m "feat(widgets): control center widget with on-demand snapshot overlay

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task C7: Widget bundle + manual device matrix

**Files:**
- Create/Modify: `apps/web/ios/App/MeticWidgets/MeticWidgetsBundle.swift`

- [ ] **Step 1: Register both widgets**

```swift
import WidgetKit
import SwiftUI

@main
struct MeticWidgetsBundle: WidgetBundle {
    var body: some Widget {
        FavouriteProfilesWidget()
        ControlCenterWidget()
    }
}
```

- [ ] **Step 2: Run the manual device matrix** (record pass/fail in the PR description):
  - Each family/style of both widgets renders correctly (incl. empty-favourites state).
  - Favourite tap: background start (setting off) vs opens app (setting on).
  - Preheat/Tare fire silently; haptic + confirmation on success.
  - Now: overlay shows status + profile + current→target; reverts after ~10s; brewing → Stop appears.
  - Off-LAN: action shows unreachable state + "Open Metic".
  - Add/remove favourite in app → widget reflects it after app foreground.

- [ ] **Step 3: Commit**

```bash
git add apps/web/ios/App/MeticWidgets/MeticWidgetsBundle.swift
git commit -m "feat(widgets): register widget bundle

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Final Verification

- [ ] `cd apps/web && bunx vitest run` — full TS suite green.
- [ ] `cd apps/web && bunx tsc --noEmit` — no type errors.
- [ ] Lint per repo config (e.g. `bunx eslint .` if configured) — clean.
- [ ] All 6 locale JSON files valid and contain the new keys.
- [ ] Xcode: `MeticWidgets` + `MeticWidgetsTests` build; XCTest green.
- [ ] Manual device matrix (Task C7) complete.
- [ ] Update `VERSION` per the release process when merging into the 3.0.0 line (separate release step — not part of this feature branch).

## Notes / Spike Outcomes
- Record the Task C0 snapshot-endpoint decision here once determined.
- Record any `bunx cap sync ios` considerations for the new target here.

## Self-Review Coverage Map (spec → tasks)
- Favourites concept → A1–A3. Widget catalog/styles → C5–C6. Interaction model / App Intents / openAppOnStart → C4, B5, B4/B6. Deep links → B1–B2, B4. Direct-LAN MachineClient → C3. App-Group contract/data flow → B6 (write) + C2 (read). Settings toggle (iOS-only) → B5. i18n (6 locales) → A3, B5. Error handling → C3 (reachability), C5/C6 (empty/unreachable/timeout states), C2 (schema gate). Testing → per-task TS + Swift XCTest + C7 matrix. No-Python/no-server-parity → header + spec §8.4.
