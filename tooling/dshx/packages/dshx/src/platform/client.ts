import { randomUUID } from 'node:crypto'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isIPv4 } from 'node:net'
import { decodeJson, jsonValueSchema } from '../json.js'
import { withUnknownProperties } from '../schema.js'
import WebSocket, { type RawData } from 'ws'
import { createDshxApiCaller, type DshxApiCall } from './dshx-api.js'

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

const sessionSummarySchema = Schema.Struct({
  agentAvailable: Schema.Boolean,
  sessionId: Schema.String,
  updatedAt: Schema.Number.check(Schema.isFinite()),
  running: Schema.Boolean,
  blank: Schema.Boolean,
  parentSessionId: Schema.optional(Schema.String),
  origin: Schema.optional(Schema.Literals(['subagent'])),
  cwd: Schema.optional(Schema.String),
  projections: Schema.optional(jsonValueSchema),
})

const sessionSearchItemSchema = Schema.Struct({
  sessionId: Schema.String,
  snippet: Schema.String,
})
const sessionSearchSchema = Schema.Struct({
  items: Schema.Array(sessionSearchItemSchema),
  hasMore: Schema.Boolean,
})

const threadFinderHitSchema = withUnknownProperties({
  sessionId: Schema.String,
  title: Schema.String,
  createdAt: Schema.Number.check(Schema.isFinite()),
  updatedAt: Schema.Number.check(Schema.isFinite()),
  cwd: Schema.NullOr(Schema.String),
  project: Schema.String,
  live: Schema.Boolean,
  persisted: Schema.Boolean,
  parentSessionId: Schema.NullOr(Schema.String),
  snippet: Schema.String,
  sources: Schema.Array(Schema.String),
  evidence: Schema.Array(Schema.String),
  score: Schema.Number.check(Schema.isFinite()),
})

const threadFinderPageSchema = withUnknownProperties({
  hits: Schema.Array(threadFinderHitSchema),
  notes: Schema.Array(
    withUnknownProperties({
      noteId: Schema.Number.check(Schema.isFinite()),
      project: Schema.String,
      updatedAt: Schema.Number.check(Schema.isFinite()),
      sourceThread: Schema.NullOr(Schema.String),
      excerpt: Schema.String,
    }),
  ),
  nextCursor: Schema.NullOr(Schema.String),
  degraded: Schema.Array(
    withUnknownProperties({
      source: Schema.String,
      code: Schema.String,
      message: Schema.String,
      attempts: Schema.Number.check(Schema.isFinite()),
      elapsedMs: Schema.Number.check(Schema.isFinite()),
    }),
  ),
  diagnostics: withUnknownProperties({
    correlationId: Schema.String,
    elapsedMs: Schema.Number.check(Schema.isFinite()),
    sources: Schema.Array(Schema.String),
    attempts: Schema.Number.check(Schema.isFinite()),
    scannedSessions: Schema.Number.check(Schema.isFinite()),
    incomplete: Schema.Boolean,
  }),
  project: Schema.String,
})

export type ThreadFinderPageResult = Schema.Schema.Type<typeof threadFinderPageSchema>

export type ThreadFinderCallInput = {
  readonly query: string
  readonly project?: string
  readonly limit?: number
  readonly cursor?: string
  readonly availability?: readonly ('live' | 'persisted')[]
  readonly createdFrom?: string
  readonly createdTo?: string
  readonly includeNotes?: boolean
}

/** What the platform client can say about the optional composed finder before it searches at all. */
export type ThreadFinderAttempt =
  | { readonly kind: 'absent' }
  | { readonly kind: 'page'; readonly page: ThreadFinderPageResult }
  | { readonly kind: 'failed'; readonly error: DshPlatformError }

type DshxRegistryApi = {
  readonly owner: string
  readonly id: string
  readonly version: number
  readonly methods: readonly string[]
}

const agentPresetRowSchema = Schema.Struct({
  id: Schema.String,
  isDefault: Schema.Boolean,
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  broken: Schema.optional(Schema.String),
})
const agentPresetRosterSchema = Schema.Struct({
  presets: Schema.Array(agentPresetRowSchema),
})
const agentPresetDocumentSchema = Schema.Struct({
  agentPreset: Schema.String,
  content: Schema.String,
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
})

const modelSelectionSchema = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  reasoningEffort: Schema.optional(Schema.String),
})
/** The fields dshx reads from `@dshfiles/session-controller`'s `thread-model` snapshot. */
const threadModelSnapshotSchema = withUnknownProperties({
  selection: modelSelectionSchema,
  revision: Schema.Number.check(Schema.isFinite(), Schema.isInt()),
  preferSelectedProvider: Schema.Boolean,
})
const modelCatalogSchema = Schema.Struct({
  default: modelSelectionSchema,
  routableProviders: Schema.Array(Schema.String),
  groups: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      models: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          name: Schema.String,
          description: Schema.optional(Schema.String),
          reasoning: Schema.optional(
            Schema.Struct({
              efforts: Schema.Array(
                Schema.Struct({
                  id: Schema.String,
                  name: Schema.String,
                  description: Schema.optional(Schema.String),
                }),
              ),
              defaultEffort: Schema.optional(Schema.String),
            }),
          ),
        }),
      ),
    }),
  ),
  failures: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String, message: Schema.String })),
})

const skillEntrySchema = Schema.Struct({
  path: Schema.optional(Schema.String),
  name: Schema.String,
  description: Schema.String,
  whenToUse: Schema.optional(Schema.String),
  modelInvocable: Schema.Boolean,
})

const pluginInspectionSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal('accepted'),
    kind: Schema.Literals(['registry', 'path', 'git', 'tarball']),
    name: Schema.optional(Schema.String),
    version: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
    bundle: Schema.Union([Schema.Boolean, Schema.Null]),
    registry: Schema.Union([Schema.String, Schema.Null]),
    host: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    status: Schema.Literal('refused'),
    problem: Schema.Literals(['invalid-spec', 'already-installed', 'not-found', 'not-a-package', 'not-a-bundle', 'network', 'unknown']),
    reason: Schema.String,
    registries: Schema.optional(Schema.Array(Schema.Union([Schema.String, Schema.Null]))),
  }),
])

const pluginSchema = Schema.Struct({
  entryId: Schema.String,
  moduleName: Schema.String,
  meta: Schema.optional(jsonValueSchema),
  enabled: Schema.Boolean,
  fiberPhase: Schema.NullOr(Schema.Literals(['pending', 'loading', 'active', 'failed', 'unloading'])),
  readOnlyReason: Schema.optional(Schema.String),
})

const bundleSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  enabled: Schema.Boolean,
  installed: Schema.Boolean,
  optional: Schema.Boolean,
  removable: Schema.Boolean,
  readOnlyReason: Schema.optional(Schema.Literals(['management-required', 'unaddressable'])),
  error: Schema.optional(Schema.Unknown),
  rows: Schema.Array(
    Schema.Struct({
      rowId: Schema.String,
      moduleName: Schema.String,
      entryId: Schema.optional(Schema.String),
    }),
  ),
  overrides: Schema.Array(Schema.String),
})

const commandInputSchema = Schema.Struct({
  hint: Schema.String,
  attachments: Schema.optional(Schema.Boolean),
})

const commandSchema = Schema.Struct({
  definitionId: Schema.optional(Schema.String),
  name: Schema.String,
  description: Schema.String,
  input: Schema.optional(commandInputSchema),
})

const settingsNamespaceSchema = Schema.Struct({
  ns: Schema.String,
  schema: jsonValueSchema,
  value: jsonValueSchema,
  autoGenerate: Schema.Boolean,
  revision: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
  applies: Schema.Literal('live'),
  secrets: Schema.Array(Schema.Struct({ path: Schema.Array(Schema.String), set: Schema.Boolean })),
})

const settingsDescriptionSchema = Schema.Struct({
  writable: Schema.Boolean,
  hasDocument: Schema.Boolean,
  namespaces: Schema.Array(settingsNamespaceSchema),
})

const rpcResponseSchema = Schema.Struct({
  type: Schema.Literal('server-response'),
  rpcId: Schema.String,
  result: Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true), value: jsonValueSchema }),
    Schema.Struct({
      ok: Schema.Literal(false),
      error: Schema.Struct({
        code: Schema.optional(Schema.String),
        message: Schema.String,
        details: Schema.optional(Schema.Unknown),
      }),
    }),
  ]),
})

const streamFrameSchema = Schema.Struct({
  type: Schema.Literals(['item', 'error', 'end']),
  streamId: Schema.String,
  value: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({ code: Schema.String, message: Schema.String })),
})

const snapshotSchema = Schema.Struct({
  type: Schema.Literal('snapshot'),
  cursor: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(-1), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
})

const historyRecordSchema = withUnknownProperties({
  type: Schema.Literal('event'),
  event: withUnknownProperties({
    seq: Schema.Number.check(Schema.isFinite(), Schema.makeFilter(Number.isSafeInteger), Schema.isGreaterThanOrEqualTo(0)),
  }),
})

export interface SessionSummary {
  readonly sessionId: string
  /** Host archive state when the optional thread-sidebar status API is available. */
  readonly archived?: boolean
  readonly updatedAt: number
  readonly running: boolean
  readonly blank: boolean
  readonly agentAvailable: boolean
  readonly parentSessionId?: string
  readonly origin?: 'subagent'
  readonly cwd?: string
  readonly projections?: JsonValue
}

export interface SessionSearchItem {
  readonly sessionId: string
  readonly snippet: string
}

export interface AgentPresetRow {
  readonly id: string
  readonly isDefault: boolean
  readonly name?: string
  readonly description?: string
  readonly broken?: string
}

export interface AgentPresetDocument {
  readonly agentPreset: string
  readonly content: string
  readonly name?: string
  readonly description?: string
}

export interface ModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export interface ModelCatalog {
  readonly default: ModelSelection
  readonly routableProviders: readonly string[]
  readonly groups: readonly {
    readonly id: string
    readonly name: string
    readonly models: readonly {
      readonly id: string
      readonly name: string
      readonly description?: string
      readonly reasoning?: {
        readonly efforts: readonly {
          readonly id: string
          readonly name: string
          readonly description?: string
        }[]
        readonly defaultEffort?: string
      }
    }[]
  }[]
  readonly failures: readonly {
    readonly id: string
    readonly name: string
    readonly message: string
  }[]
}

export interface SkillEntry {
  readonly path?: string
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly modelInvocable: boolean
}

export type PluginInspection =
  | {
      readonly status: 'accepted'
      readonly kind: 'registry' | 'path' | 'git' | 'tarball'
      readonly name?: string
      readonly version?: string
      readonly description?: string
      readonly bundle: boolean | null
      readonly registry: string | null
      readonly host?: string
    }
  | {
      readonly status: 'refused'
      readonly problem: 'invalid-spec' | 'already-installed' | 'not-found' | 'not-a-package' | 'not-a-bundle' | 'network' | 'unknown'
      readonly reason: string
      readonly registries?: readonly (string | null)[]
    }

export interface PluginSummary {
  readonly id: string
  readonly moduleName: string
  readonly meta?: JsonValue
  readonly enabled: boolean
  readonly phase?: string | null
  readonly readOnlyReason?: string
}

export interface BundleSummary {
  readonly name: string
  readonly description?: string
  readonly enabled: boolean
  readonly installed: boolean
  readonly optional: boolean
  readonly removable: boolean
  readonly readOnlyReason?: string
  readonly error?: JsonValue
  readonly rowCount?: number
}

