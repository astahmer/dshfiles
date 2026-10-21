import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { z } from 'zod'

const effortSchema = z.object({ id: z.string(), name: z.string(), description: z.string().optional() })
const modelSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  reasoning: z.object({ efforts: z.array(effortSchema), defaultEffort: z.string().optional() }).optional(),
})
const catalogSchema = z.object({
  default: z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string().optional() }),
  groups: z.array(z.object({ id: z.string(), name: z.string(), models: z.array(modelSchema) })),
})

/** One registered project (DSH Workspace) a thread can be started in. */
export interface StartThreadProject {
  readonly id: WorkspaceId
  readonly title: string
  readonly path: string
}

/** What starting a thread reads from an item; a summary or a full detail both satisfy it. */
export interface StartThreadItem {
  readonly id: number
  readonly title: string
  /** The opening message's context line; empty when the title already says it. */
  readonly preview: string
  readonly project: string | null
}

/** One selectable reasoning effort of an exact model route. */
export interface StartThreadEffort {
  readonly id: string
  readonly name: string
}

/** One model a thread can run, with the efforts its adapter advertises. */
export interface StartThreadModel {
  readonly id: string
  readonly name: string
  readonly description: string | undefined
  readonly efforts: readonly StartThreadEffort[]
  readonly defaultEffort: string | undefined
}

/** One provider route (an account) with its models. */
export interface StartThreadProvider {
  readonly id: string
  readonly name: string
  readonly models: readonly StartThreadModel[]
}

/** The Host's model catalog, decoded at the client boundary. */
export interface StartThreadCatalog {
  readonly defaultProvider: string
  readonly defaultModel: string
  readonly defaultReasoningEffort: string | undefined
  readonly providers: readonly StartThreadProvider[]
}

/** The `sessions.create` arguments a started thread passes; `agentPreset` applies the agent's tool composition. */
export interface StartThreadCreation {
  readonly workspaceId?: WorkspaceId
  readonly cwd?: string
  readonly agentPreset?: string
}

/** Where the thread runs: a registered project, a bare folder, or the Host default directory. */
export type StartThreadTarget =
  | { readonly kind: 'project'; readonly projectId: WorkspaceId }
  | { readonly kind: 'cwd'; readonly path: string }
  | { readonly kind: 'default' }

/** One row of the dialog's model list. */
export interface StartThreadModelRow {
  readonly key: string
  readonly provider: StartThreadProvider
  readonly model: StartThreadModel
}

/** One entry of the dialog's project list. */
export interface StartThreadTargetOption {
  readonly value: string
  readonly label: string
  readonly target: StartThreadTarget
}

/** The persistent agent a thread is started as: its preset, its route, and its instructions. */
export interface StartThreadAgent {
  readonly handle: string
  readonly name: string
  readonly instructions: string
  /** The agent's standing routine, carried into the opening message; absent when it has none. */
  readonly routine?: string
  readonly preset: string | null
  readonly route: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string | undefined } | null
}

/** An agent the dialog can start the thread as, with the one line that tells it apart from the others. */
export interface StartThreadAgentChoice extends StartThreadAgent {
  readonly description: string
}

/** What the panel collects before starting a thread: one opening message for one or several items. */
export interface StartThreadRequest {
  /** The item (or the selection) the thread works on; every one of them is linked to the new thread. */
  readonly items: readonly StartThreadItem[]
  readonly target: StartThreadTarget
  /** The agent picked in the dialog; its preset and route win over the provider/model fields. */
  readonly agent?: StartThreadAgent
  /** `null` leaves the Host default when no agent route applies. */
  readonly provider: string | null
  readonly model: string | null
  readonly reasoningEffort: string | undefined
  readonly message: string
  /** Send the message as the thread's first turn; false leaves it as an editable draft. */
  readonly send: boolean
  /** Open the created thread once it exists; false leaves the panel where it is. */
  readonly open: boolean
}

/** What a start-thread run answered: the Session it created, or why nothing was started. */
export type StartThreadOutcome = { readonly ok: true; readonly sessionId: string } | { readonly ok: false; readonly reason: string }

const TITLE_MAX = 200
const MESSAGE_MAX = 4_000

/** Pure dialog decisions: which project preselects, which models list, and what the first message says. */
export class StartThreadForm {
  /** Decode the Host catalog, keeping only routable groups and their advertised efforts. */
  static catalog(value: ModelCatalog): StartThreadCatalog {
    const parsed = catalogSchema.parse(value)
    return {
      defaultProvider: parsed.default.provider,
      defaultModel: parsed.default.model,
      defaultReasoningEffort: parsed.default.reasoningEffort,
      providers: parsed.groups.map(group => ({
        id: group.id,
        name: group.name,
        models: group.models.map(model => ({
          id: model.id,
          name: model.name,
          description: model.description,
          efforts: model.reasoning?.efforts.map(effort => ({ id: effort.id, name: effort.name })) ?? [],
          defaultEffort: model.reasoning?.defaultEffort,
        })),
      })),
    }
  }

