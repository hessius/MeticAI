import { STORAGE_KEYS } from '@/lib/constants'
import {
  deleteAnnotation,
  deleteDialInSession,
  deleteProfileImage,
  deleteSetting,
  getAnnotation,
  getAllAnnotations,
  getDialInSession,
  getProfileImage,
  getSetting,
  listDialInSessions,
  saveDialInSession,
  setAnnotation,
  setProfileImage,
  setSetting,
} from '@/services/storage/AppDatabase'

type JsonRecord = Record<string, unknown>
const HISTORY_TOMBSTONES_KEY = 'direct-history-deleted-ids'

type DirectModePreferences = {
  autoStart: boolean
  bloomEnabled: boolean
  bloomSeconds: number
  bloomWeightMultiplier: number
  machineIntegration: boolean
  doseGrams: number | null
  brewRatio: number | null
}

type DirectRecipeModePreferences = {
  machineIntegration: boolean
  autoStart: boolean
  progressionMode: 'weight' | 'time'
}

export type DirectPourOverPreferences = {
  free: DirectModePreferences
  ratio: DirectModePreferences
  recipe: DirectRecipeModePreferences
}

export class DirectStorageValidationError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'DirectStorageValidationError'
  }
}

type DirectDialInStatus = 'active' | 'completed' | 'abandoned'

type DirectDialInTaste = {
  x: number
  y: number
  descriptors: string[]
  notes?: string
}

type DirectDialInIteration = {
  iteration_number: number
  shot_ref?: string | null
  taste: DirectDialInTaste
  recommendations: string[]
  timestamp: string
}

export type DirectDialInSession = {
  id: string
  coffee: Record<string, unknown>
  profile_name?: string
  iterations: DirectDialInIteration[]
  status: DirectDialInStatus
  created_at: string
  updated_at: string
}

const MODE_DEFAULTS: DirectModePreferences = {
  autoStart: true,
  bloomEnabled: true,
  bloomSeconds: 30,
  bloomWeightMultiplier: 2,
  machineIntegration: false,
  doseGrams: null,
  brewRatio: null,
}

const RECIPE_DEFAULTS: DirectRecipeModePreferences = {
  machineIntegration: false,
  autoStart: true,
  progressionMode: 'weight',
}

function createDefaultPourOverPreferences(): DirectPourOverPreferences {
  return {
    free: { ...MODE_DEFAULTS },
    ratio: { ...MODE_DEFAULTS, doseGrams: 18, brewRatio: 15 },
    recipe: { ...RECIPE_DEFAULTS },
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) {
    throw new DirectStorageValidationError(`${label} must be an object`)
  }
  return value
}

function nowIso(): string {
  return new Date().toISOString()
}

function generateDialInId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.()
  if (randomUuid) return randomUuid.replace(/-/g, '').slice(0, 12)
  const randomBytes = new Uint8Array(6)
  globalThis.crypto?.getRandomValues?.(randomBytes)
  if (randomBytes.some((byte) => byte !== 0)) {
    return Array.from(randomBytes, byte => byte.toString(16).padStart(2, '0')).join('')
  }
  return Math.random().toString(16).slice(2, 14).padEnd(12, '0')
}

function normalizeCoffeeDetails(value: unknown): Record<string, unknown> {
  const record = requireRecord(value, 'coffee')
  const roastLevel = record.roast_level
  const validRoasts = new Set(['light', 'medium-light', 'medium', 'medium-dark', 'dark'])
  if (typeof roastLevel !== 'string' || !validRoasts.has(roastLevel)) {
    throw new DirectStorageValidationError('coffee.roast_level must be a valid roast level')
  }

  const result: Record<string, unknown> = { roast_level: roastLevel }
  for (const key of ['origin', 'roast_date'] as const) {
    const valueForKey = record[key]
    if (valueForKey !== undefined) {
      if (typeof valueForKey !== 'string') {
        throw new DirectStorageValidationError(`coffee.${key} must be a string`)
      }
      result[key] = valueForKey
    }
  }

  const process = record.process
  if (process !== undefined) {
    const validProcesses = new Set(['washed', 'natural', 'honey', 'anaerobic', 'other'])
    if (typeof process !== 'string' || !validProcesses.has(process)) {
      throw new DirectStorageValidationError('coffee.process must be a valid process')
    }
    result.process = process
  }
  return result
}