export interface CommandSummary {
  readonly definitionId?: string
  readonly name: string
  readonly description: string
  readonly input?: { readonly hint: string; readonly attachments?: boolean | undefined } | undefined
}

export interface SettingsNamespace {
  readonly ns: string
  readonly schema: JsonValue
  readonly value: JsonValue
  readonly autoGenerate: boolean
  readonly revision: number
  readonly applies: 'live'
  readonly secrets: readonly {
    readonly path: readonly string[]
    readonly set: boolean
  }[]
}

export interface SettingsDescription {
  readonly writable: boolean
  readonly hasDocument: boolean
  readonly namespaces: readonly SettingsNamespace[]
}

export interface SessionPage {
  readonly records: readonly JsonValue[]
  readonly hasMore: boolean
}

/** Bounds a Session export: events after `afterSeq`, at most `newest` records that pass `keep`, newest last. */
export interface SessionEventRange {
  readonly afterSeq?: number
  readonly throughSeq?: number
  readonly newest?: number
  readonly keep?: (record: JsonValue) => boolean
}

export interface ChangeResult {
  readonly application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
  readonly changed: boolean
  readonly enabled?: boolean
  readonly stage: 'install' | 'enable' | 'remove'
  readonly target: string
  readonly error?: {
    readonly code: string
    readonly diagnostic?: string
    readonly incompatible?: JsonValue
  }
  readonly warnings: readonly string[]
}

export interface DshPlatformTransport {
  rpc(namespace: string, method: string, args: Readonly<Record<string, JsonValue>>, signal?: AbortSignal): Promise<JsonValue>
  sessionCursor(sessionId: string): Promise<number>
  archivedSessionIds?(sessionIds: readonly string[]): Promise<readonly string[] | undefined>
  /** Optional composed finder served by the installed Memory plugin; absent means an older Host. */
  findThreads?(input: ThreadFinderCallInput): Promise<ThreadFinderAttempt>
  /** Session-only model selection served by `@dshfiles/session-controller`; `undefined` means that API is absent. */
  selectSessionModel?(sessionId: string, selection: ModelSelection): Promise<ModelSelection | undefined>
}

export interface DshPlatformClient {
  readonly sessions: {
    /** Omit `projections` for the historical full read; an empty list asks for no projection columns. */
    list(projections?: readonly string[]): Promise<readonly SessionSummary[]>
    search(query: string): Promise<{
      readonly items: readonly SessionSearchItem[]
      readonly hasMore: boolean
    }>
    /** The composed finder when the installed Memory plugin serves it; see {@link ThreadFinderAttempt}. */
    findThreads(input: ThreadFinderCallInput): Promise<ThreadFinderAttempt>
    create(input: { readonly cwd?: string; readonly agentPreset?: string }): Promise<{ readonly sessionId: string; readonly agentPreset?: string }>
    fork(sessionId: string, atSeq?: number): Promise<{ readonly sessionId: string }>
    cancel(sessionId: string): Promise<{ readonly accepted: true }>
    rename(sessionId: string, title: string): Promise<{ readonly title: string; readonly seq: number }>
    archive(sessionId: string): Promise<{ readonly archivedSessionIds: readonly string[] }>
    unarchive(sessionId: string): Promise<{ readonly archivedSessionIds: readonly string[] }>
    prompt(sessionId: string, text: string, mode: 'queue' | 'steer', signal?: AbortSignal): Promise<{ readonly accepted: true }>
    page(sessionId: string, throughSeq: number, beforeSeq?: number, maxMessages?: number): Promise<SessionPage>
    history(sessionId: string, maxMessages?: number): Promise<SessionPage>
    cursor(sessionId: string): Promise<number>
    export(sessionId: string, range?: SessionEventRange): Promise<readonly JsonValue[]>
  }
  readonly plugins: {
    list(): Promise<readonly PluginSummary[]>
    check(spec: string): Promise<PluginInspection>
    setEnabled(id: string, enabled: boolean): Promise<ChangeResult>
  }
  readonly bundles: {
    list(): Promise<readonly BundleSummary[]>
    install(spec: string, signal?: AbortSignal): Promise<ChangeResult>
    remove(name: string): Promise<ChangeResult>
    setEnabled(name: string, enabled: boolean): Promise<ChangeResult>
  }
  readonly presets: {
    list(): Promise<readonly AgentPresetRow[]>
    show(id: string): Promise<AgentPresetDocument>
  }
  readonly models: {
    list(): Promise<ModelCatalog>
    select(sessionId: string, selection: ModelSelection): Promise<ModelSelection>
  }
  readonly skills: {
    list(sessionId: string): Promise<readonly SkillEntry[]>
  }
  readonly commands: {
    list(sessionId: string): Promise<readonly CommandSummary[]>
    execute(sessionId: string, line: string, signal?: AbortSignal): Promise<JsonValue | null>
  }
  readonly config: {
    describe(): Promise<SettingsDescription>
    mutate(namespace: string, path: readonly string[], value: JsonValue | undefined, revision: number): Promise<SettingsDescription>
  }
}

export class DshPlatformError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'DshPlatformError'
    this.code = code
  }
}

const decode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown): S['Type'] => Schema.decodeUnknownSync(schema)(value)
const decodeResult = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown) => Schema.decodeUnknownResult(schema)(value)

function parseJson(body: string, context: string): JsonValue {
  try {
    return decodeJson(jsonValueSchema, body)
  } catch {
    throw new DshPlatformError('invalid-response', `${context} returned invalid JSON.`)
  }
}

