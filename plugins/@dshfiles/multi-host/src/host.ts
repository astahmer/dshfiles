import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { NodeServices } from '@effect/platform-node'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
import { fromEffect } from '@dshfiles/session-source-port'
import { Cause, Clock, ConfigProvider, Effect, Exit, Layer, Option, Ref, Schedule, Schema, Scope, Stream } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join, posix } from 'node:path'
import { Api, DshxPlugin, HostContext, hostServiceChanges } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import {
  fileUploadValueSchema,
  jjRepositoriesEffectSchema,
  multiHostApi,
  sessionRepositoryReads,
  sessionRepositoryWrites,
  type ModelSelection,
  type RemoteInteraction,
  type RemoteQuestionAnswer,
} from './api.js'
import type { ConnectionTestStep } from './api.js'
import { Connectors } from './connectors/connectors.js'
import { Loopback } from './connectors/loopback.js'
import { SshConnector } from './connectors/ssh.js'
import { DirectoryListingModel } from './directory-listing.js'
import {
  ConnectorKindMismatch,
  DshMissing,
  failureCodeOf,
  GatewayUnreachable,
  HostNotFound,
  IdentityMismatch,
  LocalProjectFailed,
  NoOfficialNode,
  OriginPortExhausted,
  RemoteHomeUnknown,
  RemoteApiFailed,
  RemoteRequestFailed,
  SessionCursorUnavailable,
  SessionUnavailable,
  type TaggedFailure,
} from './errors.js'
import { HostDirectory } from './host-directory.js'
import { RuntimeIdentity } from './identity.js'
import { LaunchFile } from './launch-file.js'
import { LocalProjectFiles } from './local-project-files.js'
import { readProjectOrigins } from './project-origins.js'
import { NativeRpc } from './native-rpc.js'
import { MultiHostPaths } from './paths.js'
import { hostConnectorSchema, runtimeLocatorSchema, runtimeOriginPort, type HostRecord, type RuntimeRecord } from './records.js'
import { RemoteCheckout } from './remote-checkout.js'
import { RemoteUpdate } from './remote-update.js'
import { RemoteDelegation, type DelegationProgress } from './remote-delegation.js'
import { RemoteDoctor, type RemoteFacts } from './remote-doctor.js'
import { RemoteExec } from './remote-exec.js'
import { RemoteIdentity } from './remote-identity.js'
import { interactionGone, RemoteInteractions } from './remote-interactions.js'
import { RemoteJjScope } from './remote-jj-scope.js'
import { RemotePromptGuard } from './remote-prompt-guard.js'
import { RemoteProvision } from './remote-provision.js'
import { RemoteReferenceContext } from './remote-reference-context.js'
import { RemoteSessions } from './remote-sessions.js'
import { SessionOwners } from './session-owners.js'
import { RemoteThreads } from './remote-threads.js'
import { reduceTranscript } from './transcript.js'
import { ResourceSnapshotModel } from './resource-snapshot.js'
import { ResourcePool, RuntimeStatus } from './runtime-status.js'
import { RuntimePool } from './runtime-pool.js'
import { SchemaFields } from './schema.js'
import { Ssh, shellQuote } from './ssh.js'
import { listSshConfigHosts } from './ssh-config.js'
import { ViewLeases } from './view-leases.js'
import { threadViewUrl } from './thread-launch-url.js'
import { RemoteRuntime } from './remote-runtime.js'
import { createLocalProjectCopyCommand } from './local-project-copy-command.js'
import type { Gateway, RemoteEventOutcome } from './connectors/gateway.js'

const profileSchema = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64), Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/))
const configSchema = Schema.Struct({ profile: Schema.optional(profileSchema) })

const sessionCreatedSchema = Schema.Struct({ sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)) }).pipe(SchemaFields.passthrough)
const directoryListingSchema = Schema.Struct({
  path: Schema.String,
  home: Schema.String,
  crumbs: Schema.Array(Schema.Struct({ name: Schema.String, path: Schema.String, hidden: Schema.Boolean })),
  entries: Schema.Array(Schema.Struct({ name: Schema.String, path: Schema.String, hidden: Schema.Boolean })).check(Schema.isMaxLength(5_000)),
  truncated: Schema.Boolean,
}).pipe(SchemaFields.passthrough)
const workspaceCreatedSchema = Schema.Struct({
  workspace: Schema.Struct({ workspaceId: Schema.String.check(Schema.isMinLength(1)), path: Schema.String.check(Schema.isMinLength(1)) }).pipe(
    SchemaFields.passthrough,
  ),
}).pipe(SchemaFields.passthrough)
const fileReferenceCandidatesSchema = Schema.Array(
  Schema.Struct({ path: Schema.String.check(Schema.isMaxLength(4096)), kind: Schema.Literals(['file', 'directory']) }),
).check(Schema.isMaxLength(1000))
const modelCatalogSchema = Schema.Struct({
  default: Schema.optional(
    Schema.Struct({ provider: Schema.String, model: Schema.String, reasoningEffort: Schema.optional(Schema.String) }).pipe(SchemaFields.passthrough),
  ),
  routableProviders: Schema.optional(Schema.Array(Schema.String)),
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
                Schema.Struct({ id: Schema.String, name: Schema.String, description: Schema.optional(Schema.String) }).pipe(SchemaFields.passthrough),
              ),
              defaultEffort: Schema.optional(Schema.String),
            }).pipe(SchemaFields.passthrough),
          ),
        }).pipe(SchemaFields.passthrough),
      ),
    }).pipe(SchemaFields.passthrough),
  ),
  failures: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String, message: Schema.String }).pipe(SchemaFields.passthrough))),
}).pipe(SchemaFields.passthrough)
const sessionSnapshotSchema = Schema.Struct({
  type: Schema.Literal('snapshot'),
  cursor: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()),
  header: Schema.optional(Schema.Struct({ cwd: Schema.optional(Schema.String) }).pipe(SchemaFields.passthrough)),
  records: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(10_000)),
}).pipe(SchemaFields.passthrough)
const sessionCursorFrameSchema = Schema.Struct({
  type: Schema.Literal('snapshot'),
  cursor: Schema.Number.check(Schema.isFinite())
    .check(Schema.isInt())
    .check(Schema.isBetween({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }))
    .check(Schema.isGreaterThanOrEqualTo(-1)),
}).pipe(SchemaFields.passthrough)
const webServerSchema = Schema.Struct({
  port: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(65_535)),
}).pipe(SchemaFields.passthrough)

const decodeDirectoryListing = Schema.decodeUnknownEffect(directoryListingSchema)
const decodeWorkspaceCreated = Schema.decodeUnknownEffect(workspaceCreatedSchema)
const decodeSessionCreated = Schema.decodeUnknownEffect(sessionCreatedSchema)
const decodeModelCatalog = Schema.decodeUnknownEffect(modelCatalogSchema)
const decodeSnapshot = Schema.decodeUnknownOption(sessionSnapshotSchema)
const decodeCursorFrame = Schema.decodeUnknownOption(sessionCursorFrameSchema)
const decodeFileReferences = Schema.decodeUnknownEffect(fileReferenceCandidatesSchema)
const decodeUploadValue = Schema.decodeUnknownEffect(fileUploadValueSchema)
const decodeJjRepositories = Schema.decodeUnknownEffect(jjRepositoriesEffectSchema)
const decodeAccepted = Schema.decodeUnknownEffect(Schema.Boolean)
const decodeCreatedPath = Schema.decodeUnknownEffect(Schema.Struct({ path: Schema.String }))
const decodeConnector = Schema.decodeUnknownEffect(hostConnectorSchema, { onExcessProperty: 'error' })
const decodeLocator = Schema.decodeUnknownEffect(runtimeLocatorSchema, { onExcessProperty: 'error' })
const decodeWebServer = Schema.decodeUnknownOption(webServerSchema)

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'multi-host-remote-reference': {
      readonly kind: 'multi-host-remote-reference'
      readonly form: 'recall'
      readonly references: readonly {
        readonly sessionId: string
        readonly label: string
        readonly capturedThroughSeq: number
      }[]
    }
  }
}

/** A value handler's `{ ok: false, code, message }`: the failure it names, as the contract's own failure shape. */
/** The plugin API behind each allowlisted peer read (`remotePeerReadCalls`), by api id. */
const peerReadTargets = new Map([['backlog', { packageId: '@dshfiles/backlog', apiId: 'backlog', version: 1 }]])

const failed = (error: unknown) =>
  isTaggedFailure(error)
    ? { code: failureCodeOf(error), message: error.message }
    : { code: 'runtime-unavailable', message: 'The runtime request failed. Check the host status and reconnect if needed.' }

/** The failure a Host service reports, as a value a client shows: its wire code and message. */
const unavailable = (): { readonly ok: false; readonly code: string; readonly message: string } => ({
  ok: false,
  code: 'runtime-unavailable',
  message: 'The runtime request failed. Check the host status and reconnect if needed.',
})

/** A native RPC result that says the connection, not the request, failed. */
const brokenRpc = (result: { readonly ok: boolean; readonly code?: string }): boolean =>
  !result.ok && (result.code === 'unknown-mutation-outcome' || (result.code !== undefined && isTransportCode(result.code)))

const isTransportCode = (code: string): boolean =>
  ['gateway-unreachable', 'authentication-expired', 'stream-unreachable', 'stream-closed', 'api-unreachable', 'gateway-request-failed'].includes(code)

/** A runtime record with its live connection state. */
const runtimeSummary = (input: {
  readonly record: RuntimeRecord
  readonly connected: boolean
  readonly lastError: { readonly code: string; readonly message: string; readonly at: string } | undefined
}) => ({
  id: input.record.id,
  hostId: input.record.hostId,
  name: input.record.name,
  identity: input.record.identity,
  ...(input.record.locator.kind === 'ssh' && { remoteHome: input.record.locator.remoteHome }),
  ...(input.record.lastSeenAt !== undefined && { lastSeenAt: input.record.lastSeenAt }),
  connected: input.connected,
  ...(input.lastError !== undefined && { lastError: input.lastError }),
})

