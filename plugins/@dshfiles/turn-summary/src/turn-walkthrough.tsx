import { ActivityDock, DockChanges } from '@dshfiles/plugin-ui/components/motion/activity-dock'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ArrowUpRightIcon, FileDiffIcon, FolderIcon } from '@dshfiles/plugin-ui/icons'
import { useState } from 'react'
import type { TurnActivitySummary } from './turn-activity.js'
import { TurnWalkthroughModel } from './turn-walkthrough-model.js'

const TAB = 'changes'

/**
 * The walkthrough card under a turn that edited files: the files by folder, each folder's one-line summary, and the
 * way into the Changes view for that turn. It starts open; its icon folds it to one button.
 */
export const TurnWalkthrough = (props: {
  readonly summary: TurnActivitySummary
  readonly turn: number
  readonly openChanges: (() => void) | undefined
}): JSX.Element | null => {
  const [open, setOpen] = useState<string | null>(TAB)
  const files = props.summary.editedFileStats
  if (files.length === 0) return null
  const groups = TurnWalkthroughModel.groups(files)
  const added = files.reduce((total, file) => total + file.added, 0)
  const removed = files.reduce((total, file) => total + file.removed, 0)
  return (
    <div className="dshx-root dshx:@container dshx:flex dshx:w-full dshx:min-w-0" data-dshfiles-turn-walkthrough="">
      <ActivityDock
        aria-label={`Turn ${String(props.turn)} walkthrough`}
        value={open}
        onValueChange={setOpen}
        panelWidth={420}
        className="dshx:mr-auto dshx:ml-0 dshx:shadow-none"
        tabs={[
          {
            id: TAB,
            label: 'Walkthrough',
            icon: <FileDiffIcon />,
            title: `Changed ${String(files.length)} ${files.length === 1 ? 'file' : 'files'}`,
            meta:
              added + removed > 0 ? (
                <>
                  <span className="dshx:text-success">+{added}</span> <span className="dshx:text-destructive">−{removed}</span>
                </>
              ) : undefined,
            content: (
              <DockChanges
                className="dshx:gap-3"
                groups={groups.map(group => ({
                  id: group.directory,
                  label: group.directory,
                  icon: <FolderIcon />,
                  hint: group.summary,
                  files: group.files,
                }))}
              />
            ),
            footer:
              props.openChanges === undefined ? undefined : (
                <Button type="button" variant="ghost" size="xs" onClick={props.openChanges}>
                  Review in Changes
                  <ArrowUpRightIcon aria-hidden className="dshx:size-3" />
                </Button>
              ),
          },
        ]}
      />
    </div>
  )
}
