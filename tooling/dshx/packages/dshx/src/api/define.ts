import type { StandardSchemaV1 } from '@standard-schema/spec'
import type {
  AnyApiEventDefinition,
  AnyApiMethodDefinition,
  ApiContract,
  ApiEventDefinition,
  ApiHandlers,
  ApiHostOptions,
  ApiHostRegistration,
  ApiMethodDefinition,
  ApiMethodOptions,
  ApiSchema,
  ApiToolExposure,
  RegistryListInput,
  RegistryListing,
} from './types.js'

export interface ApiHostRegistrationParts {
  readonly contract: ApiContract
  readonly handlers: ApiHandlers<Record<string, AnyApiMethodDefinition>>
}

const apiHostRegistrations = new WeakMap<object, ApiHostRegistrationParts>()

type SchemaInput<Schema> = Schema extends StandardSchemaV1<infer Input, any> ? Input : never
type SchemaOutput<Schema> = Schema extends StandardSchemaV1<any, infer Output> ? Output : never
type MethodFromSchemas<InputSchema, OutputSchema> = ApiMethodDefinition<
  InputSchema extends ApiSchema ? SchemaInput<InputSchema> : void,
  InputSchema extends ApiSchema ? SchemaOutput<InputSchema> : void,
  OutputSchema extends ApiSchema ? SchemaInput<OutputSchema> : unknown,
  OutputSchema extends ApiSchema ? SchemaOutput<OutputSchema> : unknown
>

function method<I = void, O = unknown>(): ApiMethodDefinition<I, I, O, O>
function method<const InputSchema extends ApiSchema | undefined = undefined, const OutputSchema extends ApiSchema | undefined = undefined>(options: {
  readonly input?: InputSchema
  readonly output?: OutputSchema
  readonly description?: string
  readonly readOnly?: boolean
  readonly tool?: ApiToolExposure<OutputSchema extends ApiSchema ? SchemaOutput<OutputSchema> : unknown>
}): MethodFromSchemas<InputSchema, OutputSchema>
function method(options: ApiMethodOptions = {}): AnyApiMethodDefinition {
  return { ...options }
}

/** Declare an event the Host publishes; `schema` checks the payload on the Host and again in the browser. */
const event = <Input, Output>(options: { readonly schema: ApiSchema<Input, Output>; readonly description?: string }): ApiEventDefinition<Input, Output> => ({
  ...options,
})

function assertId(id: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(id) || id.includes('/')) {
    throw new Error(`Invalid API id ${JSON.stringify(id)}; use a stable single-segment identifier.`)
  }
}

/** Internal authenticity check shared by the source and generated Host adapters. */
function isApiHostRegistration(value: unknown): value is ApiHostRegistration {
  return typeof value === 'object' && value !== null && apiHostRegistrations.has(value)
}

/** Internal registration data shared by the author helper and Host runtime. */
function apiHostRegistrationParts(value: ApiHostRegistration): ApiHostRegistrationParts {
  const parts = apiHostRegistrations.get(value)
  if (parts === undefined) throw new TypeError('Invalid API Host contribution; create it with contract.host({ ...handlers }).')
  return parts
}

function defineApi<
  const Methods extends Record<string, AnyApiMethodDefinition>,
  const Events extends Record<string, AnyApiEventDefinition> = Record<never, AnyApiEventDefinition>,
>(definition: {
  readonly id: string
  readonly version: number
  readonly owner?: string
  readonly methods: Methods
  readonly events?: Events
}): ApiContract<Methods, Events> {
  assertId(definition.id)
  for (const [name, declared] of Object.entries(definition.events ?? {})) {
    if (!/^[A-Za-z0-9._-]+$/.test(name))
      throw new Error(`API ${JSON.stringify(definition.id)} event ${JSON.stringify(name)} must use letters, numbers, ".", "_" or "-".`)
    if (typeof declared.schema?.['~standard']?.validate !== 'function') {
      throw new Error(`API ${JSON.stringify(definition.id)} event ${JSON.stringify(name)} needs a Standard Schema; declare it with event({ schema }).`)
    }
  }
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error(`API ${JSON.stringify(definition.id)} version must be a positive integer.`)
  }
  const contract: ApiContract<Methods, Events> = {
    ...definition,
    host<const Handlers extends ApiHandlers<Methods>>(
      handlers: Handlers & Record<Exclude<keyof Handlers, keyof Methods>, never>,
      options: ApiHostOptions = {},
    ): ApiHostRegistration<Methods, Handlers> {
      if (options.authority !== undefined) {
        throw new TypeError(
          'Per-handler authority is unsupported by the native Connection in DSH 0.2. Remove authority; Connection owns Host/Origin checks and browser authentication. Use the native context for additional admission policy.',
        )
      }
      const expected = Object.keys(definition.methods)
      const missing = expected.filter(name => typeof handlers[name] !== 'function')
      const extra = Object.keys(handlers).filter(name => !(name in definition.methods))
      if (missing.length > 0 || extra.length > 0) {
        const details = [
          ...(missing.length === 0 ? [] : [`missing ${missing.map(value => JSON.stringify(value)).join(', ')}`]),
          ...(extra.length === 0 ? [] : [`unexpected ${extra.map(value => JSON.stringify(value)).join(', ')}`]),
        ].join('; ')
        throw new Error(`API ${JSON.stringify(definition.id)} handlers do not exactly match its methods: ${details}.`)
      }
      const registration = {} as ApiHostRegistration<Methods, Handlers>
      apiHostRegistrations.set(registration, {
        contract,
        handlers: handlers as ApiHandlers<Record<string, AnyApiMethodDefinition>>,
      })
      return registration
    },
  }
  return contract
}

/** Package that serves the dshx registry listing on behalf of the first loaded API Host. */
const DSHX_REGISTRY_OWNER = '@dshfiles/dshx'

/**
 * Discovery of every dshx API served in this DSH process, plus the agent's
 * tools and skills. The first loaded dshx Host plugin with an API serves it.
 */
const dshxRegistryApi = defineApi({
  id: 'registry',
  version: 1,
  owner: DSHX_REGISTRY_OWNER,
  methods: {
    list: method<RegistryListInput, RegistryListing>(),
  },
})

export class ApiDefinitionModel {
  static readonly method = method
  static readonly event = event
  static readonly isHostRegistration = isApiHostRegistration
  static readonly hostRegistrationParts = apiHostRegistrationParts
  static readonly define = defineApi
  static readonly registryOwner = DSHX_REGISTRY_OWNER
  static readonly registryApi = dshxRegistryApi
}