const hostSummary = (input: { readonly record: HostRecord; readonly runtimes: readonly RuntimeRecord[] }) => ({
  id: input.record.id,
  name: input.record.name,
  connector: input.record.connector,
  runtimeCount: input.runtimes.filter(runtime => runtime.hostId === input.record.id).length,
  hidden: input.record.hidden,
  ...(input.record.weight !== undefined && { weight: input.record.weight }),
  ...(input.record.fetchBeforeThread !== undefined && { fetchBeforeThread: input.record.fetchBeforeThread }),
})

/** The remote home a locator targets, or the one the probe read; a target with neither cannot be reached. */
const remoteHomeOf = (input: { readonly facts: RemoteFacts; readonly requested: string | undefined }) => {
  if (input.requested !== undefined) return Effect.succeed(input.requested)
  if (input.facts.home === undefined) return Effect.fail(new RemoteHomeUnknown())
  return Effect.succeed(`${input.facts.home}/.dsh`)
}

const startPathDirectories = (input: { readonly facts: RemoteFacts; readonly nodePath: string }): string[] =>
  [
    posix.dirname(input.nodePath),
    input.facts.dsh.path === undefined ? undefined : posix.dirname(input.facts.dsh.path),
    input.facts.pnpm.path === undefined ? undefined : posix.dirname(input.facts.pnpm.path),
    input.facts.home === undefined ? undefined : `${input.facts.home}/.local/share/pnpm/bin`,
  ].filter((directory): directory is string => directory !== undefined && directory !== '.')

const officialNodeOf = (input: { readonly facts: RemoteFacts; readonly minimum?: string }): string | undefined => {
  const official = RemoteDoctor.officialNodePath({ nodes: input.facts.fnm.nodes, minimum: input.minimum ?? '22.19.0' })
  return input.facts.node.nix ? official : (input.facts.node.path ?? official)
}

const sshHostId = (sshTarget: string): string =>
  sshTarget
    .replace(/^[^@]*@/, '')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .slice(0, 64) || 'host'

/** The pooled request of a handler: `use` retries a dropped connection once for a read and never for a mutation. */
const withRuntime = <A, E>(
  runtimeId: string,
  request: (gateway: Gateway) => Effect.Effect<A, E>,
  options: { readonly mutation: boolean; readonly broken?: (result: A) => boolean },
) =>
  Effect.gen(function* () {
    const pool = yield* RuntimePool
    const marker = new GatewayUnreachable()
    const last = { value: undefined as A | undefined }
    return yield* pool
      .use(
        runtimeId,
        gateway =>
          request(gateway).pipe(
            Effect.flatMap(value => {
              if (options.broken?.(value) !== true) return Effect.succeed(value)
              last.value = value
              return Effect.fail(marker)
            }),
          ),
        { mutation: options.mutation },
      )
      .pipe(
        Effect.catchIf(
          error => error === marker,
          () => (last.value === undefined ? Effect.fail(marker) : Effect.succeed(last.value)),
        ),
      )
  })

/** Probe one SSH target and DSH home and pin its identity; shared by the add-host test and the save. */
type QualifyStep = { step: ConnectionTestStep['step']; ok: boolean; ms: number; code?: string; message?: string }

const qualifyRuntime = Effect.fn('multi-host runtime qualify')(function* (input: {
  readonly host: HostRecord
  readonly locator: RuntimeRecord['locator']
  readonly name: string
  /** Receives each step as it settles, so a caller still sees the hops that ran when a later one fails. */
  readonly steps?: Array<QualifyStep>
}) {
  const steps = input.steps ?? []
  const timed = <A, E, R>(step: ConnectionTestStep['step'], run: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis
      const outcome = yield* Effect.exit(run)
      const ms = (yield* Clock.currentTimeMillis) - startedAt
      if (outcome._tag === 'Success') {
        steps.push({ step, ok: true, ms })
        return outcome.value
      }
      const error = Option.getOrElse(Cause.findErrorOption(outcome.cause), () => undefined)
      steps.push({
        step,
        ok: false,
        ms,
        ...(error !== undefined && error instanceof Error && isTagged(error)
          ? { code: failureCodeOf(error), message: error.message }
          : { code: 'runtime-unavailable', message: 'The connection step failed.' }),
      })
      return yield* Effect.failCause(outcome.cause)
    })

  if (input.host.connector.kind === 'ssh') {
    const sshTarget = input.host.connector.sshTarget
    yield* timed('ssh', SshConnector.probe({ sshTarget }))
  }
  const provisional: RuntimeRecord = {
    schemaVersion: 2,
    id: randomUUID(),
    hostId: input.host.id,
    name: input.name,
    locator: input.locator,
    identity: null,
    createdAt: new Date().toISOString(),
  }
  const identity = yield* timed(
    'runtime',
    Effect.scoped(
      Effect.gen(function* () {
        const connectors = yield* Connectors
        const gateway = yield* connectors.connect({ host: input.host, runtime: provisional })
        return yield* timed('identity', RemoteIdentity.read(gateway))
      }),
    ),
  )
  if (input.locator.kind === 'ssh' && identity.homeLeaf !== basename(input.locator.remoteHome)) return yield* new IdentityMismatch({ reason: 'selected-home' })
  return { identity, steps }
})

/** Reserve this runtime's stable loopback origin port; the first one no other registration holds wins. */
const allocateOriginPort = Effect.fnUntraced(function* (
  runtimeId: string,
  directory: { readonly retiredPorts: readonly number[]; readonly runtimes: readonly RuntimeRecord[] },
) {
  const unavailable = new Set<number>()
  for (const port of directory.retiredPorts) unavailable.add(port)
  for (const runtime of directory.runtimes) if (runtime.originPort !== undefined) unavailable.add(runtime.originPort)
  for (let attempt = 0; attempt < 20_000; attempt += 1) {
    const port = runtimeOriginPort(runtimeId, [...unavailable])
    const free = yield* Loopback.reserve(port).pipe(
      Effect.as(true),
      Effect.catchTag('LoopbackUnavailable', () => Effect.succeed(false)),
    )
    if (free) return port
    unavailable.add(port)
  }
  return yield* new OriginPortExhausted()
})

/** Probe, verify and persist one runtime record for a host. */
const register = Effect.fn('multi-host runtime register')(function* (input: {
  readonly host: HostRecord
  readonly locator: RuntimeRecord['locator']
  readonly name: string
}) {
  const directory = yield* HostDirectory
  const pool = yield* RuntimePool
  const { identity } = yield* qualifyRuntime(input)
  const current = yield* directory.read
  const existing = current.runtimes.find(runtime => runtime.id === identity.runtimeId)
  if (existing !== undefined && existing.hostId !== input.host.id) return yield* new IdentityMismatch({ reason: 'other-host' })
  const originPort = existing?.originPort ?? (yield* allocateOriginPort(identity.runtimeId, current))
  yield* pool.invalidate(identity.runtimeId)
  return yield* directory.upsertRuntime({
    schemaVersion: 2,
    id: identity.runtimeId,
    hostId: input.host.id,
    name: input.name,
    locator: input.locator,
    identity,
    originPort,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  })
})

/** One runtime row with its live pooled state. */
const runtimeSummaryOf = (record: RuntimeRecord, pool: RuntimePool['Service']) =>
  Effect.gen(function* () {
    const generation = yield* pool.generation(record.id)
    return runtimeSummary({ record, connected: generation !== undefined, lastError: yield* pool.lastError(record.id) })
  })

const isTagged = (error: Error): error is Error & { readonly _tag: string } => '_tag' in error && typeof error._tag === 'string'

const isTaggedFailure = (error: unknown): error is TaggedFailure & { readonly message: string } => error instanceof Error && isTagged(error)

/** What creating or starting a remote thread reports: the Session id survives a failure that already created it. */
type SessionStartOutcome =
  | { readonly ok: true; readonly sessionId: string; readonly fetch?: { readonly ok: boolean; readonly detail: string } }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly sessionId?: string }

const threadRefused = (input: { readonly code: string; readonly message: string; readonly sessionId?: string }): SessionStartOutcome => ({
  ok: false,
  code: input.code,
  message: input.message,
  ...(input.sessionId !== undefined && { sessionId: input.sessionId }),
})

type ThreadStartInput = {
  readonly runtimeId: string
  readonly cwd: string
  readonly text: string
  readonly agentPreset?: string | undefined
  readonly model?: ModelSelection | undefined
}

/** A failed fetch never blocks the thread: the thread starts on what the host has and the result says why. */
const fetchBeforeThread = Effect.fn('multi-host fetch before thread')(function* (input: { readonly sshTarget: string; readonly cwd: string }) {
  return yield* RemoteExec.run({ sshTarget: input.sshTarget, command: RemoteCheckout.fetchBeforeThreadCommand(input.cwd), timeoutMs: 60_000 }).pipe(
    Effect.map(result =>
      result.ok
        ? { ok: true, detail: 'fetched before the thread started' }
        : { ok: false, detail: `jj git fetch failed on the host: ${result.stderr.trim().split('\n').at(-1) ?? `exit ${String(result.code)}`}` },
    ),
    Effect.catch(error => Effect.succeed({ ok: false, detail: `jj git fetch could not run on the host: ${failed(error).message}` })),
  )
})

/** What a runtime answers for a plugin it does not run. */
const pluginNotServed = 'api-not-served'

/** A remote plugin call that failed; a mutation whose reply was lost may have applied, so it is not reported as refused. */
const pluginCallFailure = (input: { readonly error: unknown; readonly mutation: boolean }) => {
  if (input.error instanceof RemoteApiFailed && input.error.code === pluginNotServed) {
    return {
      ok: false as const,
      code: pluginNotServed,
      message: 'This host does not have the plugin for that. Update DSH there, or open the thread on its host.',
    }
  }
  return input.mutation && isTaggedFailure(input.error) && NativeRpc.mayHaveReachedRuntime(input.error)
    ? { ok: false as const, code: 'unknown-mutation-outcome', message: 'The connection dropped after the request was sent; check the host before retrying.' }
    : { ok: false as const, ...failed(input.error) }
}

