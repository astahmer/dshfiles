import { parseSecretReference } from '@dshfiles/credential-port'
import { isApiError } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox, type ComboboxOption } from '@dshfiles/plugin-ui/components/ui/combobox'
import { ContextMenuItem } from '@dshfiles/plugin-ui/components/ui/context-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleCheckIcon,
  CloudIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LinkIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  UnlinkIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { Fragment, useState } from 'react'

import { BacklogReference } from './backlog-reference.js'
import {
  backlogApi,
  type BacklogSyncBindingView,
  type BacklogSyncConnectionView,
  type BacklogSyncItemView,
  type BacklogSyncResultView,
  type BacklogSyncStatusView,
  type BacklogSyncTestView,
} from './api.js'
import { BacklogItems } from './item.js'
import { ItemGlyphs } from './item-glyphs.js'
import { BacklogNotices } from './notices.js'
import { BacklogProviders, type ProviderDescriptor } from './provider-port.js'
import { BacklogSyncModel, type SyncBinding, type SyncConflictPolicy, type SyncFieldDirection, type SyncFieldRule, type SyncState } from './sync-model.js'
import { BacklogQueries } from './use-backlog-actions.js'

const SYNC_STATUS_KEY = [BacklogQueries.key, 'sync-status'] as const
const ALL_PROJECTS = 'all-projects'
const HOST_RESTART = 'This DSH Host predates connections and bindings. Restart the DSH Host process to load them.'

const stateLabels = { synced: 'Synced', pending: 'Changes to sync', conflict: 'Conflict', error: 'Sync error' } as const satisfies Record<SyncState, string>
const stateTones = {
  synced: 'dshx:text-success',
  pending: 'dshx:text-info',
  conflict: 'dshx:text-warning',
  error: 'dshx:text-destructive',
} as const satisfies Record<SyncState, string>
const credentialLabels = {
  reference: 'vault key',
  environment: 'Host environment',
  fallback: 'Host environment or CLI login',
  none: 'no key needed',
  missing: 'no key',
  cli: 'CLI login',
} as const
const directionLabels = { 'two-way': 'Two-way', pull: 'Pull only', push: 'Push only' } as const
const fieldLabels = {
  title: 'Title',
  body: 'Description',
  status: 'Status',
  tags: 'Labels',
  priority: 'Priority',
  parent: 'Parent',
  links: 'Relations',
  due: 'Due date',
  criteria: 'Acceptance criteria',
  summary: 'Summary',
} as const
const fieldDirectionLabels = { 'two-way': 'Both ways', pull: 'Pull', push: 'Push', off: 'Off' } as const satisfies Record<SyncFieldDirection, string>
const policyLabels = {
  lww: 'Last change wins',
  'local-wins': 'Backlog wins',
  'remote-wins': 'Remote wins',
  flag: 'Flag, change nothing',
} as const satisfies Record<SyncConflictPolicy, string>
const pollPresets = [0, 300, 900, 1_800, 3_600, 86_400] as const

const isFieldDirection = (value: string): value is SyncFieldDirection => BacklogSyncModel.fieldDirections.some(known => known === value)
const isPolicy = (value: string): value is SyncConflictPolicy => BacklogSyncModel.conflictPolicies.some(known => known === value)

const pollLabel = (seconds: number): string => {
  if (seconds === 0) return 'Sync now only'
  if (seconds === 3_600) return 'Every hour'
  if (seconds === 86_400) return 'Every day'
  if (seconds % 60 === 0) return `Every ${String(seconds / 60)} min`
  return `Every ${String(seconds)} s`
}

/** A Host that predates a method answers with a contract error; every other failure keeps its own message. */
const failureText = (error: unknown, fallback: string): string =>
  isApiError(error) && error.kind === 'contract' ? HOST_RESTART : errorMessage(error, fallback)

const syncedAgo = (at: number): string => {
  const age = ItemGlyphs.ago(at)
  return age === 'now' ? 'just now' : `${age} ago`
}

/** Remote sync state, refreshed with the rest of the backlog. */
const useSyncStatus = () => {
  const api = useApi(backlogApi)
  return useQuery({ queryKey: SYNC_STATUS_KEY, queryFn: () => api.syncStatus({}), staleTime: 10_000 })
}

/** A Host older than connections answers `backends` and no `connections`. */
const hostLacksSources = (status: BacklogSyncStatusView | undefined): boolean => status !== undefined && status.connections === undefined

const resultNotice = (result: BacklogSyncResultView): string => {
  const label = BacklogReference.labelOf({ id: result.itemId, ref: result.ref })
  if (result.error !== null) return `${label}: ${result.error.message}`
  const moved = [
    ...(result.pulled.length > 0 ? [`pulled ${result.pulled.join(', ')}`] : []),
    ...(result.pushed.length > 0 ? [`pushed ${result.pushed.join(', ')}`] : []),
    ...(result.commentsPulled + result.commentsPushed > 0 ? [`${String(result.commentsPulled + result.commentsPushed)} comments`] : []),
  ]
  const conflict = result.conflicts.length > 0 ? ` · conflict on ${result.conflicts.map(entry => entry.field).join(', ')} (note added)` : ''
  return `${label} ↔ ${result.remoteKey ?? 'remote item'}: ${moved.length === 0 ? 'already in sync' : moved.join(' · ')}${conflict}`
}

const failed = (fallback: string) => (error: unknown) => BacklogNotices.show({ text: failureText(error, fallback), kind: 'failure', sessionId: null })