async function streamMessageText(data: RawData): Promise<string> {
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

function decodeJsonValue(value: unknown, context: string): JsonValue {
  const result = decodeResult(jsonValueSchema, value)
  if (Result.isFailure(result)) throw new DshPlatformError('invalid-response', `${context} returned data outside the JSON value contract.`)
  return result.success
}

const loopbackLaunchUrl = (value: string) => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new DshPlatformError('invalid-url', 'Set DSHX_URL to the tokenized DSH launch URL printed by dsh.')
  }
  const loopbackIpv4 = isIPv4(url.hostname) && url.hostname.split('.', 1)[0] === '127'
  const loopbackHost = url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname === '::1' || loopbackIpv4
  if (url.protocol !== 'http:' || !loopbackHost || url.username || url.password) {
    throw new DshPlatformError('unsafe-url', 'DSHX currently accepts only an HTTP launch URL on localhost, 127.0.0.1, or ::1.')
  }
  const token = url.searchParams.get('token')
  if (!token || url.pathname !== '/' || url.hash) {
    throw new DshPlatformError('invalid-url', 'The DSH launch URL must include its root-path token query.')
  }
  return { origin: url.origin, token }
}

function parseSession(value: unknown, archived?: boolean): SessionSummary {
  const parsed = decode(sessionSummarySchema, value)
  const summary = {
    sessionId: parsed.sessionId,
    updatedAt: parsed.updatedAt,
    running: parsed.running,
    blank: parsed.blank,
    agentAvailable: parsed.agentAvailable,
    ...(parsed.parentSessionId !== undefined && { parentSessionId: parsed.parentSessionId }),
    ...(parsed.origin !== undefined && { origin: parsed.origin }),
    ...(parsed.cwd !== undefined && { cwd: parsed.cwd }),
    ...(parsed.projections !== undefined && { projections: parsed.projections }),
  }
  if (archived === undefined) return summary
  return { ...summary, archived }
}

function parsePlugin(value: unknown): PluginSummary {
  const parsed = decode(pluginSchema, value)
  return {
    id: parsed.entryId,
    moduleName: parsed.moduleName,
    ...(parsed.meta !== undefined && { meta: parsed.meta }),
    enabled: parsed.enabled,
    phase: parsed.fiberPhase,
    ...(parsed.readOnlyReason !== undefined && { readOnlyReason: parsed.readOnlyReason }),
  }
}

function parseBundle(value: unknown): BundleSummary {
  const parsed = decode(bundleSchema, value)
  return {
    name: parsed.name,
    ...(parsed.description !== undefined && { description: parsed.description }),
    enabled: parsed.enabled,
    installed: parsed.installed,
    optional: parsed.optional,
    removable: parsed.removable,
    ...(parsed.readOnlyReason !== undefined && { readOnlyReason: parsed.readOnlyReason }),
    ...(parsed.error !== undefined && { error: decodeJsonValue(parsed.error, 'Bundle inventory') }),
    ...(parsed.rows !== undefined && { rowCount: parsed.rows.length }),
  }
}

function parseSettings(value: unknown): SettingsDescription {
  const parsed = decode(settingsDescriptionSchema, value)
  return {
    writable: parsed.writable,
    hasDocument: parsed.hasDocument,
    namespaces: parsed.namespaces.map(item => ({
      ns: item.ns,
      schema: item.schema,
      value: item.value,
      autoGenerate: item.autoGenerate,
      revision: item.revision,
      applies: item.applies,
      secrets: item.secrets,
    })),
  }
}

function parseChangeResult(value: unknown): ChangeResult {
  const parsed = decode(
    Schema.Struct({
      application: Schema.Literals(['applied', 'restart-required', 'overridden', 'failed', 'cancelled']),
      changed: Schema.Boolean,
      enabled: Schema.optional(Schema.Boolean),
      stage: Schema.Literals(['install', 'enable', 'remove']),
      target: Schema.String,
      error: Schema.optional(
        Schema.Struct({
          code: Schema.String,
          diagnostic: Schema.optional(Schema.String),
          incompatible: Schema.optional(jsonValueSchema),
        }),
      ),
      warnings: Schema.optional(Schema.Array(Schema.String)),
    }),
    value,
  )
  return {
    application: parsed.application,
    changed: parsed.changed,
    ...(parsed.enabled !== undefined && { enabled: parsed.enabled }),
    warnings: parsed.warnings ?? [],
    stage: parsed.stage,
    target: parsed.target,
    ...(parsed.error !== undefined && {
      error: {
        code: parsed.error.code,
        ...(parsed.error.diagnostic !== undefined && { diagnostic: parsed.error.diagnostic }),
        ...(parsed.error.incompatible !== undefined && { incompatible: parsed.error.incompatible }),
      },
    }),
  }
}

function parsePluginInspection(value: unknown): PluginInspection {
  const parsed = decode(pluginInspectionSchema, value)
  if (parsed.status === 'refused') {
    return {
      status: parsed.status,
      problem: parsed.problem,
      reason: parsed.reason,
      ...(parsed.registries !== undefined && { registries: parsed.registries }),
    }
  }
  return {
    status: parsed.status,
    kind: parsed.kind,
    bundle: parsed.bundle,
    registry: parsed.registry,
    ...(parsed.name !== undefined && { name: parsed.name }),
    ...(parsed.version !== undefined && { version: parsed.version }),
    ...(parsed.description !== undefined && { description: parsed.description }),
    ...(parsed.host !== undefined && { host: parsed.host }),
  }
}

function mapAgentPresetRow(value: Schema.Schema.Type<typeof agentPresetRowSchema>): AgentPresetRow {
  return {
    id: value.id,
    isDefault: value.isDefault,
    ...(value.name !== undefined && { name: value.name }),
    ...(value.description !== undefined && { description: value.description }),
    ...(value.broken !== undefined && { broken: value.broken }),
  }
}

