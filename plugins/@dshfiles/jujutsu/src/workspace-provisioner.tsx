import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dshfiles/plugin-ui/components/ui/card'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { useEffect, useState } from 'react'
import { workspaceNameSchema, type Mutation, type Revision } from './api.js'

interface WorkspaceProvisionerProps {
  readonly revisions: readonly Revision[]
  readonly selectedCommitId: string | null
  readonly provisionedPath: string | null
  readonly onPreview: (action: Mutation) => void
  readonly pickDirectory: () => Promise<string | null>
  readonly launchSession: (cwd: string) => Promise<void>
}

export const WorkspaceProvisioner = (props: WorkspaceProvisionerProps): JSX.Element => {
  const [parentPath, setParentPath] = useState('')
  const [name, setName] = useState('')
  const [baseCommitId, setBaseCommitId] = useState('')
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (props.revisions.length === 0) {
      setBaseCommitId('')
      return
    }
    setBaseCommitId(current => {
      if (props.revisions.some(revision => revision.commitId === current)) return current
      return props.selectedCommitId ?? props.revisions.find(revision => revision.workingCopy)?.commitId ?? props.revisions[0]?.commitId ?? ''
    })
  }, [props.revisions, props.selectedCommitId])

  const chooseParent = async (): Promise<void> => {
    setError(null)
    try {
      const selected = await props.pickDirectory()
      if (selected !== null) setParentPath(selected)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not choose a parent directory.')
    }
  }

  const createSession = async (): Promise<void> => {
    if (props.provisionedPath === null) return
    setLaunching(true)
    setError(null)
    try {
      await props.launchSession(props.provisionedPath)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Workspace Session could not be opened.')
    } finally {
      setLaunching(false)
    }
  }

  const validName = workspaceNameSchema.safeParse(name).success
  const canPreview = parentPath.length > 0 && validName && baseCommitId.length > 0

  return (
    <Card aria-labelledby="jj-workspace-provision-title" className="dshx:gap-3" role="region">
      <CardHeader>
        <CardTitle className="dshx:text-sm" id="jj-workspace-provision-title">
          Provision an isolated workspace
        </CardTitle>
        <CardDescription className="dshx:text-xs">
          JJ adds a sibling workspace at the chosen revision. This repository’s current working files stay in place.
        </CardDescription>
      </CardHeader>
      <CardContent className="dshx:flex dshx:flex-col dshx:gap-2.5">
        <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
          <Label className="dshx:text-xs dshx:text-muted-foreground">Base revision</Label>
          <Select onValueChange={setBaseCommitId} value={baseCommitId}>
            <SelectTrigger aria-label="Workspace base revision" className="dshx:w-full dshx:text-xs" size="sm">
              <SelectValue placeholder="No revisions" />
            </SelectTrigger>
            <SelectContent>
              {props.revisions.map(revision => (
                <SelectItem key={revision.commitId} value={revision.commitId}>
                  <span className="dshx:font-mono dshx:text-info">{revision.shortestChangeId}</span> {revision.description.split('\n')[0] || '(no description)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
          <Label className="dshx:text-xs dshx:text-muted-foreground" htmlFor="jj-workspace-name">
            Workspace name
          </Label>
          <Input
            aria-invalid={name.length > 0 && !validName}
            aria-label="Workspace name"
            className="dshx:h-7 dshx:font-mono! dshx:text-xs dshx:md:text-xs"
            id="jj-workspace-name"
            onChange={event => setName(event.target.value)}
            placeholder="review-feature"
            value={name}
          />
        </div>
        <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5">
          <Button onClick={() => void chooseParent()} size="sm" type="button" variant="outline">
            Choose parent directory
          </Button>
          <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground" title={parentPath || undefined}>
            {parentPath || 'No parent directory selected'}
          </span>
        </div>
        <Button
          className="dshx:self-start"
          disabled={!canPreview || props.revisions.length === 0}
          onClick={() => props.onPreview({ kind: 'workspace-add', parentPath, name, commitId: baseCommitId })}
          size="sm"
          type="button"
        >
          Preview workspace setup
        </Button>
        {props.provisionedPath !== null && (
          <Alert className="dshx:px-3 dshx:py-2" variant="success">
            <AlertDescription className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:text-xs">
              <span className="dshx:w-full dshx:truncate dshx:font-mono dshx:text-foreground" title={props.provisionedPath}>
                Created: {props.provisionedPath}
              </span>
              <Button disabled={launching} onClick={() => void createSession()} size="xs" type="button" variant="outline">
                {launching ? 'Opening…' : 'Open a DSH Session here'}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {error !== null && (
          <Alert className="dshx:px-3 dshx:py-2" role="alert" variant="destructive">
            <AlertDescription className="dshx:text-xs">{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