/** The runtime that owns a mirrored Session, as the Session controller authorizes it; a local Session has none. */
const sessionOwner = Effect.fn('multi-host session owner')(function* (sessionId: string) {
  const threads = yield* RemoteThreads
  const owners = yield* SessionOwners
  const recordedSessions = yield* threads.list
  const recorded = recordedSessions.find(thread => thread.sessionId === sessionId)
  const runtimeId = recorded?.runtimeId ?? (yield* owners.knownRuntime(sessionId))
  if (runtimeId === null) return { ok: false as const, code: 'session/not-remote', message: 'This Session has no known remote owner.' }
  const authorization = yield* owners.authorize({ sessionId, runtimeId, recordedSessions })
  return authorization.ok ? { ok: true as const, runtimeId } : authorization
})

const interactionKindMismatch = { ok: false as const, code: 'interaction-kind-mismatch', message: 'This request needs a different kind of answer.' }

/** One held request, once the Session controller agrees its Session belongs to the runtime that sent it. */
const heldInteraction = (input: { readonly sessionId: string; readonly id: string }) =>
  Effect.gen(function* () {
    const interactions = yield* RemoteInteractions
    const interaction = yield* interactions.find(input)
    if (interaction === undefined) return interactionGone
    const threads = yield* RemoteThreads
    const owners = yield* SessionOwners
    const authorization = yield* owners.authorize({ sessionId: input.sessionId, runtimeId: interaction.runtimeId, recordedSessions: yield* threads.list })
    return authorization.ok ? { ok: true as const, interaction } : authorization
  }).pipe(Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })))

/** Answer the owner; a reply lost after sending may hide an applied answer, so it is never reported as safe to repeat. */
const settleHeld = (input: { readonly interaction: RemoteInteraction; readonly outcome: RemoteEventOutcome }) =>
  Effect.flatMap(RemoteInteractions, interactions => interactions.settle(input)).pipe(
    Effect.catch(error =>
      Effect.succeed(
        error instanceof RemoteRequestFailed
          ? { ok: false as const, ...failed(error) }
          : {
              ok: false as const,
              code: 'unknown-mutation-outcome',
              message: 'The connection failed after the answer was sent, so it may have reached the host. Check the thread before answering again.',
            },
      ),
    ),
  )

/** The answer batch as lossless wire JSON: an absent `custom` stays absent. */
const answerValue = (answer: RemoteQuestionAnswer) => ({
  answers: answer.answers.map(item => ({ id: item.id, selected: [...item.selected], ...(item.custom !== undefined && { custom: item.custom }) })),
})

/** Sent outside the composer, a message to a remote thread obeys the same rule as one the Session source forwards. */
const localPathRefusal = Effect.fn('multi-host local path refusal')(function* (input: {
  readonly runtimeId: string
  readonly sessionId?: string
  readonly cwd?: string
  readonly text: string
}) {
  const directory = yield* HostDirectory
  const threads = yield* RemoteThreads
  const runtime = yield* directory.findRuntime(input.runtimeId).pipe(Effect.orElseSucceed(() => undefined))
  const recordedCwd = (yield* threads.list.pipe(Effect.orElseSucceed(() => []))).find(thread => thread.sessionId === input.sessionId)?.cwd
  const message = RemotePromptGuard.localPathRefusal({
    text: input.text,
    cwd: input.cwd ?? recordedCwd,
    localHome: homedir(),
    hostName: runtime?.name ?? 'the remote host',
  })
  return message === undefined ? undefined : { ok: false as const, code: 'prompt-local-path', message }
})

const startRemoteThread = Effect.fn('multi-host thread start')(function* (input: ThreadStartInput) {
  const directory = yield* HostDirectory
  const threads = yield* RemoteThreads
  const runtime = yield* directory.findRuntime(input.runtimeId)
  if (runtime === undefined) return threadRefused({ code: 'runtime-not-found', message: 'This host is no longer recorded.' })
  const refused = yield* localPathRefusal({ runtimeId: input.runtimeId, cwd: input.cwd, text: input.text })
  if (refused !== undefined) return threadRefused({ code: refused.code, message: refused.message })
  const host = yield* directory.findHost(runtime.hostId)
  const fetch =
    host?.fetchBeforeThread === true && host.connector.kind === 'ssh'
      ? yield* fetchBeforeThread({ sshTarget: host.connector.sshTarget, cwd: input.cwd })
      : undefined
  const state: { sessionId: string | undefined } = { sessionId: undefined }
  return yield* withRuntime(
    runtime.id,
    gateway =>
      Effect.gen(function* () {
        const created = yield* NativeRpc.call(gateway, {
          namespace: 'session',
          method: 'create',
          args: { request: { cwd: input.cwd, ...(input.agentPreset !== undefined && { agentPreset: input.agentPreset }) } },
        })
        if (!created.ok) return threadRefused({ code: created.code, message: created.message })
        const sessionId = (yield* decodeSessionCreated(created.value)).sessionId
        state.sessionId = sessionId
        if (input.model !== undefined) {
          const model = input.model
          yield* gateway.run({
            namespace: 'session',
            method: 'selectModel',
            args: {
              request: {
                sessionId,
                provider: model.provider,
                model: model.model,
                ...(model.reasoningEffort !== undefined && { reasoningEffort: model.reasoningEffort }),
              },
            },
          })
        }
        yield* threads.record({ runtimeId: runtime.id, sessionId, cwd: input.cwd, title: input.text.slice(0, 80), createdAt: new Date().toISOString() })
        const prompted = yield* NativeRpc.call(gateway, {
          namespace: 'session',
          method: 'prompt',
          args: { request: { requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: input.text }] } },
        })
        if (!prompted.ok) return threadRefused({ code: prompted.code, message: prompted.message, sessionId })
        return { ok: true as const, sessionId, ...(fetch !== undefined && { fetch }) }
      }).pipe(Effect.map((outcome): SessionStartOutcome => outcome)),
    { mutation: true, broken: brokenRpc },
  ).pipe(Effect.catch(error => Effect.succeed(threadRefused({ ...failed(error), ...(state.sessionId !== undefined && { sessionId: state.sessionId }) }))))
})

const readRemoteTranscript = Effect.fn('multi-host thread transcript')(function* (input: {
  readonly runtimeId: string
  readonly sessionId: string
  readonly maxMessages?: number | undefined
}) {
  return yield* withRuntime(
    input.runtimeId,
    gateway =>
      Effect.flatMap(
        gateway.follow({
          endpoint: 'session/follow',
          args: { request: { address: { kind: 'session', sessionId: input.sessionId }, maxMessages: input.maxMessages ?? 60 } },
          timeout: 15_000,
        }),
        frames =>
          Effect.gen(function* () {
            const snapshot = frames.flatMap(frame => Option.toArray(decodeSnapshot(frame)))[0]
            if (snapshot === undefined) return yield* new SessionUnavailable()
            const reduced = reduceTranscript(snapshot.records)
            return {
              ok: true as const,
              cursor: snapshot.cursor,
              ...(snapshot.header?.cwd !== undefined && { cwd: snapshot.header.cwd }),
              ...(reduced.title !== undefined && { title: reduced.title }),
              ...(reduced.model !== undefined && { model: reduced.model }),
              ...(reduced.waiting !== undefined && { waiting: reduced.waiting }),
              running: reduced.running,
              entries: reduced.entries,
            }
          }),
      ),
    { mutation: false },
  ).pipe(Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })))
})

const stopRemoteThread = Effect.fn('multi-host thread stop')(function* (input: { readonly runtimeId: string; readonly sessionId: string }) {
  return yield* withRuntime(
    input.runtimeId,
    gateway => NativeRpc.call(gateway, { namespace: 'session', method: 'cancel', args: { request: { sessionId: input.sessionId } } }),
    { mutation: true, broken: brokenRpc },
  ).pipe(
    Effect.map(() => ({ ok: true as const })),
    Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })),
  )
})

