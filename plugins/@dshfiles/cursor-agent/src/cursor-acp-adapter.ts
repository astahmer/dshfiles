import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientConnection,
  type PermissionOption,
  type PromptResponse,
  type RequestPermissionRequest,
  type SessionUpdate,
} from '@agentclientprotocol/sdk'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  type RuntimeDriverAdapter,
  type RuntimeDriverEvent,
  type RuntimeDriverOpenRequest,
  type RuntimeDriverPromptRequest,
  type RuntimeDriverSession,
  type RuntimeDriverStatus,
  type RuntimeDriverStatusRequest,
} from '@deepseek-ai/dsh-agent'
import { Readable, Writable } from 'node:stream'
import { chmod, mkdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { CursorAgentConfig, CursorInstanceConfig } from './config.js'
import { cursorCredentialEnvironment } from './config.js'
import { cursorSessionDomain, cursorSessionRecordForResume, type CursorSessionRecord } from './cursor-session-store.js'

const DRIVER_KIND = 'cursor-acp'
const CURSOR_EXECUTABLE = 'agent'
const STARTUP_TIMEOUT_MS = 30_000
const PROCESS_EOF_GRACE_MS = 4_000
const MAX_RUNTIME_TEXT_CHUNK = 32_768

const safeError = (message: string): Error => new Error(message)

const isMissingPath = (error: unknown): boolean => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'

const isInside = (root: string, path: string): boolean => {
  const child = relative(root, path)
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
}

const workingDirectoryFor = (request: RuntimeDriverOpenRequest): string => {
  const cwd = request.session.header.cwd
  if (cwd === undefined || !isAbsolute(cwd)) throw safeError('Cursor ACP requires an absolute DSH session workspace.')
  return cwd
}

export const assertNoProjectCursorConfig = async (cwd: string): Promise<void> => {
  let current = cwd
  while (true) {
    for (const fileName of ['cli.json', 'mcp.json']) {
      const candidate = join(current, '.cursor', fileName)
      const exists = await stat(candidate).then(
        () => true,
        error => {
          if (isMissingPath(error)) return false
          throw safeError('Cursor ACP cannot verify project configuration.')
        },
      )
      if (exists) throw safeError(`Cursor ACP refuses project .cursor/${fileName} configuration.`)
    }
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}

const cursorConfigDirectoryFor = async (instanceId: string): Promise<string> => {
  const configuredHome = process.env.DSH_HOME
  if (configuredHome !== undefined && !isAbsolute(configuredHome)) throw safeError('DSH_HOME must be absolute for isolated Cursor configuration.')
  const dshHome = configuredHome ?? join(homedir(), '.dsh')
  const dshHomeReal = await realpath(dshHome).catch(() => {
    throw safeError('Cursor ACP requires an existing DSH_HOME directory.')
  })
  const runtimeRoot = join(dshHomeReal, 'runtime-drivers')
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 }).catch(() => {
    throw safeError('Cursor ACP could not create its private runtime directory.')
  })
  const runtimeRootReal = await realpath(runtimeRoot).catch(() => {
    throw safeError('Cursor ACP could not resolve its private runtime directory.')
  })
  if (!isInside(dshHomeReal, runtimeRootReal)) throw safeError('Cursor ACP runtime directory escaped DSH_HOME.')
  await chmod(runtimeRootReal, 0o700).catch(() => {
    throw safeError('Cursor ACP could not secure its private runtime directory.')
  })

  const driverRoot = join(runtimeRootReal, DRIVER_KIND)
  await mkdir(driverRoot, { recursive: true, mode: 0o700 }).catch(() => {
    throw safeError('Cursor ACP could not create its private provider directory.')
  })
  const driverRootReal = await realpath(driverRoot).catch(() => {
    throw safeError('Cursor ACP could not resolve its private provider directory.')
  })
  if (!isInside(runtimeRootReal, driverRootReal)) throw safeError('Cursor ACP provider directory escaped its runtime root.')
  await chmod(driverRootReal, 0o700).catch(() => {
    throw safeError('Cursor ACP could not secure its private provider directory.')
  })

  const instanceRoot = join(driverRootReal, instanceId)
  await mkdir(instanceRoot, { recursive: true, mode: 0o700 }).catch(() => {
    throw safeError('Cursor ACP could not create its private instance directory.')
  })
  const instanceRootReal = await realpath(instanceRoot).catch(() => {
    throw safeError('Cursor ACP could not resolve its private instance directory.')
  })
  if (!isInside(driverRootReal, instanceRootReal)) throw safeError('Cursor ACP instance directory escaped its provider root.')
  await chmod(instanceRootReal, 0o700).catch(() => {
    throw safeError('Cursor ACP could not secure its private instance directory.')
  })
  return instanceRootReal
}

