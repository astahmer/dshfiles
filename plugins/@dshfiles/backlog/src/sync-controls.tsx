import { parseSecretReference } from '@dshfiles/credential-port'
import { useApi, useSettings } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox, type ComboboxOption } from '@dshfiles/plugin-ui/components/ui/combobox'
import { ContextMenuItem } from '@dshfiles/plugin-ui/components/ui/context-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import {
  ChevronUpIcon,
  CircleCheckIcon,
  CloudIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  LinkIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  Undo2Icon,
  UnlinkIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useIsFetching, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import { backlogApi, type BacklogSyncItemView, type BacklogSyncResultView, type BacklogSyncStatusView } from './api.js'
import { ItemGlyphs } from './item-glyphs.js'
import { BacklogNotices } from './notices.js'
import { backlogSettings, type BacklogSettings } from './settings.js'
import { BacklogSyncModel, type SyncBackendKind, type SyncState } from './sync-model.js'
import { BacklogQueries } from './use-backlog-actions.js'

type BackendRow = BacklogSettings['syncBackends'][number]

const SYNC_STATUS_KEY = [BacklogQueries.key, 'sync-status'] as const
const ALL_PROJECTS = 'all-projects'

const stateLabels = { synced: 'Synced', pending: 'Changes to sync', conflict: 'Conflict resolved', error: 'Sync error' } as const satisfies Record<
  SyncState,
  string
>
const stateTones = {
  synced: 'dshx:text-success',
  pending: 'dshx:text-info',
  conflict: 'dshx:text-warning',
  error: 'dshx:text-destructive',
} as const satisfies Record<SyncState, string>

const label = BacklogSyncModel.backendLabel

/** "just now" or "5m ago", read at the moment the popover renders its text. */
const syncedAgo = (at: number): string => {
  const age = ItemGlyphs.ago(at)
  return age === 'now' ? 'just now' : `${age} ago`
}

/** Remote sync state for every linked item, refreshed with the rest of the backlog. */
const useSyncStatus = () => {
  const api = useApi(backlogApi)
  return useQuery({ queryKey: SYNC_STATUS_KEY, queryFn: () => api.syncStatus({}), staleTime: 10_000 })
}

const resultNotice = (result: BacklogSyncResultView): string => {
  if (result.error !== null) return `b:${String(result.itemId)}: ${result.error.message}`
  const moved = [
    ...(result.pulled.length > 0 ? [`pulled ${result.pulled.join(', ')}`] : []),
    ...(result.pushed.length > 0 ? [`pushed ${result.pushed.join(', ')}`] : []),
    ...(result.commentsPulled + result.commentsPushed > 0 ? [`${String(result.commentsPulled + result.commentsPushed)} comments`] : []),
  ]
  const conflict = result.conflicts.length > 0 ? ` · conflict on ${result.conflicts.map(conflict => conflict.field).join(', ')} (note added)` : ''
  return `b:${String(result.itemId)} ↔ ${result.remoteKey ?? 'issue'}: ${moved.length === 0 ? 'already in sync' : moved.join(' · ')}${conflict}`
}

/** Every sync write the panel makes; each settles by refreshing the backlog and the sync state. */
const useSyncActions = () => {
  const api = useApi(backlogApi)
  const client = useQueryClient()
  const invalidate = (): Promise<void> => client.invalidateQueries({ queryKey: [BacklogQueries.key] })
  const syncNow = useMutation({
    mutationFn: (input: Parameters<typeof api.syncNow>[0]) => api.syncNow(input),
    onSuccess: output => {
      const failed = output.results.filter(result => result.error !== null)
      const first = output.results[0]
      BacklogNotices.show({
        text:
          output.results.length === 0
            ? 'No linked items to sync. Link an item from its menu first.'
            : output.results.length === 1 && first !== undefined
              ? resultNotice(first)
              : `Synced ${String(output.results.length - failed.length)} of ${String(output.results.length)} linked items${failed[0] === undefined ? '' : `. ${resultNotice(failed[0])}`}`,
        kind: failed.length > 0 ? 'failure' : 'success',
        sessionId: null,
      })
    },
    onError: error => BacklogNotices.show({ text: errorMessage(error, 'Sync failed. Retry with Sync now.'), kind: 'failure', sessionId: null }),
    onSettled: invalidate,
  })
  const linkRemote = useMutation({ mutationFn: (input: Parameters<typeof api.linkRemote>[0]) => api.linkRemote(input), onSettled: invalidate })
  const importRemote = useMutation({ mutationFn: (input: Parameters<typeof api.importRemote>[0]) => api.importRemote(input), onSettled: invalidate })
  return { syncNow, linkRemote, importRemote }
}

