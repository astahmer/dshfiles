import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { Context, Effect } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { InferValue, ToolRunContext, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { defineHost, defineTool } from '@dshfiles/dshx/host'
import type { SettingsScope } from '@dshfiles/dshx/settings'
import { jjIntegrationApi } from './api.js'
import type { JjExecutor, CommandExecutor } from './jj.js'
import { IntegrationError, createJjIntegrationService, type JjIntegrationService } from './service.js'
import { jjIntegrationSettings, type JjIntegrationSettings } from './settings.js'
import { createThreadWorkspaceResolver, type WorkspaceIsolationMode } from './thread-isolation.js'
import { createToolGate } from './tool-gate.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'dshfiles/activity/event'(payload: unknown): void
    'dshfiles/activity/backfill'(payload: { readonly since?: number }): void
  }
}

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 500)

const MAX_OUTPUT = 512 * 1024
const MAX_STDERR = 64 * 1024

const summaryOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { summary: { type: 'string', required: true } },
} satisfies ValueSchemaSpec

const summaryOutput = {
  schema: summaryOutputSchema,
  render(_args: {}, value: InferValue<typeof summaryOutputSchema>) {
    return [{ type: 'text' as const, text: value.summary }]
  },
}

/**
 * The shape the coordinator consumes, built from settings. `workspaceIsolation`
 * and `integration` are also read live by the mode getters, so changing either
 * applies without recreating the service; the rest is read at activation.
 */
export interface JjIntegrationConfig {
  readonly spineBookmark: string
  readonly validationCommand: string | undefined
  readonly allowAnyAgentIntegration: boolean
  readonly coordinatorSessions: readonly string[]
  readonly autoDiscoverWorkspaces: boolean
  readonly workspaceIsolation: { readonly mode: WorkspaceIsolationMode; readonly directory?: string | undefined }
  readonly integration: { readonly mode: 'auto' | 'manual' | 'off' }
  readonly ownership: { readonly staleAfterSeconds: number; readonly readOnlyTools: readonly string[]; readonly protectedPaths: readonly string[] }
}

const readConfig = (): JjIntegrationConfig => {
  const settings = readSettings()
  return {
    spineBookmark: settings.spineBookmark,
    validationCommand: settings.validationCommand === '' ? undefined : settings.validationCommand,
    allowAnyAgentIntegration: settings.allowAnyAgentIntegration,
    coordinatorSessions: [...settings.coordinatorSessions],
    autoDiscoverWorkspaces: settings.autoDiscoverWorkspaces,
    workspaceIsolation: {
      mode: settings.workspaceIsolationMode,
      ...(settings.workspaceIsolationDirectory === '' ? {} : { directory: settings.workspaceIsolationDirectory }),
    },
    integration: { mode: settings.integrationMode },
    ownership: {
      staleAfterSeconds: settings.staleAfterSeconds,
      readOnlyTools: [...settings.readOnlyTools],
      protectedPaths: settings.protectedPaths.map(path => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)),
    },
  }
}

const createExecutor =
  (ctx: Context): JjExecutor =>
  async input => {
    const executable = await ctx.subprocess.resolveExecutable('jj', undefined, input.signal)
    const handle = ctx.subprocess.spawn({
      argv: [executable, '--color=never', '--no-pager', ...input.args],
      cwd: input.cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: MAX_OUTPUT },
        stderr: { maxBytes: MAX_STDERR },
      },
      graceMs: 1_500,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0)?.text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0)?.text ?? ''
    return { exitCode: outcome.exitCode ?? 1, stdout, stderr }
  }

const createCommandExecutor =
  (ctx: Context): CommandExecutor =>
  async input => {
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
    const argv = process.platform === 'win32' ? [shell, '/c', input.command] : [shell, '-c', input.command]
    const handle = ctx.subprocess.spawn({
      argv,
      cwd: input.cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: MAX_OUTPUT },
        stderr: { maxBytes: MAX_STDERR },
      },
      graceMs: 5_000,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0)?.text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0)?.text ?? ''
    return { exitCode: outcome.exitCode ?? 1, stdout, stderr }
  }

