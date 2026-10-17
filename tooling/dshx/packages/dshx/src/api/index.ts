import { ApiDefinitionModel } from './define.js'

export const defineApi = ApiDefinitionModel.define
export const DSHX_REGISTRY_OWNER = ApiDefinitionModel.registryOwner
export const dshxRegistryApi = ApiDefinitionModel.registryApi
export const method = ApiDefinitionModel.method
export { isApiError, isApiOwnerMissing, PluginApiError } from './common.js'
export type {
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
