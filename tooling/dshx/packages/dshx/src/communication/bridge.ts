import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createServer, type Server, type Socket } from 'node:net'
import { z } from 'zod'
import { JsonLineTransport, JsonLineTransportError } from '../bridge/json-line.js'
import { CommunicationError, CommunicationService } from './service.js'
import {
  communicationAgentSchema,
  communicationDeliverySchema,
  communicationDiagnosticsSchema,
  communicationInboxSchema,
  communicationMessageIntentSchema,
  communicationMessageSchema,
  communicationPrincipalSchema,
  communicationSubscriptionSchema,
  communicationTopicSchema,
  legacyCommunicationDeliverySchema,
  type CommunicationAgent,
  type CommunicationDelivery,
  type CommunicationDiagnostics,
  type CommunicationInbox,
  type CommunicationMessage,
  type CommunicationMessageIntent,
  type CommunicationPrincipal,
  type CommunicationSubscription,
  type CommunicationTopic,
} from './types.js'

const PROTOCOL_VERSION = 1
const MAX_REQUEST_BYTES = 64 * 1024
const MAX_RESPONSE_BYTES = 1024 * 1024
const REQUEST_TIMEOUT_MS = 5_000
const operationSchema = z.enum(['agents', 'topics', 'report', 'subscribe', 'unsubscribe', 'publish', 'send', 'inbox', 'ack'])

const bridgeRequestSchema = z
  .object({
    version: z.literal(PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    token: z.string().uuid(),
    operation: operationSchema,
    principal: communicationPrincipalSchema.refine(value => value.kind === 'external', 'Only external principals may connect over the local bridge.'),
    input: z.unknown().optional(),
  })
  .strict()

const bridgeMetadataSchema = z
  .object({
    version: z.literal(PROTOCOL_VERSION),
    pid: z.number().int().positive(),
    socketPath: z.string().min(1),
    token: z.string().uuid(),
  })
  .strict()

export interface HostCommunicationBridgeHandle {
  readonly metadataPath: string
  readonly socketPath: string
  readonly close: () => Promise<void>
}

export interface CommunicationClient {
  readonly principal: CommunicationPrincipal
  listAgents(): Promise<readonly CommunicationAgent[]>
  listTopics(): Promise<readonly CommunicationTopic[]>
  diagnostics(input?: { readonly limit?: number }): Promise<CommunicationDiagnostics>
  subscribe(input: {
    readonly topic: string
    readonly delivery?: CommunicationDelivery
    readonly allowSteerFrom?: readonly string[]
  }): Promise<CommunicationSubscription>
  unsubscribe(topic: string): Promise<{ readonly removed: boolean }>
  publish(input: {
    readonly topic: string
    readonly text: string
    readonly intent?: CommunicationMessageIntent
    readonly priority?: 'normal' | 'urgent'
    readonly correlationId?: string
    readonly dedupeKey?: string
  }): Promise<CommunicationMessage>
  send(input: {
    readonly toAgentId: string
    readonly text: string
    readonly intent?: CommunicationMessageIntent
    readonly priority?: 'normal' | 'urgent'
    readonly correlationId?: string
    readonly dedupeKey?: string
  }): Promise<CommunicationMessage>
  inbox(input?: { readonly topic?: string; readonly limit?: number }): Promise<CommunicationInbox>
  acknowledge(messageId: string): Promise<{ readonly acknowledged: boolean }>
}

export interface ConnectCommunicationClientOptions {
  readonly principalId?: string
  readonly stateHome?: string
}

const homeDirectory = (stateHome?: string): string => {
  const home = stateHome?.trim() || process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'runtime', 'dshx', 'communication')
}

