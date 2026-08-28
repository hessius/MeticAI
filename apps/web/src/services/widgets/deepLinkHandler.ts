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

/**
 * Dispatch a parsed `metic://` deep link into the machine service.
 * `open` links are handled by simply foregrounding the app (the caller does
 * that); this function reports the outcome so callers can surface feedback.
 */
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
