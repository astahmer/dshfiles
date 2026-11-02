import { Effect, Option, Result, Schema } from 'effect'
import { ApiProtocolModel } from '../api/common.js'
import type { AnyApiEventDefinition, AnyApiMethodDefinition, ApiClient, ApiClientContract, ApiClientInput, ApiClientOutput, ApiError } from '../api/types.js'

/** The call never reached a handler or its answer never came back: network, Connection or an unexpected transport failure. */
export class ApiTransportError extends Schema.TaggedError<ApiTransportError>()('ApiTransportError', {
  apiId: Schema.String,
  method: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `${this.apiId}.${this.method} could not be reached.`
  }
}

/** No Host serves the API now: its owner is not loaded, or the Connection is down. Retry later or hide the feature. */
export class ApiUnavailableError extends Schema.TaggedError<ApiUnavailableError>()('ApiUnavailableError', {
  apiId: Schema.String,
  method: Schema.String,
  ownerMissing: Schema.Boolean,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.ownerMissing ? `The owner of ${this.apiId} is not loaded, so ${this.method} is unavailable.` : `${this.apiId}.${this.method} is unavailable.`
  }
}

/** Caller and Host disagree on the contract: an unknown method, a version mismatch or input the schema rejects. */
export class ApiContractError extends Schema.TaggedError<ApiContractError>()('ApiContractError', {
  apiId: Schema.String,
  method: Schema.String,
  code: Schema.optional(Schema.String),
  issue: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `${this.apiId}.${this.method} rejected the call: ${this.issue}`
  }
}

