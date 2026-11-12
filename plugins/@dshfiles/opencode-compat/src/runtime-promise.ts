import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { Settings } from '@dshfiles/dshx/effect/settings'
import type { SettingsValue } from '@dshfiles/dshx/settings'
import { Context, Effect, Layer, Stream } from 'effect'
import type { Domains } from './context.js'
import { sessionDomain } from './domains/session.js'
import { skillDomain } from './domains/skill.js'
import { storageDomain } from './domains/storage.js'
import { createToolDomain } from './domains/tool.js'
import { start, type PluginStatus } from './runtime.js'
import { compatSettings } from './settings.js'

const CompatSettings = Settings.Tag<SettingsValue<typeof compatSettings.schema>>(compatSettings.namespace)

const createDomains = ({ ctx }: { readonly ctx: CordisContext }): Domains => ({
  skill: input => skillDomain({ ctx, input }),
  session: input => sessionDomain({ ctx, input }),
  storage: input => storageDomain({ ctx, input }),
  tool: createToolDomain({ ctx }),
})

/** The Promise edge of the compat runtime: the loaded OpenCode plugins, restarted when their settings change. */
export class Runtime extends Context.Service<Runtime, { readonly status: Effect.Effect<readonly PluginStatus[]> }>()('@dshfiles/opencode-compat/Runtime') {
  static readonly layer = Layer.effect(
    Runtime,
    Effect.gen(function* () {
      const settings = yield* CompatSettings
      const host = yield* HostContext
      const domains = createDomains({ ctx: host.ctx })
      const initial = yield* settings.get
      const manager = yield* Effect.acquireRelease(
        Effect.promise(async () => ({
          current: await start({ entries: initial.plugins, onUnsupported: initial.onUnsupported, domains }),
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
                manager.current = await start({ entries: value.plugins, onUnsupported: value.onUnsupported, domains })
                manager.key = key
              })
              return manager.pending
            }),
          ),
        ),
      )
      return Runtime.of({ status: Effect.sync(() => manager.current.status()) })
    }),
  )
}
