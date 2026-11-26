import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import type { ProjectColorPalette } from './organization.js'
import type { ProjectChip } from './project-colors.js'
import type { ThreadDirectories } from './thread-directories.js'
import type { ThreadWorkStatus } from './thread-status-client.js'
import { WorkspacePaths } from './workspace-paths.js'

/**
 * The phone thread header's second line (council round 17 B2.2): `[mark] project · Working · 1 subagent`, the thread
 * list's grammar under the title. The project is the one the list names (a thread workspace reads the project it was cut
 * from), its mark painted as the list's row paints it; the status word is the list's own (Approval, Question, Turn failed
 * for an attention thread); the count is the subagents working now. Unknown project: no mark and no name.
 */
export interface PhoneStageMeta {
  readonly project: string | undefined
  readonly mark: { readonly tone?: number; readonly color?: string; readonly palette: ProjectColorPalette } | undefined
  readonly status: string
  readonly subagents: string | undefined
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
  const status = input.status?.kind ?? input.wordOf(input.status?.status ?? (input.running || input.subagents > 0 ? 'working' : 'idle'))
  return { project, mark, status, subagents: input.subagents > 0 ? input.subagentsLabel(input.subagents) : undefined }
}

export const PhoneThreadMeta = { resolve }
