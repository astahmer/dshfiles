import { randomUUID } from 'node:crypto'
import { isIPv4 } from 'node:net'
import type { SessionRuntimeSelection } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import WebSocket, { type RawData } from 'ws'

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
)

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

const sessionAttentionSummarySchema = z.object({
  lastPromptSeq: z.number().int().nullable(),
  readThroughSeq: z.number().int(),
  snoozed: z.boolean(),
  unread: z.boolean(),
})
export type SessionAttentionSummary = z.infer<typeof sessionAttentionSummarySchema>
const sessionAttentionActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mark-read') }),
  z.object({ type: z.literal('set-snoozed'), snoozed: z.boolean() }),
])
export type SessionAttentionAction = z.infer<typeof sessionAttentionActionSchema>

export interface SessionAttentionUpdateRequest {
  readonly sessionId: string
  readonly action: SessionAttentionAction
}

const sessionSummarySchema = z.object({
  agentAvailable: z.boolean(),
  sessionId: z.string(),
  updatedAt: z.number(),
  running: z.boolean(),
  blank: z.boolean(),
  parentSessionId: z.string().optional(),
  origin: z.enum(['subagent']).optional(),
  cwd: z.string().optional(),
  projections: jsonValueSchema.optional(),
  attention: sessionAttentionSummarySchema.nullable().optional(),
})

const sessionSearchItemSchema = z.object({
  sessionId: z.string(),
  snippet: z.string(),
})
const sessionSearchSchema = z.object({
  items: z.array(sessionSearchItemSchema),
  hasMore: z.boolean(),
})

const agentPresetRowSchema = z.object({
  id: z.string(),
  isDefault: z.boolean(),
  name: z.string().optional(),
  description: z.string().optional(),
  broken: z.string().optional(),
})
const agentPresetRosterSchema = z.object({
  presets: z.array(agentPresetRowSchema),
})
const agentPresetDocumentSchema = z.object({
  agentPreset: z.string(),
  content: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
})

const modelSelectionSchema = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string().optional(),
})
const modelCatalogSchema = z.object({
  default: modelSelectionSchema,
  routableProviders: z.array(z.string()),
  groups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      models: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().optional(),
          reasoning: z
            .object({
              efforts: z.array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                  description: z.string().optional(),
                }),
              ),
              defaultEffort: z.string().optional(),
            })
            .optional(),
        }),
      ),
    }),
  ),
  failures: z.array(z.object({ id: z.string(), name: z.string(), message: z.string() })),
})

const skillEntrySchema = z.object({
  path: z.string().optional(),
  name: z.string(),
  description: z.string(),
  whenToUse: z.string().optional(),
  modelInvocable: z.boolean(),
})

const pluginInspectionSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('accepted'),
    kind: z.enum(['registry', 'path', 'git', 'tarball']),
    name: z.string().optional(),
    version: z.string().optional(),
    description: z.string().optional(),
    bundle: z.union([z.boolean(), z.null()]),
    registry: z.union([z.string(), z.null()]),
    host: z.string().optional(),
  }),
  z.object({
    status: z.literal('refused'),
    problem: z.enum(['invalid-spec', 'already-installed', 'not-found', 'not-a-package', 'not-a-bundle', 'network', 'unknown']),
    reason: z.string(),
    registries: z.array(z.union([z.string(), z.null()])).optional(),
  }),
])

const pluginSchema = z.object({
  entryId: z.string(),
  moduleName: z.string(),
  meta: jsonValueSchema.optional(),
  enabled: z.boolean(),
  fiberPhase: z.enum(['pending', 'loading', 'active', 'failed', 'unloading']).nullable(),
  readOnlyReason: z.string().optional(),
})

const bundleSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  enabled: z.boolean(),
  installed: z.boolean(),
  optional: z.boolean(),
  removable: z.boolean(),
  readOnlyReason: z.enum(['management-required', 'unaddressable']).optional(),
  error: z.unknown().optional(),
  rows: z.array(
    z.object({
      rowId: z.string(),
      moduleName: z.string(),
      entryId: z.string().optional(),
    }),
  ),
  overrides: z.array(z.string()),
})

const commandInputSchema = z.object({
  hint: z.string(),
  attachments: z.boolean().optional(),
})

