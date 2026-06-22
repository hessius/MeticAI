import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowClockwise, CaretLeft, WifiSlash, Thermometer, HardDrives, Memory, Clock } from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'
import { StatusGauge } from '@/components/StatusGauge'
import { ServiceCard } from '@/components/ServiceCard'

const REFRESH_INTERVAL = 30 // seconds

interface ServiceInfo {
  name: string
  status: string
  uptime?: string | number | null
}

interface SystemMetrics {
  disk_used?: number
  disk_total?: number
  memory_used?: number
  memory_total?: number
  cpu_temperature?: number
  uptime?: number
}

interface WatcherResponse {
  error?: string
  services?: ServiceInfo[]
  system?: SystemMetrics | null
}

interface SystemInfoResponse {
  firmware?: Record<string, unknown> | null
  network?: Record<string, unknown> | null
  hostname?: Record<string, unknown> | null
}

interface MachineStatusCenterProps {
  onBack: () => void
}

function formatMachineUptime(seconds: number | undefined | null): string {
  if (seconds == null || isNaN(seconds) || seconds < 0) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  parts.push(`${m}m`)
  return parts.join(' ')
}

function tempColor(temp: number): string {
  if (temp < 60) return 'text-green-500'
  if (temp < 80) return 'text-yellow-500'
  return 'text-red-500'
}