function normalizeTasteFeedback(value: unknown): DirectDialInTaste {
  const record = requireRecord(value, 'taste')
  const x = readNumber(record, 'x', Number.NaN)
  const y = readNumber(record, 'y', Number.NaN)
  if (!Number.isFinite(x)) throw new DirectStorageValidationError('taste.x must be a finite number')
  if (!Number.isFinite(y)) throw new DirectStorageValidationError('taste.y must be a finite number')
  if (x < -1 || x > 1) throw new DirectStorageValidationError('taste.x must be between -1 and 1')
  if (y < -1 || y > 1) throw new DirectStorageValidationError('taste.y must be between -1 and 1')

  const descriptorsValue = record.descriptors ?? []
  if (!Array.isArray(descriptorsValue) || descriptorsValue.some((item) => typeof item !== 'string')) {
    throw new DirectStorageValidationError('taste.descriptors must be a list of strings')
  }

  const notes = record.notes
  if (notes !== undefined && typeof notes !== 'string') {
    throw new DirectStorageValidationError('taste.notes must be a string')
  }

  return {
    x,
    y,
    descriptors: descriptorsValue,
    ...(notes !== undefined ? { notes } : {}),
  }
}

function normalizeRecommendations(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new DirectStorageValidationError('recommendations must be a list of strings')
  }
  return value
}

function stripStoredDialInSession(value: unknown): DirectDialInSession | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.id !== 'string' || !isRecord(value.coffee)) return undefined
  const isLegacySession = value.status === undefined && Array.isArray(value.steps)
  const status = value.status
  if (status !== 'active' && status !== 'completed' && status !== 'abandoned' && !isLegacySession) return undefined
  const iterations = Array.isArray(value.iterations) ? value.iterations : []
  if (iterations.some((iteration) => !isRecord(iteration))) return undefined
  const legacyTimestamp = typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
    ? new Date(value.createdAt).toISOString()
    : nowIso()
  return {
    id: value.id,
    coffee: value.coffee,
    ...(typeof value.profile_name === 'string' ? { profile_name: value.profile_name } : {}),
    iterations: iterations as DirectDialInIteration[],
    status: isLegacySession ? 'active' : status as DirectDialInStatus,
    created_at: typeof value.created_at === 'string' ? value.created_at : legacyTimestamp,
    updated_at: typeof value.updated_at === 'string' ? value.updated_at : legacyTimestamp,
  }
}

function readBoolean(record: JsonRecord, key: string, fallback: boolean): boolean {
  const value = record[key]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') {
    throw new DirectStorageValidationError(`${key} must be a boolean`)
  }
  return value
}

function readNumber(record: JsonRecord, key: string, fallback: number): number {
  const value = record[key]
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DirectStorageValidationError(`${key} must be a finite number`)
  }
  return value
}

function readNullableNumber(record: JsonRecord, key: string, fallback: number | null): number | null {
  const value = record[key]
  if (value === undefined) return fallback
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DirectStorageValidationError(`${key} must be a finite number or null`)
  }
  return value
}

function normalizeModePreferences(value: unknown, defaults: DirectModePreferences, label: string): DirectModePreferences {
  const record = requireRecord(value === undefined ? {} : value, label)
  return {
    autoStart: readBoolean(record, 'autoStart', defaults.autoStart),
    bloomEnabled: readBoolean(record, 'bloomEnabled', defaults.bloomEnabled),
    bloomSeconds: readNumber(record, 'bloomSeconds', defaults.bloomSeconds),
    bloomWeightMultiplier: readNumber(record, 'bloomWeightMultiplier', defaults.bloomWeightMultiplier),
    machineIntegration: readBoolean(record, 'machineIntegration', defaults.machineIntegration),
    doseGrams: readNullableNumber(record, 'doseGrams', defaults.doseGrams),
    brewRatio: readNullableNumber(record, 'brewRatio', defaults.brewRatio),
  }
}