let service: JjIntegrationService | undefined
let hostContext: Context | undefined
let integrationMode: 'auto' | 'manual' | 'off' = 'manual'
let isolationMode: WorkspaceIsolationMode = 'auto'
let settingsScope: SettingsScope<JjIntegrationSettings> | undefined
let autoDriverRunning = false

const defaultSettings: JjIntegrationSettings = jjIntegrationSettings.schema({})

const readSettings = (): JjIntegrationSettings => {
  try {
    return settingsScope?.get() ?? defaultSettings
  } catch {
    return defaultSettings
  }
}

/**
 * Settings are the only source of these two modes. Integration mode is pushed
 * into the running service; isolation mode is read per Session, so a change
 * applies to the next thread and never to a running one.
 */
const applySettings = (): void => {
  const next = readConfig()
  isolationMode = next.workspaceIsolation.mode
  integrationMode = next.integration.mode
  service?.setIntegrationMode(integrationMode)
}

const ownedSettings = jjIntegrationSettings.host({
  setup: scope => {
    settingsScope = scope
    applySettings()
    const stopWatching = scope.watch(() => applySettings())
    return () => {
      stopWatching()
      if (settingsScope === scope) settingsScope = undefined
    }
  },
})

/** Epoch this session last held per workspace, so a transfer fences it. */
const heldEpochs = new Map<string, number>()

/** Coordinator-driven integration is the only thing `integration.mode` gates; explicit jj use stays available. */
const requireIntegrationEnabled = (): JjIntegrationService => {
  if (integrationMode === 'off') {
    throw new IntegrationError('integration-disabled', 'Coordinator-driven integration is disabled by configuration (integration.mode: off).')
  }
  return requireService()
}

const requireService = (): JjIntegrationService => {
  if (service === undefined) throw new IntegrationError('service-unavailable', 'Jujutsu integration Host is not active.')
  return service
}

const agentIdOf = (execution: ToolRunContext): string | null => execution.agent?.id ?? null
const agentCwdOf = (execution: ToolRunContext): string | undefined => execution.agent?.session.header.cwd

const jsonSummary = (value: unknown): { summary: string } => ({ summary: JSON.stringify(value) })

const parseDependsOn = (value: string | undefined): readonly string[] =>
  value === undefined
    ? []
    : value
        .split(',')
        .map(item => item.trim())
        .filter(item => item.length > 0)

const workspaceListTool = defineTool({
  name: 'jj_workspace_list',
  description:
    'List registered Jujutsu workspaces with their coordinator identity, owning sessions, lifecycle dimension, and last observed revision. Read-only: it does not touch any workspace or activate any Session.',
  parameters: {},
  output: summaryOutput,
  execute: async () => jsonSummary({ workspaces: await requireService().listWorkspaces() }),
})

const workspaceInspectTool = defineTool({
  name: 'jj_workspace_inspect',
  description:
    'Inspect one registered Jujutsu workspace: current revision, the canonical spine revision, and whether each is an ancestor of the other. Read-only and non-activating.',
  parameters: { workspaceId: { type: 'string', required: true, description: 'Coordinator workspace id from jj_workspace_list.' } },
  output: summaryOutput,
  execute: async (args, execution) => jsonSummary(await requireService().inspectWorkspace(args.workspaceId, execution.signal)),
})

const workspaceRegisterTool = defineTool({
  name: 'jj_workspace_register',
  description:
    'Register (or re-attach) the calling Agent’s Jujutsu workspace with the integration coordinator, recording this Session as an owner. Omit path to use the calling Session working directory.',
  parameters: {
    path: { type: 'string', description: 'Absolute path inside the Jujutsu workspace; defaults to the calling Session working directory.' },
    ready: { type: 'string', enum: ['true', 'false'], description: 'Mark the workspace ready for integration after registering.' },
  },
  output: summaryOutput,
  execute: async (args, execution) => {
    const sessionId = agentIdOf(execution)
    if (sessionId === null) throw new IntegrationError('caller-unavailable', 'Registering a workspace requires a live DSH Agent identity.')
    const path = args.path ?? agentCwdOf(execution)
    if (path === undefined || path.length === 0)
      throw new IntegrationError('path-required', 'Provide a workspace path; the calling Session has no working directory.')
    const workspace = await requireService().registerWorkspace({
      path,
      sessionId,
      source: 'agent-tool',
      ...(execution.signal === undefined ? {} : { signal: execution.signal }),
    })
    const ready = args.ready === 'true' ? await requireService().markReady(workspace.id, sessionId) : workspace
    return jsonSummary({ workspace: ready })
  },
})

