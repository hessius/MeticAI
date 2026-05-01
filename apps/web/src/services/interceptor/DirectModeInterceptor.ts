import { STORAGE_KEYS } from '@/lib/constants'
import { createBrowserAIService } from '@/services/ai/BrowserAIService'
import { isNativePlatform, getDefaultMachineUrl } from '@/lib/machineMode'
import { resolveMachineUrl } from '@/services/machine/machineUrl'
import { getDirectRequestContext, isMeticAIProxyApiPath, jsonResponse } from './directModeHttp'
import { deriveStructuralTags } from '@/lib/profileAnalysis'
import type { AnalyzableProfile } from '@/lib/profileAnalysis'
import {
  addDirectDialInIteration,
  clearDirectHistory,
  completeDirectDialInSession,
  createDirectDialInSession,
  DirectStorageValidationError,
  deleteDirectDialInSession,
  deleteDirectHistoryEntry,
  deleteDirectShotAnnotation,
  generateDirectDialInRecommendations,
  getDirectAnnotationSummaries,
  getDirectDeletedHistoryIds,
  getDirectDialInSession,
  getDirectHistoryNotes,
  getDirectProfileImage,
  getDirectPourOverPreferences,
  getDirectShotAnnotation,
  listDirectDialInSessions,
  saveDirectHistoryNotes,
  saveDirectPourOverPreferences,
  saveDirectProfileImage,
  saveDirectShotAnnotation,
  updateDirectDialInRecommendations,
} from './directModeStorage'

// ── Private helpers ─────────────────────────────────────────────────────────

interface CachedProfile {
  id: string
  name: string
  change_id?: string
  author?: string
  temperature?: number
  final_weight?: number
  variables?: Array<Record<string, unknown>>
  stages?: Array<Record<string, unknown>>
  display?: { image?: string; description?: string; shortDescription?: string; accentColor?: string }
  [key: string]: unknown
}

interface MachineHistoryEntry {
  id: string
  time: number
  name?: string
  file?: string
  profile?: Record<string, unknown>
  data?: Array<{ shot?: { weight?: number }; time?: number; profile_time?: number }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeProfileIdent(value: unknown): CachedProfile | null {
  if (!isRecord(value)) return null
  const nestedProfile = isRecord(value.profile) ? value.profile : value
  const id = nestedProfile.id
  const name = nestedProfile.name
  if (typeof id !== 'string' || typeof name !== 'string') return null
  const normalized: CachedProfile = {
    ...nestedProfile,
    id,
    name,
  }
  if (typeof value.change_id === 'string') normalized.change_id = value.change_id
  return normalized
}

function stripDirectProfileMetadata(profile: CachedProfile): Record<string, unknown> {
  const machineProfile: Record<string, unknown> = { ...profile }
  delete machineProfile.change_id
  delete machineProfile.in_history
  delete machineProfile.has_description
  return machineProfile
}

function getDirectProfileImagePath(profile: CachedProfile): string | undefined {
  if (typeof profile.display?.image === 'string' && profile.display.image.trim()) {
    return profile.display.image
  }
  if (typeof profile.image === 'string' && profile.image.trim()) {
    return profile.image
  }
  return undefined
}

function normalizeHistoryEntry(entry: MachineHistoryEntry, notes: {
  notes: string | null
  notes_updated_at: string | null
} = { notes: null, notes_updated_at: null }) {
  return {
    id: entry.id,
    created_at: new Date(entry.time * 1000).toISOString(),
    profile_name: typeof entry.profile?.name === 'string' ? entry.profile.name : entry.name ?? 'Unknown',
    coffee_analysis: null,
    user_preferences: null,
    reply: '',
    profile_json: entry.profile ?? null,
    notes: notes.notes,
    notes_updated_at: notes.notes_updated_at,
  }
}

function getHistoryEntryDate(entry: MachineHistoryEntry): string {
  return new Date(entry.time * 1000).toISOString().split('T')[0]
}

function getHistoryEntryFilename(entry: MachineHistoryEntry): string {
  return entry.file ?? `${entry.id}.json`
}

function getHistoryProfileName(entry: MachineHistoryEntry): string {
  return typeof entry.profile?.name === 'string' ? entry.profile.name : entry.name ?? 'Unknown'
}

function getHistoryProfileId(entry: MachineHistoryEntry): string {
  return typeof entry.profile?.id === 'string' ? entry.profile.id : entry.id
}

function getHistoryMetrics(entry: MachineHistoryEntry): {
  final_weight: number | null
  total_time: number | null
} {
  const lastPoint = entry.data?.[entry.data.length - 1]
  const totalTimeMs = lastPoint?.profile_time ?? lastPoint?.time
  return {
    final_weight: lastPoint?.shot?.weight ?? (typeof entry.profile?.final_weight === 'number' ? entry.profile.final_weight : null),
    total_time: totalTimeMs ? totalTimeMs / 1000 : null,
  }
}

function normalizeLastShot(entry: MachineHistoryEntry) {
  return {
    profile_name: getHistoryProfileName(entry),
    date: getHistoryEntryDate(entry),
    filename: getHistoryEntryFilename(entry),
    timestamp: entry.time,
    ...getHistoryMetrics(entry),
  }
}

function hasRecentShotAnnotation(annotation?: { has_annotation: boolean; rating: number | null }): boolean {
  return annotation !== undefined && (annotation.has_annotation || annotation.rating !== null)
}

function safeNumber(value: unknown, fallback = 0): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

function optionalNumber(value: unknown): number | null {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10
}

const DIRECT_PROFILE_IMAGE_MAX_BYTES = 10 * 1024 * 1024

class DirectImageValidationError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'DirectImageValidationError'
  }
}

function blobBytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function isSupportedImageBytes(bytes: Uint8Array, mimeType: string): boolean {
  const normalizedType = mimeType.toLowerCase()
  if (normalizedType === 'image/png') {
    return bytes.length >= 8
      && bytes[0] === 0x89
      && bytes[1] === 0x50
      && bytes[2] === 0x4e
      && bytes[3] === 0x47
      && bytes[4] === 0x0d
      && bytes[5] === 0x0a
      && bytes[6] === 0x1a
      && bytes[7] === 0x0a
  }
  if (normalizedType === 'image/jpeg' || normalizedType === 'image/jpg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  if (normalizedType === 'image/gif') {
    const header = String.fromCharCode(...bytes.slice(0, 6))
    return header === 'GIF87a' || header === 'GIF89a'
  }
  if (normalizedType === 'image/webp') {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  }
  return false
}

function validateImageBytes(bytes: Uint8Array, mimeType: string): void {
  if (bytes.byteLength > DIRECT_PROFILE_IMAGE_MAX_BYTES) {
    throw new DirectImageValidationError('Image too large. Maximum size is 10MB', 413)
  }
  if (!mimeType.startsWith('image/')) {
    throw new DirectImageValidationError('File must be an image')
  }
  if (!isSupportedImageBytes(bytes, mimeType)) {
    throw new DirectImageValidationError('Invalid image data')
  }
}

