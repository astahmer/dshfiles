import { useApi, useSettings } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { ContextMenuItem } from '@dshfiles/plugin-ui/components/ui/context-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { CloudIcon, ExternalLinkIcon, LinkIcon, PlusIcon, RefreshCwIcon, Trash2Icon, UnlinkIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { Fragment, useEffect, useState } from 'react'

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

const emptyRow = (): BackendRow => ({ project: '', backend: 'linear', enabled: true, target: '', secret: '', autoSyncMinutes: 0 })

const inputClass =
  'dshx:h-8 dshx:min-w-0 dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-2 dshx:text-sm dshx:outline-none dshx:focus-visible:border-ring'

/** Backend rows, Sync all now and Import issue, under Backlog settings. */
const RemoteSyncSettings = (props: { readonly projectPaths: readonly string[] }): JSX.Element => {
  const settings = useSettings(backlogSettings)
  const status = useSyncStatus()
  const actions = useSyncActions()
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<BackendRow[]>([...(settings.value?.syncBackends ?? [])])
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importBackend, setImportBackend] = useState<SyncBackendKind>('linear')
  const [importReference, setImportReference] = useState('')
  const stored = settings.value?.syncBackends

  useEffect(() => {
    if (!dirty && settings.status === 'ready') setRows([...(stored ?? [])])
  }, [dirty, settings.status, stored])

  const writable = settings.writable && settings.status === 'ready'
  const edit = (index: number, change: Partial<BackendRow>): void => {
    setRows(current => current.map((row, at) => (at === index ? { ...row, ...change } : row)))
    setDirty(true)
    setSaved(false)
  }
  const save = async (): Promise<void> => {
    setError(null)
    try {
      if (!writable) throw new Error('Backlog settings are not writable right now.')
      const clean = rows.map(row => ({ ...row, target: row.target.trim(), secret: row.secret.trim() }))
      if (!(await settings.set('syncBackends', clean))) throw new Error('Backlog could not save the remote sync backends. Retry.')
      setDirty(false)
      setSaved(true)
      await queryClient.invalidateQueries({ queryKey: SYNC_STATUS_KEY })
    } catch (cause) {
      setError(errorMessage(cause, 'Could not save the remote sync backends.'))
    }
  }
  const importIssue = async (): Promise<void> => {
    const output = await actions.importRemote.mutateAsync({ backend: importBackend, reference: importReference.trim() })
    BacklogNotices.show({
      text: output.created
        ? `Imported as b:${String(output.detail.item.id)} — ${output.detail.item.title}`
        : `Already in the backlog as b:${String(output.detail.item.id)}.`,
      kind: 'success',
      sessionId: null,
    })
    setImportReference('')
  }
  const projectOptions = [
    { value: ALL_PROJECTS, label: 'Every other project' },
    ...props.projectPaths.map(project => ({ value: project, label: ItemGlyphs.projectName(project), description: project })),
  ]
  const linkedCount = status.data?.items.length ?? 0

  return (
    <section className="dshx-root dshx:mx-auto dshx:w-full dshx:max-w-2xl dshx:p-5 dshx:@max-pane-narrow:p-3" aria-labelledby="backlog-remote-sync-title">
      <h3 id="backlog-remote-sync-title" className="dshx:text-base dshx:font-semibold">
        Remote sync
      </h3>
      <p className="dshx:mt-1 dshx:text-sm dshx:text-muted-foreground">
        Mirror items in Linear or GitHub Issues. Keys stay in the Host vault as secret:ALIAS references. Linking, creating and importing issues is always your
        action; a field both sides changed goes to the side that changed last, with a note on the item.
      </p>
      <form
        className="dshx:mt-4 dshx:flex dshx:flex-col dshx:gap-3"
        onSubmit={event => {
          event.preventDefault()
          void save()
        }}
      >
        {rows.length === 0 ? <p className="dshx:text-sm dshx:text-muted-foreground">No backend yet. Add one to link items.</p> : null}
        {rows.map((row, index) => (
          <fieldset
            key={`${String(index)}-${row.backend}`}
            aria-label={`Sync backend ${String(index + 1)}`}
            className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:p-3"
          >
            <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={row.backend}
                aria-label="Tracker"
                onValueChange={value => (value === 'linear' || value === 'github' ? edit(index, { backend: value }) : undefined)}
              >
                <ToggleGroupItem value="linear">Linear</ToggleGroupItem>
                <ToggleGroupItem value="github">GitHub</ToggleGroupItem>
              </ToggleGroup>
              <Combobox
                label="Project"
                value={row.project === '' ? ALL_PROJECTS : row.project}
                options={projectOptions}
                onValueChange={value => edit(index, { project: value === ALL_PROJECTS ? '' : value })}
                triggerClassName="dshx:min-w-0 dshx:max-w-56"
              />
              <label className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-xs">
                <input type="checkbox" checked={row.enabled} onChange={event => edit(index, { enabled: event.currentTarget.checked })} />
                Enabled
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove sync backend ${String(index + 1)}`}
                onClick={() => {
                  setRows(current => current.filter((_row, at) => at !== index))
                  setDirty(true)
                }}
              >
                <Trash2Icon />
              </Button>
            </div>
            <div className="dshx:grid dshx:grid-cols-2 dshx:gap-2 dshx:@max-pane-narrow:grid-cols-1">
              <input
                type="text"
                aria-label={row.backend === 'linear' ? 'Linear team key' : 'GitHub repository'}
                placeholder={row.backend === 'linear' ? 'Team key, e.g. ENG' : 'owner/repo'}
                value={row.target}
                onChange={event => edit(index, { target: event.currentTarget.value })}
                className={cn(inputClass, 'dshx:font-mono!')}
              />
              <input
                type="text"
                data-secret-input="reference"
                aria-label={row.backend === 'linear' ? 'Linear API key reference' : 'GitHub token reference'}
                placeholder={row.backend === 'linear' ? 'secret:LINEAR_API_KEY' : 'secret:GITHUB_TOKEN'}
                value={row.secret}
                onChange={event => edit(index, { secret: event.currentTarget.value })}
                className={cn(inputClass, 'dshx:font-mono!')}
              />
            </div>
            <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-3 dshx:gap-y-1 dshx:text-xs dshx:text-muted-foreground">
              <label className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-2">
                Auto-sync every
                <input
                  type="number"
                  min={0}
                  max={1440}
                  aria-label="Auto-sync minutes"
                  value={row.autoSyncMinutes}
                  onChange={event => edit(index, { autoSyncMinutes: Math.max(0, Math.min(1_440, Math.trunc(Number(event.currentTarget.value) || 0))) })}
                  className={cn(inputClass, 'dshx:w-20')}
                />
                minutes
              </label>
              <span className="dshx:min-w-0">
                0 syncs only on Sync now. An empty key uses {row.backend === 'linear' ? 'LINEAR_API_KEY' : 'GITHUB_TOKEN'} from the Host environment.
              </span>
            </div>
          </fieldset>
        ))}
        {error === null ? null : (
          <p role="alert" className="dshx:text-sm dshx:text-destructive">
            {error}
          </p>
        )}
        {saved ? (
          <p role="status" className="dshx:text-sm dshx:text-success">
            Remote sync backends saved.
          </p>
        ) : null}
        <div className="dshx:flex dshx:flex-wrap dshx:gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!writable}
            onClick={() => {
              setRows(current => [...current, emptyRow()])
              setDirty(true)
              setSaved(false)
            }}
          >
            <PlusIcon aria-hidden className="dshx:size-3.5" />
            Add backend
          </Button>
          <Button type="submit" size="sm" disabled={!writable || !dirty || settings.mutation.pending}>
            Save sync backends
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={actions.syncNow.isPending || linkedCount === 0}
            onClick={() => actions.syncNow.mutate({})}
          >
            <RefreshCwIcon aria-hidden className={cn('dshx:size-3.5', actions.syncNow.isPending && 'dshx:animate-spin')} />
            Sync all now ({String(linkedCount)})
          </Button>
        </div>
      </form>
      <form
        className="dshx:mt-4 dshx:flex dshx:flex-col dshx:gap-2"
        aria-label="Import an issue"
        onSubmit={event => {
          event.preventDefault()
          void importIssue().catch(() => undefined)
        }}
      >
        <span className="dshx:text-sm dshx:font-medium">Import an issue as an item</span>
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={importBackend}
            aria-label="Import from"
            onValueChange={value => (value === 'linear' || value === 'github' ? setImportBackend(value) : undefined)}
          >
            <ToggleGroupItem value="linear">Linear</ToggleGroupItem>
            <ToggleGroupItem value="github">GitHub</ToggleGroupItem>
          </ToggleGroup>
          <input
            type="text"
            aria-label="Issue to import"
            placeholder={importBackend === 'linear' ? 'ENG-12 or its linear.app URL' : '42 or its github.com URL'}
            value={importReference}
            onChange={event => setImportReference(event.currentTarget.value)}
            className={cn(inputClass, 'dshx:font-mono! dshx:flex-1')}
          />
          <Button type="submit" size="sm" disabled={actions.importRemote.isPending || importReference.trim() === ''}>
            Import issue
          </Button>
        </div>
        {actions.importRemote.error === null ? null : (
          <p role="alert" className="dshx:text-xs dshx:text-destructive">
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