const promptContent = (messages: RuntimeDriverPromptRequest['messages']) => {
  const blocks = [] as Array<{ readonly type: 'text'; readonly text: string }>
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'text') throw safeError('Cursor ACP currently accepts text-only DSH prompts.')
      blocks.push({ type: 'text', text: block.text })
    }
  }
  return blocks
}

type AcpPromptContent = ReturnType<typeof promptContent>
type CursorSessionDomain = Domain<typeof cursorSessionDomain>

export const cursorPermissionRequest = (toolCall: Pick<RequestPermissionRequest['toolCall'], 'title' | 'kind' | 'name'>, signal: AbortSignal) => {
  const candidateName = toolCall.name ?? toolCall.kind ?? 'tool'
  const toolNamePart = candidateName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
  const toolName = `cursor-${toolNamePart.length === 0 ? 'tool' : toolNamePart}`
  const title = (toolCall.title ?? toolCall.name ?? toolCall.kind ?? 'Cursor tool')
    // Provider title is untrusted display text; normalize control bytes before approval UI.
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
  return {
    toolName,
    reason: title.length === 0 ? `Cursor requests permission for ${toolName}.` : title,
    signal,
  }
}

export const cursorPermissionResponse = (options: readonly PermissionOption[], outcome: Awaited<ReturnType<RuntimeDriverOpenRequest['requestPermission']>>) => {
  if (outcome === 'cancelled') return { outcome: { outcome: 'cancelled' as const } }
  const desiredKind = outcome === 'allowed-once' ? 'allow_once' : 'reject_once'
  const selected = options.find(option => option.kind === desiredKind)
  if (selected === undefined) return { outcome: { outcome: 'cancelled' as const } }
  return { outcome: { outcome: 'selected' as const, optionId: selected.optionId } }
}

const toolCategory = (kind: string | null | undefined): Extract<RuntimeDriverEvent, { type: 'activity' }>['category'] => {
  switch (kind) {
    case 'think':
      return 'reasoning'
    case 'execute':
      return 'terminal'
    case 'search':
      return 'search'
    case 'read':
    case 'edit':
    case 'delete':
    case 'move':
      return 'file'
    default:
      return 'tool'
  }
}

const toolState = (status: string | null | undefined): Extract<RuntimeDriverEvent, { type: 'activity' }>['state'] => {
  switch (status) {
    case 'pending':
      return 'started'
    case 'in_progress':
      return 'updated'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    default:
      return 'updated'
  }
}

const emitText = (text: string, publish: (event: RuntimeDriverEvent) => void): void => {
  let offset = 0
  while (offset < text.length) {
    let end = Math.min(text.length, offset + MAX_RUNTIME_TEXT_CHUNK)
    const lastCodeUnit = text.charCodeAt(end - 1)
    if (end < text.length && lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) end -= 1
    publish({ type: 'text-delta', text: text.slice(offset, end) })
    offset = end
  }
}

const abortReason = (signal: AbortSignal): Error => (signal.reason instanceof Error ? signal.reason : safeError('Cursor ACP operation was cancelled.'))

const byteStream = (stream: Readable): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      stream.on('data', (chunk: unknown) => {
        if (typeof chunk === 'string') {
          controller.enqueue(new TextEncoder().encode(chunk))
          return
        }
        if (chunk instanceof Uint8Array) {
          controller.enqueue(chunk)
          return
        }
        controller.error(safeError('Cursor ACP emitted a non-byte stdout chunk.'))
      })
      stream.once('end', () => controller.close())
      stream.once('error', error => controller.error(error))
    },
    cancel(reason) {
      stream.destroy(reason instanceof Error ? reason : undefined)
    },
  })

