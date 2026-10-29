import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { errorMessage, keepPreviousData, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { jjIntegrationApi, type CleanupKindView, type CleanupResult, type CleanupTarget } from '@dshfiles/jj-integration/api'
import { ChevronDownIcon, ChevronRightIcon, RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { useState } from 'react'
import { CleanupJobTrailModel, cleanupJobsKey, requestWorkspaceCleanup, useCleanupJobs } from './cleanup-jobs-queries.js'
import { cleanupPreviewLoadingLabel } from './workspace-cleanup-preview.js'
import { WorkspaceCleanupSummary } from './workspace-cleanup-summary.js'

const AGE_CHOICES = [
  { hours: 1, label: '1h' },
  { hours: 6, label: '6h' },
  { hours: 24, label: '24h' },
  { hours: 168, label: '7d' },
] as const

const KIND_CHOICES: readonly { readonly kind: CleanupKindView; readonly label: string }[] = [
  { kind: 'empty', label: 'Empty' },
  { kind: 'integrated', label: 'Already integrated' },
  { kind: 'untracked', label: 'Untracked folders' },
  { kind: 'secondary', label: 'Other JJ workspaces' },
]

const AGE_SUFFIX = { now: '', minutes: 'm', hours: 'h', days: 'd', months: 'mo', years: 'y' } as const

const formatAge = (at: number): string => {
  if (at === 0) return '—'
  const age = relativeTime(at, Date.now())
  return age.unit === 'now' ? 'now' : `${String(age.n)}${AGE_SUFFIX[age.unit]} ago`
}

interface CleanupRow {
  readonly key: string
  readonly target: CleanupTarget
  readonly at: number
}

const cleanupRows = (result: CleanupResult): CleanupRow[] => [
  ...result.workspaces.map(workspace => ({
    key: JSON.stringify([workspace.repoRoot, workspace.name, workspace.kind]),
    target: { repoRoot: workspace.repoRoot, name: workspace.name, kind: workspace.kind },
    at: workspace.lastUsedAt,
  })),
  ...result.untracked.map(entry => ({
    key: JSON.stringify([entry.repoRoot, entry.name, 'untracked']),
    target: { repoRoot: entry.repoRoot, name: entry.name, kind: 'untracked' as const },
    at: entry.modifiedAt,
  })),
]

const selectedCount = (rows: readonly CleanupRow[], selected: ReadonlySet<string>): number => rows.filter(row => selected.has(row.key)).length

export const WorkspaceCleanupDialog = (props: {
  readonly open: boolean
  readonly path: string
  readonly onOpenChange: (open: boolean) => void
  readonly onCleaned: () => void
}) => {
  const api = useApi(jjIntegrationApi)
  const queryClient = useQueryClient()
  const [olderThanHours, setOlderThanHours] = useState(6)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [expanded, setExpanded] = useState<ReadonlySet<CleanupKindView>>(() => new Set())
  const kinds = KIND_CHOICES.map(choice => choice.kind)
  const request = { path: props.path, olderThanHours, kinds }
  const preview = useQuery({
    queryKey: ['jujutsu', 'workspace-cleanup-preview', props.path, olderThanHours, kinds],
    enabled: props.open,
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: ({ signal }) => api.cleanupWorkspaces({ ...request, apply: false }, { signal }),
  })
  const running = useCleanupJobs().data?.jobs.find(CleanupJobTrailModel.isActive)
  const cleanup = useMutation({
    mutationFn: () => {
      const rows = preview.data === undefined ? [] : cleanupRows(preview.data)
      const targets = rows.filter(row => selected.has(row.key)).map(row => row.target)
      if (targets.length === 0 && emptyRevisionCount === 0) throw new Error('Select at least one workspace or folder to clean up.')
      return requestWorkspaceCleanup(api, { ...request, targets })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cleanupJobsKey })
      setSelected(new Set())
      props.onCleaned()
      props.onOpenChange(false)
    },
  })
  const shown = preview.data
  const rows = shown === undefined ? [] : cleanupRows(shown)
  const previewLoadingLabel = cleanupPreviewLoadingLabel({ isFetching: preview.isFetching, hasData: shown !== undefined })
  const selectedRows = rows.filter(row => selected.has(row.key))
  const removable = selectedRows.length
  const emptyRevisionCount = shown?.emptyRevisions.length ?? 0
  const nothingToDo = rows.length === 0 && emptyRevisionCount === 0
  const progress = running === undefined ? '' : CleanupJobTrailModel.progressLabel(running)
  const allSelected = rows.length > 0 && removable === rows.length
  const partiallySelected = removable > 0 && !allSelected

  const toggleRow = (row: CleanupRow, checked: boolean): void => {
    setSelected(current => {
      const next = new Set(current)
      if (checked) next.add(row.key)
      else next.delete(row.key)
      return next
    })
  }
  const toggleRows = (targets: readonly CleanupRow[], checked: boolean): void => {
    setSelected(current => {
      const next = new Set(current)
      for (const row of targets) {
        if (checked) next.add(row.key)
        else next.delete(row.key)
      }
      return next
    })
  }
  const toggleExpanded = (kind: CleanupKindView): void => {
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  return (
    <Dialog
      onOpenChange={open => {
        if (!open) setSelected(new Set())
        props.onOpenChange(open)
      }}
      open={props.open}
    >
      <DialogContent className="dshx-root dshx:sm:max-w-xl dshx:gap-0 dshx:p-0">
        <DialogHeader className="dshx:px-5 dshx:pb-4 dshx:pt-5">
          <DialogTitle>Clean up workspaces</DialogTitle>
          <DialogDescription className="dshx:sr-only">
            Select idle workspaces and untracked folders to remove. Unlanded work, uncommitted changes, and active sessions are always kept.
          </DialogDescription>
        </DialogHeader>
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:px-5 dshx:pb-4 dshx:text-xs">
          <span className="dshx:text-muted-foreground">Idle for</span>
          <div aria-label="Idle for at least" className="dshx:flex dshx:gap-1" role="radiogroup">
            {AGE_CHOICES.map(choice => (
              <Button
                aria-checked={olderThanHours === choice.hours}
                key={choice.hours}
                onClick={() => {
                  setOlderThanHours(choice.hours)
                  setSelected(new Set())
                }}
                role="radio"
                size="xs"
                type="button"
                variant={olderThanHours === choice.hours ? 'secondary' : 'ghost'}
              >
                {choice.label}
              </Button>
            ))}
          </div>
          <Button className="dshx:ml-auto" disabled={preview.isFetching} onClick={() => void preview.refetch()} size="xs" type="button" variant="ghost">
            {preview.isFetching ? <Spinner className="dshx:size-3" /> : <RefreshCwIcon aria-hidden="true" className="dshx:size-3" />}
            Rescan
          </Button>
        </div>
        {previewLoadingLabel === undefined ? null : (
          <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:px-5 dshx:pt-3 dshx:text-xs dshx:text-muted-foreground" role="status">
            <Spinner aria-hidden="true" className="dshx:size-3" />
            {previewLoadingLabel}
          </p>
        )}
        <div aria-busy={preview.isFetching} className="dshx:max-h-[min(55vh,28rem)] dshx:overflow-y-auto">
          {preview.isError && (
            <p className="dshx:px-5 dshx:py-3 dshx:text-sm dshx:text-destructive">{errorMessage(preview.error, 'The cleanup preview failed.')}</p>
          )}
          <div className="dshx:flex dshx:items-center dshx:gap-3 dshx:border-b dshx:border-border dshx:bg-muted/30 dshx:px-5 dshx:py-3">
            <Checkbox
              aria-label="Select all eligible items"
              checked={allSelected ? true : partiallySelected ? 'indeterminate' : false}
              disabled={rows.length === 0}
              onCheckedChange={checked => toggleRows(rows, checked === true)}
            />
            <span className="dshx:text-sm">Select all</span>
            <span className="dshx:text-xs dshx:text-muted-foreground">{rows.length} eligible</span>
            <span className="dshx:ml-auto dshx:text-xs dshx:text-muted-foreground">{removable} selected</span>
          </div>
          {KIND_CHOICES.map(choice => {
            const groupRows = rows.filter(row => row.target.kind === choice.kind)
            if (groupRows.length === 0) return null
            const groupSelected = selectedCount(groupRows, selected)
            const checked = groupSelected === groupRows.length ? true : groupSelected > 0 ? 'indeterminate' : false
            const isExpanded = expanded.has(choice.kind)
            return (
              <section className="dshx:border-b dshx:border-border dshx:last:border-b-0" key={choice.kind}>
                <div className="dshx:flex dshx:min-h-12 dshx:items-center dshx:gap-3 dshx:px-5 dshx:py-2">
                  <Checkbox aria-label={`Select ${choice.label}`} checked={checked} onCheckedChange={value => toggleRows(groupRows, value === true)} />
                  <Button
                    aria-expanded={isExpanded}
                    className="dshx:min-w-0 dshx:flex-1 dshx:justify-start dshx:gap-2 dshx:px-0 dshx:text-left"
                    onClick={() => toggleExpanded(choice.kind)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {isExpanded ? (
                      <ChevronDownIcon aria-hidden="true" className="dshx:size-3" />
                    ) : (
                      <ChevronRightIcon aria-hidden="true" className="dshx:size-3" />
                    )}
                    <span className="dshx:truncate">{choice.label}</span>
                    <span className="dshx:rounded dshx:bg-muted dshx:px-2 dshx:py-1 dshx:text-xs dshx:text-muted-foreground">{groupRows.length}</span>
                  </Button>
                  {groupSelected > 0 && <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground">{groupSelected} selected</span>}
                </div>
                {isExpanded && (
                  <ul className="dshx:space-y-1 dshx:px-5 dshx:pb-3 dshx:pl-12">
                    {groupRows.map(row => (
                      <li className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-3 dshx:py-1.5" key={row.key}>
                        <Checkbox
                          aria-label={`Select ${row.target.name}`}
                          checked={selected.has(row.key)}
                          onCheckedChange={checkedValue => toggleRow(row, checkedValue === true)}
                        />
                        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm">{row.target.name}</span>
                        <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground">{formatAge(row.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
          {shown !== undefined && rows.length === 0 && <p className="dshx:px-5 dshx:py-5 dshx:text-sm dshx:text-muted-foreground">No workspace qualifies.</p>}
          {shown === undefined && !preview.isError && previewLoadingLabel === undefined && (
            <p className="dshx:px-5 dshx:py-5 dshx:text-sm dshx:text-muted-foreground">No workspace qualifies.</p>
          )}
          {shown === undefined ? null : (
            <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:px-5 dshx:py-3 dshx:text-xs dshx:text-muted-foreground" aria-live="polite">
              {WorkspaceCleanupSummary.format({
                emptyRevisionCount,
                skippedReasons: shown.skipped.map(workspace => workspace.reason),
              }).map(line => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}
        </div>
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-3 dshx:border-t dshx:border-border dshx:px-5 dshx:py-4">
          <span className="dshx:text-xs dshx:text-muted-foreground">Unlanded work is always protected</span>
          <DialogFooter className="dshx:gap-2">
            <Button onClick={() => props.onOpenChange(false)} size="sm" type="button" variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={(removable === 0 && emptyRevisionCount === 0) || nothingToDo || preview.isFetching || cleanup.isPending || running !== undefined}
              onClick={() => cleanup.mutate()}
              size="sm"
              type="button"
              variant="destructive"
            >
              {cleanup.isPending && <Spinner className="dshx:size-3" />}
              Clean up {removable}
            </Button>
          </DialogFooter>
        </div>
        {running === undefined ? null : (
          <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:px-5 dshx:pb-3 dshx:text-xs dshx:text-muted-foreground" role="status">
            <Spinner className="dshx:size-3" />
            {CleanupJobTrailModel.phaseLabel(running)}
            {progress === '' ? null : <span className="dshx:font-mono">{progress}</span>}
          </p>
        )}
        {cleanup.isError && (
          <p className="dshx:px-5 dshx:pb-3 dshx:text-xs dshx:text-destructive">{errorMessage(cleanup.error, 'The cleanup could not start.')}</p>
        )}
        {nothingToDo && shown !== undefined && emptyRevisionCount > 0 && removable === 0 && (
          <p className="dshx:px-5 dshx:pb-3 dshx:text-xs dshx:text-muted-foreground">Empty revisions will be abandoned when cleanup runs.</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