const workspaceReadyTool = defineTool({
  name: 'jj_workspace_ready',
  description: 'Explicitly mark a registered workspace as ready for integration. This never infers readiness from an idle Session.',
  parameters: { workspaceId: { type: 'string', required: true } },
  output: summaryOutput,
  execute: async (args, execution) => jsonSummary({ workspace: await requireService().markReady(args.workspaceId, agentIdOf(execution)) }),
})

const integrationSubmitTool = defineTool({
  name: 'jj_integration_submit',
  description:
    'Queue a workspace revision as an integration candidate. Defaults to the workspace current revision. Records the immutable change and commit ids; submitting the same revision twice returns the existing candidate.',
  parameters: {
    workspaceId: { type: 'string', required: true },
    revision: { type: 'string', description: 'Optional jj revset for the exact work to integrate; defaults to the workspace current revision (@).' },
    dependsOn: { type: 'string', description: 'Optional comma-separated candidate ids that must integrate first.' },
    correlationId: { type: 'string', description: 'Optional opaque id shared with related messages or work.' },
  },
  output: summaryOutput,
  execute: async (args, execution) =>
    jsonSummary({
      candidate: await requireService().submitCandidate({
        workspaceId: args.workspaceId,
        sessionId: agentIdOf(execution),
        ...(args.revision === undefined ? {} : { revision: args.revision }),
        dependsOn: parseDependsOn(args.dependsOn),
        ...(args.correlationId === undefined ? {} : { correlationId: args.correlationId }),
        ...(execution.signal === undefined ? {} : { signal: execution.signal }),
      }),
    }),
})

const integrationListTool = defineTool({
  name: 'jj_integration_list',
  description: 'List the durable integration queue with readiness, integration state, dependencies, and conflict indicators. Read-only.',
  parameters: {},
  output: summaryOutput,
  execute: async () => jsonSummary({ candidates: await requireService().listCandidates() }),
})

const integrationInspectTool = defineTool({
  name: 'jj_integration_inspect',
  description:
    'Inspect one integration candidate: source and spine revisions, staleness, whether it is already integrated, dependency states, and a non-mutating file-overlap preview. Read-only.',
  parameters: { candidateId: { type: 'string', required: true } },
  output: summaryOutput,
  execute: async (args, execution) => jsonSummary(await requireService().inspectCandidate(args.candidateId, execution.signal)),
})

const integrationRunTool = defineTool({
  name: 'jj_integration_run',
  description:
    'Run one queued integration candidate: duplicate the source revision onto the refreshed canonical spine, detect conflicts, run configured validation, and advance the spine bookmark only on success. The source workspace is never modified. Requires the candidate owner or a configured coordinator session.',
  parameters: { candidateId: { type: 'string', required: true } },
  output: summaryOutput,
  execute: async (args, execution) =>
    jsonSummary(
      await requireIntegrationEnabled().runCandidate({
        candidateId: args.candidateId,
        sessionId: agentIdOf(execution),
        ...(execution.signal === undefined ? {} : { signal: execution.signal }),
      }),
    ),
})

const integrationRetryTool = defineTool({
  name: 'jj_integration_retry',
  description: 'Re-queue a blocked, failed, stale, or cancelled candidate, re-resolving the source workspace current revision.',
  parameters: { candidateId: { type: 'string', required: true } },
  output: summaryOutput,
  execute: async (args, execution) =>
    jsonSummary({ candidate: await requireService().retryCandidate(args.candidateId, agentIdOf(execution), execution.signal) }),
})

