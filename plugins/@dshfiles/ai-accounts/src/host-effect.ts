import type { AnyApiMethodDefinition, ApiContract, ApiHandlerContext, ApiHostInput, ApiHostOutput } from '@dshfiles/dshx/api'
import { HostContext, type Api } from '@dshfiles/dshx/effect'
import { PluginApiError } from '@dshfiles/dshx/api'
import { Effect, Schema } from 'effect'
import { AccountsWireError } from './errors.js'
import { AccountLocks } from './account-locks.js'
import { AccountStorePromiseService, type AccountStorePromise } from './account-store-promise.js'

type LegacyContext<I> = Omit<ApiHandlerContext<I>, 'signal'> & { readonly store: AccountStorePromise }

type LegacyHandler<I, O> = (context: LegacyContext<I> & { readonly signal: AbortSignal }) => O | Promise<O>

const spanName = (method: string): string => `ai accounts ${method.replace(/[A-Z]/gu, letter => ` ${letter.toLowerCase()}`)}`

const legacyContext = Effect.fnUntraced(function* <I>(input: I, call: Api.ApiCall) {
  const host = yield* HostContext
  const store = yield* AccountStorePromiseService
  const context: LegacyContext<I> = { input, ctx: host.ctx, caller: call.caller, peer: call.peer, store }
  return context
})

/** A Promise handler threw something that is not a declared account failure; it stays internal to the Host. */
class LegacyHandlerFailed extends Schema.TaggedError<LegacyHandlerFailed>()('LegacyHandlerFailed', {
  method: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `${this.method} failed.`
  }
}

const isWireError = Schema.is(AccountsWireError)

const legacyFailure = (method: string) => (cause: unknown) =>
  isWireError(cause) || cause instanceof PluginApiError ? cause : new LegacyHandlerFailed({ method, cause })

const runLegacy = <I, O>(method: string, handler: LegacyHandler<I, O>, context: LegacyContext<I>) =>
  Effect.tryPromise({ try: signal => Promise.resolve(handler({ ...context, signal })), catch: legacyFailure(method) }).pipe(
    Effect.catchTag('LegacyHandlerFailed', Effect.die),
  )

/**
 * Serves one not-yet-ported Promise handler from `Api.bind`, inside the plugin's services: the handler still reads
 * the Cordis context. Each API drops this adapter when its handlers move onto services.
 */
export const effectHandler = <Methods extends Record<string, AnyApiMethodDefinition>, Key extends keyof Methods & string>(
  _contract: ApiContract<Methods>,
  method: Key,
  handler: LegacyHandler<ApiHostInput<Methods[Key]>, ApiHostOutput<Methods[Key]>>,
) =>
  Effect.fn(spanName(method))(function* (input: ApiHostInput<Methods[Key]>, call: Api.ApiCall) {
    return yield* runLegacy(method, handler, yield* legacyContext(input, call))
  })

/** The same adapter for a handler that must own `accounts` for its whole run; a held account refuses it at once. */
export const lockedHandler = <Methods extends Record<string, AnyApiMethodDefinition>, Key extends keyof Methods & string>(
  _contract: ApiContract<Methods>,
  method: Key,
  accounts: (context: LegacyContext<ApiHostInput<Methods[Key]>>) => ReadonlyArray<string>,
  handler: LegacyHandler<ApiHostInput<Methods[Key]>, ApiHostOutput<Methods[Key]>>,
) =>
  Effect.fn(spanName(method))(function* (input: ApiHostInput<Methods[Key]>, call: Api.ApiCall) {
    const context = yield* legacyContext(input, call)
    const locks = yield* AccountLocks
    const instanceIds = yield* Effect.try({ try: () => accounts(context), catch: legacyFailure(method) }).pipe(
      Effect.catchTag('LegacyHandlerFailed', Effect.die),
    )
    return yield* locks.withAccounts(instanceIds, runLegacy(method, handler, context))
  })