function parseAgentPresetDocument(value: unknown): AgentPresetDocument {
  const parsed = decode(agentPresetDocumentSchema, value)
  return {
    agentPreset: parsed.agentPreset,
    content: parsed.content,
    ...(parsed.name !== undefined && { name: parsed.name }),
    ...(parsed.description !== undefined && { description: parsed.description }),
  }
}

function parseModelCatalog(value: unknown): ModelCatalog {
  const parsed = decode(modelCatalogSchema, value)
  return {
    default: {
      provider: parsed.default.provider,
      model: parsed.default.model,
      ...(parsed.default.reasoningEffort !== undefined && { reasoningEffort: parsed.default.reasoningEffort }),
    },
    routableProviders: parsed.routableProviders,
    groups: parsed.groups.map(group => ({
      id: group.id,
      name: group.name,
      models: group.models.map(model => ({
        id: model.id,
        name: model.name,
        ...(model.description !== undefined && { description: model.description }),
        ...(model.reasoning !== undefined && {
          reasoning: {
            efforts: model.reasoning.efforts.map(effort => ({
              id: effort.id,
              name: effort.name,
              ...(effort.description !== undefined && { description: effort.description }),
            })),
            ...(model.reasoning.defaultEffort !== undefined && { defaultEffort: model.reasoning.defaultEffort }),
          },
        }),
      })),
    })),
    failures: parsed.failures.map(failure => ({
      id: failure.id,
      name: failure.name,
      message: failure.message,
    })),
  }
}

function parseModelSelection(value: unknown): ModelSelection {
  const parsed = decode(modelSelectionSchema, value)
  return {
    provider: parsed.provider,
    model: parsed.model,
    ...(parsed.reasoningEffort !== undefined && { reasoningEffort: parsed.reasoningEffort }),
  }
}

function mapSkillEntry(value: Schema.Schema.Type<typeof skillEntrySchema>): SkillEntry {
  return {
    name: value.name,
    description: value.description,
    modelInvocable: value.modelInvocable,
    ...(value.path !== undefined && { path: value.path }),
    ...(value.whenToUse !== undefined && { whenToUse: value.whenToUse }),
  }
}

