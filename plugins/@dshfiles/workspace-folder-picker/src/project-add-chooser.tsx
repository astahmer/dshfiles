import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { FolderOpenIcon, FolderPlusIcon, GitBranchIcon } from '@dshfiles/plugin-ui/icons'
import type { ReactNode } from 'react'

/** One way to add a project, as a full-width row: the icon, a label, and one sentence saying what happens. */
const ChoiceRow = (props: { readonly icon: ReactNode; readonly label: string; readonly hint: string; readonly onClick: () => void }): JSX.Element => (
  <Button
    className="dshx:h-auto dshx:w-full dshx:shrink dshx:items-start dshx:justify-start dshx:gap-3 dshx:px-3 dshx:py-3 dshx:text-left"
    onClick={props.onClick}
    type="button"
    variant="outline"
  >
    <span className="dshx:mt-0.5 dshx:flex dshx:size-8 dshx:flex-none dshx:items-center dshx:justify-center dshx:rounded-md dshx:bg-muted">{props.icon}</span>
    <span className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
      <span className="dshx:text-sm dshx:font-medium">{props.label}</span>
      <span className="dshx:text-xs dshx:leading-snug dshx:text-muted-foreground">{props.hint}</span>
    </span>
  </Button>
)

/**
 * The first screen of the add-a-project flow. It used to open straight onto a filesystem listing, which read as "why am
 * I in Finder?" and left no way to create or clone a project from the composer's Choose project menu. Every route the
 * picker plugin owns is one row here.
 */
export const ProjectAddChooser = (props: {
  readonly open: boolean
  readonly onBrowse: () => void
  readonly onCreate: () => void
  readonly onClone: () => void
  readonly onClose: () => void
  readonly gitHubAvailable: boolean
}): JSX.Element => (
  <Dialog open onOpenChange={(open: boolean) => (open ? undefined : props.onClose())}>
    <DialogContent className="dshx-root dshx:max-w-md">
      <DialogHeader>
        <DialogTitle>Add a project</DialogTitle>
        <DialogDescription>Add a folder that already exists, create a new project, or clone a repository.</DialogDescription>
      </DialogHeader>
      <div className="dshx:flex dshx:flex-col dshx:gap-2">
        <ChoiceRow
          hint="A folder that already exists on this machine. Its colour is picked next."
          icon={<FolderOpenIcon aria-hidden size={16} />}
          label="Add folder"
          onClick={props.onBrowse}
        />
        <ChoiceRow
          hint="A new folder with a Jujutsu repository, a README and a first commit."
          icon={<FolderPlusIcon aria-hidden size={16} />}
          label="Create project"
          onClick={props.onCreate}
        />
        {props.gitHubAvailable && (
          <ChoiceRow
            hint="Clone a repository from a URL, with its history and remote."
            icon={<GitBranchIcon aria-hidden size={16} />}
            label="Clone repository"
            onClick={props.onClone}
          />
        )}
      </div>
      <DialogFooter>
        <Button onClick={props.onClose} type="button" variant="ghost">
          Cancel
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
)
