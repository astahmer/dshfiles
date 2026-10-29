import type { Context } from '@deepseek-ai/cordis'
import { Cause, Effect, Exit, Queue, Schema, Scope, Stream } from 'effect'
import { z } from 'zod'
import type { ManagedRuntime } from 'effect'
import { ApiClientEventsModel } from '../api/client-events.js'
import { ApiProtocolModel, PluginApiError } from '../api/common.js'
import { HostApiEventsModel } from '../api/host-events.js'
import type {
  AnyApiEventDefinition,
  AnyApiMethodDefinition,
  ApiCallOptions,
  ApiClient,
  ApiClientInput,
  ApiClientOutput,
  ApiContract,
  ApiEventClientPayload,
  ApiEventHostPayload,
  ApiHandlerContext,
  ApiHostInput,
  ApiHostOutput,
  ApiHostRegistration,
} from '../api/types.js'

/** A failed dshx API call, with the same fields as the thrown `ApiError` so it can be matched by `_tag` and `kind`. */
export class ApiCallError extends Schema.TaggedError<ApiCallError>()('ApiCallError', {
  message: Schema.String,
  kind: Schema.Literals(['transport', 'remote', 'contract', 'aborted', 'unavailable']),
  apiId: Schema.String,
  method: Schema.String,
  retryable: Schema.Boolean,
  remoteCode: Schema.optional(Schema.String),
}) {}

/** The Host refused to publish an event: the contract declares no such event, its payload failed the schema, or the API is not served. */
export class PublishEventError extends Schema.TaggedError<PublishEventError>()('PublishEventError', {
  message: Schema.String,
  apiId: Schema.String,
  event: Schema.String,
}) {}

type EffectHandlers<Methods extends Record<string, AnyApiMethodDefinition>, R> = {
  readonly [K in keyof Methods]: (context: ApiHandlerContext<ApiHostInput<Methods[K]>>) => Effect.Effect<ApiHostOutput<Methods[K]>, unknown, R>
}

type HostOptions<R> = [R] extends [never]
  ? [options?: { readonly runtime?: ManagedRuntime.ManagedRuntime<R, unknown> }]
  : [options: { readonly runtime: ManagedRuntime.ManagedRuntime<R, unknown> }]

type EffectApiClient<Methods extends Record<string, AnyApiMethodDefinition>> = {
  readonly [K in keyof Methods]: ApiClientInput<Methods[K]> extends void
    ? (input?: undefined) => Effect.Effect<ApiClientOutput<Methods[K]>, ApiCallError>
    : (input: ApiClientInput<Methods[K]>) => Effect.Effect<ApiClientOutput<Methods[K]>, ApiCallError>
}

/** A dshx client method as the wrapper calls it: input first, then the call options carrying the abort signal. */
type ClientMethod = (input: unknown, options: ApiCallOptions) => Promise<unknown>
const clientMethodSchema = z.custom<ClientMethod>(value => typeof value === 'function', 'API client has no such method.')

const taggedFailure = Schema.Struct({ _tag: Schema.String, message: Schema.optional(Schema.String) })
const isTaggedFailure = Schema.is(taggedFailure)

/** `NotFound` → `not-found`, the shape `PluginApiError` accepts as a remote code. */
const remoteCode = (tag: string): string =>
  tag
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[^A-Za-z0-9]+/gu, '-')
    .toLowerCase()
    .replace(/^-+|-+$/gu, '')

/** What a handler's failure becomes on the wire: tagged errors reach the Client as `remoteCode`, anything else stays internal. */
const thrownFailure = (failure: unknown): unknown => {
  if (failure instanceof PluginApiError || !isTaggedFailure(failure)) return failure
  return new PluginApiError(failure.message === undefined || failure.message === '' ? failure._tag : failure.message, {
    code: remoteCode(failure._tag),
    cause: failure,
  })
}

const settle = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw thrownFailure(Cause.squash(exit.cause))
}

/** Serve a contract from handlers that return Effects; the call's AbortSignal interrupts the handler fiber. */
const host = <const Methods extends Record<string, AnyApiMethodDefinition>, R = never>(
  contract: ApiContract<Methods, Record<string, AnyApiEventDefinition>>,
  handlers: EffectHandlers<Methods, R>,
  ...[options]: HostOptions<R>
): ApiHostRegistration<Methods> => {
  const runtime: ManagedRuntime.ManagedRuntime<R, unknown> | undefined = options?.runtime
  const run = (effect: Effect.Effect<unknown, unknown, R>, signal: AbortSignal) =>
    runtime === undefined
      ? // SAFETY: HostOptions makes `runtime` required whenever the handlers need services, so without one R is never.
        Effect.runPromiseExit(effect as Effect.Effect<unknown, unknown>, { signal })
      : runtime.runPromiseExit(effect, { signal })
  const promised = Object.fromEntries(
    Object.entries<(context: ApiHandlerContext<never>) => Effect.Effect<unknown, unknown, R>>(handlers).map(([name, handler]) => [
      name,
      async (context: ApiHandlerContext<never>) => settle(await run(Effect.withSpan(handler(context), `dshx-effect ${contract.id}.${name}`), context.signal)),
    ]),
  )
  // SAFETY: every method key of `handlers` (typed against the contract's methods) maps to a Promise handler of the same input and output.
  return contract.host(promised as Parameters<ApiContract<Methods>['host']>[0])
}

