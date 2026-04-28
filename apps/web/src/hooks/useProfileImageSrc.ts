/**
 * useProfileImageSrc — resolves profile image URLs for both proxy and direct modes.
 *
 * In proxy mode (Docker): returns `/api/profile/{name}/image-proxy` (server proxies).
 * In direct/Capacitor mode: fetches profile data to get display.image and resolves
 * it to a usable <img src> URL, because the fetch interceptor doesn't handle <img> tags.
 */

import { useState, useEffect } from 'react'
import { isDirectMode, isNativePlatform, getDefaultMachineUrl } from '@/lib/machineMode'
import { getServerUrl } from '@/lib/config'
import { resolveMachineUrl } from '@/services/machine/machineUrl'

interface ProfileImageFields {
  image?: string | null
  display?: { image?: string | null } | null
}

export function getProfileImageValue(profile: ProfileImageFields | null | undefined): string | null {
  return profile?.display?.image ?? profile?.image ?? null
}

function joinMachineUrl(baseUrl: string, relativePath: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${relativePath.replace(/^\//, '')}`
}

/**
 * Resolve a profile's display.image value to a usable <img src> URL.
 * Handles: data URIs, absolute URLs, machine-relative paths.
 */
export function resolveDisplayImage(
  displayImage: string | undefined | null,
  machineBaseUrl: string = getDefaultMachineUrl(),
): string | null {
  if (!displayImage) return null
  if (displayImage.startsWith('data:image/')) return displayImage
  if (displayImage.startsWith('http://') || displayImage.startsWith('https://')) return displayImage
  // Relative path on machine — prepend machine base URL
  return joinMachineUrl(machineBaseUrl, displayImage)
}

export async function resolveDisplayImageAsync(displayImage: string | undefined | null): Promise<string | null> {
  if (!displayImage) return null
  if (displayImage.startsWith('data:image/')) return displayImage
  if (displayImage.startsWith('http://') || displayImage.startsWith('https://')) return displayImage
  return resolveDisplayImage(displayImage, await resolveMachineUrl())
}

/**
 * Hook that returns a resolved profile image URL for the given profile name.
 * Works in both proxy and direct/Capacitor modes.
 */
export function useProfileImageSrc(profileName: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const resolve = async () => {
      if (!profileName) {
        return null
      }

      if (isDirectMode() || isNativePlatform()) {
        try {
          const res = await fetch(`/api/profile/${encodeURIComponent(profileName)}`)
          if (!res.ok) return null
          const data = await res.json()
          return resolveDisplayImageAsync(getProfileImageValue(data?.profile))
        } catch {
          return null
        }
      } else {
        const base = await getServerUrl()
        return `${base}/api/profile/${encodeURIComponent(profileName)}/image-proxy`
      }
    }

    resolve().then((result) => {
      if (!cancelled) setUrl(result)
    })

    return () => { cancelled = true }
  }, [profileName])

  return url
}