export function MachineStatusCenter({ onBack }: MachineStatusCenterProps) {
  const { t } = useTranslation()
  const [watcherData, setWatcherData] = useState<WatcherResponse | null>(null)
  const [systemInfo, setSystemInfo] = useState<SystemInfoResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL)
  const [secondsAgo, setSecondsAgo] = useState<number | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  // Fetch data whenever refreshTrigger changes (initial + manual + interval)
  useEffect(() => {
    let cancelled = false
    const doFetch = async () => {
      setLoading(true)
      try {
        const serverUrl = await getServerUrl()
        const [watcherResp, sysResp] = await Promise.allSettled([
          fetch(`${serverUrl}/api/machine/status/health`),
          fetch(`${serverUrl}/api/machine/system-info`),
        ])
        if (cancelled) return
        let watcherError = false
        if (watcherResp.status === 'fulfilled' && watcherResp.value.ok) {
          const data = await watcherResp.value.json()
          setWatcherData(data)
          watcherError = !!data.error
        } else {
          setWatcherData(null)
          watcherError = true
        }
        if (sysResp.status === 'fulfilled' && sysResp.value.ok) {
          const sysData = await sysResp.value.json()
          setSystemInfo(sysData)
          // Only show full error if both watcher AND system-info failed
          const hasSysInfo = sysData && (sysData.firmware || sysData.network || sysData.hostname)
          setError(watcherError && !hasSysInfo)
        } else {
          setError(watcherError)
        }
        setSecondsAgo(0)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) {
          setLoading(false)
          setCountdown(REFRESH_INTERVAL)
        }
      }
    }
    void doFetch()
    return () => { cancelled = true }
  }, [refreshTrigger])

  // Auto-refresh countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setRefreshTrigger((n) => n + 1)
          return REFRESH_INTERVAL
        }
        return prev - 1
      })
      setSecondsAgo((prev) => (prev !== null ? prev + 1 : null))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const system = watcherData?.system ?? null
  const services = watcherData?.services ?? []

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6 px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label={t('common.back')}>
            <CaretLeft size={20} />
          </Button>
          <h2 className="text-xl font-bold text-foreground">{t('machineStatus.title')}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {t('machineStatus.autoRefresh')} {countdown}s
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshTrigger((n) => n + 1)}
            disabled={loading}
            aria-label={loading ? t('machineStatus.refreshing') : t('machineStatus.retry')}
          >
            <ArrowClockwise size={16} className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>

      {/* Last updated */}
      {secondsAgo != null && (
        <p className="text-xs text-muted-foreground text-right -mt-4">
          {t('machineStatus.lastUpdated')}: {secondsAgo < 5 ? t('machineStatus.justNow') : t('machineStatus.secondsAgo', { count: secondsAgo })}
        </p>
      )}

      {/* Error state */}
      {error && !loading && (
        <Card className="p-6 flex flex-col items-center gap-4 text-center border-destructive/30">
          <WifiSlash size={48} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('machineStatus.unavailable')}</p>
          <Button variant="outline" size="sm" onClick={() => setRefreshTrigger((n) => n + 1)}>
            <ArrowClockwise size={16} className="mr-2" />
            {t('machineStatus.retry')}
          </Button>
        </Card>
      )}

      {/* Service Health Grid */}
      {services.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <HardDrives size={16} />
            {t('machineStatus.serviceHealth')}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {services.map((svc) => (
              <ServiceCard key={svc.name} name={svc.name} status={svc.status} uptime={svc.uptime} />
            ))}
          </div>
        </section>
      ) : !error && !loading && (
        <Card className="p-4 text-center text-sm text-muted-foreground">
          <p>{t('machineStatus.watcherUnavailable')}</p>
        </Card>
      )}

      {/* System Metrics Panel */}
      {system && (
        <section>
          <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <Memory size={16} />
            {t('machineStatus.systemMetrics')}
          </h3>
          <Card className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {system.disk_total != null && system.disk_total > 0 && (
                <StatusGauge
                  value={system.disk_used ?? 0}
                  max={system.disk_total}
                  label={t('machineStatus.diskUsage')}
                  unit="GB"
                />
              )}
              {system.memory_total != null && system.memory_total > 0 && (
                <StatusGauge
                  value={system.memory_used ?? 0}
                  max={system.memory_total}
                  label={t('machineStatus.memoryUsage')}
                  unit="MB"
                />
              )}
              {system.uptime != null && (
                <div className="flex flex-col items-center gap-1 rounded-lg bg-muted/50 p-4">
                  <Clock size={24} className="text-blue-500" />
                  <span className="text-2xl font-bold text-foreground">
                    {formatMachineUptime(system.uptime)}
                  </span>
                  <span className="text-xs text-muted-foreground">{t('machineStatus.uptime')}</span>
                </div>
              )}
            </div>

            {/* CPU Temperature (if available) */}
            {system.cpu_temperature != null && (
              <div className="mt-4 flex justify-center">
                <div className="flex flex-col items-center gap-1 rounded-lg bg-muted/50 p-4">
                  <Thermometer size={24} className={tempColor(system.cpu_temperature)} />
                  <span className={`text-2xl font-bold ${tempColor(system.cpu_temperature)}`}>
                    {Math.round(system.cpu_temperature)}°C
                  </span>
                  <span className="text-xs text-muted-foreground">{t('machineStatus.cpuTemperature')}</span>
                </div>
              </div>
            )}
          </Card>
        </section>
      )}

      {/* Network info from system-info */}
      {systemInfo && (systemInfo.firmware || systemInfo.network || systemInfo.hostname) && (
        <section>
          <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            {t('machineStatus.networkStatus')}
          </h3>
          <Card className="p-4 space-y-2 text-sm">
            {systemInfo.hostname && typeof systemInfo.hostname === 'object' && (
              <InfoRow label={t('machineStatus.hostname')} value={String((systemInfo.hostname as Record<string, unknown>).hostname ?? '—')} />
            )}
            {systemInfo.firmware && typeof systemInfo.firmware === 'object' && (
              <InfoRow label={t('machineStatus.firmware')} value={String((systemInfo.firmware as Record<string, unknown>).version ?? '—')} />
            )}
            {systemInfo.network && typeof systemInfo.network === 'object' && (
              <InfoRow label={t('machineStatus.wifi')} value={String((systemInfo.network as Record<string, unknown>).ssid ?? '—')} />
            )}
          </Card>
        </section>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span className="font-medium text-foreground">{label}</span>
      <span className="truncate ml-4">{value}</span>
    </div>
  )
}
