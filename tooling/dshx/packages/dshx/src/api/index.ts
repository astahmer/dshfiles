import { ApiDefinitionModel } from './define.js'
import { ApiRuntimeModel } from './runtime.js'
import { PluginStorageContract } from './storage.js'

export const defineApi = ApiDefinitionModel.define
export const DSHX_REGISTRY_OWNER = ApiDefinitionModel.registryOwner
export const dshxRegistryApi = ApiDefinitionModel.registryApi
export const method = ApiDefinitionModel.method
export const event = ApiDefinitionModel.event
/** Host-backed plugin key-value storage; call it from a browser with `useApi(dshxStorageApi)` or `createApiClient`. */
export const dshxStorageApi = PluginStorageContract.api
export type { StorageListInput, StoragePage, StoredEntry } from './storage.js'
/** Call a registered dshx API by identity; see {@link RegisteredApiSpec}. */
export const createRegisteredApiClient = ApiRuntimeModel.createRegisteredClient
export { isApiError, isApiOwnerMissing, PluginApiError } from './common.js'
export type {
  AnyApiEventDefinition,
  AnyApiMethodDefinition,
  ApiCaller,
  ApiCallOptions,
  ApiCallResult,
  ApiClient,
  ApiClientInput,
  ApiClientOutput,
  ApiContract,
  ApiError,
  ApiErrorKind,
  ApiEventClientPayload,
  ApiEventDefinition,
  ApiEventHostPayload,
  ApiEventStatus,
  ApiHandler,
  ApiHandlerContext,
  ApiHostInput,
  ApiHostOptions,
  ApiHostRegistration,
  ApiHostOutput,
  ApiMethodDefinition,
  ApiMethodMetadata,
  ApiMethodOptions,
  ApiQueryOptions,
  ApiQueryResult,
  ApiQueryState,
  ApiSchema,
  ApiToolExposure,
  PublishedJsonSchema,
  RegistryApiView,
  RegistryListInput,
  RegistryListing,
  RegistryMethodView,
  RegistrySkillView,
  RegistryToolSource,
  RegistryToolView,
} from './types.js'
