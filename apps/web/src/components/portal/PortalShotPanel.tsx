/**
 * Shot detail → Belka Portal: the conductivity recording for one shot, read
 * from the shared core (`GET /api/portal/shots/{date}/{filename}`), which pairs
 * it with the machine's cup-weight curve and returns the analysis, the
 * calibration fit for this coffee and a flagged TDS/EY estimate.
 *
 * Everything the user can change here (coffee label, dose, refractometer
 * reading, which pool an estimate may borrow from) goes back through the same
 * route family, so server and native/direct mode behave identically.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Drop, Trash } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { getChartTheme } from '@/components/charts/chartConstants'
import { usePortalSettings } from '@/hooks/usePortal'
import { deletePortalShot, fetchPortalShot, patchPortalShot, type PortalShotResponse } from '@/services/portal/portalApi'
import type { PoolMode } from '@metic/core/logic/portalAnalysis'

interface PortalShotPanelProps {
  date: string
  filename: string
  isDark: boolean
  className?: string
}

const EC_COLOR = '#60a5fa' // blue — distinct from the pressure/flow/weight palette
const INTEGRAL_COLOR = '#a78bfa' // violet

function fmt(v: number | null | undefined, digits: number): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—'
}

export function PortalShotPanel({ date, filename, isDark, className = '' }: PortalShotPanelProps) {
  const { t } = useTranslation()
  const [settings, updateSettings] = usePortalSettings()
  const [data, setData] = useState<PortalShotResponse | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<PoolMode>('auto')
  const [coffee, setCoffee] = useState('')
  const [dose, setDose] = useState('')
  const [tds, setTds] = useState('')
  const [beverage, setBeverage] = useState('')
  // The form is (re)filled when a different shot is shown, not when only the pool mode changes.
  const formKeyRef = useRef<string | null>(null)

  const fillForm = useCallback((res: PortalShotResponse) => {
    const r = res.recording
    setCoffee(r?.coffee ?? '')
    setDose(r?.dose_g != null ? String(r.dose_g) : '')
    setTds(r?.reading ? String(r.reading.tds_pct) : '')
    setBeverage(r?.reading?.beverage_g != null ? String(r.reading.beverage_g) : '')
  }, [])

  useEffect(() => {
    let cancelled = false
    const key = `${date}/${filename}`
    fetchPortalShot(date, filename, mode)
      .then((res) => {
        if (cancelled) return
        setData(res)
        if (formKeyRef.current !== key) {
          formKeyRef.current = key
          fillForm(res)
        }
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error('Failed to load Portal recording:', err)
        setData(null)
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [date, filename, mode, fillForm])

  const chartData = useMemo(() => {
    const curve = data?.analysis?.curve ?? []
    return curve
      .filter((p) => p.ec !== null)
      .map((p) => ({ m: Number(p.m.toFixed(2)), ec: Number((p.ec as number).toFixed(4)), I: Number(p.I.toFixed(2)) }))
  }, [data])

  if (!loaded) return null
  if (!settings.enabled && !data?.recording) return null

  const recording = data?.recording ?? null
  if (!recording) {
    return (
      <div className={`rounded-lg border border-border bg-card p-4 ${className}`}>
        <div className="flex items-center gap-1.5">
          <Drop size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{t('portal.title')}</h3>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t('portal.shot.none')}</p>
      </div>
    )
  }

  const analysis = data?.analysis ?? null
  const estimate = data?.estimate ?? null
  const fit = data?.fit ?? null
  const theme = getChartTheme(isDark)
  const statusOk = analysis?.status === 'ok'

  const save = async (patch: Parameters<typeof patchPortalShot>[2]) => {
    setSaving(true)
    try {
      const res = await patchPortalShot(date, filename, patch, mode)
      setData(res)
      return res
    } catch (err) {
      toast.error(t('portal.toast.saveFailed', { message: err instanceof Error ? err.message : String(err) }))
      return null
    } finally {
      setSaving(false)
    }
  }

  const saveDetails = async () => {
    const doseG = dose.trim() ? Number(dose) : null
    const res = await save({ coffee: coffee.trim() || null, doseG: Number.isFinite(doseG as number) ? doseG : null })
    if (res) {
      updateSettings({ lastCoffee: coffee.trim(), lastDoseG: Number.isFinite(doseG as number) ? doseG : null })
      toast.success(t('portal.toast.detailsSaved'))
    }
  }

  const saveReading = async () => {
    const tdsPct = Number(tds)
    if (!(tdsPct > 0 && tdsPct < 30)) {
      toast.error(t('portal.shot.readingInvalid'))
      return
    }
    const bev = beverage.trim() ? Number(beverage) : null
    const res = await save({ reading: { tdsPct, beverageG: Number.isFinite(bev as number) ? bev : null } })
    if (res) toast.success(t('portal.toast.readingSaved'))
  }

  const clearReading = async () => {
    const res = await save({ reading: null })
    if (res) {
      setTds('')
      setBeverage('')
    }
  }

  const remove = async () => {
    try {
      await deletePortalShot(date, filename)
      setData((d) => (d ? { ...d, recording: null, analysis: null, estimate: null } : d))
      toast.success(t('portal.toast.deleted'))
    } catch (err) {
      toast.error(t('portal.toast.saveFailed', { message: err instanceof Error ? err.message : String(err) }))
    }
  }

  return (
    <div className={`rounded-lg border border-border bg-card p-4 space-y-4 ${className}`} data-testid="portal-shot-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Drop size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{t('portal.title')}</h3>
          <Badge variant="outline" className="text-[10px]">
            {t('portal.shot.samples', { count: recording.samples.length })}
          </Badge>
          {analysis && (
            <Badge variant={statusOk ? 'default' : 'secondary'} className="text-[10px]">
              {statusOk ? t('portal.shot.statusOk') : t(`portal.shot.status.${analysis.status}`, { defaultValue: analysis.status })}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => void remove()} aria-label={t('portal.actions.deleteRecording')} title={t('portal.actions.deleteRecording')}>
          <Trash size={14} />
        </Button>
      </div>

      {!analysis && <p className="text-xs text-muted-foreground">{t('portal.shot.noMachineData')}</p>}

      {analysis && analysis.curve.length > 1 && (
        <div className="h-48 w-full" data-testid="portal-ec-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
              <CartesianGrid stroke={theme.gridColor} strokeOpacity={theme.gridOpacity} strokeDasharray="3 3" />
              <XAxis
                dataKey="m"
                type="number"
                domain={[0, 'dataMax']}
                tick={{ fill: theme.tickFill, fontSize: 10 }}
                stroke={theme.axisStroke}
                label={{ value: t('portal.chart.cupMass'), position: 'insideBottomRight', offset: -2, fill: theme.tickFill, fontSize: 10 }}
              />
              <YAxis yAxisId="ec" tick={{ fill: theme.tickFill, fontSize: 10 }} stroke={EC_COLOR} width={44} />
              <YAxis yAxisId="I" orientation="right" tick={{ fill: theme.tickFill, fontSize: 10 }} stroke={INTEGRAL_COLOR} width={44} />
              <Tooltip
                contentStyle={{ background: isDark ? '#18181b' : '#fff', border: `1px solid ${theme.gridColor}`, fontSize: 11 }}
                formatter={(value, name) => [String(value ?? ''), String(name) === 'ec' ? t('portal.chart.ec') : t('portal.chart.integral')]}
                labelFormatter={(m) => `${String(m)} g`}
              />
              <Line yAxisId="ec" type="monotone" dataKey="ec" stroke={EC_COLOR} dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line yAxisId="I" type="monotone" dataKey="I" stroke={INTEGRAL_COLOR} dot={false} strokeWidth={1.5} strokeDasharray="4 3" isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {analysis && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric value={fmt(analysis.meanEcPerG, 3)} unit="mS/cm" label={t('portal.metrics.meanEcPerG')} />
          <Metric value={fmt(analysis.integralEcG, 1)} unit="mS·g/cm" label={t('portal.metrics.integral')} />
          <Metric value={fmt(analysis.mainPeakEc, 3)} unit="mS/cm" label={t('portal.metrics.peak', { mass: fmt(analysis.mainPeakMassG, 1) })} />
          <Metric value={fmt(analysis.coverageRatio * 100, 0)} unit="%" label={t('portal.metrics.coverage')} />
          <Metric value={fmt(analysis.firstDropTimeSec, 1)} unit="s" label={t('portal.metrics.firstDrop')} />
          <Metric value={fmt(analysis.meanTempC, 1)} unit="°C" label={t('portal.metrics.outletTemp')} />
          <Metric value={fmt(analysis.massAt90PctG, 1)} unit="g" label={t('portal.metrics.massAt90')} />
          <Metric value={fmt((analysis.tail.last5g?.share ?? 0) * 100, 0)} unit="%" label={t('portal.metrics.last5g')} />
        </div>
      )}
      {analysis && analysis.reasons.length > 0 && <p className="text-xs text-muted-foreground">{analysis.reasons.join(' ')}</p>}

      {/* Coffee + dose */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[160px] flex-1 space-y-1">
          <Label htmlFor="portal-coffee" className="text-xs">
            {t('portal.shot.coffee')}
          </Label>
          <Input id="portal-coffee" list="portal-coffee-list" value={coffee} onChange={(e) => setCoffee(e.target.value)} placeholder={t('portal.shot.coffeePlaceholder')} />
          <datalist id="portal-coffee-list">
            {(data?.coffees ?? []).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="w-24 space-y-1">
          <Label htmlFor="portal-dose" className="text-xs">
            {t('portal.shot.dose')}
          </Label>
          <Input id="portal-dose" type="number" step={0.1} min={0} value={dose} onChange={(e) => setDose(e.target.value)} placeholder="18.0" />
        </div>
        <Button size="sm" variant="outline" onClick={() => void saveDetails()} disabled={saving}>
          {t('common.save')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('portal.shot.coffeeHint')}</p>

      {/* Estimate */}
      <div className="rounded-md bg-muted/40 p-3 space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-end gap-5">
            <div>
              <div className="text-2xl font-bold tabular-nums text-foreground" data-testid="portal-est-tds">
                {recording.reading ? fmt(recording.reading.tds_pct, 2) : fmt(estimate?.tdsPct, 2)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">% TDS</span>
              </div>
              <div className="text-[10px] text-muted-foreground">{recording.reading ? t('portal.shot.measured') : t('portal.shot.estimated')}</div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums text-foreground">
                {recording.reading ? fmt(recording.reading.ey_pct, 1) : fmt(estimate?.eyPct, 1)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">% EY</span>
              </div>
              <div className="text-[10px] text-muted-foreground">{t('portal.shot.extractionYield')}</div>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {t('portal.shot.estimateFrom')}
            <select
              className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
              value={mode}
              onChange={(e) => setMode(e.target.value as PoolMode)}
              aria-label={t('portal.shot.estimateFrom')}
            >
              <option value="auto">{t('portal.pools.auto')}</option>
              <option value="coffee">{t('portal.pools.coffee')}</option>
              <option value="all">{t('portal.pools.all')}</option>
            </select>
          </label>
        </div>
        {fit?.calibrated && (
          <p className="text-xs text-muted-foreground">
            {t('portal.shot.calibrationSummary', {
              pool: t(`portal.pools.${fit.pool ?? 'coffee'}`),
              count: fit.shotCount,
              k: fit.proportional ? fit.proportional.k.toFixed(3) : '—',
              err: fit.proportional && Number.isFinite(fit.proportional.loocvRmse) ? fit.proportional.loocvRmse.toFixed(2) : '—',
              model: fit.activeModel,
            })}
          </p>
        )}
        {estimate && estimate.flags.length > 0 && !recording.reading && (
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-700 dark:text-amber-300">
            {estimate.flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Refractometer reading */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-28 space-y-1">
          <Label htmlFor="portal-tds" className="text-xs">
            {t('portal.shot.readingTds')}
          </Label>
          <Input id="portal-tds" type="number" step={0.01} min={0} max={30} value={tds} onChange={(e) => setTds(e.target.value)} placeholder="9.20" />
        </div>
        <div className="w-32 space-y-1">
          <Label htmlFor="portal-bev" className="text-xs">
            {t('portal.shot.readingBeverage')}
          </Label>
          <Input id="portal-bev" type="number" step={0.1} min={0} value={beverage} onChange={(e) => setBeverage(e.target.value)} placeholder={fmt(analysis?.totalMassG, 1)} />
        </div>
        <Button size="sm" onClick={() => void saveReading()} disabled={saving}>
          {t('portal.actions.saveReading')}
        </Button>
        {recording.reading && (
          <Button size="sm" variant="ghost" onClick={() => void clearReading()} disabled={saving}>
            {t('portal.actions.removeReading')}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('portal.shot.readingHint')}</p>
    </div>
  )
}

function Metric({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <div className="text-base font-semibold tabular-nums text-foreground">
        {value}
        <span className="ml-1 text-[10px] font-normal text-muted-foreground">{unit}</span>
      </div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}
