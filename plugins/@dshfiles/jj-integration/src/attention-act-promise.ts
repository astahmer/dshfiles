import type { AttentionActOutcome, AttentionActRequest } from '@dshfiles/activity-timeline/attention-api'
import { HostContext } from '@dshfiles/dshx/effect'
import { Effect } from 'effect'

/**
 * The Promise edge of the inbox act event: Cordis serial handlers answer with a Promise, so the Effect answer runs
 * here in the services captured when the plugin activated. The handler is removed when the plugin scope closes.
 */
export const handleAttentionActs = (handle: (request: AttentionActRequest) => Effect.Effect<AttentionActOutcome | undefined>) =>
  Effect.gen(function* () {
    const host = yield* HostContext
    const run = Effect.runPromiseWith(yield* Effect.context<never>())
    yield* Effect.acquireRelease(
      Effect.sync(() => host.ctx.on('dshfiles/attention/act', request => run(handle(request)))),
      dispose => Effect.sync(dispose),
    )
  })