/**
 * A Host `setup` whose plugin lifetime is an Effect Scope: resources acquired with `Effect.acquireRelease`,
 * finalizers and fibers forked with `Effect.forkScoped` live until the plugin unloads or reloads.
 */
const setup =
  <Config, E>(program: (ctx: Context, config: Config) => Effect.Effect<void, E, Scope.Scope>) =>
  async (ctx: Context, config: Config): Promise<() => Promise<void>> => {
    const scope = Effect.runSync(Scope.make())
    const started = await Effect.runPromiseExit(Effect.withSpan(Scope.provide(scope)(program(ctx, config)), 'dshx-effect setup'))
    if (Exit.isFailure(started)) {
      await Effect.runPromise(Scope.close(scope, started))
      throw Cause.squash(started.cause)
    }
    return () => Effect.runPromise(Scope.close(scope, Exit.void))
  }

/** The same client, each method returning an Effect that fails with `ApiCallError`; interrupting it aborts the call. */
const client = <const Methods extends Record<string, AnyApiMethodDefinition>>(
  api: ApiClient<Methods, Record<string, AnyApiEventDefinition>>,
): EffectApiClient<Methods> => {
  const methods = new Map(Object.entries(api))
  const call = (name: string, input: unknown) =>
    Effect.tryPromise({
      try: signal => clientMethodSchema.parse(methods.get(name))(input, { signal }),
      catch: error =>
        ApiProtocolModel.isApiError(error)
          ? new ApiCallError({
              message: error.message,
              kind: error.kind,
              apiId: error.apiId,
              method: error.method,
              retryable: error.retryable,
              ...(error.remoteCode !== undefined && { remoteCode: error.remoteCode }),
            })
          : new ApiCallError({ message: String(error), kind: 'transport', apiId: '', method: name, retryable: true }),
    })
  const effects = Object.fromEntries([...methods.keys()].filter(name => name !== 'safe').map(name => [name, (input?: unknown) => call(name, input)]))
  // SAFETY: every method of the wrapped client is mapped above to an Effect of the same input and output.
  return effects as EffectApiClient<Methods>
}

/** A browser Stream of one API event; the subscription opens on first pull and closes when the Stream ends or is interrupted. */
const events = <
  const Methods extends Record<string, AnyApiMethodDefinition>,
  const Events extends Record<string, AnyApiEventDefinition>,
  K extends keyof Events & string,
>(
  api: ApiClient<Methods, Events>,
  event: K,
): Stream.Stream<ApiEventClientPayload<Events[K]>> =>
  Stream.callback<ApiEventClientPayload<Events[K]>>(queue =>
    Effect.acquireRelease(
      Effect.sync(() => ApiClientEventsModel.subscribe(api, event, { onEvent: payload => Queue.offerUnsafe(queue, payload) })),
      unsubscribe => Effect.sync(unsubscribe),
    ),
  )

/** Publish one event from the Host; pipe a Stream through `Stream.runForEach(stream, payload => publish(...))`. */
const publish = <const Events extends Record<string, AnyApiEventDefinition>, K extends keyof Events & string>(
  ctx: Context,
  contract: ApiContract<Record<string, AnyApiMethodDefinition>, Events>,
  event: K,
  payload: ApiEventHostPayload<Events[K]>,
): Effect.Effect<void, PublishEventError> =>
  Effect.tryPromise({
    try: () => HostApiEventsModel.publish(ctx, contract, event, payload),
    catch: error => new PublishEventError({ message: error instanceof Error ? error.message : String(error), apiId: contract.id, event }),
  })

/**
 * Effect-native authoring on top of the Promise API: handlers, setup, clients and events speak Effect, and the
 * plugin still registers through `defineHost` / `definePlugin`. Opt in by importing `@dshfiles/dshx/effect`.
 */
export class DshxEffect {
  static readonly host = host
  static readonly setup = setup
  static readonly client = client
  static readonly events = events
  static readonly publish = publish
}