const bridgePaths = (stateHome?: string) => {
  const directory = homeDirectory(stateHome)
  const longSocket = join(directory, 'host.sock')
  const socketPath = longSocket.length > 90 ? join(tmpdir(), `dshx-comm-${createHash('sha256').update(directory).digest('hex').slice(0, 20)}.sock`) : longSocket
  return { directory, socketPath, metadataPath: join(directory, 'host.json') }
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

const communicationTransportError = (error: JsonLineTransportError): CommunicationError => {
  if (error.code === 'request-too-large') return new CommunicationError('request-too-large', 'Communication request exceeds the size limit.')
  if (error.code === 'response-too-large') return new CommunicationError('response-too-large', 'Communication bridge response exceeds the size limit.')
  if (error.code === 'timeout') return new CommunicationError('timeout', 'Communication bridge request timed out.')
  if (error.code === 'connection') return new CommunicationError('host-unavailable', error.message)
  return new CommunicationError('invalid-response', 'Communication bridge returned invalid JSON.')
}

const responseError = (requestId: string, code: string, message: string) => ({
  version: PROTOCOL_VERSION,
  requestId,
  ok: false,
  error: { code, message },
})

const readMetadata = async (stateHome?: string): Promise<z.infer<typeof bridgeMetadataSchema>> => {
  const location = bridgePaths(stateHome)
  const metadataStat = await lstat(location.metadataPath).catch(() => undefined)
  if (!metadataStat?.isFile() || metadataStat.isSymbolicLink() || metadataStat.size > 4_096 || (metadataStat.mode & 0o077) !== 0) {
    throw new CommunicationError('host-unavailable', 'DSHX Communication Host bridge is unavailable or has unsafe metadata permissions.')
  }
  if (typeof process.getuid === 'function' && metadataStat.uid !== process.getuid()) {
    throw new CommunicationError('host-unavailable', 'DSHX Communication Host bridge belongs to a different user.')
  }
  const directoryStat = await lstat(dirname(location.metadataPath)).catch(() => undefined)
  if (!directoryStat?.isDirectory() || directoryStat.isSymbolicLink() || (directoryStat.mode & 0o077) !== 0) {
    throw new CommunicationError('host-unavailable', 'DSHX Communication Host bridge directory has unsafe permissions.')
  }
  if (typeof process.getuid === 'function' && directoryStat.uid !== process.getuid()) {
    throw new CommunicationError('host-unavailable', 'DSHX Communication Host bridge directory belongs to a different user.')
  }
  const value: unknown = JSON.parse(await readFile(location.metadataPath, 'utf8'))
  return bridgeMetadataSchema.parse(value)
}

const dispatch = async (
  service: CommunicationService,
  listAgents: () => readonly CommunicationAgent[] | Promise<readonly CommunicationAgent[]>,
  request: z.infer<typeof bridgeRequestSchema>,
): Promise<unknown> => {
  if (request.operation === 'agents') {
    if (request.input !== undefined) throw new CommunicationError('invalid-request', 'This communication operation takes no input.')
    return (await listAgents()).map(item => communicationAgentSchema.parse(item))
  }
  if (request.operation === 'topics') {
    if (request.input !== undefined) throw new CommunicationError('invalid-request', 'This communication operation takes no input.')
    return service.listTopics()
  }
  if (request.operation === 'report') {
    const input = z
      .object({ limit: z.number().int().min(1).max(100).optional() })
      .strict()
      .parse(request.input ?? {})
    return service.diagnostics({ agents: await listAgents(), limit: input.limit ?? 20 })
  }
  if (!isRecord(request.input)) throw new CommunicationError('invalid-request', 'Communication operation input must be an object.')
  if (request.operation === 'subscribe') {
    const input = z
      .object({
        topic: z.string().min(1).max(128),
        delivery: z.union([communicationDeliverySchema, legacyCommunicationDeliverySchema]).optional(),
        allowSteerFrom: z.array(z.string().min(1).max(256)).max(64).optional(),
      })
      .strict()
      .parse(request.input)
    return service.subscribe(request.principal, {
      topic: input.topic,
      ...(input.delivery !== undefined && { delivery: input.delivery }),
      ...(input.allowSteerFrom !== undefined && { allowSteerFrom: input.allowSteerFrom }),
    })
  }
  if (request.operation === 'unsubscribe') {
    const input = z
      .object({ topic: z.string().min(1).max(128) })
      .strict()
      .parse(request.input)
    return service.unsubscribe(request.principal, input.topic)
  }
  if (request.operation === 'publish') {
    const input = z
      .object({
        topic: z.string().min(1).max(128),
        text: z.string().min(1).max(12_000),
        intent: communicationMessageIntentSchema.optional(),
        priority: z.enum(['normal', 'urgent']).optional(),
        correlationId: z.string().min(1).max(128).optional(),
        dedupeKey: z.string().min(1).max(128).optional(),
      })
      .strict()
      .parse(request.input)
    return service.publish({
      sender: request.principal,
      topic: input.topic,
      text: input.text,
      ...(input.intent !== undefined && { intent: input.intent }),
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.correlationId !== undefined && { correlationId: input.correlationId }),
      ...(input.dedupeKey !== undefined && { dedupeKey: input.dedupeKey }),
    })
  }
  if (request.operation === 'send') {
    const input = z
      .object({
        toAgentId: z.string().min(1).max(256),
        text: z.string().min(1).max(12_000),
        intent: communicationMessageIntentSchema.optional(),
        priority: z.enum(['normal', 'urgent']).optional(),
        correlationId: z.string().min(1).max(128).optional(),
        dedupeKey: z.string().min(1).max(128).optional(),
      })
      .strict()
      .parse(request.input)
    return service.send({
      sender: request.principal,
      toAgentId: input.toAgentId,
      text: input.text,
      ...(input.intent !== undefined && { intent: input.intent }),
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.correlationId !== undefined && { correlationId: input.correlationId }),
      ...(input.dedupeKey !== undefined && { dedupeKey: input.dedupeKey }),
    })
  }
  if (request.operation === 'inbox') {
    const input = z
      .object({ topic: z.string().min(1).max(128).optional(), limit: z.number().int().min(1).max(500).optional() })
      .strict()
      .parse(request.input)
    return {
      items: await service.inbox({
        principal: request.principal,
        ...(input.topic !== undefined && { topic: input.topic }),
        ...(input.limit !== undefined && { limit: input.limit }),
      }),
    }
  }
  const input = z.object({ messageId: z.string().uuid() }).strict().parse(request.input)
  return service.acknowledge(request.principal, input.messageId)
}