function makeTypedClient(transport: DshPlatformTransport): DshPlatformClient {
  const readSessionList = async (projections?: readonly string[]) => {
    const request = projections === undefined ? {} : { projections: [...projections] }
    return decode(Schema.Struct({ items: Schema.Array(sessionSummarySchema) }), await transport.rpc('session', 'list', { _request: request }))
  }
  const listSessions = async (projections?: readonly string[]): Promise<readonly SessionSummary[]> => {
    const read = async () => {
      try {
        return await readSessionList(projections)
      } catch (error) {
        if (projections === undefined) throw error
        // A Host older than the selector rejects the unknown field; fall back to the historical full read.
        return await readSessionList()
      }
    }
    const result = await read()
    const sessionIds = result.items.map(item => item.sessionId)
    const archivedSessionIds = await transport.archivedSessionIds?.(sessionIds)
    const archivedSessionIdSet = archivedSessionIds === undefined ? undefined : new Set(archivedSessionIds)
    return result.items.map(item => parseSession(item, archivedSessionIdSet?.has(item.sessionId)))
  }

  const page = async (sessionId: string, throughSeq: number, beforeSeq?: number, maxMessages = 100): Promise<SessionPage> => {
    const result = decode(
      Schema.Struct({ records: Schema.Array(jsonValueSchema), hasMore: Schema.Boolean }),
      await transport.rpc('session', 'page', {
        request: {
          address: { kind: 'session', sessionId },
          throughSeq,
          ...(beforeSeq !== undefined && { beforeSeq }),
          maxMessages,
        },
      }),
    )
    return { records: result.records, hasMore: result.hasMore }
  }

  const describe = async (): Promise<SettingsDescription> => parseSettings(await transport.rpc('settings', 'describe', {}))

  const findThreadsFor = async (input: ThreadFinderCallInput): Promise<ThreadFinderAttempt> => (await transport.findThreads?.(input)) ?? { kind: 'absent' }

  return {
    sessions: {
      list: listSessions,
      findThreads: findThreadsFor,
      search: async query => {
        const result = decode(sessionSearchSchema, await transport.rpc('session', 'search', { request: { query } }))
        return { items: result.items, hasMore: result.hasMore }
      },
      create: async input => {
        const parsed = decode(
          Schema.Struct({ sessionId: Schema.String, agentPreset: Schema.optional(Schema.String) }),
          await transport.rpc('session', 'create', { request: input }),
        )
        return parsed.agentPreset === undefined ? { sessionId: parsed.sessionId } : { sessionId: parsed.sessionId, agentPreset: parsed.agentPreset }
      },
      fork: async (sessionId, atSeq) =>
        decode(
          Schema.Struct({ sessionId: Schema.String }),
          await transport.rpc('session', 'fork', { request: { sessionId, ...(atSeq !== undefined && { atSeq }) } }),
        ),
      cancel: async sessionId =>
        decode(Schema.Struct({ accepted: Schema.Literal(true) }), await transport.rpc('session', 'cancel', { request: { sessionId } })),
      rename: async (sessionId, title) =>
        decode(
          Schema.Struct({
            title: Schema.String,
            seq: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
          }),
          await transport.rpc('session', 'rename', { request: { sessionId, title } }),
        ),
      archive: async sessionId => {
        const result = decode(
          Schema.Struct({ archivedSessionIds: Schema.Array(Schema.String) }),
          await transport.rpc('workspace', 'archiveSession', { request: { sessionId } }),
        )
        return { archivedSessionIds: result.archivedSessionIds }
      },
      unarchive: async sessionId => {
        const result = decode(
          Schema.Struct({ archivedSessionIds: Schema.Array(Schema.String) }),
          await transport.rpc('workspace', 'unarchiveSession', { request: { sessionId } }),
        )
        return { archivedSessionIds: result.archivedSessionIds }
      },
      prompt: async (sessionId, text, mode, signal) => {
        const request = {
          requestId: randomUUID(),
          sessionId,
          mode,
          content: [{ type: 'text', text }],
        }
        return decode(Schema.Struct({ accepted: Schema.Literal(true) }), await transport.rpc('session', 'prompt', { request }, signal))
      },
      page,
      history: async (sessionId, maxMessages = 100) => {
        const throughSeq = await transport.sessionCursor(sessionId)
        return page(sessionId, throughSeq, undefined, maxMessages)
      },
      cursor: sessionId => transport.sessionCursor(sessionId),
      export: async (sessionId, range = {}) => {
        const throughSeq = range.throughSeq ?? (await transport.sessionCursor(sessionId))
        const recordSeq = (record: JsonValue): number | undefined => {
          const parsed = decodeResult(historyRecordSchema, record)
          return Result.isSuccess(parsed) ? parsed.success.event.seq : undefined
        }
        const isWanted = (record: JsonValue): boolean => {
          const seq = recordSeq(record)
          if (range.afterSeq !== undefined && seq !== undefined && seq <= range.afterSeq) return false
          return range.keep?.(record) ?? true
        }
        const pages: JsonValue[][] = []
        let collected = 0
        let beforeSeq: number | undefined
        let hasMore = true
        while (hasMore) {
          const current = await page(sessionId, throughSeq, beforeSeq, 250)
          const wanted = current.records.filter(isWanted)
          pages.push(wanted)
          collected += wanted.length
          const oldestSeq = current.records
            .map(recordSeq)
            .reduce<number | undefined>((minimum, value) => (value === undefined || (minimum !== undefined && minimum <= value) ? minimum : value), undefined)
          const reachedAfterSeq = range.afterSeq !== undefined && oldestSeq !== undefined && oldestSeq <= range.afterSeq + 1
          const reachedNewest = range.newest !== undefined && collected >= range.newest
          hasMore = current.hasMore && !reachedAfterSeq && !reachedNewest
          if (hasMore) {
            if (oldestSeq === undefined || oldestSeq === beforeSeq) {
              throw new DshPlatformError('invalid-history-page', 'DSH reported more session history without an earlier event cursor.')
            }
            beforeSeq = oldestSeq
          }
        }
        const records = pages.reverse().flatMap(items => items)
        return range.newest === undefined ? records : records.slice(-range.newest)
      },
    },
    plugins: {
      list: async () => {
        const values = decode(Schema.Array(pluginSchema), await transport.rpc('pluginManager', 'listPlugins', {}))
        return values.map(parsePlugin)
      },
      check: async spec => parsePluginInspection(await transport.rpc('pluginManager', 'inspect', { spec, options: {} })),
      setEnabled: async (id, enabled) => parseChangeResult(await transport.rpc('pluginManager', 'setPluginEnabled', { id, enabled })),
    },
    bundles: {
      list: async () => {
        const values = decode(Schema.Array(bundleSchema), await transport.rpc('pluginManager', 'listBundles', {}))
        return values.map(parseBundle)
      },
      install: async (spec, signal) => {
        if (signal?.aborted) throw new DshPlatformError('cancelled', 'DSH bundle installation was cancelled by the caller.')
        const requestId = randomUUID()
        let cancellation: Promise<unknown> | undefined
        const cancelInstall = (): void => {
          cancellation = transport.rpc('pluginManager', 'cancelInstall', { requestId }).catch(() => undefined)
        }
        signal?.addEventListener('abort', cancelInstall, { once: true })
        try {
          const result = parseChangeResult(await transport.rpc('pluginManager', 'installBundle', { spec, options: { requestId } }))
          if (signal?.aborted && result.application === 'cancelled')
            throw new DshPlatformError('cancelled', 'DSH bundle installation was cancelled and its profile files were restored.')
          return result
        } finally {
          signal?.removeEventListener('abort', cancelInstall)
          if (cancellation !== undefined) await cancellation
        }
      },
      remove: async name => parseChangeResult(await transport.rpc('pluginManager', 'removeBundle', { name })),
      setEnabled: async (name, enabled) => parseChangeResult(await transport.rpc('pluginManager', 'setBundleEnabled', { name, enabled })),
    },
    presets: {
      list: async () => decode(agentPresetRosterSchema, await transport.rpc('agentPresets', 'list', {})).presets.map(mapAgentPresetRow),
      show: async id => parseAgentPresetDocument(await transport.rpc('agentPresets', 'read', { agentPreset: id })),
    },
    models: {
      list: async () => parseModelCatalog(await transport.rpc('session', 'modelCatalog', {})),
      // Never fall back to native session.selectModel: it also saves the selection as the deployment default.
      select: async (sessionId, selection) => {
        const selected = await transport.selectSessionModel?.(sessionId, selection)
        if (selected === undefined)
          throw new DshPlatformError(
            'session-model-unavailable',
            'This DSH does not serve session-only model selection. Enable @dshfiles/session-controller (its thread-model API) in the profile, then retry.',
          )
        return selected
      },
    },
    skills: {
      list: async sessionId => {
        const result = decode(Schema.Struct({ skills: Schema.Array(skillEntrySchema) }), await transport.rpc('skills', 'list', { request: { sessionId } }))
        return result.skills.map(mapSkillEntry)
      },
    },
    commands: {
      list: async sessionId => {
        const values = decode(Schema.Array(commandSchema), await transport.rpc('commands', 'list', { agentId: sessionId }))
        return values.map(item => ({
          ...(item.definitionId !== undefined && { definitionId: item.definitionId }),
          name: item.name,
          description: item.description,
          ...(item.input !== undefined && { input: item.input }),
        }))
      },
      execute: async (sessionId, line, signal) => {
        if (!line.startsWith('/')) throw new DshPlatformError('invalid-command', 'DSH commands must start with / at byte 0.')
        const result = await transport.rpc('commands', 'execute', { agentId: sessionId, line, submittedAttachments: [] }, signal)
        return result === undefined ? null : decodeJsonValue(result, 'Command execution')
      },
    },
    config: {
      describe,
      mutate: async (namespace, path, value, revision) => {
        const op = value === undefined ? { op: 'unset', path: [...path] } : { op: 'set', path: [...path], value }
        await transport.rpc('settings', 'mutate', { ns: namespace, ops: [op], expectedRevision: revision })
        return describe()
      },
    },
  }
}

