interface ServiceCardProps {
  name: string
  status: 'running' | 'degraded' | 'stopped' | string
  uptime?: string | number | null
}

const STATUS_STYLES: Record<string, { dot: string; bg: string; label: string }> = {
  running: { dot: 'bg-green-500', bg: 'border-green-500/30', label: 'Running' },
  degraded: { dot: 'bg-yellow-500', bg: 'border-yellow-500/30', label: 'Degraded' },
  stopped: { dot: 'bg-red-500', bg: 'border-red-500/30', label: 'Stopped' },
}

function formatUptime(raw: string | number | null | undefined): string {
  if (raw == null) return ''
  const seconds = typeof raw === 'string' ? parseInt(raw, 10) : raw
  if (isNaN(seconds) || seconds < 0) return ''
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  parts.push(`${m}m`)
  return parts.join(' ')
}

export function ServiceCard({ name, status, uptime }: ServiceCardProps) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.stopped
  const uptimeStr = formatUptime(uptime)

  return (
    <div
      className={`rounded-lg border ${style.bg} bg-card p-4 flex flex-col gap-2 min-w-0`}
      data-testid={`service-card-${name}`}
    >
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${style.dot} shrink-0`} aria-hidden="true" />
        <span className="text-sm font-medium text-foreground truncate">{name}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{style.label}</span>
        {uptimeStr && <span>{uptimeStr}</span>}
      </div>
    </div>
  )
}