const writeResponse = (socket: Socket, requestId: string, value: unknown): void => {
  JsonLineTransport.write(
    socket,
    { version: PROTOCOL_VERSION, requestId, ok: true, result: value },
    {
      maxBytes: MAX_RESPONSE_BYTES,
      onTooLarge: () => responseError(requestId, 'response-too-large', 'Communication response exceeds the size limit.'),
    },
  )
}

const removeStaleEndpoint = async (location: ReturnType<typeof bridgePaths>): Promise<void> => {
  const metadata = await readFile(location.metadataPath, 'utf8').catch(() => undefined)
  if (metadata !== undefined) {
    try {
      const parsed = bridgeMetadataSchema.parse(JSON.parse(metadata))
      try {
        process.kill(parsed.pid, 0)
        throw new CommunicationError('host-already-active', `A DSHX Communication bridge is already active with pid ${parsed.pid}.`)
      } catch (error) {
        if (error instanceof CommunicationError) throw error
        if (isRecord(error) && error.code !== 'ESRCH') {
          throw new CommunicationError('host-already-active', 'A DSHX Communication bridge may still be active.')
        }
      }
    } catch (error) {
      if (error instanceof CommunicationError && error.code === 'host-already-active') throw error
    }
  }
  await rm(location.socketPath, { force: true })
  await rm(location.metadataPath, { force: true })
}