export function createDshPlatformClientFromTransport(transport: DshPlatformTransport): DshPlatformClient {
  return makeTypedClient(transport)
}

/** The launch URL from options, DSHX_URL, or the one the dsh-web supervisor records for this DSH home. */
const resolveLaunchUrl = (explicit: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined => {
  const configured = explicit ?? env.DSHX_URL
  if (configured !== undefined) return configured
  const dshHome = env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  try {
    const recorded = readFileSync(join(dshHome, 'runtime', 'web-url'), 'utf8').trim()
    return recorded === '' ? undefined : recorded
  } catch {
    return undefined
  }
}

export class DshPlatformLaunchUrl {
  static readonly loopbackLaunchUrl = loopbackLaunchUrl
  static readonly resolveLaunchUrl = resolveLaunchUrl
}

export interface ConnectDshPlatformClientOptions {
  readonly url?: string
  readonly fetch?: typeof fetch
}

export async function connectDshPlatformClient(options: ConnectDshPlatformClientOptions = {}): Promise<DshPlatformClient> {
  const launchUrl = DshPlatformLaunchUrl.resolveLaunchUrl(options.url)
  if (launchUrl === undefined)
    throw new DshPlatformError(
      'missing-url',
      'Set DSHX_URL to the tokenized DSH launch URL printed by dsh, or start DSH with dsh-web so it records one in ~/.dsh/runtime/web-url.',
    )
  const parsed = DshPlatformLaunchUrl.loopbackLaunchUrl(launchUrl)
  const request = options.fetch ?? fetch
  let exchange: Response
  try {
    exchange = await request(`${parsed.origin}/?token=${encodeURIComponent(parsed.token)}`, { redirect: 'manual' })
  } catch {
    throw new DshPlatformError('connection-failed', 'Could not reach the local DSH launch URL. Check that dsh is running and the launch URL is current.')
  }
  const cookies = exchange.headers.getSetCookie()
  const cookie = cookies
    .map(item => item.split(';', 1)[0])
    .filter(Boolean)
    .join('; ')
  if (!exchange.ok && exchange.status !== 302 && exchange.status !== 303) {
    if (exchange.status === 401 || exchange.status === 403)
      throw new DshPlatformError('authentication-failed', 'DSH rejected the launch URL. Copy the current tokenized URL printed by dsh.')
    throw new DshPlatformError('authentication-failed', `DSH launch authentication failed with HTTP ${exchange.status}.`)
  }
  if (!cookie) throw new DshPlatformError('authentication-failed', 'DSH did not issue an authenticated session cookie for the launch URL.')

  const rpc = async (namespace: string, method: string, args: Readonly<Record<string, JsonValue>>, signal?: AbortSignal): Promise<JsonValue> => {
    const rpcId = randomUUID()
    let response: Response
    try {
      response = await request(`${parsed.origin}/api/${encodeURIComponent(namespace)}/${encodeURIComponent(method)}`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          type: 'client-request',
          rpcId,
          method: `${namespace}/${method}`,
          payload: { args },
        }),
        ...(signal !== undefined && { signal }),
      })
    } catch {
      if (signal?.aborted) throw new DshPlatformError('cancelled', 'DSH command request was cancelled by the caller.')
      throw new DshPlatformError('rpc-unreachable', 'The DSH API request failed. Confirm the local Host is running and use its current launch URL.')
    }
    if (response.status === 401) throw new DshPlatformError('authentication-expired', 'The DSH session expired. Copy the current tokenized URL printed by dsh.')
    if (!response.ok) throw new DshPlatformError('rpc-http-error', `DSH API returned HTTP ${response.status} for ${namespace}/${method}.`)
    const envelope = decodeResult(rpcResponseSchema, parseJson(await response.text(), `DSH ${namespace}/${method}`))
    if (Result.isFailure(envelope) || envelope.success.rpcId !== rpcId)
      throw new DshPlatformError('invalid-response', `DSH ${namespace}/${method} returned an invalid RPC response.`)
    if (!envelope.success.result.ok) {
      const remoteError = envelope.success.result.error
      throw new DshPlatformError(remoteError.code ?? 'remote-error', remoteError.message)
    }
    return envelope.success.result.value
  }

  let registryApis: Promise<readonly DshxRegistryApi[]> | undefined
  const loadRegistryApis = async (): Promise<readonly DshxRegistryApi[]> => {
    registryApis ??= (async () => {
      const registryCall = createDshxApiCaller({
        origin: parsed.origin,
        cookie,
        packageId: '@dshfiles/dshx',
        apiId: 'registry',
        version: 1,
        fetch: request,
      })
      const registry = decode(
        Schema.Struct({
          apis: Schema.Array(
            Schema.Struct({
              owner: Schema.String,
              id: Schema.String,
              version: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
              methods: Schema.Array(Schema.Struct({ name: Schema.String })),
            }),
          ),
        }),
        await registryCall('list'),
      )
      return registry.apis.map(api => ({ owner: api.owner, id: api.id, version: api.version, methods: api.methods.map(method => method.name) }))
    })()
    return registryApis
  }

  const pluginApi = async (owner: string, apiId: string, required: readonly string[]): Promise<DshxApiCall | undefined> => {
    const api = (await loadRegistryApis()).find(
      candidate => candidate.owner === owner && candidate.id === apiId && required.every(name => candidate.methods.includes(name)),
    )
    if (api === undefined) return undefined
    return createDshxApiCaller({ origin: parsed.origin, cookie, packageId: api.owner, apiId: api.id, version: api.version, fetch: request })
  }

  const archivedSessionIds = async (sessionIds: readonly string[]): Promise<readonly string[] | undefined> => {
    try {
      const call = await pluginApi('@dshfiles/thread-sidebar', 'thread-sidebar-session-archive', ['status'])
      if (call === undefined) return undefined
      return decode(
        Schema.Struct({
          archivedSessionIds: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))).check(Schema.isMaxLength(10_000)),
        }),
        await call('status', { sessionIds: [...sessionIds] }),
      ).archivedSessionIds
    } catch {
      return undefined
    }
  }

  /**
   * The composed finder when the installed Memory plugin serves it, `absent` when that plugin is older than the
   * finder, and `failed` when it answered with an error the caller should report instead of searching again.
   */
  const findThreads = async (input: ThreadFinderCallInput): Promise<ThreadFinderAttempt> => {
    let call: DshxApiCall | undefined
    try {
      call = await pluginApi('@dshfiles/memory', 'dshfiles-memory', ['findThreads'])
    } catch {
      return { kind: 'absent' }
    }
    if (call === undefined) return { kind: 'absent' }
    try {
      return { kind: 'page', page: decode(threadFinderPageSchema, await call('findThreads', input)) }
    } catch (error) {
      return {
        kind: 'failed',
        error:
          error instanceof DshPlatformError
            ? error
            : new DshPlatformError('finder-failed', error instanceof Error ? error.message : 'The thread finder failed.'),
      }
    }
  }

  const sessionCursor = async (sessionId: string): Promise<number> =>
    new Promise((resolve, reject) => {
      const streamId = randomUUID()
      const url = new URL('/api/remote.mux', parsed.origin)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(url, {
        headers: { cookie, origin: parsed.origin },
      })
      const timeout = setTimeout(() => finish(new DshPlatformError('stream-timeout', 'DSH did not open the session history stream in time.')), 10_000)
      let settled = false
      const finish = (error?: DshPlatformError, cursor?: number): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        socket.removeAllListeners()
        if (socket.readyState === WebSocket.OPEN) {
          if (error === undefined) socket.send(JSON.stringify({ type: 'cancel', streamId }))
          socket.close()
        }
        if (error !== undefined) reject(error)
        else if (cursor !== undefined) resolve(cursor)
        else reject(new DshPlatformError('invalid-response', 'DSH closed the history stream without a snapshot.'))
      }
      socket.once('open', () => {
        socket.send(
          JSON.stringify({
            type: 'open',
            streamId,
            endpoint: 'session/follow',
            payload: {
              args: { request: { address: { kind: 'session', sessionId }, maxMessages: 1 } },
            },
          }),
        )
      })
      socket.on('message', data => {
        void streamMessageText(data)
          .then(body => {
            let response: unknown
            try {
              response = parseJson(body, 'DSH session stream')
            } catch {
              finish(new DshPlatformError('invalid-response', 'DSH sent invalid JSON on the session history stream.'))
              return
            }
            const frame = decodeResult(streamFrameSchema, response)
            if (Result.isFailure(frame) || frame.success.streamId !== streamId) {
              finish(new DshPlatformError('invalid-response', 'DSH sent an invalid session history frame.'))
              return
            }
            if (frame.success.type === 'error') {
              finish(new DshPlatformError(frame.success.error?.code ?? 'stream-error', frame.success.error?.message ?? 'DSH session history stream failed.'))
              return
            }
            if (frame.success.type === 'end') {
              finish(new DshPlatformError('invalid-response', 'DSH closed the history stream before sending its snapshot.'))
              return
            }
            const snapshot = decodeResult(snapshotSchema, frame.success.value)
            if (Result.isFailure(snapshot)) {
              finish(new DshPlatformError('invalid-response', 'DSH session history stream did not begin with a snapshot.'))
              return
            }
            finish(undefined, snapshot.success.cursor)
          })
          .catch(() => finish(new DshPlatformError('invalid-response', 'Could not read the DSH session history frame.')))
      })
      socket.once('error', () =>
        finish(new DshPlatformError('stream-unreachable', 'Could not open DSH session history. Confirm that the DSH Host is running.')),
      )
      socket.once('close', () => finish(new DshPlatformError('stream-closed', 'DSH closed the session history stream before it returned a cursor.')))
    })

  const selectSessionModel = async (sessionId: string, selection: ModelSelection): Promise<ModelSelection | undefined> => {
    let call: DshxApiCall | undefined
    try {
      call = await pluginApi('@dshfiles/session-controller', 'thread-model', ['snapshot', 'select'])
    } catch (error) {
      if (error instanceof DshPlatformError && error.code === 'api-not-served') return undefined
      throw error
    }
    if (call === undefined) return undefined
    const current = decode(threadModelSnapshotSchema, await call('snapshot', { sessionId }))
    const selected = decode(
      threadModelSnapshotSchema,
      await call('select', {
        sessionId,
        selection: {
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort !== undefined && { reasoningEffort: selection.reasoningEffort }),
        },
        expectedRevision: current.revision,
        preferSelectedProvider: current.preferSelectedProvider,
      }),
    )
    return parseModelSelection(selected.selection)
  }

  return makeTypedClient({ rpc, sessionCursor, archivedSessionIds, findThreads, selectSessionModel })
}