const integrationCancelTool = defineTool({
  name: 'jj_integration_cancel',
  description: 'Cancel a queued, blocked, failed, or stale candidate. Source revisions are preserved; no commit is abandoned.',
  parameters: { candidateId: { type: 'string', required: true } },
  output: summaryOutput,
  execute: async (args, execution) => jsonSummary({ candidate: await requireService().cancelCandidate(args.candidateId, agentIdOf(execution)) }),
})

const integrationMoveTool = defineTool({
  name: 'jj_integration_move',
  description: 'Reorder a queued candidate one position up or down. Integration remains serialized; this only changes queue order.',
  parameters: {
    candidateId: { type: 'string', required: true },
    direction: { type: 'string', enum: ['up', 'down'], required: true },
  },
  output: summaryOutput,
  execute: async args => jsonSummary({ candidate: await requireService().moveCandidate(args.candidateId, args.direction) }),
})

const integrationEventsTool = defineTool({
  name: 'jj_integration_events',
  description:
    'Read the bounded structured integration event log (workspace and integration lifecycle) for the future activity timeline. Read-only; events contain ids and revisions, never conversation content.',
  parameters: { limit: { type: 'integer', description: 'Maximum events, 1 to 500; defaults to 100.' } },
  output: summaryOutput,
  execute: async args => jsonSummary({ events: await requireService().listEvents(args.limit ?? 100) }),
})

const writerSummary = (record: {
  readonly name: string
  readonly writerEpoch: number
  readonly writerLease: unknown
  readonly observers: readonly unknown[]
}): { summary: string } =>
  jsonSummary({ workspace: record.name, writerEpoch: record.writerEpoch, writerLease: record.writerLease, observers: record.observers.length })

const workspaceClaimTool = defineTool({
  name: 'jj_workspace_claim',
  description:
    'Take the exclusive writer lease for one registered workspace. A live lease held by another session is refused; a quiet lease is reclaimed and its holder fenced. Only the holder may write in that workspace.',
  parameters: { workspaceId: { type: 'string', required: true, description: 'Coordinator workspace id from jj_workspace_list.' } },
  output: summaryOutput,
  execute: async (args, execution) =>
    writerSummary(await requireService().acquireWriter({ workspaceId: args.workspaceId, sessionId: agentIdOf(execution) ?? 'unknown', host: null })),
})

const workspaceReleaseTool = defineTool({
  name: 'jj_workspace_release',
  description: 'Release your exclusive writer lease on one workspace so another session may claim it. Only the current holder may release it.',
  parameters: { workspaceId: { type: 'string', required: true } },
  output: summaryOutput,
  execute: async (args, execution) =>
    writerSummary(await requireService().releaseWriter({ workspaceId: args.workspaceId, sessionId: agentIdOf(execution) ?? 'unknown' })),
})

const workspaceTransferTool = defineTool({
  name: 'jj_workspace_transfer',
  description:
    'Move the writer lease of one workspace to another session. A live holder blocks the transfer unless acknowledgeStopped is true; the previous holder is fenced by a new epoch and kept as a read-only observer.',
  parameters: {
    workspaceId: { type: 'string', required: true },
    toSessionId: { type: 'string', required: true },
    acknowledgeStopped: { type: 'boolean', description: 'Set only when the previous writer has stopped; it fences a live holder.' },
  },
  output: summaryOutput,
  execute: async args =>
    writerSummary(
      await requireService().transferWriter({
        workspaceId: args.workspaceId,
        toSessionId: args.toSessionId,
        acknowledgeStopped: args.acknowledgeStopped === true,
      }),
    ),
})

const workspaceObserveTool = defineTool({
  name: 'jj_workspace_observe',
  description: 'Register a read-only observer on one workspace. Observers may run read-only tools there and never gain write access.',
  parameters: { workspaceId: { type: 'string', required: true }, sessionId: { type: 'string', description: 'Defaults to the calling session.' } },
  output: summaryOutput,
  execute: async (args, execution) =>
    writerSummary(await requireService().addObserver({ workspaceId: args.workspaceId, sessionId: args.sessionId ?? agentIdOf(execution) ?? 'unknown' })),
})