function normalizeRecipePreferences(value: unknown): DirectRecipeModePreferences {
  const record = requireRecord(value === undefined ? {} : value, 'recipe')
  const progressionMode = record.progressionMode ?? RECIPE_DEFAULTS.progressionMode
  if (progressionMode !== 'weight' && progressionMode !== 'time') {
    throw new DirectStorageValidationError('progressionMode must be weight or time')
  }
  return {
    machineIntegration: readBoolean(record, 'machineIntegration', RECIPE_DEFAULTS.machineIntegration),
    autoStart: readBoolean(record, 'autoStart', RECIPE_DEFAULTS.autoStart),
    progressionMode,
  }
}

function normalizePourOverPreferences(value: unknown): DirectPourOverPreferences {
  const defaults = createDefaultPourOverPreferences()
  if (value === undefined) return defaults
  const record = requireRecord(value, 'pour-over preferences')
  return {
    free: normalizeModePreferences(record.free, defaults.free, 'free'),
    ratio: normalizeModePreferences(record.ratio, defaults.ratio, 'ratio'),
    recipe: normalizeRecipePreferences(record.recipe),
  }
}

function getLegacyPourOverPreferences(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.POUR_OVER_PREFS)
  } catch {
    return null
  }
}

function removeLegacyPourOverPreferences(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.POUR_OVER_PREFS)
  } catch {
    // localStorage cleanup failure should not block a successful migration.
  }
}

export async function getDirectSetting<T = unknown>(key: string): Promise<T | undefined> {
  return getSetting<T>(key)
}

export async function setDirectSetting(key: string, value: unknown): Promise<void> {
  await setSetting(key, value)
}

export async function getDirectAnnotationSummaries(): Promise<{
  status: 'success'
  annotations: Record<string, { has_annotation: boolean; rating: number | null }>
}> {
  const annotations = await getAllAnnotations()
  const summaries: Record<string, { has_annotation: boolean; rating: number | null }> = {}
  for (const entry of annotations) {
    summaries[entry.shotKey] = {
      has_annotation: entry.notes.trim().length > 0,
      rating: entry.rating,
    }
  }
  return { status: 'success', annotations: summaries }
}

function shotKey(date: string, filename: string): string {
  return `${date}/${filename}`
}

export async function getDirectShotAnnotation(date: string, filename: string): Promise<{
  status: 'success'
  annotation: string | null
  rating: number | null
  updated_at: string | null
}> {
  const annotation = await getAnnotation(shotKey(date, filename))
  return {
    status: 'success',
    annotation: annotation?.notes.trim() ? annotation.notes : null,
    rating: annotation?.rating ?? null,
    updated_at: annotation?.updatedAt ? new Date(annotation.updatedAt).toISOString() : null,
  }
}

function normalizeAnnotationRating(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new DirectStorageValidationError('Rating must be an integer between 1 and 5')
  }
  if (value < 1 || value > 5) {
    throw new DirectStorageValidationError('Rating must be between 1 and 5')
  }
  return value
}

export async function saveDirectShotAnnotation(date: string, filename: string, value: {
  annotation?: string
  rating?: number | null
}): Promise<{
  status: 'success'
  annotation: string | null
  rating: number | null
  updated_at: string | null
}> {
  const key = shotKey(date, filename)
  const existing = await getAnnotation(key)
  const hasAnnotation = Object.prototype.hasOwnProperty.call(value, 'annotation')
  const hasRating = Object.prototype.hasOwnProperty.call(value, 'rating')
  const nextAnnotation = hasAnnotation ? (value.annotation ?? '').trim() : existing?.notes ?? ''
  const nextRating = hasRating ? normalizeAnnotationRating(value.rating) ?? null : existing?.rating ?? null

  if (!nextAnnotation && nextRating === null) {
    await deleteAnnotation(key)
    return {
      status: 'success',
      annotation: null,
      rating: null,
      updated_at: null,
    }
  }

  await setAnnotation(key, {
    notes: hasAnnotation ? nextAnnotation : undefined,
    rating: hasRating ? nextRating : undefined,
  })
  const stored = await getAnnotation(key)
  return {
    status: 'success',
    annotation: stored?.notes.trim() ? stored.notes : null,
    rating: stored?.rating ?? null,
    updated_at: new Date(stored?.updatedAt ?? Date.now()).toISOString(),
  }
}

export async function deleteDirectShotAnnotation(date: string, filename: string): Promise<{
  status: 'success'
  deleted: boolean
}> {
  return {
    status: 'success',
    deleted: await deleteAnnotation(shotKey(date, filename)),
  }
}

