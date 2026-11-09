/**
 * portalApi — thin client for the shared core's `/api/portal/*` routes.
 *
 * Works in both runtimes: in proxy mode the Bun server answers, in direct mode
 * the core interceptor handles the same paths in-process.
 */

import { getServerUrl } from '@/lib/config'
import type { PortalSample, PoolMode } from '@metic/core/logic/portalAnalysis'
import type { PortalShotResponse, PortalShotSummary } from '@metic/core/routes/portal'

export type { PortalShotResponse, PortalShotSummary }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getServerUrl()
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { detail?: string }
      if (body?.detail) detail = body.detail
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail)
  }
  return (await res.json()) as T
}

const enc = encodeURIComponent

export function fetchPortalShot(date: string, filename: string, mode: PoolMode = 'auto'): Promise<PortalShotResponse> {
  return api(`/api/portal/shots/${enc(date)}/${enc(filename)}?mode=${mode}`)
}

export interface PutPortalShotBody {
  samples: PortalSample[]
  startedAt: number
  lagSec?: number
  stopTimeSec?: number | null
  deviceName?: string | null
  coffee?: string | null
  doseG?: number | null
}

export function putPortalShot(date: string, filename: string, body: PutPortalShotBody, mode: PoolMode = 'auto'): Promise<PortalShotResponse> {
  return api(`/api/portal/shots/${enc(date)}/${enc(filename)}?mode=${mode}`, { method: 'PUT', body: JSON.stringify(body) })
}

export interface PatchPortalShotBody {
  coffee?: string | null
  doseG?: number | null
  lagSec?: number
  reading?: { tdsPct: number; beverageG?: number | null } | null
}

export function patchPortalShot(date: string, filename: string, body: PatchPortalShotBody, mode: PoolMode = 'auto'): Promise<PortalShotResponse> {
  return api(`/api/portal/shots/${enc(date)}/${enc(filename)}?mode=${mode}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function deletePortalShot(date: string, filename: string): Promise<{ status: string }> {
  return api(`/api/portal/shots/${enc(date)}/${enc(filename)}`, { method: 'DELETE' })
}

export async function fetchPortalSummaries(): Promise<Record<string, PortalShotSummary>> {
  const res = await api<{ status: string; shots: Record<string, PortalShotSummary> }>('/api/portal/shots')
  return res.shots ?? {}
}

export interface LastShot {
  profile_name: string
  date: string
  filename: string
  /** Epoch seconds. */
  timestamp: number
  final_weight: number | null
  total_time: number | null
}

export async function fetchLastShot(): Promise<LastShot | null> {
  try {
    return await api<LastShot>('/api/last-shot')
  } catch {
    return null
  }
}
