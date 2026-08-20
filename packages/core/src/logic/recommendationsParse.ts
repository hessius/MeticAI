function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeTerm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function termMatches(query: string, candidate: string): boolean {
  const queryTerm = normalizeTerm(query)
  const candidateTerm = normalizeTerm(candidate)
  if (!queryTerm || !candidateTerm) return false
  return candidateTerm.includes(queryTerm) || queryTerm.includes(candidateTerm)
}

export function parseRecommendationsJson(analysisText: string): Array<Record<string, unknown>> {
  const match = analysisText.match(/RECOMMENDATIONS_JSON:\s*(\[[\s\S]*?\])\s*END_RECOMMENDATIONS_JSON/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[1])
    return Array.isArray(parsed) ? parsed.filter(isRecord).filter(isActionableRecommendation) : []
  } catch {
    return []
  }
}

export function isActionableRecommendation(rec: Record<string, unknown>): boolean {
  if (String(rec.variable ?? '').trim() === '') return false
  for (const key of ['current_value', 'recommended_value'] as const) {
    const raw = rec[key]
    if (raw === undefined || raw === null) continue
    if (!Number.isFinite(Number(raw))) return false
  }
  return true
}

export function isRecommendationPatchable(recommendation: Record<string, unknown>, variables: Array<Record<string, unknown>>): boolean {
  const variable = String(recommendation.variable ?? '')
  const stage = String(recommendation.stage ?? '')
  if (stage === 'global' && (variable === 'temperature' || variable === 'final_weight')) return true
  if (['exit_weight', 'exit_time', 'exit_pressure', 'exit_flow', 'exit_volume', 'limit_pressure', 'limit_flow', 'limit_weight'].includes(variable) && stage && stage !== 'global') return true
  const profileVariable = variables.find((item) => item.key === variable) ?? variables.find((item) => (
    termMatches(variable, String(item.key ?? '')) || termMatches(variable, String(item.name ?? ''))
  ))
  if (!profileVariable) return true
  if (String(profileVariable.key ?? '').startsWith('info_')) return false
  if (profileVariable.adjustable === false) return false
  return true
}
