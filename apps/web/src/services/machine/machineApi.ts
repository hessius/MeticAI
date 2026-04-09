/**
 * Shared espresso-api client factory.
 *
 * In direct mode, multiple services (DirectAdapter, DirectShotDataService,
 * DirectCatalogueService) need to talk to the machine. Instead of each
 * creating its own Api instance, this factory creates and caches one per
 * base URL.
 *
 * The Socket.IO connection is managed by DirectAdapter (via MachineServiceContext).
 * Other services only need the HTTP/axios client for REST calls.
 */

import ApiModule from '@meticulous-home/espresso-api'

// CJS default export interop — Rolldown may wrap the default export
const Api = typeof ApiModule === 'function' ? ApiModule : (ApiModule as { default: typeof ApiModule }).default

type ApiInstance = InstanceType<typeof Api>

const instances = new Map<string, ApiInstance>()

/**
 * Get or create an espresso-api client for the given machine base URL.
 * Does NOT connect the socket — that's DirectAdapter's responsibility.
 */
export function getMachineApi(baseUrl: string): ApiInstance {
  let api = instances.get(baseUrl)
  if (!api) {
    api = new Api(undefined, baseUrl)
    instances.set(baseUrl, api)
  }
  return api
}

/** Clear cached instances (e.g., when machine URL changes) */
export function clearMachineApiCache(): void {
  instances.clear()
}