async function blobToDataUri(blob: Blob): Promise<string> {
  if (blob.size > DIRECT_PROFILE_IMAGE_MAX_BYTES) {
    throw new DirectImageValidationError('Image too large. Maximum size is 10MB', 413)
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  validateImageBytes(bytes, blob.type || 'application/octet-stream')
  return `data:${blob.type || 'application/octet-stream'};base64,${blobBytesToBase64(bytes)}`
}

function estimateBase64DecodedBytes(payload: string): number {
  const normalizedPayload = payload.replace(/\s/g, '')
  const padding = normalizedPayload.endsWith('==') ? 2 : normalizedPayload.endsWith('=') ? 1 : 0
  return Math.floor(normalizedPayload.length / 4) * 3 - padding
}

function dataUriToBlob(dataUri: string): Blob {
  const match = dataUri.match(/^data:([^;,]+)(;base64)?,(.*)$/)
  if (!match) throw new DirectImageValidationError('Invalid image data - must be a data URI')
  const mimeType = match[1] || 'application/octet-stream'
  const payload = match[3]
  if (!mimeType.startsWith('image/')) throw new DirectImageValidationError('Invalid image data - must be a data URI')
  if (match[2] && estimateBase64DecodedBytes(payload) > DIRECT_PROFILE_IMAGE_MAX_BYTES) {
    throw new DirectImageValidationError('Image too large. Maximum size is 10MB', 413)
  }
  let binary: string
  try {
    binary = match[2] ? atob(payload) : decodeURIComponent(payload)
  } catch (err) {
    throw new DirectImageValidationError(`Failed to decode image data: ${err instanceof Error ? err.message : String(err)}`)
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  validateImageBytes(bytes, mimeType)
  return new Blob([bytes], { type: mimeType })
}

async function readJsonRequestBody(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  const request = input instanceof Request ? input.clone() : new Request(input, init)
  const body = await request.text()
  return body.trim() ? JSON.parse(body) : {}
}

function normalizeTerm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function termMatches(query: string, candidate: string): boolean {
  const queryTerm = normalizeTerm(query)
  const candidateTerm = normalizeTerm(candidate)
  if (!queryTerm || !candidateTerm) return false
  return candidateTerm.includes(queryTerm) || queryTerm.includes(candidateTerm)
}

function resolveProfileValue(value: unknown, variables: Array<Record<string, unknown>>): number {
  if (typeof value === 'string' && value.startsWith('$')) {
    const key = value.slice(1)
    const variable = variables.find((item) => item.key === key || item.name === key)
    return safeNumber(variable?.value)
  }
  return safeNumber(value)
}

function generateEstimatedTargetCurves(profile: CachedProfile): Array<Record<string, unknown>> {
  const stages = profile.stages ?? []
  const variables = profile.variables ?? []
  const defaultStageDuration = 10
  const weightStageMaxEstimate = 15
  const durations = stages.map((stage) => {
    const triggers = Array.isArray(stage.exit_triggers) ? stage.exit_triggers : []
    let timeTrigger: number | null = null
    let hasWeightTrigger = false
    for (const trigger of triggers) {
      if (!isRecord(trigger)) continue
      if (trigger.type === 'time') timeTrigger = resolveProfileValue(trigger.value, variables) || defaultStageDuration
      if (trigger.type === 'weight') hasWeightTrigger = true
    }
    if (timeTrigger === null) return defaultStageDuration
    return hasWeightTrigger ? Math.min(timeTrigger, weightStageMaxEstimate) : timeTrigger
  })

  const curves: Array<Record<string, unknown>> = []
  let runningTime = 0
  stages.forEach((stage, index) => {
    const stageName = typeof stage.name === 'string' ? stage.name : `Stage ${index + 1}`
    const stageType = typeof stage.type === 'string' ? stage.type : 'flow'
    const duration = durations[index] ?? defaultStageDuration
    const dynamics = isRecord(stage.dynamics) ? stage.dynamics : {}
    const points = Array.isArray(stage.dynamics_points)
      ? stage.dynamics_points
      : Array.isArray(dynamics.points)
        ? dynamics.points
        : []
    if (points.length === 0) {
      runningTime += duration
      return
    }
    const key = stageType === 'pressure'
      ? 'target_pressure'
      : stageType === 'power'
        ? 'target_power'
        : 'target_flow'
    const stageStart = runningTime
    const stageEnd = runningTime + duration
    if (points.length === 1 && Array.isArray(points[0])) {
      const value = resolveProfileValue(points[0][1] ?? points[0][0], variables)
      curves.push(
        { time: Number(stageStart.toFixed(2)), stage_name: stageName, [key]: Math.round(value * 10) / 10 },
        { time: Number(stageEnd.toFixed(2)), stage_name: stageName, [key]: Math.round(value * 10) / 10 },
      )
    } else {
      const maxX = Math.max(...points.filter(Array.isArray).map((point) => safeNumber(point[0])))
      const scale = maxX > 0 ? duration / maxX : 1
      for (const point of points) {
        if (!Array.isArray(point)) continue
        const value = resolveProfileValue(point[1] ?? point[0], variables)
        curves.push({
          time: Number((stageStart + safeNumber(point[0]) * scale).toFixed(2)),
          stage_name: stageName,
          [key]: Math.round(value * 10) / 10,
        })
      }
    }
    runningTime = stageEnd
  })
  return curves.sort((a, b) => safeNumber(a.time) - safeNumber(b.time))
}

type ProfileFingerprint = {
  controlMode: 'pressure' | 'flow' | 'mixed' | 'unknown'
  techniqueTags: Set<string>
  stageCount: number
  isFlat: boolean
  peakPressure: number
  temperature: number | null
  finalWeight: number | null
}

type ProfileRecommendation = {
  profile_name: string
  score: number
  explanation: string
  match_reasons: string[]
}

function getProfileStages(profile: CachedProfile): Array<Record<string, unknown>> {
  return Array.isArray(profile.stages) ? profile.stages : []
}

function getProfileTextTerms(profile: CachedProfile): string[] {
  const terms = [
    profile.name,
    profile.display?.description,
    profile.display?.shortDescription,
    ...getProfileStages(profile).map((stage) => String(stage.name ?? '')),
  ]
  return terms
    .flatMap((term) => normalizeTerm(String(term ?? '')).split(/\s+/))
    .filter(Boolean)
}

function extractProfileFingerprint(profile: CachedProfile): ProfileFingerprint {
  const stages = getProfileStages(profile)
  const stageTypes: string[] = []
  const techniqueTags = new Set<string>()
  let peakPressure = 0
  let isFlat = stages.length <= 2

  for (const stage of stages) {
    const stageType = typeof stage.type === 'string' ? stage.type.toLowerCase() : ''
    const stageName = typeof stage.name === 'string' ? stage.name.toLowerCase() : ''
    if (stageType) stageTypes.push(stageType)
    for (const keyword of ['preinfusion', 'pre-infusion', 'bloom', 'soak', 'pulse', 'lever', 'turbo', 'ramp', 'decline', 'taper']) {
      if (stageName.includes(keyword)) techniqueTags.add(keyword === 'soak' ? 'bloom' : keyword.replace('pre-infusion', 'preinfusion'))
    }

    const dynamics = isRecord(stage.dynamics) ? stage.dynamics : {}
    const points = Array.isArray(stage.dynamics_points)
      ? stage.dynamics_points
      : Array.isArray(dynamics.points)
        ? dynamics.points
        : []
    const values = points
      .filter(Array.isArray)
      .map((point) => resolveProfileValue(point[1] ?? point[0], profile.variables ?? []))
      .filter(Number.isFinite)
    if (stageType === 'pressure') peakPressure = Math.max(peakPressure, ...values, 0)
    if (values.length > 1 && new Set(values.map((value) => roundScore(value))).size > 1) isFlat = false
  }

  const pressureStages = stageTypes.filter((type) => type === 'pressure').length
  const flowStages = stageTypes.filter((type) => type === 'flow').length
  const controlMode = pressureStages > 0 && flowStages > 0
    ? 'mixed'
    : pressureStages > 0
      ? 'pressure'
      : flowStages > 0
        ? 'flow'
        : 'unknown'
  if (controlMode !== 'unknown') techniqueTags.add(`${controlMode}-profile`)
  if (isFlat) techniqueTags.add('flat')

  return {
    controlMode,
    techniqueTags,
    stageCount: stages.length,
    isFlat,
    peakPressure: roundScore(peakPressure),
    temperature: optionalNumber(profile.temperature),
    finalWeight: optionalNumber(profile.final_weight),
  }
}

function buildTagFingerprint(tags: string[]): ProfileFingerprint {
  const normalizedTags = tags.map(normalizeTerm)
  const techniqueTags = new Set<string>()
  const tagMap: Record<string, string> = {
    preinfusion: 'preinfusion',
    bloom: 'bloom',
    soak: 'bloom',
    pulse: 'pulse',
    lever: 'lever',
    turbo: 'turbo',
    ramp: 'ramp',
    decline: 'decline',
    taper: 'taper',
    flat: 'flat',
    pressure: 'pressure-profile',
    flow: 'flow-profile',
  }
  for (const tag of normalizedTags) {
    for (const [needle, technique] of Object.entries(tagMap)) {
      if (tag.includes(needle)) techniqueTags.add(technique)
    }
  }
  const controlMode = techniqueTags.has('pressure-profile')
    ? 'pressure'
    : techniqueTags.has('flow-profile')
      ? 'flow'
      : 'unknown'
  return {
    controlMode,
    techniqueTags,
    stageCount: techniqueTags.has('pulse') ? 5 : techniqueTags.has('bloom') || techniqueTags.has('preinfusion') ? 3 : 2,
    isFlat: techniqueTags.has('flat'),
    peakPressure: 0,
    temperature: null,
    finalWeight: null,
  }
}

function scoreProfile(tags: string[], target: ProfileFingerprint, candidate: CachedProfile): ProfileRecommendation {
  const candidateFingerprint = extractProfileFingerprint(candidate)
  const candidateTerms = getProfileTextTerms(candidate)
  const reasons: string[] = []
  let score = 0

  for (const tag of tags) {
    if (candidateTerms.some((term) => termMatches(tag, term))) {
      score += 20
      reasons.push(`Matching: ${tag}`)
    }
  }

  if (target.controlMode !== 'unknown' && candidateFingerprint.controlMode === target.controlMode) {
    score += 15
    reasons.push(`${candidateFingerprint.controlMode}-controlled`)
  } else if (target.controlMode !== 'unknown' && candidateFingerprint.controlMode === 'mixed') {
    score += 6
  }

  const techniqueOverlap = [...target.techniqueTags].filter((tag) => candidateFingerprint.techniqueTags.has(tag))
  if (techniqueOverlap.length > 0) {
    score += Math.min(25, techniqueOverlap.length * 10)
    reasons.push(`Techniques: ${techniqueOverlap.join(', ')}`)
  }

  if (target.stageCount && candidateFingerprint.stageCount) {
    const diff = Math.abs(target.stageCount - candidateFingerprint.stageCount)
    if (diff === 0) score += 8
    else if (diff === 1) score += 4
  }

  if (target.temperature !== null && candidateFingerprint.temperature !== null) {
    score += Math.max(0, 10 - Math.abs(target.temperature - candidateFingerprint.temperature) * 2)
  }
  if (target.finalWeight !== null && candidateFingerprint.finalWeight !== null) {
    score += Math.max(0, 10 - Math.abs(target.finalWeight - candidateFingerprint.finalWeight))
  }

  return {
    profile_name: candidate.name,
    score: Math.min(roundScore(score), 100),
    explanation: reasons.join('; '),
    match_reasons: [...new Set(reasons)],
  }
}

function recommendProfilesFromTags(profiles: CachedProfile[], tags: string[], limit: number): ProfileRecommendation[] {
  const target = buildTagFingerprint(tags)
  return profiles
    .map((profile) => scoreProfile(tags, target, profile))
    .filter((recommendation) => recommendation.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

function findSimilarProfiles(profiles: CachedProfile[], profileName: string, limit: number): ProfileRecommendation[] {
  const source = profiles.find((profile) => profile.name === profileName)
  if (!source) return []
  const target = extractProfileFingerprint(source)
  const tags = getProfileTextTerms(source)
  return profiles
    .filter((profile) => profile.name !== profileName)
    .map((profile) => scoreProfile(tags, target, profile))
    .filter((recommendation) => recommendation.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

function parseRecommendationsJson(analysisText: string): Array<Record<string, unknown>> {
  const match = analysisText.match(/RECOMMENDATIONS_JSON:\s*\n\s*(\[[\s\S]*?\])\s*\n\s*END_RECOMMENDATIONS_JSON/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[1])
    return Array.isArray(parsed) ? parsed.filter(isRecord) : []
  } catch {
    return []
  }
}

function isRecommendationPatchable(recommendation: Record<string, unknown>, variables: Array<Record<string, unknown>>): boolean {
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

function getCachedAnalysisText(profileName: string, shotFilename: string): string | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.ANALYSIS_CACHE) ?? '{}') as Record<string, unknown>
    const cacheValue = parsed[`${profileName}::${shotFilename}`]
    if (typeof cacheValue === 'string') return cacheValue
    if (isRecord(cacheValue) && typeof cacheValue.analysis === 'string') return cacheValue.analysis
  } catch {
    return null
  }
  return null
}

function cloneProfileForSave(profile: CachedProfile): CachedProfile {
  return JSON.parse(JSON.stringify(stripDirectProfileMetadata(profile))) as CachedProfile
}

function imageErrorStatus(err: unknown, defaultStatus = 500): number {
  if (err instanceof DirectImageValidationError) return err.status
  if (err instanceof DirectStorageValidationError) return err.message.includes('not found') ? 404 : 400
  return defaultStatus
}

function updateStageValue(
  stages: Array<Record<string, unknown>> | undefined,
  stageName: string,
  collectionKey: 'exit_triggers' | 'limits',
  typeMap: Record<string, string>,
  variable: string,
  value: number,
): { applied: boolean; reason?: string } {
  const targetType = typeMap[variable]
  if (!targetType || !stages) return { applied: false }
  const stage = stages.find((item) => String(item.name ?? '').toLowerCase() === stageName.toLowerCase())
  if (!stage) return { applied: false }
  const collection = Array.isArray(stage[collectionKey]) ? stage[collectionKey] as Array<Record<string, unknown>> : []
  const target = collection.find((item) => item.type === targetType)
  if (!target) return { applied: false, reason: `no ${targetType} ${collectionKey === 'limits' ? 'limit' : 'exit trigger'} in stage '${stageName}'` }
  target.value = value
  return { applied: true }
}


// ── Exported installer ──────────────────────────────────────────────────────

export function installDirectModeInterceptor(): void {
  const _originalFetch = window.fetch

  // In native mode (Capacitor), relative /api/... URLs must be prefixed with
  // the machine base URL since same-origin is the WebView, not the machine.
  const _isNative = isNativePlatform()

  function _fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (_isNative) {
      const machineBase = getDefaultMachineUrl()
      if (typeof input === 'string' && input.startsWith('/api/')) {
        return _originalFetch(`${machineBase}${input}`, init)
      }
      if (input instanceof URL && input.pathname.startsWith('/api/')) {
        return _originalFetch(new URL(input.pathname + input.search, machineBase), init)
      }
      if (input instanceof Request) {
        const reqUrl = new URL(input.url)
        if (reqUrl.pathname.startsWith('/api/')) {
          const prefixed = new URL(reqUrl.pathname + reqUrl.search, machineBase).toString()
          return _originalFetch(new Request(prefixed, input), init)
        }
      }
    }
    return _originalFetch(input, init)
  }

  // Cache profile list data so /api/profile/{name} and image-proxy lookups work
  const _profileCache = new Map<string, CachedProfile>()
  const PROFILE_LIST_CACHE_KEY = STORAGE_KEYS.PROFILE_LIST_CACHE

  function _processProfileList(data: unknown[]) {
    const profiles = data
      .map(normalizeProfileIdent)
      .filter((profile): profile is CachedProfile => profile !== null)
    _profileCache.clear()
    for (const p of profiles) _profileCache.set(p.name, p)
    const result = {
      profiles: profiles.map(p => ({
        ...p,
        in_history: true,
        has_description: !!(p.display?.description || p.display?.shortDescription),
        derived_tags: deriveStructuralTags(p as AnalyzableProfile),
      }))
    }
    try { localStorage.setItem(PROFILE_LIST_CACHE_KEY, JSON.stringify(result)) } catch { /* ignore */ }
    return result
  }

  // Restore profile cache from localStorage on startup
  try {
    const stored = localStorage.getItem(PROFILE_LIST_CACHE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed?.profiles) {
        for (const p of parsed.profiles) _profileCache.set(p.name, p)
      }
    }
  } catch { /* ignore */ }

  // ── Static profile description cache ──────────────────────────────────────
  // Stores the full "Profile Created / Description / Preparation / …" text
  // keyed by profile ID.  Persisted to localStorage and exposed on window so
  // App.tsx can read descriptions when navigating to profile detail.
  const DESC_CACHE_KEY = STORAGE_KEYS.DESCRIPTION_CACHE
  const _descriptionCache = new Map<string, string>()
  try {
    const stored = localStorage.getItem(DESC_CACHE_KEY)
    if (stored) {
      const parsed: Record<string, string> = JSON.parse(stored)
      for (const [k, v] of Object.entries(parsed)) _descriptionCache.set(k, v)
    }
  } catch { /* ignore */ }

  function _persistDescriptionCache() {
    try {
      const obj: Record<string, string> = {}
      _descriptionCache.forEach((v, k) => { obj[k] = v })
      localStorage.setItem(DESC_CACHE_KEY, JSON.stringify(obj))
    } catch { /* ignore */ }
  }

  // Expose on window for App.tsx to read
  ;(window as unknown as Record<string, unknown>).__meticaiDescriptionCache = _descriptionCache

  // Background: generate static descriptions for every profile on the machine.
  // Fetches each profile's JSON sequentially (1 at a time) to avoid overloading
  // the machine, then runs the client-side static analysis.
  async function _generateDescriptionsInBackground(profiles: CachedProfile[]) {
    const { buildStaticProfileDescription } = await import('@/lib/staticProfileDescription')
    for (const p of profiles) {
      if (_descriptionCache.has(p.id)) continue          // already described
      try {
        const r = await _fetch(`/api/v1/profile/get/${p.id}`)
        if (!r.ok) continue
        const profileJson = await r.json()
        const desc = buildStaticProfileDescription(profileJson)
        _descriptionCache.set(p.id, desc)
      } catch { /* non-critical */ }
    }
    _persistDescriptionCache()
  }

  // Background prefetch: refresh profile list on startup so catalogue loads instantly
  // Only run after onboarding is complete — before that, no machine URL is configured
  if (localStorage.getItem(STORAGE_KEYS.ONBOARDING_COMPLETE)) {
    setTimeout(() => {
      _fetch('/api/v1/profile/list')
        .then(r => r.ok ? r.json() : null)
        .then((data: CachedProfile[] | null) => {
          if (data) {
            _processProfileList(data)
            _generateDescriptionsInBackground(data)
          }
        })
        .catch(() => { /* non-critical */ })
    }, 2000)
  }

  async function _loadProfilesFromMachine(): Promise<CachedProfile[]> {
    const response = await _fetch('/api/v1/profile/list')
    if (!response.ok) {
      const cached = localStorage.getItem(PROFILE_LIST_CACHE_KEY)
      if (cached) {
        try {
          const parsed = JSON.parse(cached)
          if (parsed?.profiles) {
            _profileCache.clear()
            for (const p of parsed.profiles) _profileCache.set(p.name, p)
            return parsed.profiles
          }
        } catch { /* corrupted cache */ }
      }
      return []
    }
    const raw = await response.json()
    const result = _processProfileList(Array.isArray(raw) ? raw : [])
    return result.profiles
  }

  async function _findProfileByName(profileName: string): Promise<CachedProfile | null> {
    const cached = _profileCache.get(profileName)
    if (cached) return cached
    const profiles = await _loadProfilesFromMachine()
    return profiles.find((profile) => profile.name === profileName) ?? null
  }

  async function _loadHistory(): Promise<MachineHistoryEntry[]> {
    const response = await _fetch('/api/v1/history')
    if (!response.ok) return []
    const raw = await response.json()
    return Array.isArray(raw)
      ? raw as MachineHistoryEntry[]
      : (isRecord(raw) && Array.isArray(raw.history) ? raw.history as MachineHistoryEntry[] : [])
  }

  async function _loadVisibleHistory(): Promise<MachineHistoryEntry[]> {
    const [history, deletedIds] = await Promise.all([_loadHistory(), getDirectDeletedHistoryIds()])
    return history.filter((entry) => !deletedIds.has(entry.id))
  }

  async function _findVisibleShot(date: string, filename: string): Promise<MachineHistoryEntry | null> {
    const history = await _loadVisibleHistory()
    return history.find((entry) => (
      getHistoryEntryDate(entry) === date && getHistoryEntryFilename(entry) === filename
    )) ?? null
  }

  async function _saveProfileImageData(profileName: string, imageDataUri: string): Promise<{
    profile: CachedProfile
    imageBlob: Blob
  }> {
    if (!imageDataUri.startsWith('data:image/')) {
      throw new DirectStorageValidationError('Invalid image data - must be a data URI')
    }
    const profile = await _findProfileByName(profileName)
    if (!profile) throw new DirectStorageValidationError(`Profile '${profileName}' not found on machine`)

    const imageBlob = dataUriToBlob(imageDataUri)

    // Save image to local IndexedDB — this is the primary source for image-proxy.
    // Do NOT embed the data URI in display.image when saving to the machine:
    // AI-generated images can be several MB and the machine rejects oversized payloads.
    await saveDirectProfileImage(profile.id, imageBlob)

    const cached: CachedProfile = { ...profile, display: { ...(isRecord(profile.display) ? profile.display : {}), image: imageDataUri } }
    _profileCache.set(cached.name, cached)
    return { profile: cached, imageBlob }
  }

  // ── Pour-over profile adapters (ported from backend pour_over_adapter.py / recipe_adapter.py) ──

  const _POUR_OVER_BASE = {
    name: 'MeticAI Ratio Pour-Over',
    id: '', // will be replaced
    author: 'MeticAI',
    author_id: '',
    display: { accentColor: '#566656' },
    temperature: 0,
    final_weight: 300,
    variables: [{ name: 'Zero', key: 'power_Zero', type: 'power', value: 0 }],
    stages: [
      {
        name: 'Bloom (30s)', key: 'power_1', type: 'power',
        dynamics: { points: [[0, '$power_Zero'], [10, '$power_Zero']], over: 'time', interpolation: 'curve' },
        exit_triggers: [{ type: 'time', value: 30, relative: false, comparison: '>=' }],
        limits: [],
      },
      {
        name: 'Infusion (300g)', key: 'power_2', type: 'power',
        dynamics: { points: [[0, '$power_Zero'], [10, '$power_Zero']], over: 'time', interpolation: 'curve' },
        exit_triggers: [{ type: 'weight', value: 300, relative: false, comparison: '>=' }],
        limits: [],
      },
    ],
  }

  const _STAGE_TEMPLATE = {
    type: 'power',
    dynamics: { points: [[0, '$power_Zero'], [10, '$power_Zero']], over: 'time', interpolation: 'curve' },
    limits: [],
  }

  function _uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
    })
  }

  function _adaptPourOverProfile(opts: { targetWeight: number; bloomEnabled: boolean; bloomSeconds: number; doseGrams: number | null; brewRatio: number | null }) {
    const profile = JSON.parse(JSON.stringify(_POUR_OVER_BASE))
    profile.id = _uuid()
    profile.author_id = _uuid()
    profile.final_weight = opts.targetWeight
    const weightLabel = `${Math.round(opts.targetWeight)}g`

    // Short description
    const parts = [`Target: ${weightLabel}`]
    if (opts.doseGrams) parts.push(`Dose: ${opts.doseGrams.toFixed(1)}g`)
    if (opts.brewRatio) parts.push(`Ratio: 1:${opts.brewRatio.toFixed(1)}`)
    profile.display = { ...profile.display, shortDescription: parts.join(' | ').slice(0, 99) }

    const stages = profile.stages
    if (opts.bloomEnabled && stages.length >= 2) {
      stages[0].name = `Bloom (${Math.round(opts.bloomSeconds)}s)`
      for (const t of stages[0].exit_triggers) if (t.type === 'time') t.value = opts.bloomSeconds
      stages[1].name = `Infusion (${weightLabel})`
      for (const t of stages[1].exit_triggers) if (t.type === 'weight') t.value = opts.targetWeight
      // Add 10-min time backup if missing
      if (!stages[1].exit_triggers.some((t: { type: string }) => t.type === 'time')) {
        stages[1].exit_triggers.push({ type: 'time', value: 600, relative: true, comparison: '>=' })
      }
    } else if (!opts.bloomEnabled && stages.length >= 2) {
      const infusion = stages[1]
      infusion.name = `Infusion (${weightLabel})`
      infusion.key = 'power_1'
      for (const t of infusion.exit_triggers) if (t.type === 'weight') t.value = opts.targetWeight
      if (!infusion.exit_triggers.some((t: { type: string }) => t.type === 'time')) {
        infusion.exit_triggers.push({ type: 'time', value: 600, relative: true, comparison: '>=' })
      }
      profile.stages = [infusion]
    }
    return profile
  }

  interface OPOSStep { step?: number; action: string; water_g?: number; duration_s?: number; notes?: string }

  function _adaptRecipeToProfile(recipe: { metadata?: { name?: string }; ingredients?: { water_g?: number; coffee_g?: number }; protocol?: OPOSStep[] }) {
    const profile = JSON.parse(JSON.stringify(_POUR_OVER_BASE))
    profile.id = _uuid()
    profile.author_id = _uuid()
    const recipeName = recipe.metadata?.name ?? 'Recipe'
    profile.name = `MeticAI Recipe: ${recipeName}`
    const totalWater = Number(recipe.ingredients?.water_g ?? 0)
    const coffeeG = Number(recipe.ingredients?.coffee_g ?? 0) || null
    profile.final_weight = totalWater

    const parts = [`Target: ${Math.round(totalWater)}g`]
    if (coffeeG) {
      parts.push(`Dose: ${Math.round(coffeeG)}g`)
      parts.push(`Ratio: 1:${(totalWater / coffeeG).toFixed(1)}`)
    }
    profile.display = { ...profile.display, shortDescription: parts.join(' | ').slice(0, 99) }

    const stages: typeof _POUR_OVER_BASE.stages = []
    let cumulativeWater = 0
    let pourCount = 0

    for (const step of (recipe.protocol ?? [])) {
      const action = step.action ?? ''
      const waterG = Number(step.water_g ?? 0)
      const durationS = Number(step.duration_s ?? 30)
      const stage = JSON.parse(JSON.stringify(_STAGE_TEMPLATE))
      stage.key = `power_${stages.length + 1}`

      if (action === 'bloom' || action === 'pour') {
        cumulativeWater += waterG
        if (action === 'bloom') {
          stage.name = `Bloom (${Math.round(waterG)}g / ${Math.round(durationS)}s)`
          stage.exit_triggers = [{ type: 'time', value: durationS, relative: true, comparison: '>=' }]
        } else {
          pourCount++
          stage.name = `Pour ${pourCount} (to ${Math.round(cumulativeWater)}g)`
          stage.exit_triggers = [
            { type: 'weight', value: cumulativeWater, relative: false, comparison: '>=' },
            { type: 'time', value: 600, relative: true, comparison: '>=' },
          ]
        }
      } else if (action === 'wait' || action === 'swirl' || action === 'stir') {
        stage.name = action === 'swirl' ? 'Swirl' : action === 'stir' ? 'Stir' : `Wait (${Math.round(durationS)}s)`
        stage.exit_triggers = [{ type: 'time', value: durationS, relative: true, comparison: '>=' }]
      } else {
        continue
      }

      stages.push(stage)
    }

    profile.stages = stages
    return profile
  }

  window.fetch = function directModeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const { url, method, pathname } = getDirectRequestContext(input, init)
    const isDialInAliasPath = pathname === '/dialin/sessions' || pathname.startsWith('/dialin/sessions/')
    const dialInPathname = isDialInAliasPath ? `/api${pathname}` : pathname

    // Allow Meticulous machine API (/api/v1/...) and external/non-api URLs
    if (!isMeticAIProxyApiPath(url) && !isDialInAliasPath) {
      return _fetch(input, init)
    }

    // ── Translate key MeticAI proxy endpoints to Meticulous native API ──

    // POST /api/machine/run-profile/:id → load profile → start
    const runMatch = url.match(/\/api\/machine\/run-profile\/([^/?]+)/)
    if (runMatch && method === 'POST') {
      const profileId = decodeURIComponent(runMatch[1])
      return (async () => {
        // Try loading directly first
        let loadResp = await _fetch(`/api/v1/profile/load/${profileId}`)
        if (!loadResp.ok) {
          // Machine is busy — send stop, then retry with backoff
          await _fetch('/api/v1/action/stop')
          for (let attempt = 0; attempt < 10; attempt++) {
            await new Promise(r => setTimeout(r, 2000))
            loadResp = await _fetch(`/api/v1/profile/load/${profileId}`)
            if (loadResp.ok) break
            const body = await loadResp.json().catch(() => ({})) as {error?: string}
            if (body.error !== 'machine is busy') {
              return jsonResponse({ status: 'error', detail: body.error || 'Load failed' }, 502)
            }
          }
          if (!loadResp.ok) {
            return jsonResponse({ status: 'error', detail: 'Machine busy — try again' }, 409)
          }
        }
        const startResp = await _fetch('/api/v1/action/start')
        return startResp.ok
          ? jsonResponse({ status: 'success', message: 'Profile started' })
          : jsonResponse({ status: 'error', detail: 'Failed to start' }, 502)
      })()
    }

    // POST /api/machine/run-profile-with-overrides/:id → not supported in direct mode
    const runOverridesMatch = url.match(/\/api\/machine\/run-profile-with-overrides\/([^/?]+)/)
    if (runOverridesMatch && method === 'POST') {
      return jsonResponse({ detail: 'Variable overrides are not supported in direct mode' }, 501)
    }

    // POST /api/machine/command/start → GET /api/v1/action/start
    if (url.match(/\/api\/machine\/command\/start/) && method === 'POST') {
      return _fetch('/api/v1/action/start').then(r =>
        r.ok ? jsonResponse({ success: true }) : jsonResponse({ success: false }, 502)
      ).catch(() => jsonResponse({ success: false }, 502))
    }

    // POST /api/machine/command/stop → GET /api/v1/action/stop
    if (url.match(/\/api\/machine\/command\/stop/) && method === 'POST') {
      return _fetch('/api/v1/action/stop').then(r =>
        r.ok ? jsonResponse({ success: true }) : jsonResponse({ success: false }, 502)
      ).catch(() => jsonResponse({ success: false }, 502))
    }

    // POST /api/machine/command/load-profile → load by name
    if (url.match(/\/api\/machine\/command\/load-profile/) && method === 'POST') {
      return new Response(init?.body || '{}').json().then((body: {name?: string}) => {
        if (!body.name) return jsonResponse({ success: false, message: 'No profile name' }, 400)
        // Find profile ID by name, then load it
        return _loadProfilesFromMachine().then((profiles) => {
          const match = profiles.find(p => p.name === body.name)
          if (!match) return jsonResponse({ success: false, message: 'Profile not found' }, 404)
          return _fetch(`/api/v1/profile/load/${match.id}`).then(r =>
            r.ok ? jsonResponse({ success: true }) : jsonResponse({ success: false }, 502)
          )
        })
      }).catch(() => jsonResponse({ success: false }, 502))
    }

    // /api/dialin/* → local direct/capacitor session store with backend-compatible shapes.
    if (dialInPathname === '/api/dialin/sessions' && method === 'POST') {
      return (async () => {
        try {
          const session = await createDirectDialInSession(await readJsonRequestBody(input, init))
          return jsonResponse(session, 201)
        } catch (err) {
          const status = err instanceof DirectStorageValidationError ? err.status : 400
          const detail = err instanceof Error ? err.message : 'Invalid dial-in session'
          return jsonResponse({ detail }, status)
        }
      })()
    }

    if (dialInPathname === '/api/dialin/sessions' && method === 'GET') {
      return (async () => {
        try {
          const status = new URL(url, window.location.origin).searchParams.get('status')
          return jsonResponse({ sessions: await listDirectDialInSessions(status) })
        } catch (err) {
          const status = err instanceof DirectStorageValidationError ? err.status : 400
          const detail = err instanceof Error ? err.message : 'Failed to list dial-in sessions'
          return jsonResponse({ detail }, status)
        }
      })()
    }

    const dialInRecommendMatch = dialInPathname.match(/^\/api\/dialin\/sessions\/([^/]+)\/recommend$/)
    if (dialInRecommendMatch && method === 'POST') {
      return generateDirectDialInRecommendations(decodeURIComponent(dialInRecommendMatch[1]))
        .then((result) => jsonResponse(result))
        .catch((err) => {
          const status = err instanceof DirectStorageValidationError ? err.status : 500
          const detail = err instanceof Error ? err.message : 'Failed to generate recommendations'
          return jsonResponse({ detail }, status)
        })
    }

    const dialInCompleteMatch = dialInPathname.match(/^\/api\/dialin\/sessions\/([^/]+)\/complete$/)
    if (dialInCompleteMatch && method === 'POST') {
      return completeDirectDialInSession(decodeURIComponent(dialInCompleteMatch[1]))
        .then((session) => jsonResponse(session))
        .catch((err) => {
          const status = err instanceof DirectStorageValidationError ? err.status : 500
          const detail = err instanceof Error ? err.message : 'Failed to complete session'
          return jsonResponse({ detail }, status)
        })
    }

    const dialInRecommendationsMatch = dialInPathname.match(/^\/api\/dialin\/sessions\/([^/]+)\/iterations\/(\d+)\/recommendations$/)
    if (dialInRecommendationsMatch && method === 'PUT') {
      return (async () => {
        try {
          const iteration = await updateDirectDialInRecommendations(
            decodeURIComponent(dialInRecommendationsMatch[1]),
            Number(dialInRecommendationsMatch[2]),
            await readJsonRequestBody(input, init),
          )
          return jsonResponse(iteration)
        } catch (err) {
          const status = err instanceof DirectStorageValidationError ? err.status : 500
          const detail = err instanceof Error ? err.message : 'Failed to update recommendations'
          return jsonResponse({ detail }, status)
        }
      })()
    }

    const dialInIterationsMatch = dialInPathname.match(/^\/api\/dialin\/sessions\/([^/]+)\/iterations$/)
    if (dialInIterationsMatch && method === 'POST') {
      return (async () => {
        try {
          const iteration = await addDirectDialInIteration(
            decodeURIComponent(dialInIterationsMatch[1]),
            await readJsonRequestBody(input, init),
          )
          return jsonResponse(iteration, 201)
        } catch (err) {
          const status = err instanceof DirectStorageValidationError ? err.status : 500
          const detail = err instanceof Error ? err.message : 'Failed to add iteration'
          return jsonResponse({ detail }, status)
        }
      })()
    }

    const dialInSessionMatch = dialInPathname.match(/^\/api\/dialin\/sessions\/([^/]+)$/)
    if (dialInSessionMatch && method === 'GET') {
      return getDirectDialInSession(decodeURIComponent(dialInSessionMatch[1]))
        .then((session) => session ? jsonResponse(session) : jsonResponse({ detail: 'Session not found' }, 404))
    }
    if (dialInSessionMatch && method === 'DELETE') {
      return deleteDirectDialInSession(decodeURIComponent(dialInSessionMatch[1]))
        .then((deleted) => deleted ? jsonResponse({ deleted: true }) : jsonResponse({ detail: 'Session not found' }, 404))
    }

    // POST /api/profile/import → save to machine (file import) or no-op (machine import)
    if (url.match(/\/api\/profile\/import$/) && method === 'POST') {
      return (async () => {
        try {
          const body = await new Response(init?.body || '{}').json() as {
            profile?: Record<string, unknown>; source?: string; generate_description?: boolean
          }
          const profileName = (body.profile as {name?: string})?.name || 'Unknown'
          if (body.source === 'file' && body.profile) {
            // Upload profile to machine
            const saveResp = await _fetch('/api/v1/profile/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body.profile),
            })
            if (!saveResp.ok) {
              return jsonResponse({ status: 'error', detail: 'Failed to save profile to machine' }, 502)
            }
          }
          return jsonResponse({
            status: 'success',
            entry_id: 'direct-' + Date.now(),
            profile_name: profileName,
            has_description: false,
            uploaded_to_machine: true,
          })
        } catch {
          return jsonResponse({ status: 'error', detail: 'Import failed' }, 500)
        }
      })()
    }

    // POST /api/profile/import-all → return success (profiles already on machine)
    if (url.match(/\/api\/profile\/import-all/) && method === 'POST') {
      return Promise.resolve(jsonResponse({
        status: 'success',
        imported: 0,
        skipped: 0,
        message: 'All profiles already on machine',
      }))
    }


    // POST /api/import-from-url -> fetch URL, parse profile JSON, save to machine
    if (url.match(/\/api\/import-from-url/) && method === 'POST') {
      return (async () => {
        try {
          const body = await new Response(init?.body || '{}').json() as { url?: string }
          const profileUrl = body.url?.trim()
          if (!profileUrl) return jsonResponse({ status: 'error', detail: 'No URL provided' }, 400)
          let profileResp: Response
          try { profileResp = await _fetch(profileUrl) } catch { return jsonResponse({ status: 'error', detail: 'Failed to fetch URL' }, 502) }
          let profileJson: Record<string, unknown>
          try { profileJson = await profileResp.json() } catch { return jsonResponse({ status: 'error', detail: 'URL did not return valid JSON' }, 400) }
          if (typeof profileJson.name !== 'string' || !profileJson.name) return jsonResponse({ status: 'error', detail: "Profile is missing a 'name' field" }, 400)
          const saveResp = await _fetch('/api/v1/profile/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profileJson) })
          if (!saveResp.ok) return jsonResponse({ status: 'error', detail: 'Failed to save profile to machine' }, 502)
          return jsonResponse({ status: 'success', entry_id: 'direct-' + Date.now(), profile_name: profileJson.name as string, has_description: false, uploaded_to_machine: true })
        } catch { return jsonResponse({ status: 'error', detail: 'Import from URL failed' }, 500) }
      })()
    }

    // POST /api/profiles/recommend → deterministic direct profile recommendations
    if (pathname === '/api/profiles/recommend' && method === 'POST') {
      return (async () => {
        const request = input instanceof Request ? input : new Request(input, init)
        const form = await request.formData()
        const tags = form.getAll('tags').map((tag) => String(tag)).filter(Boolean)
        const limit = Math.max(1, safeNumber(form.get('limit'), 5))
        const profiles = await _loadProfilesFromMachine()
        const recommendations = recommendProfilesFromTags(profiles, tags, limit)
        return jsonResponse({ status: 'success', recommendations, count: recommendations.length })
      })().catch((err) => jsonResponse({ detail: err instanceof Error ? err.message : 'Failed to get recommendations' }, 500))
    }

    // POST /api/profiles/find-similar → deterministic direct profile similarity
    if (pathname === '/api/profiles/find-similar' && method === 'POST') {
      return (async () => {
        const request = input instanceof Request ? input : new Request(input, init)
        const form = await request.formData()
        const profileName = String(form.get('profile_name') ?? '')
        const limit = Math.max(1, safeNumber(form.get('limit'), 10))
        const profiles = await _loadProfilesFromMachine()
        const recommendations = findSimilarProfiles(profiles, profileName, limit)
        return jsonResponse({ status: 'success', recommendations, count: recommendations.length })
      })().catch((err) => jsonResponse({ detail: err instanceof Error ? err.message : 'Failed to find similar profiles' }, 500))
    }

    // PATCH /api/machine/profile/:id → rename a machine profile through profile/save
    const renameMatch = pathname.match(/^\/api\/machine\/profile\/([^/?]+)$/)
    if (renameMatch && method === 'PATCH') {
      return (async () => {
        const profileId = decodeURIComponent(renameMatch[1])
        const request = input instanceof Request ? input : new Request(input, init)
        let body: { name?: unknown }
        try {
          body = await request.json() as { name?: unknown }
        } catch {
          return jsonResponse({ detail: 'Invalid profile update body' }, 400)
        }

        const newName = typeof body.name === 'string' ? body.name.trim() : ''
        if (!newName) {
          return jsonResponse({ detail: "At least one field to update is required (e.g., 'name')" }, 400)
        }

        const profileResp = await _fetch(`/api/v1/profile/get/${encodeURIComponent(profileId)}`)
        if (!profileResp.ok) {
          return jsonResponse({ detail: `Profile not found: ${profileId}` }, 404)
        }

        const profileJson = await profileResp.json() as Record<string, unknown>
        const oldName = typeof profileJson.name === 'string' && profileJson.name ? profileJson.name : profileId
        const updatedProfile = { ...profileJson, name: newName }
        const saveResp = await _fetch('/api/v1/profile/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedProfile),
        })
        if (!saveResp.ok) {
          return jsonResponse({ detail: 'Failed to save profile to machine' }, 502)
        }
        _profileCache.clear()
        localStorage.removeItem(PROFILE_LIST_CACHE_KEY)
        return jsonResponse({
          status: 'success',
          message: `Profile renamed from '${oldName}' to '${newName}'`,
          profile_id: profileId,
          old_name: oldName,
          new_name: newName,
        })
      })().catch((err) => jsonResponse({ detail: err instanceof Error ? err.message : 'Failed to rename profile' }, 500))
    }

    // DELETE /api/machine/profile/:id → DELETE /api/v1/profile/delete/:id
    const deleteMatch = url.match(/\/api\/machine\/profile\/([^/?]+)$/)
    if (deleteMatch && method === 'DELETE') {
      return _fetch(`/api/v1/profile/delete/${deleteMatch[1]}`, { method: 'DELETE' })
        .then(r => r.ok ? jsonResponse({ success: true }) : jsonResponse({ success: false }, 502))
        .catch(() => jsonResponse({ success: false }, 502))
    }

    // POST /api/machine/profile/load → load by ID on machine
    if (url.match(/\/api\/machine\/profile\/load$/) && method === 'POST') {
      return (async () => {
        try {
          const { profile_id } = await new Response(init?.body || '{}').json() as { profile_id?: string }
          if (!profile_id) return jsonResponse({ success: false, message: 'No profile_id' }, 400)
          let loadResp = await _fetch(`/api/v1/profile/load/${profile_id}`)
          if (!loadResp.ok) {
            // Machine may be busy — send stop, then retry
            await _fetch('/api/v1/action/stop')
            await new Promise(r => setTimeout(r, 2000))
            loadResp = await _fetch(`/api/v1/profile/load/${profile_id}`)
          }
          if (!loadResp.ok) return jsonResponse({ success: false }, 502)
          return jsonResponse({ success: true })
        } catch {
          return jsonResponse({ success: false }, 500)
        }
      })()
    }

    // GET /api/machine/profiles → /api/v1/profile/list (add in_history/has_description, populate cache)
    if (url.match(/\/api\/machine\/profiles$/)) {
      return _fetch('/api/v1/profile/list').then(r => {
        if (!r.ok) {
          const cached = localStorage.getItem(PROFILE_LIST_CACHE_KEY)
          if (cached) {
            try { return jsonResponse(JSON.parse(cached)) } catch { /* corrupted cache */ }
          }
          return jsonResponse({ profiles: [] })
        }
        return r.json().then((data: CachedProfile[]) => jsonResponse(_processProfileList(data)))
      }).catch(() => {
        const cached = localStorage.getItem(PROFILE_LIST_CACHE_KEY)
        if (cached) {
          try { return jsonResponse(JSON.parse(cached)) } catch { /* corrupted cache */ }
        }
        return jsonResponse({ profiles: [] })
      })
    }

    // /api/machine/profile/:id/json → /api/v1/profile/get/:id (wrap in {profile})
    const profileJsonMatch = url.match(/\/api\/machine\/profile\/([^/]+)\/json/)
    if (profileJsonMatch) {
      return _fetch(`/api/v1/profile/get/${profileJsonMatch[1]}`).then(r => {
        if (!r.ok) return jsonResponse({})
        return r.json().then((data: unknown) => jsonResponse({ profile: data }))
      }).catch(() => jsonResponse({}))
    }

    // POST /api/profile/{name}/image → upload a direct image and persist it to the machine profile
    const profileImageUploadMatch = pathname.match(/^\/api\/profile\/([^/]+)\/image$/)
    if (profileImageUploadMatch && method === 'POST') {
      return (async () => {
        const name = decodeURIComponent(profileImageUploadMatch[1])
        const request = input instanceof Request ? input : new Request(input, init)
        const form = await request.formData()
        const file = form.get('file')
        if (!(file instanceof Blob) || !file.type.startsWith('image/')) {
          return jsonResponse({ detail: 'File must be an image' }, 400)
        }
        const imageDataUri = await blobToDataUri(file)
        const { profile } = await _saveProfileImageData(name, imageDataUri)
        return jsonResponse({
          status: 'success',
          message: `Image uploaded for profile '${name}'`,
          profile_id: profile.id,
          image_size: imageDataUri.length,
        })
      })().catch((err) => {
        const status = imageErrorStatus(err)
        return jsonResponse({ detail: err instanceof Error ? err.message : 'Failed to upload profile image' }, status)
      })
    }

    // POST /api/profile/{name}/generate-image → BrowserAI direct profile image generation
    const profileGenerateImageMatch = pathname.match(/^\/api\/profile\/([^/]+)\/generate-image$/)
    if (profileGenerateImageMatch && method === 'POST') {
      return (async () => {
        const name = decodeURIComponent(profileGenerateImageMatch[1])
        const parsedUrl = new URL(url, window.location.origin)
        const style = parsedUrl.searchParams.get('style') || 'abstract'
        const tags = (parsedUrl.searchParams.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean)
        const preview = parsedUrl.searchParams.get('preview') === 'true'
        const aiService = createBrowserAIService()
        if (!aiService.isConfigured()) {
          return jsonResponse({ detail: 'AI features are unavailable. Please configure a Gemini API key in Settings.' }, 503)
        }
        const imageBlob = await aiService.generateImage({ profileName: name, style, tags, preview })
        const imageDataUri = await blobToDataUri(imageBlob)
        if (preview) {
          return jsonResponse({
            status: 'preview',
            message: `Preview image generated for profile '${name}'`,
            style,
            image_data: imageDataUri,
          })
        }
        const { profile } = await _saveProfileImageData(name, imageDataUri)
        return jsonResponse({
          status: 'success',
          message: `Image generated for profile '${name}'`,
          profile_id: profile.id,
          style,
        })
      })().catch((err) => jsonResponse({ detail: err instanceof Error ? err.message : 'Failed to generate profile image' }, imageErrorStatus(err)))
    }

    // POST /api/profile/{name}/apply-image → persist a generated preview image to the machine profile
    const profileApplyImageMatch = pathname.match(/^\/api\/profile\/([^/]+)\/apply-image$/)
    if (profileApplyImageMatch && method === 'POST') {
      return (async () => {
        const name = decodeURIComponent(profileApplyImageMatch[1])
        const request = input instanceof Request ? input : new Request(input, init)
        const body = await request.json() as { image_data?: string }
        if (!body.image_data) return jsonResponse({ detail: 'Invalid image data - must be a data URI' }, 400)
        const { profile } = await _saveProfileImageData(name, body.image_data)
        return jsonResponse({
          status: 'success',
          message: `Image applied to profile '${name}'`,
          profile_id: profile.id,
        })
      })().catch((err) => {
        const status = imageErrorStatus(err)
        return jsonResponse({ detail: err instanceof Error ? err.message : 'Failed to apply profile image' }, status)
      })
    }

    // POST /api/profile/{name}/apply-recommendations → patch profile variables and save directly
    const profileApplyRecommendationsMatch = pathname.match(/^\/api\/profile\/([^/]+)\/apply-recommendations$/)
    if (profileApplyRecommendationsMatch && method === 'POST') {
      return (async () => {
        const name = decodeURIComponent(profileApplyRecommendationsMatch[1])
        const request = input instanceof Request ? input : new Request(input, init)
        const form = await request.formData()
        const rawRecommendations = String(form.get('recommendations') ?? '[]')
        const parsed = JSON.parse(rawRecommendations)
        if (!Array.isArray(parsed)) return jsonResponse({ detail: 'recommendations must be a JSON array' }, 400)
        const profile = await _findProfileByName(name)
        if (!profile) return jsonResponse({ detail: `Profile '${name}' not found on machine` }, 404)
        const updated = cloneProfileForSave(profile)
        const applied: Array<Record<string, unknown>> = []
        const skipped: Array<Record<string, unknown>> = []

        for (const recommendation of parsed) {
          if (!isRecord(recommendation)) {
            skipped.push({ variable: '?', reason: 'invalid entry (not an object)' })
            continue
          }
          const variable = String(recommendation.variable ?? '')
          const stage = String(recommendation.stage ?? '')
          const recommendedValue = optionalNumber(recommendation.recommended_value)
          if (recommendedValue === null) {
            skipped.push({ variable, reason: 'invalid recommended_value' })
            continue
          }
          if (stage === 'global' && variable === 'temperature') {
            updated.temperature = recommendedValue
            applied.push({ variable, stage, value: recommendedValue })
            continue
          }
          if (stage === 'global' && variable === 'final_weight') {
            updated.final_weight = recommendedValue
            applied.push({ variable, stage, value: recommendedValue })
            continue
          }
          const profileVariable = updated.variables?.find((item) => item.key === variable)
          if (profileVariable) {
            if (String(profileVariable.key ?? '').startsWith('info_') || profileVariable.adjustable === false) {
              skipped.push({ variable, reason: 'info-only / not adjustable' })
            } else {
              profileVariable.value = recommendedValue
              applied.push({ variable, stage, value: recommendedValue })
            }
            continue
          }
          const exitTriggerResult = updateStageValue(
            updated.stages,
            stage,
            'exit_triggers',
            {
              exit_weight: 'weight',
              exit_time: 'time',
              exit_pressure: 'pressure',
              exit_flow: 'flow',
              exit_volume: 'volume',
            },
            variable,
            recommendedValue,
          )
          if (exitTriggerResult.applied) {
            applied.push({ variable, stage, value: recommendedValue })
            continue
          }
          if (exitTriggerResult.reason) {
            skipped.push({ variable, reason: exitTriggerResult.reason })
            continue
          }
          const limitResult = updateStageValue(
            updated.stages,
            stage,
            'limits',
            {
              limit_pressure: 'pressure',
              limit_flow: 'flow',
              limit_weight: 'weight',
            },
            variable,
            recommendedValue,
          )
          if (limitResult.applied) {
            applied.push({ variable, stage, value: recommendedValue })
            continue
          }
          if (limitResult.reason) {
            skipped.push({ variable, reason: limitResult.reason })
            continue
          }
          skipped.push({ variable, reason: 'variable not found in profile' })
        }

        if (applied.length === 0) {
          return jsonResponse({
            status: 'no_changes',
            message: 'No applicable recommendations to apply',
            applied,
            skipped,
          })
        }
        const saveResponse = await _fetch('/api/v1/profile/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated),
        })
        if (!saveResponse.ok) return jsonResponse({ detail: 'Failed to save profile to machine' }, 502)
        _profileCache.set(updated.name, updated)
        return jsonResponse({ status: 'success', profile: updated, applied, skipped })
      })().catch((err) => {
        const detail = err instanceof SyntaxError ? `Invalid recommendations JSON: ${err.message}` : err instanceof Error ? err.message : 'Failed to apply recommendations'
        return jsonResponse({ detail }, err instanceof SyntaxError ? 400 : 500)
      })
    }

    // GET /api/profile/{name}/image-proxy → proxy to machine image URL from cache
    const imageProxyMatch = pathname.match(/^\/api\/profile\/([^/]+)\/image-proxy$/)
    if (imageProxyMatch) {
      const name = decodeURIComponent(imageProxyMatch[1])
      return (async () => {
        const profile = await _findProfileByName(name)
        if (!profile) return new Response('', { status: 404 })
        const cachedImage = await getDirectProfileImage(profile.id)
        if (cachedImage) {
          return new Response(cachedImage, {
            headers: { 'Content-Type': cachedImage.type || 'application/octet-stream' },
          })
        }
        const imagePath = getDirectProfileImagePath(profile)
        if (!imagePath) return new Response('', { status: 404 })
        const machineBase = await resolveMachineUrl()
        const imageUrl = new URL(imagePath, machineBase).toString()
        const imageResponse = await _originalFetch(imageUrl)
        if (!imageResponse.ok) return new Response('', { status: imageResponse.status })
        const imageBlob = await imageResponse.blob()
        await saveDirectProfileImage(profile.id, imageBlob)
        return new Response(imageBlob, {
          headers: {
            'Content-Type': imageResponse.headers.get('Content-Type') ?? imageBlob.type ?? 'application/octet-stream',
          },
        })
      })().catch(() => new Response('', { status: 404 }))
    }

    // GET /api/profile/{name}/target-curves → estimated profile target curves
    const targetCurvesMatch = pathname.match(/^\/api\/profile\/([^/]+)\/target-curves$/)
    if (targetCurvesMatch && method === 'GET') {
      return (async () => {
        const name = decodeURIComponent(targetCurvesMatch[1])
        const profile = await _findProfileByName(name)
        if (!profile) return jsonResponse({ detail: `Profile '${name}' not found` }, 404)
        return jsonResponse({
          status: 'success',
          target_curves: generateEstimatedTargetCurves(profile),
        })
      })().catch((err) => jsonResponse({ detail: err instanceof Error ? err.message : 'Failed to get target curves' }, 500))
    }

    // PUT /api/profile/{name}/edit → edit and save the machine profile directly
    const profileEditMatch = pathname.match(/^\/api\/profile\/([^/]+)\/edit$/)
    if (profileEditMatch && method === 'PUT') {
      return (async () => {
        const name = decodeURIComponent(profileEditMatch[1])
        const profile = await _findProfileByName(name)
        if (!profile) return jsonResponse({ detail: `Profile '${name}' not found on machine` }, 404)
        // Fetch full profile (with stages) — the list cache doesn't include stages
        const fullResp = await _fetch(`/api/v1/profile/get/${profile.id}`)
        let fullProfile = profile
        if (fullResp.ok) {
          try {
            const parsed = await fullResp.json() as CachedProfile
            if (typeof parsed?.id === 'string') fullProfile = parsed
          } catch { /* use cached profile */ }
        }
        const request = input instanceof Request ? input : new Request(input, init)
        const body = await request.json() as {
          name?: string
          temperature?: number
          final_weight?: number
          variables?: Array<{ key?: string; value?: unknown }>
          author?: string
        }
        const updated: CachedProfile = JSON.parse(JSON.stringify(fullProfile))
        if (body.name !== undefined) {
          if (typeof body.name !== 'string' || !body.name.trim()) {
            return jsonResponse({ detail: 'Profile name must be a non-empty string' }, 400)
          }
          updated.name = body.name.trim()
        }
        if (body.temperature !== undefined) updated.temperature = Number(body.temperature)
        if (body.final_weight !== undefined) updated.final_weight = Number(body.final_weight)
        if (body.author !== undefined) updated.author = body.author
        if (body.variables !== undefined && Array.isArray(updated.variables)) {
          const incoming = new Map(
            body.variables
              .filter((variable) => typeof variable.key === 'string' && 'value' in variable)
              .map((variable) => [variable.key as string, variable.value]),
          )
          updated.variables = updated.variables.map((variable) => {
            const key = typeof variable.key === 'string' ? variable.key : null
            return key && incoming.has(key) ? { ...variable, value: incoming.get(key) } : variable
          })
        }
        const machineProfile = stripDirectProfileMetadata(updated)
        const saveResponse = await _fetch('/api/v1/profile/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(machineProfile),
        })
        if (!saveResponse.ok) return jsonResponse({ detail: 'Failed to save profile to machine' }, 502)
        _profileCache.delete(name)
        _profileCache.set(updated.name, updated)

        // Regenerate static description for the edited profile
        try {
          const { buildStaticProfileDescription } = await import('@/lib/staticProfileDescription')
          const desc = buildStaticProfileDescription(machineProfile as Parameters<typeof buildStaticProfileDescription>[0])
          _descriptionCache.set(updated.id, desc)
          _persistDescriptionCache()
        } catch { /* non-critical */ }

        return jsonResponse({ status: 'success', profile: machineProfile })
      })().catch((err) => jsonResponse({ detail: err instanceof Error ? err.message : 'Failed to edit profile' }, 500))
    }

    // GET /api/profile/{name} → fetch profile metadata and optional stage details
    const profileByNameMatch = pathname.match(/^\/api\/profile\/([^/]+)$/)
    if (profileByNameMatch && method === 'GET') {
      const name = decodeURIComponent(profileByNameMatch[1])
      return (async () => {
        const profile = await _findProfileByName(name)
        if (!profile) {
          return jsonResponse({
            status: 'not_found',
            profile: null,
            message: `Profile '${name}' not found on machine`,
          })
        }
        const parsedUrl = new URL(url, window.location.origin)
        const includeStages = parsedUrl.searchParams.get('include_stages') === 'true'
        const responseProfile: Record<string, unknown> = {
          id: profile.id,
          name: profile.name,
          author: profile.author,
          temperature: profile.temperature,
          final_weight: profile.final_weight,
          image: getDirectProfileImagePath(profile),
          accent_color: profile.display?.accentColor,
          display: profile.display,
        }
        if (includeStages) {
          responseProfile.stages = profile.stages ?? []
          responseProfile.variables = profile.variables ?? []
        }
        return jsonResponse({ status: 'success', profile: responseProfile })
      })().catch((err) => jsonResponse({ detail: err instanceof Error ? err.message : 'Failed to get profile info' }, 500))
    }

    // /api/machine/status → synthetic response (real state comes via Socket.IO)
    if (url.match(/\/api\/machine\/status/)) {
      return Promise.resolve(jsonResponse({
        machine_status: { state: 'idle' },
        scheduled_shots: [],
      }))
    }

    // /api/last-shot → /api/v1/history/last (translate to MeticAI format)
    if (url.match(/\/api\/last-shot/)) {
      return (async () => {
        const history = await _loadVisibleHistory()
        const entry = [...history].sort((a, b) => b.time - a.time)[0]
        if (!entry) return jsonResponse({ detail: 'No shots found' }, 404)
        return jsonResponse(normalizeLastShot(entry))
      })().catch(() => jsonResponse({ detail: 'No shots found' }, 404))
    }

    // /api/history/{id}/notes → direct local notes storage
    const historyNotesMatch = pathname.match(/^\/api\/history\/([^/]+)\/notes$/)
    if (historyNotesMatch && (method === 'GET' || method === 'PATCH' || method === 'PUT')) {
      return (async () => {
        const entryId = decodeURIComponent(historyNotesMatch[1])
        if (method === 'GET') {
          const notes = await getDirectHistoryNotes(entryId)
          return jsonResponse({ status: 'success', ...notes })
        }
        const request = input instanceof Request ? input : new Request(input, init)
        const body = await request.json() as { notes?: string }
        return jsonResponse(await saveDirectHistoryNotes(entryId, body.notes ?? ''))
      })().catch((err) => jsonResponse({ detail: err instanceof Error ? err.message : 'Failed to update history notes' }, 500))
    }

    // /api/history/{id} → detail route before the broad list handler
    const historyDetailMatch = pathname.match(/^\/api\/history\/([^/]+)$/)
    if (historyDetailMatch && method === 'GET') {
      return (async () => {
        const entryId = decodeURIComponent(historyDetailMatch[1])
        const history = await _loadVisibleHistory()
        const entry = history.find((candidate) => candidate.id === entryId)
        if (!entry) return jsonResponse({ detail: 'History entry not found' }, 404)
        return jsonResponse(normalizeHistoryEntry(entry, await getDirectHistoryNotes(entryId)))
      })().catch(() => jsonResponse({ detail: 'Failed to retrieve history entry' }, 500))
    }

    // DELETE /api/history/{id} → local direct tombstone; machine history is immutable.
    if (historyDetailMatch && method === 'DELETE') {
      return (async () => {
        const entryId = decodeURIComponent(historyDetailMatch[1])
        const history = await _loadVisibleHistory()
        if (!history.some((candidate) => candidate.id === entryId)) {
          return jsonResponse({ detail: 'History entry not found' }, 404)
        }
        await deleteDirectHistoryEntry(entryId)
        return jsonResponse({ status: 'success', message: 'History entry deleted' })
      })().catch(() => jsonResponse({ detail: 'Failed to delete history entry' }, 500))
    }

    // /api/history → /api/v1/history (translate machine history to MeticAI format)
    if (pathname === '/api/history' && method === 'GET') {
      return (async () => {
        const parsedUrl = new URL(url, window.location.origin)
        const limit = safeNumber(parsedUrl.searchParams.get('limit'), 50)
        const offset = safeNumber(parsedUrl.searchParams.get('offset'), 0)
        const history = await _loadVisibleHistory()
        const entries = await Promise.all(
          history.slice(offset, offset + limit).map(async (entry) => (
            normalizeHistoryEntry(entry, await getDirectHistoryNotes(entry.id))
          )),
        )
        return jsonResponse({ entries, total: history.length, limit, offset })
      })().catch(() => jsonResponse({ entries: [], total: 0, limit: 50, offset: 0 }))
    }

    // DELETE /api/history → local direct tombstones for all currently visible machine shots.
    if (pathname === '/api/history' && method === 'DELETE') {
      return (async () => {
        const history = await _loadVisibleHistory()
        await clearDirectHistory(history.map((entry) => entry.id))
        return jsonResponse({ status: 'success', message: 'All history cleared' })
      })().catch(() => jsonResponse({ detail: 'Failed to clear history' }, 500))
    }

    // POST /api/machine/preheat → GET /api/v1/action/preheat
    if (url.match(/\/api\/machine\/preheat/) && method === 'POST') {
      return _fetch('/api/v1/action/preheat').then(r =>
        r.ok
          ? jsonResponse({ status: 'success', message: 'Preheat started' })
          : jsonResponse({ status: 'error', detail: 'Preheat failed' }, 502)
      ).catch(() => jsonResponse({ status: 'error', detail: 'Preheat failed' }, 502))
    }

    // POST /api/machine/schedule-shot → not supported in direct mode
    // (feature flag scheduledShots=false already hides the UI, but be explicit)
    if (url.match(/\/api\/machine\/schedule-shot/) && method === 'POST') {
      return Promise.resolve(jsonResponse({
        status: 'error',
        detail: 'Scheduled shots are not supported in direct mode. Use the machine UI or MeticAI Docker mode.',
      }, 501))
    }

    // /api/machine/profiles/orphaned → empty list (no MeticAI DB in direct mode)
    if (url.match(/\/api\/machine\/profiles\/orphaned/)) {
      return Promise.resolve(jsonResponse({ orphaned: [] }))
    }

    // GET /api/shots/recent/by-profile → /api/v1/history (group entries by profile)
    if (url.match(/\/api\/shots\/recent\/by-profile/)) {
      return (async () => {
        const list = await _loadVisibleHistory()
        const annotations = (await getDirectAnnotationSummaries()).annotations
        const groups = new Map<string, { profile_name: string; profile_id: string; shots: unknown[]; shot_count: number }>()
        for (const e of list) {
            const pName = getHistoryProfileName(e)
            const pId = getHistoryProfileId(e)
            const shotDate = getHistoryEntryDate(e)
            const shotFilename = getHistoryEntryFilename(e)
            const metrics = getHistoryMetrics(e)
            const annotation = annotations[`${shotDate}/${shotFilename}`]
            const shot = {
              profile_name: pName,
              profile_id: pId,
              date: shotDate,
              filename: shotFilename,
              timestamp: e.time,
              final_weight: metrics.final_weight,
              total_time: metrics.total_time,
              has_annotation: hasRecentShotAnnotation(annotation),
            }
            if (!groups.has(pName)) {
              groups.set(pName, { profile_name: pName, profile_id: pId, shots: [], shot_count: 0 })
            }
            const g = groups.get(pName)!
            g.shots.push(shot)
            g.shot_count++
          }
        return jsonResponse({ profiles: Array.from(groups.values()) })
      })().catch(() => jsonResponse({ profiles: [] }))
    }

    // GET /api/shots/recent → /api/v1/history (translate entries to RecentShot format)
    if (url.match(/\/api\/shots\/recent/)) {
      return (async () => {
        const list = await _loadVisibleHistory()
        const annotations = (await getDirectAnnotationSummaries()).annotations
        const shots = list.map(e => {
            const shotDate = getHistoryEntryDate(e)
            const shotFilename = getHistoryEntryFilename(e)
            const metrics = getHistoryMetrics(e)
            const annotation = annotations[`${shotDate}/${shotFilename}`]
            return {
              profile_name: getHistoryProfileName(e),
              profile_id: getHistoryProfileId(e),
              date: shotDate,
              filename: shotFilename,
              timestamp: e.time,
              final_weight: metrics.final_weight,
              total_time: metrics.total_time,
              has_annotation: hasRecentShotAnnotation(annotation),
            }
          })
        return jsonResponse({ shots })
      })().catch(() => jsonResponse({ shots: [] }))
    }

    // GET /api/shots/by-profile/:profileName → /api/v1/history (filter by profile name)
    const byProfileMatch = url.match(/\/api\/shots\/by-profile\/([^?]+)/)
    if (byProfileMatch) {
      const profileName = decodeURIComponent(byProfileMatch[1])
      return (async () => {
          const all = await _loadVisibleHistory()
          const filtered = all.filter(e => getHistoryProfileName(e) === profileName)
          const shots = filtered.map(e => {
            const metrics = getHistoryMetrics(e)
            return {
              date: getHistoryEntryDate(e),
              filename: getHistoryEntryFilename(e),
              timestamp: String(e.time),
              profile_name: getHistoryProfileName(e),
              final_weight: metrics.final_weight,
              total_time: metrics.total_time,
            }
          })
          return jsonResponse({ profile_name: profileName, shots, count: shots.length, limit: 20 })
      })().catch(() => jsonResponse({ profile_name: profileName, shots: [], count: 0, limit: 20 }))
    }

    // GET /api/shots/data/:date/:filename → /api/v1/history (find entry and convert data)
    const shotDataMatch = url.match(/\/api\/shots\/data\/([^/]+)\/(.+?)(?:\?|$)/)
    if (shotDataMatch) {
      const shotDate = decodeURIComponent(shotDataMatch[1])
      const shotFilename = decodeURIComponent(shotDataMatch[2])
      return (async () => {
          type HistEntry = {
            id: string; time: number; name: string; file?: string;
            profile?: { name?: string; id?: string; final_weight?: number; temperature?: number; author?: string; stages?: { name: string; type: string; key?: string }[] };
            data?: { shot?: { pressure?: number; flow?: number; weight?: number }; time?: number; profile_time?: number; sensors?: { external_1?: number } }[];
          }
          const entry = await _findVisibleShot(shotDate, shotFilename) as HistEntry | null
          if (!entry) return jsonResponse({ detail: 'Shot not found' }, 404)
          const pts = entry.data ?? []
          const timeArr: number[] = []
          const pressureArr: number[] = []
          const flowArr: number[] = []
          const weightArr: number[] = []
          const temperatureArr: number[] = []
          for (const pt of pts) {
            timeArr.push((pt.profile_time ?? pt.time ?? 0) / 1000)
            pressureArr.push(pt.shot?.pressure ?? 0)
            flowArr.push(pt.shot?.flow ?? 0)
            weightArr.push(pt.shot?.weight ?? 0)
            temperatureArr.push(pt.sensors?.external_1 ?? 0)
          }
          const lastPt = pts[pts.length - 1]
          const shotData = {
            date: shotDate,
            filename: shotFilename,
            data: {
              profile: {
                name: entry.profile?.name ?? entry.name ?? 'Unknown',
                author: entry.profile?.author,
                temperature: entry.profile?.temperature,
                final_weight: entry.profile?.final_weight,
                stages: entry.profile?.stages?.map(s => ({ name: s.name, type: s.type, key: s.key })),
              },
              start_time: new Date(entry.time * 1000).toISOString(),
              elapsed_time: lastPt ? (lastPt.profile_time ?? lastPt.time ?? 0) / 1000 : 0,
              final_weight: lastPt?.shot?.weight ?? entry.profile?.final_weight ?? null,
              data: { time: timeArr, pressure: pressureArr, flow: flowArr, weight: weightArr, temperature: temperatureArr },
            }
          }
          return jsonResponse(shotData)
      })().catch(() => jsonResponse({ detail: 'Failed to load shot data' }, 500))
    }

    // GET/PATCH/DELETE /api/shots/{date}/{filename}/annotation → direct local annotation storage
    const shotAnnotationMatch = pathname.match(/^\/api\/shots\/([^/]+)\/([^/]+)\/annotation$/)
    if (shotAnnotationMatch && (method === 'GET' || method === 'PATCH' || method === 'PUT' || method === 'DELETE')) {
      return (async () => {
        const date = decodeURIComponent(shotAnnotationMatch[1])
        const filename = decodeURIComponent(shotAnnotationMatch[2])
        if (method === 'GET') return jsonResponse(await getDirectShotAnnotation(date, filename))
        if (method === 'DELETE') return jsonResponse(await deleteDirectShotAnnotation(date, filename))
        const request = input instanceof Request ? input : new Request(input, init)
        const body = await request.json() as { annotation?: string; rating?: number | null }
        return jsonResponse(await saveDirectShotAnnotation(date, filename, body))
      })().catch((err) => {
        const status = err instanceof DirectStorageValidationError ? 422 : 500
        return jsonResponse({ detail: err instanceof Error ? err.message : 'Failed to update annotation' }, status)
      })
    }

    // GET /api/shots/annotations → IndexedDB-backed direct annotation summaries
    if (url.match(/\/api\/shots\/annotations/)) {
      return getDirectAnnotationSummaries()
        .then((summaries) => jsonResponse(summaries))
        .catch((err) => {
          console.error('[DirectMode] Failed to load annotations:', err)
          return jsonResponse({ error: 'Failed to load annotations' }, 500)
        })
    }

    // GET /api/shots/llm-analysis-cache → no cache in direct mode
    if (url.match(/\/api\/shots\/llm-analysis-cache/)) {
      return Promise.resolve(jsonResponse({ cached: false }))
    }

    // GET /api/shots/dates → derive from history
    if (url.match(/\/api\/shots\/dates/) && method === 'GET') {
      return (async () => {
        const history = await _loadVisibleHistory()
        const dates = [...new Set(history.map(getHistoryEntryDate))]
        dates.sort((a, b) => b.localeCompare(a))
        return jsonResponse({ dates })
      })().catch(() => jsonResponse({ dates: [] }))
    }

    // POST /api/shots/analyze → compute structured LocalAnalysisResult from shot telemetry
    if (url.match(/\/api\/shots\/analyze$/) && method === 'POST') {
      return (async () => {
        try {
          const body = init?.body as FormData
          const shotDate = (body.get('shot_date') as string) || ''
          const shotFilename = (body.get('shot_filename') as string) || ''
          const profileName = (body.get('profile_name') as string) || 'Unknown'

          /* eslint-disable @typescript-eslint/no-explicit-any */
          type HistStage = { name: string; type: string; key?: string; dynamics?: any; exit_triggers?: any[]; limits?: any[] }
          type HistVar = { key: string; name: string; type: string; value: number }
          type HistEntry = {
            id: string; time: number; name: string; file?: string;
            profile?: { name?: string; final_weight?: number; temperature?: number; stages?: HistStage[]; variables?: HistVar[] };
            data?: { shot?: { pressure?: number; flow?: number; weight?: number; gravimetric_flow?: number }; time?: number; profile_time?: number; status?: string }[];
          }
          /* eslint-enable @typescript-eslint/no-explicit-any */
          const entry = await _findVisibleShot(shotDate, shotFilename) as HistEntry | null
          if (!entry) return jsonResponse({ status: 'error', message: 'Shot not found' })

          // ── Helper functions (matching server analysis_service.py) ──

          const _sf = (v: unknown, d = 0): number => {
            if (v == null) return d
            const n = Number(v)
            return Number.isFinite(n) ? n : d
          }
          const _round1 = (v: number) => Math.round(v * 10) / 10

          const _resolveVar = (val: unknown, vars: HistVar[]): number => {
            if (typeof val === 'string' && val.startsWith('$')) {
              const key = val.slice(1)
              const v = vars.find(x => x.key === key)
              return v ? _sf(v.value) : 0
            }
            return _sf(val)
          }

          const FLOW_IGNORE_WINDOW = 3.5
          const PREINFUSION_KW = ['bloom', 'soak', 'preinfusion', 'pre-infusion', 'pre infusion', 'wet', 'fill', 'landing']

          // ── Extract per-stage telemetry ──
          const pts = entry.data ?? []
          type StageStats = {
            startTime: number; endTime: number; duration: number
            startWeight: number; endWeight: number
            startPressure: number; endPressure: number; avgPressure: number; maxPressure: number; minPressure: number
            startFlow: number; endFlow: number; avgFlow: number; maxFlow: number
          }
          const shotStages = new Map<string, StageStats>()
          {
            let curStage: string | null = null
            let stagePts: typeof pts = []
            const flush = () => {
              if (!curStage || stagePts.length === 0) return
              const times = stagePts.map(p => (p.time ?? 0) / 1000)
              const prs = stagePts.map(p => p.shot?.pressure ?? 0)
              const wts = stagePts.map(p => p.shot?.weight ?? 0)
              const fls = stagePts.map(p => p.shot?.flow ?? 0)
              const flsFiltered = stagePts.filter(p => (p.time ?? 0) / 1000 >= FLOW_IGNORE_WINDOW).map(p => p.shot?.flow ?? 0)
              const flowSrc = flsFiltered.length > 0 ? flsFiltered : fls
              shotStages.set(curStage, {
                startTime: Math.min(...times), endTime: Math.max(...times),
                duration: Math.max(...times) - Math.min(...times),
                startWeight: wts[0], endWeight: wts[wts.length - 1],
                startPressure: prs[0], endPressure: prs[prs.length - 1],
                avgPressure: prs.reduce((a, b) => a + b, 0) / prs.length,
                maxPressure: Math.max(...prs), minPressure: Math.min(...prs),
                startFlow: fls[0], endFlow: fls[fls.length - 1],
                avgFlow: flowSrc.reduce((a, b) => a + b, 0) / flowSrc.length,
                maxFlow: Math.max(...flowSrc),
              })
            }
            for (const pt of pts) {
              const st = (pt.status ?? '').trim()
              if (!st || st.toLowerCase() === 'retracting') continue
              if (st !== curStage) { flush(); curStage = st; stagePts = [] }
              stagePts.push(pt)
            }
            flush()
          }

          // ── Overall metrics ──
          let maxPressure = 0, maxFlow = 0
          for (const pt of pts) {
            if ((pt.shot?.pressure ?? 0) > maxPressure) maxPressure = pt.shot?.pressure ?? 0
            const t = (pt.time ?? 0) / 1000
            if (t >= FLOW_IGNORE_WINDOW && (pt.shot?.flow ?? 0) > maxFlow) maxFlow = pt.shot?.flow ?? 0
          }
          const lastPt = pts[pts.length - 1]
          const finalWeight = lastPt?.shot?.weight ?? entry.profile?.final_weight ?? 0
          const totalTime = lastPt ? (lastPt.profile_time ?? lastPt.time ?? 0) / 1000 : 0
          const targetWeight = entry.profile?.final_weight ?? null

          // ── Format helpers ──
          const vars = entry.profile?.variables ?? []
          const unitMap: Record<string, string> = { time: 's', weight: 'g', pressure: 'bar', flow: 'ml/s' }
          const compMap: Record<string, string> = { '>=': '≥', '<=': '≤', '>': '>', '<': '<', '==': '=' }

          const fmtDynamics = (stage: HistStage): string => {
            const dp = stage.dynamics?.points ?? []
            if (!dp.length) return `${stage.type} stage`
            const unit = stage.type === 'pressure' ? 'bar' : 'ml/s'
            if (dp.length === 1) {
              const v = _resolveVar(dp[0][1] ?? dp[0][0], vars)
              return `Constant ${stage.type} at ${v} ${unit}`
            }
            if (dp.length === 2) {
              const sy = _resolveVar(dp[0][1], vars), ey = _resolveVar(dp[1][1], vars), ex = _sf(dp[1][0])
              const ou = (stage.dynamics?.over ?? 'time') === 'time' ? 's' : 'g'
              if (sy === ey) return `Constant ${stage.type} at ${sy} ${unit} for ${ex}${ou}`
              const dir = ey > sy ? 'ramp up' : 'ramp down'
              return `${stage.type[0].toUpperCase() + stage.type.slice(1)} ${dir} from ${sy} to ${ey} ${unit} over ${ex}${ou}`
            }
            const vals = dp.map((p: number[]) => _resolveVar(p[1], vars))
            return `${stage.type[0].toUpperCase() + stage.type.slice(1)} curve: ${vals.join(' → ')} ${unit}`
          }

          const fmtTriggers = (triggers: any[]) => triggers.map((t: any) => {
            const v = _resolveVar(t.value, vars)
            const c = compMap[t.comparison] ?? t.comparison
            const u = unitMap[t.type] ?? ''
            return { type: t.type, value: v, comparison: t.comparison, description: `${t.type} ${c} ${v}${u}` }
          })

          const fmtLimits = (limits: any[]) => limits.map((l: any) => {
            const v = _resolveVar(l.value, vars)
            const u = unitMap[l.type] ?? ''
            return { type: l.type, value: v, description: `Limit ${l.type} to ${v}${u}` }
          })

          // ── Stage analysis ──
          const profileStages = entry.profile?.stages ?? []
          const stageAnalyses: any[] = []
          const unreachedStages: string[] = []
          let preinfusionTime = 0
          const preinfusionStages: string[] = []

          for (const ps of profileStages) {
            const stageName = (ps.name ?? '').trim()
            const stageType = ps.type ?? 'unknown'
            // Match shot stage by name (trimmed, case-insensitive)
            let shotData: StageStats | undefined
            for (const [k, v] of shotStages) {
              if (k.trim().toLowerCase() === stageName.toLowerCase()) { shotData = v; break }
            }

            const profileTarget = fmtDynamics(ps)
            const exitTriggers = fmtTriggers(ps.exit_triggers ?? [])
            const limits = fmtLimits(ps.limits ?? [])
            const executed = !!shotData

            const stageResult: any = {
              stage_name: stageName,
              stage_key: (ps.key ?? stageName).toLowerCase().replace(/\s+/g, '_'),
              stage_type: stageType,
              profile_target: profileTarget,
              exit_triggers: exitTriggers,
              limits,
              executed,
              execution_data: null,
              exit_trigger_result: null,
              limit_hit: null,
              assessment: null,
            }

            if (!executed) {
              unreachedStages.push(stageName)
              stageResult.assessment = { status: 'not_reached', message: 'This stage was never executed during the shot' }
              stageAnalyses.push(stageResult)
              continue
            }

            const sd = shotData!
            const wGain = sd.endWeight - sd.startWeight
            // Execution description
            const descParts: string[] = []
            const pDelta = sd.endPressure - sd.startPressure
            if (Math.abs(pDelta) > 0.5) {
              descParts.push(pDelta > 0
                ? `Pressure rose from ${_round1(sd.startPressure)} to ${_round1(sd.endPressure)} bar`
                : `Pressure declined from ${_round1(sd.startPressure)} to ${_round1(sd.endPressure)} bar`)
            } else if (sd.maxPressure > 0) {
              descParts.push(`Pressure held around ${_round1((sd.startPressure + sd.endPressure) / 2)} bar`)
            }
            const fDelta = sd.endFlow - sd.startFlow
            if (Math.abs(fDelta) > 0.3) {
              descParts.push(fDelta > 0
                ? `Flow increased from ${_round1(sd.startFlow)} to ${_round1(sd.endFlow)} ml/s`
                : `Flow decreased from ${_round1(sd.startFlow)} to ${_round1(sd.endFlow)} ml/s`)
            } else if (sd.maxFlow > 0) {
              descParts.push(`Flow steady at ${_round1((sd.startFlow + sd.endFlow) / 2)} ml/s`)
            }
            if (wGain > 1) descParts.push(`extracted ${_round1(wGain)}g`)
            if (sd.duration > 0) descParts.push(`over ${_round1(sd.duration)}s`)
            const execDesc = descParts.length > 0 ? descParts.join(', ').replace(/^./, c => c.toUpperCase()) : `Stage executed for ${_round1(sd.duration)}s`

            stageResult.execution_data = {
              duration: _round1(sd.duration), weight_gain: _round1(wGain),
              start_weight: _round1(sd.startWeight), end_weight: _round1(sd.endWeight),
              start_pressure: _round1(sd.startPressure), end_pressure: _round1(sd.endPressure),
              avg_pressure: _round1(sd.avgPressure), max_pressure: _round1(sd.maxPressure), min_pressure: _round1(sd.minPressure),
              start_flow: _round1(sd.startFlow), end_flow: _round1(sd.endFlow),
              avg_flow: _round1(sd.avgFlow), max_flow: _round1(sd.maxFlow),
              description: execDesc,
            }

            // Determine exit trigger hit
            if (ps.exit_triggers?.length) {
              let triggered: any = null
              const notTriggered: any[] = []
              for (const tr of ps.exit_triggers) {
                const tType = tr.type ?? ''
                const tVal = _resolveVar(tr.value, vars)
                const comp = tr.comparison ?? '>='
                let actual = 0
                if (tType === 'time') actual = sd.duration
                else if (tType === 'weight') actual = sd.endWeight
                else if (tType === 'pressure') actual = comp === '>=' || comp === '>' ? sd.maxPressure : sd.endPressure
                else if (tType === 'flow') actual = comp === '>=' || comp === '>' ? sd.maxFlow : sd.endFlow
                const tol = (tType === 'time' || tType === 'weight') ? 0.5 : 0.2
                let hit = false
                if (comp === '>=') hit = actual >= tVal - tol
                else if (comp === '>') hit = actual > tVal
                else if (comp === '<=') hit = actual <= tVal + tol
                else if (comp === '<') hit = actual < tVal
                const u = unitMap[tType] ?? ''
                const info = { type: tType, target: tVal, actual: _round1(actual), description: `${tType} >= ${tVal}${u}` }
                if (hit && !triggered) triggered = info
                else if (!hit) notTriggered.push(info)
              }
              stageResult.exit_trigger_result = { triggered, not_triggered: notTriggered }
            }

            // Limit hit check
            for (const lim of (ps.limits ?? [])) {
              const lType = lim.type ?? ''
              const lVal = _resolveVar(lim.value, vars)
              let actual = 0
              if (lType === 'flow') actual = sd.maxFlow
              else if (lType === 'pressure') actual = sd.maxPressure
              else if (lType === 'time') actual = sd.duration
              else if (lType === 'weight') actual = sd.endWeight
              const u = unitMap[lType] ?? ''
              if (actual >= lVal - 0.2) {
                stageResult.limit_hit = { type: lType, limit_value: lVal, actual_value: _round1(actual), description: `Hit ${lType} limit of ${lVal}${u}` }
                break
              }
            }

            // Assessment
            const etr = stageResult.exit_trigger_result
            if (etr?.triggered) {
              stageResult.assessment = stageResult.limit_hit
                ? { status: 'hit_limit', message: `Stage exited but hit a limit (${stageResult.limit_hit.description})` }
                : { status: 'reached_goal', message: `Exited via: ${etr.triggered.description}` }
            } else if (etr && etr.not_triggered?.length) {
              stageResult.assessment = { status: 'failed', message: 'Stage ended before exit triggers were satisfied' }
            } else {
              stageResult.assessment = { status: 'executed', message: 'Stage executed (no exit triggers defined)' }
            }

            stageAnalyses.push(stageResult)

            // Pre-infusion tracking
            const nl = stageName.toLowerCase()
            if (PREINFUSION_KW.some(kw => nl.includes(kw))) {
              preinfusionTime += sd.duration
              preinfusionStages.push(stageName)
            }
          }

          const preinfusionWeight = (() => {
            let w = 0
            for (const ps2 of profileStages) {
              const sn = (ps2.name ?? '').trim().toLowerCase()
              if (!PREINFUSION_KW.some(kw => sn.includes(kw))) continue
              for (const [k, v] of shotStages) {
                if (k.trim().toLowerCase() === sn) { w += Math.max(0, v.endWeight - v.startWeight); break }
              }
            }
            return w
          })()

          const analysis = {
            shot_summary: {
              final_weight: _round1(finalWeight),
              target_weight: targetWeight,
              total_time: _round1(totalTime),
              max_pressure: _round1(maxPressure),
              max_flow: _round1(maxFlow),
            },
            weight_analysis: {
              status: targetWeight
                ? Math.abs(finalWeight - targetWeight) / targetWeight < 0.05 ? 'on_target'
                  : finalWeight < targetWeight ? 'under' : 'over'
                : 'on_target',
              target: targetWeight,
              actual: _round1(finalWeight),
              deviation_percent: targetWeight
                ? Math.round(((finalWeight - targetWeight) / targetWeight) * 1000) / 10
                : 0,
            },
            stage_analyses: stageAnalyses,
            unreached_stages: unreachedStages,
            preinfusion_summary: {
              stages: preinfusionStages,
              total_time: _round1(preinfusionTime),
              proportion_of_shot: totalTime > 0 ? _round1(preinfusionTime / totalTime * 100) : 0,
              weight_accumulated: _round1(preinfusionWeight),
              weight_percent_of_total: finalWeight > 0 ? _round1(preinfusionWeight / finalWeight * 100) : 0,
              issues: [],
              recommendations: [],
            },
            profile_info: {
              name: profileName,
              temperature: entry.profile?.temperature ?? null,
              stage_count: profileStages.length,
            },
          }
          return jsonResponse({ status: 'success', analysis })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Analysis failed'
          return jsonResponse({ status: 'error', message: msg })
        }
      })()
    }

    // POST /api/shots/analyze-llm → alias for shot analysis
    if (url.match(/\/api\/shots\/analyze-llm/) && method === 'POST') {
      return (async () => {
        try {
          const aiService = createBrowserAIService()
          if (!aiService.isConfigured()) {
            return jsonResponse({ status: 'error', message: 'Gemini API key not configured.' })
          }
          const body = init?.body as FormData
          const result = await aiService.analyzeShot({
            profileName: (body.get('profile_name') as string) || 'Unknown',
            shotDate: (body.get('shot_date') as string) || '',
            shotFilename: (body.get('shot_filename') as string) || '',
            profileDescription: (body.get('profile_description') as string) || undefined,
          })
          return jsonResponse({ status: 'success', llm_analysis: result.llm_analysis, cached: false })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Analysis failed'
          return jsonResponse({ status: 'error', message: msg })
        }
      })()
    }

    // POST /api/shots/analyze-recommendations → parse cached/direct analysis locally
    if (url.match(/\/api\/shots\/analyze-recommendations/) && method === 'POST') {
      return (async () => {
        const request = input instanceof Request ? input : new Request(input, init)
        const form = await request.formData()
        const profileName = String(form.get('profile_name') ?? '')
        const shotFilename = String(form.get('shot_filename') ?? '')
        const analysisText = String(form.get('analysis') ?? '') || getCachedAnalysisText(profileName, shotFilename)
        if (!analysisText) {
          return jsonResponse({
            detail: {
              status: 'no_analysis',
              message: 'No cached analysis found. Run a full analysis first.',
            },
          }, 404)
        }
        const profile = await _findProfileByName(profileName)
        const variables = profile?.variables ?? []
        const recommendations = parseRecommendationsJson(analysisText).map((recommendation) => ({
          ...recommendation,
          is_patchable: isRecommendationPatchable(recommendation, variables),
        }))
        return jsonResponse({
          status: 'success',
          profile_name: profileName,
          recommendations,
          total: recommendations.length,
          patchable_count: recommendations.filter((recommendation) => recommendation.is_patchable).length,
        })
      })().catch((err) => jsonResponse({ detail: err instanceof Error ? err.message : 'Failed to extract recommendations' }, 500))
    }

    // GET /api/generate/progress → no SSE in direct mode (generation is synchronous via BrowserAIService)
    if (url.match(/\/api\/generate\/progress/)) {
      return Promise.resolve(jsonResponse({ error: 'No active generation' }, 404))
    }

    // POST /api/analyze_and_profile → client-side Gemini profile generation via BrowserAIService
    if (url.match(/\/api\/analyze_and_profile$/) && method === 'POST') {
      return (async () => {
        try {
          const aiService = createBrowserAIService()
          if (!aiService.isConfigured()) {
            return jsonResponse({ status: 'error', reply: 'Gemini API key not configured. Please set your API key in Settings.', analysis: '' })
          }

          const body = init?.body as FormData
          const image = body.get('file') as File | null
          const userPrefs = (body.get('user_prefs') as string) || ''

          const result = await aiService.generateProfile({
            image,
            preferences: userPrefs,
            tags: [],
          })

          // Save profile to machine (convert Gemini JSON to OEPF format)
          if (result.status === 'success') {
            const jsonMatch = result.analysis.match(/```json\s*([\s\S]*?)```/)
            if (jsonMatch) {
              try {
                const raw = JSON.parse(jsonMatch[1])
                const toOEPF = (p: Record<string, unknown>) => {
                  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '')
                  const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                    const r = Math.random() * 16 | 0
                    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
                  })
                  // Build variable lookup for resolving $refs in stages
                  const varLookup: Record<string, number> = {}
                  if (Array.isArray(p.variables)) {
                    for (const v of p.variables as Array<Record<string, unknown>>) {
                      if (v.key && typeof v.value === 'number') varLookup[v.key as string] = v.value
                      if (v.name && typeof v.value === 'number') varLookup[v.name as string] = v.value
                    }
                  } else if (p.variables && typeof p.variables === 'object') {
                    for (const [k, v] of Object.entries(p.variables as Record<string, unknown>)) {
                      const num = typeof v === 'number' ? v : typeof v === 'object' && v !== null ? (v as Record<string, unknown>).value : undefined
                      if (typeof num === 'number') varLookup[k] = num
                    }
                  }
                  // Resolve $varname references to numeric values
                  const resolve = (val: unknown): unknown => {
                    if (typeof val === 'string' && val.startsWith('$')) {
                      const name = val.slice(1)
                      return varLookup[name] ?? 0
                    }
                    return val
                  }
                  // Keep only OEPF-valid variables (array form with valid type)
                  const validTypes = ['power', 'flow', 'pressure', 'weight', 'time', 'piston_position']
                  let vars: Array<Record<string, unknown>> = []
                  if (Array.isArray(p.variables)) {
                    vars = (p.variables as Array<Record<string, unknown>>).filter(v =>
                      typeof v.value === 'number' && typeof v.type === 'string' && validTypes.includes(v.type as string)
                    )
                  }
                  // Convert stages
                  const stages = Array.isArray(p.stages) ? (p.stages as Array<Record<string, unknown>>).map((s, i) => {
                    // dynamics: array of {time,value} → {points: [[t,v]], over, interpolation}
                    let dynamics = s.dynamics
                    if (Array.isArray(dynamics)) {
                      dynamics = {
                        points: (dynamics as Array<Record<string, unknown>>).map(pt => [
                          Number(resolve(pt.time)) || 0, Number(resolve(pt.value)) || 0
                        ]),
                        over: 'time', interpolation: 'linear',
                      }
                    } else if (dynamics && typeof dynamics === 'object') {
                      const d = dynamics as Record<string, unknown>
                      if (Array.isArray(d.points) && d.points.length > 0 && typeof d.points[0] === 'object' && !Array.isArray(d.points[0])) {
                        d.points = (d.points as Array<Record<string, unknown>>).map(pt => [
                          Number(resolve(pt.time)) || 0, Number(resolve(pt.value)) || 0
                        ])
                      }
                      if (!d.over) d.over = 'time'
                      if (!d.interpolation) d.interpolation = 'linear'
                    }
                    // Fix type: map Gemini names to valid OEPF types (power|flow|pressure)
                    const typeMap: Record<string, string> = { flowRate: 'flow', flow_rate: 'flow', flowrate: 'flow' }
                    let type = typeMap[s.type as string] || (s.type as string)
                    if (!['power', 'flow', 'pressure'].includes(type)) type = 'pressure'
                    // Fix exit_triggers: comparator → comparison, resolve $refs, map types, ensure relative
                    const triggerTypes = ['weight', 'pressure', 'flow', 'time', 'piston_position', 'power', 'user_interaction']
                    const mapTriggerType = (t: string) => {
                      if (triggerTypes.includes(t)) return t
                      if (/weight|dose|grams/i.test(t)) return 'weight'
                      if (/time|duration|elapsed/i.test(t)) return 'time'
                      if (/pressure/i.test(t)) return 'pressure'
                      if (/flow/i.test(t)) return 'flow'
                      return 'time'
                    }
                    const triggers = Array.isArray(s.exit_triggers)
                      ? (s.exit_triggers as Array<Record<string, unknown>>).map(t => ({
                          type: mapTriggerType(String(t.type || 'time')),
                          value: Number(resolve(t.value)) || 0,
                          relative: t.relative ?? true,
                          comparison: t.comparison || t.comparator || '>=',
                        }))
                      : []
                    // Fix limits: strip comparator, resolve $refs, map types (only pressure|flow valid)
                    const limits = Array.isArray(s.limits)
                      ? (s.limits as Array<Record<string, unknown>>).map(l => {
                          let lt = String(l.type || 'pressure')
                          if (lt !== 'pressure' && lt !== 'flow') {
                            lt = /flow/i.test(lt) ? 'flow' : 'pressure'
                          }
                          return { type: lt, value: Number(resolve(l.value)) || 0 }
                        })
                      : []
                    return {
                      name: s.name || `Stage ${i + 1}`,
                      key: s.key || slugify(String(s.name || `stage_${i + 1}`)),
                      type, dynamics, exit_triggers: triggers, limits,
                    }
                  }) : []
                  return {
                    name: p.name || 'AI Generated Profile',
                    id: uuid(),
                    author: typeof p.author === 'string' ? p.author : 'MeticAI',
                    author_id: uuid(),
                    previous_authors: [],
                    display: { accentColor: '#6366f1' },
                    temperature: p.temperature ?? 93,
                    final_weight: p.final_weight ?? 36,
                    variables: vars,
                    stages,
                    last_changed: Date.now() / 1000,
                  }
                }
                const oepf = toOEPF(raw)
                await _fetch('/api/v1/profile/save', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(oepf),
                })
              } catch (e) {
                console.warn('[direct-mode] Failed to save profile to machine:', e)
              }
            }
          }

          return jsonResponse({
            status: result.status,
            analysis: result.analysis,
            reply: result.analysis,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          return jsonResponse({ status: 'error', reply: msg, analysis: '' })
        }
      })()
    }

    // /api/profiles/sync/status → no sync needed in direct mode
    if (url.match(/\/api\/profiles\/sync\/status/)) {
      return Promise.resolve(jsonResponse({ new_count: 0, updated_count: 0, orphaned_count: 0 }))
    }

    // POST /api/profiles/sync → no-op in direct mode
    if (url.match(/\/api\/profiles\/sync/) && method === 'POST') {
      return Promise.resolve(jsonResponse({ status: 'success', new: [], updated: [], orphaned: [] }))
    }

    // GET /api/recipes → bundled pour-over recipes (sorted alphabetically by name)
    if (url.match(/\/api\/recipes$/)) {
      return Promise.resolve(jsonResponse([
        {"version":"1.1.0","metadata":{"name":"4:6 Method (Lighter)","author":"Tetsu Kasuya","description":"Lighter-bodied 4:6 with a single strength pour. First 40% (two pours of 60g) controls sweetness; final 60% (one pour of 180g) produces a lighter, cleaner cup. Use a coarse grind for clarity.","compatibility":["V60","April","Origami"],"visualizer_hint":"pulse_block"},"equipment":{"dripper":{"model":"V60","material":"Ceramic"},"filter_type":"Paper"},"ingredients":{"coffee_g":20.0,"water_g":300.0,"grind_setting":"Coarse"},"protocol":[{"step":1,"action":"pour","water_g":60,"duration_s":15,"notes":"First pour — controls sweetness"},{"step":2,"action":"wait","duration_s":45,"notes":"Wait for the bed to drain"},{"step":3,"action":"pour","water_g":60,"duration_s":15,"notes":"Second pour — controls sweetness"},{"step":4,"action":"wait","duration_s":45,"notes":"Wait for the bed to drain"},{"step":5,"action":"pour","water_g":180,"duration_s":45,"notes":"Single combined strength pour to 300g total"}],"slug":"4-6-method-lighter"},
        {"version":"1.1.0","metadata":{"name":"4:6 Method (Standard)","author":"Tetsu Kasuya","description":"Classic 4:6 with two equal strength pours. First 40% (two pours of 60g) controls sweetness; final 60% (two pours of 90g) controls strength. Use a coarse grind for clarity.","compatibility":["V60","April","Origami"],"visualizer_hint":"pulse_block"},"equipment":{"dripper":{"model":"V60","material":"Ceramic"},"filter_type":"Paper"},"ingredients":{"coffee_g":20.0,"water_g":300.0,"grind_setting":"Coarse"},"protocol":[{"step":1,"action":"pour","water_g":60,"duration_s":15,"notes":"First pour — controls sweetness"},{"step":2,"action":"wait","duration_s":45,"notes":"Wait for the bed to drain"},{"step":3,"action":"pour","water_g":60,"duration_s":15,"notes":"Second pour — controls sweetness"},{"step":4,"action":"wait","duration_s":45,"notes":"Wait for the bed to drain"},{"step":5,"action":"pour","water_g":90,"duration_s":20,"notes":"Third pour — controls strength"},{"step":6,"action":"wait","duration_s":60,"notes":"Wait for the bed to drain"},{"step":7,"action":"pour","water_g":90,"duration_s":20,"notes":"Fourth pour — controls strength"}],"slug":"4-6-method-standard"},
        {"version":"1.1.0","metadata":{"name":"4:6 Method (Stronger)","author":"Tetsu Kasuya","description":"Adjust sweetness with the first 40% of water (pours 1–2) and strength with the final 60% (pours 3–5). Use a coarse grind for clarity.","compatibility":["V60","April","Origami"],"visualizer_hint":"pulse_block"},"equipment":{"dripper":{"model":"V60","material":"Ceramic"},"filter_type":"Paper"},"ingredients":{"coffee_g":20.0,"water_g":300.0,"grind_setting":"Coarse"},"protocol":[{"step":1,"action":"pour","water_g":60,"duration_s":15,"notes":"First pour — controls sweetness"},{"step":2,"action":"wait","duration_s":45,"notes":"Wait for the bed to drain"},{"step":3,"action":"pour","water_g":60,"duration_s":15,"notes":"Second pour — controls sweetness"},{"step":4,"action":"wait","duration_s":45,"notes":"Wait for the bed to drain"},{"step":5,"action":"pour","water_g":60,"duration_s":15,"notes":"Third pour — controls strength"},{"step":6,"action":"wait","duration_s":45,"notes":"Wait for the bed to drain"},{"step":7,"action":"pour","water_g":60,"duration_s":15,"notes":"Fourth pour — controls strength"},{"step":8,"action":"wait","duration_s":45,"notes":"Wait for the bed to drain"},{"step":9,"action":"pour","water_g":60,"duration_s":15,"notes":"Fifth pour — controls strength"}],"slug":"4-6-method"},
        {"version":"1.1.0","metadata":{"name":"Better 1-Cup V60","author":"James Hoffmann","description":"Better 1-Cup V60 technique. 50g bloom with a mid-bloom swirl, then four measured pours of 50g each with 10-second pauses, finished with a gentle swirl.","compatibility":["V60"],"visualizer_hint":"pulse_block"},"equipment":{"dripper":{"model":"V60","material":"Plastic"},"filter_type":"Paper"},"ingredients":{"coffee_g":15.0,"water_g":250.0,"grind_setting":"Medium-Fine"},"protocol":[{"step":1,"action":"bloom","water_g":50,"duration_s":10,"notes":"Pour 50g to bloom"},{"step":2,"action":"swirl","duration_s":5,"notes":"Gently swirl at 10–15s"},{"step":3,"action":"wait","duration_s":30,"notes":"Finish bloom — wait until 0:45"},{"step":4,"action":"pour","water_g":50,"duration_s":15,"notes":"Pour to 100g total (40% weight)"},{"step":5,"action":"wait","duration_s":10},{"step":6,"action":"pour","water_g":50,"duration_s":10,"notes":"Pour to 150g total (60% weight)"},{"step":7,"action":"wait","duration_s":10},{"step":8,"action":"pour","water_g":50,"duration_s":10,"notes":"Pour to 200g total (80% weight)"},{"step":9,"action":"wait","duration_s":10},{"step":10,"action":"pour","water_g":50,"duration_s":10,"notes":"Pour to 250g total (100% weight)"},{"step":11,"action":"swirl","duration_s":5,"notes":"Gently swirl to flatten the bed"},{"step":12,"action":"wait","duration_s":60,"notes":"Allow to drain completely"}],"slug":"hoffmann-v2"},
        {"version":"1.1.0","metadata":{"name":"God/Devil Switch","author":"Tetsu Kasuya","description":"Hario Switch recipe. Open-valve hot percolation for the first 120g, then close the valve for cool immersion to 280g. Requires a gooseneck kettle with adjustable temperature.","compatibility":["Hario Switch"],"visualizer_hint":"pulse_block"},"equipment":{"dripper":{"model":"Switch","material":"Glass"},"filter_type":"Paper"},"ingredients":{"coffee_g":20.0,"water_g":280.0,"grind_setting":"Medium-Fine"},"protocol":[{"step":1,"action":"pour","water_g":60,"duration_s":15,"valve_state":"open","notes":"Valve OPEN — pour 60g at 90°C"},{"step":2,"action":"wait","duration_s":15,"valve_state":"open","notes":"Wait — valve remains open, percolating"},{"step":3,"action":"pour","water_g":60,"duration_s":20,"valve_state":"open","notes":"Pour 60g more to 120g total — still at 90°C. Begin lowering kettle temperature to 70°C now."},{"step":4,"action":"wait","duration_s":25,"valve_state":"open","notes":"Wait until ~1:15. Ensure water is at 70°C before next step."},{"step":5,"action":"pour","water_g":160,"duration_s":25,"valve_state":"closed","notes":"CLOSE valve, then pour 160g at 70°C to 280g total — immersion phase begins"},{"step":6,"action":"wait","duration_s":30,"valve_state":"closed","notes":"Steep with valve closed"},{"step":7,"action":"wait","duration_s":60,"valve_state":"open","notes":"OPEN valve — drain. Aim to complete by 3-minute mark."}],"slug":"kasuya-god-devil"},
        {"version":"1.1.0","metadata":{"name":"Go-To V60","author":"Pierre Tymms / Nordic Brew Lab","description":"Reliable everyday V60 with three progressive pours building to a final large pour. Balanced extraction with a medium-coarse grind targeting 2:45–3:00 total brew time.","compatibility":["V60","Origami","April"],"visualizer_hint":"pulse_block"},"equipment":{"dripper":{"model":"V60","material":"Ceramic"},"filter_type":"Paper"},"ingredients":{"coffee_g":18.0,"water_g":300.0,"grind_setting":"Medium-Coarse"},"protocol":[{"step":1,"action":"bloom","water_g":60,"duration_s":15,"notes":"Pour 60g to bloom — gentle spiral to saturate all grounds"},{"step":2,"action":"wait","duration_s":15,"notes":"Wait until 0:30 — let bloom degas"},{"step":3,"action":"pour","water_g":60,"duration_s":15,"notes":"Pour to 120g — steady centre pour"},{"step":4,"action":"wait","duration_s":15,"notes":"Wait until 1:00"},{"step":5,"action":"pour","water_g":60,"duration_s":15,"notes":"Pour to 180g — steady centre pour"},{"step":6,"action":"wait","duration_s":15,"notes":"Wait until 1:30"},{"step":7,"action":"pour","water_g":120,"duration_s":20,"notes":"Pour to 300g — larger final pour, centre circles"},{"step":8,"action":"swirl","duration_s":5,"notes":"Gentle swirl to level the bed"}],"slug":"nordic-brew-lab-goto"},
        {"version":"1.1.0","metadata":{"name":"One and Done Double Bloom","author":"Lance Hedrick","description":"Double bloom technique for maximum extraction clarity. Two short blooms fully saturate the bed before a single aggressive centre pour. Grind finer than typical (target 2:00–2:30 draw down). Use 93–96°C for light roasts, 90–93°C for medium, lower for darker roasts. 1:15 ratio.","compatibility":["V60","Origami","April"],"visualizer_hint":"pulse_block"},"equipment":{"dripper":{"model":"V60","material":"Plastic"},"filter_type":"Paper"},"ingredients":{"coffee_g":15.0,"water_g":225.0,"grind_setting":"Fine"},"protocol":[{"step":1,"action":"bloom","water_g":45,"duration_s":10,"flow_rate":"steady","notes":"Pour 45g (3× dose) at 5–10 ml/s — first bloom to wet all grounds"},{"step":2,"action":"wait","duration_s":20,"notes":"Wait until 0:30 — let first bloom degas"},{"step":3,"action":"pour","water_g":45,"duration_s":10,"flow_rate":"steady","notes":"Pour to 90g at 5–10 ml/s — second bloom for full saturation"},{"step":4,"action":"wait","duration_s":20,"notes":"Wait until 1:00 — let second bloom settle"},{"step":5,"action":"pour","water_g":135,"duration_s":15,"flow_rate":"fast","notes":"Pour to 225g at 9–10 ml/s in coin-sized circles in the centre — single aggressive main pour"},{"step":6,"action":"swirl","duration_s":5,"notes":"Gentle Rao spin to level the bed"}],"slug":"lance-hedrick-double-bloom"},
        {"version":"1.1.0","metadata":{"name":"Single Pour","author":"Lance Hedrick","description":"Long bloom with wet WDT to fully saturate grounds, then one continuous pour. High extraction with minimal fines migration.","compatibility":["V60"],"visualizer_hint":"linear_ramp"},"equipment":{"dripper":{"model":"V60","material":"Plastic"},"filter_type":"Paper"},"ingredients":{"coffee_g":20.0,"water_g":340.0,"grind_setting":"Medium-Coarse"},"protocol":[{"step":1,"action":"bloom","water_g":60,"duration_s":10,"notes":"Pour 60g (3× dose) to saturate all grounds evenly"},{"step":2,"action":"stir","duration_s":10,"notes":"Wet WDT — stir through the grounds with a WDT tool or chopstick to break all dry pockets"},{"step":3,"action":"wait","duration_s":80,"notes":"Wait — total bloom ~1:40"},{"step":4,"action":"pour","water_g":280,"duration_s":120,"flow_rate":"steady","notes":"Single continuous centre pour to 340g — maintain height for turbulence. After draining, swirl if slow / wet WDT if somewhat quick / turn bed with spoon if draining fast."}],"slug":"lance-hedrick-single-pour"},
        {"version":"1.1.0","metadata":{"name":"V60 Technique","author":"Scott Rao","description":"Centre-pour technique with an aggressive bloom spin (5–7 revolutions), two equal main pours separated by a 50%-drained wait, each followed by a gentle 2-revolution spin. Targets 22–24.5% extraction.","compatibility":["V60"],"visualizer_hint":"pulse_block"},"equipment":{"dripper":{"model":"V60","material":"Plastic"},"filter_type":"Paper"},"ingredients":{"coffee_g":20.0,"water_g":330.0,"grind_setting":"Medium"},"protocol":[{"step":1,"action":"bloom","water_g":60,"duration_s":5,"notes":"Spiral pour for 60g bloom"},{"step":2,"action":"swirl","duration_s":10,"notes":"Rao Spin — aggressive swirl 5–7 revolutions to fully saturate the bed"},{"step":3,"action":"wait","duration_s":35,"notes":"Wait — total bloom 45s"},{"step":4,"action":"pour","water_g":135,"duration_s":30,"flow_rate":"fast","notes":"Pour to 195g total as fast as possible with a nearly vertical stream"},{"step":5,"action":"swirl","duration_s":5,"notes":"Gentle spin — 2 revolutions to fill ribbed channels"},{"step":6,"action":"wait","duration_s":45,"notes":"Wait until slurry is ~50% drained (visual check)"},{"step":7,"action":"pour","water_g":135,"duration_s":30,"flow_rate":"fast","notes":"Pour to 330g total — same fast, vertical technique"},{"step":8,"action":"swirl","duration_s":5,"notes":"Final gentle spin — 2 revolutions to level the bed and break channels"}],"slug":"scott-rao-v60"}
      ]))
    }

    // GET /api/pour-over/preferences → stored preferences
    if (url.match(/\/api\/pour-over\/preferences$/) && method === 'GET') {
      return getDirectPourOverPreferences()
        .then((prefs) => jsonResponse(prefs))
        .catch((err) => {
          const message = err instanceof DirectStorageValidationError
            ? err.message
            : 'Failed to load pour-over preferences'
          console.error('[DirectMode] Failed to load pour-over preferences:', err)
          return jsonResponse({ detail: message }, 500)
        })
    }

    // PUT /api/pour-over/preferences → persist to direct settings storage
    if (url.match(/\/api\/pour-over\/preferences$/) && method === 'PUT') {
      return (async () => {
        try {
          const request = input instanceof Request ? input : new Request(input, init)
          const body = await request.text()
          const prefs = JSON.parse(body)
          const saved = await saveDirectPourOverPreferences(prefs)
          return jsonResponse(saved)
        } catch (err) {
          if (err instanceof DirectStorageValidationError || err instanceof SyntaxError) {
            return jsonResponse({ detail: 'Invalid preferences' }, 400)
          }
          console.error('[DirectMode] Failed to save pour-over preferences:', err)
          return jsonResponse({ detail: 'Failed to save preferences' }, 500)
        }
      })()
    }

    // POST /api/pour-over/prepare → build adapted pour-over profile and load on machine
    if (url.match(/\/api\/pour-over\/prepare$/) && method === 'POST') {
      return (async () => {
        try {
          const request = input instanceof Request ? input : new Request(input, init)
          const body = await request.text()
          const req = JSON.parse(body)
          const profile = _adaptPourOverProfile({
            targetWeight: req.target_weight ?? 300,
            bloomEnabled: req.bloom_enabled ?? true,
            bloomSeconds: req.bloom_seconds ?? 30,
            doseGrams: req.dose_grams ?? null,
            brewRatio: req.brew_ratio ?? null,
          })
          const loadResponse = await _fetch(`/api/v1/profile/load`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) })
          if (!loadResponse.ok) return jsonResponse({ status: 'error', detail: 'Failed to load pour-over profile' }, 502)
          return jsonResponse({ profile_id: profile.id, profile_name: profile.name })
        } catch (e) {
          return jsonResponse({ status: 'error', detail: (e as Error).message }, 500)
        }
      })()
    }

    // POST /api/pour-over/cleanup, force-cleanup → no-op (profile is ephemeral, no purge in pour-over)
    if (url.match(/\/api\/pour-over\/(cleanup|force-cleanup)$/)) {
      return Promise.resolve(jsonResponse({ status: 'ok' }))
    }

    // GET /api/pour-over/active → no active session tracking in direct mode
    if (url.match(/\/api\/pour-over\/active$/)) {
      return Promise.resolve(jsonResponse({ active: false }))
    }

    // POST /api/pour-over/prepare-recipe → convert OPOS recipe to profile and load on machine
    if (url.match(/\/api\/pour-over\/prepare-recipe$/) && method === 'POST') {
      return (async () => {
        try {
          const request = input instanceof Request ? input : new Request(input, init)
          const body = await request.text()
          const { recipe_slug } = JSON.parse(body)
          // Find recipe in our bundled list
          const recipesResp = await window.fetch(url.replace(/\/pour-over\/prepare-recipe$/, '/recipes'))
          const recipes = await recipesResp.json()
          const recipe = recipes.find((r: { slug: string }) => r.slug === recipe_slug)
          if (!recipe) return jsonResponse({ status: 'error', detail: `Recipe '${recipe_slug}' not found` }, 404)
          const profile = _adaptRecipeToProfile(recipe)
          const loadResponse = await _fetch(`/api/v1/profile/load`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) })
          if (!loadResponse.ok) return jsonResponse({ status: 'error', detail: 'Failed to load recipe profile' }, 502)
          return jsonResponse({ profile_id: profile.id, profile_name: profile.name })
        } catch (e) {
          return jsonResponse({ status: 'error', detail: (e as Error).message }, 500)
        }
      })()
    }

    // POST /api/profile/:id/regenerate-description → use BrowserAIService
    const regenDescMatch = url.match(/\/api\/profile\/([^/]+)\/regenerate-description$/)
    if (regenDescMatch && method === 'POST') {
      return (async () => {
        try {
          const entryId = decodeURIComponent(regenDescMatch[1])
          let profileJson: Record<string, unknown> | null = null
          let profileName = entryId

          // Strategy 1: Try entryId as a history entry
          try {
            const history = await _loadVisibleHistory()
            const histEntry = history.find(e => e.id === entryId)
            if (histEntry) {
              profileName = getHistoryProfileName(histEntry)
              const cached = _profileCache.get(profileName)
              if (cached) {
                const r = await _fetch(`/api/v1/profile/get/${cached.id}`)
                if (r.ok) profileJson = await r.json()
              }
            }
          } catch { /* History lookup failed */ }

          // Strategy 2: Try entryId as a profile name via cache
          if (!profileJson) {
            const cached = _profileCache.get(entryId)
            if (cached) {
              const r = await _fetch(`/api/v1/profile/get/${cached.id}`)
              if (r.ok) { profileJson = await r.json(); profileName = entryId }
            }
          }

          // Strategy 3: Try entryId as a machine profile ID directly
          if (!profileJson) {
            const r = await _fetch(`/api/v1/profile/get/${entryId}`)
            if (r.ok) profileJson = await r.json()
          }

          if (!profileJson) {
            return jsonResponse({ status: 'error', detail: 'History entry not found' }, 404)
          }

          // Try AI description first, fall back to static
          const aiService = createBrowserAIService()
          if (aiService.isConfigured()) {
            try {
              const { GoogleGenAI } = await import('@google/genai')
              const key = localStorage.getItem(STORAGE_KEYS.GEMINI_API_KEY)
              if (!key) throw new Error('No API key')
              const client = new GoogleGenAI({ apiKey: key })
              const resolvedName = (profileJson as {name?: string}).name || profileName || 'Unknown Profile'
              const prompt = `You are a specialty coffee expert. Analyze this espresso machine profile JSON and write a detailed description.\n\nProfile name: ${resolvedName}\nProfile JSON:\n${JSON.stringify(profileJson, null, 2)}\n\nWrite the description in this exact format:\nProfile Created: [name]\nDescription: [1-2 sentence overview]\nPreparation: [brewing guidance]\nWhy This Works: [technical explanation]\nSpecial Notes: [any notable aspects]`
              const response = await client.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
              })
              const description = response.text?.trim()
              if (description && !description.includes('generated without AI')) {
                _descriptionCache.set(profileName, description)
                _persistDescriptionCache()
                return jsonResponse({ status: 'success', description })
              }
            } catch { /* AI generation failed — fall back to static */ }
          }

          // Static fallback
          const { buildStaticProfileDescription } = await import('@/lib/staticProfileDescription')
          const description = buildStaticProfileDescription(profileJson as Parameters<typeof buildStaticProfileDescription>[0])
          _descriptionCache.set(profileName, description)
          _persistDescriptionCache()
          return jsonResponse({ status: 'success', description })
        } catch {
          return jsonResponse({ status: 'error', detail: 'Failed to regenerate description' }, 500)
        }
      })()
    }

    // ── Settings & status endpoints ─────────────────────────────────────

    // GET/POST /api/settings → read/write from localStorage in direct mode
    if (url.match(/\/api\/settings$/) && method === 'GET') {
      return Promise.resolve(jsonResponse({
        geminiApiKey: localStorage.getItem(STORAGE_KEYS.GEMINI_API_KEY) || '',
        geminiApiKeyConfigured: Boolean(localStorage.getItem(STORAGE_KEYS.GEMINI_API_KEY)?.trim()),
        meticulousIp: getDefaultMachineUrl() || '',
        authorName: localStorage.getItem(STORAGE_KEYS.AUTHOR_NAME) || '',
        geminiModel: localStorage.getItem(STORAGE_KEYS.GEMINI_MODEL) || '',
        mqttEnabled: true,
      }))
    }
    if (url.match(/\/api\/settings$/) && method === 'POST') {
      return (async () => {
        try {
          const request = input instanceof Request ? input : new Request(input, init)
          const body = JSON.parse(await request.text())
          if (body.geminiApiKey !== undefined) localStorage.setItem(STORAGE_KEYS.GEMINI_API_KEY, body.geminiApiKey)
          if (body.authorName !== undefined) localStorage.setItem(STORAGE_KEYS.AUTHOR_NAME, body.authorName)
          if (body.geminiModel !== undefined) localStorage.setItem(STORAGE_KEYS.GEMINI_MODEL, body.geminiModel)
          return jsonResponse({ status: 'ok' })
        } catch (e) {
          return jsonResponse({ status: 'error', detail: (e as Error).message }, 500)
        }
      })()
    }

    // GET /api/health → always healthy in direct mode
    if (url.match(/\/api\/health$/)) {
      return Promise.resolve(jsonResponse({ status: 'ok', mode: 'direct' }))
    }

    // GET /api/version → return app version
    if (url.match(/\/api\/version$/)) {
      return Promise.resolve(jsonResponse({
        version: (globalThis as Record<string, unknown>).__APP_VERSION__ || 'unknown',
        mode: 'direct',
      }))
    }

    // GET /api/network-ip → return configured machine IP
    if (url.match(/\/api\/network-ip$/)) {
      const machineIp = localStorage.getItem(STORAGE_KEYS.MACHINE_IP) || ''
      return Promise.resolve(jsonResponse({ ip: machineIp }))
    }

    // GET /api/machine/detect → not needed in direct mode
    if (url.match(/\/api\/machine\/detect/)) {
      return Promise.resolve(jsonResponse({ detail: 'Machine detection not available in direct mode' }, 501))
    }

    // ── Backend-only admin routes — return sensible stubs ──────────────

    if (url.match(/\/api\/update-method/)) {
      return Promise.resolve(jsonResponse({ method: 'manual', can_trigger_update: false }))
    }
    if (url.match(/\/api\/tailscale-status/)) {
      return Promise.resolve(jsonResponse({ enabled: false, installed: false }))
    }
    if (url.match(/\/api\/changelog/)) {
      return Promise.resolve(jsonResponse({ releases: [] }))
    }
    if (url.match(/\/api\/(check-updates|restart|beta-channel|feedback)/)) {
      return Promise.resolve(jsonResponse({ detail: 'Server administration not available in direct/app mode' }, 501))
    }

    // Unknown route — return 501 Not Implemented instead of silent empty response
    return Promise.resolve(jsonResponse({ error: 'Not implemented in direct mode', path: pathname }, 501))
  }
}