const withProcess = async <T>(operation: Promise<T>, processFailure: Promise<never>, signal: AbortSignal | undefined): Promise<T> => {
  if (signal === undefined) return await Promise.race([operation, processFailure])
  if (signal.aborted) throw abortReason(signal)
  let rejectAbort: ((reason: unknown) => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject
  })
  const onAbort = (): void => rejectAbort?.(abortReason(signal))
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([operation, processFailure, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

const closeProcess = async (child: SubprocessHandle): Promise<void> => {
  if (child.stdin !== undefined && !child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end()
  const exited = await child.waitForExit(AbortSignal.timeout(PROCESS_EOF_GRACE_MS)).catch(() => false)
  if (exited) return
  child.terminate()
  const terminated = await child.waitForExit(AbortSignal.timeout(PROCESS_EOF_GRACE_MS)).catch(() => false)
  if (!terminated) throw safeError('Cursor ACP subprocess did not confirm shutdown.')
}

class CursorAcpProcess {
  readonly nativeSessionId: string
  private readonly processFailure: Promise<never>
  private publish: ((event: RuntimeDriverEvent) => void) | undefined
  private readonly activityIds = new Map<string, string>()
  private activitySequence = 0
  private eventFailure = false
  private disposePromise: Promise<void> | undefined

  constructor(
    private readonly child: SubprocessHandle,
    private readonly connection: ClientConnection,
    processFailure: Promise<never>,
    nativeSessionId: string,
  ) {
    this.nativeSessionId = nativeSessionId
    this.processFailure = processFailure
  }

  async prompt(messages: AcpPromptContent, signal: AbortSignal, publish: (event: RuntimeDriverEvent) => void): Promise<PromptResponse> {
    this.publish = publish
    this.eventFailure = false
    this.activityIds.clear()
    const operation = this.connection.agent.request<PromptResponse>(methods.agent.session.prompt, {
      sessionId: this.nativeSessionId,
      prompt: messages,
    })
    try {
      const response = await withProcess(operation, this.processFailure, signal)
      if (this.eventFailure) throw safeError('Cursor ACP emitted output DSH could not accept.')
      return response
    } finally {
      this.publish = undefined
    }
  }

  async cancel(): Promise<void> {
    try {
      await this.connection.agent.notify(methods.agent.session.cancel, { sessionId: this.nativeSessionId })
    } catch {
      return
    }
  }

  dispose(): Promise<void> {
    if (this.disposePromise !== undefined) return this.disposePromise
    this.disposePromise = this.disposeOnce()
    return this.disposePromise
  }

  private async disposeOnce(): Promise<void> {
    this.connection.close()
    try {
      await closeProcess(this.child)
    } catch {
      throw safeError('Cursor ACP subprocess cleanup failed.')
    }
  }

  publishUpdate(sessionId: string | undefined, update: SessionUpdate): void {
    if (sessionId !== this.nativeSessionId) return
    if (update.sessionUpdate === 'agent_message_chunk') {
      if (update.content.type !== 'text') {
        this.eventFailure = true
        return
      }
      this.publishText(update.content.text)
      return
    }
    if (update.sessionUpdate === 'tool_call') {
      this.publishActivity(update.toolCallId, update.kind, update.status)
      return
    }
    if (update.sessionUpdate === 'tool_call_update') {
      this.publishActivity(update.toolCallId, update.kind, update.status)
    }
  }

  private publishText(text: string): void {
    if (this.publish === undefined || text.length === 0) return
    try {
      emitText(text, this.publish)
    } catch {
      this.eventFailure = true
      void this.cancel()
    }
  }

  private publishActivity(toolCallId: string, kind: string | null | undefined, status: string | null | undefined): void {
    if (this.publish === undefined) return
    let id = this.activityIds.get(toolCallId)
    if (id === undefined) {
      id = `cursor-activity-${++this.activitySequence}`
      this.activityIds.set(toolCallId, id)
    }
    try {
      this.publish({ type: 'activity', id, category: toolCategory(kind), state: toolState(status) })
    } catch {
      this.eventFailure = true
      void this.cancel()
    }
  }
}

const connectCursorSession = async (
  ctx: Context,
  request: RuntimeDriverOpenRequest,
  instance: CursorInstanceConfig,
  credential: string,
  configDirectory: string,
  session: { readonly kind: 'create' } | { readonly kind: 'resume'; readonly nativeSessionId: string },
  beforeProtocol?: () => Promise<void>,
): Promise<CursorAcpProcess> => {
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) throw safeError('DSH subprocess service is unavailable.')
  const cwd = workingDirectoryFor(request)
  await assertNoProjectCursorConfig(cwd)
  const executable = await subprocess.resolveExecutable(CURSOR_EXECUTABLE, undefined, request.signal).catch(() => {
    throw safeError('Cursor CLI executable is unavailable.')
  })
  let child: SubprocessHandle | undefined
  let connection: ClientConnection | undefined
  try {
    child = subprocess.spawn({
      argv: [executable, 'acp'],
      cwd,
      env: {
        [cursorCredentialEnvironment(instance.credentialKind)]: credential,
        CURSOR_CONFIG_DIR: configDirectory,
      },
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: PROCESS_EOF_GRACE_MS,
    })
    if (child.stdin === undefined || child.stdout === undefined || child.stderr === undefined) throw safeError('Cursor ACP stdio is unavailable.')
    child.stderr.on('error', () => undefined)
    child.stderr.resume()
    await beforeProtocol?.()
    const app = client({ name: 'dsh-cursor-agent' })
    let process: CursorAcpProcess | undefined
    app.onNotification(methods.client.session.update, ({ params }) => {
      process?.publishUpdate(params.sessionId, params.update)
    })
    app.onRequest(methods.client.session.requestPermission, async ({ params, signal }) => {
      if (request.signal.aborted || signal.aborted || params.sessionId !== process?.nativeSessionId) {
        return { outcome: { outcome: 'cancelled' as const } }
      }
      const permissionSignal = AbortSignal.any([request.signal, signal])
      const outcome = await request.requestPermission(cursorPermissionRequest(params.toolCall, permissionSignal)).catch(() => 'unavailable' as const)
      return cursorPermissionResponse(params.options, outcome)
    })

    const stream = ndJsonStream(Writable.toWeb(child.stdin), byteStream(child.stdout))
    connection = app.connect(stream)
    const processExit = child.done.then(
      () => {
        throw safeError('Cursor ACP subprocess exited during initialization.')
      },
      () => {
        throw safeError('Cursor ACP subprocess failed during initialization.')
      },
    )
    void processExit.catch(() => undefined)
    const connectionFailure = connection.closed.then(() => {
      throw safeError('Cursor ACP connection closed during the request.')
    })
    void connectionFailure.catch(() => undefined)
    const requestFailure = Promise.race([processExit, connectionFailure])
    const startupSignal = AbortSignal.any([request.signal, AbortSignal.timeout(STARTUP_TIMEOUT_MS)])
    const initialized = await withProcess(
      connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'dsh-cursor-agent', version: '0.1.0' },
        clientCapabilities: {},
      }),
      requestFailure,
      startupSignal,
    )
    if (initialized.authMethods?.some(method => method.id === 'cursor_login')) {
      await withProcess(connection.agent.request(methods.agent.authenticate, { methodId: 'cursor_login' }), requestFailure, startupSignal)
    }
    let nativeSessionId: string
    if (session.kind === 'create') {
      const opened = await withProcess(connection.agent.request(methods.agent.session.new, { cwd, mcpServers: [] }), requestFailure, startupSignal)
      nativeSessionId = opened.sessionId
    } else {
      await withProcess(
        connection.agent.request(methods.agent.session.load, {
          sessionId: session.nativeSessionId,
          cwd,
          mcpServers: [],
        }),
        requestFailure,
        startupSignal,
      )
      nativeSessionId = session.nativeSessionId
    }
    process = new CursorAcpProcess(child, connection, requestFailure, nativeSessionId)
    return process
  } catch {
    connection?.close()
    if (child !== undefined) await closeProcess(child).catch(() => undefined)
    throw safeError('Cursor ACP session startup failed.')
  }
}

