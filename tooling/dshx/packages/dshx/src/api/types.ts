import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { API_ERROR } from './common.js'

declare const apiHostRegistrationBrand: unique symbol
declare const apiClientInputBrand: unique symbol
declare const apiHostInputBrand: unique symbol
declare const apiHostOutputBrand: unique symbol
declare const apiClientOutputBrand: unique symbol

export type ApiSchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output>

/** Opt-in exposure of one API method to the agent as a native tool. */
export interface ApiToolExposure<Output = unknown> {
  /** Model-facing tool name; unique across every loaded tool. */
  readonly name: string
  /** Model-facing description; defaults to the method description. */
  readonly description?: string
  /** A read-only method may run beside sibling tool calls. */
  readonly readOnly?: boolean
  /** Model-facing text for a successful output; defaults to pretty-printed JSON. */
  readonly render?: (output: Output) => string
}

/** Discovery metadata shared by the registry listing and agent-tool exposure. */
export interface ApiMethodMetadata {
  /** What the method does, written for another plugin author or the agent. */
  readonly description?: string
  /** Expose the method to the agent; requires input and output schemas that publish Standard JSON Schema. */
  readonly tool?: ApiToolExposure
}

export interface ApiMethodOptions<InputSchema extends ApiSchema = ApiSchema, OutputSchema extends ApiSchema = ApiSchema> extends ApiMethodMetadata {
  readonly input?: InputSchema
  readonly output?: OutputSchema
}

/** Client input -> Host input -> Host output -> Client output. */
export interface ApiMethodDefinition<ClientInput = void, HostInput = ClientInput, HostOutput = unknown, ClientOutput = HostOutput> extends ApiMethodMetadata {
  readonly input?: ApiSchema<ClientInput, HostInput>
  readonly output?: ApiSchema<HostOutput, ClientOutput>
  readonly [apiClientInputBrand]?: ClientInput
  readonly [apiHostInputBrand]?: HostInput
  readonly [apiHostOutputBrand]?: HostOutput
  readonly [apiClientOutputBrand]?: ClientOutput
}

export type AnyApiMethodDefinition = ApiMethodDefinition<any, any, any, any>

export interface ApiContract<Methods extends Record<string, AnyApiMethodDefinition> = Record<string, AnyApiMethodDefinition>> {
  readonly id: string
  readonly version: number
  /** Package whose Host serves this API; set it so another plugin's Client can call it. Defaults to the caller's package. */
  readonly owner?: string
  readonly methods: Methods
  readonly host: <const Handlers extends ApiHandlers<Methods>>(
    handlers: Handlers & Record<Exclude<keyof Handlers, keyof Methods>, never>,
    options?: ApiHostOptions,
  ) => ApiHostRegistration<Methods, Handlers>
}

/**
 * What a caller needs to reach an API: identity, version and the methods it may call. A declared contract satisfies
 * it, and so does one assembled from the registry ({@link RegisteredApiSpec}).
 */
export type ApiClientContract<Methods extends Record<string, AnyApiMethodDefinition> = Record<string, AnyApiMethodDefinition>> = Pick<
  ApiContract<Methods>,
  'id' | 'owner' | 'version' | 'methods'
>

export type ApiClientInput<M> = M extends ApiMethodDefinition<infer Input, any, any, any> ? Input : never
export type ApiHostInput<M> = M extends ApiMethodDefinition<any, infer Input, any, any> ? Input : never
export type ApiHostOutput<M> = M extends ApiMethodDefinition<any, any, infer Output, any> ? Output : never
export type ApiClientOutput<M> = M extends ApiMethodDefinition<any, any, any, infer Output> ? Output : never
export type ApiInput<M> = ApiClientInput<M>
export type ApiOutput<M> = ApiClientOutput<M>

/** Who reached the handler: a browser Client over Connection, another Host plugin in process, or the agent through a tool. */
export type ApiCaller =
  | { readonly kind: 'client' }
  | { readonly kind: 'plugin'; readonly packageId: string }
  | { readonly kind: 'agent'; readonly sessionId?: string; readonly cwd?: string }

export type ApiHandlerContext<I> = {
  readonly input: I
  readonly ctx: Context
  readonly signal: AbortSignal
  /** Admitted native operator peer for Client calls; undefined for in-process callers. */
  readonly peer: Parameters<ConnectionRpcHandler>[3] | undefined
  readonly caller: ApiCaller
}

export type ApiHandler<I, O> = (context: ApiHandlerContext<I>) => O | Promise<O>

export type ApiHandlers<Methods extends Record<string, AnyApiMethodDefinition>> = {
  readonly [K in keyof Methods]: ApiHandler<ApiHostInput<Methods[K]>, ApiHostOutput<Methods[K]>>
}

export type ApiHostOptions = {
  /** @deprecated DSH 0.2 has no per-handler authority option. Explicit values are rejected. */
  readonly authority?: 'loopback' | 'trusted-host'
}

export interface ApiHostRegistration<
  Methods extends Record<string, AnyApiMethodDefinition> = Record<string, AnyApiMethodDefinition>,
  Handlers extends ApiHandlers<Methods> = ApiHandlers<Methods>,
> {
  readonly [apiHostRegistrationBrand]: {
    readonly methods: Methods
    readonly handlers: Handlers
  }
}

export type ApiRegistration = ApiHostRegistration

export type ApiCallOptions = {
  readonly signal?: AbortSignal
}

export type ApiMethodClient<M> =
  ApiClientInput<M> extends void
    ? (input?: undefined, options?: ApiCallOptions) => Promise<ApiClientOutput<M>>
    : (input: ApiClientInput<M>, options?: ApiCallOptions) => Promise<ApiClientOutput<M>>

