// apps/web/e2e/analysis-fixtures.ts
import type { Page } from '@playwright/test'

export const VALID_ANALYSIS = `## 1. Shot Performance
**What Happened:**
- Extraction reached target weight in 28s with steady pressure.
- Flow tapered smoothly toward the end of the shot.
**Assessment:** [Good]

## 2. Root Cause
**Why:**
- Grind and dose were well matched to the profile's pressure target.

## 3. Setup Recommendations
**Adjustments:**
- Nudge the grind one step finer to extend contact time slightly.

RECOMMENDATIONS_JSON:
[{"variable":"pressure_Max Pressure","current_value":6,"recommended_value":6.5,"stage":"Extraction","confidence":"high","reason":"Slightly higher pressure improves body.","is_patchable":true}]
END_RECOMMENDATIONS_JSON
`

export const MALFORMED_ANALYSIS = `## 1. Shot Performance
**What Happened:**
- The puck channeled badly and pressure never built.
- The puck channeled badly and pressure never built.
- The puck channeled badly and pressure never built.
- The puck channeled badly and pressure never built.

RECOMMENDATIONS_JSON:
[{"variable":"","current_value":null,"recommended_value":null,"stage":"","confidence":"low","reason":"","is_patchable":true}]
END_RECOMMENDATIONS_JSON
`

