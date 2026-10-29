import { ApiProtocolModel } from '../api/common.js'
import { ApiRuntimeModel } from '../api/runtime.js'
import type { AnyApiEventDefinition, AnyApiMethodDefinition, ApiCallOptions, ApiCallResult, ApiClient, ApiClientContract, ApiError } from '../api/types.js'
import { jsonValueSchema } from '../json.js'
import { DshPlatformError } from './client.js'
import { connectDshxApi, createDshxApiCaller } from './dshx-api.js'

/** The `ApiError` an in-browser caller would see for the same failure, so `.safe`, `isApiOwnerMissing` and `DshxEffect.client` work unchanged. */
const apiErrorOf = (error: unknown, contract: Pick<ApiClientContract, 'id' | 'owner'>, method: string): ApiError => {
  if (ApiProtocolModel.isApiError(error)) return error
  if (!(error instanceof DshPlatformError)) return ApiProtocolModel.error('transport', String(error), contract.id, method, true, error)
  if (error.code === 'cancelled') return ApiProtocolModel.aborted(contract.id, method, error)
  if (error.code === 'api-not-served') return ApiProtocolModel.ownerMissing(contract.owner ?? '', contract.id, method, error)
  if (error.code === 'api-unreachable' || error.code === 'connection-failed')
    return ApiProtocolModel.error('transport', error.message, contract.id, method, true, error)
  if (['authentication-expired', 'api-http-error', 'invalid-response', 'invalid-method'].includes(error.code))
    return ApiProtocolModel.error('transport', error.message, contract.id, method, false, error)
  return ApiRuntimeModel.errorFromRemote({ ok: false, error: { code: error.code, message: error.message } }, contract.id, method)
}

/**
 * A typed client for one dshx API outside the browser: a script, a CLI, a test, or another process. It has the same
 * methods, `.safe` results and `ApiError` kinds as the Client's `useApi` client. Without `origin` it authenticates
 * through the tokenized launch URL (`url`, else `DSHX_URL` or the recorded runtime URL); with `origin` it calls an
 * already-authenticated session, such as the in-process Host from `@dshfiles/dshx/testing`.
 */
export const connectDshxApiClient = async <
  const Methods extends Record<string, AnyApiMethodDefinition>,
  const Events extends Record<string, AnyApiEventDefinition> = Record<never, AnyApiEventDefinition>,
>(
  contract: ApiClientContract<Methods, Events>,
  options: { readonly url?: string; readonly origin?: string; readonly cookie?: string; readonly fetch?: typeof fetch } = {},
): Promise<ApiClient<Methods, Events>> => {
  const packageId = contract.owner
  if (packageId === undefined) throw new TypeError(`API ${contract.id} declares no owner; set owner to the package that serves it.`)
  const target = { packageId, apiId: contract.id, version: contract.version, ...(options.fetch !== undefined && { fetch: options.fetch }) }
  const call =
    options.origin === undefined
      ? await connectDshxApi({ ...target, ...(options.url !== undefined && { url: options.url }) })
      : createDshxApiCaller({ ...target, origin: options.origin, cookie: options.cookie ?? '' })
  const invoke = async (method: string, input: unknown, callOptions?: ApiCallOptions): Promise<unknown> => {
    try {
      return await call(method, input === undefined ? undefined : jsonValueSchema.parse(input), callOptions?.signal)
    } catch (error) {
      throw apiErrorOf(error, contract, method)
    }
  }
  const names = Object.keys(contract.methods)
  const methods = Object.fromEntries(names.map(name => [name, (input?: unknown, callOptions?: ApiCallOptions) => invoke(name, input, callOptions)]))
  const safe = Object.fromEntries(
    names.map(name => [
      name,
      async (input?: unknown, callOptions?: ApiCallOptions): Promise<ApiCallResult<unknown>> => {
        try {
          return { ok: true, value: await invoke(name, input, callOptions) }
        } catch (error) {
          return { ok: false, error: apiErrorOf(error, contract, name) }
        }
      },
    ]),
  )
  // SAFETY: every method key of the contract is populated above with the matching call shape.
  return { ...methods, safe } as ApiClient<Methods, Events>
}