const historyNotesKey = (entryId: string) => `history-notes:${entryId}`

type DirectHistoryNotes = {
  notes: string | null
  notes_updated_at: string | null
}

export async function getDirectHistoryNotes(entryId: string): Promise<DirectHistoryNotes> {
  const stored = await getDirectSetting<DirectHistoryNotes>(historyNotesKey(entryId))
  return {
    notes: stored?.notes ?? null,
    notes_updated_at: stored?.notes_updated_at ?? null,
  }
}

export async function saveDirectHistoryNotes(entryId: string, notes: string): Promise<{
  status: 'success'
  notes: string
  notes_updated_at: string
}> {
  const notes_updated_at = new Date().toISOString()
  await setDirectSetting(historyNotesKey(entryId), { notes, notes_updated_at })
  return { status: 'success', notes, notes_updated_at }
}

export async function getDirectDeletedHistoryIds(): Promise<Set<string>> {
  const stored = await getDirectSetting<unknown>(HISTORY_TOMBSTONES_KEY)
  return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [])
}

async function saveDeletedHistoryIds(ids: Set<string>): Promise<void> {
  await setDirectSetting(HISTORY_TOMBSTONES_KEY, Array.from(ids))
}

export async function deleteDirectHistoryEntry(entryId: string): Promise<void> {
  const deleted = await getDirectDeletedHistoryIds()
  deleted.add(entryId)
  await saveDeletedHistoryIds(deleted)
  await deleteSetting(historyNotesKey(entryId))
}

export async function clearDirectHistory(entryIds: string[]): Promise<void> {
  const deleted = await getDirectDeletedHistoryIds()
  for (const entryId of entryIds) {
    deleted.add(entryId)
    await deleteSetting(historyNotesKey(entryId))
  }
  await saveDeletedHistoryIds(deleted)
}

export async function getDirectPourOverPreferences(): Promise<DirectPourOverPreferences> {
  const stored = await getDirectSetting(STORAGE_KEYS.POUR_OVER_PREFS)
  if (stored !== undefined) {
    return normalizePourOverPreferences(stored)
  }
  const legacy = getLegacyPourOverPreferences()
  if (legacy !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(legacy)
    } catch {
      throw new DirectStorageValidationError('Legacy pour-over preferences are invalid JSON')
    }
    const normalized = normalizePourOverPreferences(parsed)
    await setDirectSetting(STORAGE_KEYS.POUR_OVER_PREFS, normalized)
    removeLegacyPourOverPreferences()
    return normalized
  }
  return normalizePourOverPreferences(stored)
}

export async function saveDirectPourOverPreferences(value: unknown): Promise<DirectPourOverPreferences> {
  const normalized = normalizePourOverPreferences(value)
  await setDirectSetting(STORAGE_KEYS.POUR_OVER_PREFS, normalized)
  return normalized
}

export async function getDirectDialInSession(id: string): Promise<DirectDialInSession | undefined> {
  return stripStoredDialInSession(await getDialInSession(id))
}

export async function saveDirectDialInSession(session: DirectDialInSession): Promise<void> {
  await saveDialInSession(session)
}

export async function createDirectDialInSession(value: unknown): Promise<DirectDialInSession> {
  const record = requireRecord(value, 'dial-in session')
  const coffee = normalizeCoffeeDetails(isRecord(record.coffee) ? record.coffee : record)
  const profileName = record.profile_name
  if (profileName !== undefined && typeof profileName !== 'string') {
    throw new DirectStorageValidationError('profile_name must be a string')
  }

  const timestamp = nowIso()
  const session: DirectDialInSession = {
    id: generateDialInId(),
    coffee,
    ...(profileName ? { profile_name: profileName } : {}),
    iterations: [],
    status: 'active',
    created_at: timestamp,
    updated_at: timestamp,
  }
  await saveDirectDialInSession(session)
  return session
}

export async function listDirectDialInSessions(status?: string | null): Promise<DirectDialInSession[]> {
  if (status !== undefined && status !== null && status !== 'active' && status !== 'completed' && status !== 'abandoned') {
    throw new DirectStorageValidationError('status must be active, completed, or abandoned')
  }
  const sessions = (await listDialInSessions())
    .map(stripStoredDialInSession)
    .filter((session): session is DirectDialInSession => session !== undefined)
  return status ? sessions.filter((session) => session.status === status) : sessions
}