// Full LocalAnalysisResult produced by:
//   cd apps/server && python3 -m tools.analyze_shot tools/samples/slayer_at_home.shot.json --json
// ShotDetail accesses analysisResult.shot_summary, .weight_analysis, .stage_analyses, and
// .shot_facts — ALL fields must be present (several are accessed without null guards).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const STATIC_FACTS: Record<string, any> = {
  shot_summary: {
    final_weight: 41.9,
    target_weight: 42,
    total_time: 63.9,
    max_pressure: 7.2,
    max_flow: 4.2,
  },
  weight_analysis: {
    status: 'on_target',
    target: 42,
    actual: 41.9,
    deviation_percent: -0.2,
  },
  stage_analyses: [
    {
      stage_name: 'PreBrew',
      stage_key: 'flow_1',
      stage_type: 'flow',
      profile_target: 'Constant flow at 1.2 ml/s for 0.0s',
      profile_target_value: 1.2,
      profile_max_target: 1.2,
      exit_triggers: [
        { type: 'time', value: 30.0, comparison: '>=', description: 'time \u2265 30.0s' },
        { type: 'weight', value: 5.0, comparison: '>=', description: 'weight \u2265 5.0g' },
      ],
      limits: [{ type: 'pressure', value: 1.8, description: 'Limit pressure to 1.8bar' }],
      executed: true,
      execution_data: {
        duration: 29.9, weight_gain: 0.0, start_weight: 0.0, end_weight: 0.0,
        start_pressure: 0.0, end_pressure: 1.8, avg_pressure: 1.0, max_pressure: 2.1,
        min_pressure: 0.0, start_flow: 2.5, end_flow: 0.2, avg_flow: 0.9, max_flow: 1.3,
        description: 'Pressure rose from 0.0 to 1.8 bar, Flow decreased from 2.5 to 0.2 ml/s, over 29.9s',
      },
      exit_trigger_result: {
        triggered: { type: 'time', target: 30.0, actual: 29.9, description: 'time >= 30.0s' },
        not_triggered: [{ type: 'weight', target: 5.0, actual: 0.0, description: 'weight >= 5.0g' }],
      },
      limit_hit: { type: 'pressure', limit_value: 1.8, actual_value: 2.1, description: 'Hit pressure limit of 1.8bar' },
      assessment: { status: 'hit_limit', message: 'Stage exited but hit a limit (Hit pressure limit of 1.8bar)' },
    },
    {
      stage_name: 'Extraction',
      stage_key: 'flow_2',
      stage_type: 'flow',
      profile_target: 'Constant flow at 10.8 ml/s for 30.0s',
      profile_target_value: 10.8,
      profile_max_target: 10.8,
      exit_triggers: [],
      limits: [{ type: 'pressure', value: 6.0, description: 'Limit pressure to 6.0bar' }],
      executed: true,
      execution_data: {
        duration: 28.9, weight_gain: 39.2, start_weight: 0.0, end_weight: 39.2,
        start_pressure: 1.8, end_pressure: 6.0, avg_pressure: 5.9, max_pressure: 7.2,
        min_pressure: 1.8, start_flow: 0.2, end_flow: 2.1, avg_flow: 1.5, max_flow: 4.2,
        description: 'Pressure rose from 1.8 to 6.0 bar, Flow increased from 0.2 to 2.1 ml/s, extracted 39.2g, over 28.9s',
      },
      exit_trigger_result: null,
      limit_hit: { type: 'pressure', limit_value: 6.0, actual_value: 7.2, description: 'Hit pressure limit of 6.0bar' },
      assessment: { status: 'executed', message: 'Stage executed (no exit triggers defined)' },
    },
  ],
  unreached_stages: [],
  preinfusion_summary: {
    stages: [],
    total_time: 0,
    proportion_of_shot: 0.0,
    weight_accumulated: 0,
    weight_percent_of_total: 0.0,
    issues: [],
    recommendations: [],
  },
  profile_info: { name: 'Slayer at Home', temperature: 92, stage_count: 2 },
  profile_target_curves: [
    { time: 0.05, stage_name: 'PreBrew', target_flow: 1.2 },
    { time: 29.97, stage_name: 'PreBrew', target_flow: 1.2 },
    { time: 30.1, stage_name: 'Extraction', target_flow: 10.8 },
    { time: 59.04, stage_name: 'Extraction', target_flow: 10.8 },
  ],
  shot_facts: {
    stages: [
      {
        stage_name: 'PreBrew',
        reached: true,
        control_mode: 'flow',
        declared_mode: 'flow',
        mode_overridden: false,
        trigger_type: 'time',
        trigger_class: {
          kind: 'targeted',
          label: 'Targeted (timed transition)',
          reason:
            'The stage transitioned when its planned time elapsed; the other exit conditions simply did not fire first. A time exit is a valid, intended transition \u2014 a genuine timeout with no extraction is surfaced separately as a stall.',
        },
        stall: { stalled: true, weight_gain: 0.0 },
        channeling: { channeling: false, pressure_drop: -1.8, flow_rise: -2.3 },
        curve_adherence: { target: 1.2, measured: 0.9, delta: -0.3 },
      },
      {
        stage_name: 'Extraction',
        reached: true,
        control_mode: 'pressure',
        declared_mode: 'flow',
        mode_overridden: true,
        trigger_type: '',
        trigger_class: {
          kind: 'unknown',
          label: 'Unknown',
          reason: 'Trigger/control-mode combination is not classified.',
        },
        stall: { stalled: false, weight_gain: 39.2 },
        channeling: { channeling: false, pressure_drop: -4.2, flow_rise: 1.9 },
        curve_adherence: { target: 10.8, measured: 1.5, delta: -9.3 },
      },
    ],
    phases: [
      { stage_name: 'PreBrew', phase: 'pre-infusion', avg_pressure: 1.0, avg_flow: 0.9, weight_gain: 0.0 },
      { stage_name: 'Extraction', phase: 'ramp', avg_pressure: 5.9, avg_flow: 1.5, weight_gain: 39.2 },
    ],
    weight: { actual: 41.9, target: 42, deviation_pct: -0.2 },
    total_time_s: 63.9,
  },
}

