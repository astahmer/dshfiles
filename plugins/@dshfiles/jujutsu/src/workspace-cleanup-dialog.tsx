import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { errorMessage, keepPreviousData, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { jjIntegrationApi, type CleanupKindView, type CleanupResult } from '@dshfiles/jj-integration/api'
import { useState } from 'react'
import { CleanupJobTrailModel, cleanupJobsKey, requestWorkspaceCleanup, useCleanupJobs } from './cleanup-jobs-queries.js'
import { WorkspaceCleanupSummary } from './workspace-cleanup-summary.js'

const AGE_CHOICES = [
  { hours: 1, label: '1h' },
  { hours: 6, label: '6h' },
  { hours: 24, label: '24h' },
] as const

const KIND_CHOICES: readonly { readonly kind: CleanupKindView; readonly label: string; readonly hint: string }[] = [
  { kind: 'empty', label: 'Empty', hint: 'never landed anything' },
  { kind: 'integrated', label: 'Already integrated', hint: 'landed, nothing left' },
  { kind: 'secondary', label: 'Other JJ workspaces', hint: 'manual only; the working copy must be clean and no work may be unlanded' },
  { kind: 'untracked', label: 'Untracked folders', hint: 'folders and files in the threads directory no jj workspace owns' },
]

const AGE_SUFFIX = { now: '', minutes: 'm', hours: 'h', days: 'd', months: 'mo', years: 'y' } as const

const formatAge = (at: number): string => {
  if (at === 0) return '—'
  const age = relativeTime(at, Date.now())
  return age.unit === 'now' ? 'now' : `${String(age.n)}${AGE_SUFFIX[age.unit]} ago`
}

const cleanupRows = (result: CleanupResult) => [
  ...result.workspaces.map(workspace => ({
    key: `${workspace.repoRoot}:${workspace.name}`,
    name: workspace.name,
    kind: workspace.kind,
    at: workspace.lastUsedAt,
    title: workspace.path,
  })),
  ...result.untracked.map(entry => ({
    key: `${entry.repoRoot}:untracked:${entry.name}`,
    name: entry.name,
    kind: 'untracked',
    at: entry.modifiedAt,
    title: entry.path,
  })),
]

export const WorkspaceCleanupDialog = (props: {
  readonly open: boolean
  readonly path: string
  readonly onOpenChange: (open: boolean) => void
  readonly onCleaned: () => void
}) => {
  const api = useApi(jjIntegrationApi)
  const queryClient = useQueryClient()
  const [presetHours, setPresetHours] = useState<number | null>(6)
  const [customHours, setCustomHours] = useState('')
  const olderThanHours = WorkspaceCleanupSummary.resolveAgeHours({ presetHours, customHours })
  const [kinds, setKinds] = useState<CleanupKindView[]>(['empty', 'integrated', 'untracked'])
  const request = olderThanHours === undefined ? null : { path: props.path, olderThanHours, kinds }
  const preview = useQuery({
    queryKey: ['jujutsu', 'workspace-cleanup-preview', props.path, olderThanHours, kinds],
    enabled: props.open && olderThanHours !== undefined && kinds.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: ({ signal }) => {
      if (olderThanHours === undefined) throw new Error('Enter a whole number of hours greater than 0.')
      return api.cleanupWorkspaces({ path: props.path, olderThanHours, kinds, apply: false }, { signal })
    },
  })
  const running = useCleanupJobs().data?.jobs.find(CleanupJobTrailModel.isActive)
  const cleanup = useMutation({
    mutationFn: () => {
      if (request === null) throw new Error('Enter a whole number of hours greater than 0.')
      return requestWorkspaceCleanup(api, request)
    },
    // The removal runs on the Host: the dialog is done the moment the job starts, and the panel trail reports the rest.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cleanupJobsKey })
      props.onCleaned()
      props.onOpenChange(false)
    },
  })
  const toggleKind = (kind: CleanupKindView, checked: boolean): void =>
    setKinds(current => (checked ? [...new Set([...current, kind])] : current.filter(existing => existing !== kind)))
  const shown = olderThanHours === undefined ? undefined : preview.data
  const candidates = shown === undefined ? [] : cleanupRows(shown)
  const removable = shown === undefined ? 0 : shown.workspaces.length + shown.untracked.length
  const emptyRevisionCount = shown?.emptyRevisions.length ?? 0
  const nothingToDo = removable === 0 && emptyRevisionCount === 0
  const progress = running === undefined ? '' : CleanupJobTrailModel.progressLabel(running)

  return (
    <Dialog onOpenChange={open => props.onOpenChange(open)} open={props.open}>
      <DialogContent className="dshx-root dshx:sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Clean up JJ workspaces</DialogTitle>
          <DialogDescription>
            Removes idle thread workspaces with no unlanded work and stale folders no workspace owns, then abandons the empty revisions nothing builds on. Other
            JJ workspaces are manual-only and opt-in. JJ snapshots working-copy files before checking them; unlanded work, uncommitted changes, busy Sessions,
            and unverifiable workspaces are always kept.
          </DialogDescription>
        </DialogHeader>
        <div className="dshx:flex dshx:flex-col dshx:gap-3 dshx:text-xs">
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            <span className="dshx:text-muted-foreground">Unused for</span>
            <div aria-label="Unused for at least" className="dshx:flex dshx:gap-1" role="radiogroup">
              {AGE_CHOICES.map(choice => (
                <Button
                  aria-checked={presetHours === choice.hours}
                  key={choice.hours}
                  onClick={() => {
                    setPresetHours(choice.hours)
                    setCustomHours('')
                  }}
                  role="radio"
                  size="xs"
                  type="button"
                  variant={presetHours === choice.hours ? 'secondary' : 'ghost'}
                >
                  {choice.label}
                </Button>
              ))}
            </div>
            <Label className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-xs dshx:font-normal">
              Custom
              <Input
                aria-invalid={presetHours === null && olderThanHours === undefined}
                aria-label="Custom hours"
                className="dshx:h-7 dshx:w-16 dshx:px-2"
                min={1}
                onChange={event => {
                  setPresetHours(null)
                  setCustomHours(event.currentTarget.value)
                }}
                placeholder="Hours"
                step={1}
                type="number"
                value={customHours}
              />
              <span className="dshx:text-muted-foreground">h</span>
            </Label>
          </div>
          {presetHours === null && olderThanHours === undefined && (
            <p className="dshx:text-destructive" role="alert">
              Enter a whole number of hours greater than 0.
            </p>
          )}
          <TooltipProvider delayDuration={500}>
            <div className="dshx:flex dshx:flex-wrap dshx:gap-x-4 dshx:gap-y-1.5">
              {KIND_CHOICES.map(choice => (
                <Tooltip key={choice.kind}>
                  <TooltipTrigger asChild>
                    <span className="dshx:inline-flex">
                      <Label className="dshx:gap-1.5 dshx:text-xs dshx:font-normal">
                        <Checkbox checked={kinds.includes(choice.kind)} onCheckedChange={checked => toggleKind(choice.kind, checked === true)} />
                        {choice.label}
                      </Label>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{choice.hint}</TooltipContent>
                </Tooltip>
              ))}
            </div>
            <div
              aria-live="polite"
              className="dshx:flex dshx:max-h-60 dshx:flex-col dshx:gap-1 dshx:overflow-y-auto dshx:rounded-md dshx:border dshx:border-border dshx:p-2"
            >
              {preview.isFetching && shown === undefined && <Spinner className="dshx:size-3" />}
              {preview.isError && <p className="dshx:text-destructive">{errorMessage(preview.error, 'The cleanup preview failed.')}</p>}
              {shown !== undefined && candidates.length === 0 && <p className="dshx:text-muted-foreground">No workspace qualifies.</p>}
              {candidates.map(row => (
                <Tooltip key={row.key}>
                  <TooltipTrigger asChild>
                    <div aria-label={row.title} className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:font-mono">
                      <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{row.name}</span>
                      <span className="dshx:text-muted-foreground">{row.kind}</span>
                      <span className="dshx:text-muted-foreground">{formatAge(row.at)}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>{row.title}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </TooltipProvider>
          {shown === undefined ? null : (
            <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:text-muted-foreground" aria-live="polite">
              {WorkspaceCleanupSummary.format({
                emptyRevisionCount,
                skippedReasons: shown.skipped.map(workspace => workspace.reason),
              }).map(line => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}
          {running === undefined ? null : (
            <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-muted-foreground" role="status">
              <Spinner className="dshx:size-3" />
              {CleanupJobTrailModel.phaseLabel(running)}
              {progress === '' ? null : <span className="dshx:font-mono">{progress}</span>}
            </p>
          )}
          {cleanup.isError && <p className="dshx:text-destructive">{errorMessage(cleanup.error, 'The cleanup could not start.')}</p>}
        </div>
        <DialogFooter>
          <Button onClick={() => props.onOpenChange(false)} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={olderThanHours === undefined || nothingToDo || preview.isFetching || cleanup.isPending || kinds.length === 0 || running !== undefined}
            onClick={() => cleanup.mutate()}
            size="sm"
            type="button"
            variant="destructive"
          >
            {cleanup.isPending && <Spinner className="dshx:size-3" />}
            Remove {WorkspaceCleanupSummary.formatCount(removable, 'item', 'items')}
            {emptyRevisionCount > 0 && ` + ${WorkspaceCleanupSummary.formatCount(emptyRevisionCount, 'revision', 'revisions')}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