const handlers = Api.handlers(multiHostApi, {
  identity: Effect.fn('multi-host identity')(function* () {
    const identity = yield* RuntimeIdentity
    return yield* identity.current
  }),
  resourceSnapshot: Effect.fn('multi-host resource snapshot')(() => Effect.sync(() => ResourceSnapshotModel.readResourceSnapshot())),
  resourcePool: Effect.fn('multi-host resource pool')(function* () {
    const resources = yield* ResourcePool
    return yield* resources.read
  }),
  list: Effect.fn('multi-host list')(function* () {
    const directory = yield* HostDirectory
    const pool = yield* RuntimePool
    const { hosts, runtimes } = yield* directory.read
    const summaries = yield* Effect.forEach(runtimes, runtime =>
      Effect.gen(function* () {
        const generation = yield* pool.generation(runtime.id)
        const lastError = yield* pool.lastError(runtime.id)
        return runtimeSummary({ record: runtime, connected: generation !== undefined, lastError })
      }),
    )
    return { hosts: hosts.map(record => hostSummary({ record, runtimes })), runtimes: summaries }
  }),
  remoteExec: Effect.fn('multi-host remote exec')(function* (input) {
    const result = yield* RemoteExec.run({ sshTarget: input.sshTarget, command: input.command, cwd: input.cwd, timeoutMs: input.timeoutMs }).pipe(
      Effect.map(result => ({
        ok: true as const,
        code: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
      })),
      Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })),
    )
    return result
  }),
  doctor: Effect.fn('multi-host doctor')(function* (input) {
    return yield* RemoteDoctor.readFacts({ sshTarget: input.sshTarget, profile: input.profile, checkoutPath: input.checkoutPath }).pipe(
      Effect.map(facts => ({
        ok: true as const,
        facts,
        diagnostics: RemoteDoctor.diagnose({ facts, expected: { profile: input.profile, dshVersion: input.dshVersion } }),
      })),
      Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })),
    )
  }),
  provision: Effect.fn('multi-host provision')(function* (input) {
    return yield* Effect.gen(function* () {
      const facts = yield* RemoteDoctor.readFacts({ sshTarget: input.sshTarget, profile: input.profile, checkoutPath: input.checkoutPath })
      const options = {
        remoteHome: input.remoteHome,
        checkoutPath: input.checkoutPath ?? facts.checkout.path,
        profile: input.profile,
        dshVersion: input.dshVersion,
        nodeVersion: input.nodeVersion,
        repository: input.repository,
        revision: input.revision,
      }
      const run = yield* RemoteProvision.run({ sshTarget: input.sshTarget, facts, options, steps: input.steps, confirm: input.confirm, dryRun: input.dryRun })
      return { ok: true as const, plan: RemoteProvision.plan({ facts, options }), executed: run.executed, remaining: run.remaining }
    }).pipe(Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })))
  }),
  remoteRuntimeStatus: Effect.fn('multi-host remote runtime status')(function* (input) {
    return yield* Effect.gen(function* () {
      const facts = yield* RemoteDoctor.readFacts({ sshTarget: input.sshTarget, profile: 'web' })
      const status = yield* RemoteRuntime.readStatus({ sshTarget: input.sshTarget, remoteHome: yield* remoteHomeOf({ facts, requested: input.remoteHome }) })
      return { ok: true as const, status }
    }).pipe(Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })))
  }),
  runtimeControl: Effect.fn('multi-host runtime control')(function* (input) {
    return yield* Effect.gen(function* () {
      const facts = yield* RemoteDoctor.readFacts({ sshTarget: input.sshTarget, profile: input.profile, checkoutPath: input.checkoutPath })
      const remoteHome = yield* remoteHomeOf({ facts, requested: input.remoteHome })
      const before = yield* RemoteRuntime.readStatus({ sshTarget: input.sshTarget, remoteHome })
      if (input.action === 'stop') {
        if (!before.running || before.pid === undefined)
          return { ok: true as const, action: 'stop' as const, detail: 'no running remote runtime', status: before }
        const stopped = yield* RemoteExec.run({ sshTarget: input.sshTarget, command: RemoteRuntime.stopCommand({ pid: before.pid }), timeoutMs: 30_000 })
        const status = yield* RemoteRuntime.readStatus({ sshTarget: input.sshTarget, remoteHome })
        return { ok: true as const, action: 'stop' as const, detail: stopped.stdout.trim() || stopped.stderr.trim() || 'stop requested', status }
      }
      if (before.running && before.listening)
        return { ok: true as const, action: 'start' as const, detail: `already running on port ${before.port ?? 'unknown'}`, status: before }
      const nodePath = officialNodeOf({ facts })
      if (nodePath === undefined) return yield* new NoOfficialNode()
      if (facts.dsh.path === undefined) return yield* new DshMissing()
      const command = RemoteRuntime.startCommand({
        remoteHome,
        checkoutPath: input.checkoutPath ?? facts.checkout.path,
        profile: input.profile,
        dshPath: facts.dsh.path,
        platform: facts.uname.startsWith('Darwin') ? 'Darwin' : undefined,
        pathDirectories: startPathDirectories({ facts, nodePath }),
      })
      yield* RemoteExec.run({
        sshTarget: input.sshTarget,
        command: `${command}\n${RemoteRuntime.waitForLaunchCommand({ remoteHome })}`,
        timeoutMs: 120_000,
      })
      const status = yield* RemoteRuntime.readStatus({ sshTarget: input.sshTarget, remoteHome })
      return {
        ok: true as const,
        action: 'start' as const,
        detail: status.running ? `running on port ${status.port ?? 'unknown'}` : 'started but no launch file yet',
        status,
      }
    }).pipe(Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })))
  }),
  runtimeLogs: Effect.fn('multi-host runtime logs')(function* (input) {
    return yield* Effect.gen(function* () {
      const facts = yield* RemoteDoctor.readFacts({ sshTarget: input.sshTarget, profile: 'web' })
      const logFile = RemoteRuntime.logPath({ remoteHome: yield* remoteHomeOf({ facts, requested: input.remoteHome }) })
      const result = yield* RemoteExec.run({
        sshTarget: input.sshTarget,
        command: RemoteRuntime.logsCommand({ logFile, lines: input.lines }),
        timeoutMs: 20_000,
      })
      return { ok: true as const, logFile, tail: result.stdout }
    }).pipe(Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })))
  }),
  checkoutSync: Effect.fn('multi-host checkout sync')(function* (input) {
    return yield* Effect.gen(function* () {
      const result = yield* RemoteCheckout.run(input)
      const directory = yield* HostDirectory
      const threads = yield* RemoteThreads
      const hosts = (yield* directory.listHosts).filter(host => host.connector.kind === 'ssh' && host.connector.sshTarget === input.sshTarget)
      const runtimes = (yield* Effect.forEach(hosts, host => directory.listRuntimes(host.id))).flat()
      return RemoteCheckout.withThreads({ result, threads: (yield* threads.list).filter(thread => runtimes.some(runtime => runtime.id === thread.runtimeId)) })
    }).pipe(Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })))
  }),
  sshConfigHosts: Effect.fn('multi-host ssh config hosts')(function* () {
    return { hosts: yield* listSshConfigHosts(join(homedir(), '.ssh')) }
  }),
  discoverHomes: Effect.fn('multi-host discover homes')(function* (input) {
    return yield* SshConnector.discoverHomes({ sshTarget: input.sshTarget }).pipe(
      Effect.map(homes => ({ ok: true as const, homes })),
      Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })),
    )
  }),
  testConnection: Effect.fn('multi-host test connection')(function* (input) {
    return yield* Effect.gen(function* () {
      const connector = yield* decodeConnector({ kind: 'ssh', sshTarget: input.sshTarget })
      const locator = yield* decodeLocator({ kind: 'ssh', remoteHome: input.remoteHome })
      const host: HostRecord = {
        schemaVersion: 2,
        id: sshHostId(input.sshTarget),
        name: input.name,
        connector,
        hidden: false,
        createdAt: new Date().toISOString(),
      }
      const steps: Array<QualifyStep> = []
      return yield* qualifyRuntime({ host, locator, name: input.name, steps }).pipe(
        Effect.map(({ identity }) => ({ ok: true as const, steps, identity })),
        Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error), steps })),
      )
    })
  }),
  saveSshHost: Effect.fn('multi-host save ssh host')(function* (input) {
    return yield* Effect.gen(function* () {
      const directory = yield* HostDirectory
      const pool = yield* RuntimePool
      const connector = yield* decodeConnector({ kind: 'ssh', sshTarget: input.sshTarget })
      const previous = input.hostId === undefined ? undefined : yield* directory.findHost(input.hostId)
      const host: HostRecord = {
        schemaVersion: 2,
        id: previous?.id ?? sshHostId(input.sshTarget),
        name: input.name.trim(),
        connector,
        hidden: previous?.hidden ?? false,
        ...(previous?.position !== undefined && { position: previous.position }),
        createdAt: previous?.createdAt ?? new Date().toISOString(),
      }
      const locator = yield* decodeLocator({ kind: 'ssh', remoteHome: input.remoteHome })
      yield* directory.upsertHost(host)
      const runtime = yield* register({ host, locator, name: input.name.trim() })
      // An edit that moved the host to another DSH home leaves the old runtime record behind.
      for (const stale of (yield* directory.listRuntimes(host.id)).filter(item => item.id !== runtime.id)) {
        yield* directory.removeRuntime(stale.id)
        yield* pool.invalidate(stale.id)
      }
      const summary = yield* runtimeSummaryOf(runtime, pool)
      return { ok: true as const, runtime: summary }
    }).pipe(Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })))
  }),
  hostUpsert: Effect.fn('multi-host host upsert')(function* (input) {
    const directory = yield* HostDirectory
    const connector = yield* decodeConnector(input.connector)
    const previous = yield* directory.findHost(input.id)
    const record: HostRecord = {
      schemaVersion: 2,
      id: input.id.trim(),
      name: input.name.trim(),
      connector,
      hidden: previous?.hidden ?? false,
      ...(previous?.position !== undefined && { position: previous.position }),
      createdAt: previous?.createdAt ?? new Date().toISOString(),
    }
    yield* directory.upsertHost(record)
    return hostSummary({ record, runtimes: yield* directory.listRuntimes() })
  }),
  hostSetHidden: Effect.fn('multi-host host set hidden')(function* (input) {
    const directory = yield* HostDirectory
    const record = yield* directory.setHostHidden(input)
    return hostSummary({ record, runtimes: yield* directory.listRuntimes() })
  }),
  hostSetSettings: Effect.fn('multi-host host set settings')(function* (input) {
    const directory = yield* HostDirectory
    const record = yield* directory.setHostSettings(input)
    return hostSummary({ record, runtimes: yield* directory.listRuntimes() })
  }),
  hostReorder: Effect.fn('multi-host host reorder')(function* (input) {
    const directory = yield* HostDirectory
    const runtimes = yield* directory.listRuntimes()
    const hosts = yield* directory.reorderHosts(input.ids)
    return { hosts: hosts.map(record => hostSummary({ record, runtimes })) }
  }),
  hostRemove: Effect.fn('multi-host host remove')(function* (input) {
    const directory = yield* HostDirectory
    const pool = yield* RuntimePool
    const leases = yield* ViewLeases
    const runtimes = input.removeDirectory ? yield* directory.listRuntimes(input.id) : []
    const removed = yield* directory.removeHost({ id: input.id, removeDirectory: input.removeDirectory })
    if (removed) {
      for (const runtime of runtimes) {
        yield* leases.closeRuntime(runtime.id)
        yield* pool.invalidate(runtime.id)
      }
    }
    return { removed }
  }),
  runtimeUpsert: Effect.fn('multi-host runtime upsert')(function* (input) {
    return yield* Effect.gen(function* () {
      const directory = yield* HostDirectory
      const pool = yield* RuntimePool
      const host = yield* directory.findHost(input.hostId)
      if (host === undefined) return yield* new HostNotFound({ hostId: input.hostId })
      const locator = yield* decodeLocator(input.locator)
      if (locator.kind !== host.connector.kind) return yield* new ConnectorKindMismatch()
      const runtime = yield* register({ host, locator, name: input.name.trim() })
      return { ok: true as const, runtime: yield* runtimeSummaryOf(runtime, pool) }
    }).pipe(Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })))
  }),
  hostUpdate: Effect.fn('multi-host host update')(function* (input) {
    return yield* Effect.gen(function* () {
      const directory = yield* HostDirectory
      const host = yield* directory.findHost(input.hostId)
      if (host === undefined) return yield* new HostNotFound({ hostId: input.hostId })
      if (host.connector.kind !== 'ssh') return yield* new ConnectorKindMismatch()
      const sshTarget = host.connector.sshTarget
      const facts = yield* RemoteDoctor.readFacts({ sshTarget, profile: 'web', checkoutPath: undefined })
      return yield* RemoteUpdate.run({ sshTarget, facts, nodePath: officialNodeOf({ facts }), bookmark: input.bookmark, apply: input.apply })
    }).pipe(Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })))
  }),
  runtimeStatus: Effect.fn('multi-host runtime status')(function* (input) {
    const status = yield* RuntimeStatus
    return yield* status.status(input.runtimeId)
  }),
  projectOrigins: readProjectOrigins,
  runtimePing: Effect.fn('multi-host runtime ping')(function* (input) {
    const startedAt = yield* Clock.currentTimeMillis
    return yield* withRuntime(input.runtimeId, gateway => gateway.api('identity', undefined), { mutation: false }).pipe(
      Effect.map(() => ({ ok: true as const, ms: 0 })),
      Effect.flatMap(result => Effect.map(Clock.currentTimeMillis, now => ({ ok: result.ok, ms: Math.max(0, Math.round(now - startedAt)) }))),
      Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })),
    )
  }),
  runtimeReconnect: Effect.fn('multi-host runtime reconnect')(function* (input) {
    const status = yield* RuntimeStatus
    const resources = yield* ResourcePool
    const pool = yield* RuntimePool
    yield* status.invalidate(input.runtimeId)
    yield* resources.invalidate(input.runtimeId)
    yield* pool.invalidate(input.runtimeId)
    yield* pool.clearError(input.runtimeId)
    return yield* withRuntime(input.runtimeId, () => Effect.void, { mutation: false }).pipe(
      Effect.map(() => ({ ok: true as const })),
      Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })),
    )
  }),
  listDirectory: Effect.fn('multi-host list directory')(function* (input) {
    return yield* DirectoryListingModel.list(input.path)
  }),
  createDirectory: Effect.fn('multi-host create directory')(function* (input) {
    return { path: yield* DirectoryListingModel.createChild(input) }
  }),
  runtimeBrowse: Effect.fn('multi-host runtime browse')(function* (input) {
    return yield* withRuntime(
      input.runtimeId,
      gateway => Effect.flatMap(gateway.api('listDirectory', input.path === undefined ? {} : { path: input.path }), decodeDirectoryListing),
      { mutation: false },
    ).pipe(
      Effect.map(listing => ({
        ok: true as const,
        path: listing.path,
        home: listing.home,
        crumbs: listing.crumbs,
        entries: listing.entries.slice(0, 2_000),
        truncated: listing.truncated || listing.entries.length > 2_000,
      })),
      Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })),
    )
  }),
  runtimeOpenFolder: Effect.fn('multi-host runtime open folder')(function* (input) {
    return yield* withRuntime(
      input.runtimeId,
      gateway => Effect.flatMap(gateway.run({ namespace: 'workspace', method: 'create', args: { request: { path: input.path } } }), decodeWorkspaceCreated),
      { mutation: true },
    ).pipe(
      Effect.map(created => ({ ok: true as const, workspaceId: created.workspace.workspaceId, path: created.workspace.path })),
      Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })),
    )
  }),
  localProjectFiles: Effect.fn('multi-host local project files')(function* (input) {
    return yield* LocalProjectFiles.list({ path: input.path, includeIgnored: input.includeIgnored }).pipe(
      Effect.map(result => ({ ok: true as const, root: result.root, files: [...result.files], truncated: result.truncated })),
      Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })),
    )
  }),
  runtimeCloneProject: Effect.fn('multi-host runtime clone project')(function* (input) {
    return yield* Effect.gen(function* () {
      const directory = yield* HostDirectory
      const runtime = yield* directory.findRuntime(input.runtimeId)
      if (runtime === undefined) return { ok: false as const, code: 'runtime-missing', message: 'That remote runtime is no longer registered.' }
      const host = yield* directory.findHost(runtime.hostId)
      if (host === undefined || host.connector.kind !== 'ssh')
        return { ok: false as const, code: 'ssh-required', message: 'Cloning requires an SSH-connected host.' }
      const sshTarget = host.connector.sshTarget
      const listing = yield* withRuntime(input.runtimeId, gateway => Effect.flatMap(gateway.api('listDirectory', {}), decodeDirectoryListing), {
        mutation: false,
      })
      const destinationPath = input.destinationPath.startsWith('~/') ? posix.join(listing.home, input.destinationPath.slice(2)) : input.destinationPath
      const wantsFiles = input.copyFromPath !== undefined && input.copyPaths !== undefined && input.copyPaths.length > 0
      const archive = wantsFiles
        ? yield* LocalProjectFiles.archive({ root: input.copyFromPath ?? '', paths: input.copyPaths ?? [], includeIgnored: input.includeIgnored }).pipe(
            Effect.option,
          )
        : Option.some(Buffer.alloc(0))
      if (Option.isNone(archive)) return { ok: false as const, ...failed(new LocalProjectFailed({ code: 'local-process-failed' })) }
      const cloned = yield* RemoteExec.run({
        sshTarget,
        command: `git clone -- ${shellQuote(input.repositoryUrl)} ${shellQuote(destinationPath)}`,
        timeoutMs: 10 * 60_000,
      })
      if (!cloned.ok) return { ok: false as const, code: 'clone-failed', message: cloned.stderr.trim() || 'Git could not clone the repository.' }
      const copied = wantsFiles
        ? yield* Ssh.use(ssh =>
            ssh.run({
              sshTarget,
              command: createLocalProjectCopyCommand({ destinationPath, paths: input.copyPaths ?? [] }),
              stdin: archive.value,
              timeout: 120_000,
            }),
          ).pipe(Effect.option)
        : Option.none()
      const copyWarning =
        wantsFiles && (Option.isNone(copied) || copied.value.code !== 0 || copied.value.timedOut || copied.value.outputExceeded)
          ? 'Repository cloned and added, but not every selected local file could be copied. Existing remote files were not overwritten.'
          : undefined
      const created = yield* withRuntime(
        input.runtimeId,
        gateway =>
          Effect.flatMap(gateway.run({ namespace: 'workspace', method: 'create', args: { request: { path: destinationPath } } }), decodeWorkspaceCreated),
        { mutation: true },
      ).pipe(Effect.option)
      if (Option.isNone(created))
        return {
          ok: false as const,
          code: 'project-registration-failed',
          message: 'Repository cloned, but project registration failed. Use Add folder to register it.',
        }
      const copiedFileCount = wantsFiles && copyWarning === undefined ? new Set(input.copyPaths ?? []).size : 0
      return {
        ok: true as const,
        workspaceId: created.value.workspace.workspaceId,
        path: created.value.workspace.path,
        copiedFileCount,
        ...(copyWarning !== undefined && { copyWarning }),
      }
    }).pipe(Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })))
  }),
  runtimeCreateDirectory: Effect.fn('multi-host runtime create directory')(function* (input) {
    return yield* withRuntime(input.runtimeId, gateway => gateway.api('createDirectory', { path: input.path, name: input.name }), { mutation: true }).pipe(
      Effect.flatMap(created => Effect.map(decodeCreatedPath(created), decoded => ({ ok: true as const, path: decoded.path }))),
      Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })),
    )
  }),
  runtimePluginCall: Effect.fn('multi-host runtime plugin call')(function* (input) {
    const mutation = input.method === 'provision' || input.method === 'noFolder'
    return yield* withRuntime(
      input.runtimeId,
      gateway => gateway.pluginApi({ packageId: '@dshfiles/jj-integration', apiId: 'jj-threads', version: 1 })(input.method, input.input),
      { mutation },
    ).pipe(
      Effect.map(value => ({ ok: true as const, value })),
      Effect.catch(error => Effect.succeed(pluginCallFailure({ error, mutation }))),
    )
  }),
  runtimePeerRead: Effect.fn('multi-host runtime peer read')(function* (input) {
    const [apiId, method] = input.call.split('/')
    const target = peerReadTargets.get(apiId ?? '')
    if (target === undefined || method === undefined)
      return { ok: false as const, code: 'call-not-allowed', message: 'That plugin call is not allowlisted for peers.' }
    return yield* withRuntime(input.runtimeId, gateway => gateway.pluginApi(target)(method, input.input), { mutation: false }).pipe(
      Effect.map(value => ({ ok: true as const, value })),
      Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })),
    )
  }),
  threadCreate: Effect.fn('multi-host thread create')(function* (input) {
    const directory = yield* HostDirectory
    const threads = yield* RemoteThreads
    const runtime = yield* directory.findRuntime(input.runtimeId)
    if (runtime === undefined) return threadRefused({ code: 'runtime-not-found', message: 'This host is no longer recorded.' })
    const state: { sessionId: string | undefined } = { sessionId: undefined }
    return yield* withRuntime(
      runtime.id,
      gateway =>
        Effect.gen(function* () {
          const created = yield* NativeRpc.call(gateway, { namespace: 'session', method: 'create', args: { request: { cwd: input.cwd } } })
          if (!created.ok) return threadRefused({ code: created.code, message: created.message })
          const sessionId = (yield* decodeSessionCreated(created.value)).sessionId
          state.sessionId = sessionId
          yield* threads.record({ runtimeId: runtime.id, sessionId, cwd: input.cwd, title: '', createdAt: new Date().toISOString() })
          return { ok: true as const, sessionId }
        }).pipe(Effect.map((outcome): SessionStartOutcome => outcome)),
      { mutation: true, broken: brokenRpc },
    ).pipe(Effect.catch(error => Effect.succeed(threadRefused({ ...failed(error), ...(state.sessionId !== undefined && { sessionId: state.sessionId }) }))))
  }),
  threadStart: startRemoteThread,
  delegate: Effect.fn('multi-host delegate')(function* (input) {
    const runtimeId = input.runtimeId ?? (yield* (yield* ResourcePool).read).selected?.runtimeId
    if (runtimeId === undefined) {
      return {
        ok: false as const,
        code: 'no-auto-host',
        message: 'Auto found no visible SSH host with fresh resource data. Name a host with runtimeId, or check the Hosts page.',
      }
    }
    const started = yield* startRemoteThread({
      runtimeId,
      cwd: input.cwd,
      text: input.text,
      ...(input.agentPreset !== undefined && { agentPreset: input.agentPreset }),
      ...(input.model !== undefined && { model: input.model }),
    })
    if (!started.ok) return started
    const sessionId = started.sessionId
    const deadline = (yield* Clock.currentTimeMillis) + input.waitSeconds * 1000
    const read = Effect.gen(function* () {
      const transcript = yield* readRemoteTranscript({ runtimeId, sessionId, maxMessages: 40 })
      const progress: DelegationProgress = transcript.ok ? RemoteDelegation.progressOf(transcript) : { state: 'working' }
      return { progress, expired: (yield* Clock.currentTimeMillis) >= deadline }
    })
    const { progress: settled } = yield* read.pipe(
      Effect.repeat({ schedule: Schedule.spaced('3 seconds'), until: poll => poll.progress.state !== 'working' || poll.expired }),
      Effect.onInterrupt(() => Effect.ignore(stopRemoteThread({ runtimeId, sessionId }))),
    )
    const base = { ok: true as const, runtimeId, sessionId }
    switch (settled.state) {
      case 'finished':
        return { ...base, status: 'finished' as const, answer: settled.answer }
      case 'failed':
        return { ...base, status: 'failed' as const, detail: settled.detail }
      case 'waiting':
        return { ...base, status: 'waiting' as const, waiting: settled.waiting }
      case 'working':
        return {
          ...base,
          status: 'running' as const,
          detail: `Still running after ${String(input.waitSeconds)} s; follow it with multi_host_thread_transcript.`,
        }
    }
  }),
  runtimeModels: Effect.fn('multi-host runtime models')(function* (input) {
    return yield* withRuntime(
      input.runtimeId,
      gateway => Effect.flatMap(gateway.run({ namespace: 'session', method: 'modelCatalog', args: {} }), decodeModelCatalog),
      {
        mutation: false,
      },
    ).pipe(
      Effect.map(catalog => ({
        ok: true as const,
        default: catalog.default ?? null,
        routableProviders: catalog.routableProviders ?? catalog.groups.map(group => group.id),
        groups: catalog.groups.map(group => ({
          id: group.id,
          name: group.name,
          models: group.models.map(model => ({
            id: model.id,
            name: model.name,
            ...(model.description !== undefined && { description: model.description }),
            ...(model.reasoning !== undefined && { reasoning: model.reasoning }),
          })),
        })),
        failures: catalog.failures ?? [],
      })),
      Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })),
    )
  }),
  sessionRuntime: Effect.fn('multi-host session runtime')(function* (input) {
    return yield* Effect.gen(function* () {
      const threads = yield* RemoteThreads
      const directory = yield* HostDirectory
      const recorded = (yield* threads.list).find(thread => thread.sessionId === input.sessionId)
      if (recorded !== undefined && (yield* directory.findRuntime(recorded.runtimeId)) !== undefined)
        return { ok: true as const, runtimeId: recorded.runtimeId }
      const owners = yield* SessionOwners
      const runtimeId = yield* owners.knownRuntime(input.sessionId)
      return { ok: true as const, runtimeId }
    }).pipe(Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })))
  }),
  sessionInteractions: Effect.fn('multi-host session interactions')(function* (input) {
    return yield* Effect.gen(function* () {
      const interactions = yield* RemoteInteractions
      // A browser reading this is what makes threads it has not opened worth following; a hidden host stays quiet.
      const directory = yield* HostDirectory
      const threads = yield* RemoteThreads
      const hidden = new Set((yield* directory.listHosts).filter(host => host.hidden).map(host => host.id))
      const runtimes = yield* directory.listRuntimes()
      const recorded = new Set((yield* threads.list).map(thread => thread.runtimeId))
      yield* interactions.watch(runtimes.filter(runtime => recorded.has(runtime.id) && !hidden.has(runtime.hostId)).map(runtime => runtime.id))
      const rows = yield* interactions.list
      return { ok: true as const, interactions: rows.filter(row => input.sessionId === undefined || row.sessionId === input.sessionId) }
    }).pipe(Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })))
  }),
  sessionQuestionAnswer: Effect.fn('multi-host session question answer')(function* (input) {
    if (input.interactionId !== undefined) {
      const held = yield* heldInteraction({ sessionId: input.sessionId, id: input.interactionId })
      if (!held.ok) return held
      if (held.interaction.request.kind !== 'question') return interactionKindMismatch
      const settled = yield* settleHeld({ interaction: held.interaction, outcome: { kind: 'result', value: answerValue(input.answer) } })
      return settled.ok ? { ok: true as const, accepted: true } : settled
    }
    if (input.callId === undefined) return { ok: false as const, code: 'question-unknown', message: 'Name the waiting question or its tool call.' }
    const callId = input.callId
    return yield* Effect.gen(function* () {
      const owner = yield* sessionOwner(input.sessionId)
      if (!owner.ok) return owner
      const accepted = yield* withRuntime(
        owner.runtimeId,
        gateway =>
          Effect.flatMap(
            gateway.run({ namespace: 'userQuestions', method: 'answer', args: { agentId: input.sessionId, callId, answer: answerValue(input.answer) } }),
            decodeAccepted,
          ),
        { mutation: true },
      )
      return { ok: true as const, accepted }
    }).pipe(Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })))
  }),
  sessionQuestionDecline: Effect.fn('multi-host session question decline')(function* (input) {
    const held = yield* heldInteraction({ sessionId: input.sessionId, id: input.interactionId })
    if (!held.ok) return held
    if (held.interaction.request.kind !== 'question') return interactionKindMismatch
    const rejection =
      input.reason === 'cancelled'
        ? { code: 'ASK_CANCELLED', message: 'the user cancelled ask_user_question' }
        : { code: 'ASK_TIMED_OUT', message: 'ask_user_question timed out before the user answered' }
    return yield* settleHeld({ interaction: held.interaction, outcome: { kind: 'rejected', error: { name: 'UserQuestionError', ...rejection } } })
  }),
  sessionApprovalDecide: Effect.fn('multi-host session approval decide')(function* (input) {
    const held = yield* heldInteraction({ sessionId: input.sessionId, id: input.interactionId })
    if (!held.ok) return held
    if (held.interaction.request.kind !== 'approval') return interactionKindMismatch
    return yield* settleHeld({ interaction: held.interaction, outcome: { kind: 'result', value: input.outcome } })
  }),
  sessionJjRepositories: Effect.fn('multi-host session jj repositories')(function* (input) {
    return yield* Effect.gen(function* () {
      const owner = yield* sessionOwner(input.sessionId)
      if (!owner.ok) return owner
      const repositories = yield* withRuntime(
        owner.runtimeId,
        gateway =>
          Effect.flatMap(
            gateway.pluginApi({ packageId: '@dshfiles/jj-integration', apiId: 'jj-threads', version: 1 })('repositories', {}),
            decodeJjRepositories,
          ),
        { mutation: false },
      )
      return { ok: true as const, repositories }
    }).pipe(Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })))
  }),
  sessionJjCall: Effect.fn('multi-host session jj call')(function* (input) {
    const mutation = input.method !== 'threadAt' && input.method !== 'integrationProgress'
    return yield* Effect.gen(function* () {
      const owner = yield* sessionOwner(input.sessionId)
      if (!owner.ok) return owner
      const sessions = yield* RemoteSessions
      const folder = yield* sessions.threadFolder(input.sessionId)
      const refused = RemoteJjScope.refusal({ sessionId: input.sessionId, folder, action: input.input })
      if (refused !== undefined) return refused
      const value = yield* withRuntime(
        owner.runtimeId,
        gateway =>
          gateway.pluginApi({ packageId: '@dshfiles/jj-integration', apiId: 'jj-threads', version: 1 })(
            input.method,
            RemoteJjScope.asking({ method: input.method, sessionId: input.sessionId, action: input.input }),
          ),
        { mutation },
      )
      return { ok: true as const, value }
    }).pipe(Effect.catch(error => Effect.succeed(pluginCallFailure({ error, mutation }))))
  }),
  remoteRepositories: Effect.fn('multi-host remote repositories')(function* () {
    const directory = yield* HostDirectory
    const threads = yield* RemoteThreads
    const hosts = yield* directory.listHosts.pipe(Effect.orElseSucceed(() => []))
    const runtimes = yield* directory.listRuntimes().pipe(Effect.orElseSucceed(() => []))
    const recorded = yield* threads.list
    const sessions = yield* RemoteSessions
    const results = yield* Effect.forEach(
      yield* Effect.forEach(
        runtimes.flatMap(runtime => {
          const host = hosts.find(item => item.id === runtime.hostId)
          const threadsHere = recorded.filter(thread => thread.runtimeId === runtime.id)
          return host === undefined || host.hidden || threadsHere.length === 0 ? [] : [{ runtime, hostName: host.name, threadsHere }]
        }),
        ({ hostName, runtime, threadsHere }) =>
          Effect.map(
            // The owner's list says where a thread really runs; the recorded folder is what was asked for at start.
            Effect.forEach(threadsHere, thread =>
              sessions.threadFolder(thread.sessionId).pipe(
                Effect.orElseSucceed(() => thread.cwd),
                Effect.map(folder => ({ sessionId: thread.sessionId, folder: folder ?? thread.cwd })),
              ),
            ),
            folders => ({ runtime, hostName, folders }),
          ),
      ),
      ({ folders, hostName, runtime }) =>
        withRuntime(
          runtime.id,
          gateway => {
            const threadsApi = gateway.pluginApi({ packageId: '@dshfiles/jj-integration', apiId: 'jj-threads', version: 1 })
            // `repositories` answers from the owner's last scan, and a scan coalesces, so asking here keeps this page current.
            return threadsApi('refreshRepositories', {}).pipe(
              Effect.ignore,
              Effect.andThen(threadsApi('repositories', {})),
              Effect.flatMap(decodeJjRepositories),
            )
          },
          { mutation: false },
        ).pipe(
          Effect.map(({ refreshing, repositories }) => ({
            runtimeId: runtime.id,
            hostName,
            refreshing: refreshing === true,
            // Only threads this DSH recorded, by folder since an owner may not list a Session against its workspace:
            // anything else on that machine has no Session to authorize an action.
            repositories: repositories.flatMap(repository => {
              const owned = repository.threads.flatMap(thread => {
                const threadSessions = folders.filter(item => item.folder === thread.path).map(item => item.sessionId)
                return threadSessions.length === 0 ? [] : [{ ...thread, sessionIds: threadSessions }]
              })
              return owned.length === 0 ? [] : [{ ...repository, threads: owned }]
            }),
          })),
          Effect.map(host => ({ host })),
          // A host without the plugin answered: it simply has no thread workspaces to show.
          Effect.catchTag('RemoteApiFailed', error =>
            error.code === pluginNotServed
              ? Effect.succeed({ host: { runtimeId: runtime.id, hostName, refreshing: false, repositories: [] } })
              : Effect.fail(error),
          ),
          Effect.orElseSucceed(() => ({ unreachable: hostName })),
        ),
      { concurrency: 4 },
    )
    return {
      hosts: results.flatMap(result => ('host' in result ? [result.host] : [])),
      unreachable: results.flatMap(result => ('unreachable' in result ? [result.unreachable] : [])),
    }
  }),
  sessionRepositoryCall: Effect.fn('multi-host session repository call')(function* (input) {
    const mutation = sessionRepositoryWrites.some(method => method === input.method)
    return yield* Effect.gen(function* () {
      const owner = yield* sessionOwner(input.sessionId)
      if (!owner.ok) return owner
      if (!mutation && !sessionRepositoryReads[input.api].some(method => method === input.method)) {
        return { ok: false as const, code: 'session/method-not-allowed', message: 'This repository call is not available for a remote thread.' }
      }
      const sessions = yield* RemoteSessions
      const folder = yield* sessions.threadFolder(input.sessionId)
      const repoIds = yield* sessions.threadRepositoryIds(input.sessionId)
      const refused = RemoteJjScope.repositoryRefusal({ folder, repoIds, call: input.input })
      if (refused !== undefined) return refused
      const value = yield* withRuntime(
        owner.runtimeId,
        gateway => gateway.pluginApi({ packageId: '@dshfiles/jujutsu', apiId: input.api, version: 1 })(input.method, input.input),
        { mutation },
      )
      // Only an id the owner issued for this thread's folder may be used afterwards.
      yield* sessions.rememberRepository({ sessionId: input.sessionId, reply: value })
      return { ok: true as const, value }
    }).pipe(Effect.catch(error => Effect.succeed(pluginCallFailure({ error, mutation }))))
  }),
  runtimeFileReferences: Effect.fn('multi-host runtime file references')(function* (input) {
    return yield* Effect.gen(function* () {
      const threads = yield* RemoteThreads
      const owners = yield* SessionOwners
      const authorization = yield* owners.authorize({ sessionId: input.sessionId, runtimeId: input.runtimeId, recordedSessions: yield* threads.list })
      if (!authorization.ok) return authorization
      const outcome = yield* withRuntime(
        input.runtimeId,
        gateway => gateway.run({ namespace: 'fileReferences', method: 'list', args: { agentId: input.sessionId, query: input.query } }),
        { mutation: false },
      )
      const candidates = yield* decodeFileReferences(outcome)
      return { ok: true as const, candidates: candidates.map(candidate => ({ path: candidate.path, kind: candidate.kind })) }
    }).pipe(Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })))
  }),
  sessionUploadFile: Effect.fn('multi-host session upload file')(function* (input) {
    return yield* Effect.gen(function* () {
      const directory = yield* HostDirectory
      const threads = yield* RemoteThreads
      const runtime = yield* directory.findRuntime(input.runtimeId)
      if (runtime === undefined) return { ok: false as const, code: 'runtime-not-found', message: 'This host is no longer recorded.' }
      const owners = yield* SessionOwners
      const authorization = yield* owners.authorize({ sessionId: input.sessionId, runtimeId: runtime.id, recordedSessions: yield* threads.list })
      if (!authorization.ok) return authorization
      const value = yield* withRuntime(
        runtime.id,
        gateway =>
          Effect.flatMap(
            gateway.run({
              namespace: 'fileUploads',
              method: 'upload',
              args: { agentId: input.sessionId, request: { data: input.data, ...(input.name !== undefined && { name: input.name }) } },
            }),
            decodeUploadValue,
          ),
        { mutation: true },
      )
      const sessions = yield* RemoteSessions
      yield* sessions.recordUpload({ receiptId: String(value.receiptId), runtimeId: runtime.id, sessionId: input.sessionId })
      return { ok: true as const, value }
    }).pipe(Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })))
  }),
  threadTranscript: readRemoteTranscript,
  threadList: Effect.fn('multi-host thread list')(function* () {
    const directory = yield* HostDirectory
    const threads = yield* RemoteThreads
    const pool = yield* RuntimePool
    const listed = yield* threads.list
    // One directory snapshot answers both lookups: two reads cost two locked
    // lstat/read/decode passes of the same file per list.
    const { runtimes, hosts } = yield* directory.read
    const rows = yield* Effect.forEach(listed, thread =>
      Effect.gen(function* () {
        const runtime = runtimes.find(item => item.id === thread.runtimeId)
        if (runtime === undefined) return []
        const host = hosts.find(item => item.id === runtime.hostId)
        const label = thread.title.trim() || thread.sessionId
        const generation = yield* pool.generation(runtime.id)
        return [
          {
            ...thread,
            mention: formatSessionReferenceMention({ sessionId: SessionId(thread.sessionId), label }),
            hostName: host?.name ?? runtime.name,
            connected: generation !== undefined,
          },
        ]
      }),
    )
    return { threads: rows.flat() }
  }),
  threadForget: Effect.fn('multi-host thread forget')(function* (input) {
    const threads = yield* RemoteThreads
    return { removed: yield* threads.forget(input) }
  }),
  threadReply: Effect.fn('multi-host thread reply')(function* (input) {
    const refused = yield* localPathRefusal({ runtimeId: input.runtimeId, sessionId: input.sessionId, text: input.text })
    if (refused !== undefined) return refused
    return yield* withRuntime(
      input.runtimeId,
      gateway =>
        NativeRpc.call(gateway, {
          namespace: 'session',
          method: 'prompt',
          args: {
            request: {
              requestId: randomUUID(),
              sessionId: input.sessionId,
              mode: input.steer ? 'steer' : 'queue',
              content: [{ type: 'text', text: input.text }],
            },
          },
        }),
      { mutation: true, broken: brokenRpc },
    ).pipe(
      Effect.map(() => ({ ok: true as const })),
      Effect.catch(error => Effect.succeed({ ok: false as const, ...failed(error) })),
    )
  }),
  threadStop: stopRemoteThread,
  runtimeCall: Effect.fn('multi-host runtime call')(function* (input) {
    const mutation = NativeRpc.isMutation(input.request)
    return yield* withRuntime(input.runtimeId, gateway => NativeRpc.call(gateway, input.request), { mutation, broken: brokenRpc }).pipe(
      // A transport failure after a mutation was sent may hide an applied change: report it as an unknown outcome, never as
      // 'unreachable', which reads as safe to retry and would replay the mutation.
      Effect.catch(error => Effect.succeed(isTaggedFailure(error) ? NativeRpc.failureResult({ request: input.request, error }) : unavailable())),
    )
  }),
  sessionCursor: Effect.fn('multi-host session cursor')(function* (input) {
    return yield* withRuntime(
      input.runtimeId,
      gateway =>
        Effect.flatMap(
          gateway.follow({
            endpoint: 'session/follow',
            args: { request: { address: { kind: 'session', sessionId: input.sessionId }, maxMessages: 1 } },
            timeout: 10_000,
          }),
          frames =>
            Effect.gen(function* () {
              const frame = frames.flatMap(raw => Option.toArray(decodeCursorFrame(raw)))[0]
              if (frame === undefined) return yield* new SessionCursorUnavailable()
              return { cursor: frame.cursor }
            }),
        ),
      { mutation: false },
    )
  }),
  runtimeOpenView: Effect.fn('multi-host runtime open view')(function* (input) {
    const leases = yield* ViewLeases
    const view = yield* leases.open(input.runtimeId)
    return input.sessionId === undefined ? view : { ...view, threadUrl: threadViewUrl({ launchUrl: view.launchUrl, sessionId: input.sessionId }) }
  }),
  runtimeCloseView: Effect.fn('multi-host runtime close view')(function* (input) {
    const leases = yield* ViewLeases
    return { closed: yield* leases.close(input.leaseId) }
  }),
  runtimeRemove: Effect.fn('multi-host runtime remove')(function* (input) {
    const directory = yield* HostDirectory
    const pool = yield* RuntimePool
    const leases = yield* ViewLeases
    const removed = yield* directory.removeRuntime(input.runtimeId)
    if (removed) {
      yield* leases.closeRuntime(input.runtimeId)
      yield* pool.invalidate(input.runtimeId)
    }
    return { removed }
  }),
})