// Real ShotData derived from apps/server/tools/samples/slayer_at_home.shot.json
// Sensor arrays trimmed to 30 points for test speed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SHOT_DATA: Record<string, any> = {
  profile: {
    name: 'Slayer at Home',
    author: 'IronLapin',
    temperature: 92,
    final_weight: 42,
    stages: [
      { name: 'PreBrew', type: 'flow', key: 'flow_1' },
      { name: 'Extraction', type: 'flow', key: 'flow_2' },
    ],
  },
  final_weight: 41.9,
  // Meticulous native array format — handled by shotDataTransforms.ts getChartData()
  data: [
    { shot: { pressure: 0.0, flow: 2.55, weight: 0.0, gravimetric_flow: 0.0 }, time: 47, profile_time: 47, status: 'PreBrew' },
    { shot: { pressure: 0.0, flow: 3.09, weight: 0.0, gravimetric_flow: 0.0 }, time: 2065, profile_time: 2065, status: 'PreBrew' },
    { shot: { pressure: 0.0, flow: 1.16, weight: 0.0, gravimetric_flow: 0.0 }, time: 4126, profile_time: 4126, status: 'PreBrew' },
    { shot: { pressure: 0.0, flow: 1.09, weight: 0.0, gravimetric_flow: 0.0 }, time: 6183, profile_time: 6183, status: 'PreBrew' },
    { shot: { pressure: 0.41, flow: 1.18, weight: 0.0, gravimetric_flow: 0.0 }, time: 8263, profile_time: 8263, status: 'PreBrew' },
    { shot: { pressure: 0.57, flow: 1.24, weight: 0.0, gravimetric_flow: 0.0 }, time: 10357, profile_time: 10357, status: 'PreBrew' },
    { shot: { pressure: 0.75, flow: 1.11, weight: 0.0, gravimetric_flow: 0.0 }, time: 12432, profile_time: 12432, status: 'PreBrew' },
    { shot: { pressure: 0.94, flow: 1.21, weight: 0.0, gravimetric_flow: 0.0 }, time: 14509, profile_time: 14509, status: 'PreBrew' },
    { shot: { pressure: 1.17, flow: 1.12, weight: 0.0, gravimetric_flow: 0.0 }, time: 16573, profile_time: 16573, status: 'PreBrew' },
    { shot: { pressure: 1.47, flow: 1.26, weight: 0.0, gravimetric_flow: 0.0 }, time: 18654, profile_time: 18654, status: 'PreBrew' },
    { shot: { pressure: 1.89, flow: 1.14, weight: 0.0, gravimetric_flow: 0.0 }, time: 20724, profile_time: 20724, status: 'PreBrew' },
    { shot: { pressure: 1.88, flow: 0.59, weight: 0.0, gravimetric_flow: 0.0 }, time: 22803, profile_time: 22803, status: 'PreBrew' },
    { shot: { pressure: 1.83, flow: 0.24, weight: 0.0, gravimetric_flow: 0.0 }, time: 24886, profile_time: 24886, status: 'PreBrew' },
    { shot: { pressure: 1.8, flow: 0.19, weight: 0.0, gravimetric_flow: 0.0 }, time: 26974, profile_time: 26974, status: 'PreBrew' },
    { shot: { pressure: 1.8, flow: 0.16, weight: 0.0, gravimetric_flow: 0.0 }, time: 29070, profile_time: 29070, status: 'PreBrew' },
    { shot: { pressure: 4.64, flow: 1.61, weight: 0.2, gravimetric_flow: 0.12 }, time: 31148, profile_time: 31148, status: 'Extraction' },
    { shot: { pressure: 6.63, flow: 2.01, weight: 1.18, gravimetric_flow: 0.6 }, time: 33253, profile_time: 33253, status: 'Extraction' },
    { shot: { pressure: 6.26, flow: 0.52, weight: 2.84, gravimetric_flow: 0.76 }, time: 35365, profile_time: 35365, status: 'Extraction' },
    { shot: { pressure: 6.08, flow: 0.63, weight: 4.23, gravimetric_flow: 0.75 }, time: 37472, profile_time: 37472, status: 'Extraction' },
    { shot: { pressure: 6.03, flow: 0.82, weight: 6.21, gravimetric_flow: 0.84 }, time: 39543, profile_time: 39543, status: 'Extraction' },
    { shot: { pressure: 5.95, flow: 0.95, weight: 8.28, gravimetric_flow: 0.97 }, time: 41633, profile_time: 41633, status: 'Extraction' },
    { shot: { pressure: 5.96, flow: 1.16, weight: 10.7, gravimetric_flow: 1.2 }, time: 43721, profile_time: 43721, status: 'Extraction' },
    { shot: { pressure: 5.95, flow: 1.36, weight: 13.61, gravimetric_flow: 1.37 }, time: 45808, profile_time: 45808, status: 'Extraction' },
    { shot: { pressure: 5.97, flow: 1.55, weight: 16.95, gravimetric_flow: 1.66 }, time: 47899, profile_time: 47899, status: 'Extraction' },
    { shot: { pressure: 5.97, flow: 1.69, weight: 20.4, gravimetric_flow: 1.7 }, time: 49980, profile_time: 49980, status: 'Extraction' },
    { shot: { pressure: 5.98, flow: 1.9, weight: 24.32, gravimetric_flow: 1.87 }, time: 52065, profile_time: 52065, status: 'Extraction' },
    { shot: { pressure: 5.99, flow: 2.0, weight: 28.62, gravimetric_flow: 1.99 }, time: 54159, profile_time: 54159, status: 'Extraction' },
    { shot: { pressure: 5.98, flow: 2.06, weight: 33.04, gravimetric_flow: 2.04 }, time: 56265, profile_time: 56265, status: 'Extraction' },
    { shot: { pressure: 5.97, flow: 2.14, weight: 37.68, gravimetric_flow: 2.24 }, time: 58387, profile_time: 58387, status: 'Extraction' },
    { shot: { pressure: 0.35, flow: 0, weight: 41.53, gravimetric_flow: 2.03 }, time: 60460, profile_time: 59185, status: 'retracting' },
  ],
}

