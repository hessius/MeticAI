/**
 * On-device AI settings (#373).
 *
 * Renders the local-model management UI (backend selection, Apple Intelligence
 * readiness, Gemma download/delete/progress, device-capability warnings) and,
 * when the AI mode is "both", the per-feature Local/Cloud routing toggles.
 *
 * Self-contained: reads and writes on-device state through the provider
 * registry helpers and dispatches {@link AI_PREFS_CHANGED_EVENT} so the AI gate
 * refreshes immediately.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle, Warning, ArrowsClockwise, DownloadSimple, TrashSimple } from '@phosphor-icons/react'
import { Label } from '@/components/ui/label'
import { AI_PREFS_CHANGED_EVENT } from '@/lib/aiPreferences'
import {
  AI_METHODS,
  APPLE_INTELLIGENCE_MODEL_ID,
  GEMMA_MODEL_ID,
  GEMMA_DOWNLOAD_BYTES,
  cancelDownload,
  checkDeviceCapability,
  deleteModel,
  downloadModel,
  getAvailableBackends,
  getLocalBackend,
  getModelStatus,
  getRouteForMethod,
  refreshLocalReadiness,
  setLocalBackend,
  setRouteForMethod,
  type AIMethod,
  type AIMode,
  type DeviceCapability,
  type LocalBackend,
  type ModelStatus,
} from '@/services/ai/providers'

function formatGB(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

function notifyChanged(): void {
  window.dispatchEvent(new CustomEvent(AI_PREFS_CHANGED_EVENT, { detail: { providerChanged: true } }))
}

export function LocalAISettings({ mode }: { mode: AIMode }) {
  const { t } = useTranslation()
  const backends = getAvailableBackends()
  const [backend, setBackend] = useState<LocalBackend>(getLocalBackend())
  const [readiness, setReadiness] = useState<{ ready: boolean; readiness: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [modelStatus, setModelStatus] = useState<ModelStatus>(getModelStatus())
  const [progress, setProgress] = useState<number | null>(null)
  const [capability, setCapability] = useState<DeviceCapability | null>(null)
  const [error, setError] = useState('')

  const probeReadiness = useCallback(async () => {
    setChecking(true)
    try {
      setReadiness(await refreshLocalReadiness())
    } finally {
      setChecking(false)
    }
  }, [])

  // Probe Apple Intelligence readiness when it is the active backend. Deferred a
  // microtask so the synchronous `setChecking(true)` doesn't run inside the effect.
  useEffect(() => {
    if (backend !== APPLE_INTELLIGENCE_MODEL_ID) return
    void Promise.resolve().then(() => probeReadiness())
  }, [backend, probeReadiness])

  // Surface device capability when Gemma is the active backend.
  useEffect(() => {
    if (backend === GEMMA_MODEL_ID) {
      void checkDeviceCapability().then(setCapability)
    }
  }, [backend])

  const handleBackendChange = (next: LocalBackend) => {
    setLocalBackend(next)
    setBackend(next)
    setModelStatus(getModelStatus())
    notifyChanged()
  }

  const handleDownload = async () => {
    setError('')
    setProgress(null)
    setModelStatus('downloading')
    try {
      await downloadModel((p) => setProgress(p.percent))
      setModelStatus(getModelStatus())
      notifyChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setModelStatus('error')
    } finally {
      setProgress(null)
    }
  }

  const handleCancel = () => {
    cancelDownload()
    setProgress(null)
    setModelStatus(getModelStatus())
  }

  const handleDelete = async () => {
    await deleteModel()
    setModelStatus(getModelStatus())
    notifyChanged()
  }

  const showBackendSelector = backends.length > 1

  return (
    <div className="space-y-4">
      {showBackendSelector && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">{t('settings.localBackend')}</Label>
          <div className="grid grid-cols-2 gap-2">
            {backends.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => handleBackendChange(b)}
                className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                  backend === b
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input bg-background text-muted-foreground hover:bg-accent'
                }`}
              >
                {b === APPLE_INTELLIGENCE_MODEL_ID
                  ? t('settings.localBackendApple')
                  : t('settings.localBackendGemma')}
              </button>
            ))}
          </div>
        </div>
      )}

      {backend === APPLE_INTELLIGENCE_MODEL_ID ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">{t('settings.localModelStatus')}</Label>
            <button
              type="button"
              onClick={() => void probeReadiness()}
              disabled={checking}
              className="text-xs text-primary hover:underline flex items-center gap-1 disabled:opacity-50"
            >
              <ArrowsClockwise size={12} className={checking ? 'animate-spin' : ''} />
              {t('settings.localModelRecheck')}
            </button>
          </div>
          <div className="rounded-md border border-input bg-background px-3 py-2 text-sm flex items-center gap-2">
            {checking ? (
              <span className="text-muted-foreground">{t('settings.localModelChecking')}</span>
            ) : readiness?.ready ? (
              <span className="text-success flex items-center gap-1">
                <CheckCircle size={14} weight="fill" />
                {t('settings.localModelReady')}
              </span>
            ) : (
              <span className="text-amber-500 flex items-center gap-1">
                <Warning size={14} weight="fill" />
                {t('settings.localModelUnavailable')}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.localModelDescription')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label className="text-sm font-medium">{t('settings.localModelGemmaTitle')}</Label>
          <div className="rounded-md border border-input bg-background px-3 py-2 text-sm flex items-center gap-2">
            {modelStatus === 'ready' ? (
              <span className="text-success flex items-center gap-1">
                <CheckCircle size={14} weight="fill" />
                {t('settings.localModelGemmaReady')}
              </span>
            ) : modelStatus === 'downloading' ? (
              <span className="text-muted-foreground flex items-center gap-1">
                <ArrowsClockwise size={14} className="animate-spin" />
                {progress === null
                  ? t('settings.localModelDownloadingIndeterminate')
                  : t('settings.localModelDownloading', { percent: Math.round(progress) })}
              </span>
            ) : modelStatus === 'error' ? (
              <span className="text-destructive flex items-center gap-1">
                <Warning size={14} weight="fill" />
                {error || t('settings.localModelGemmaError')}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {t('settings.localModelGemmaNotDownloaded', { size: formatGB(GEMMA_DOWNLOAD_BYTES) })}
              </span>
            )}
          </div>

          {modelStatus === 'downloading' && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              {progress === null ? (
                <div
                  className="h-full w-2/5 rounded-full bg-primary animate-pulse"
                  role="progressbar"
                  aria-label={t('settings.localModelDownloadingIndeterminate')}
                />
              ) : (
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                  role="progressbar"
                  aria-valuenow={Math.round(progress)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              )}
            </div>
          )}

          {capability && !capability.enoughStorage && (
            <p className="text-xs text-amber-500 flex items-center gap-1">
              <Warning size={12} weight="fill" />
              {t('settings.localModelLowStorage')}
            </p>
          )}
          {capability && !capability.enoughMemory && (
            <p className="text-xs text-amber-500 flex items-center gap-1">
              <Warning size={12} weight="fill" />
              {t('settings.localModelLowMemory')}
            </p>
          )}

          <div className="flex gap-2">
            {modelStatus === 'downloading' ? (
              <button
                type="button"
                onClick={handleCancel}
                className="flex items-center gap-1 rounded-md border border-input px-3 py-1.5 text-xs hover:bg-accent"
              >
                {t('settings.localModelCancel')}
              </button>
            ) : modelStatus === 'ready' ? (
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="flex items-center gap-1 rounded-md border border-input px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
              >
                <TrashSimple size={12} />
                {t('settings.localModelDelete')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleDownload()}
                className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
              >
                <DownloadSimple size={12} />
                {t('settings.localModelDownload', { size: formatGB(GEMMA_DOWNLOAD_BYTES) })}
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.localModelGemmaDescription')}</p>
        </div>
      )}

      {mode === 'both' && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">{t('settings.aiRouting')}</Label>
          <p className="text-xs text-muted-foreground">{t('settings.aiRoutingHint')}</p>
          <div className="space-y-2">
            {AI_METHODS.map((method) => (
              <RouteToggle key={method} method={method} />
            ))}
            <div className="flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm">
              <span>{t('settings.aiRouteImageGeneration')}</span>
              <span className="text-xs text-muted-foreground">{t('settings.aiRouteCloudRequired')}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function RouteToggle({ method }: { method: AIMethod }) {
  const { t } = useTranslation()
  const [route, setRoute] = useState(getRouteForMethod(method))

  const choose = (next: 'local' | 'hosted') => {
    setRouteForMethod(method, next)
    setRoute(next)
    notifyChanged()
  }

  const labels: Record<AIMethod, string> = {
    analyzeShot: t('settings.aiRouteAnalyzeShot'),
    generateProfile: t('settings.aiRouteGenerateProfile'),
    recommendations: t('settings.aiRouteRecommendations'),
    dialIn: t('settings.aiRouteDialIn'),
  }

  return (
    <div className="flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm">
      <span>{labels[method]}</span>
      <div className="flex overflow-hidden rounded-md border border-input">
        <button
          type="button"
          onClick={() => choose('local')}
          className={`px-2 py-1 text-xs ${route === 'local' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground'}`}
        >
          {t('settings.aiRouteLocal')}
        </button>
        <button
          type="button"
          onClick={() => choose('hosted')}
          className={`px-2 py-1 text-xs ${route === 'hosted' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground'}`}
        >
          {t('settings.aiRouteCloud')}
        </button>
      </div>
    </div>
  )
}