/** The Cordis surfaces this plugin reads from the Host: a web server to publish a launch URL for, and the Loader. */
const launchUrlOf = Effect.gen(function* () {
  const host = yield* HostContext
  const loader = host.ctx.get('loader')
  if (loader?.await !== undefined) yield* Effect.promise(() => loader.await?.() ?? Promise.resolve())
  const webServer = Option.getOrUndefined(decodeWebServer(host.ctx.get('webServer')))
  const connection = host.ctx.get('connection')
  if (webServer === undefined) return undefined
  const launchUrl = connection?.authenticatedUrl?.(`http://127.0.0.1:${webServer.port}`)
  return typeof launchUrl === 'string' ? launchUrl : undefined
})

/** Publish this runtime's launch URL whenever the Host provides a web server, and withdraw it on unload. */
const LaunchFilePublisher = Layer.effectDiscard(
  Effect.gen(function* () {
    const launchFile = yield* LaunchFile
    const changes = yield* hostServiceChanges('webServer')
    const publishing = yield* Ref.make<Option.Option<Scope.Closeable>>(Option.none())
    const stopPublishing = Effect.gen(function* () {
      const current = yield* Ref.getAndSet(publishing, Option.none())
      if (Option.isSome(current)) yield* Scope.close(current.value, Exit.void)
    })
    yield* Stream.runForEach(changes, availability =>
      Effect.suspend(() => {
        if (Option.isNone(availability)) return stopPublishing
        return Effect.gen(function* () {
          yield* stopPublishing
          const launchUrl = yield* launchUrlOf
          if (launchUrl === undefined) return
          const scope = yield* Scope.make()
          yield* Ref.set(publishing, Option.some(scope))
          yield* Effect.forkScoped(Scope.provide(scope)(launchFile.publish(launchUrl)))
        })
      }),
    ).pipe(Effect.forkScoped)
    yield* Effect.addFinalizer(() => stopPublishing)
  }),
)