/** Every sync write the panel makes; each settles by refreshing the backlog and the sync state. */
const useSyncActions = () => {
  const api = useApi(backlogApi)
  const client = useQueryClient()
  const invalidate = (): Promise<void> => client.invalidateQueries({ queryKey: [BacklogQueries.key] })
  const syncNow = useMutation({
    mutationFn: (input: Parameters<typeof api.syncNow>[0]) => api.syncNow(input),
    onSuccess: output => {
      const errors = output.results.filter(result => result.error !== null)
      const first = output.results[0]
      const pass = output.passes?.[0]
      const firstError = errors[0] === undefined ? '' : `. ${resultNotice(errors[0])}`
      const text = (() => {
        if (pass !== undefined)
          return `${pass.bindingId}: read ${String(pass.records)}, created ${String(pass.created)}, synced ${String(pass.results.length)}${firstError}`
        if (output.results.length === 0) return 'No linked items to sync. Link an item from its menu first.'
        if (output.results.length === 1 && first !== undefined) return resultNotice(first)
        return `Synced ${String(output.results.length - errors.length)} of ${String(output.results.length)} linked items${firstError}`
      })()
      BacklogNotices.show({ text, kind: errors.length > 0 ? 'failure' : 'success', sessionId: null })
    },
    onError: failed('Sync failed. Retry with Sync now.'),
    onSettled: invalidate,
  })
  const linkRemote = useMutation({ mutationFn: (input: Parameters<typeof api.linkRemote>[0]) => api.linkRemote(input), onSettled: invalidate })
  const importRemote = useMutation({ mutationFn: (input: Parameters<typeof api.importRemote>[0]) => api.importRemote(input), onSettled: invalidate })
  const importAll = useMutation({
    mutationFn: (binding: string) => api.importAllRemote({ binding }),
    onSuccess: pass =>
      BacklogNotices.show({
        text: `Imported ${String(pass.created)} new items through ${pass.bindingId} (${String(pass.records)} read).`,
        kind: 'success',
        sessionId: null,
      }),
    onError: failed('The import failed. Retry.'),
    onSettled: invalidate,
  })
  const saveConnection = useMutation({
    mutationFn: (input: Parameters<typeof api.saveSyncConnection>[0]) => api.saveSyncConnection(input),
    onSettled: invalidate,
  })
  const removeConnection = useMutation({
    mutationFn: (instanceId: string) => api.removeSyncConnection({ instanceId }),
    onError: failed('The connection could not be removed. Retry.'),
    onSettled: invalidate,
  })
  const moveConnection = useMutation({
    mutationFn: (input: Parameters<typeof api.moveSyncConnection>[0]) => api.moveSyncConnection(input),
    onError: failed('The connection could not be moved. Retry.'),
    onSettled: invalidate,
  })
  const saveBinding = useMutation({ mutationFn: (input: Parameters<typeof api.saveSyncBinding>[0]) => api.saveSyncBinding(input), onSettled: invalidate })
  const removeBinding = useMutation({
    mutationFn: (binding: string) => api.removeSyncBinding({ binding }),
    onError: failed('The binding could not be removed. Retry.'),
    onSettled: invalidate,
  })
  return { syncNow, linkRemote, importRemote, importAll, saveConnection, removeConnection, moveConnection, saveBinding, removeBinding }
}

const bindingLabel = (view: BacklogSyncBindingView): string =>
  `${view.connectionLabel} · ${view.binding.container === '' ? 'from project' : view.binding.container}`

/** The bindings an item can link through: enabled, run here, and scoped to its project or to every project. */
const bindingsFor = (status: BacklogSyncStatusView | undefined, project: string | null | undefined): readonly BacklogSyncBindingView[] =>
  (status?.bindings ?? []).filter(
    view =>
      view.binding.enabled &&
      view.owned &&
      (view.binding.scope === null || project === undefined || (project !== null && view.binding.scope === BacklogItems.projectPath(project))),
  )

const descriptorOf = (status: BacklogSyncStatusView | undefined, kind: string): ProviderDescriptor | undefined =>
  status?.providers?.find(provider => provider.kind === kind)

