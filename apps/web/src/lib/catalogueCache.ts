/**
 * Shared, module-level cache for the profile catalogue list.
 *
 * Lives in its own module (rather than inside the lazy-loaded
 * ProfileCatalogueView) so that other parts of the app — e.g. the profile
 * creation flow in App.tsx — can invalidate it after a mutation without
 * pulling the heavy catalogue component into the main bundle.
 */

export interface CatalogueCacheData<TProfile = unknown> {
  profiles: TProfile[]
  offline: boolean
  ts: number
}

export const CATALOGUE_CACHE_TTL = 2 * 60 * 1000 // 2 minutes

let _cache: CatalogueCacheData | null = null

export function getCatalogueCache<TProfile = unknown>(): CatalogueCacheData<TProfile> | null {
  return _cache as CatalogueCacheData<TProfile> | null
}

export function setCatalogueCache<TProfile>(data: CatalogueCacheData<TProfile> | null): void {
  _cache = data as CatalogueCacheData | null
}

/** Drop the cached catalogue so the next fetch reloads from the machine. */
export function invalidateCatalogueCache(): void {
  _cache = null
}