/** One conversation snapshot of a remote Session, as the reference middleware reads it. */
const remoteSnapshot = (input: { readonly sessionId: string; readonly maxMessages: number }) =>
  Effect.gen(function* () {
    const sessions = yield* RemoteSessions
    return yield* sessions.snapshot(input)
  })

/** Replace canonical remote mentions with accepted recall context before the model sees the step. */
const referenceMiddleware = Effect.gen(function* () {
  const host = yield* HostContext
  const threads = yield* RemoteThreads
  const run = yield* DshxPlugin.callback(
    (input: {
      readonly messages: readonly { readonly source: { readonly kind: string }; readonly content: readonly ContentBlock[] }[]
      readonly agentId: string
      readonly signal: AbortSignal
    }) =>
      Effect.gen(function* () {
        const recordedThreads = (yield* threads.list).map(thread => ({ sessionId: thread.sessionId, runtimeId: thread.runtimeId }))
        if (recordedThreads.length === 0) return undefined
        const remoteSessionIds = new Set(recordedThreads.filter(thread => thread.sessionId !== input.agentId).map(thread => thread.sessionId))
        const replaced = new Map<
          object,
          {
            readonly content: readonly ContentBlock[]
            readonly references: readonly { readonly sessionId: string; readonly label: string; readonly runtimeId: string }[]
          }
        >()
        const references = new Map<string, { readonly sessionId: string; readonly label: string; readonly runtimeId: string }>()
        for (const message of input.messages) {
          if (message.source.kind !== 'user') continue
          const content: ContentBlock[] = []
          let changed = false
          for (const block of message.content) {
            if (block.type !== 'text') {
              content.push(block)
              continue
            }
            const redacted = RemoteReferenceContext.redactRemoteReferenceMentions(block.text, remoteSessionIds)
            if (redacted === undefined) {
              content.push(block)
              continue
            }
            const targets = redacted.references.flatMap(reference => {
              const recorded = recordedThreads.find(thread => thread.sessionId === reference.sessionId)
              return recorded === undefined
                ? []
                : [{ sessionId: reference.sessionId, label: reference.label ?? reference.sessionId, runtimeId: recorded.runtimeId }]
            })
            if (targets.length === 0) {
              content.push(block)
              continue
            }
            changed = true
            content.push({ ...block, text: redacted.text })
            for (const target of targets) references.set(target.sessionId, target)
          }
          if (changed) replaced.set(message, { content, references: [...references.values()] })
        }
        if (references.size === 0 || references.size > 3) return undefined
        // Each reference reads its own runtime, so the three at most run together rather than one after another.
        const contexts = yield* Effect.forEach(
          [...references.values()],
          reference =>
            Effect.gen(function* () {
              const snapshot = yield* remoteSnapshot({ sessionId: reference.sessionId, maxMessages: RemoteReferenceContext.limits.maxMessages })
              if (snapshot === undefined) return undefined
              const conversation = RemoteReferenceContext.remoteReferenceConversation(snapshot)
              if (conversation.length === 0) return undefined
              return createUserMessage({
                source: {
                  kind: 'multi-host-remote-reference',
                  form: 'recall',
                  references: [{ sessionId: reference.sessionId, label: reference.label, capturedThroughSeq: snapshotCursor(snapshot) }],
                },
                content: [
                  {
                    type: 'text',
                    text: RemoteReferenceContext.remoteReferenceContextText({ sessionId: reference.sessionId, label: reference.label, conversation }),
                  },
                ],
              })
            }),
          { concurrency: 3 },
        )
        return { replaced, contexts: contexts.flatMap(context => (context === undefined ? [] : [context])) }
      }),
  )
  const installed = host.ctx.on('agent/pre-step', async (payload, next) => {
    return run({ messages: payload.messages, agentId: payload.agent.id, signal: payload.signal }).then(async outcome => {
      if (outcome === undefined) return next()
      const rewritten = payload.messages.map(message => {
        if (message.source.kind !== 'user') return message
        const replacement = outcome.replaced.get(message)
        return replacement === undefined ? message : createUserMessage({ source: message.source, content: replacement.content })
      })
      payload.messages.splice(0, payload.messages.length, ...rewritten)
      const decision = await next()
      if (decision.kind === 'reject' || payload.signal.aborted) return decision
      return { ...decision, messages: [...decision.messages, ...outcome.contexts] }
    })
  })
  yield* Effect.addFinalizer(() => Effect.sync(installed))
})