/** Links one item to a remote item the user names, through one binding. */
const LinkRemoteDialog = (props: {
  readonly itemId: number
  readonly itemLabel: string
  readonly bindingId: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}): JSX.Element => {
  const status = useSyncStatus()
  const actions = useSyncActions()
  const [reference, setReference] = useState('')
  const view = status.data?.bindings?.find(candidate => candidate.binding.id === props.bindingId)
  const descriptor = view === undefined ? undefined : descriptorOf(status.data, view.providerKind)
  const submit = async (): Promise<void> => {
    const linked = await actions.linkRemote.mutateAsync({ id: props.itemId, binding: props.bindingId, reference: reference.trim() })
    BacklogNotices.show({
      text: linked.result === null ? `${props.itemLabel} linked.` : resultNotice(linked.result),
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
            Link {props.itemLabel} through {view === undefined ? props.bindingId : bindingLabel(view)}
          </DialogTitle>
          <DialogDescription>The remote item’s fields replace the item’s on the first sync; labels from both sides are kept.</DialogDescription>
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
            aria-label="Remote item"
            placeholder={descriptor?.referenceExample ?? 'Identifier or URL'}
            value={reference}
            onChange={event => setReference(event.currentTarget.value)}
            className="dshx:font-mono! dshx:h-9 dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-3 dshx:text-sm dshx:outline-none dshx:focus-visible:border-ring"
          />
          {actions.linkRemote.error === null ? null : (
            <p role="alert" className="dshx:text-xs dshx:text-destructive">
              {failureText(actions.linkRemote.error, 'The remote item could not be linked. Check the reference and retry.')}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)} disabled={actions.linkRemote.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={actions.linkRemote.isPending || reference.trim() === ''}>
              <LinkIcon aria-hidden className="dshx:size-3.5" />
              Link
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The binding or tracker an unlink names, whichever the Host that answered knows. */
const refTarget = (entry: BacklogSyncItemView) => (entry.bindingId === undefined ? { backend: entry.backend } : { binding: entry.bindingId })

/** What one external ref's popover shows: where it syncs, how it went, and the controls to act on it. */
const LinkedDetails = (props: { readonly linked: BacklogSyncItemView }): JSX.Element => {
  const actions = useSyncActions()
  const { linked } = props
  const source = linked.connectionLabel ?? linked.backend
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:text-xs">
      {/^https?:\/\//u.test(linked.url) ? (
        <a
          href={linked.url}
          target="_blank"
          rel="noreferrer"
          className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:font-medium dshx:text-foreground dshx:hover:underline"
        >
          <ExternalLinkIcon aria-hidden className="dshx:size-3.5" />
          Open {linked.remoteKey} in {source}
        </a>
      ) : (
        <p className="dshx:font-medium">
          {linked.remoteKey} · {source}
        </p>
      )}
      <p className={cn('dshx:font-medium', stateTones[linked.state])}>{stateLabels[linked.state]}</p>
      <p className="dshx:text-muted-foreground">{linked.lastSyncedAt === null ? 'Not synced yet.' : `Last synced ${syncedAgo(linked.lastSyncedAt)}.`}</p>
      {linked.lastError === null ? null : (
        <p role="alert" className="dshx:text-destructive">
          {linked.lastError.message}
        </p>
      )}
      {linked.state === 'conflict'
        ? linked.conflicts.slice(-3).map(conflict => (
            <p key={`${conflict.field}-${String(conflict.at)}`} className="dshx:text-muted-foreground">
              {conflict.field}:{' '}
              {conflict.kept === 'none' ? 'both sides differ; make them agree' : `kept the ${conflict.kept === 'remote' ? source : 'backlog'} value`}.
            </p>
          ))
        : null}
      <div className="dshx:flex dshx:flex-wrap dshx:gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={actions.syncNow.isPending}
          onClick={() => actions.syncNow.mutate({ id: linked.itemId, ...(linked.bindingId !== undefined && { binding: linked.bindingId }) })}
        >
          <RefreshCwIcon aria-hidden className={cn('dshx:size-3.5', actions.syncNow.isPending && 'dshx:animate-spin')} />
          Sync now
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={actions.linkRemote.isPending}
          onClick={() =>
            actions.linkRemote.mutate({ id: linked.itemId, ...refTarget(linked), remove: true }, { onError: failed('The item could not be unlinked. Retry.') })
          }
        >
          <UnlinkIcon aria-hidden className="dshx:size-3.5" />
          Unlink
        </Button>
      </div>
    </div>
  )
}

const createThrough = (actions: ReturnType<typeof useSyncActions>, input: { readonly itemId: number; readonly view: BacklogSyncBindingView }): void =>
  actions.linkRemote.mutate(
    { id: input.itemId, binding: input.view.binding.id, create: true },
    {
      onSuccess: output =>
        BacklogNotices.show({
          text: `Created ${output.item?.remoteKey ?? 'the remote item'} in ${bindingLabel(input.view)}.`,
          kind: 'success',
          sessionId: null,
        }),
      onError: failed(`Could not create the item in ${bindingLabel(input.view)}.`),
    },
  )

/** An item's external refs in its header row, one chip each, and a way to link one more. */
const SyncChips = (props: { readonly itemId: number; readonly itemLabel: string; readonly project?: string | null | undefined }): JSX.Element | null => {
  const status = useSyncStatus()
  const actions = useSyncActions()
  const [linkBinding, setLinkBinding] = useState<string | null>(null)
  const linked = (status.data?.items ?? []).filter(candidate => candidate.itemId === props.itemId)
  const available = bindingsFor(status.data, props.project).filter(view => !linked.some(entry => entry.bindingId === view.binding.id))
  if (linked.length === 0 && available.length === 0) return null
  return (
    <>
      {linked.map(entry => (
        <Popover key={`${entry.bindingId ?? entry.backend}-${entry.remoteKey}`}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Remote sync: ${entry.remoteKey}, ${stateLabels[entry.state]}`}
              className={cn('dshx:gap-1 dshx:text-xs', stateTones[entry.state])}
            >
              <CloudIcon aria-hidden className="dshx:size-3.5" />
              {entry.remoteKey}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="dshx-root dshx:w-72 dshx:max-w-[calc(100vw-2rem)]">
            <LinkedDetails linked={entry} />
          </PopoverContent>
        </Popover>
      ))}
      {available.length === 0 ? null : (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              aria-label={linked.length === 0 ? 'Remote sync: not linked' : 'Link to another source'}
              className="dshx:gap-1 dshx:text-xs dshx:text-muted-foreground"
            >
              {linked.length === 0 ? <CloudIcon aria-hidden className="dshx:size-3.5" /> : <PlusIcon aria-hidden className="dshx:size-3.5" />}
              {linked.length === 0 ? 'Not synced' : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="dshx-root dshx:flex dshx:w-80 dshx:max-w-[calc(100vw-2rem)] dshx:flex-col dshx:gap-2 dshx:text-xs">
            {available.map(view => (
              <div key={view.binding.id} className="dshx:flex dshx:flex-col dshx:gap-1">
                <span className="dshx:font-medium">{bindingLabel(view)}</span>
                <div className="dshx:flex dshx:flex-wrap dshx:gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => setLinkBinding(view.binding.id)}>
                    <LinkIcon aria-hidden className="dshx:size-3.5" />
                    Link…
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={actions.linkRemote.isPending}
                    onClick={() => createThrough(actions, { itemId: props.itemId, view })}
                  >
                    <PlusIcon aria-hidden className="dshx:size-3.5" />
                    Create
                  </Button>
                </div>
              </div>
            ))}
          </PopoverContent>
        </Popover>
      )}
      {linkBinding === null ? null : (
        <LinkRemoteDialog
          itemId={props.itemId}
          itemLabel={props.itemLabel}
          bindingId={linkBinding}
          open
          onOpenChange={open => (open ? undefined : setLinkBinding(null))}
        />
      )}
    </>
  )
}

/** The item menu's sync entries: Sync now and Unlink per linked source, Link and Create per binding still free. */
const SyncMenuItems = (props: {
  readonly itemId: number
  readonly project?: string | null | undefined
  readonly onLink: (bindingId: string) => void
}): JSX.Element => {
  const status = useSyncStatus()
  const actions = useSyncActions()
  const linked = (status.data?.items ?? []).filter(candidate => candidate.itemId === props.itemId)
  const available = bindingsFor(status.data, props.project).filter(view => !linked.some(entry => entry.bindingId === view.binding.id))
  return (
    <>
      {linked.map(entry => (
        <Fragment key={`${entry.bindingId ?? entry.backend}-${entry.remoteKey}`}>
          <ContextMenuItem
            className="dshx:gap-2 dshx:text-[13px]"
            disabled={actions.syncNow.isPending}
            onSelect={() => actions.syncNow.mutate({ id: props.itemId, ...(entry.bindingId !== undefined && { binding: entry.bindingId }) })}
          >
            <RefreshCwIcon aria-hidden className="dshx:size-3.5" />
            Sync now with {entry.remoteKey}
          </ContextMenuItem>
          <ContextMenuItem
            className="dshx:gap-2 dshx:text-[13px]"
            onSelect={() =>
              actions.linkRemote.mutate({ id: props.itemId, ...refTarget(entry), remove: true }, { onError: failed('The item could not be unlinked. Retry.') })
            }
          >
            <UnlinkIcon aria-hidden className="dshx:size-3.5" />
            Unlink from {entry.remoteKey}
          </ContextMenuItem>
        </Fragment>
      ))}
      {available.map(view => (
        <Fragment key={view.binding.id}>
          <ContextMenuItem className="dshx:gap-2 dshx:text-[13px]" onSelect={() => props.onLink(view.binding.id)}>
            <LinkIcon aria-hidden className="dshx:size-3.5" />
            Link to {bindingLabel(view)}…
          </ContextMenuItem>
          <ContextMenuItem
            className="dshx:gap-2 dshx:text-[13px]"
            disabled={actions.linkRemote.isPending}
            onSelect={() => createThrough(actions, { itemId: props.itemId, view })}
          >
            <CloudIcon aria-hidden className="dshx:size-3.5" />
            Create in {bindingLabel(view)}
          </ContextMenuItem>
        </Fragment>
      ))}
    </>
  )
}

const inputClass =
  'dshx:h-8 dshx:min-w-0 dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-2 dshx:text-sm dshx:outline-none dshx:focus-visible:border-ring'

const isReferenceOrEmpty = (text: string): boolean => text.trim() === '' || parseSecretReference(text.trim()) !== null

/** A removal the user confirms first: the bindings or links it drops are gone for good. */
const ConfirmRemove = (props: {
  readonly heading: string
  readonly description: string
  readonly label: string
  readonly onConfirm: () => void
}): JSX.Element => {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" variant="ghost" size="icon-xs" aria-label={props.label} onClick={() => setOpen(true)}>
        <Trash2Icon />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="dshx-root">
          <AlertDialogHeader>
            <AlertDialogTitle>{props.heading}</AlertDialogTitle>
            <AlertDialogDescription>{props.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={props.onConfirm}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** The account a test saw, or the error with its fix. */
const TestReport = (props: { readonly report: BacklogSyncTestView | undefined; readonly error: unknown }): JSX.Element | null => {
  if (props.error !== null && props.error !== undefined)
    return (
      <p role="alert" className="dshx:text-xs dshx:text-destructive">
        {failureText(props.error, 'The connection could not be tested. Retry.')}
      </p>
    )
  const report = props.report
  if (report === undefined) return null
  if (report.error !== null)
    return (
      <p role="alert" className="dshx:text-xs dshx:text-destructive">
        {report.error.message}
      </p>
    )
  return (
    <p role="status" className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:text-xs dshx:text-success">
      <CircleCheckIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
      <span className="dshx:min-w-0 dshx:truncate">
        {report.account ?? 'Connected'} · {credentialLabels[report.credential]}
        {report.containers.length === 0 ? '' : ` · ${String(report.containers.length)} available`}
      </span>
    </p>
  )
}

/** Adds or edits one connection: name, key reference and base URL, tested before it is saved. */
const ConnectionForm = (props: {
  readonly descriptor: ProviderDescriptor
  readonly initial?: BacklogSyncConnectionView['connection'] | undefined
  readonly takenIds: readonly string[]
  readonly onDone: () => void
}): JSX.Element => {
  const api = useApi(backlogApi)
  const actions = useSyncActions()
  const [label, setLabel] = useState(props.initial?.label ?? props.descriptor.label)
  const [credential, setCredential] = useState(props.initial?.credential ?? '')
  const [baseUrl, setBaseUrl] = useState(props.initial?.baseUrl ?? '')
  const [options, setOptions] = useState<Readonly<Record<string, string>>>(props.initial?.options ?? {})
  const optionFields = props.descriptor.connectionOptions ?? []
  const filledOptions = Object.fromEntries(
    optionFields.flatMap(option => {
      const value = (options[option.key] ?? '').trim()
      return value === '' ? [] : [[option.key, value] as const]
    }),
  )
  const draftOptions = optionFields.length === 0 ? {} : { options: filledOptions }
  const test = useMutation({
    mutationFn: () =>
      api.testSyncConnection({ draft: { kind: props.descriptor.kind, credential: credential.trim(), baseUrl: baseUrl.trim(), ...draftOptions } }),
  })
  const instanceId =
    props.initial?.instanceId ??
    BacklogSyncModel.uniqueSlug(BacklogSyncModel.slugOf(label === props.descriptor.label ? props.descriptor.kind : label), new Set(props.takenIds))
  const keyed = props.descriptor.credential !== 'none'
  const save = (): void =>
    actions.saveConnection.mutate(
      { connection: { instanceId, kind: props.descriptor.kind, label: label.trim(), credential: credential.trim(), baseUrl: baseUrl.trim(), ...draftOptions } },
      { onSuccess: props.onDone },
    )
  return (
    <form
      aria-label={`${props.initial === undefined ? 'New' : 'Edit'} ${props.descriptor.label} connection`}
      className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:p-3"
      onSubmit={event => {
        event.preventDefault()
        save()
      }}
    >
      <div className="dshx:grid dshx:grid-cols-3 dshx:gap-2 dshx:@max-pane-narrow:grid-cols-1">
        <input aria-label="Connection name" value={label} onChange={event => setLabel(event.currentTarget.value)} className={inputClass} />
        {keyed ? (
          <input
            type="text"
            data-secret-input="reference"
            data-secret-alias={props.descriptor.environmentVariables[0] ?? `${props.descriptor.kind.toUpperCase()}_KEY`}
            data-secret-scope="global"
            aria-label={`${props.descriptor.label} key reference`}
            placeholder={`secret:${props.descriptor.environmentVariables[0] ?? 'ALIAS'}`}
            value={credential}
            onChange={event => setCredential(event.currentTarget.value)}
            className={cn(inputClass, 'dshx:font-mono!')}
          />
        ) : null}
        {keyed ? (
          <input
            aria-label="API base URL"
            placeholder="Default API"
            value={baseUrl}
            onChange={event => setBaseUrl(event.currentTarget.value)}
            className={cn(inputClass, 'dshx:font-mono!')}
          />
        ) : null}
        {optionFields.map(option => (
          <input
            key={option.key}
            aria-label={option.label}
            placeholder={option.placeholder}
            value={options[option.key] ?? ''}
            onChange={event => {
              const value = event.currentTarget.value
              setOptions(current => ({ ...current, [option.key]: value }))
            }}
            className={inputClass}
          />
        ))}
      </div>
      {isReferenceOrEmpty(credential) ? null : (
        <p role="alert" className="dshx:text-xs dshx:text-destructive">
          Keys are stored as vault references. Pick one with the key button in the field, or clear it to use the Host environment.
        </p>
      )}
      <TestReport report={test.data} error={test.error} />
      {actions.saveConnection.error === null ? null : (
        <p role="alert" className="dshx:text-xs dshx:text-destructive">
          {failureText(actions.saveConnection.error, 'The connection could not be saved. Retry.')}
        </p>
      )}
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <Button type="button" size="sm" variant="outline" disabled={test.isPending || !isReferenceOrEmpty(credential)} onClick={() => test.mutate()}>
          <RefreshCwIcon aria-hidden className={cn('dshx:size-3.5', test.isPending && 'dshx:animate-spin')} />
          Test connection
        </Button>
        <Button type="submit" size="sm" disabled={actions.saveConnection.isPending || label.trim() === '' || !isReferenceOrEmpty(credential)}>
          Save connection
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={props.onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

const supportsField = (descriptor: ProviderDescriptor | undefined, field: SyncFieldRule['field']): boolean =>
  descriptor === undefined || BacklogSyncModel.supports(descriptor.capabilities, field)

/** The core fields, greyed out when the provider cannot carry them, and the extra fields only a provider that carries them shows. */
const shownFields = (descriptor: ProviderDescriptor | undefined): readonly SyncFieldRule['field'][] =>
  BacklogSyncModel.syncedFields.filter(
    field => !BacklogProviders.extraFields.some(extra => extra === field) || (descriptor !== undefined && supportsField(descriptor, field)),
  )

const defaultContainerLabel = (descriptor: ProviderDescriptor | undefined): string => {
  if (descriptor?.kind === 'github') return 'From the project’s git remote'
  if (descriptor?.kind === 'files') return 'backlog/ in the project'
  return 'The only one the key sees'
}

/** Adds or edits one binding of a connection. */
const BindingForm = (props: {
  readonly connection: BacklogSyncConnectionView
  readonly descriptor: ProviderDescriptor | undefined
  readonly initial?: SyncBinding | undefined
  readonly projectOptions: readonly ComboboxOption[]
  readonly onDone: () => void
}): JSX.Element => {
  const api = useApi(backlogApi)
  const actions = useSyncActions()
  const initial = props.initial
  const [container, setContainer] = useState(initial?.container ?? '')
  const [scope, setScope] = useState<string | null>(initial?.scope ?? null)
  const [direction, setDirection] = useState<SyncBinding['direction']>(initial?.direction ?? 'two-way')
  const [fieldMap, setFieldMap] = useState<readonly SyncFieldRule[]>(initial?.fieldMap ?? BacklogSyncModel.defaultFieldMap())
  const [policy, setPolicy] = useState<SyncConflictPolicy>(initial?.conflictPolicy ?? 'lww')
  const [poll, setPoll] = useState(initial?.pollEverySec ?? 0)
  const [pushAgentComments, setPushAgentComments] = useState(initial?.pushAgentComments ?? false)
  const [importNew, setImportNew] = useState(initial?.importNew ?? false)
  const [options, setOptions] = useState<Readonly<Record<string, string>>>(initial?.options ?? {})
  const optionFields = props.descriptor?.bindingOptions ?? []
  const discovered = useQuery({
    queryKey: [BacklogQueries.key, 'sync-discover', props.connection.connection.instanceId],
    queryFn: ({ signal }) => api.discoverSync({ connection: props.connection.connection.instanceId }, { signal }),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const containers = discovered.data?.containers ?? []
  const directionOf = (field: SyncFieldRule['field']): SyncFieldDirection => fieldMap.find(rule => rule.field === field)?.direction ?? 'off'
  const setFieldDirection = (field: SyncFieldRule['field'], next: SyncFieldDirection): void =>
    setFieldMap(current =>
      BacklogSyncModel.syncedFields.flatMap(candidate => {
        const kept = current.find(rule => rule.field === candidate)
        if (candidate !== field) return kept === undefined ? [] : [kept]
        return next === 'off' ? [] : [{ field, direction: next, values: kept?.values ?? [] }]
      }),
    )
  const statusValues = fieldMap.find(rule => rule.field === 'status')?.values ?? []
  const setStatusValue = (local: string, remote: string): void =>
    setFieldMap(current =>
      current.map(rule =>
        rule.field !== 'status'
          ? rule
          : { ...rule, values: [...rule.values.filter(pair => pair.local !== local), ...(remote.trim() === '' ? [] : [{ local, remote: remote.trim() }])] },
      ),
    )
  const containerOptions: ComboboxOption[] = [
    { value: '', label: defaultContainerLabel(props.descriptor) },
    ...containers.map(entry => ({ value: entry.key, label: entry.key, ...(entry.name !== entry.key && { description: entry.name }) })),
    ...(container === '' || containers.some(entry => entry.key === container) ? [] : [{ value: container, label: container }]),
  ]
  const pollOptions = [...new Set<number>([...pollPresets, poll])]
    .sort((left, right) => left - right)
    .map(seconds => ({ value: String(seconds), label: pollLabel(seconds) }))
  const writable = props.descriptor?.capabilities.write !== false
  const save = (): void =>
    actions.saveBinding.mutate(
      {
        binding: {
          ...(initial !== undefined && { id: initial.id }),
          connectionId: props.connection.connection.instanceId,
          container: container.trim(),
          scope,
          direction,
          fieldMap: [...fieldMap],
          conflictPolicy: policy,
          pollEverySec: poll,
          pushAgentComments,
          importNew,
          enabled: initial?.enabled ?? true,
          ...(optionFields.length > 0 && {
            options: Object.fromEntries(
              optionFields.flatMap(option => {
                const value = (options[option.key] ?? '').trim()
                return value === '' ? [] : [[option.key, value] as const]
              }),
            ),
          }),
        },
      },
      { onSuccess: props.onDone },
    )
  return (
    <form
      aria-label={initial === undefined ? 'New binding' : `Edit binding ${initial.id}`}
      className="dshx:flex dshx:flex-col dshx:gap-3 dshx:rounded-md dshx:border dshx:border-border dshx:bg-muted/30 dshx:p-3 dshx:text-xs"
      onSubmit={event => {
        event.preventDefault()
        save()
      }}
    >
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        {containers.length > 0 ? (
          <Combobox
            label={props.descriptor?.containerLabel ?? 'Container'}
            value={container}
            options={containerOptions}
            onValueChange={setContainer}
            triggerClassName="dshx:min-w-0 dshx:max-w-56"
          />
        ) : (
          <input
            aria-label={props.descriptor?.containerLabel ?? 'Container'}
            placeholder={defaultContainerLabel(props.descriptor)}
            value={container}
            onChange={event => setContainer(event.currentTarget.value)}
            className={cn(inputClass, 'dshx:font-mono! dshx:w-56')}
          />
        )}
        <Combobox
          label="Project"
          value={scope ?? ALL_PROJECTS}
          options={props.projectOptions}
          onValueChange={value => setScope(value === ALL_PROJECTS ? null : value)}
          triggerClassName="dshx:min-w-0 dshx:max-w-48"
        />
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={direction}
          aria-label="Direction"
          onValueChange={value => (value === 'two-way' || value === 'pull' || value === 'push' ? setDirection(value) : undefined)}
        >
          {BacklogSyncModel.directions.map(value => (
            <ToggleGroupItem key={value} value={value} disabled={value !== 'pull' && !writable}>
              {directionLabels[value]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <fieldset className="dshx:grid dshx:grid-cols-2 dshx:gap-x-4 dshx:gap-y-1.5 dshx:@max-pane-narrow:grid-cols-1" aria-label="Fields">
        {shownFields(props.descriptor).map(field => (
          <div key={field} className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
            <span className={cn(!supportsField(props.descriptor, field) && 'dshx:text-muted-foreground')}>{fieldLabels[field]}</span>
            <Combobox
              label={`${fieldLabels[field]} sync`}
              value={supportsField(props.descriptor, field) ? directionOf(field) : 'off'}
              disabled={!supportsField(props.descriptor, field)}
              options={BacklogSyncModel.fieldDirections.map(value => ({ value, label: fieldDirectionLabels[value] }))}
              onValueChange={value => (isFieldDirection(value) ? setFieldDirection(field, value) : undefined)}
              triggerClassName="dshx:w-28"
            />
          </div>
        ))}
      </fieldset>
      {optionFields.length === 0 ? null : (
        <fieldset className="dshx:grid dshx:grid-cols-2 dshx:gap-x-4 dshx:gap-y-1.5 dshx:@max-pane-narrow:grid-cols-1" aria-label="Provider settings">
          {optionFields.map(option => (
            <label key={option.key} className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
              {option.label}
              <input
                aria-label={option.label}
                placeholder={option.placeholder}
                value={options[option.key] ?? ''}
                onChange={event => {
                  const value = event.currentTarget.value
                  setOptions(current => ({ ...current, [option.key]: value }))
                }}
                className={cn(inputClass, 'dshx:h-7 dshx:w-40 dshx:text-xs')}
              />
            </label>
          ))}
        </fieldset>
      )}
      {directionOf('status') === 'off' ? null : (
        <fieldset className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2" aria-label="Remote status names">
          {BacklogItems.statuses.map(status => (
            <label key={status} className="dshx:flex dshx:items-center dshx:gap-1">
              <ItemGlyphs.StatusIcon status={status} />
              <input
                aria-label={`Remote name for ${status}`}
                placeholder={status}
                value={statusValues.find(pair => pair.local === status)?.remote ?? ''}
                onChange={event => setStatusValue(status, event.currentTarget.value)}
                className={cn(inputClass, 'dshx:h-7 dshx:w-24 dshx:text-xs')}
              />
            </label>
          ))}
        </fieldset>
      )}
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-3">
        <Combobox
          label="Conflicts"
          value={policy}
          options={BacklogSyncModel.conflictPolicies.map(value => ({ value, label: policyLabels[value] }))}
          onValueChange={value => (isPolicy(value) ? setPolicy(value) : undefined)}
          triggerClassName="dshx:w-auto"
        />
        <Combobox label="Interval" value={String(poll)} options={pollOptions} onValueChange={value => setPoll(Number(value))} triggerClassName="dshx:w-auto" />
        {props.descriptor?.capabilities.comments === 'read-write' ? (
          <label className="dshx:flex dshx:items-center dshx:gap-1.5">
            <Switch size="sm" checked={pushAgentComments} onCheckedChange={setPushAgentComments} />
            Push agent comments
          </label>
        ) : null}
        <label className="dshx:flex dshx:items-center dshx:gap-1.5">
          <Switch size="sm" checked={importNew} onCheckedChange={setImportNew} />
          Import new remote items
        </label>
      </div>
      {actions.saveBinding.error === null ? null : (
        <p role="alert" className="dshx:text-destructive">
          {failureText(actions.saveBinding.error, 'The binding could not be saved. Retry.')}
        </p>
      )}
      <div className="dshx:flex dshx:gap-2">
        <Button type="submit" size="sm" disabled={actions.saveBinding.isPending}>
          Save binding
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={props.onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

const scopeLabel = (scope: string | null): string => (scope === null ? 'Every project' : ItemGlyphs.projectName(scope))

/** One binding on one line: what it syncs with which project, how often, and its actions. */
const BindingRow = (props: {
  readonly view: BacklogSyncBindingView
  readonly connection: BacklogSyncConnectionView
  readonly descriptor: ProviderDescriptor | undefined
  readonly projectOptions: readonly ComboboxOption[]
}): JSX.Element => {
  const actions = useSyncActions()
  const [editing, setEditing] = useState(false)
  const { binding } = props.view
  if (editing)
    return (
      <BindingForm
        connection={props.connection}
        descriptor={props.descriptor}
        initial={binding}
        projectOptions={props.projectOptions}
        onDone={() => setEditing(false)}
      />
    )
  return (
    <div
      role="group"
      aria-label={`Binding ${binding.id}`}
      className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-x-2 dshx:gap-y-1 dshx:rounded-md dshx:border dshx:border-border dshx:px-2.5 dshx:py-1.5 dshx:text-xs"
    >
      <span className="dshx:font-mono dshx:font-medium">{binding.container === '' ? '(from project)' : binding.container}</span>
      <span className="dshx:text-muted-foreground">{scopeLabel(binding.scope)}</span>
      <span className="dshx:text-muted-foreground">{directionLabels[binding.direction]}</span>
      <span className="dshx:text-muted-foreground">{pollLabel(binding.pollEverySec)}</span>
      <span className="dshx:text-muted-foreground">{String(props.view.linked)} linked</span>
      {props.view.owned ? null : <span className="dshx:text-warning">Runs on another Host</span>}
      <span className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-1">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={actions.syncNow.isPending || !props.view.owned}
          onClick={() => actions.syncNow.mutate({ binding: binding.id })}
          aria-label={`Sync ${binding.id} now`}
        >
          <RefreshCwIcon aria-hidden className={cn('dshx:size-3', actions.syncNow.isPending && 'dshx:animate-spin')} />
          Sync now
        </Button>
        {binding.direction === 'push' ? null : (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={actions.importAll.isPending || !props.view.owned}
            onClick={() => actions.importAll.mutate(binding.id)}
          >
            <DownloadIcon aria-hidden className="dshx:size-3" />
            Import all open
          </Button>
        )}
        <Switch
          size="sm"
          aria-label={`Enable binding ${binding.id}`}
          checked={binding.enabled}
          onCheckedChange={enabled =>
            actions.saveBinding.mutate({ binding: { id: binding.id, enabled } }, { onError: failed('The binding could not be saved. Retry.') })
          }
        />
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Edit binding ${binding.id}`} onClick={() => setEditing(true)}>
          <PencilIcon />
        </Button>
        <ConfirmRemove
          label={`Remove binding ${binding.id}`}
          heading={`Remove ${binding.id}?`}
          description={`Its ${String(props.view.linked)} item links stop syncing and are dropped. Items and remote items stay.`}
          onConfirm={() => actions.removeBinding.mutate(binding.id)}
        />
      </span>
    </div>
  )
}

/** One connection with its identity, its actions and its bindings. */
const ConnectionCard = (props: {
  readonly view: BacklogSyncConnectionView
  readonly index: number
  readonly count: number
  readonly bindings: readonly BacklogSyncBindingView[]
  readonly descriptor: ProviderDescriptor | undefined
  readonly takenIds: readonly string[]
  readonly projectOptions: readonly ComboboxOption[]
}): JSX.Element => {
  const api = useApi(backlogApi)
  const actions = useSyncActions()
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const { connection } = props.view
  const test = useMutation({
    mutationFn: () => api.testSyncConnection({ connection: connection.instanceId }),
    onSettled: () => client.invalidateQueries({ queryKey: SYNC_STATUS_KEY }),
  })
  return (
    <section
      aria-label={`Connection ${connection.label}`}
      className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:p-3"
    >
      {editing && props.descriptor !== undefined ? (
        <ConnectionForm descriptor={props.descriptor} initial={connection} takenIds={props.takenIds} onDone={() => setEditing(false)} />
      ) : (
        <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-2">
          <span className="dshx:text-sm dshx:font-medium">{connection.label}</span>
          {props.view.providerLabel === connection.label ? null : <span className="dshx:text-xs dshx:text-muted-foreground">{props.view.providerLabel}</span>}
          <span className={cn('dshx:text-xs', props.view.credential === 'missing' ? 'dshx:text-destructive' : 'dshx:text-muted-foreground')}>
            {credentialLabels[props.view.credential]}
          </span>
          {connection.identity === null ? null : (
            <span className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-xs dshx:text-success">
              <CircleCheckIcon aria-hidden className="dshx:size-3.5" />
              {connection.identity.account}
            </span>
          )}
          {props.view.available ? null : <span className="dshx:text-xs dshx:text-destructive">Provider not loaded: enable its plugin</span>}
          <span className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-1">
            <Button type="button" size="xs" variant="ghost" disabled={test.isPending} onClick={() => test.mutate()}>
              <RefreshCwIcon aria-hidden className={cn('dshx:size-3', test.isPending && 'dshx:animate-spin')} />
              Test
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Move ${connection.label} up`}
              disabled={props.index === 0}
              onClick={() => actions.moveConnection.mutate({ instanceId: connection.instanceId, direction: 'earlier' })}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Move ${connection.label} down`}
              disabled={props.index === props.count - 1}
              onClick={() => actions.moveConnection.mutate({ instanceId: connection.instanceId, direction: 'later' })}
            >
              <ArrowDownIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Edit ${connection.label}`}
              disabled={props.descriptor === undefined}
              onClick={() => setEditing(true)}
            >
              <PencilIcon />
            </Button>
            <ConfirmRemove
              label={`Remove ${connection.label}`}
              heading={`Remove ${connection.label}?`}
              description={`Its ${String(props.bindings.length)} bindings and their item links go with it. Items and remote items stay.`}
              onConfirm={() => actions.removeConnection.mutate(connection.instanceId)}
            />
          </span>
        </div>
      )}
      <TestReport report={test.data} error={test.error} />
      {props.bindings.map(binding => (
        <BindingRow key={binding.binding.id} view={binding} connection={props.view} descriptor={props.descriptor} projectOptions={props.projectOptions} />
      ))}
      {adding ? (
        <BindingForm connection={props.view} descriptor={props.descriptor} projectOptions={props.projectOptions} onDone={() => setAdding(false)} />
      ) : (
        <Button type="button" size="xs" variant="outline" className="dshx:self-start" onClick={() => setAdding(true)} disabled={!props.view.available}>
          <PlusIcon aria-hidden className="dshx:size-3" />
          Add binding
        </Button>
      )}
    </section>
  )
}

/** Connections and their bindings, and Import one item, under Backlog settings. */
const RemoteSyncSettings = (props: { readonly projectPaths: readonly string[] }): JSX.Element => {
  const status = useSyncStatus()
  const actions = useSyncActions()
  const [addingKind, setAddingKind] = useState<string | null>(null)
  const [importReference, setImportReference] = useState('')
  const data = status.data
  const providers = data?.providers ?? []
  const connections = data?.connections ?? []
  const bindings = data?.bindings ?? []
  const takenIds = connections.map(candidate => candidate.connection.instanceId)
  const projectOptions: ComboboxOption[] = [
    { value: ALL_PROJECTS, label: 'Every project' },
    ...props.projectPaths.map(project => ({ value: project, label: ItemGlyphs.projectName(project), description: project })),
  ]
  const adding = addingKind === null ? undefined : providers.find(provider => provider.kind === addingKind)
  const importIssue = async (): Promise<void> => {
    const output = await actions.importRemote.mutateAsync({ reference: importReference.trim() })
    BacklogNotices.show({
      text: output.created
        ? `Imported as ${BacklogReference.labelOf(output.detail.item)} — ${output.detail.item.title}`
        : `Already in the backlog as ${BacklogReference.labelOf(output.detail.item)}.`,
      kind: 'success',
      sessionId: null,
    })
    setImportReference('')
  }
  return (
    <section
      className="dshx-root dshx:@container dshx:mx-auto dshx:w-full dshx:max-w-2xl dshx:p-5 dshx:@max-pane-narrow:p-3"
      aria-labelledby="backlog-remote-sync-title"
    >
      <h3 id="backlog-remote-sync-title" className="dshx:text-base dshx:font-semibold">
        Remote sync
      </h3>
      {hostLacksSources(data) ? (
        <p role="alert" className="dshx:mt-3 dshx:text-sm dshx:text-warning">
          {HOST_RESTART}
        </p>
      ) : (
        <div className="dshx:mt-3 dshx:flex dshx:flex-col dshx:gap-3">
          {status.error === null ? null : (
            <p role="alert" className="dshx:text-sm dshx:text-destructive">
              {failureText(status.error, 'Remote sync could not be read. Retry.')}
            </p>
          )}
          {connections.map((view, index) => (
            <ConnectionCard
              key={view.connection.instanceId}
              view={view}
              index={index}
              count={connections.length}
              bindings={bindings.filter(binding => binding.binding.connectionId === view.connection.instanceId)}
              descriptor={providers.find(provider => provider.kind === view.connection.kind)}
              takenIds={takenIds}
              projectOptions={projectOptions}
            />
          ))}
          {adding === undefined ? null : <ConnectionForm descriptor={adding} takenIds={takenIds} onDone={() => setAddingKind(null)} />}
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            {providers.map(provider => (
              <Button
                key={provider.kind}
                type="button"
                size="sm"
                variant="outline"
                aria-label={`Add ${provider.label} connection`}
                onClick={() => setAddingKind(provider.kind)}
              >
                <PlusIcon aria-hidden className="dshx:size-3.5" />
                {provider.label}
              </Button>
            ))}
            {(data?.items.length ?? 0) === 0 ? null : (
              <Button type="button" size="sm" variant="outline" disabled={actions.syncNow.isPending} onClick={() => actions.syncNow.mutate({})}>
                <RefreshCwIcon aria-hidden className={cn('dshx:size-3.5', actions.syncNow.isPending && 'dshx:animate-spin')} />
                Sync all now ({String(data?.items.length ?? 0)})
              </Button>
            )}
          </div>
          <form
            className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2"
            aria-label="Import a remote item"
            onSubmit={event => {
              event.preventDefault()
              void importIssue().catch(() => undefined)
            }}
          >
            <input
              type="text"
              aria-label="Remote item to import"
              placeholder="Import: ENG-12, #42 or a URL"
              value={importReference}
              onChange={event => setImportReference(event.currentTarget.value)}
              className={cn(inputClass, 'dshx:font-mono! dshx:flex-1')}
            />
            <Button type="submit" size="sm" disabled={actions.importRemote.isPending || importReference.trim() === ''}>
              Import
            </Button>
            {actions.importRemote.error === null ? null : (
              <p role="alert" className="dshx:w-full dshx:text-xs dshx:text-destructive">
                {failureText(actions.importRemote.error, 'The item could not be imported. Check the reference and the bindings, then retry.')}
              </p>
            )}
          </form>
        </div>
      )}
    </section>
  )
}

export class BacklogSyncControls {
  static readonly Chip = SyncChips
  static readonly MenuItems = SyncMenuItems
  static readonly LinkDialog = LinkRemoteDialog
  static readonly Settings = RemoteSyncSettings
  static readonly stateLabels = stateLabels
}