  /** Every model as one flat list, so one picker carries a single key and every provider stays visible. */
  static rows(catalog: StartThreadCatalog): StartThreadModelRow[] {
    return catalog.providers.flatMap(provider => provider.models.map(model => ({ key: `${provider.id}/${model.id}`, provider, model })))
  }

  /** One item's own project preselects; a project-registered path wins over the same path taken as a bare folder. */
  static targets(items: readonly StartThreadItem[], projects: readonly StartThreadProject[]): StartThreadTargetOption[] {
    const registered = projects.map(project => ({
      value: `project:${project.id}`,
      label: project.title,
      target: { kind: 'project', projectId: project.id } as const,
    }))
    const itemPath = items[0]?.project ?? null
    const bare =
      itemPath === null || projects.some(project => project.path === itemPath)
        ? []
        : [{ value: `cwd:${itemPath}`, label: `${itemPath} (folder, no project)`, target: { kind: 'cwd', path: itemPath } as const }]
    const fallback = projects.length === 0 ? 'No workspace' : 'Host default workspace'
    return [...bare, { value: 'default', label: fallback, target: { kind: 'default' } as const }, ...registered]
  }

  /** The preselected target value: the first item's project when it resolves, otherwise the Host default. */
  static defaultTargetValue(items: readonly StartThreadItem[], projects: readonly StartThreadProject[]): string {
    const itemPath = items[0]?.project ?? null
    if (itemPath === null) return 'default'
    const project = projects.find(candidate => candidate.path === itemPath)
    return project === undefined ? `cwd:${itemPath}` : `project:${project.id}`
  }

  /** The preselected model row key, falling back to the first listed model when the default left the catalog. */
  static defaultModelKey(catalog: StartThreadCatalog): string | undefined {
    const rows = StartThreadForm.rows(catalog)
    const preferred = rows.find(row => row.provider.id === catalog.defaultProvider && row.model.id === catalog.defaultModel)
    return (preferred ?? rows[0])?.key
  }

  /** The selected model's default effort, if it advertises efforts at all. */
  static defaultEffort(row: StartThreadModelRow): string | undefined {
    return row.model.defaultEffort ?? row.model.efforts[0]?.id
  }

  /** The opening message: enough for the agent to find every item without pasting the whole bodies. */
  static message(items: readonly StartThreadItem[]): string {
    const body = items.map((item, index) => {
      const heading = `${index === 0 ? 'Work on' : 'Also'} b:${String(item.id)}: ${item.title}`
      const preview = item.preview.trim()
      // A selection keeps headings only: each preview could be a whole item, and the agent reads them from b: refs.
      if (items.length > 1 || preview === '' || preview === item.title) return heading
      return `${heading}\n\n${preview}`
    })
    return body.join('\n\n').slice(0, MESSAGE_MAX)
  }

  /** The thread title the sidebar shows: the first item, and how many more the selection carried. */
  static title(items: readonly StartThreadItem[]): string {
    const first = items[0]?.title ?? ''
    const extra = items.length - 1
    return (extra > 0 ? `${first} +${String(extra)}` : first).slice(0, TITLE_MAX)
  }

  /** The items a report names, so the panel can say what a background run is doing. */
  static refs(items: readonly StartThreadItem[]): string {
    return items.map(item => `b:${String(item.id)}`).join(', ')
  }

  /** What a run reports while it waits for the jj workspace and the Session: the work is under way, not done. */
  static starting(items: readonly StartThreadItem[]): string {
    return `Starting a thread for ${StartThreadForm.refs(items)}…`
  }

  /** What a started thread reports without opening it: the items it works on, so the panel can say what happened. */
  static started(items: readonly StartThreadItem[]): string {
    return `Thread started for ${StartThreadForm.refs(items)}`
  }
}

/** The item fields a started thread reads, so every list can hand its row straight to the dialog. */
export const startThreadItemOf = (item: {
  readonly id: number
  readonly title: string
  readonly project: string | null
  readonly preview?: string | null | undefined
  readonly body?: string | null | undefined
}): StartThreadItem => ({ id: item.id, title: item.title, project: item.project, preview: item.preview ?? item.body ?? '' })

/** The items' own target as a `StartThreadTarget`, for a caller that starts a thread without the dialog. */
export const defaultTargetFor = (items: readonly StartThreadItem[], projects: readonly StartThreadProject[]): StartThreadTarget => {
  const value = StartThreadForm.defaultTargetValue(items, projects)
  const option = StartThreadForm.targets(items, projects).find(candidate => candidate.value === value)
  return option?.target ?? { kind: 'default' }
}

export const startThreadLimits = { titleMax: TITLE_MAX, messageMax: MESSAGE_MAX } as const
