import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Settings } from '@dshfiles/dshx/effect/settings'
import type { SettingsValue } from '@dshfiles/dshx/settings'
import { Effect, Layer, Stream } from 'effect'
import { start } from './runtime.js'
import { compatSettings } from './settings.js'

const CompatSettings = Settings.Tag<SettingsValue<typeof compatSettings.schema>>(compatSettings.namespace)

const Runtime = Layer.effectDiscard(
  Effect.gen(function* () {
    const settings = yield* CompatSettings
    const initial = yield* settings.get
    const manager = yield* Effect.acquireRelease(
      Effect.promise(async () => ({
        current: await start({ entries: initial.plugins, onUnsupported: initial.onUnsupported }),
        key: JSON.stringify(initial),
        pending: Promise.resolve(),
        stopped: false,
      })),
      manager =>
        Effect.promise(async () => {
          manager.stopped = true
          await manager.pending
          await manager.current.dispose()
        }),
    )
    yield* DshxPlugin.worker(
      settings.changes.pipe(
        Stream.runForEach(value =>
          Effect.promise(() => {
            manager.pending = manager.pending.then(async () => {
              const key = JSON.stringify(value)
              if (manager.stopped || key === manager.key) return
              await manager.current.dispose()
              if (manager.stopped) return
              manager.current = await start({ entries: value.plugins, onUnsupported: value.onUnsupported })
              manager.key = key
            })
            return manager.pending
          }),
        ),
      ),
    )
  }),
)

export default DshxPlugin.make({
  name: '@dshfiles/opencode-compat',
  settings: [compatSettings],
  layer: Runtime.pipe(Layer.provide(Settings.layer(compatSettings))),
})
