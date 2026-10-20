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

/** The item fields needed to start a thread, whether selected from a list or its detail view. */
export interface StartThreadItem {
  readonly id: number
  readonly title: string
  readonly project: string | null
  readonly preview: string
}

/** What the panel collects before starting a thread for an item. */
export interface StartThreadRequest {
  readonly item: StartThreadItem
  readonly target: StartThreadTarget
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string | undefined
  readonly message: string
  /** Send the message as the thread's first turn; false leaves it as an editable draft. */
  readonly send: boolean
}

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

  /** Every model as one flat list, so a `<select>` can carry a single index and every provider stays visible. */
  static rows(catalog: StartThreadCatalog): StartThreadModelRow[] {
    return catalog.providers.flatMap(provider => provider.models.map(model => ({ key: `${provider.id}/${model.id}`, provider, model })))
  }

  /** The item's own project preselects; a project-registered path wins over the same path taken as a bare folder. */
  static targets(item: StartThreadItem, projects: readonly StartThreadProject[]): StartThreadTargetOption[] {
    const registered = projects.map(project => ({
      value: `project:${project.id}`,
      label: project.title,
      target: { kind: 'project', projectId: project.id } as const,
    }))
    const itemPath = item.project
    const bare =
      itemPath === null || projects.some(project => project.path === itemPath)
        ? []
        : [{ value: `cwd:${itemPath}`, label: `${itemPath} (folder, no project)`, target: { kind: 'cwd', path: itemPath } as const }]
    const fallback = projects.length === 0 ? 'No workspace' : 'Host default workspace'
    return [...bare, { value: 'default', label: fallback, target: { kind: 'default' } as const }, ...registered]
  }

  /** The preselected target value: the item's project when it resolves, otherwise the Host default. */
  static defaultTargetValue(item: StartThreadItem, projects: readonly StartThreadProject[]): string {
    if (item.project === null) return 'default'
    const project = projects.find(candidate => candidate.path === item.project)
    return project === undefined ? `cwd:${item.project}` : `project:${project.id}`
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

  /** The opening message: enough for the agent to find the item without pasting the whole body. */
  static message(item: StartThreadItem): string {
    const heading = `Work on b:${String(item.id)}: ${item.title}`
    const body = item.preview.trim() === '' || item.preview.trim() === item.title ? '' : `\n\n${item.preview}`
    return `${heading}${body}`.slice(0, MESSAGE_MAX)
  }

  /** The thread title the sidebar shows, clipped to the Session title limit. */
  static title(item: StartThreadItem): string {
    return item.title.slice(0, TITLE_MAX)
  }
}

export const startThreadLimits = { titleMax: TITLE_MAX, messageMax: MESSAGE_MAX } as const
