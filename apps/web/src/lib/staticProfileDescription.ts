/**
 * Static (non-AI) profile description generator.
 *
 * Port of `_build_static_profile_description()` from
 * apps/server/services/analysis_service.py — produces the same
 * "Profile Created / Description / Preparation / Why This Works /
 * Special Notes" format so that ProfileDetailView's
 * `parseProfileSections()` can render it identically.
 */

interface Stage {
  name?: string
  dynamics?: string
  sensor?: string
  dynamics_points?: [number, number][]
  exit_triggers?: { type: string; value: number }[]
}

interface ProfileJson {
  name?: string
  temperature?: number
  final_weight?: number
  stages?: Stage[]
  description?: string
  notes?: string
  summary?: string
}

export function buildStaticProfileDescription(profileJson: ProfileJson): string {
  const profileName = profileJson.name ?? 'Imported Profile'
  const temperature = profileJson.temperature
  const finalWeight = profileJson.final_weight
  const stages: Stage[] = profileJson.stages ?? []

  const existing =
    profileJson.description ?? profileJson.notes ?? profileJson.summary
  let description: string

  if (existing) {
    description = String(existing).trim()
  } else {
    const shotTraits: string[] = []

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i]
      if (!stage || typeof stage !== 'object') continue
      const sname = (stage.name ?? '').toLowerCase()
      const dynamics = stage.dynamics ?? ''
      const points = stage.dynamics_points

      if (i === 0 && (/pre/.test(sname) || /infus/.test(sname))) {
        shotTraits.push('pre-infusion')
      } else if (/bloom|soak/.test(sname)) {
        shotTraits.push('bloom')
      } else if (/ramp/.test(sname) || dynamics === 'ramp') {
        shotTraits.push('ramp')
      } else if (/flat/.test(sname) || dynamics === 'flat') {
        shotTraits.push('flat')
      } else if (/decline|taper/.test(sname)) {
        shotTraits.push('decline')
      }

      // Detect flat pressure at ~9 bar (classic espresso)
      if (Array.isArray(points) && points.length >= 2) {
        try {
          const pressures = points
            .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2)
            .map(p => Number(p[1]))
          if (
            pressures.length > 0 &&
            pressures.every(p => Math.abs(p - pressures[0]) < 0.3) &&
            pressures[0] >= 8.0 &&
            pressures[0] <= 10.0 &&
            !shotTraits.includes('flat')
          ) {
            shotTraits.push('flat')
          }
        } catch {
          // ignore
        }
      }
    }

    // Deduplicate while preserving order
    const uniqueTraits = [...new Map(shotTraits.map(t => [t, t])).values()]

    const parts: string[] = []
    if (stages.length > 0) {
      const stageCount = `${stages.length}-stage`
      if (uniqueTraits.length > 0) {
        parts.push(`A ${stageCount} extraction featuring ${uniqueTraits.join(', ')}`)
      } else {
        parts.push(`A ${stageCount} extraction profile`)
      }
    }
    if (temperature != null) parts.push(`brewed at ${temperature}°C`)
    if (finalWeight != null) parts.push(`targeting ~${finalWeight}g yield`)

    description =
      parts.length > 0
        ? parts.join(' ') + '.'
        : 'Profile imported successfully.'
  }

  // Calculate expected time from stage dynamics_points
  let expectedTime = 'Not specified'
  try {
    let totalTime = 0
    for (const stage of stages) {
      const points = stage?.dynamics_points
      if (Array.isArray(points) && points.length > 0) {
        const last = points[points.length - 1]
        if (Array.isArray(last) && last.length > 0) {
          totalTime += Number(last[0])
        }
      }
    }
    if (totalTime > 0) expectedTime = `~${Math.round(totalTime)}s`
  } catch {
    // ignore
  }

  const tempText =
    temperature != null ? `${temperature}°C` : 'Use profile default'
  const yieldText =
    finalWeight != null ? `${finalWeight}g` : 'Use profile default'

  return (
    `Profile Created: ${profileName}\n\n` +
    `Description:\n` +
    `${description}\n\n` +
    `Preparation:\n` +
    `• Dose: Use your standard recipe dose\n` +
    `• Grind: Dial in to hit target flow and pressure\n` +
    `• Temperature: ${tempText}\n` +
    `• Target Yield: ${yieldText}\n` +
    `• Expected Time: ${expectedTime}\n\n` +
    `Why This Works:\n` +
    `This is a summary generated from the profile's stage structure and metadata. ` +
    `Enable AI features in Settings and configure a Gemini API key for a detailed ` +
    `barista-level analysis with expert brewing recommendations.\n\n` +
    `Special Notes:\n` +
    `This description was generated without AI assistance and may not capture ` +
    `all nuances of the extraction design. You can generate a full AI-powered ` +
    `description using the "Generate AI descriptions" button in the profile view ` +
    `(requires AI features to be enabled in Settings).`
  )
}
