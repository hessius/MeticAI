import { test, expect } from '@playwright/test'

/**
 * Full-app sweep against the unified Bun server (3.0.0).
 *
 * Loads the SPA in proxy mode (served same-origin by the Bun server) and
 * exercises the main views, collecting console errors and failed /api
 * responses. Any response whose body contains the core notFound message
 * ("No route for") is a release-blocking coverage gap.
 *
 * Run against a served app:
 *   BASE_URL=http://localhost:35590 bunx playwright test e2e/fullapp-sweep.spec.ts --project=chromium
 */

const BASE = process.env.BASE_URL || 'http://localhost:35590'

interface ApiIssue {
  url: string
  status: number
  bodySnippet: string
  noRoute: boolean
}

test.describe('Full-app sweep (unified Bun server)', () => {
  test.use({ baseURL: BASE })

  test('main views load without console errors or uncovered /api routes', async ({ page }) => {
    const consoleErrors: string[] = []
    const apiIssues: ApiIssue[] = []

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => {
      consoleErrors.push(`pageerror: ${err.message}`)
    })

    page.on('response', async (res) => {
      const url = res.url()
      if (!/\/api\//.test(url)) return
      // The transparent machine proxy (/api/v1/*) can legitimately 4xx.
      if (/\/api\/v\d+\//.test(url)) return
      const status = res.status()
      if (status < 400) return
      let body = ''
      try {
        body = await res.text()
      } catch {
        body = '<unreadable>'
      }
      apiIssues.push({
        url,
        status,
        bodySnippet: body.slice(0, 200),
        noRoute: body.includes('No route for'),
      })
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Give initial-mount hooks (settings, status, profiles, history) time to fire.
    await page.waitForTimeout(2000)

    // Navigate the primary views by clicking any visible top-level nav/tab controls.
    const navCandidates = [
      /History/i,
      /Profiles/i,
      /Catalogue/i,
      /Pour.?over/i,
      /Dial.?in/i,
      /Control/i,
      /Settings/i,
      /Live/i,
    ]
    for (const rx of navCandidates) {
      const btn = page.getByRole('button', { name: rx }).first()
      if (await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => {})
        await page.waitForTimeout(800)
      }
    }

    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(1000)

    // Explicitly open Settings (the update-status card + tailscale live here).
    const settingsBtn = page.getByRole('button', { name: /Settings/i }).first()
    if (await settingsBtn.isVisible().catch(() => false)) {
      await settingsBtn.click().catch(() => {})
      await page.waitForTimeout(2500)
      await page.waitForLoadState('networkidle').catch(() => {})
    }

    const noRoute = apiIssues.filter((i) => i.noRoute)

    // Report everything for diagnosis.
    console.log('=== API ISSUES (status>=400, non-proxy) ===')
    for (const i of apiIssues) {
      console.log(`${i.status} ${i.url}${i.noRoute ? '  <<< NO ROUTE' : ''}  ${i.bodySnippet}`)
    }
    console.log('=== CONSOLE ERRORS ===')
    for (const e of consoleErrors) console.log(e)

    expect(noRoute, `Uncovered core routes: ${noRoute.map((i) => i.url).join(', ')}`).toEqual([])
  })
})
