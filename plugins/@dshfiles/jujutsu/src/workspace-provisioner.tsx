import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { ProjectFolderPicker, type DirectoryPickerPort, type RegisteredProject } from '@dshfiles/project-folder-picker'
import { useState } from 'react'
import { workspaceNameSchema, type Mutation, type Revision } from './api.js'

interface WorkspaceProvisionerDialogProps {
  readonly revision: Revision
  readonly onClose: () => void
  readonly onPreview: (action: Mutation) => void
  /** The same Host picker the repository chooser uses, so a browse-only Host can choose a parent too. */
  readonly directoryPicker: DirectoryPickerPort
  readonly registerWorkspace: (canonicalPath: string) => Promise<RegisteredProject>
}

/** `jj workspace add` at one revision, opened from that revision's context menu. */
export const WorkspaceProvisionerDialog = (props: WorkspaceProvisionerDialogProps): JSX.Element => {
  const [parentPath, setParentPath] = useState('')
  const [name, setName] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const validName = workspaceNameSchema.safeParse(name).success
  const description = props.revision.description.split('\n')[0] || '(no description)'

  return (
    <Dialog onOpenChange={open => !open && props.onClose()} open>
      <DialogContent className="dshx-root dshx:sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription className="dshx:text-xs">
            A sibling jj workspace checked out at <code className="dshx:font-mono! dshx:text-foreground">{props.revision.shortestChangeId}</code> ·{' '}
            {description}. This repository’s working files stay as they are.
          </DialogDescription>
        </DialogHeader>
        <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
          <Label className="dshx:text-xs dshx:text-muted-foreground" htmlFor="jj-workspace-name">
            Workspace name
          </Label>
          <Input
            aria-invalid={name.length > 0 && !validName}
            aria-label="Workspace name"
            autoFocus
            className="dshx:h-7 dshx:font-mono! dshx:text-xs dshx:md:text-xs"
            id="jj-workspace-name"
            onChange={event => setName(event.target.value)}
            placeholder="review-feature"
            value={name}
          />
        </div>
        <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5">
          <Button onClick={() => setPickerOpen(true)} size="sm" type="button" variant="outline">
            Choose parent directory
          </Button>
          <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground" title={parentPath || undefined}>
            {parentPath || 'No parent directory selected'}
          </span>
        </div>
        <DialogFooter>
          <Button onClick={props.onClose} size="sm" type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={parentPath.length === 0 || !validName}
            onClick={() => {
              props.onPreview({ kind: 'workspace-add', parentPath, name, commitId: props.revision.commitId })
              props.onClose()
            }}
            size="sm"
            type="button"
          >
            Preview workspace setup
          </Button>
        </DialogFooter>
        {pickerOpen && (
          <ProjectFolderPicker
            directoryPicker={props.directoryPicker}
            mode="directories"
            onClose={() => setPickerOpen(false)}
            onRegisterWorkspace={props.registerWorkspace}
            onSelect={selected => {
              setPickerOpen(false)
              setParentPath(selected.canonicalPath)
            }}
            projects={[]}
            title="Choose the parent directory"
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