const commandSchema = z.object({
  definitionId: z.string().optional(),
  name: z.string(),
  description: z.string(),
  input: commandInputSchema.optional(),
})

const settingsNamespaceSchema = z.object({
  ns: z.string(),
  schema: jsonValueSchema,
  value: jsonValueSchema,
  autoGenerate: z.boolean(),
  revision: z.number().safe().nonnegative(),
  applies: z.literal('live'),
  secrets: z.array(z.object({ path: z.array(z.string()), set: z.boolean() })),
})

const settingsDescriptionSchema = z.object({
  writable: z.boolean(),
  hasDocument: z.boolean(),
  namespaces: z.array(settingsNamespaceSchema),
})

const rpcResponseSchema = z.object({
  type: z.literal('server-response'),
  rpcId: z.string(),
  result: z.union([
    z.object({ ok: z.literal(true), value: z.unknown() }),
    z.object({
      ok: z.literal(false),
      error: z.object({
        code: z.string().optional(),
        message: z.string(),
        details: z.unknown().optional(),
      }),
    }),
  ]),
})

const streamFrameSchema = z.object({
  type: z.enum(['item', 'error', 'end']),
  streamId: z.string(),
  value: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
})

const snapshotSchema = z.object({
  type: z.literal('snapshot'),
  cursor: z.number().safe().min(-1),
})

const historyRecordSchema = z
  .object({
    type: z.literal('event'),
    event: z.object({ seq: z.number().safe().nonnegative() }).passthrough(),
  })
  .passthrough()

export interface SessionSummary {
  readonly sessionId: string
  readonly updatedAt: number
  readonly running: boolean
  readonly blank: boolean
  readonly agentAvailable: boolean
  readonly parentSessionId?: string
  readonly origin?: 'subagent'
  readonly cwd?: string
  readonly projections?: JsonValue
  readonly attention?: SessionAttentionSummary | null
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
  rpc(namespace: string, method: string, args: Readonly<Record<string, JsonValue>>, signal?: AbortSignal): Promise<unknown>
  sessionCursor(sessionId: string): Promise<number>
}