export class CursorAcpAdapter implements RuntimeDriverAdapter {
  readonly descriptor = Object.freeze({
    id: DRIVER_KIND,
    title: 'Cursor Agent ACP',
    protocolVersion: 1 as const,
    capabilities: Object.freeze({ create: true, resume: true, fork: false, historyReplay: false, steering: true, rollback: false }),
  })

  private readonly sessions = new Set<CursorRuntimeSession>()
  private storePromise: Promise<CursorSessionDomain> | undefined

  constructor(
    private readonly ctx: Context,
    private readonly config: CursorAgentConfig,
  ) {}

  async status(request: RuntimeDriverStatusRequest): Promise<RuntimeDriverStatus> {
    const instance = this.config.instances.find(candidate => candidate.id === request.instanceId)
    if (instance === undefined) return { availability: 'unavailable', authentication: 'unknown', reason: 'probe-failed' }
    const credentials = this.ctx.get('credentials')
    const subprocess = this.ctx.get('subprocess')
    if (credentials === undefined || subprocess === undefined)
      return { availability: 'unknown', authentication: 'unknown', identity: instance.label, reason: 'probe-failed' }
    const details = await credentials.describe(credentialRef(instance.credentialRef)).catch(() => undefined)
    if (details === undefined) return { availability: 'unknown', authentication: 'unknown', identity: instance.label, reason: 'probe-failed' }
    if (!details.configured) return { availability: 'unavailable', authentication: 'missing', identity: instance.label, reason: 'authentication-missing' }
    try {
      await subprocess.resolveExecutable(CURSOR_EXECUTABLE, undefined, request.signal)
      return { availability: 'available', authentication: 'unknown', identity: instance.label }
    } catch {
      return { availability: 'unavailable', authentication: 'unknown', identity: instance.label, reason: 'executable-missing' }
    }
  }

