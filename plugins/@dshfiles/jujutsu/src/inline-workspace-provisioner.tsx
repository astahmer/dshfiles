import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ProjectFolderPicker, type DirectoryPickerPort, type RegisteredProject } from '@dshfiles/project-folder-picker'
import { useState } from 'react'
import { workspaceNameSchema, type Mutation, type Revision } from './api.js'
import { InlinePanel, InlinePanelActions } from './inline-panel.js'

/** `jj workspace add` at one revision, filled in and previewed inside that revision's row. */
export const InlineWorkspaceProvisioner = (props: {
  readonly revision: Revision
  readonly onCancel: () => void
  readonly onPreview: (action: Mutation) => void
  /** The same Host picker the repository chooser uses, so a browse-only Host can choose a parent too. */
  readonly directoryPicker: DirectoryPickerPort
  readonly registerWorkspace: (canonicalPath: string) => Promise<RegisteredProject>
}): JSX.Element => {
  const [parentPath, setParentPath] = useState('')
  const [name, setName] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const validName = workspaceNameSchema.safeParse(name).success
  const description = props.revision.description.split('\n')[0] || '(no description)'

  return (
    <TooltipProvider delayDuration={500}>
      <InlinePanel label="Create workspace at this revision" onCancel={props.onCancel}>
        <p className="dshx:text-xs dshx:text-muted-foreground">
          A sibling jj workspace checked out at <code className="dshx:font-mono! dshx:text-foreground">{props.revision.shortestChangeId}</code> · {description}.
          This repository’s working files stay as they are.
        </p>
        <div className="dshx:flex dshx:flex-col dshx:gap-1">
          <Label className="dshx:text-xs dshx:text-muted-foreground" htmlFor="jj-inline-workspace-name">
            Workspace name
          </Label>
          <Input
            aria-invalid={name.length > 0 && !validName}
            aria-label="Workspace name"
            autoFocus
            className="dshx:h-7 dshx:font-mono! dshx:text-xs dshx:md:text-xs"
            id="jj-inline-workspace-name"
            onChange={event => setName(event.target.value)}
            placeholder="review-feature"
            value={name}
          />
        </div>
        <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
          <Button onClick={() => setPickerOpen(true)} size="xs" type="button" variant="outline">
            Choose parent directory
          </Button>
          {parentPath.length === 0 ? (
            <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground">No parent directory selected</span>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground">{parentPath}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom">{parentPath}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <InlinePanelActions
          autoFocusConfirm={false}
          confirmDisabled={parentPath.length === 0 || !validName}
          confirmLabel="Preview workspace setup"
          onCancel={props.onCancel}
          onConfirm={() => props.onPreview({ kind: 'workspace-add', parentPath, name, commitId: props.revision.commitId })}
        />
        {pickerOpen && (
          <ProjectFolderPicker
            directoryPicker={props.directoryPicker}
            heading="Choose the parent directory"
            mode="directories"
            onClose={() => setPickerOpen(false)}
            onRegisterWorkspace={props.registerWorkspace}
            onUseAbsolutePath={path => {
              setPickerOpen(false)
              setParentPath(path)
            }}
            onSelect={selected => {
              setPickerOpen(false)
              setParentPath(selected.canonicalPath)
            }}
            projects={[]}
          />
        )}
      </InlinePanel>
    </TooltipProvider>
  )
}