const workspaceUnobserveTool = defineTool({
  name: 'jj_workspace_unobserve',
  description: 'Remove a read-only observer from one workspace.',
  parameters: { workspaceId: { type: 'string', required: true }, sessionId: { type: 'string', description: 'Defaults to the calling session.' } },
  output: summaryOutput,
  execute: async (args, execution) =>
    writerSummary(await requireService().removeObserver({ workspaceId: args.workspaceId, sessionId: args.sessionId ?? agentIdOf(execution) ?? 'unknown' })),
})

const api = jjIntegrationApi.host({
  overview: async () => {
    const { state, spineBookmark } = await requireService().overview()
    const count = (candidateState: string): number => state.candidates.filter(candidate => candidate.state === candidateState).length
    return {
      spineBookmark,
      repositories: [...state.repositories],
      workspaces: [...state.workspaces],
      candidates: [...(await requireService().listCandidates())],
      modes: { isolation: isolationMode, integration: integrationMode },
      counts: { queued: count('queued'), running: count('running'), blocked: count('blocked'), integrated: count('integrated') },
    }
  },
  inspect: async ({ input }) => {
    const detail = await requireService().inspectCandidate(input.candidateId)
    return {
      candidate: detail.candidate,
      alreadyIntegrated: detail.alreadyIntegrated,
      sourceStale: detail.sourceStale,
      sourceMissing: detail.sourceMissing,
      changedFiles: [...detail.changedFiles],
      spineChangedFiles: [...detail.spineChangedFiles],
      overlappingFiles: [...detail.overlappingFiles],
      dependencies: detail.dependencies.map(dependency => ({ id: dependency.id, state: dependency.state })),
    }
  },
  events: async ({ input }) => ({ events: [...(await requireService().listEvents(input.limit ?? 100))] }),
  run: async ({ input }) => {
    const result = await requireIntegrationEnabled().runCandidate({ candidateId: input.candidateId, sessionId: null })
    const outcome = result.outcome === 'running' ? 'failed' : result.outcome
    return { outcome, candidateId: input.candidateId, detail: result.detail }
  },
  retry: ({ input }) => requireService().retryCandidate(input.candidateId, null),
  cancel: ({ input }) => requireService().cancelCandidate(input.candidateId, null),
  move: ({ input }) => requireService().moveCandidate(input.candidateId, input.direction),
  refreshWorkspace: ({ input }) => requireService().refreshWorkspace(input.workspaceId),
  markReady: ({ input }) => requireService().markReady(input.workspaceId, null),
  submit: ({ input }) => requireService().submitCandidate({ workspaceId: input.workspaceId, sessionId: input.sessionId }),
  acquireWriter: ({ input }) => requireService().acquireWriter({ workspaceId: input.workspaceId, sessionId: input.sessionId, host: null }),
  releaseWriter: ({ input }) => requireService().releaseWriter({ workspaceId: input.workspaceId, sessionId: input.sessionId }),
  transferWriter: ({ input }) =>
    requireService().transferWriter({
      workspaceId: input.workspaceId,
      toSessionId: input.toSessionId,
      acknowledgeStopped: input.acknowledgeStopped,
    }),
})

const discoverWorkspace = async (agent: Agent, config: JjIntegrationConfig): Promise<void> => {
  if (!config.autoDiscoverWorkspaces || service === undefined) return
  const cwd = agent.session.header.cwd
  if (cwd === undefined || cwd.length === 0) return
  try {
    await service.registerWorkspace({ path: cwd, sessionId: agent.id, source: 'session-cwd' })
  } catch (error) {
    hostContext?.logger.debug('jj-integration: workspace discovery skipped (%s)', error instanceof Error ? error.message : String(error))
  }
}

