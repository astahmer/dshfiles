import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { z } from 'zod'
import { Agents, type Agent } from './agent.js'

const effortSchema = z.object({ id: z.string(), name: z.string() })
const modelSchema = z.object({
  id: z.string(),
  name: z.string(),
  reasoning: z.object({ efforts: z.array(effortSchema), defaultEffort: z.string().optional() }).optional(),
})
const scheduleEntrySchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  title: z.string().optional(),
  status: z.enum(['active', 'inactive']),
})
const scheduleCatalogSchema = z.array(scheduleEntrySchema)

const catalogSchema = z.object({
  default: z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string().optional() }),
  groups: z.array(z.object({ id: z.string(), name: z.string(), models: z.array(modelSchema) })),
})

/** The `sessions.create` arguments a dispatch passes: a workspace, a bare folder, or neither for the Host default. */
export interface AgentThreadCreation {
  readonly workspaceId?: WorkspaceId
  readonly cwd?: string
  /** The agent's Agent preset; absent means the Host default composition. */
  readonly agentPreset?: string
}

/** The `selectModel` arguments a dispatch passes when the agent pins a route. */
export interface AgentModelSelection {
  readonly sessionId: SessionId
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** Where a dispatched thread runs, mirroring the composer's own choices. */
export type AgentThreadTarget =
  | { readonly kind: 'project'; readonly projectId: WorkspaceId }
  | { readonly kind: 'cwd'; readonly path: string }
  | { readonly kind: 'default' }

/** One routable provider/model pair a person can pin to an agent. */
export interface AgentModelOption {
  readonly key: string
  readonly provider: string
  readonly providerName: string
  readonly model: string
  readonly modelName: string
  readonly efforts: readonly string[]
  readonly defaultEffort: string | undefined
}

/** The Host's model catalog, decoded at the client boundary. */
export interface AgentCatalog {
  readonly defaultKey: string | null
  readonly options: readonly AgentModelOption[]
}

/** One Host reminder that belongs to a thread an agent started. */
export interface AgentScheduleRow {
  readonly id: string
  readonly sessionId: string
  readonly title: string
  readonly status: 'active' | 'inactive'
}

/** A dispatch request as the panel or a backlog comment builds it. */
export interface AgentDispatchRequest {
  readonly agent: Agent
  readonly prompt: string
  readonly target: AgentThreadTarget
}

/** Pure dispatch decisions: target arguments, route defaults and the opening prompt. */
export class AgentDispatch {
  /** Decode the Host catalog into the rows an agent's route field offers. */
  static catalog(value: ModelCatalog): AgentCatalog {
    const parsed = catalogSchema.parse(value)
    const options = parsed.groups.flatMap(group =>
      group.models.map(model => ({
        key: `${group.id}/${model.id}`,
        provider: group.id,
        providerName: group.name,
        model: model.id,
        modelName: model.name,
        efforts: model.reasoning?.efforts.map(effort => effort.id) ?? [],
        defaultEffort: model.reasoning?.defaultEffort,
      })),
    )
    const defaultKey = `${parsed.default.provider}/${parsed.default.model}`
    return { defaultKey: options.some(option => option.key === defaultKey) ? defaultKey : null, options }
  }

  static optionKey(option: { readonly provider: string; readonly model: string }): string {
    return `${option.provider}/${option.model}`
  }

  /** The route a new agent starts from: nothing pinned, so it follows the harness default. */
  static defaultRoute(): { readonly provider: string; readonly model: string } | null {
    return null
  }

  /** `sessions.create` arguments: a project, a bare folder, or the Host default directory. */
  static creationArgs(target: AgentThreadTarget, defaultWorkspaceId: WorkspaceId | undefined): AgentThreadCreation {
    if (target.kind === 'project') return { workspaceId: target.projectId }
    if (target.kind === 'cwd') return { cwd: target.path }
    return defaultWorkspaceId === undefined ? {} : { workspaceId: defaultWorkspaceId }
  }

  /** The thread a dispatch opens: the agent's instructions, then the request. */
  static openingMessage(request: AgentDispatchRequest): string {
    return Agents.openingMessage({
      agent: request.agent,
      text: request.prompt,
      fallback: `Work as @${request.agent.handle}. Inspect the current workspace and wait for the next instruction if the task is unclear.`,
    })
  }

  /** The schedules catalog, narrowed to the threads one agent started; decoded once at the client boundary. */
  static schedules(value: unknown, sessionIds: readonly string[]): AgentScheduleRow[] {
    const wanted = new Set(sessionIds)
    return scheduleCatalogSchema
      .parse(value)
      .filter(entry => wanted.has(entry.sessionId))
      .map(entry => ({ id: entry.id, sessionId: entry.sessionId, title: entry.title ?? 'Reminder', status: entry.status }))
  }

  static title(request: AgentDispatchRequest): string {
    return Agents.title(request.prompt.trim() === '' ? request.agent.name : request.prompt)
  }
}
