import type { AnyApiMethodDefinition, ApiContract, ApiHandler, ApiHandlerContext, ApiHostInput, ApiHostOutput } from '@dshfiles/dshx/api'
import { HostContext, type Api } from '@dshfiles/dshx/effect'
import { Effect } from 'effect'
import { AccountLocks } from './account-locks.js'

type LegacyContext<I> = Omit<ApiHandlerContext<I>, 'signal'>

const spanName = (method: string): string => `ai accounts ${method.replace(/[A-Z]/gu, letter => ` ${letter.toLowerCase()}`)}`

const legacyContext = Effect.fnUntraced(function* <I>(input: I, call: Api.ApiCall) {
  const host = yield* HostContext
  const context: LegacyContext<I> = { input, ctx: host.ctx, caller: call.caller, peer: call.peer }
  return context
})

const runLegacy = <I, O>(handler: ApiHandler<I, O>, context: LegacyContext<I>) =>
  Effect.tryPromise({
    try: signal => Promise.resolve(handler({ ...context, signal })),
    catch: error => error,
  })

/**
 * Serves one not-yet-ported Promise handler from `Api.bind`, inside the plugin's services: the handler still reads
 * the Cordis context. Each API drops this adapter when its handlers move onto services.
 */
export const effectHandler = <Methods extends Record<string, AnyApiMethodDefinition>, Key extends keyof Methods & string>(
  _contract: ApiContract<Methods>,
  method: Key,
  handler: ApiHandler<ApiHostInput<Methods[Key]>, ApiHostOutput<Methods[Key]>>,
) =>
  Effect.fn(spanName(method))(function* (input: ApiHostInput<Methods[Key]>, call: Api.ApiCall) {
    return yield* runLegacy(handler, yield* legacyContext(input, call))
  })

/** The same adapter for a handler that must own `accounts` for its whole run; a held account refuses it at once. */
export const lockedHandler = <Methods extends Record<string, AnyApiMethodDefinition>, Key extends keyof Methods & string>(
  _contract: ApiContract<Methods>,
  method: Key,
  accounts: (context: LegacyContext<ApiHostInput<Methods[Key]>>) => ReadonlyArray<string>,
  handler: ApiHandler<ApiHostInput<Methods[Key]>, ApiHostOutput<Methods[Key]>>,
) =>
  Effect.fn(spanName(method))(function* (input: ApiHostInput<Methods[Key]>, call: Api.ApiCall) {
    const context = yield* legacyContext(input, call)
    const locks = yield* AccountLocks
    const instanceIds = yield* Effect.try({ try: () => accounts(context), catch: error => error })
    return yield* locks.withAccounts(instanceIds, runLegacy(handler, context))
  })
