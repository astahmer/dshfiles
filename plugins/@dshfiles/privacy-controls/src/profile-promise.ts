import { DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { Deferred, Effect, Layer } from 'effect'
import { LiveReloadLockFailed, PrivacyProfile } from './controls.js'

/** The Cordis edge: the profile patch path, Loader rows and the live-reload exclusive section, read from the Host. */
export const profileLayer = Layer.effect(
  PrivacyProfile,
  Effect.gen(function* () {
    const host = yield* HostContext
    const loader = host.ctx.get('loader')
    const hmr = host.ctx.get('hmr')
    const runInPlugin = yield* DshxPlugin.callback((write: Effect.Effect<void>) => write)

    const exclusive = <A, E>(write: Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        if (hmr === undefined) return yield* write
        const outcome = yield* Deferred.make<A, E>()
        yield* Effect.tryPromise({
          try: () => hmr.runExclusive(() => runInPlugin(Deferred.into(write, outcome).pipe(Effect.asVoid))),
          catch: cause => new LiveReloadLockFailed({ cause }),
        })
        return yield* Deferred.await(outcome)
      }).pipe(Effect.withSpan('privacy profile exclusive write'))

    return PrivacyProfile.of({
      patchPath: host.ctx.get('profileContext')?.patchPath,
      entries: Effect.sync(() => (loader === undefined ? undefined : [...loader.entries()])),
      liveReload: hmr !== undefined,
      exclusive,
    })
  }),
)
