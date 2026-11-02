import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { Context, Effect, Layer, Option, Queue, Schema, Stream } from 'effect'

/** A Cordis service the plugin asked for is not provided by the running Host. */
export class HostServiceMissing extends Schema.TaggedError<HostServiceMissing>()('HostServiceMissing', {
  service: Schema.String,
}) {
  override get message(): string {
    return `The Host does not provide the "${this.service}" service.`
  }
}

/**
 * The Cordis plugin context of one plugin activation. Only dshx edge layers read it; domain services depend on the
 * typed services built from it, never on `ctx` itself.
 */
export class HostContext extends Context.Service<
  HostContext,
  {
    readonly ctx: CordisContext
    readonly packageId: string
  }
>()('@dshfiles/dshx/HostContext') {
  static readonly layer = (input: { readonly ctx: CordisContext; readonly packageId: string }) => Layer.succeed(HostContext, HostContext.of(input))
}

/** Read one Cordis service by name, failing with `HostServiceMissing` when the Host does not provide it. */
export const hostService = Effect.fnUntraced(function* <K extends string & keyof CordisContext>(name: K) {
  const host = yield* HostContext
  const service = host.ctx.get(name)
  if (service === undefined || service === null) return yield* new HostServiceMissing({ service: name })
  return service
})

/**
 * A Cordis service as it comes and goes: `None` first, `Some` while the Host provides it, `None` again when it is
 * disposed. Use it for an optional service a plugin can work without, instead of `inject`, which blocks activation.
 */
export const hostServiceChanges = <K extends string & keyof CordisContext>(
  name: K,
): Effect.Effect<Stream.Stream<Option.Option<NonNullable<CordisContext[K]>>>, never, HostContext> =>
  Effect.map(HostContext, host =>
    Stream.callback<Option.Option<NonNullable<CordisContext[K]>>>(queue =>
      Effect.gen(function* () {
        Queue.offerUnsafe(queue, Option.none())
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            host.ctx.inject([name], scoped => {
              const service = scoped.get(name)
              if (service === undefined || service === null) return
              Queue.offerUnsafe(queue, Option.some(service))
              scoped.effect(
                () => () => {
                  Queue.offerUnsafe(queue, Option.none())
                },
                `dshx: ${name} availability`,
              )
            }),
          ),
          watcher => Effect.promise(() => watcher.dispose()),
        )
      }),
    ),
  )
