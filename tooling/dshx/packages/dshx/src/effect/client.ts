import { Effect, Schema } from 'effect'
import { z } from 'zod'
import { ApiProtocolModel } from '../api/common.js'
import type {
  AnyApiEventDefinition,
  AnyApiMethodDefinition,
  ApiClient,
  ApiClientInput,
  ApiClientOutput,
} from '../api/types.js'

/** A failed dshx API call, with the same fields as the Promise API's ApiError. */
export class ApiCallError extends Schema.TaggedError<ApiCallError>()('ApiCallError', {
  message: Schema.String,
  kind: Schema.Literals(['transport', 'remote', 'contract', 'aborted', 'unavailable']),
  apiId: Schema.String,
  method: Schema.String,
  retryable: Schema.Boolean,
  remoteCode: Schema.optional(Schema.String),
}) {}

type ClientMethod = (input: unknown, options: { readonly signal?: AbortSignal }) => Promise<unknown>
const clientMethodSchema = z.custom<ClientMethod>(value => typeof value === 'function', 'API client has no such method.')

export type EffectApiClient<Methods extends Record<string, AnyApiMethodDefinition>> = {
  readonly [K in keyof Methods]: ApiClientInput<Methods[K]> extends void
    ? (input?: undefined) => Effect.Effect<ApiClientOutput<Methods[K]>, ApiCallError>
    : (input: ApiClientInput<Methods[K]>) => Effect.Effect<ApiClientOutput<Methods[K]>, ApiCallError>
}

/** Convert the existing Promise API client into abort-aware Effect calls. */
export const effectClient = <const Methods extends Record<string, AnyApiMethodDefinition>>(
  api: ApiClient<Methods, Record<string, AnyApiEventDefinition>>,
): EffectApiClient<Methods> => {
  const methods = new Map(Object.entries(api))
  const call = (name: string, input: unknown) =>
    Effect.tryPromise({
      try: signal => {
        return clientMethodSchema.parse(methods.get(name))(input, { signal })
      },
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
  // SAFETY: each Promise method is mapped by its contract key to the matching Effect call.
  return effects as EffectApiClient<Methods>
}