const snapshotCursor = (frames: readonly unknown[]): number => {
  for (const frame of frames) {
    const decoded = decodeSnapshot(frame)
    if (Option.isSome(decoded)) return decoded.value.cursor
    const cursor = decodeCursorFrame(frame)
    if (Option.isSome(cursor)) return cursor.value.cursor
  }
  return 0
}

/** Everything the remote Session source needs: the directory, its thread records, and the pooled runtimes. */
const RemoteSessionsLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const owners = yield* SessionOwners
    const sessions = yield* RemoteSessions
    const mirrored = yield* fromEffect(sessions.source)
    yield* Stream.runForEach(Stream.unwrap(owners.changes), availability =>
      Effect.suspend(() => {
        if (Option.isNone(availability)) return Effect.void
        const registry = availability.value
        return Effect.acquireRelease(
          Effect.sync(() => registry.register(mirrored)),
          unregister => Effect.sync(unregister),
        )
      }),
    ).pipe(Effect.forkScoped)
    const interactions = yield* RemoteInteractions
    yield* Stream.runForEach(interactions.projections, update =>
      Effect.flatMap(owners.registry, registry =>
        Effect.sync(() => {
          // An older Session controller has no such verb: its mirrored Sessions keep their opening values.
          if (Option.isSome(registry)) registry.value.publishProjection?.({ ...update, sessionId: SessionId(update.sessionId) })
        }),
      ),
    ).pipe(DshxPlugin.detached, Effect.forkScoped)
  }),
)