  async create(request: RuntimeDriverOpenRequest): Promise<RuntimeDriverSession> {
    const instance = this.instance(request.instanceId)
    const credential = await this.resolveCredential(instance)
    const sessions = await this.sessionStore()
    const sessionId = request.session.id
    if (sessions.table('sessions').get(sessionId) !== undefined) throw safeError('Cursor session creation already has a durable provider record.')
    const configDirectory = await cursorConfigDirectoryFor(instance.id)
    const active = await connectCursorSession(this.ctx, request, instance, credential, configDirectory, { kind: 'create' }, async () => {
      const creation = { state: 'creating' as const, instanceId: instance.id, operationId: randomUUID(), startedAt: Date.now() }
      await sessions
        .table('sessions')
        .put(sessionId, creation)
        .catch(() => {
          throw safeError('Cursor session creation receipt could not be persisted.')
        })
    })
    const ready: CursorSessionRecord = { state: 'ready', instanceId: instance.id, nativeSessionId: active.nativeSessionId }
    await sessions
      .table('sessions')
      .put(sessionId, ready)
      .catch(async () => {
        await active.dispose().catch(() => undefined)
        throw safeError('Cursor session record could not be finalized.')
      })
    return this.track(new CursorRuntimeSession(sessionId, instance.id, sessions, active))
  }

  async resume(request: RuntimeDriverOpenRequest): Promise<RuntimeDriverSession> {
    const instance = this.instance(request.instanceId)
    const sessions = await this.sessionStore()
    const record = cursorSessionRecordForResume(sessions.table('sessions').get(request.session.id), instance.id)
    const credential = await this.resolveCredential(instance)
    const configDirectory = await cursorConfigDirectoryFor(instance.id)
    const active = await connectCursorSession(this.ctx, request, instance, credential, configDirectory, {
      kind: 'resume',
      nativeSessionId: record.nativeSessionId,
    })
    return this.track(new CursorRuntimeSession(request.session.id, instance.id, sessions, active))
  }

  async dispose(): Promise<void> {
    const sessions = [...this.sessions]
    const results = await Promise.allSettled(
      sessions.map(async session => {
        const failures: unknown[] = []
        try {
          await session.cancel()
        } catch (error: unknown) {
          failures.push(error)
        }
        try {
          await session.dispose()
        } catch (error: unknown) {
          failures.push(error)
        }
        if (failures.length === 1) throw failures[0]
        if (failures.length > 1) throw new AggregateError(failures, 'Cursor ACP session cleanup failed')
      }),
    )
    const errors = results.flatMap(result => (result.status === 'rejected' ? [result.reason] : []))
    const storePromise = this.storePromise
    if (storePromise !== undefined) {
      try {
        const store = await storePromise
        await store.close()
      } catch (error: unknown) {
        errors.push(error)
      } finally {
        this.storePromise = undefined
      }
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, 'Cursor ACP sessions and storage did not all dispose cleanly')
  }