const configuredBackends = (status: BacklogSyncStatusView | undefined): SyncBackendKind[] => [
  ...new Set((status?.backends ?? []).filter(backend => backend.enabled).map(backend => backend.backend)),
]

/** Links one item to an issue the user names, or creates one from it. */
const LinkRemoteDialog = (props: {
  readonly itemId: number
  readonly backend: SyncBackendKind
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}): JSX.Element => {
  const actions = useSyncActions()
  const [reference, setReference] = useState('')
  const placeholder = props.backend === 'linear' ? 'ENG-12 or https://linear.app/…/issue/ENG-12' : '42 or https://github.com/owner/repo/issues/42'
  const submit = async (): Promise<void> => {
    const linked = await actions.linkRemote.mutateAsync({ id: props.itemId, backend: props.backend, reference: reference.trim() })
    BacklogNotices.show({
      text: linked.result === null ? `b:${String(props.itemId)} linked.` : resultNotice(linked.result),
      kind: linked.result?.error === null || linked.result === null ? 'success' : 'failure',
      sessionId: null,
    })
    setReference('')
    props.onOpenChange(false)
  }
  return (
    <Dialog open={props.open} onOpenChange={open => (actions.linkRemote.isPending ? undefined : props.onOpenChange(open))}>
      <DialogContent className="dshx-root">
        <DialogHeader>
          <DialogTitle>
            Link b:{props.itemId} to a {label(props.backend)} issue
          </DialogTitle>
          <DialogDescription>
            The issue’s title, description and status replace the item’s on the first sync (the old values stay in its history); tags from both sides are kept.
            After that, edits and new comments sync both ways.
          </DialogDescription>
        </DialogHeader>
        <form
          className="dshx:flex dshx:flex-col dshx:gap-2"
          onSubmit={event => {
            event.preventDefault()
            void submit().catch(() => undefined)
          }}
        >
          <input
            type="text"
            aria-label={`${label(props.backend)} issue`}
            placeholder={placeholder}
            value={reference}
            onChange={event => setReference(event.currentTarget.value)}
            className="dshx:font-mono! dshx:h-9 dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-3 dshx:text-sm dshx:outline-none dshx:focus-visible:border-ring"
          />
          {actions.linkRemote.error === null ? null : (
            <p role="alert" className="dshx:text-xs dshx:text-destructive">
              {errorMessage(actions.linkRemote.error, 'The issue could not be linked. Check the reference and retry.')}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)} disabled={actions.linkRemote.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={actions.linkRemote.isPending || reference.trim() === ''}>
              <LinkIcon aria-hidden className="dshx:size-3.5" />
              Link issue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** What the chip popover shows for a linked item: where it syncs, how it went, and the controls to act on it. */
const LinkedDetails = (props: { readonly linked: BacklogSyncItemView }): JSX.Element => {
  const actions = useSyncActions()
  const { linked } = props
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:text-xs">
      <a
        href={linked.url}
        target="_blank"
        rel="noreferrer"
        className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:font-medium dshx:text-foreground dshx:hover:underline"
      >
        <ExternalLinkIcon aria-hidden className="dshx:size-3.5" />
        Open {linked.remoteKey} in {label(linked.backend)}
      </a>
      <p className={cn('dshx:font-medium', stateTones[linked.state])}>{stateLabels[linked.state]}</p>
      <p className="dshx:text-muted-foreground">
        {linked.lastSyncedAt === null ? 'Not synced yet.' : `Last synced ${syncedAgo(linked.lastSyncedAt)}.`}
        {linked.state === 'pending' ? ' Local edits go out on the next sync.' : null}
      </p>
      {linked.lastError === null ? null : (
        <p role="alert" className="dshx:text-destructive">
          {linked.lastError.message}
        </p>
      )}
      {linked.state === 'conflict'
        ? linked.conflicts.slice(-3).map(conflict => (
            <p key={`${conflict.field}-${String(conflict.at)}`} className="dshx:text-muted-foreground">
              {conflict.field}: both sides changed; kept the {conflict.kept === 'remote' ? label(linked.backend) : 'local'} value. See the note in the activity.
            </p>
          ))
        : null}
      <div className="dshx:flex dshx:flex-wrap dshx:gap-1.5">
        <Button size="sm" variant="outline" disabled={actions.syncNow.isPending} onClick={() => actions.syncNow.mutate({ id: linked.itemId })}>
          <RefreshCwIcon aria-hidden className={cn('dshx:size-3.5', actions.syncNow.isPending && 'dshx:animate-spin')} />
          Sync now
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={actions.linkRemote.isPending}
          onClick={() => actions.linkRemote.mutate({ id: linked.itemId, backend: linked.backend, remove: true })}
        >
          <UnlinkIcon aria-hidden className="dshx:size-3.5" />
          Unlink
        </Button>
      </div>
    </div>
  )
}

/** The sync chip in an item's header row: the linked issue and its state, or the ways to link one. */
const SyncChip = (props: { readonly itemId: number }): JSX.Element | null => {
  const status = useSyncStatus()
  const actions = useSyncActions()
  const [linkBackend, setLinkBackend] = useState<SyncBackendKind | null>(null)
  const linked = status.data?.items.find(candidate => candidate.itemId === props.itemId)
  const backends = configuredBackends(status.data)
  if (linked === undefined && backends.length === 0) return null
  const create = (backend: SyncBackendKind): void =>
    actions.linkRemote.mutate(
      { id: props.itemId, backend, create: true },
      {
        onSuccess: output =>
          BacklogNotices.show({ text: `Created ${output.item?.remoteKey ?? 'the issue'} in ${label(backend)}.`, kind: 'success', sessionId: null }),
        onError: error => BacklogNotices.show({ text: errorMessage(error, `Could not create the ${label(backend)} issue.`), kind: 'failure', sessionId: null }),
      },
    )
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            aria-label={linked === undefined ? 'Remote sync: not linked' : `Remote sync: ${linked.remoteKey}, ${stateLabels[linked.state]}`}
            className={cn('dshx:gap-1 dshx:text-xs', linked === undefined ? 'dshx:text-muted-foreground' : stateTones[linked.state])}
          >
            <CloudIcon aria-hidden className="dshx:size-3.5" />
            {linked === undefined ? 'Not synced' : linked.remoteKey}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="dshx-root dshx:w-72 dshx:max-w-[calc(100vw-2rem)]">
          {linked !== undefined ? (
            <LinkedDetails linked={linked} />
          ) : (
            <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:text-xs">
              <p className="dshx:text-muted-foreground">Mirror this item in a tracker: title, description, status, tags and new comments sync both ways.</p>
              {backends.map(backend => (
                <div key={backend} className="dshx:flex dshx:flex-wrap dshx:gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => setLinkBackend(backend)}>
                    <LinkIcon aria-hidden className="dshx:size-3.5" />
                    Link to {label(backend)} issue…
                  </Button>
                  <Button size="sm" variant="outline" disabled={actions.linkRemote.isPending} onClick={() => create(backend)}>
                    <PlusIcon aria-hidden className="dshx:size-3.5" />
                    Create in {label(backend)}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
      {linkBackend === null ? null : (
        <LinkRemoteDialog itemId={props.itemId} backend={linkBackend} open onOpenChange={open => (open ? undefined : setLinkBackend(null))} />
      )}
    </>
  )
}

/**
 * The item menu's sync entries: Linear is always offered (an unconfigured backend answers with the setting to fix),
 * GitHub once a GitHub row exists; a linked item offers Sync now and Unlink instead.
 */
const SyncMenuItems = (props: { readonly itemId: number; readonly onLink: (backend: SyncBackendKind) => void }): JSX.Element => {
  const status = useSyncStatus()
  const actions = useSyncActions()
  const linked = status.data?.items.find(candidate => candidate.itemId === props.itemId)
  const backends: SyncBackendKind[] = [...new Set<SyncBackendKind>(['linear', ...configuredBackends(status.data)])]
  const create = (backend: SyncBackendKind): void =>
    actions.linkRemote.mutate(
      { id: props.itemId, backend, create: true },
      {
        onSuccess: output =>
          BacklogNotices.show({ text: `Created ${output.item?.remoteKey ?? 'the issue'} in ${label(backend)}.`, kind: 'success', sessionId: null }),
        onError: error => BacklogNotices.show({ text: errorMessage(error, `Could not create the ${label(backend)} issue.`), kind: 'failure', sessionId: null }),
      },
    )
  if (linked !== undefined) {
    return (
      <>
        <ContextMenuItem
          className="dshx:gap-2 dshx:text-[13px]"
          disabled={actions.syncNow.isPending}
          onSelect={() => actions.syncNow.mutate({ id: props.itemId })}
        >
          <RefreshCwIcon aria-hidden className="dshx:size-3.5" />
          Sync now with {linked.remoteKey}
        </ContextMenuItem>
        <ContextMenuItem
          className="dshx:gap-2 dshx:text-[13px]"
          onSelect={() => actions.linkRemote.mutate({ id: props.itemId, backend: linked.backend, remove: true })}
        >
          <UnlinkIcon aria-hidden className="dshx:size-3.5" />
          Unlink from {linked.remoteKey}
        </ContextMenuItem>
      </>
    )
  }
  return (
    <>
      {backends.map(backend => (
        <Fragment key={backend}>
          <ContextMenuItem className="dshx:gap-2 dshx:text-[13px]" onSelect={() => props.onLink(backend)}>
            <LinkIcon aria-hidden className="dshx:size-3.5" />
            Link to {label(backend)} issue…
          </ContextMenuItem>
          <ContextMenuItem className="dshx:gap-2 dshx:text-[13px]" disabled={actions.linkRemote.isPending} onSelect={() => create(backend)}>
            <CloudIcon aria-hidden className="dshx:size-3.5" />
            Create in {label(backend)}
          </ContextMenuItem>
        </Fragment>
      ))}
    </>
  )
}

const AUTO_SYNC_DEFAULT_MINUTES = 15
const autoSyncPresets = [0, 5, 15, 30, 60, 1_440] as const
const SYNC_TEST_KEY = [BacklogQueries.key, 'sync-test'] as const

const autoSyncLabel = (minutes: number): string => {
  if (minutes === 0) return 'Manual sync only'
  if (minutes === 60) return 'Sync every hour'
  if (minutes === 1_440) return 'Sync every day'
  return `Sync every ${String(minutes)} min`
}

const credentialLabels = { reference: 'vault key', environment: 'Host environment', 'github-cli': 'gh CLI login' } as const

const emptyRow = (backend: SyncBackendKind): BackendRow => ({
  project: '',
  backend,
  enabled: true,
  target: '',
  secret: '',
  autoSyncMinutes: AUTO_SYNC_DEFAULT_MINUTES,
})

const isReferenceOrEmpty = (text: string): boolean => text.trim() === '' || parseSecretReference(text.trim()) !== null

const inputClass =
  'dshx:h-8 dshx:min-w-0 dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-2 dshx:text-sm dshx:outline-none dshx:focus-visible:border-ring'

/** Tests the row as typed, once it stops changing; the key itself stays on the Host. */
const useConnectionTest = (row: BackendRow) => {
  const api = useApi(backlogApi)
  const target = row.target.trim()
  const secret = row.secret.trim()
  const draft = useMemo(() => ({ backend: row.backend, project: row.project, target, secret }), [row.backend, row.project, target, secret])
  const settled = useDebouncedValue({ value: draft, delayMs: 500 })
  return useQuery({
    queryKey: [...SYNC_TEST_KEY, settled],
    queryFn: ({ signal }) => api.testSyncBackend(settled, { signal }),
    enabled: isReferenceOrEmpty(settled.secret),
    staleTime: 5 * 60_000,
    retry: false,
  })
}

type ConnectionTestQuery = ReturnType<typeof useConnectionTest>

/** The vault alias a missing key is created under; the Secret Catalog writes the reference back into the field. */
const suggestedAliases = { linear: 'LINEAR_API_KEY', github: 'GITHUB_TOKEN' } as const satisfies Record<SyncBackendKind, string>

/**
 * The Secret Catalog's plain-DOM contract (docs/secret-references.md): a bubbling event on a
 * `data-secret-input="reference"` field opens its create-and-bind form. Backlog cannot import the Catalog, which
 * depends on it.
 */
const SECRET_CREATE_EVENT = 'secret-input:create'

const requestVaultKey = (field: HTMLInputElement | null): void => {
  if (field === null) return
  field.focus()
  field.dispatchEvent(new CustomEvent(SECRET_CREATE_EVENT, { bubbles: true }))
}

const connectionTarget = (report: NonNullable<ConnectionTestQuery['data']>): string | null => {
  if (report.target !== null) return `${report.target.key}${report.target.name === report.target.key ? '' : ` · ${report.target.name}`}`
  return report.targetSource === 'per-project' ? "each project's git remote" : null
}

const ConnectionLine = (props: { readonly row: BackendRow; readonly test: ConnectionTestQuery; readonly onCreateKey: () => void }): JSX.Element => {
  const { test } = props
  const retest = (
    <Button type="button" variant="ghost" size="xs" disabled={test.isFetching} onClick={() => void test.refetch()}>
      <RefreshCwIcon aria-hidden className={cn('dshx:size-3', test.isFetching && 'dshx:animate-spin')} />
      Test connection
    </Button>
  )
  if (!isReferenceOrEmpty(props.row.secret)) {
    return (
      <p role="alert" className="dshx:text-xs dshx:text-destructive">
        Keys are stored as vault references. Pick one with the key button in the field, or clear it to use the Host environment.
      </p>
    )
  }
  if (test.data === undefined) {
    return (
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:text-xs">
        {test.error === null ? (
          <span className="dshx:text-muted-foreground">Testing connection…</span>
        ) : (
          <span role="alert" className="dshx:min-w-0 dshx:text-destructive">
            {errorMessage(test.error, 'The connection could not be tested. Retry.')}
          </span>
        )}
        {test.error === null ? null : retest}
      </div>
    )
  }
  const report = test.data
  if (report.credential === 'missing') {
    return (
      <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
        {props.row.backend === 'linear'
          ? 'Needs a key: create one in the vault, pick one, or set LINEAR_API_KEY on the Host.'
          : 'Needs a key: create one in the vault, pick one, set GITHUB_TOKEN, or run gh auth login on the Host.'}
        <Button type="button" variant="outline" size="xs" onClick={props.onCreateKey}>
          <KeyRoundIcon aria-hidden className="dshx:size-3" />
          Create {suggestedAliases[props.row.backend]}
        </Button>
        {retest}
      </div>
    )
  }
  const target = connectionTarget(report)
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-x-2 dshx:gap-y-1 dshx:text-xs">
      {report.account === null ? null : (
        <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:text-success">
          <CircleCheckIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
          <span className="dshx:min-w-0 dshx:truncate">
            {report.account}
            {target === null ? '' : ` → ${target}`}
          </span>
        </span>
      )}
      <span className="dshx:text-muted-foreground">{credentialLabels[report.credential]}</span>
      {report.error === null ? null : (
        <span role="alert" className="dshx:w-full dshx:text-destructive">
          {report.error.message}
        </span>
      )}
      {retest}
    </div>
  )
}

const rowProjectLabel = (row: BackendRow): string => (row.project === '' ? 'All other projects' : ItemGlyphs.projectName(row.project))

/** A row whose connection works, on one line: tracker, project, account and target, interval and the switch. */
const CollapsedRow = (props: {
  readonly row: BackendRow
  readonly position: number
  readonly test: ConnectionTestQuery
  readonly onChange: (change: Partial<BackendRow>) => void
  readonly onExpand: () => void
}): JSX.Element => {
  const { row } = props
  const report = props.test.data
  const target = report === undefined ? null : connectionTarget(report)
  return (
    <fieldset
      aria-label={`Sync backend ${String(props.position)}`}
      data-collapsed=""
      className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:px-3 dshx:py-1.5 dshx:text-xs"
    >
      <span className="dshx:shrink-0 dshx:text-sm dshx:font-medium">{label(row.backend)}</span>
      <span className="dshx:min-w-0 dshx:shrink dshx:truncate dshx:text-muted-foreground">{rowProjectLabel(row)}</span>
      {report === undefined ? (
        <span className="dshx:min-w-0 dshx:truncate dshx:text-muted-foreground">Testing connection…</span>
      ) : (
        <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1 dshx:text-success">
          <CircleCheckIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
          <span className="dshx:min-w-0 dshx:truncate">
            {report.account}
            {target === null ? '' : ` → ${target}`}
          </span>
        </span>
      )}
      <span className="dshx:ml-auto dshx:shrink-0 dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">{autoSyncLabel(row.autoSyncMinutes)}</span>
      <Switch
        size="sm"
        aria-label={`Enable sync backend ${String(props.position)}`}
        checked={row.enabled}
        onCheckedChange={checked => props.onChange({ enabled: checked })}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Edit sync backend ${String(props.position)}`}
        aria-expanded={false}
        onClick={props.onExpand}
      >
        <PencilIcon />
      </Button>
    </fieldset>
  )
}

const BackendRowEditor = (props: {
  readonly row: BackendRow
  readonly position: number
  readonly startEditing: boolean
  readonly projectOptions: readonly ComboboxOption[]
  readonly onChange: (change: Partial<BackendRow>) => void
  readonly onRemove: () => void
}): JSX.Element => {
  const { row } = props
  const test = useConnectionTest(row)
  const [editing, setEditing] = useState(props.startEditing)
  const secretField = useRef<HTMLInputElement | null>(null)
  const working = isReferenceOrEmpty(row.secret) && test.data?.ok === true
  const pendingFirstTest = isReferenceOrEmpty(row.secret) && test.data === undefined && test.error === null
  if (!editing && (working || pendingFirstTest)) {
    return <CollapsedRow row={row} position={props.position} test={test} onChange={props.onChange} onExpand={() => setEditing(true)} />
  }
  const teams = test.data?.teams ?? []
  const detectedTarget = test.data?.target?.key
  const teamOptions: ComboboxOption[] = [
    ...teams.map(team => ({ value: team.key, label: team.key, description: team.name })),
    ...(row.target.trim() === '' || teams.some(team => team.key.toUpperCase() === row.target.trim().toUpperCase())
      ? []
      : [{ value: row.target, label: row.target, description: 'not visible to this key' }]),
  ]
  const autoSyncOptions = [...new Set<number>([...autoSyncPresets, row.autoSyncMinutes])]
    .sort((left, right) => left - right)
    .map(minutes => ({ value: String(minutes), label: autoSyncLabel(minutes) }))
  const repositoryPlaceholder =
    test.data?.targetSource === 'git-remote' && detectedTarget !== undefined
      ? `${detectedTarget} (git remote)`
      : row.project === ''
        ? 'owner/repo or git remote'
        : 'owner/repo'
  return (
    <fieldset
      aria-label={`Sync backend ${String(props.position)}`}
      className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:p-3"
    >
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={row.backend}
          aria-label="Tracker"
          onValueChange={value => (value === 'linear' || value === 'github' ? props.onChange({ backend: value, target: '' }) : undefined)}
        >
          <ToggleGroupItem value="linear">Linear</ToggleGroupItem>
          <ToggleGroupItem value="github">GitHub</ToggleGroupItem>
        </ToggleGroup>
        <Combobox
          label="Project"
          value={row.project === '' ? ALL_PROJECTS : row.project}
          options={props.projectOptions}
          onValueChange={value => props.onChange({ project: value === ALL_PROJECTS ? '' : value })}
          triggerClassName="dshx:min-w-0 dshx:max-w-48"
        />
        <Combobox
          label="Auto-sync"
          value={String(row.autoSyncMinutes)}
          options={autoSyncOptions}
          onValueChange={value => props.onChange({ autoSyncMinutes: Number(value) })}
          triggerClassName="dshx:w-auto dshx:min-w-0"
        />
        <div className="dshx:ml-auto dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-2">
          <label className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-xs">
            <Switch size="sm" checked={row.enabled} onCheckedChange={checked => props.onChange({ enabled: checked })} />
            Enabled
          </label>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove sync backend ${String(props.position)}`} onClick={props.onRemove}>
            <Trash2Icon />
          </Button>
          {working ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Collapse sync backend ${String(props.position)}`}
              aria-expanded
              onClick={() => setEditing(false)}
            >
              <ChevronUpIcon />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="dshx:grid dshx:grid-cols-2 dshx:gap-2 dshx:@max-pane-narrow:grid-cols-1">
        <input
          ref={secretField}
          type="text"
          data-secret-input="reference"
          data-secret-alias={suggestedAliases[row.backend]}
          data-secret-scope="global"
          aria-label={row.backend === 'linear' ? 'Linear API key reference' : 'GitHub token reference'}
          placeholder={row.backend === 'linear' ? 'secret:LINEAR_API_KEY' : 'secret:GITHUB_TOKEN or gh login'}
          value={row.secret}
          onChange={event => props.onChange({ secret: event.currentTarget.value })}
          className={cn(inputClass, 'dshx:font-mono!')}
        />
        {row.backend === 'linear' && teamOptions.length > 0 ? (
          <Combobox
            label="Linear team"
            value={row.target === '' ? (detectedTarget ?? '') : row.target}
            placeholder="Pick a team"
            options={teamOptions}
            onValueChange={value => props.onChange({ target: value })}
            triggerClassName="dshx:min-w-0"
            matchTriggerWidth
          />
        ) : (
          <input
            type="text"
            aria-label={row.backend === 'linear' ? 'Linear team key' : 'GitHub repository'}
            placeholder={row.backend === 'linear' ? 'Team key, e.g. ENG' : repositoryPlaceholder}
            value={row.target}
            onChange={event => props.onChange({ target: event.currentTarget.value })}
            className={cn(inputClass, 'dshx:font-mono!')}
          />
        )}
      </div>
      <ConnectionLine row={row} test={test} onCreateKey={() => requestVaultKey(secretField.current)} />
    </fieldset>
  )
}

/** A row in the form, keyed so its editor keeps its own state when rows above it are removed or restored. */
interface EditorRow {
  readonly key: number
  readonly row: BackendRow
  readonly startEditing: boolean
}

const sameRows = (input: { readonly left: readonly BackendRow[]; readonly right: readonly BackendRow[] }): boolean =>
  JSON.stringify(input.left) === JSON.stringify(input.right)

const keyRows = (input: { readonly counter: { current: number }; readonly rows: readonly BackendRow[] }): EditorRow[] =>
  input.rows.map(row => {
    input.counter.current += 1
    return { key: input.counter.current, row, startEditing: false }
  })

/** Backend rows (saved as you edit), Sync all now and Import issue, under Backlog settings. */
const RemoteSyncSettings = (props: { readonly projectPaths: readonly string[] }): JSX.Element => {
  const settings = useSettings(backlogSettings)
  const status = useSyncStatus()
  const actions = useSyncActions()
  const queryClient = useQueryClient()
  const testsRunning = useIsFetching({ queryKey: SYNC_TEST_KEY }) > 0
  const nextKey = useRef(0)
  const [entries, setEntries] = useState<EditorRow[]>(() => keyRows({ counter: nextKey, rows: settings.value?.syncBackends ?? [] }))
  const [removed, setRemoved] = useState<{ readonly entry: EditorRow; readonly index: number } | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importReference, setImportReference] = useState('')
  const editRevision = useRef(0)
  const stored = settings.value?.syncBackends
  const settledEntries = useDebouncedValue({ value: entries, delayMs: 800 })
  const writable = settings.writable && settings.status === 'ready'
  const savable = entries.every(entry => isReferenceOrEmpty(entry.row.secret))

  useEffect(() => {
    if (dirty || settings.status !== 'ready') return
    const next = stored ?? []
    setEntries(current => (sameRows({ left: current.map(entry => entry.row), right: next }) ? current : keyRows({ counter: nextKey, rows: next })))
  }, [dirty, settings.status, stored])

  const change = (next: (current: EditorRow[]) => EditorRow[]): void => {
    editRevision.current += 1
    setEntries(next)
    setDirty(true)
    setSaved(false)
  }
  const save = async (): Promise<void> => {
    const revision = editRevision.current
    setError(null)
    try {
      if (!writable) throw new Error('Backlog settings are not writable right now. Reload the page, then edit again.')
      const clean = entries.map(entry => ({ ...entry.row, target: entry.row.target.trim(), secret: entry.row.secret.trim() }))
      if (!(await settings.set('syncBackends', clean))) throw new Error('Backlog could not save the remote sync backends. Retry.')
      if (editRevision.current === revision) {
        setDirty(false)
        setSaved(true)
      }
      await queryClient.invalidateQueries({ queryKey: SYNC_STATUS_KEY })
    } catch (cause) {
      setError(errorMessage(cause, 'Could not save the remote sync backends. Retry.'))
    }
  }

  const saveLatest = useRef(save)
  saveLatest.current = save
  const shouldSave = dirty && savable && writable && settledEntries === entries
  useEffect(() => {
    if (shouldSave) void saveLatest.current()
  }, [shouldSave])
  const unsavedOnLeave = useRef(false)
  unsavedOnLeave.current = dirty && savable && writable
  useEffect(
    () => () => {
      if (unsavedOnLeave.current) void saveLatest.current()
    },
    [],
  )

  const addRow = (backend: SyncBackendKind): void => {
    nextKey.current += 1
    const entry: EditorRow = { key: nextKey.current, row: emptyRow(backend), startEditing: true }
    change(current => [...current, entry])
  }
  const removeRow = (index: number): void => {
    const entry = entries[index]
    if (entry === undefined) return
    setRemoved({ entry, index })
    change(current => current.filter((_entry, at) => at !== index))
  }
  const undoRemove = (): void => {
    if (removed === null) return
    setRemoved(null)
    change(current => [...current.slice(0, removed.index), removed.entry, ...current.slice(removed.index)])
  }
  const testAll = (): void => void queryClient.refetchQueries({ queryKey: SYNC_TEST_KEY, type: 'active' })

  const importBackend = BacklogSyncModel.backendOfReference(importReference)
  const importIssue = async (): Promise<void> => {
    const output = await actions.importRemote.mutateAsync({ reference: importReference.trim() })
    BacklogNotices.show({
      text: output.created
        ? `Imported as b:${String(output.detail.item.id)} — ${output.detail.item.title}`
        : `Already in the backlog as b:${String(output.detail.item.id)}.`,
      kind: 'success',
      sessionId: null,
    })
    setImportReference('')
  }
  const projectOptions: ComboboxOption[] = [
    { value: ALL_PROJECTS, label: 'All other projects' },
    ...props.projectPaths.map(project => ({ value: project, label: ItemGlyphs.projectName(project), description: project })),
  ]
  const linkedCount = status.data?.items.length ?? 0
  const saveState = (() => {
    if (settings.mutation.pending) return 'Saving…'
    if (dirty) return savable ? 'Unsaved changes' : 'Not saved: fix the key above'
    return saved ? 'Saved' : null
  })()

  return (
    <section
      className="dshx-root dshx:@container dshx:mx-auto dshx:w-full dshx:max-w-2xl dshx:p-5 dshx:@max-pane-narrow:p-3"
      aria-labelledby="backlog-remote-sync-title"
    >
      <h3 id="backlog-remote-sync-title" className="dshx:text-base dshx:font-semibold">
        Remote sync
      </h3>
      <div className="dshx:mt-3 dshx:flex dshx:flex-col dshx:gap-3">
        {entries.map((entry, index) => (
          <BackendRowEditor
            key={entry.key}
            row={entry.row}
            position={index + 1}
            startEditing={entry.startEditing}
            projectOptions={projectOptions}
            onChange={edit =>
              change(current => current.map(candidate => (candidate.key === entry.key ? { ...candidate, row: { ...candidate.row, ...edit } } : candidate)))
            }
            onRemove={() => removeRow(index)}
          />
        ))}
        {removed === null ? null : (
          <div role="status" className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
            <span className="dshx:min-w-0 dshx:truncate">
              Removed the {label(removed.entry.row.backend)} backend for {rowProjectLabel(removed.entry.row)}.
            </span>
            <Button type="button" size="xs" variant="outline" disabled={!writable} onClick={undoRemove}>
              <Undo2Icon aria-hidden className="dshx:size-3" />
              Undo
            </Button>
          </div>
        )}
        {error === null ? null : (
          <div role="alert" className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-sm dshx:text-destructive">
            {error}
            <Button type="button" size="xs" variant="outline" onClick={() => void save()}>
              Retry
            </Button>
          </div>
        )}
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          {BacklogSyncModel.backends.map(backend => (
            <Button
              key={backend}
              type="button"
              size="sm"
              variant="outline"
              aria-label={`Add ${label(backend)} backend`}
              disabled={!writable}
              onClick={() => addRow(backend)}
            >
              <PlusIcon aria-hidden className="dshx:size-3.5" />
              {label(backend)}
            </Button>
          ))}
          {entries.length === 0 ? null : (
            <Button type="button" size="sm" variant="outline" disabled={testsRunning} onClick={testAll}>
              <RefreshCwIcon aria-hidden className={cn('dshx:size-3.5', testsRunning && 'dshx:animate-spin')} />
              Test all
            </Button>
          )}
          {linkedCount === 0 ? null : (
            <Button type="button" size="sm" variant="outline" disabled={actions.syncNow.isPending} onClick={() => actions.syncNow.mutate({})}>
              <RefreshCwIcon aria-hidden className={cn('dshx:size-3.5', actions.syncNow.isPending && 'dshx:animate-spin')} />
              Sync all now ({String(linkedCount)})
            </Button>
          )}
          {saveState === null ? null : (
            <span role="status" className={cn('dshx:ml-auto dshx:text-xs', saveState === 'Saved' ? 'dshx:text-success' : 'dshx:text-muted-foreground')}>
              {saveState}
            </span>
          )}
        </div>
      </div>
      <form
        className="dshx:mt-4 dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2"
        aria-label="Import an issue"
        onSubmit={event => {
          event.preventDefault()
          void importIssue().catch(() => undefined)
        }}
      >
        <input
          type="text"
          aria-label="Issue to import"
          placeholder="Import an issue: ENG-12, #42 or its URL"
          value={importReference}
          onChange={event => setImportReference(event.currentTarget.value)}
          className={cn(inputClass, 'dshx:font-mono! dshx:flex-1')}
        />
        <Button type="submit" size="sm" disabled={actions.importRemote.isPending || importBackend === undefined}>
          {importBackend === undefined ? 'Import issue' : `Import from ${label(importBackend)}`}
        </Button>
        {actions.importRemote.error === null ? null : (
          <p role="alert" className="dshx:w-full dshx:text-xs dshx:text-destructive">
            {errorMessage(actions.importRemote.error, 'The issue could not be imported. Check the reference and the backend row, then retry.')}
          </p>
        )}
      </form>
    </section>
  )
}

export class BacklogSyncControls {
  static readonly Chip = SyncChip
  static readonly MenuItems = SyncMenuItems
  static readonly LinkDialog = LinkRemoteDialog
  static readonly Settings = RemoteSyncSettings
  static readonly stateLabels = stateLabels
}
