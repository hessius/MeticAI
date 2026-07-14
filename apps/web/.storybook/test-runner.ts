import type { TestRunnerConfig } from '@storybook/test-runner'
import { toMatchImageSnapshot } from 'jest-image-snapshot'

const VIEWPORTS: Record<string, { width: number; height: number }> = {
  iphone: { width: 390, height: 844 },
  ipadPortrait: { width: 834, height: 1194 },
  ipadLandscape: { width: 1194, height: 834 },
}
const VP = process.env.SB_VIEWPORT ?? 'iphone'

const config: TestRunnerConfig = {
  setup() {
    expect.extend({ toMatchImageSnapshot })
  },
  async preVisit(page) {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize(VIEWPORTS[VP])
  },
  async postVisit(page, context) {
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(150)
    const image = await page.screenshot()
    // @ts-expect-error jest-image-snapshot augments expect at runtime.
    expect(image).toMatchImageSnapshot({
      customSnapshotsDir: `__image_snapshots__/${VP}`,
      customSnapshotIdentifier: context.id,
      failureThreshold: 0.02,
      failureThresholdType: 'percent',
    })
  },
}
export default config
