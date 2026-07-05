/**
 * Post-processing for AI-generated profile descriptions. Small models sometimes
 * echo the profile's variable references (e.g. "$pressure_Max Pressure") or
 * invent placeholder tokens ("$pressure_1$") into the prose. Resolve real
 * references to concrete values and strip the rest so users never see raw
 * placeholders. Mirror of resolve_description_placeholders in
 * apps/server/services/analysis_service.py — keep the two in sync.
 */

export interface ProfileVariable {
  key?: string
  name?: string
  value?: unknown
}

const UNIT_BY_TYPE: Record<string, string> = {
  pressure: ' bar',
  flow: ' ml/s',
  time: ' s',
  weight: ' g',
}

export function resolveDescriptionPlaceholders(
  text: string | null | undefined,
  variables: ProfileVariable[] = [],
): string {
  if (!text) return text ?? ''
  // Models often markdown-escape underscores inside placeholders ($a\_1$).
  let out = text.replace(/\\_/g, '_').replace(/\\\*/g, '*')
  // Resolve real variable references, longest keys first so a key that is a
  // prefix of another does not partially replace it.
  const sorted = [...variables]
    .filter(v => typeof v.key === 'string' && v.value != null)
    .sort((a, b) => (b.key as string).length - (a.key as string).length)
  for (const v of sorted) {
    const key = v.key as string
    const unit = UNIT_BY_TYPE[key.split('_')[0]] ?? ''
    const val = `${v.value}${unit}`
    out = out.split(`$${key}$`).join(val)
    out = out.split(`$${key}`).join(val)
  }
  // Strip any remaining paired $...$ placeholder tokens the model invented.
  out = out.replace(/\$[^\s$]{1,60}\$/g, '')
  // Tidy whitespace left behind by removals.
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([.,;:)])/g, '$1')
  return out
}