export const startHostCommunicationBridge = async (
  service: CommunicationService,
  options: { readonly stateHome?: string; readonly listAgents: () => readonly CommunicationAgent[] | Promise<readonly CommunicationAgent[]> },
): Promise<HostCommunicationBridgeHandle> => {
  const location = bridgePaths(options.stateHome)
  const token = randomUUID()
  await mkdir(location.directory, { recursive: true, mode: 0o700 })
  const directoryInfo = await lstat(location.directory)
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new CommunicationError('unsafe-directory', 'DSHX Communication Host bridge path must be a regular directory.')
  }
  if (typeof process.getuid === 'function' && directoryInfo.uid !== process.getuid()) {
    throw new CommunicationError('unsafe-directory', 'DSHX Communication Host bridge directory belongs to a different user.')
  }
  await chmod(location.directory, 0o700)
  await removeStaleEndpoint(location)
  const sockets = new Set<Socket>()
  const server: Server = createServer(socket => {
    socket.setTimeout(REQUEST_TIMEOUT_MS)
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.once('timeout', () => JsonLineTransport.write(socket, responseError('unknown', 'timeout', 'Communication bridge request timed out.')))
    JsonLineTransport.accept(socket, MAX_REQUEST_BYTES, {
      onTooLarge: () => JsonLineTransport.write(socket, responseError('unknown', 'request-too-large', 'Communication request exceeds the size limit.')),
      onLine: text => {
        let requestId = 'unknown'
        try {
          const parsedValue: unknown = JSON.parse(text)
          if (isRecord(parsedValue) && typeof parsedValue.requestId === 'string') requestId = parsedValue.requestId
          const request = bridgeRequestSchema.parse(parsedValue)
          if (request.token !== token) throw new CommunicationError('unauthorized', 'Communication bridge authentication failed.')
          void dispatch(service, options.listAgents, request)
            .then(result => writeResponse(socket, requestId, result))
            .catch(error =>
              JsonLineTransport.write(
                socket,
                responseError(
                  requestId,
                  error instanceof CommunicationError ? error.code : 'operation-failed',
                  error instanceof Error ? error.message : 'Communication operation failed.',
                ),
              ),
            )
        } catch (error) {
          const code = error instanceof CommunicationError ? error.code : 'invalid-request'
          const message = error instanceof Error ? error.message : 'Communication bridge received an invalid request.'
          JsonLineTransport.write(socket, responseError(requestId, code, message))
        }
      },
    })
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(location.socketPath, () => {
        server.off('error', reject)
        resolve()
      })
    })
    await chmod(location.socketPath, 0o600)
    await writeFile(location.metadataPath, `${JSON.stringify({ version: PROTOCOL_VERSION, pid: process.pid, socketPath: location.socketPath, token })}\n`, {
      mode: 0o600,
    })
    await chmod(location.metadataPath, 0o600)
  } catch (error) {
    await new Promise<void>(resolve => server.close(() => resolve())).catch(() => undefined)
    await rm(location.socketPath, { force: true })
    await rm(location.metadataPath, { force: true })
    throw error
  }

  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
    const current = await readFile(location.metadataPath, 'utf8').catch(() => undefined)
    let stillOwned = false
    if (current !== undefined) {
      try {
        stillOwned = bridgeMetadataSchema.parse(JSON.parse(current)).token === token
      } catch {
        stillOwned = false
      }
    }
    if (stillOwned) {
      await rm(location.socketPath, { force: true })
      await rm(location.metadataPath, { force: true })
    }
  }
  return { metadataPath: location.metadataPath, socketPath: location.socketPath, close }
}

export const connectCommunicationClient = async (options: ConnectCommunicationClientOptions = {}): Promise<CommunicationClient> => {
  const principal = communicationPrincipalSchema.parse({ kind: 'external', id: options.principalId ?? 'cli' })
  const metadata = await readMetadata(options.stateHome)
  const request = async (operation: z.infer<typeof operationSchema>, input?: unknown): Promise<unknown> => {
    const requestId = randomUUID()
    const body = `${JSON.stringify({ version: PROTOCOL_VERSION, requestId, token: metadata.token, operation, principal, ...(input !== undefined && { input }) })}\n`
    const value = await JsonLineTransport.request(metadata.socketPath, body, {
      maxRequestBytes: MAX_REQUEST_BYTES,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      timeoutMs: REQUEST_TIMEOUT_MS,
    }).catch(error => {
      if (error instanceof JsonLineTransportError) throw communicationTransportError(error)
      throw error
    })
    if (!isRecord(value) || value.version !== PROTOCOL_VERSION || value.requestId !== requestId || typeof value.ok !== 'boolean') {
      throw new CommunicationError('invalid-response', 'Communication bridge returned an invalid response envelope.')
    }
    if (!value.ok) {
      const failure = isRecord(value.error) ? value.error : {}
      throw new CommunicationError(
        typeof failure.code === 'string' ? failure.code : 'operation-failed',
        typeof failure.message === 'string' ? failure.message : 'Communication operation failed.',
      )
    }
    return value.result
  }

  return {
    principal,
    listAgents: async () => z.array(communicationAgentSchema).parse(await request('agents')),
    listTopics: async () => z.array(communicationTopicSchema).parse(await request('topics')),
    diagnostics: async input => communicationDiagnosticsSchema.parse(await request('report', input ?? {})),
    subscribe: async input => communicationSubscriptionSchema.parse(await request('subscribe', input)),
    unsubscribe: async topic =>
      z
        .object({ removed: z.boolean() })
        .strict()
        .parse(await request('unsubscribe', { topic })),
    publish: async input => communicationMessageSchema.parse(await request('publish', input)),
    send: async input => communicationMessageSchema.parse(await request('send', input)),
    inbox: async input => communicationInboxSchema.parse(await request('inbox', input ?? {})),
    acknowledge: async messageId =>
      z
        .object({ acknowledged: z.boolean() })
        .strict()
        .parse(await request('ack', { messageId })),
  }
}
