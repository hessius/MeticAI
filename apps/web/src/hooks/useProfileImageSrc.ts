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

/** Path segment identifying a Meticulous machine profile-image endpoint. */
const MACHINE_IMAGE_PATH = '/api/v1/profile/image/'

/**
 * Re-host a stored profile image URL onto the current machine base.
 *
 * Favourites persist a fully-resolved absolute image URL (e.g. pinning
 * `http://192.168.0.5:8080/...`). When the machine's address or API port
 * changes (firmware moved the API from :8080 to :80, or DHCP reassigned the
 * IP), that stored URL becomes unreachable and widget images silently fall
 * back to a monogram. This rewrites the origin of machine profile-image URLs
 * to `machineBaseUrl` so they follow the machine, while leaving data URIs and
 * genuinely external URLs (e.g. Met Profiles CDN) untouched.
 */
export function rehostMachineImageUrl(
  imageUrl: string | undefined | null,
  machineBaseUrl: string,
): string | undefined {
  if (!imageUrl) return undefined
  if (imageUrl.startsWith('data:')) return imageUrl
  if (!/^https?:\/\//i.test(imageUrl)) {
    // Relative machine path — resolve against the current base.
    return resolveDisplayImage(imageUrl, machineBaseUrl) ?? imageUrl
  }
  try {
    const url = new URL(imageUrl)
    if (!url.pathname.includes(MACHINE_IMAGE_PATH)) return imageUrl
    const base = new URL(machineBaseUrl)
    url.protocol = base.protocol
    url.hostname = base.hostname
    url.port = base.port
    return url.toString()
  } catch {
    return imageUrl
  }
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
          return resolveDisplayImage(getProfileImageValue(data?.profile))
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