export async function addDirectDialInIteration(sessionId: string, value: unknown): Promise<DirectDialInIteration> {
  const session = await getDirectDialInSession(sessionId)
  if (!session) throw new DirectStorageValidationError(`Session ${sessionId} not found`, 404)
  if (session.status !== 'active') throw new DirectStorageValidationError(`Session ${sessionId} is not active`, 404)

  const record = requireRecord(value, 'dial-in iteration')
  const shotRef = record.shot_ref
  if (shotRef !== undefined && shotRef !== null && typeof shotRef !== 'string') {
    throw new DirectStorageValidationError('shot_ref must be a string or null')
  }
  const iteration: DirectDialInIteration = {
    iteration_number: session.iterations.length + 1,
    ...(shotRef !== undefined ? { shot_ref: shotRef as string | null } : {}),
    taste: normalizeTasteFeedback(record.taste),
    recommendations: [],
    timestamp: nowIso(),
  }
  session.iterations.push(iteration)
  session.updated_at = nowIso()
  await saveDirectDialInSession(session)
  return iteration
}

export async function updateDirectDialInRecommendations(
  sessionId: string,
  iterationNumber: number,
  value: unknown,
): Promise<DirectDialInIteration> {
  const session = await getDirectDialInSession(sessionId)
  if (!session) throw new DirectStorageValidationError(`Session ${sessionId} not found`, 404)
  const record = requireRecord(value, 'recommendation update')
  const recommendations = normalizeRecommendations(record.recommendations)
  const iteration = session.iterations.find((item) => item.iteration_number === iterationNumber)
  if (!iteration) {
    throw new DirectStorageValidationError(`Iteration ${iterationNumber} not found in session ${sessionId}`, 404)
  }
  iteration.recommendations = recommendations
  session.updated_at = nowIso()
  await saveDirectDialInSession(session)
  return iteration
}

function buildDialInRecommendations(taste: DirectDialInTaste): string[] {
  const recommendations: string[] = []
  if (taste.x < -0.2) {
    recommendations.push('Grind finer (2-3 steps)')
    recommendations.push('Increase temperature by 1-2°C')
  }
  if (taste.x > 0.2) {
    recommendations.push('Grind coarser (2-3 steps)')
    recommendations.push('Decrease temperature by 1-2°C')
  }
  if (taste.y < -0.2) recommendations.push('Increase dose by 0.3-0.5g')
  if (taste.y > 0.2) recommendations.push('Decrease dose by 0.3-0.5g')
  if (recommendations.length === 0) recommendations.push('Looking good! Small tweaks only — try ±0.5°C or ±0.2g dose')
  return recommendations
}

export async function generateDirectDialInRecommendations(sessionId: string): Promise<{
  recommendations: string[]
  source: 'rules'
}> {
  const session = await getDirectDialInSession(sessionId)
  if (!session) throw new DirectStorageValidationError('Session not found', 404)
  if (!session.iterations.length) throw new DirectStorageValidationError('No iterations to recommend from', 400)
  const latest = session.iterations[session.iterations.length - 1]
  latest.recommendations = buildDialInRecommendations(latest.taste)
  session.updated_at = nowIso()
  await saveDirectDialInSession(session)
  return { recommendations: latest.recommendations, source: 'rules' }
}

export async function completeDirectDialInSession(id: string): Promise<DirectDialInSession> {
  const session = await getDirectDialInSession(id)
  if (!session) throw new DirectStorageValidationError(`Session ${id} not found`, 404)
  session.status = 'completed'
  session.updated_at = nowIso()
  await saveDirectDialInSession(session)
  return session
}

export async function deleteDirectDialInSession(id: string): Promise<boolean> {
  return deleteDialInSession(id)
}

export async function getDirectProfileImage(profileId: string) {
  return getProfileImage(profileId)
}

export async function saveDirectProfileImage(profileId: string, imageBlob: Blob) {
  await setProfileImage(profileId, imageBlob)
}

export async function deleteDirectProfileImage(profileId: string) {
  await deleteProfileImage(profileId)
}
