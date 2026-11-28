import { DockChanges } from '@dshfiles/plugin-ui/components/motion/activity-dock'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ArrowUpRightIcon, FileDiffIcon, FolderIcon } from '@dshfiles/plugin-ui/icons'
import type { TurnActivitySummary } from './turn-activity.js'
import { TurnWalkthroughModel } from './turn-walkthrough-model.js'

/** Whether the turn edited files, so the summary row names them as chips. */
export const hasEditedFiles = (summary: TurnActivitySummary): boolean => summary.editedFileStats.length > 0

/** Whether the summary row offers the walkthrough: only when it says more than the chips do. */
export const hasWalkthrough = (summary: TurnActivitySummary, chipLimit: number): boolean => TurnWalkthroughModel.addsDetail(summary.editedFileStats, chipLimit)

/**
 * The walkthrough toggle inside the turn summary row: a labelled control, so a closed walkthrough is never a lone
 * icon floating above the composer.
 */
export const TurnWalkthroughToggle = (props: { readonly open: boolean; readonly onToggle: () => void }): JSX.Element => (
  <button
    aria-expanded={props.open}
    // Council round 7 C5: a link in the strip's grammar, underlined on hover and while open, no chevron.
    className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:hover:text-foreground dshx:pointer-coarse:min-h-11 dshx:underline-offset-2 dshx:hover:underline dshx:aria-expanded:text-foreground dshx:aria-expanded:underline"
    onClick={props.onToggle}
    type="button"
  >
    <FileDiffIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
    <span>Walkthrough</span>
  </button>
)

/** The opened walkthrough: the changed files by folder, each opening in the editor, and the way into that turn's Changes view. */
export const TurnWalkthroughList = (props: {
  readonly summary: TurnActivitySummary
  readonly openFile: (path: string) => void
  readonly openChanges: (() => void) | undefined
}): JSX.Element => (
  <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:items-start dshx:gap-2 dshx:pl-5" data-dshfiles-turn-walkthrough="">
    <DockChanges
      className="dshx:w-full dshx:gap-3"
      groups={TurnWalkthroughModel.groups(props.summary.editedFileStats).map(group => ({
        id: group.directory,
        label: group.directory,
        icon: <FolderIcon />,
        // An empty summary draws no hint line.
        hint: group.summary,
        files: group.files.map(file => ({ ...file, onOpen: () => props.openFile(file.fullPath) })),
      }))}
    />
    {props.openChanges === undefined ? null : (
      <Button type="button" variant="ghost" size="xs" onClick={props.openChanges}>
        Review in Changes
        <ArrowUpRightIcon aria-hidden className="dshx:size-3" />
      </Button>
    )}
  </div>
)
