import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPrivacyControlsService } from '../src/controls.js'
import { privacyFeatures } from '../src/features.js'
import { readManagedOverrides } from '../src/profile-patch.js'

const originalPatch = `# Keep this user-owned row unchanged.
- id: unrelated-row
  config:
    keep: true
`

interface FakeRow {
  options: { id: string; name: string }
  disabled: boolean
  fiber: object | undefined
}

let directory = ''
let patchPath = ''
let rows: FakeRow[] = []

const host = (): Context => {
  const ctx = new Context()
  ctx.provide('profileContext')
  ctx.provide('loader')
  ctx.set('profileContext', { patchPath })
  ctx.set('loader', { entries: () => rows })
  return ctx
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'privacy-controls-'))
  patchPath = join(directory, 'cordis.patch.yml')
  await writeFile(patchPath, originalPatch)
  rows = privacyFeatures.flatMap(feature =>
    feature.rows.map(row => ({
      options: { id: row.patchId, name: row.patchId },
      disabled: !feature.defaultEnabled,
      fiber: undefined,
    })),
  )
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('privacy controls Host operations', () => {
  it('reads independent defaults with session-log download still enabled', async () => {
    const snapshot = await createPrivacyControlsService(host()).read()
    expect(snapshot.available).toBe(true)
    expect(snapshot.features.map(feature => [feature.feature, feature.enabled])).toEqual([
      ['answer-feedback-ui', false],
      ['session-feedback-capture', false],
      ['otel-session-upload', false],
      ['deepseek-session-log-upload', false],
      ['session-log-download', true],
    ])
  })

  it('enforces the feedback Remote dependency without changing the patch on rejection', async () => {
    const controls = createPrivacyControlsService(host())
    await expect(controls.setFeature({ feature: 'answer-feedback-ui', enabled: true })).rejects.toThrow(/sessionFeedback Remote/)

    await controls.setFeature({ feature: 'session-feedback-capture', enabled: true })
    await controls.setFeature({ feature: 'answer-feedback-ui', enabled: true })
    const beforeRejectedWrite = await readFile(patchPath, 'utf8')
    await expect(controls.setFeature({ feature: 'session-feedback-capture', enabled: false })).rejects.toThrow(/sessionFeedback Remote/)
    expect(await readFile(patchPath, 'utf8')).toBe(beforeRejectedWrite)

    await controls.setFeature({ feature: 'answer-feedback-ui', enabled: false })
    const afterUiDisabled = await controls.setFeature({ feature: 'session-feedback-capture', enabled: false })
    expect(afterUiDisabled.features.find(feature => feature.feature === 'answer-feedback-ui')?.enabled).toBe(false)
    expect(afterUiDisabled.features.find(feature => feature.feature === 'session-feedback-capture')?.enabled).toBe(false)
  })

  it('master action updates all four feedback/upload features but never download', async () => {
    const controls = createPrivacyControlsService(host())
    const enabled = await controls.setAll(true)
    expect(enabled.features.filter(feature => feature.feature !== 'session-log-download').every(feature => feature.enabled)).toBe(true)
    expect(enabled.features.find(feature => feature.feature === 'session-log-download')?.enabled).toBe(true)

    const disabled = await controls.setAll(false)
    expect(disabled.features.filter(feature => feature.feature !== 'session-log-download').every(feature => !feature.enabled)).toBe(true)
    expect(disabled.features.find(feature => feature.feature === 'session-log-download')?.enabled).toBe(true)
    expect(await readFile(patchPath, 'utf8')).toContain(originalPatch)
    expect(readManagedOverrides(await readFile(patchPath, 'utf8')).has('session-log-download:session-log-download')).toBe(false)
  })

  it('refuses to mutate a feature when its Loader row is missing', async () => {
    rows = rows.filter(row => row.options.id !== 'session-log-deepseek')
    await expect(createPrivacyControlsService(host()).setFeature({ feature: 'deepseek-session-log-upload', enabled: true })).rejects.toThrow(/not present/)
  })
})