export type ApiSafeMethodClient<M> =
  ApiClientInput<M> extends void
    ? (input?: undefined, options?: ApiCallOptions) => Promise<ApiCallResult<ApiClientOutput<M>>>
    : (input: ApiClientInput<M>, options?: ApiCallOptions) => Promise<ApiCallResult<ApiClientOutput<M>>>

export type ApiClient<Methods extends Record<string, AnyApiMethodDefinition> = Record<string, AnyApiMethodDefinition>> = {
  readonly [K in keyof Methods]: ApiMethodClient<Methods[K]>
} & {
  readonly safe: {
    readonly [K in keyof Methods]: ApiSafeMethodClient<Methods[K]>
  }
}

export type ApiCallResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ApiError }
export type ApiErrorKind = 'transport' | 'remote' | 'contract' | 'aborted' | 'unavailable'

/** Read-only, opaque API failure. */
export interface ApiError extends Error {
  readonly [API_ERROR]: true
  readonly name: 'ApiError'
  readonly kind: ApiErrorKind
  readonly apiId: string
  readonly method: string
  readonly retryable: boolean
  readonly remoteCode?: string | undefined
}

export type ApiFetchStatus = 'idle' | 'fetching' | 'paused'
export type ApiQueryResult<T> =
  | {
      readonly status: 'pending'
      readonly fetchStatus: ApiFetchStatus
      readonly data: undefined
      readonly error: null
      readonly refetch: () => void
    }
  | {
      readonly status: 'success'
      readonly fetchStatus: ApiFetchStatus
      readonly data: T
      readonly error: null
      readonly refetch: () => void
    }
  | {
      readonly status: 'error'
      readonly fetchStatus: 'idle'
      readonly data: T | undefined
      readonly error: ApiError
      readonly refetch: () => void
    }

export type ApiQueryState<T> = ApiQueryResult<T>
export type ApiQueryBaseOptions = {
  readonly enabled?: boolean
  readonly signal?: AbortSignal
  /** Reuse a completed read for this many ms on mount; manual refetch and reconnect always fetch. Defaults to 5000. */
  readonly staleTime?: number
}
export type ApiQueryOptions<M> = ApiClientInput<M> extends void ? ApiQueryBaseOptions : ApiQueryBaseOptions & { readonly input: ApiClientInput<M> }

/** The JSON Schema keywords a method publishes (Standard JSON Schema) that discovery and agent tools read. */
export type PublishedJsonSchema = {
  readonly type?: string | readonly string[]
  readonly description?: string
  readonly title?: string
  readonly anyOf?: readonly PublishedJsonSchema[]
  readonly oneOf?: readonly PublishedJsonSchema[]
  readonly enum?: readonly (string | number | boolean | null)[]
  readonly const?: string | number | boolean | null
  readonly items?: PublishedJsonSchema
  readonly properties?: { readonly [key: string]: PublishedJsonSchema }
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean | PublishedJsonSchema
}

/** One API method another plugin, a Client or (when exposed) the agent can call. */
export interface RegistryMethodView {
  readonly name: string
  readonly description?: string
  /** Agent tool name when the method is exposed to the agent. */
  readonly tool?: string
  /** Published Standard JSON Schema of the Client input, when requested and available. */
  readonly input?: PublishedJsonSchema
  readonly output?: PublishedJsonSchema
}

export interface RegistryApiView {
  readonly owner: string
  readonly id: string
  readonly version: number
  readonly methods: readonly RegistryMethodView[]
}

/**
 * Where an agent tool comes from: a dshx API method, an MCP server, a tool a dshx Host lists in `defineHost({ tools })`
 * (`plugin`), or anything else, which is DSH's own tools and plugins not built with dshx (`tool`).
 */
export type RegistryToolSource = 'api' | 'mcp' | 'plugin' | 'tool'

export interface RegistryToolView {
  readonly name: string
  readonly description: string
  readonly source: RegistryToolSource
  /** Owning package for API and plugin tools. */
  readonly owner?: string
  /**
   * Whether the tool declares itself safe beside sibling calls, DSH's read-only marker (dshx `readOnly: true`). Its
   * classifier may still refuse some arguments. Absent from a registry served by a dshx older than this field.
   */
  readonly readOnly?: boolean
  /** False for a global tool the viewing agent's preset restricts away. Absent from an older registry. */
  readonly enabled?: boolean
}

export interface RegistrySkillView {
  readonly name: string
  readonly description: string
  readonly provider: string
  /** Registry origin, such as project-dsh, project-agents, user-dsh, user-agents, runtime, custom, or bundled. */
  readonly source?: string
  readonly modelInvocable: boolean
  /** Whether a person can invoke it as `/name`. Absent from an older registry. */
  readonly userInvocable?: boolean
  /** @deprecated Legacy absolute path. Modern Hosts intentionally omit it. */
  readonly path?: string
}

export interface RegistryListing {
  readonly apis: readonly RegistryApiView[]
  /**
   * Every tool the viewing agent sees (global tools when no agent is live), plus the global tools its preset restricts
   * away (`enabled: false`); empty without a tools service.
   */
  readonly tools: readonly RegistryToolView[]
  /** The live Session whose tool view `tools` shows; absent for the global view. */
  readonly toolScope?: { readonly sessionId: string }
  /** Every skill the skill registry resolves for `cwd`; empty when no skill registry is loaded. */
  readonly skills: readonly RegistrySkillView[]
}

export interface RegistryListInput {
  readonly owner?: string
  /** Include published JSON Schemas of each method. */
  readonly schemas?: boolean
  /** Workspace whose project skills to include. */
  readonly cwd?: string
  /** Session whose agent tool view to list; defaults to the first live agent. */
  readonly sessionId?: string
}