const SHOT_SUMMARY = {
  profile_name: 'Slayer at Home',
  profile_id: 'e2e-profile-001',
  // 1_735_689_600 = 2025-01-01T00:00:00Z — date string must match the Unix epoch year
  date: '2025-01-01',
  filename: 'e2e-shot-001.shot.json',
  timestamp: 1_735_689_600,
  // Align with SHOT_DATA.final_weight and STATIC_FACTS.shot_summary values
  total_time: 63.9,
  final_weight: 41.9,
  has_annotation: false,
}

export interface MockAnalysisOptions {
  llmContent?: string
  llmStatus?: number
  llmErrorMessage?: string
}

export async function mockAnalysisApi(page: Page, opts: MockAnalysisOptions = {}) {
  const state = { llmCalls: 0, staticCalls: 0 }
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })

  // Make AI available — App.tsx reads this on mount and when leaving settings
  await page.route('**/api/settings**', (r) =>
    r.fulfill(json({
      geminiApiKeyConfigured: true,
      geminiApiKey: 'mock-key',
      mqttEnabled: false,
    }))
  )

  // Shot list endpoints — Playwright resolves last-registered route first, so the
  // GENERAL pattern must be registered first and the SPECIFIC pattern last so the
  // specific one wins when both would match.
  await page.route('**/api/shots/recent**', (r) => r.fulfill(json({ shots: [SHOT_SUMMARY] })))
  await page.route('**/api/shots/recent/by-profile**', (r) => r.fulfill(json({ profiles: [] })))
  await page.route('**/api/shots/by-profile/**', (r) =>
    r.fulfill(json({
      profile_name: SHOT_SUMMARY.profile_name,
      shots: [SHOT_SUMMARY],
      count: 1,
      limit: 20,
      is_stale: false,
    }))
  )

  // Shot data + annotations
  await page.route('**/api/shots/data/**', (r) => r.fulfill(json({ data: SHOT_DATA })))
  await page.route('**/api/shots/annotations**', (r) => r.fulfill(json({})))
  await page.route('**/api/shots/dates**', (r) => r.fulfill(json([])))

  // LLM cache — always miss so the taste gate always shows
  await page.route('**/api/shots/llm-analysis-cache**', (r) => r.fulfill(json({ cached: false })))

  // Static analysis (auto-triggered on shot load)
  await page.route('**/api/shots/analyze', (r) => {
    state.staticCalls++
    r.fulfill(json({ status: 'success', analysis: STATIC_FACTS }))
  })

  // LLM analysis (triggered after taste gate)
  await page.route('**/api/shots/analyze-llm', (r) => {
    state.llmCalls++
    if (opts.llmStatus && opts.llmStatus >= 400) {
      r.fulfill(json({ detail: { message: opts.llmErrorMessage ?? 'mock error' } }, opts.llmStatus))
      return
    }
    r.fulfill(json({ status: 'success', llm_analysis: opts.llmContent ?? VALID_ANALYSIS, cached: false }))
  })
  // ExpertAnalysisView POSTs here to enrich recs with backend is_patchable flags.
  // We return a body WITHOUT a `recommendations` array on purpose: the component
  // only adopts the backend list when `Array.isArray(data.recommendations)` is
  // true (ExpertAnalysisView.tsx:81), otherwise `classifiedRecs` stays null and
  // `recommendations = classifiedRecs ?? localRecommendations` uses the real
  // locally-parsed recs. This lets the tests observe genuine parser output
  // (valid rec surfaces, garbage filtered to []) in the selection dialog instead
  // of an empty list the mock would otherwise force.
  await page.route('**/api/shots/analyze-recommendations**', (r) =>
    r.fulfill(json({}))
  )

  return state
}