  private instance(instanceId: string): CursorInstanceConfig {
    const instance = this.config.instances.find(candidate => candidate.id === instanceId)
    if (instance === undefined) throw safeError(`Cursor runtime instance is not configured: ${instanceId}`)
    return instance
  }

  private async resolveCredential(instance: CursorInstanceConfig): Promise<string> {
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) throw safeError('DSH credentials service is unavailable.')
    const resolved = await credentials.resolve(credentialRef(instance.credentialRef))
    if (resolved === undefined || resolved.value.length === 0) throw safeError('Cursor runtime credential is not configured.')
    return resolved.value
  }

  private sessionStore() {
    if (this.storePromise !== undefined) return this.storePromise
    const storage = this.ctx.get('storageDomain')
    if (storage === undefined) throw safeError('DSH storage-domain service is unavailable.')
    this.storePromise = storage.open(cursorSessionDomain)
    return this.storePromise
  }

  private track(session: CursorRuntimeSession): CursorRuntimeSession {
    this.sessions.add(session)
    session.onDispose(() => this.sessions.delete(session))
    return session
  }
}

class CursorRuntimeSession implements RuntimeDriverSession {
  private pendingOperationId: string | undefined
  private disposed = false
  private onDisposed: (() => void) | undefined

  constructor(
    private readonly sessionId: string,
    private readonly instanceId: string,
    private readonly domain: CursorSessionDomain,
    private readonly active: CursorAcpProcess,
  ) {}

  onDispose(callback: () => void): void {
    this.onDisposed = callback
  }

  async prompt(request: RuntimeDriverPromptRequest, publish: (event: RuntimeDriverEvent) => void): Promise<{ outcome: 'completed' | 'max-tokens' }> {
    const prompt = promptContent(request.messages)
    if (request.signal.aborted) throw abortReason(request.signal)
    const table = this.domain.table('sessions')
    const record = table.get(this.sessionId)
    if (record === undefined || record.state !== 'ready' || record.instanceId !== this.instanceId) {
      throw safeError('Cursor provider session record is unavailable.')
    }
    if (record.pendingOperation !== undefined) throw safeError('Cursor provider already has an unsettled prompt receipt.')
    const pending = { id: randomUUID(), turn: request.turn, step: request.step, startedAt: Date.now() }
    await table.put(this.sessionId, { ...record, pendingOperation: pending }).catch(() => {
      throw safeError('Cursor prompt receipt could not be persisted before the provider call.')
    })
    this.pendingOperationId = pending.id

    const onAbort = (): void => {
      void this.cancel()
    }
    request.signal.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await this.active.prompt(prompt, request.signal, publish)
      request.signal.throwIfAborted()
      if (response.stopReason === 'end_turn' || response.stopReason === 'refusal') return { outcome: 'completed' }
      if (response.stopReason === 'max_tokens') return { outcome: 'max-tokens' }
      throw safeError('Cursor ACP stopped before returning an accountable prompt result.')
    } catch {
      throw safeError('Cursor ACP prompt failed; provider outcome is uncertain and will not be replayed.')
    } finally {
      request.signal.removeEventListener('abort', onAbort)
    }
  }

  async acknowledgePrompt(): Promise<void> {
    const operationId = this.pendingOperationId
    if (operationId === undefined) throw safeError('Cursor prompt acknowledgement has no matching receipt.')
    const table = this.domain.table('sessions')
    const record = table.get(this.sessionId)
    if (record === undefined || record.state !== 'ready' || record.instanceId !== this.instanceId) {
      throw safeError('Cursor session receipt changed before acknowledgement.')
    }
    if (record.pendingOperation?.id !== operationId) throw safeError('Cursor prompt receipt changed before acknowledgement.')
    await table
      .put(this.sessionId, {
        state: 'ready',
        instanceId: record.instanceId,
        nativeSessionId: record.nativeSessionId,
      })
      .catch(() => {
        throw safeError('Cursor prompt receipt could not be acknowledged after DSH stored its reply.')
      })
    this.pendingOperationId = undefined
  }

  async cancel(): Promise<void> {
    await this.active.cancel()
  }

  dispose(): Promise<void> {
    if (this.disposed) return this.active.dispose()
    this.disposed = true
    this.onDisposed?.()
    return this.active.dispose()
  }
}
