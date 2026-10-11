import type {} from '@deepseek-ai/dsh-subprocess'
import type { Context, Effect } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { InferValue, ToolRunContext, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { defineHost, defineTool } from '@dshfiles/dshx/host'
import { z } from 'zod'
import { jjIntegrationApi } from './api.js'
import type { JjExecutor, CommandExecutor } from './jj.js'
import { IntegrationError, createJjIntegrationService, type JjIntegrationService } from './service.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'dshfiles/activity/event'(payload: unknown): void
    'dshfiles/activity/backfill'(payload: { readonly since?: number }): void
  }
}

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

export const Config = z.object({
  spineBookmark: z.string().min(1).max(128).default('integration-spine'),
  validationCommand: z.string().min(1).max(500).optional(),
  allowAnyAgentIntegration: z.boolean().default(false),
  coordinatorSessions: z.array(z.string().min(1).max(256)).max(64).default([]),
  autoDiscoverWorkspaces: z.boolean().default(true),
})
export type JjIntegrationConfig = z.infer<typeof Config>

const createExecutor = (ctx: Context): JjExecutor => async input => {
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

const createCommandExecutor = (ctx: Context): CommandExecutor => async input => {
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
    if (path === undefined || path.length === 0) throw new IntegrationError('path-required', 'Provide a workspace path; the calling Session has no working directory.')
    const workspace = await requireService().registerWorkspace({ path, sessionId, source: 'agent-tool', ...(execution.signal === undefined ? {} : { signal: execution.signal }) })
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
  execute: async (args, execution) => jsonSummary(await requireService().runCandidate({ candidateId: args.candidateId, sessionId: agentIdOf(execution), ...(execution.signal === undefined ? {} : { signal: execution.signal }) })),
})

const integrationRetryTool = defineTool({
  name: 'jj_integration_retry',
  description: 'Re-queue a blocked, failed, stale, or cancelled candidate, re-resolving the source workspace current revision.',
  parameters: { candidateId: { type: 'string', required: true } },
  output: summaryOutput,
  execute: async (args, execution) => jsonSummary({ candidate: await requireService().retryCandidate(args.candidateId, agentIdOf(execution), execution.signal) }),
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

const api = jjIntegrationApi.host({
  overview: async () => {
    const { state, spineBookmark } = await requireService().overview()
    const count = (candidateState: string): number => state.candidates.filter(candidate => candidate.state === candidateState).length
    return {
      spineBookmark,
      repositories: [...state.repositories],
      workspaces: [...state.workspaces],
      candidates: [...(await requireService().listCandidates())],
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
    const result = await requireService().runCandidate({ candidateId: input.candidateId, sessionId: null })
    const outcome = result.outcome === 'running' ? 'failed' : result.outcome
    return { outcome, candidateId: input.candidateId, detail: result.detail }
  },
  retry: ({ input }) => requireService().retryCandidate(input.candidateId, null),
  cancel: ({ input }) => requireService().cancelCandidate(input.candidateId, null),
  move: ({ input }) => requireService().moveCandidate(input.candidateId, input.direction),
  refreshWorkspace: ({ input }) => requireService().refreshWorkspace(input.workspaceId),
  markReady: ({ input }) => requireService().markReady(input.workspaceId, null),
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

const setupHost = (context: Context, config: JjIntegrationConfig): Effect<void> => {
  hostContext = context
  const active = createJjIntegrationService({
    executor: createExecutor(context),
    executeCommand: createCommandExecutor(context),
    options: {
      spineBookmark: config.spineBookmark,
      allowAnyAgentIntegration: config.allowAnyAgentIntegration,
      coordinatorSessions: config.coordinatorSessions,
      ...(config.validationCommand === undefined ? {} : { validationCommand: config.validationCommand }),
      onEvent: event => {
        context.emit('dshfiles/activity/event', { kind: 'integration', value: event })
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
  Config,
  apis: [api],
  tools: [
    workspaceListTool,
    workspaceInspectTool,
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
