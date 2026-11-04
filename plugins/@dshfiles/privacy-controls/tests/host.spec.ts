import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Ref } from 'effect'
import { type LoaderRow, PrivacyControls, PrivacyProfile } from '../src/controls.js'
import { privacyFeatures } from '../src/features.js'
import { readManagedOverrides } from '../src/profile-patch.js'

const originalPatch = `# Keep this user-owned row unchanged.
- id: unrelated-row
  config:
    keep: true
`

const defaultRows = (): LoaderRow[] =>
  privacyFeatures.flatMap(feature => feature.rows.map(row => ({ options: { id: row.patchId }, disabled: !feature.defaultEnabled })))

const profileFixture = (rows: ReadonlyArray<LoaderRow>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'privacy-controls-' })
    const patchPath = `${directory}/cordis.patch.yml`
    yield* fs.writeFileString(patchPath, originalPatch)
    const loaderRows = yield* Ref.make(rows)
    const profile = Layer.succeed(PrivacyProfile, PrivacyProfile.of({ patchPath, entries: Ref.get(loaderRows), liveReload: false, exclusive: write => write }))
    const controls = yield* Effect.provide(PrivacyControls.use(Effect.succeed), PrivacyControls.layer.pipe(Layer.provide(profile)))
    return { controls, patchPath, readPatch: fs.readFileString(patchPath) }
  })

describe('privacy controls Host operations', () => {
  it.layer(nodeFileSystemLayer)(layer => {
    layer.effect('reads independent defaults with session-log download still enabled', () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { controls } = yield* profileFixture(defaultRows())
          const snapshot = yield* controls.read
          expect(snapshot.available).toBe(true)
          expect(snapshot.features.map(feature => [feature.feature, feature.enabled])).toEqual([
            ['answer-feedback-ui', false],
            ['session-feedback-capture', false],
            ['otel-session-upload', false],
            ['deepseek-session-log-upload', false],
            ['session-log-download', true],
          ])
        }),
      ),
    )

    layer.effect('enforces the feedback Remote dependency without changing the patch on rejection', () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { controls, readPatch } = yield* profileFixture(defaultRows())
          const refused = yield* Effect.flip(controls.setFeature({ feature: 'answer-feedback-ui', enabled: true }))
          expect(refused._tag).toBe('PrivacyFeatureDependency')
          expect(refused.message).toMatch(/sessionFeedback Remote/)

          yield* controls.setFeature({ feature: 'session-feedback-capture', enabled: true })
          yield* controls.setFeature({ feature: 'answer-feedback-ui', enabled: true })
          const beforeRejectedWrite = yield* readPatch
          const rejected = yield* Effect.flip(controls.setFeature({ feature: 'session-feedback-capture', enabled: false }))
          expect(rejected._tag).toBe('PrivacyFeatureDependency')
          expect(yield* readPatch).toBe(beforeRejectedWrite)

          yield* controls.setFeature({ feature: 'answer-feedback-ui', enabled: false })
          const afterUiDisabled = yield* controls.setFeature({ feature: 'session-feedback-capture', enabled: false })
          expect(afterUiDisabled.features.find(feature => feature.feature === 'answer-feedback-ui')?.enabled).toBe(false)
          expect(afterUiDisabled.features.find(feature => feature.feature === 'session-feedback-capture')?.enabled).toBe(false)
        }),
      ),
    )

    layer.effect('master action updates all four feedback/upload features but never download', () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { controls, readPatch } = yield* profileFixture(defaultRows())
          const enabled = yield* controls.setAll(true)
          expect(enabled.features.filter(feature => feature.feature !== 'session-log-download').every(feature => feature.enabled)).toBe(true)
          expect(enabled.features.find(feature => feature.feature === 'session-log-download')?.enabled).toBe(true)

          const disabled = yield* controls.setAll(false)
          expect(disabled.features.filter(feature => feature.feature !== 'session-log-download').every(feature => !feature.enabled)).toBe(true)
          expect(disabled.features.find(feature => feature.feature === 'session-log-download')?.enabled).toBe(true)
          const patch = yield* readPatch
          expect(patch).toContain(originalPatch)
          expect(readManagedOverrides(patch).has('session-log-download:session-log-download')).toBe(false)
        }),
      ),
    )

    layer.effect('refuses to mutate a feature when its Loader row is missing', () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { controls } = yield* profileFixture(defaultRows().filter(row => row.options.id !== 'session-log-deepseek'))
          const refused = yield* Effect.flip(controls.setFeature({ feature: 'deepseek-session-log-upload', enabled: true }))
          expect(refused).toMatchObject({ _tag: 'PrivacyFeatureUnavailable', feature: 'deepseek-session-log-upload' })
          expect(refused.message).toMatch(/not present/)
        }),
      ),
    )

    layer.effect('reports an unavailable profile without a Cordis patch', () =>
      Effect.gen(function* () {
        const profile = Layer.succeed(
          PrivacyProfile,
          PrivacyProfile.of({ patchPath: undefined, entries: Effect.succeed(undefined), liveReload: false, exclusive: write => write }),
        )
        const controls = yield* Effect.provide(PrivacyControls.use(Effect.succeed), PrivacyControls.layer.pipe(Layer.provide(profile)))
        expect((yield* controls.read).available).toBe(false)
        expect(yield* Effect.flip(controls.setAll(true))).toMatchObject({ _tag: 'PrivacyControlsUnavailable' })
      }),
    )
  })
})
