import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { Context, Effect, Layer, Schema } from 'effect'

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