/** The handler failed with a code it chose to expose; `details` are its JSON fields when the Host sent any. */
export class ApiRemoteError extends Schema.TaggedError<ApiRemoteError>()('ApiRemoteError', {
  apiId: Schema.String,
  method: Schema.String,
  code: Schema.String,
  remoteMessage: Schema.String,
  details: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {
  override get message(): string {
    return this.remoteMessage
  }
}

/** Every failure an Effect API call can have besides the errors its caller declared. */
export type ApiCallFailure = ApiTransportError | ApiUnavailableError | ApiContractError | ApiRemoteError

/** An error class the Host exposes with `dshxWireCode`; the client decodes its `details` back into it. */
export type DeclaredError = Schema.Codec<unknown, unknown>

/** Typed Effect calls of one contract: each fails with an ApiCallFailure kind or a declared error. */
export type TypedApiClient<Methods extends Record<string, AnyApiMethodDefinition>, Declared = never> = {
  readonly [K in keyof Methods]: ApiClientInput<Methods[K]> extends void
    ? (input?: undefined) => Effect.Effect<ApiClientOutput<Methods[K]>, ApiCallFailure | Declared>
    : (input: ApiClientInput<Methods[K]>) => Effect.Effect<ApiClientOutput<Methods[K]>, ApiCallFailure | Declared>
}

const decodeDeclared = (errors: ReadonlyArray<DeclaredError>) => {
  const decoders = errors.map(error => Schema.decodeUnknownOption(Schema.toCodecJson(error)))
  return (details: Readonly<Record<string, unknown>> | undefined): Option.Option<unknown> => {
    if (details === undefined) return Option.none()
    for (const decode of decoders) {
      const decoded = decode(details)
      if (Option.isSome(decoded)) return decoded
    }
    return Option.none()
  }
}

const failureOf = (input: {
  readonly error: unknown
  readonly apiId: string
  readonly method: string
  readonly declared: (details: Readonly<Record<string, unknown>> | undefined) => Option.Option<unknown>
}): Effect.Effect<never, unknown> => {
  const error = input.error
  if (!ApiProtocolModel.isApiError(error)) return Effect.die(error)
  const identity = { apiId: input.apiId, method: input.method }
  if (error.kind === 'aborted') return Effect.interrupt
  if (error.kind === 'unavailable')
    return Effect.fail(new ApiUnavailableError({ ...identity, ownerMissing: ApiProtocolModel.isApiOwnerMissing(error), cause: error }))
  if (error.kind === 'transport') return Effect.fail(new ApiTransportError({ ...identity, cause: error }))
  if (error.kind === 'contract') {
    return Effect.fail(
      new ApiContractError({ ...identity, ...(error.remoteCode !== undefined && { code: error.remoteCode }), issue: error.message, cause: error }),
    )
  }
  const declared = input.declared(error.remoteDetails)
  if (Option.isSome(declared)) return Effect.fail(declared.value)
  return Effect.fail(remoteError({ error, identity }))
}

const remoteError = (input: { readonly error: ApiError; readonly identity: { readonly apiId: string; readonly method: string } }) =>
  new ApiRemoteError({
    ...input.identity,
    code: input.error.remoteCode ?? 'remote',
    remoteMessage: input.error.message,
    ...(input.error.remoteDetails !== undefined && { details: input.error.remoteDetails }),
  })

type CallableMethod = (input: unknown, options: { readonly signal: AbortSignal }) => Promise<unknown>

/** The Promise methods of an API client by name; `safe` and anything not callable are left out. */
const isCallable = (value: unknown): value is CallableMethod => typeof value === 'function'

const promiseMethods = <Methods extends Record<string, AnyApiMethodDefinition>>(
  api: ApiClient<Methods, Record<string, AnyApiEventDefinition>>,
): ReadonlyMap<string, CallableMethod> => {
  const methods = new Map<string, CallableMethod>()
  for (const [name, value] of Object.entries<unknown>(api)) if (name !== 'safe' && isCallable(value)) methods.set(name, value)
  return methods
}

/**
 * Effect calls over a Promise API client (`createHostApiClient` on the Host, `createApiClient` in a Client). The
 * fiber's interruption aborts the call and an aborted call interrupts the fiber; failures are typed per kind, and
 * a remote failure whose `details` decode into one of `errors` fails with that class instead of ApiRemoteError.
 */
export const client = <const Methods extends Record<string, AnyApiMethodDefinition>, const Errors extends ReadonlyArray<DeclaredError> = []>(input: {
  readonly contract: ApiClientContract<Methods, Record<string, AnyApiEventDefinition>>
  readonly api: ApiClient<Methods, Record<string, AnyApiEventDefinition>>
  readonly errors?: Errors
}): TypedApiClient<Methods, Errors[number]['Type']> => {
  const declared = decodeDeclared(input.errors ?? [])
  const promised = promiseMethods(input.api)
  const methods: Record<string, (value?: unknown) => Effect.Effect<unknown, unknown>> = {}
  for (const method of Object.keys(input.contract.methods)) {
    const call = promised.get(method)
    methods[method] = (value?: unknown) =>
      Effect.promise(signal =>
        call === undefined
          ? Promise.resolve(Result.fail(ApiProtocolModel.error('contract', `The client has no method ${method}.`, input.contract.id, method, false)))
          : call(value, { signal }).then(Result.succeed, Result.fail),
      ).pipe(
        Effect.flatMap(outcome =>
          Result.isSuccess(outcome) ? Effect.succeed(outcome.success) : failureOf({ error: outcome.failure, apiId: input.contract.id, method, declared }),
        ),
      )
  }
  // SAFETY: each contract method maps to an Effect of its declared output; failures are the kinds built in failureOf.
  return methods as TypedApiClient<Methods, Errors[number]['Type']>
}

/**
 * A failed dshx API call with the fields of the Promise API's ApiError.
 * @deprecated `Api.client` fails with ApiTransportError, ApiUnavailableError, ApiContractError or ApiRemoteError.
 */
export class ApiCallError extends Schema.TaggedError<ApiCallError>()('ApiCallError', {
  message: Schema.String,
  kind: Schema.Literals(['transport', 'remote', 'contract', 'aborted', 'unavailable']),
  apiId: Schema.String,
  method: Schema.String,
  retryable: Schema.Boolean,
  remoteCode: Schema.optional(Schema.String),
}) {}

/**
 * The ApiCallError-failing calls behind the deprecated `DshxEffect.client`.
 * @deprecated Use `TypedApiClient` from `Api.client`.
 */
export type EffectApiClient<Methods extends Record<string, AnyApiMethodDefinition>> = {
  readonly [K in keyof Methods]: ApiClientInput<Methods[K]> extends void
    ? (input?: undefined) => Effect.Effect<ApiClientOutput<Methods[K]>, ApiCallError>
    : (input: ApiClientInput<Methods[K]>) => Effect.Effect<ApiClientOutput<Methods[K]>, ApiCallError>
}

const legacyFailure = (input: { readonly error: unknown; readonly method: string }): ApiCallError =>
  ApiProtocolModel.isApiError(input.error)
    ? new ApiCallError({
        message: input.error.message,
        kind: input.error.kind,
        apiId: input.error.apiId,
        method: input.error.method,
        retryable: input.error.retryable,
        ...(input.error.remoteCode !== undefined && { remoteCode: input.error.remoteCode }),
      })
    : new ApiCallError({ message: 'The API call failed outside the dshx client.', kind: 'transport', apiId: '', method: input.method, retryable: true })

/** Convert the existing Promise API client into abort-aware Effect calls failing with ApiCallError. */
export const effectClient = <const Methods extends Record<string, AnyApiMethodDefinition>>(
  api: ApiClient<Methods, Record<string, AnyApiEventDefinition>>,
): EffectApiClient<Methods> => {
  const methods: Record<string, (input?: unknown) => Effect.Effect<unknown, ApiCallError>> = {}
  for (const [method, call] of promiseMethods(api)) {
    methods[method] = (input?: unknown) =>
      Effect.promise(signal => call(input, { signal }).then(Result.succeed, Result.fail)).pipe(
        Effect.flatMap(outcome =>
          Result.isSuccess(outcome) ? Effect.succeed(outcome.success) : Effect.fail(legacyFailure({ error: outcome.failure, method })),
        ),
      )
  }
  // SAFETY: each Promise method is mapped by its contract key to the matching Effect call.
  return methods as EffectApiClient<Methods>
}
