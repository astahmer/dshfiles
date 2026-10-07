import { randomUUID, createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import { JsonLineTransportError, requestJsonLine } from '../bridge/json-line.js'
import { DshxError } from '../diagnostics.js'
import type { DshxDiagnostic } from '../diagnostics.js'
import type { ResolvedDshxConfig } from '../config/types.js'
import type { InspectProvider, InspectSlotOptions, ServiceSummary, EventSummary, SlotSummary, ToolSummary } from './types.js'

const PROTOCOL_VERSION = 1
const MAX_MESSAGE_BYTES = 64 * 1024
const DEFAULT_TIMEOUT_MS = 10_000

const absolutePathSchema = z.string().refine(isAbsolute)

const bridgeEndpointSchema = z.looseObject({
  version: z.literal(PROTOCOL_VERSION),
  packageId: z.string(),
  root: absolutePathSchema,
  pid: z.int(),
  socketPath: absolutePathSchema,
})

const bridgeCredentialsSchema = z.object({
  version: z.literal(PROTOCOL_VERSION),
  packageId: z.string(),
  root: z.string(),
  pid: z.int(),
  socketPath: z.string(),
  token: z.string().min(1),
})

const bridgeResponseHeaderSchema = z.object({
  version: z.literal(PROTOCOL_VERSION),
  requestId: z.string(),
  target: z.string(),
  ok: z.boolean(),
})

const bridgeErrorResponseSchema = z.object({
  error: z.object({
    code: z.enum(['DSHX3201', 'DSHX3202', 'DSHX3203', 'DSHX3204', 'DSHX3205']),
    message: z.string(),
  }),
})

const optionalStringSchema = z.string().exactOptional()
const itemMetadataSchema = z.record(z.string(), z.unknown()).exactOptional()
const itemNameSchema = z.string().trim().min(1)

const slotItemsSchema = z.array(
  z.looseObject({
    name: itemNameSchema,
    type: z.enum(['slot', 'factory']).exactOptional(),
    provider: optionalStringSchema,
    kind: optionalStringSchema,
    scope: optionalStringSchema,
    metadata: itemMetadataSchema,
  }),
)
const serviceItemsSchema = z.array(
  z.looseObject({ name: itemNameSchema, provider: optionalStringSchema, scope: optionalStringSchema, metadata: itemMetadataSchema }),
)
const eventItemsSchema = z.array(z.looseObject({ name: itemNameSchema, provider: optionalStringSchema, metadata: itemMetadataSchema }))

type BridgeCredentials = z.infer<typeof bridgeCredentialsSchema>

const bridgeRetryHint = 'Restart the Composition and retry the Inspect command.'

const decodeBridgeResponse = <Item>({
  value,
  requestId,
  target,
  itemsSchema,
}: {
  readonly value: unknown
  readonly requestId: string
  readonly target: string
  readonly itemsSchema: z.ZodType<readonly Item[]>
}): readonly Item[] => {
  const header = bridgeResponseHeaderSchema.safeParse(value)
  if (!header.success || header.data.requestId !== requestId || header.data.target !== target) {
    throw fail('DSHX3203', 'Host Inspect bridge response has an invalid protocol header.', bridgeRetryHint)
  }
  if (!header.data.ok) {
    const failure = bridgeErrorResponseSchema.safeParse(value)
    if (!failure.success) throw fail('DSHX3203', 'Host Inspect bridge returned an invalid error response.', bridgeRetryHint)
    throw fail(failure.data.error.code, failure.data.error.message, 'Inspect the running Composition and retry the command.')
  }
  const items = z.object({ items: itemsSchema }).safeParse(value)
  if (!items.success) {
    throw fail('DSHX3203', `Host Inspect bridge returned an invalid ${target} item list: ${z.prettifyError(items.error)}`, bridgeRetryHint)
  }
  return items.data.items
}

export interface DshInspectBridgeProviderOptions {
  readonly env?: Readonly<NodeJS.ProcessEnv>
  readonly timeoutMs?: number
}

export type InspectBridgeState = 'disabled' | 'running' | 'stale' | 'invalid' | 'unavailable'

export interface InspectBridgeStatus {
  readonly state: InspectBridgeState
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly diagnostics: readonly DshxDiagnostic[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function bridgeName(packageId: string): string {
  return createHash('sha256').update(packageId).digest('hex').slice(0, 20)
}

function endpointPaths(packageId: string, env: Readonly<NodeJS.ProcessEnv>): { metadataPath: string; socketPath: string } {
  const dshHome = env.DSH_HOME?.trim() ? resolve(env.DSH_HOME.trim()) : join(homedir(), '.dsh')
  const directory = join(dshHome, 'runtime', 'dshx', 'inspect')
  const name = bridgeName(packageId)
  const regularSocket = join(directory, `${name}.sock`)
  const socketPath =
    regularSocket.length > 90 ? join(tmpdir(), `dshx-${createHash('sha256').update(`${dshHome}:${packageId}`).digest('hex').slice(0, 24)}.sock`) : regularSocket
  return { metadataPath: join(directory, `${name}.json`), socketPath }
}

function fail(code: 'DSHX3201' | 'DSHX3202' | 'DSHX3203' | 'DSHX3204' | 'DSHX3205', message: string, hint: string): DshxError {
  return new DshxError(code, message, { hint })
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

function publicMetadata(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const { token: _token, ...safe } = value
  return safe
}

/** Read the local Host bridge state without connecting to or starting DSH. */
export async function inspectBridgeStatus(project: ResolvedDshxConfig, options: DshInspectBridgeProviderOptions = {}): Promise<InspectBridgeStatus> {
  const env = { ...process.env, ...options.env }
  const paths = endpointPaths(project.packageId, env)
  let text: string
  try {
    text = await readFile(paths.metadataPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'disabled', diagnostics: [] }
    return {
      state: 'invalid',
      diagnostics: [
        {
          code: 'DSHX5103',
          severity: 'warning',
          message: `Unable to read the Host Inspect bridge metadata: ${String(error)}`,
          file: project.packageFile,
          hint: 'Remove the stale bridge metadata or restart the DSH Composition with dshx dev.',
        },
      ],
    }
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return {
      state: 'invalid',
      diagnostics: [
        {
          code: 'DSHX5103',
          severity: 'warning',
          message: `Host Inspect bridge metadata is not valid JSON: ${String(error)}`,
          file: project.packageFile,
          hint: 'Restart the DSH Composition so DSHX can recreate its bridge metadata.',
        },
      ],
    }
  }
  const parsed = bridgeEndpointSchema.safeParse(value)
  if (!parsed.success) {
    return {
      state: 'invalid',
      diagnostics: [
        {
          code: 'DSHX5103',
          severity: 'warning',
          message: 'Host Inspect bridge metadata is invalid.',
          file: project.packageFile,
          hint: 'Restart the DSH Composition so DSHX can recreate its bridge metadata.',
        },
      ],
    }
  }
  const endpoint = parsed.data
  if (
    endpoint.packageId !== project.packageId ||
    resolve(endpoint.root) !== resolve(project.root) ||
    resolve(endpoint.socketPath) !== resolve(paths.socketPath)
  ) {
    return {
      state: 'invalid',
      diagnostics: [
        {
          code: 'DSHX5103',
          severity: 'warning',
          message: 'Host Inspect bridge metadata does not belong to this project.',
          file: project.packageFile,
          hint: 'Close stale DSH processes and restart the project from its configured root.',
        },
      ],
    }
  }
  if (!processAlive(endpoint.pid)) {
    return {
      state: 'stale',
      metadata: publicMetadata(endpoint),
      diagnostics: [
        {
          code: 'DSHX5103',
          severity: 'warning',
          message: 'The Host Inspect bridge belongs to an exited Composition.',
          file: project.packageFile,
          hint: 'Restart the project with dshx dev before using runtime Inspect.',
        },
      ],
    }
  }
  try {
    await access(endpoint.socketPath)
  } catch {
    return {
      state: 'stale',
      metadata: publicMetadata(endpoint),
      diagnostics: [
        {
          code: 'DSHX5103',
          severity: 'warning',
          message: 'The Host Inspect bridge socket is missing.',
          file: project.packageFile,
          hint: 'Restart the project with dshx dev before using runtime Inspect.',
        },
      ],
    }
  }
  const runtimePlugins = Array.isArray(endpoint.runtimePlugins) ? endpoint.runtimePlugins : []
  const failed = runtimePlugins.some(item => isRecord(item) && (item.status === 'failed' || item.status === 'missing'))
  return {
    state: failed ? 'unavailable' : 'running',
    metadata: publicMetadata(endpoint),
    diagnostics: failed
      ? [
          {
            code: 'DSHX5103',
            severity: 'warning',
            message: 'One or more optional DSHX runtime plugins failed to load in the running Composition.',
            file: project.packageFile,
            hint: 'Run dshx check --json for plugin details and install the missing development dependencies.',
          },
        ]
      : [],
  }
}

async function readMetadata(path: string, project: ResolvedDshxConfig, expectedSocket: string): Promise<BridgeCredentials> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code === 'ENOENT' ? 'DSHX3201' : 'DSHX3202'
    throw fail(
      code,
      code === 'DSHX3201' ? 'No Host Inspect bridge endpoint is available.' : `Unable to read the Host Inspect bridge metadata: ${String(cause)}`,
      'Start the project with "dshx dev" and enable the Host Inspect bridge.',
    )
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (cause) {
    throw fail(
      'DSHX3203',
      `Host Inspect bridge metadata is not valid JSON: ${String(cause)}`,
      'Restart the current DSH Composition so DSHX can recreate its endpoint metadata.',
    )
  }
  const parsed = bridgeCredentialsSchema.safeParse(value)
  if (!parsed.success) {
    throw fail('DSHX3203', 'Host Inspect bridge metadata is invalid.', 'Restart the current DSH Composition so DSHX can recreate its endpoint metadata.')
  }
  const credentials = parsed.data
  if (
    !isAbsolute(credentials.root) ||
    !isAbsolute(credentials.socketPath) ||
    credentials.packageId !== project.packageId ||
    resolve(credentials.root) !== resolve(project.root)
  ) {
    throw fail(
      'DSHX3202',
      'Host Inspect bridge metadata does not belong to this project.',
      'Close stale DSH processes and restart the project from its configured root.',
    )
  }
  if (resolve(credentials.socketPath) !== resolve(expectedSocket)) {
    throw fail(
      'DSHX3202',
      'Host Inspect bridge socket path does not match its package endpoint.',
      'Restart the current DSH Composition and retry the Inspect command.',
    )
  }
  if (!processAlive(credentials.pid)) {
    throw fail('DSHX3205', 'The Host Inspect bridge belongs to an exited Composition.', 'Restart the DSH Composition, then retry Inspect.')
  }
  return credentials
}

const inspectTransportError = (error: JsonLineTransportError): DshxError => {
  if (error.code === 'timeout') {
    return fail('DSHX3202', 'Timed out while querying the Host Inspect bridge.', 'Check the running Composition and retry the Inspect command.')
  }
  if (error.code === 'connection') {
    return fail(
      'DSHX3202',
      `Unable to connect to the Host Inspect bridge: ${error.message}`,
      'Ensure the Composition is still running and that DSHX_INSPECT_BRIDGE=1 was enabled.',
    )
  }
  if (error.code === 'request-too-large') {
    return fail('DSHX3203', 'Host Inspect bridge request exceeds the size limit.', 'Use the official bridge protocol and retry.')
  }
  if (error.code === 'response-too-large') {
    return fail('DSHX3203', 'Host Inspect bridge response exceeds the size limit.', 'Use the official bridge protocol and retry.')
  }
  return fail('DSHX3203', `Host Inspect bridge returned invalid JSON: ${error.message}`, 'Restart the Composition and retry the Inspect command.')
}

const request = async <Item>({
  project,
  target,
  options,
  input,
  itemsSchema,
}: {
  readonly project: ResolvedDshxConfig
  readonly target: 'services' | 'events' | 'slots'
  readonly options: DshInspectBridgeProviderOptions
  readonly input: { readonly root: string } | undefined
  readonly itemsSchema: z.ZodType<readonly Item[]>
}): Promise<readonly Item[]> => {
  const env = { ...process.env, ...options.env }
  const paths = endpointPaths(project.packageId, env)
  const metadata = await readMetadata(paths.metadataPath, project, paths.socketPath)
  const requestId = `inspect-${randomUUID()}`
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const payload =
    JSON.stringify({ version: PROTOCOL_VERSION, requestId, token: metadata.token, operation: 'list', target, ...(input === undefined ? {} : { input }) }) + '\n'
  const value = await requestJsonLine(paths.socketPath, payload, {
    maxRequestBytes: MAX_MESSAGE_BYTES,
    maxResponseBytes: MAX_MESSAGE_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }).catch(error => {
    if (error instanceof JsonLineTransportError) throw inspectTransportError(error)
    throw error
  })
  return decodeBridgeResponse({ value, requestId, target, itemsSchema })
}

/** Read-only client for the DSHX Host-owned Runtime Inspect bridge. */
export class DshInspectBridgeProvider implements InspectProvider {
  constructor(
    private readonly project: ResolvedDshxConfig,
    private readonly options: DshInspectBridgeProviderOptions = {},
  ) {}

  async listSlots(options: InspectSlotOptions = {}): Promise<readonly SlotSummary[]> {
    if (options.root !== undefined && (typeof options.root !== 'string' || options.root.trim() === '')) {
      throw fail('DSHX3203', 'Slot Inspect root must be a non-empty string.', 'Pass a valid Slot name or omit --root.')
    }
    return await request({
      project: this.project,
      target: 'slots',
      options: this.options,
      input: options.root === undefined ? undefined : { root: options.root },
      itemsSchema: slotItemsSchema,
    })
  }

  listTools(): Promise<readonly ToolSummary[]> {
    return Promise.reject(
      fail('DSHX3204', 'The Host Inspect bridge does not expose Tool data.', 'Use the official Tool Inspect provider when it is available.'),
    )
  }

  async listServices(): Promise<readonly ServiceSummary[]> {
    return await request({ project: this.project, target: 'services', options: this.options, input: undefined, itemsSchema: serviceItemsSchema })
  }

  async listEvents(): Promise<readonly EventSummary[]> {
    return await request({ project: this.project, target: 'events', options: this.options, input: undefined, itemsSchema: eventItemsSchema })
  }
}
