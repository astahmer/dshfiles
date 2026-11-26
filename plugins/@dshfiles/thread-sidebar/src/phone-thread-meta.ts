import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import type { ProjectColorPalette } from './organization.js'
import type { ProjectChip } from './project-colors.js'
import type { ThreadDirectories } from './thread-directories.js'
import type { SubagentModelRoute } from './subagent-provenance/route-label.js'
import type { ThreadWorkStatus } from './thread-status-client.js'
import { WorkspacePaths } from './workspace-paths.js'

/**
 * The phone thread header's second line (council round 17 B2.2): `[mark] project · Working · 1 subagent`, the thread
 * list's grammar under the title. The project is the one the list names (a thread workspace reads the project it was cut
 * from), its mark painted as the list's row paints it; the status word is the list's own (Approval, Question, Turn failed
 * for an attention thread); the count is the subagents working now. Unknown project: no mark and no name.
 *
 * A subagent's header (round 21 D3) says what the desktop lineage says: line 2 reads `[mark] model · state` (the model
 * stands where the project would), the bar's Back opens its parent thread, and the title is the name its parent gave it
 * (the subagent call's description), not the prompt it was sent. An unknown model keeps the project.
 */
export interface PhoneStageMeta {
  readonly project: string | undefined
  readonly mark: { readonly tone?: number; readonly color?: string; readonly palette: ProjectColorPalette } | undefined
  readonly status: string
  /** The status word says Working (not an attention kind): the header draws the list's working ring before it. */
  readonly working: boolean
  readonly subagents: string | undefined
  /** A subagent's model, drawn with the kit's `RouteModel` where the project would be. */
  readonly route?: SubagentModelRoute | undefined
  /** A subagent's parent thread: the bar's Back opens it. */
  readonly parent?: { readonly id: string; readonly title: string } | undefined
  /** A subagent's name from its parent's call; the bar's title instead of the Session title (its prompt). */
  readonly title?: string | undefined
}

/** What the stage thread is as a subagent: the parent's title, the name it was given, the model it runs on. */
export interface PhoneStageChild {
  readonly parentTitle: string | undefined
  readonly label: string | undefined
  readonly route: SubagentModelRoute | undefined
}

/** The workspace a thread or one of its ancestors is filed in, walking up the lineage (stage first). */
const workspaceOf = (lineage: readonly string[], workspaces: readonly WorkspaceView[]): WorkspaceView | undefined => {
  for (const id of lineage) {
    const found = workspaces.find(workspace => workspace.sessionIds.some(sessionId => sessionId === id))
    if (found !== undefined) return found
  }
  return undefined
}

/** The row's paint: the saved tone and colour when there are some, the line's ink with project colour off. */
const markOf = (chip: ProjectChip | undefined, palette: ProjectColorPalette, coloured: boolean): NonNullable<PhoneStageMeta['mark']> => {
  const tone = chip?.tone
  const color = coloured ? chip?.color : 'currentColor'
  if (tone === undefined) return color === undefined ? { palette } : { color, palette }
  return color === undefined ? { tone, palette } : { tone, color, palette }
}

const resolve = (input: {
  /** The stage thread first, then its ancestors. */
  readonly lineage: readonly string[]
  readonly workspaces: readonly WorkspaceView[]
  readonly threadDirectories: ThreadDirectories
  readonly status: ThreadWorkStatus | undefined
  readonly running: boolean
  readonly subagents: number
  readonly wordOf: (status: WorkStatus) => string
  readonly subagentsLabel: (count: number) => string
  readonly savedChipOf: (path: string) => ProjectChip | undefined
  readonly palette: ProjectColorPalette
  /** The list's project colour preference: off, the mark takes the line's ink. */
  readonly coloured: boolean
  /** Set when the stage thread has a parent (`lineage[1]`). */
  readonly child?: PhoneStageChild | undefined
}): PhoneStageMeta => {
  const filed = workspaceOf(input.lineage, input.workspaces)
  const projectPath = filed === undefined ? undefined : WorkspacePaths.projectPathOf({ path: filed.path, threadDirectories: input.threadDirectories })
  const owner = projectPath === undefined ? undefined : (input.workspaces.find(workspace => workspace.path === projectPath) ?? filed)
  // A thread workspace registered on its own reads "project · thread-…": the list names the project.
  const project = owner === undefined ? undefined : owner.title.split(' · ')[0]?.trim() || undefined
  const chip = projectPath === undefined ? undefined : input.savedChipOf(projectPath)
  const mark = project === undefined ? undefined : markOf(chip, input.palette, input.coloured)
  // The list's status store is empty while the phone list is closed, as it is inside a thread: then the thread works while
  // it or one of its subagents runs, the bar's own working rule (council round 13 B6).
  const work = input.status?.status ?? (input.running || input.subagents > 0 ? 'working' : 'idle')
  const status = input.status?.kind ?? input.wordOf(work)
  const working = input.status?.kind === undefined && work === 'working'
  const subagents = input.subagents > 0 ? input.subagentsLabel(input.subagents) : undefined
  const parentId = input.lineage[1]
  const child = input.child
  if (parentId === undefined || child === undefined) return { project, mark, status, working, subagents }
  const parentTitle = child.parentTitle?.trim() || undefined
  const title = child.label?.trim() || undefined
  const meta: { -readonly [Key in keyof PhoneStageMeta]: PhoneStageMeta[Key] } =
    child.route === undefined
      ? { project, mark, status, working, subagents }
      : { project: undefined, mark: undefined, route: child.route, status, working, subagents }
  if (parentTitle !== undefined) meta.parent = { id: parentId, title: parentTitle }
  if (title !== undefined) meta.title = title
  return meta
}

export const PhoneThreadMeta = { resolve }
