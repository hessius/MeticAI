// apps/web/e2e/ai-analysis.spec.ts
// Proxy-mode e2e: mocks /api/shots/* directly (see analysis-fixtures.ts).
import { test, expect } from '@playwright/test'
import { mockAnalysisApi, openAnalysis, VALID_ANALYSIS, MALFORMED_ANALYSIS } from './analysis-fixtures'

// ---------------------------------------------------------------------------
// A2 — shot facts
// ShotFactsPanel is visible on the Analyze tab at the taste-gate stage.
// ---------------------------------------------------------------------------
test.describe('AI shot analysis — shot facts', () => {
  test('renders derived static facts for the opened shot', async ({ page }) => {
    const state = await mockAnalysisApi(page, { llmContent: VALID_ANALYSIS })
    await openAnalysis(page)
    expect(state.staticCalls).toBeGreaterThanOrEqual(1)
    // "Stage signals" is the ShotFactsPanel heading (t('analysis.facts.title'))
    await expect(page.getByText('Stage signals')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// A3 — taste gate interactions
// ---------------------------------------------------------------------------
test.describe('AI shot analysis — taste gate', () => {
  test('analyze produces recommendations from valid analysis text', async ({ page }) => {
    const state = await mockAnalysisApi(page, { llmContent: VALID_ANALYSIS })
    await openAnalysis(page)
    await page.getByTestId('taste-gate-analyze').click()
    // ExpertAnalysisView renders the "Apply Recommendations" trigger (exact name,
    // to disambiguate from the dialog title / footer "Apply Recommendations (N)").
    const applyTrigger = page.getByRole('button', { name: 'Apply Recommendations', exact: true })
    await expect(applyTrigger).toBeVisible()
    // Open the selection dialog and confirm the real parsed recommendation from
    // VALID_ANALYSIS's RECOMMENDATIONS_JSON block actually surfaces as a row.
    await applyTrigger.click()
    await expect(page.getByText('pressure_Max Pressure')).toBeVisible()
    expect(state.llmCalls).toBe(1)
  })

  test('skipping the taste gate still analyses', async ({ page }) => {
    const state = await mockAnalysisApi(page, { llmContent: VALID_ANALYSIS })
    await openAnalysis(page)
    await page.getByTestId('taste-gate-skip').click()
    // VALID_ANALYSIS parses "Shot Performance" as the first section title
    await expect(page.getByText(/shot performance/i).first()).toBeVisible()
    expect(state.llmCalls).toBe(1)
  })

  test('re-analyze issues a fresh analyze-llm call', async ({ page }) => {
    const state = await mockAnalysisApi(page, { llmContent: VALID_ANALYSIS })
    await openAnalysis(page)
    await page.getByTestId('taste-gate-analyze').click()
    await expect(page.getByRole('button', { name: /apply/i })).toBeVisible()
    // "Re-Analyze" button: t('expertAnalysis.reAnalyze')
    await page.getByRole('button', { name: /re-?analyze/i }).click()
    await expect.poll(() => state.llmCalls).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// A4 — malformed output
// MALFORMED_ANALYSIS contains a RECOMMENDATIONS_JSON block, so hasRecommendations()
// returns true and the "Apply Recommendations" trigger renders. Every rec in the
// block is garbage (empty variable / null values) and parseRecommendationsJSON
// filters them all out, so the selection dialog must show its empty state. This
// verifies the garbage-drop behavior end-to-end (parser → dialog), not just that
// prose renders without crashing.
// ---------------------------------------------------------------------------
test.describe('AI shot analysis — malformed output', () => {
  test('malformed analysis renders as prose and drops garbage recs', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await mockAnalysisApi(page, { llmContent: MALFORMED_ANALYSIS })
    await openAnalysis(page)
    await page.getByTestId('taste-gate-skip').click()
    // Prose from MALFORMED_ANALYSIS is rendered
    await expect(page.getByText(/channeled/i).first()).toBeVisible()
    // The Apply trigger renders (block exists), but opening the dialog shows the
    // empty state because all garbage recs were filtered out.
    await page.getByRole('button', { name: 'Apply Recommendations', exact: true }).click()
    await expect(page.getByText(/no actionable recommendations found/i)).toBeVisible()
    // No JS exceptions thrown during rendering
    expect(errors).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// A5 — error paths
// ShotDetail.tsx line 326-339: throws Error(errorData.detail?.message)
// ExpertAnalysisView surfaces the message string in an Alert.
// ---------------------------------------------------------------------------
test.describe('AI shot analysis — error paths', () => {
  test('analyze-llm 429 surfaces the returned error message', async ({ page }) => {
    await mockAnalysisApi(page, {
      llmStatus: 429,
      llmErrorMessage: 'Rate limit exceeded. Please wait a moment.',
    })
    await openAnalysis(page)
    await page.getByTestId('taste-gate-skip').click()
    await expect(page.getByText(/rate limit exceeded/i)).toBeVisible()
  })

  test('analyze-llm 404 surfaces the returned error message', async ({ page }) => {
    await mockAnalysisApi(page, {
      llmStatus: 404,
      llmErrorMessage: 'No compatible AI model is available.',
    })
    await openAnalysis(page)
    await page.getByTestId('taste-gate-skip').click()
    await expect(page.getByText(/no compatible ai model/i)).toBeVisible()
  })
})