/**
 * Navigate from start → Shot Analysis view → click the e2e shot card → switch
 * to the Analyze tab → wait for auto-static-analysis → click "Get AI Analysis"
 * → wait for the AnalysisTasteGate to become visible.
 *
 * Callers can then assert on `taste-gate-analyze` / `taste-gate-skip` or
 * proceed to interact with the gate.
 */
export async function openAnalysis(page: Page): Promise<void> {
  await page.goto('/')

  // Wait for the app to fully initialize (Shot Analysis button visible)
  await page.getByRole('button', { name: /Shot Analysis/i }).waitFor({ state: 'visible', timeout: 15_000 })

  // Navigate to Shot Analysis view
  await page.getByRole('button', { name: /Shot Analysis/i }).click()

  // Wait for the shot card to appear, then click it
  const shotCard = page.getByText(SHOT_SUMMARY.profile_name).first()
  await shotCard.waitFor({ state: 'visible', timeout: 15_000 })
  await shotCard.click()

  // Wait for ShotDetail to load shot data. The temperature stat only appears
  // once shotData.profile.temperature is set, confirming the shot data response
  // has been received and applied.
  await page.getByText(`${SHOT_DATA.profile.temperature}°C`).waitFor({ state: 'visible', timeout: 15_000 })

  // Switch to Analyze tab. force:true skips Playwright's element-stability check,
  // which can fail when React re-renders the tab list during auto-analysis setup.
  await page.getByRole('tab', { name: /Analyze/i }).click({ force: true })

  // Wait for the "Get AI Analysis" button to become visible
  // (auto-static-analysis completes first, then the button renders inside analysisResult block)
  const aiBtn = page.getByRole('button', { name: /Get AI Analysis/i })
  await aiBtn.waitFor({ state: 'visible', timeout: 15_000 })
  await aiBtn.click()

  // Taste gate must now be visible
  await page.getByTestId('taste-gate-analyze').waitFor({ state: 'visible' })
}
