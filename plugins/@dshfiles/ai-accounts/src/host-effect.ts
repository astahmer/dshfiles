import type { AnyApiMethodDefinition, ApiContract, ApiHandler, ApiHostInput, ApiHostOutput } from '@dshfiles/dshx/api'
import { HostContext, type Api } from '@dshfiles/dshx/effect'
import { Effect } from 'effect'

/**
 * Serves one not-yet-ported Promise handler from `Api.bind`, inside the plugin's services: the handler still reads
 * the Cordis context. Each API drops this adapter when its handlers move onto services.
 */
export const effectHandler = <Methods extends Record<string, AnyApiMethodDefinition>, Key extends keyof Methods & string>(
  _contract: ApiContract<Methods>,
  method: Key,
  handler: ApiHandler<ApiHostInput<Methods[Key]>, ApiHostOutput<Methods[Key]>>,
) =>
  Effect.fn(`ai accounts ${method.replace(/[A-Z]/gu, letter => ` ${letter.toLowerCase()}`)}`)(function* (input: ApiHostInput<Methods[Key]>, call: Api.ApiCall) {
    const host = yield* HostContext
    return yield* Effect.tryPromise({
      try: signal => Promise.resolve(handler({ input, ctx: host.ctx, caller: call.caller, peer: call.peer, signal })),
      catch: error => error,
    })
  })
