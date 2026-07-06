import { buildShotFacts } from './shotFacts'

interface CachedProfile {
  id?: string
  name?: string
  change_id?: string
  author?: string
  temperature?: number
  final_weight?: number
  variables?: Array<Record<string, unknown>>
  stages?: Array<Record<string, unknown>>
  display?: { image?: string; description?: string; shortDescription?: string; accentColor?: string }
  [key: string]: unknown
}

export type HistStage = { name: string; type: string; key?: string; dynamics?: any; dynamics_points?: any; dynamics_over?: any; exit_triggers?: any[]; limits?: any[] }
export type HistVar = { key: string; name: string; type: string; value: number; adjustable?: boolean }
export type HistEntry = {
  id: string; time: number; name: string; file?: string;
  profile?: { name?: string; final_weight?: number; temperature?: number; stages?: HistStage[]; variables?: HistVar[] };
  data?: { shot?: { pressure?: number; flow?: number; weight?: number; gravimetric_flow?: number }; time?: number; profile_time?: number; status?: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeNumber(value: unknown, fallback = 0): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

function resolveProfileValue(value: unknown, variables: Array<Record<string, unknown>>): number {
  if (typeof value === 'string' && value.startsWith('$')) {
    const key = value.slice(1)
    const variable = variables.find((item) => item.key === key || item.name === key)
    return safeNumber(variable?.value)
  }
  return safeNumber(value)
}

function meanDynamicsTarget(
  stageType: string,
  points: unknown,
  variables: Array<Record<string, unknown>>,
): number | null {
  if (stageType !== 'pressure' && stageType !== 'flow') return null
  if (!Array.isArray(points)) return null
  const values: number[] = []
  for (const point of points) {
    if (!Array.isArray(point) || point.length === 0) continue
    const raw = point.length > 1 ? point[1] : point[0]
    let resolved: unknown = raw
    if (typeof raw === 'string' && raw.startsWith('$')) {
      const key = raw.slice(1)
      const variable = variables.find((item) => item.key === key || item.name === key)
      resolved = variable?.value
    }
    const num = typeof resolved === 'number' ? resolved : Number(resolved)
    if (Number.isFinite(num)) values.push(num)
  }
  if (values.length === 0) return null
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
}

function maxDynamicsTarget(
  stageType: string,
  points: unknown,
  variables: Array<Record<string, unknown>>,
): number | null {
  if (stageType !== 'pressure' && stageType !== 'flow') return null
  if (!Array.isArray(points)) return null
  const values: number[] = []
  for (const point of points) {
    if (!Array.isArray(point) || point.length === 0) continue
    const raw = point.length > 1 ? point[1] : point[0]
    let resolved: unknown = raw
    if (typeof raw === 'string' && raw.startsWith('$')) {
      const key = raw.slice(1)
      const variable = variables.find((item) => item.key === key || item.name === key)
      resolved = variable?.value
    }
    const num = typeof resolved === 'number' ? resolved : Number(resolved)
    if (Number.isFinite(num)) values.push(num)
  }
  if (values.length === 0) return null
  return Math.round(Math.max(...values) * 100) / 100
}

function buildTimeBasedCurvePoints(
  points: unknown[],
  variables: Array<Record<string, unknown>>,
  stageName: string,
  key: string,
  stageStart: number,
  stageEnd: number,
): Array<Record<string, unknown>> {
  const stageDuration = stageEnd - stageStart
  const result: Array<Record<string, unknown>> = []
  let prevT: number | null = null
  let prevV: number | null = null
  let lastT: number | null = null
  let lastV: number | null = null

  for (const point of points) {
    if (!Array.isArray(point)) continue
    const dpT = safeNumber(point[0])
    const dpV = resolveProfileValue(point[1] ?? point[0], variables)

    if (dpT > stageDuration) {
      let boundaryV = dpV
      if (prevT !== null && prevV !== null && dpT > prevT) {
        const frac = (stageDuration - prevT) / (dpT - prevT)
        boundaryV = prevV + (dpV - prevV) * frac
      }
      result.push({
        time: Number(stageEnd.toFixed(2)),
        stage_name: stageName,
        [key]: Math.round(boundaryV * 10) / 10,
      })
      return result
    }

    result.push({
      time: Number((stageStart + dpT).toFixed(2)),
      stage_name: stageName,
      [key]: Math.round(dpV * 10) / 10,
    })
    prevT = dpT
    prevV = dpV
    lastT = dpT
    lastV = dpV
  }

  if (lastT !== null && lastV !== null && lastT < stageDuration - 1e-6) {
    result.push({
      time: Number(stageEnd.toFixed(2)),
      stage_name: stageName,
      [key]: Math.round(lastV * 10) / 10,
    })
  }

  return result
}

function generateShotAlignedTargetCurves(
  profile: CachedProfile,
  shotStages: Map<string, { startTime: number; endTime: number }>,
  shotDataEntries?: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const stages = profile.stages ?? []
  const variables = profile.variables ?? []
  const curves: Array<Record<string, unknown>> = []

  const stageWeightToTime = new Map<string, Array<[number, number]>>()
  if (shotDataEntries) {
    for (const entry of shotDataEntries) {
      const status = String((entry as Record<string, unknown>).status ?? '').trim().toLowerCase()
      if (!status || status === 'retracting') continue
      const timeSec = safeNumber((entry as Record<string, unknown>).time) / 1000
      const shot = (entry as Record<string, Record<string, unknown>>).shot ?? {}
      const weight = safeNumber(shot.weight)
      if (!stageWeightToTime.has(status)) stageWeightToTime.set(status, [])
      stageWeightToTime.get(status)!.push([weight, timeSec])
    }
  }

  for (const stage of stages) {
    const stageName = typeof stage.name === 'string' ? stage.name : ''
    const stageType = typeof stage.type === 'string' ? stage.type : 'flow'
    const dynamics = isRecord(stage.dynamics) ? stage.dynamics : {}
    const points = Array.isArray(stage.dynamics_points)
      ? stage.dynamics_points
      : Array.isArray(dynamics.points)
        ? dynamics.points
        : []
    if (points.length === 0) continue

    let timing: { startTime: number; endTime: number } | undefined
    const stageKey = (typeof stage.key === 'string' ? stage.key : '').toLowerCase().trim()
    const stageNameLower = stageName.toLowerCase().trim()
    for (const [shotStageName, t] of shotStages) {
      const normalised = shotStageName.toLowerCase().trim()
      if (normalised === stageNameLower || normalised === stageKey) { timing = t; break }
    }
    if (!timing) continue
    const stageStart = timing.startTime
    const stageDuration = timing.endTime - timing.startTime
    if (stageDuration <= 0) continue

    const key = stageType === 'pressure' ? 'target_pressure'
      : stageType === 'power' ? 'target_power'
        : 'target_flow'

    const dynamicsOver = typeof stage.dynamics_over === 'string'
      ? stage.dynamics_over
      : typeof dynamics.over === 'string' ? dynamics.over : 'time'

    if (dynamicsOver === 'weight' && stageWeightToTime.has(stageNameLower)) {
      const wtPairs = stageWeightToTime.get(stageNameLower)!
      for (const point of points) {
        if (!Array.isArray(point)) continue
        const targetWeight = safeNumber(point[0])
        const value = resolveProfileValue(point[1] ?? point[0], variables)
        let interpTime = stageStart
        for (let i = 0; i < wtPairs.length - 1; i++) {
          const [w0, t0] = wtPairs[i]
          const [w1, t1] = wtPairs[i + 1]
          if (w0 <= targetWeight && targetWeight <= w1 && w1 > w0) {
            interpTime = t0 + (targetWeight - w0) / (w1 - w0) * (t1 - t0)
            break
          }
        }
        curves.push({
          time: Number(interpTime.toFixed(2)),
          stage_name: stageName,
          [key]: Math.round(value * 10) / 10,
        })
      }
    } else {
      if (points.length === 1 && Array.isArray(points[0])) {
        const value = resolveProfileValue(points[0][1] ?? points[0][0], variables)
        curves.push(
          { time: Number(stageStart.toFixed(2)), stage_name: stageName, [key]: Math.round(value * 10) / 10 },
          { time: Number(timing.endTime.toFixed(2)), stage_name: stageName, [key]: Math.round(value * 10) / 10 },
        )
      } else {
        curves.push(
          ...buildTimeBasedCurvePoints(points, variables, stageName, key, stageStart, timing.endTime),
        )
      }
    }
  }
  return curves.sort((a, b) => safeNumber(a.time) - safeNumber(b.time))
}

export function computeRichLocalAnalysis(entry: HistEntry, profileName: string): any {
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

  const vars = entry.profile?.variables ?? []
  const unitMap: Record<string, string> = { time: 's', weight: 'g', pressure: 'bar', flow: 'ml/s' }
  const compMap: Record<string, string> = { '>=': '≥', '<=': '≤', '>': '>', '<': '<', '==': '=' }

  const stageDynamicsPoints = (stage: HistStage): any[] => {
    if (Array.isArray(stage.dynamics_points)) return stage.dynamics_points
    if (Array.isArray(stage.dynamics?.points)) return stage.dynamics.points
    return []
  }
  const stageDynamicsOver = (stage: HistStage): string => {
    if (typeof stage.dynamics_over === 'string') return stage.dynamics_over
    if (typeof stage.dynamics?.over === 'string') return stage.dynamics.over
    return 'time'
  }

  const fmtDynamics = (stage: HistStage): string => {
    const dp = stageDynamicsPoints(stage)
    if (!dp.length) return `${stage.type} stage`
    const unit = stage.type === 'pressure' ? 'bar' : 'ml/s'
    if (dp.length === 1) {
      const v = _resolveVar(dp[0][1] ?? dp[0][0], vars)
      return `Constant ${stage.type} at ${v} ${unit}`
    }
    if (dp.length === 2) {
      const sy = _resolveVar(dp[0][1], vars), ey = _resolveVar(dp[1][1], vars), ex = _sf(dp[1][0])
      const ou = stageDynamicsOver(stage) === 'time' ? 's' : 'g'
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

  const profileStages = entry.profile?.stages ?? []
  const stageAnalyses: any[] = []
  const unreachedStages: string[] = []
  let preinfusionTime = 0
  const preinfusionStages: string[] = []

  for (const ps of profileStages) {
    const stageName = (ps.name ?? '').trim()
    const stageType = ps.type ?? 'unknown'
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
      profile_target_value: meanDynamicsTarget(
        stageType,
        stageDynamicsPoints(ps),
        vars as Array<Record<string, unknown>>,
      ),
      profile_max_target: maxDynamicsTarget(
        stageType,
        stageDynamicsPoints(ps),
        vars as Array<Record<string, unknown>>,
      ),
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
    profile_target_curves: (() => {
      if (!entry.profile) return []
      const stageTimings = new Map<string, { startTime: number; endTime: number }>()
      for (const [name, stats] of shotStages) {
        stageTimings.set(name, { startTime: stats.startTime, endTime: stats.endTime })
      }
      return generateShotAlignedTargetCurves(
        entry.profile as unknown as CachedProfile,
        stageTimings,
        pts as unknown as Array<Record<string, unknown>>,
      )
    })(),
  }
  ;(analysis as Record<string, unknown>).shot_facts = buildShotFacts(analysis as Parameters<typeof buildShotFacts>[0])

  return analysis
}
