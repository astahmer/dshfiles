import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, keepPreviousData, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { jjIntegrationApi, type CleanupKindView, type CleanupResult } from '@dshfiles/jj-integration/api'
import { useState } from 'react'

const AGE_CHOICES = [
  { hours: 1, label: '1h' },
  { hours: 6, label: '6h' },
  { hours: 24, label: '24h' },
] as const

const KIND_CHOICES: readonly { readonly kind: CleanupKindView; readonly label: string; readonly hint: string }[] = [
  { kind: 'empty', label: 'Empty', hint: 'never landed anything' },
  { kind: 'integrated', label: 'Already integrated', hint: 'landed, nothing left' },
  { kind: 'untracked', label: 'Untracked folders', hint: 'folders and files in the threads directory no jj workspace owns' },
]

const SKIP_LABELS = {
  'has-work': 'unlanded work',
  busy: 'thread working',
  'activity-unknown': 'activity unknown',
  queued: 'integration queued',
  'too-recent': 'used recently',
  'kind-excluded': 'kind not selected',
} satisfies Record<CleanupResult['skipped'][number]['reason'], string>

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
    outcome: workspace.outcome,
    title: workspace.message ?? workspace.path,
  })),
  ...result.untracked.map(entry => ({
    key: `${entry.repoRoot}:untracked:${entry.name}`,
    name: entry.name,
    kind: 'untracked',
    at: entry.modifiedAt,
    outcome: entry.outcome,
    title: entry.message ?? entry.path,
  })),
]

const skippedSummary = (skipped: CleanupResult['skipped']): string =>
  [...new Set(skipped.map(workspace => workspace.reason))]
    .map(reason => `${String(skipped.filter(workspace => workspace.reason === reason).length)} ${SKIP_LABELS[reason]}`)
    .join(' · ')

export const WorkspaceCleanupDialog = (props: {
  readonly open: boolean
  readonly path: string
  readonly onOpenChange: (open: boolean) => void
  readonly onCleaned: () => void
}) => {
  const api = useApi(jjIntegrationApi)
  const [olderThanHours, setOlderThanHours] = useState<number>(6)
  const [kinds, setKinds] = useState<CleanupKindView[]>(['empty', 'integrated', 'untracked'])
  const request = { path: props.path, olderThanHours, kinds }
  const preview = useQuery({
    queryKey: ['jujutsu', 'workspace-cleanup-preview', request],
    enabled: props.open && kinds.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: ({ signal }) => api.cleanupWorkspaces({ ...request, apply: false }, { signal }),
  })
  const cleanup = useMutation({
    mutationFn: () => api.cleanupWorkspaces({ ...request, apply: true }),
    onSuccess: () => props.onCleaned(),
  })
  const toggleKind = (kind: CleanupKindView, checked: boolean): void =>
    setKinds(current => (checked ? [...new Set([...current, kind])] : current.filter(existing => existing !== kind)))
  const shown = cleanup.data ?? preview.data
  const candidates = shown === undefined ? [] : cleanupRows(shown)
  const removable = preview.data === undefined ? 0 : preview.data.workspaces.length + preview.data.untracked.length
  const emptyRevisionCount = preview.data?.emptyRevisions.length ?? 0
  const nothingToDo = removable === 0 && emptyRevisionCount === 0

  return (
    <Dialog
      onOpenChange={open => {
        if (!open) cleanup.reset()
        props.onOpenChange(open)
      }}
      open={props.open}
    >
      <DialogContent className="dshx-root dshx:sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Clean up thread workspaces</DialogTitle>
          <DialogDescription>
            Removes idle thread workspaces with no unlanded work and stale folders no workspace owns, then abandons the empty revisions nothing builds on. Busy
            threads and unlanded work are always kept.
          </DialogDescription>
        </DialogHeader>
        <div className="dshx:flex dshx:flex-col dshx:gap-3 dshx:text-xs">
          <div className="dshx:flex dshx:items-center dshx:gap-2">
            <span className="dshx:text-muted-foreground">Unused for</span>
            <div aria-label="Unused for at least" className="dshx:flex dshx:gap-1" role="radiogroup">
              {AGE_CHOICES.map(choice => (
                <Button
                  aria-checked={olderThanHours === choice.hours}
                  key={choice.hours}
                  onClick={() => setOlderThanHours(choice.hours)}
                  role="radio"
                  size="xs"
                  type="button"
                  variant={olderThanHours === choice.hours ? 'secondary' : 'ghost'}
                >
                  {choice.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="dshx:flex dshx:flex-wrap dshx:gap-x-4 dshx:gap-y-1.5">
            {KIND_CHOICES.map(choice => (
              <Label className="dshx:gap-1.5 dshx:text-xs dshx:font-normal" key={choice.kind} title={choice.hint}>
                <Checkbox checked={kinds.includes(choice.kind)} onCheckedChange={checked => toggleKind(choice.kind, checked === true)} />
                {choice.label}
              </Label>
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
              <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:font-mono" key={row.key} title={row.title}>
                <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{row.name}</span>
                <span className="dshx:text-muted-foreground">{row.kind}</span>
                <span className="dshx:text-muted-foreground">{formatAge(row.at)}</span>
                {row.outcome !== 'would-remove' && (
                  <span className={cn(row.outcome === 'removed' ? 'dshx:text-success' : 'dshx:text-destructive')}>{row.outcome}</span>
                )}
              </div>
            ))}
          </div>
          {shown !== undefined && (
            <p className="dshx:text-muted-foreground">
              {cleanup.data === undefined ? 'Would abandon' : 'Abandoned'} {String(shown.emptyRevisions.length)} dangling empty revision(s).
              {shown.skipped.length > 0 && ` Kept ${String(shown.skipped.length)}: ${skippedSummary(shown.skipped)}.`}
            </p>
          )}
          {cleanup.isError && <p className="dshx:text-destructive">{errorMessage(cleanup.error, 'The cleanup failed.')}</p>}
        </div>
        <DialogFooter>
          <Button onClick={() => props.onOpenChange(false)} size="sm" type="button" variant="ghost">
            {cleanup.data === undefined ? 'Cancel' : 'Close'}
          </Button>
          {cleanup.data === undefined && (
            <Button
              disabled={nothingToDo || preview.isFetching || cleanup.isPending || kinds.length === 0}
              onClick={() => cleanup.mutate()}
              size="sm"
              type="button"
              variant="destructive"
            >
              {cleanup.isPending && <Spinner className="dshx:size-3" />}
              Remove {String(removable)} item(s)
              {emptyRevisionCount > 0 && ` + ${String(emptyRevisionCount)} revision(s)`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
