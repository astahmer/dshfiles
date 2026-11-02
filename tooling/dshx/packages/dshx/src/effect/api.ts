import type { Effect } from 'effect'
import type {
  AnyApiEventDefinition,
  AnyApiMethodDefinition,
  ApiCaller,
  ApiContract,
  ApiHandlerContext,
  ApiHostInput,
  ApiHostOutput,
  ApiHostRegistration,
} from '../api/types.js'
import { ApiProtocolModel } from '../api/common.js'
import { PluginInactive, type PluginRuntime } from './plugin-runtime.js'
import { thrownForApi } from './wire-error.js'

/** Who made one API call. The call's AbortSignal is not here: an abort interrupts the handler fiber. */
export interface ApiCall {
  readonly caller: ApiCaller
  /** The admitted native operator peer of a browser Client call; undefined for in-process callers. */
  readonly peer: ApiHandlerContext<unknown>['peer']
}

/** One Effect handler per contract method: decoded input in, encoded-by-the-contract output out. */
export type Handlers<Methods extends Record<string, AnyApiMethodDefinition>, R> = {
  readonly [K in keyof Methods]: (input: ApiHostInput<Methods[K]>, call: ApiCall) => Effect.Effect<ApiHostOutput<Methods[K]>, unknown, R>
}

/** A contract served by Effect handlers; `DshxPlugin.make({ apis })` serves it inside the plugin's services. */
export interface ApiBinding<out R> {
  readonly contract: ApiContract
  /** @internal The Promise registration the Host runtime mounts, running each call in `runtime`. */
  readonly serve: (runtime: (signal: AbortSignal) => Promise<PluginRuntime<R>>) => ApiHostRegistration
}

/** The services a handler map requires: the union of every handler's requirements. */
export type HandlersServices<H> = {
  readonly [K in keyof H]: H[K] extends (...args: ReadonlyArray<never>) => Effect.Effect<unknown, unknown, infer R> ? R : never
}[keyof H]

/** Type the handlers of a contract once, so they can be declared apart from `bind`. */
export const handlers = <const Methods extends Record<string, AnyApiMethodDefinition>, const H extends Handlers<Methods, unknown>>(
  _contract: ApiContract<Methods, Record<string, AnyApiEventDefinition>>,
  implementation: H,
): H => implementation

type PromiseHandler = (context: ApiHandlerContext<unknown>) => Promise<unknown>

/** Serve `contract` with Effect handlers; each call runs in the plugin's services and its abort interrupts the fiber. */
export const bind = <const Methods extends Record<string, AnyApiMethodDefinition>, const H extends Handlers<Methods, unknown>>(
  contract: ApiContract<Methods, Record<string, AnyApiEventDefinition>>,
  implementation: H,
): ApiBinding<HandlersServices<H>> => ({
  contract,
  serve: runtimeFor => {
    const promised: Record<string, PromiseHandler> = {}
    for (const [method, handler] of Object.entries<(input: never, call: ApiCall) => Effect.Effect<unknown, unknown, unknown>>(implementation)) {
      promised[method] = async context => {
        const runtime = await runtimeFor(context.signal).catch((cause: unknown) => {
          if (cause instanceof PluginInactive) throw ApiProtocolModel.error('unavailable', cause.message, contract.id, method, true, cause)
          throw cause
        })
        // SAFETY: the dispatch validated `context.input` against this method's contract input schema, and
        // HandlersServices<H> is the union of every handler's requirements, so it covers this handler's.
        const effect = handler(context.input as never, { caller: context.caller, peer: context.peer }) as Effect.Effect<unknown, unknown, HandlersServices<H>>
        const exit = await runtime.run(effect, { signal: context.signal })
        if (exit._tag === 'Success') return exit.value
        throw thrownForApi({
          cause: exit.cause,
          apiId: contract.id,
          method,
          warn: message => runtime.log({ topic: 'api', level: 'warn', message }),
        })
      }
    }
    // SAFETY: every contract method is mapped above to a Promise handler of the same input and output.
    return contract.host(promised as Parameters<ApiContract<Methods>['host']>[0])
  },
})