/** Tell browsers to read what remote threads wait on again; a burst of frames becomes one read. */
const InteractionEvents = Layer.effectDiscard(
  Effect.gen(function* () {
    const interactions = yield* RemoteInteractions
    yield* interactions.changes.pipe(
      Stream.groupedWithin(Number.MAX_SAFE_INTEGER, '100 millis'),
      Stream.runForEach(() =>
        Api.publish({ contract: multiHostApi, event: 'interactionsChanged', payload: {} }).pipe(
          Effect.catchTag('PublishEventError', error => Effect.logWarning('multi-host: interaction change event refused', error.message)),
        ),
      ),
      DshxPlugin.detached,
      Effect.forkScoped,
    )
  }),
)

/** The reference middleware is optional: a Host without the Session controller still serves the tools. */
const referenceMiddlewareLayer = Layer.effectDiscard(referenceMiddleware)

/** The domain services every consumer shares: registries, identity and the launch file. */
const domainLayer = (input: { readonly configuredProfile: string | undefined }) =>
  Layer.mergeAll(HostDirectory.layer, RemoteThreads.layer, RuntimeIdentity.layer({ configuredProfile: input.configuredProfile }), LaunchFile.layer).pipe(
    Layer.provideMerge(MultiHostPaths.layer),
  )

/** The pooled runtimes and the services above them; `RemoteSessionsLive` registers the Session source built from them. */
const runtimeLayer = Layer.mergeAll(RuntimeStatus.layer, ResourcePool.layer, ViewLeases.layer, RemoteSessions.layer).pipe(
  Layer.provideMerge(RemoteInteractions.layer),
  Layer.provideMerge(RuntimePool.layer),
  Layer.provideMerge(Connectors.layer.pipe(Layer.provide(FetchHttpClient.layer), Layer.provideMerge(Ssh.layer), Layer.provide(DshChildProcessSpawner.layer))),
)

const pluginLayer = (config: Schema.Schema.Type<typeof configSchema>) =>
  Layer.mergeAll(RemoteSessionsLive, LaunchFilePublisher, InteractionEvents, referenceMiddlewareLayer).pipe(
    Layer.provideMerge(runtimeLayer),
    Layer.provideMerge(SessionOwners.layer),
    Layer.provideMerge(domainLayer({ configuredProfile: config?.profile })),
    Layer.provideMerge(NodeServices.layer),
    // The environment as it is when the plugin activates, not Effect's process-start snapshot.
    Layer.provide(ConfigProvider.layer(Effect.sync(() => ConfigProvider.fromEnvRecord(process.env)))),
  )

export default DshxPlugin.make({
  name: '@dshfiles/multi-host',
  inject: ['subprocess'],
  Config: configSchema,
  layer: pluginLayer,
  apis: [Api.bind(multiHostApi, handlers)],
})