export interface DshPlatformClient {
  readonly sessions: {
    list(): Promise<readonly SessionSummary[]>
    updateAttention(sessionId: string, action: SessionAttentionAction, signal?: AbortSignal): Promise<SessionAttentionSummary>
    updateAttention(request: SessionAttentionUpdateRequest): Promise<SessionAttentionSummary>
    search(query: string): Promise<{
      readonly items: readonly SessionSearchItem[]
      readonly hasMore: boolean
    }>
    create(input: {
      readonly cwd?: string
      readonly agentPreset?: string
      readonly runtimeBinding?: SessionRuntimeSelection
    }): Promise<{ readonly sessionId: string; readonly agentPreset?: string }>
    fork(sessionId: string, atSeq?: number): Promise<{ readonly sessionId: string }>
    cancel(sessionId: string): Promise<{ readonly accepted: true }>
    rename(sessionId: string, title: string): Promise<{ readonly title: string; readonly seq: number }>
    archive(sessionId: string): Promise<{ readonly archivedSessionIds: readonly string[] }>
    unarchive(sessionId: string): Promise<{ readonly archivedSessionIds: readonly string[] }>
    prompt(sessionId: string, text: string, mode: 'queue' | 'steer', signal?: AbortSignal): Promise<{ readonly accepted: true }>
    page(sessionId: string, throughSeq: number, beforeSeq?: number, maxMessages?: number): Promise<SessionPage>
    history(sessionId: string, maxMessages?: number): Promise<SessionPage>
    export(sessionId: string): Promise<readonly JsonValue[]>
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

function parseJson(body: string, context: string): unknown {
  try {
    return JSON.parse(body)
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
  const result = jsonValueSchema.safeParse(value)
  if (!result.success) throw new DshPlatformError('invalid-response', `${context} returned data outside the JSON value contract.`)
  return result.data
}

export function loopbackLaunchUrl(value: string): {
  readonly origin: string
  readonly token: string
} {
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

function mapSession(value: unknown): SessionSummary {
  const parsed = sessionSummarySchema.parse(value)
  return {
    sessionId: parsed.sessionId,
    updatedAt: parsed.updatedAt,
    running: parsed.running,
    blank: parsed.blank,
    agentAvailable: parsed.agentAvailable,
    ...(parsed.parentSessionId === undefined ? {} : { parentSessionId: parsed.parentSessionId }),
    ...(parsed.origin === undefined ? {} : { origin: parsed.origin }),
    ...(parsed.cwd === undefined ? {} : { cwd: parsed.cwd }),
    ...(parsed.projections === undefined ? {} : { projections: parsed.projections }),
    ...(parsed.attention === undefined ? {} : { attention: parsed.attention }),
  }
}

function mapPlugin(value: unknown): PluginSummary {
  const parsed = pluginSchema.parse(value)
  return {
    id: parsed.entryId,
    moduleName: parsed.moduleName,
    ...(parsed.meta === undefined ? {} : { meta: parsed.meta }),
    enabled: parsed.enabled,
    phase: parsed.fiberPhase,
    ...(parsed.readOnlyReason === undefined ? {} : { readOnlyReason: parsed.readOnlyReason }),
  }
}

function mapBundle(value: unknown): BundleSummary {
  const parsed = bundleSchema.parse(value)
  return {
    name: parsed.name,
    ...(parsed.description === undefined ? {} : { description: parsed.description }),
    enabled: parsed.enabled,
    installed: parsed.installed,
    optional: parsed.optional,
    removable: parsed.removable,
    ...(parsed.readOnlyReason === undefined ? {} : { readOnlyReason: parsed.readOnlyReason }),
    ...(parsed.error === undefined ? {} : { error: decodeJsonValue(parsed.error, 'Bundle inventory') }),
    ...(parsed.rows === undefined ? {} : { rowCount: parsed.rows.length }),
  }
}

function mapSettings(value: unknown): SettingsDescription {
  const parsed = settingsDescriptionSchema.parse(value)
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

function mapChangeResult(value: unknown): ChangeResult {
  const parsed = z
    .object({
      application: z.enum(['applied', 'restart-required', 'overridden', 'failed', 'cancelled']),
      changed: z.boolean(),
      enabled: z.boolean().optional(),
      stage: z.enum(['install', 'enable', 'remove']),
      target: z.string(),
      error: z
        .object({
          code: z.string(),
          diagnostic: z.string().optional(),
          incompatible: jsonValueSchema.optional(),
        })
        .optional(),
      warnings: z.array(z.string()).optional(),
    })
    .parse(value)
  return {
    application: parsed.application,
    changed: parsed.changed,
    ...(parsed.enabled === undefined ? {} : { enabled: parsed.enabled }),
    warnings: parsed.warnings ?? [],
    stage: parsed.stage,
    target: parsed.target,
    ...(parsed.error === undefined
      ? {}
      : {
          error: {
            code: parsed.error.code,
            ...(parsed.error.diagnostic === undefined ? {} : { diagnostic: parsed.error.diagnostic }),
            ...(parsed.error.incompatible === undefined ? {} : { incompatible: parsed.error.incompatible }),
          },
        }),
  }
}

function mapPluginInspection(value: unknown): PluginInspection {
  const parsed = pluginInspectionSchema.parse(value)
  if (parsed.status === 'refused') {
    return {
      status: parsed.status,
      problem: parsed.problem,
      reason: parsed.reason,
      ...(parsed.registries === undefined ? {} : { registries: parsed.registries }),
    }
  }
  return {
    status: parsed.status,
    kind: parsed.kind,
    bundle: parsed.bundle,
    registry: parsed.registry,
    ...(parsed.name === undefined ? {} : { name: parsed.name }),
    ...(parsed.version === undefined ? {} : { version: parsed.version }),
    ...(parsed.description === undefined ? {} : { description: parsed.description }),
    ...(parsed.host === undefined ? {} : { host: parsed.host }),
  }
}

function mapAgentPresetRow(value: z.infer<typeof agentPresetRowSchema>): AgentPresetRow {
  return {
    id: value.id,
    isDefault: value.isDefault,
    ...(value.name === undefined ? {} : { name: value.name }),
    ...(value.description === undefined ? {} : { description: value.description }),
    ...(value.broken === undefined ? {} : { broken: value.broken }),
  }
}

function mapAgentPresetDocument(value: unknown): AgentPresetDocument {
  const parsed = agentPresetDocumentSchema.parse(value)
  return {
    agentPreset: parsed.agentPreset,
    content: parsed.content,
    ...(parsed.name === undefined ? {} : { name: parsed.name }),
    ...(parsed.description === undefined ? {} : { description: parsed.description }),
  }
}

function mapModelCatalog(value: unknown): ModelCatalog {
  const parsed = modelCatalogSchema.parse(value)
  return {
    default: {
      provider: parsed.default.provider,
      model: parsed.default.model,
      ...(parsed.default.reasoningEffort === undefined ? {} : { reasoningEffort: parsed.default.reasoningEffort }),
    },
    routableProviders: parsed.routableProviders,
    groups: parsed.groups.map(group => ({
      id: group.id,
      name: group.name,
      models: group.models.map(model => ({
        id: model.id,
        name: model.name,
        ...(model.description === undefined ? {} : { description: model.description }),
        ...(model.reasoning === undefined
          ? {}
          : {
              reasoning: {
                efforts: model.reasoning.efforts.map(effort => ({
                  id: effort.id,
                  name: effort.name,
                  ...(effort.description === undefined ? {} : { description: effort.description }),
                })),
                ...(model.reasoning.defaultEffort === undefined ? {} : { defaultEffort: model.reasoning.defaultEffort }),
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

function mapModelSelection(value: unknown): ModelSelection {
  const parsed = modelSelectionSchema.parse(value)
  return {
    provider: parsed.provider,
    model: parsed.model,
    ...(parsed.reasoningEffort === undefined ? {} : { reasoningEffort: parsed.reasoningEffort }),
  }
}

function mapSkillEntry(value: z.infer<typeof skillEntrySchema>): SkillEntry {
  return {
    name: value.name,
    description: value.description,
    modelInvocable: value.modelInvocable,
    ...(value.path === undefined ? {} : { path: value.path }),
    ...(value.whenToUse === undefined ? {} : { whenToUse: value.whenToUse }),
  }
}

function makeTypedClient(transport: DshPlatformTransport): DshPlatformClient {
  const listSessions = async (): Promise<readonly SessionSummary[]> => {
    const result = z.object({ items: z.array(sessionSummarySchema) }).parse(await transport.rpc('session', 'list', { _request: {} }))
    return result.items.map(mapSession)
  }

  const page = async (sessionId: string, throughSeq: number, beforeSeq?: number, maxMessages = 100): Promise<SessionPage> => {
    const result = z.object({ records: z.array(jsonValueSchema), hasMore: z.boolean() }).parse(
      await transport.rpc('session', 'page', {
        request: {
          address: { kind: 'session', sessionId },
          throughSeq,
          ...(beforeSeq === undefined ? {} : { beforeSeq }),
          maxMessages,
        },
      }),
    )
    return { records: result.records, hasMore: result.hasMore }
  }

  const describe = async (): Promise<SettingsDescription> => mapSettings(await transport.rpc('settings', 'describe', {}))

  return {
    sessions: {
      list: listSessions,
      updateAttention: async (sessionId: string | SessionAttentionUpdateRequest, action?: SessionAttentionAction, signal?: AbortSignal) => {
        const request = z
          .object({
            sessionId: z.string().min(1),
            action: sessionAttentionActionSchema,
          })
          .parse(typeof sessionId === 'string' ? { sessionId, action } : sessionId)
        return sessionAttentionSummarySchema.parse(await transport.rpc('session', 'updateAttention', { request }, signal))
      },
      search: async query => {
        const result = sessionSearchSchema.parse(await transport.rpc('session', 'search', { request: { query } }))
        return { items: result.items, hasMore: result.hasMore }
      },
      create: async input => {
        const parsed = z
          .object({ sessionId: z.string(), agentPreset: z.string().optional() })
          .parse(await transport.rpc('session', 'create', { request: input }))
        return parsed.agentPreset === undefined ? { sessionId: parsed.sessionId } : { sessionId: parsed.sessionId, agentPreset: parsed.agentPreset }
      },
      fork: async (sessionId, atSeq) =>
        z
          .object({ sessionId: z.string() })
          .parse(await transport.rpc('session', 'fork', { request: { sessionId, ...(atSeq === undefined ? {} : { atSeq }) } })),
      cancel: async sessionId => z.object({ accepted: z.literal(true) }).parse(await transport.rpc('session', 'cancel', { request: { sessionId } })),
      rename: async (sessionId, title) =>
        z
          .object({ title: z.string(), seq: z.number().safe().nonnegative() })
          .parse(await transport.rpc('session', 'rename', { request: { sessionId, title } })),
      archive: async sessionId => {
        const result = z
          .object({ archivedSessionIds: z.array(z.string()) })
          .parse(await transport.rpc('workspace', 'archiveSession', { request: { sessionId } }))
        return { archivedSessionIds: result.archivedSessionIds }
      },
      unarchive: async sessionId => {
        const result = z
          .object({ archivedSessionIds: z.array(z.string()) })
          .parse(await transport.rpc('workspace', 'unarchiveSession', { request: { sessionId } }))
        return { archivedSessionIds: result.archivedSessionIds }
      },
      prompt: async (sessionId, text, mode, signal) => {
        const request = {
          requestId: randomUUID(),
          sessionId,
          mode,
          content: [{ type: 'text', text }],
        }
        return z.object({ accepted: z.literal(true) }).parse(await transport.rpc('session', 'prompt', { request }, signal))
      },
      page,
      history: async (sessionId, maxMessages = 100) => {
        const throughSeq = await transport.sessionCursor(sessionId)
        return page(sessionId, throughSeq, undefined, maxMessages)
      },
      export: async sessionId => {
        const throughSeq = await transport.sessionCursor(sessionId)
        const pages: JsonValue[][] = []
        let beforeSeq: number | undefined
        let hasMore = true
        while (hasMore) {
          const current = await page(sessionId, throughSeq, beforeSeq, 250)
          pages.push([...current.records])
          hasMore = current.hasMore
          if (hasMore) {
            const sequenceValues = current.records
              .map(record => historyRecordSchema.safeParse(record))
              .flatMap(result => (result.success ? [result.data.event.seq] : []))
            const nextBeforeSeq = sequenceValues.reduce<number | undefined>(
              (minimum, value) => (minimum === undefined || value < minimum ? value : minimum),
              undefined,
            )
            if (nextBeforeSeq === undefined || nextBeforeSeq === beforeSeq) {
              throw new DshPlatformError('invalid-history-page', 'DSH reported more session history without an earlier event cursor.')
            }
            beforeSeq = nextBeforeSeq
          }
        }
        return pages.reverse().flatMap(items => items)
      },
    },
    plugins: {
      list: async () => {
        const values = z.array(pluginSchema).parse(await transport.rpc('pluginManager', 'listPlugins', {}))
        return values.map(mapPlugin)
      },
      check: async spec => mapPluginInspection(await transport.rpc('pluginManager', 'inspect', { spec, options: {} })),
      setEnabled: async (id, enabled) => mapChangeResult(await transport.rpc('pluginManager', 'setPluginEnabled', { id, enabled })),
    },
    bundles: {
      list: async () => {
        const values = z.array(bundleSchema).parse(await transport.rpc('pluginManager', 'listBundles', {}))
        return values.map(mapBundle)
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
          const result = mapChangeResult(await transport.rpc('pluginManager', 'installBundle', { spec, options: { requestId } }))
          if (signal?.aborted && result.application === 'cancelled')
            throw new DshPlatformError('cancelled', 'DSH bundle installation was cancelled and its profile files were restored.')
          return result
        } finally {
          signal?.removeEventListener('abort', cancelInstall)
          if (cancellation !== undefined) await cancellation
        }
      },
      remove: async name => mapChangeResult(await transport.rpc('pluginManager', 'removeBundle', { name })),
      setEnabled: async (name, enabled) => mapChangeResult(await transport.rpc('pluginManager', 'setBundleEnabled', { name, enabled })),
    },
    presets: {
      list: async () => agentPresetRosterSchema.parse(await transport.rpc('agentPresets', 'list', {})).presets.map(mapAgentPresetRow),
      show: async id => mapAgentPresetDocument(await transport.rpc('agentPresets', 'read', { agentPreset: id })),
    },
    models: {
      list: async () => mapModelCatalog(await transport.rpc('session', 'modelCatalog', {})),
      select: async (sessionId, selection) => {
        const request = { sessionId, ...selection }
        const result = z.object({ selected: modelSelectionSchema }).parse(await transport.rpc('session', 'selectModel', { request }))
        return mapModelSelection(result.selected)
      },
    },
    skills: {
      list: async sessionId => {
        const result = z.object({ skills: z.array(skillEntrySchema) }).parse(await transport.rpc('skills', 'list', { request: { sessionId } }))
        return result.skills.map(mapSkillEntry)
      },
    },
    commands: {
      list: async sessionId => {
        const values = z.array(commandSchema).parse(await transport.rpc('commands', 'list', { agentId: sessionId }))
        return values.map(item => ({
          ...(item.definitionId === undefined ? {} : { definitionId: item.definitionId }),
          name: item.name,
          description: item.description,
          ...(item.input === undefined ? {} : { input: item.input }),
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

export interface ConnectDshPlatformClientOptions {
  readonly url?: string
  readonly fetch?: typeof fetch
}

export async function connectDshPlatformClient(options: ConnectDshPlatformClientOptions = {}): Promise<DshPlatformClient> {
  const launchUrl = options.url ?? process.env.DSHX_URL
  if (launchUrl === undefined) throw new DshPlatformError('missing-url', 'Set DSHX_URL to the tokenized DSH launch URL printed by dsh.')
  const parsed = loopbackLaunchUrl(launchUrl)
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

  const rpc = async (namespace: string, method: string, args: Readonly<Record<string, JsonValue>>, signal?: AbortSignal): Promise<unknown> => {
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
        ...(signal === undefined ? {} : { signal }),
      })
    } catch {
      if (signal?.aborted) throw new DshPlatformError('cancelled', 'DSH command request was cancelled by the caller.')
      throw new DshPlatformError('rpc-unreachable', 'The DSH API request failed. Confirm the local Host is running and use its current launch URL.')
    }
    if (response.status === 401) throw new DshPlatformError('authentication-expired', 'The DSH session expired. Copy the current tokenized URL printed by dsh.')
    if (!response.ok) throw new DshPlatformError('rpc-http-error', `DSH API returned HTTP ${response.status} for ${namespace}/${method}.`)
    const envelope = rpcResponseSchema.safeParse(parseJson(await response.text(), `DSH ${namespace}/${method}`))
    if (!envelope.success || envelope.data.rpcId !== rpcId)
      throw new DshPlatformError('invalid-response', `DSH ${namespace}/${method} returned an invalid RPC response.`)
    if (!envelope.data.result.ok) {
      const remoteError = envelope.data.result.error
      throw new DshPlatformError(remoteError.code ?? 'remote-error', remoteError.message)
    }
    return envelope.data.result.value
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
            const frame = streamFrameSchema.safeParse(response)
            if (!frame.success || frame.data.streamId !== streamId) {
              finish(new DshPlatformError('invalid-response', 'DSH sent an invalid session history frame.'))
              return
            }
            if (frame.data.type === 'error') {
              finish(new DshPlatformError(frame.data.error?.code ?? 'stream-error', frame.data.error?.message ?? 'DSH session history stream failed.'))
              return
            }
            if (frame.data.type === 'end') {
              finish(new DshPlatformError('invalid-response', 'DSH closed the history stream before sending its snapshot.'))
              return
            }
            const snapshot = snapshotSchema.safeParse(frame.data.value)
            if (!snapshot.success) {
              finish(new DshPlatformError('invalid-response', 'DSH session history stream did not begin with a snapshot.'))
              return
            }
            finish(undefined, snapshot.data.cursor)
          })
          .catch(() => finish(new DshPlatformError('invalid-response', 'Could not read the DSH session history frame.')))
      })
      socket.once('error', () =>
        finish(new DshPlatformError('stream-unreachable', 'Could not open DSH session history. Confirm that the DSH Host is running.')),
      )
      socket.once('close', () => finish(new DshPlatformError('stream-closed', 'DSH closed the session history stream before it returned a cursor.')))
    })

  return makeTypedClient({ rpc, sessionCursor })
}