const setupHost = (context: Context): Effect<void> => {
  hostContext = context
  const config = readConfig()
  applySettings()
  const executor = createExecutor(context)
  const active = createJjIntegrationService({
    executor,
    executeCommand: createCommandExecutor(context),
    options: {
      spineBookmark: config.spineBookmark,
      staleWriterMs: config.ownership.staleAfterSeconds * 1000,
      integrationMode: config.integration.mode,
      allowAnyAgentIntegration: config.allowAnyAgentIntegration,
      coordinatorSessions: config.coordinatorSessions,
      ...(config.validationCommand === undefined ? {} : { validationCommand: config.validationCommand }),
      onEvent: event => {
        context.emit('dshfiles/activity/event', { kind: 'integration', value: event })
        if (event.type.startsWith('workspace.writer_') || event.type.startsWith('workspace.observer_')) {
          context.emit('dshfiles/activity/event', {
            kind: 'workspace',
            value: {
              id: `workspace:${event.id}`,
              at: event.at,
              type: event.type,
              level: event.type === 'workspace.writer_fenced' ? 'attention' : 'notable',
              summary: `${event.type.replace('workspace.', '').replaceAll('_', ' ')}${event.sessionId === null ? '' : ` (${event.sessionId})`}`,
              detail: event.detail,
              sessionId: event.sessionId,
              workspaceId: event.workspaceId,
              workspaceName: null,
            },
          })
        }
        // Eligibility is explicit: only a workspace the writer marked ready
        // queues integration, and only when the mode is automatic.
        if (integrationMode === 'auto' && event.type === 'workspace.ready') {
          setTimeout(() => void driveAutoIntegration(), 0)
        }
      },
    },
  })
  context.on('dshfiles/activity/backfill', () => {
    void active.listEvents(200).then(events => {
      for (const event of events) context.emit('dshfiles/activity/event', { kind: 'integration', value: event })
    })
    return undefined
  })
  service = active
  applySettings()

  // The awaited workspace-resolution boundary. The Host asks this before the
  // Agent exists, so the first tool call already runs in the provisioned
  // workspace — or the Session is refused rather than handed the shared checkout.
  const resolver = createThreadWorkspaceResolver({
    mode: () => isolationMode,
    executor,
    spineRevision: config.spineBookmark,
    ...(config.workspaceIsolation.directory === undefined ? {} : { workspacesDirectory: config.workspaceIsolation.directory }),
    findBinding: async sessionId => {
      const bound = (await active.listWorkspaces()).find(
        workspace => !workspace.missing && workspace.owners.some(owner => owner.sessionId === sessionId && owner.detachedAt === null),
      )
      return bound === undefined ? undefined : { workspaceName: bound.name, path: bound.path }
    },
    rememberBinding: async input => {
      // Provisioned thread workspaces are the only ones ownership is enforced
      // for, so existing discovered workspaces are never migrated into it.
      await active.registerWorkspace({ path: input.path, sessionId: input.sessionId, source: 'session-cwd', isolated: true })
    },
  })
  context.provide('sessionWorkspaceResolver', {
    resolve: async (request: { readonly sessionId: string; readonly requestedCwd: string }) => {
      const outcome = await resolver.resolve(request)
      const at = Date.now()
      context.emit('dshfiles/activity/event', {
        kind: 'workspace',
        value: {
          id: `workspace:isolation:${request.sessionId}:${String(at)}`,
          at,
          type: outcome.kind === 'resolved' ? 'workspace.provisioned' : outcome.kind === 'refused' ? 'workspace.provision_refused' : 'workspace.refused',
          level: outcome.kind === 'refused' ? 'attention' : outcome.kind === 'resolved' ? 'notable' : 'routine',
          summary:
            outcome.kind === 'resolved'
              ? `Workspace ready: ${outcome.cwd}`
              : outcome.kind === 'refused'
                ? `Workspace isolation refused for ${request.sessionId}`
                : `Workspace isolation ${isolationMode === 'off' ? 'disabled' : 'manual'}; Session keeps ${request.requestedCwd}`,
          detail: outcome.kind === 'refused' ? outcome.reason : `requested ${request.requestedCwd}`,
          sessionId: request.sessionId,
          workspaceId: outcome.kind === 'resolved' ? outcome.cwd : null,
          workspaceName: outcome.kind === 'resolved' ? (outcome.cwd.split('/').filter(Boolean).slice(-1)[0] ?? null) : null,
        },
      })
      if (outcome.kind === 'refused') {
        context.logger.warn('jj-integration: refusing session %s workspace isolation: %s', request.sessionId, outcome.reason)
      }
      return outcome
    },
  })

  const toolGate = createToolGate({
    ownershipForPath: path => active.ownershipForPath(path),
    acquireWriter: input => active.acquireWriter(input),
    heartbeatWriter: input => active.heartbeatWriter(input),
    staleAfterMs: config.ownership.staleAfterSeconds * 1000,
    readOnlyTools: config.ownership.readOnlyTools,
    protectedPaths: config.ownership.protectedPaths,
    hostname,
    heldEpochs,
    onDeny: input => {
      const at = Date.now()
      context.emit('dshfiles/activity/event', {
        kind: 'workspace',
        value: {
          id: `workspace:refused:${input.sessionId}:${input.toolName}:${String(at)}`,
          at,
          type: input.code === 'unsafe-workspace' ? 'workspace.quarantined' : 'workspace.refused',
          level: 'attention',
          summary: `${input.toolName} refused: ${input.code === 'unsafe-workspace' ? 'workspace is quarantined' : 'workspace owned by another writer'}`,
          detail: input.reason,
          sessionId: input.sessionId,
          workspaceId: input.workspaceId,
          workspaceName: null,
        },
      })
      context.logger.warn('jj-integration: refused %s for %s: %s', input.toolName, input.sessionId, input.reason)
    },
    onError: input => {
      context.logger.error('jj-integration: workspace ownership could not be verified for %s: %s', input.sessionId, describeError(input.error))
    },
  })

  context.on('tools/pre-execute', (execution, next) => toolGate(execution, next))

  context.on('session/disposed', session => {
    heldEpochs.delete(session.id)
    void active.releaseWriterForSession(session.id).catch(error => {
      context.logger.debug('jj-integration: could not release writer leases for %s (%s)', session.id, describeError(error))
    })
  })

  const driveAutoIntegration = async (): Promise<void> => {
    if (integrationMode !== 'auto' || autoDriverRunning) return
    autoDriverRunning = true
    try {
      for (;;) {
        const next = (await active.listCandidates()).find(candidate => candidate.state === 'queued')
        if (next === undefined) break
        const result = await active.runCandidate({ candidateId: next.id, sessionId: null })
        context.emit('dshfiles/activity/event', {
          kind: 'integration',
          value: { driver: 'auto', candidateId: next.id, outcome: result.outcome, detail: result.detail },
        })
      }
    } catch (error) {
      context.logger.warn('jj-integration: automatic integration stopped: %s', describeError(error))
    } finally {
      autoDriverRunning = false
    }
  }

  context.on('agent/created', ({ agent }) => {
    void discoverWorkspace(agent, config)
    return undefined
  })
  return {
    async *[Symbol.asyncIterator]() {
      try {
        for (const agent of context.agents.list()) void discoverWorkspace(agent, config)
        yield async () => {
          if (service === active) service = undefined
          if (hostContext === context) hostContext = undefined
          integrationMode = 'manual'
        }
      } catch (error) {
        if (service === active) service = undefined
        if (hostContext === context) hostContext = undefined
        throw error
      }
    },
  }
}

const host = defineHost({
  name: 'jj-integration',
  inject: ['subprocess', 'agents'],
  settings: [ownedSettings],
  apis: [api],
  tools: [
    workspaceListTool,
    workspaceInspectTool,
    workspaceClaimTool,
    workspaceReleaseTool,
    workspaceTransferTool,
    workspaceObserveTool,
    workspaceUnobserveTool,
    workspaceRegisterTool,
    workspaceReadyTool,
    integrationSubmitTool,
    integrationListTool,
    integrationInspectTool,
    integrationRunTool,
    integrationRetryTool,
    integrationCancelTool,
    integrationMoveTool,
    integrationEventsTool,
  ],
  setup: setupHost,
})

export default host
