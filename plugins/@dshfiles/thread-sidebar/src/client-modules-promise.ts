import { DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Option, Queue, Ref, Schema } from 'effect'
import { PluginUpdateWatch, staleClientEntries, type ClientEntryRevision, type PluginRegistry } from './plugin-updates.js'

// The slice of `@deepseek-ai/dsh-client-modules`' ClientModuleRegistry this plugin reads; older Hosts lack members.
interface ClientModuleRegistrySurface {
  readonly graph?: () => { readonly entries: ReadonlyArray<{ readonly id: string; readonly rev?: string | undefined }> }
  readonly clientPath?: (id: string) => string | undefined
  readonly onGraphChanged?: (listener: () => void) => () => void
}

const graphSchema = Schema.Struct({ entries: Schema.Array(Schema.Struct({ id: Schema.String, rev: Schema.optional(Schema.String) })) })
const decodeGraph = Schema.decodeUnknownOption(graphSchema)

interface LoadedRegistry {
  readonly registry: PluginRegistry
  readonly served: () => readonly ClientEntryRevision[]
}

type RegistryUpdate = { readonly _tag: 'attached'; readonly loaded: LoadedRegistry } | { readonly _tag: 'changed' } | { readonly _tag: 'detached' }

const loadedFrom = (source: ClientModuleRegistrySurface): Option.Option<LoadedRegistry> => {
  const graph = source.graph
  const clientPath = source.clientPath
  if (graph === undefined || clientPath === undefined) return Option.none()
  const entries = () => Option.match(decodeGraph(graph()), { onNone: () => [], onSome: decoded => decoded.entries })
  return Option.some({
    registry: { ids: () => entries().map(entry => entry.id), clientPath },
    served: () => entries().flatMap(entry => (entry.rev === undefined ? [] : [{ id: entry.id, rev: entry.rev }])),
  })
}

/**
 * The plugin packages and client bundles the web Host serves, from its client module registry. Hosts without one
 * (desktop shells, older builds) report no pending updates and no served bundles.
 */
export class ClientModules extends Context.Service<
  ClientModules,
  {
    readonly pendingPlugins: Effect.Effect<ReadonlyArray<string>>
    readonly clientUpdates: (page: readonly ClientEntryRevision[]) => Effect.Effect<{ readonly stale: string[]; readonly added: string[] }>
  }
>()('@dshfiles/thread-sidebar/ClientModules') {
  static readonly layer = Layer.effect(
    ClientModules,
    Effect.gen(function* () {
      const host = yield* HostContext
      const watch = yield* PluginUpdateWatch
      const current = yield* Ref.make(Option.none<LoadedRegistry>())
      const updates = yield* Queue.unbounded<RegistryUpdate>()

      const apply = (update: RegistryUpdate) => {
        if (update._tag === 'detached') return Ref.set(current, Option.none())
        if (update._tag === 'attached') return Ref.set(current, Option.some(update.loaded)).pipe(Effect.andThen(watch.remember(update.loaded.registry)))
        return Ref.get(current).pipe(Effect.flatMap(loaded => (Option.isSome(loaded) ? watch.remember(loaded.value.registry) : Effect.void)))
      }
      yield* DshxPlugin.worker(Queue.take(updates).pipe(Effect.flatMap(apply), Effect.forever))

      yield* Effect.acquireRelease(
        Effect.sync(() =>
          host.ctx.inject(['clientModules'], scoped => {
            const source: ClientModuleRegistrySurface | undefined = scoped.get('clientModules')
            if (source === undefined) return
            const loaded = loadedFrom(source)
            if (Option.isNone(loaded)) return
            scoped.effect(() => {
              Queue.offerUnsafe(updates, { _tag: 'attached', loaded: loaded.value })
              const stopWatching = source.onGraphChanged?.(() => Queue.offerUnsafe(updates, { _tag: 'changed' }))
              return () => {
                stopWatching?.()
                Queue.offerUnsafe(updates, { _tag: 'detached' })
              }
            }, 'thread-sidebar: plugin update watch')
          }),
        ),
        tracking => Effect.sync(() => tracking.dispose()),
      )

      return ClientModules.of({
        pendingPlugins: Ref.get(current).pipe(Effect.flatMap(loaded => (Option.isSome(loaded) ? watch.pending(loaded.value.registry) : Effect.succeed([])))),
        clientUpdates: page =>
          Effect.map(Ref.get(current), loaded =>
            staleClientEntries({ page, served: Option.match(loaded, { onNone: () => [], onSome: value => value.served() }) }),
          ),
      })
    }),
  )
}
