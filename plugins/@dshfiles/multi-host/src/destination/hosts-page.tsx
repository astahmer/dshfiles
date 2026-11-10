import { useApi } from '@dshfiles/dshx/client'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { ProjectFolderPicker, type ProjectFolderSelection } from '@dshfiles/workspace-folder-picker/picker'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { EmptyState, Page } from '@dshfiles/plugin-ui/components/page'
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState, type ReactNode } from 'react'
import { multiHostApi, type HostSummary, type ResourcePoolEntry, type RuntimeSummary } from '../api.js'
import { remoteDirectoryPicker } from './remote-folders.js'
import { HostDialog, hostState, type HostDraft } from './hosts-dialog.js'
import { moveHostId, shiftHostId } from './host-order.js'
import { CheckoutSyncDialog } from './checkout-sync-dialog.js'
import { CloneProjectDialog } from './clone-project-dialog.js'
import { ConnectionDiagnostics } from './connection-diagnostics.js'
import { ConnectionTestSteps } from './connection-test-steps.js'
import { FleetUpdateDialog } from './fleet-update-dialog.js'
import { DisconnectGrace } from './disconnect-grace.js'
import { multiHostKeys, multiHostQueries, type MultiHostClient } from './queries.js'

type DirectoryData = { readonly hosts: readonly HostSummary[]; readonly runtimes: readonly RuntimeSummary[] }

const blankDraft: HostDraft = { name: '', sshTarget: '', remoteHome: '' }

const failure = (result: { readonly ok: boolean; readonly code?: string; readonly message?: string }): Error =>
  new Error(result.message === undefined ? 'The host request failed.' : `${result.message}${result.code === undefined ? '' : ` (${result.code})`}`)

const ResourceUsage = (props: { readonly hostName: string; readonly resource: ResourcePoolEntry }) => {
  if (!props.resource.probe.ok) {
    return (
      <p data-testid={`host-resources-${props.resource.hostId}`} className="dshx:text-xs dshx:text-muted-foreground">
        Resource data unavailable
      </p>
    )
  }
  const snapshot = props.resource.probe.snapshot
  const memoryUsed = snapshot.memoryTotalBytes - snapshot.memoryFreeBytes
  const memoryUsedRatio = snapshot.memoryTotalBytes === 0 ? undefined : memoryUsed / snapshot.memoryTotalBytes
  const normalizedLoad = snapshot.loadAverage1m === null || snapshot.cpuCount === 0 ? undefined : snapshot.loadAverage1m / snapshot.cpuCount
  const memoryText =
    snapshot.memoryTotalBytes === 0 ? '—' : `${(memoryUsed / 1024 ** 3).toFixed(1)} / ${(snapshot.memoryTotalBytes / 1024 ** 3).toFixed(1)} GiB`
  const loadText = snapshot.loadAverage1m === null ? '—' : `${snapshot.loadAverage1m.toFixed(2)} · ${snapshot.cpuCount} cores`

  const metric = (label: string, value: string, ratio: number | undefined) => (
    <div className="dshx:min-w-0 dshx:flex-1">
      <div className="dshx:flex dshx:justify-between dshx:gap-2 dshx:text-[11px]">
        <span className="dshx:text-muted-foreground">{label}</span>
        <span className="dshx:truncate dshx:font-mono">{value}</span>
      </div>
      <div className="dshx:mt-1 dshx:h-1 dshx:overflow-hidden dshx:rounded-full dshx:bg-muted" aria-hidden="true">
        <div className="dshx:h-full dshx:rounded-full dshx:bg-primary" style={{ width: `${Math.min(100, Math.max(0, (ratio ?? 0) * 100))}%` }} />
      </div>
    </div>
  )

  return (
    <div
      role="group"
      data-testid={`host-resources-${props.resource.hostId}`}
      aria-label={`Resources for ${props.hostName}`}
      className="dshx:flex dshx:min-w-0 dshx:gap-4 dshx:pt-1 dshx:@max-pane-compact:flex-col dshx:@max-pane-compact:gap-2"
    >
      {metric('Load · 1m', loadText, normalizedLoad)}
      {metric('Memory used', memoryText, memoryUsedRatio)}
      <span className="dshx:sr-only">{props.resource.stale ? 'Resource sample is stale' : 'Resource sample is current'}</span>
    </div>
  )
}

/** An icon-only row control with a kit tooltip instead of a native `title`. */
const IconAction = (props: {
  readonly label: string
  readonly hint: string
  readonly onClick: () => void
  readonly disabled?: boolean
  readonly destructive?: boolean
  readonly children: ReactNode
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        size="icon"
        variant={props.destructive === true ? 'destructive' : 'ghost'}
        className="dshx:size-7"
        aria-label={props.label}
        disabled={props.disabled === true}
        onClick={props.onClick}
      >
        {props.children}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{props.hint}</TooltipContent>
  </Tooltip>
)

/** Hosts on the one status vocabulary: a healthy or idle host is quiet, only a failed one is coloured. */
const hostWorkStatus = (tone: 'online' | 'idle' | 'error'): WorkStatus => (tone === 'error' ? 'failed' : 'idle')

const HostRow = (props: {
  readonly api: MultiHostClient
  readonly host: HostSummary
  readonly runtime: RuntimeSummary | undefined
  readonly resource: ResourcePoolEntry | undefined
  readonly localVersion: string | undefined
  readonly index: number
  readonly count: number
  readonly dragging: boolean
  readonly dropTarget: boolean
  readonly onDragStart: () => void
  readonly onDragEnd: () => void
  readonly onDragOver: () => void
  readonly onDrop: () => void
  readonly onMove: (direction: 'up' | 'down') => void
  readonly onHide: (hidden: boolean) => void
  readonly onEdit: () => void
  readonly onAddProject: () => void
  readonly onCloneProject: () => void
  readonly onSyncCheckout: () => void
  readonly onRemove: () => void
}) => {
  const { api, host, runtime } = props
  const queryClient = useQueryClient()
  const state = DisconnectGrace.use(hostState(runtime))
  const outdatedVersion = ConnectionDiagnostics.versionMismatch({ localVersion: props.localVersion, remoteVersion: runtime?.identity?.dshVersion })
  const [confirming, setConfirming] = useState(false)
  const [popupBlocked, setPopupBlocked] = useState(false)
  const reconnect = useMutation({
    mutationFn: async () => {
      if (runtime === undefined) throw new Error('This host has no runtime. Edit the host to set its remote DSH home, then reconnect.')
      const result = await api.runtimeReconnect({ runtimeId: runtime.id })
      if (!result.ok) throw failure(result)
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: multiHostKeys.all }),
  })
  const remoteView = useMutation({
    mutationFn: async ({ action, tab }: { readonly action: 'copy' | 'open'; readonly tab?: Window }) => {
      if (runtime === undefined) throw new Error('This host has no runtime. Edit the host to set its remote DSH home, then reconnect.')
      if (action === 'open' && tab === undefined) throw new Error('Allow pop-ups to open the remote host.')
      const view = await api.runtimeOpenView({ runtimeId: runtime.id })
      if (action === 'open') {
        if (tab === undefined) throw new Error('Allow pop-ups to open the remote host.')
        tab.opener = null
        tab.location.href = view.launchUrl
        return 'opened'
      }
      if (!(await writeClipboard(view.launchUrl))) throw new Error('Could not copy the remote host link. Use Open host instead.')
      return 'copied'
    },
    onError: (_error, variables) => variables.tab?.close(),
  })
  const diagnose = useMutation({
    mutationFn: async () => {
      if (host.connector.kind !== 'ssh') throw new Error('Only SSH hosts can be diagnosed.')
      return api.testConnection({ name: host.name, sshTarget: host.connector.sshTarget, remoteHome: runtime?.remoteHome ?? '' })
    },
  })
  const diagnosisFailure = diagnose.data?.ok === false ? failure(diagnose.data) : undefined
  const failedStep = diagnose.data?.steps?.find(step => !step.ok)
  const copyDiagnostics = useMutation({
    mutationFn: async () => {
      const outcome =
        diagnose.data?.ok === true
          ? { kind: 'passed' as const, steps: diagnose.data.steps, dshVersion: diagnose.data.identity.dshVersion, profile: diagnose.data.identity.profile }
          : {
              kind: 'failed' as const,
              steps: diagnose.data?.steps ?? [],
              message: diagnosisFailure?.message ?? errorMessage(diagnose.error, 'The connection test failed.'),
            }
      const report = ConnectionDiagnostics.createReport({
        sshTarget: host.connector.kind === 'ssh' ? host.connector.sshTarget : '',
        remoteHome: runtime?.remoteHome ?? '',
        localVersion: props.localVersion,
        outcome,
      })
      if (!(await writeClipboard(report))) throw new Error('Could not copy the diagnostics. Allow clipboard access and try again.')
    },
  })
  const openHost = (): void => {
    setPopupBlocked(false)
    const tab = window.open('about:blank', '_blank')
    if (tab === null) {
      setPopupBlocked(true)
      return
    }
    remoteView.mutate({ action: 'open', tab })
  }
  const target = (
    <Badge variant="outline" className="dshx:shrink-0 dshx:font-mono dshx:text-[11px]">
      {host.connector.kind === 'ssh' ? host.connector.sshTarget : 'this machine'}
    </Badge>
  )
  return (
    <EntityRow
      role="listitem"
      data-testid={`host-row-${host.id}`}
      status={hostWorkStatus(state.tone)}
      statusDecorative
      className={cn(
        props.dragging && 'dshx:opacity-50',
        props.dropTarget && 'dshx:ring-2 dshx:ring-ring/40 dshx:ring-inset',
        host.hidden && 'dshx:bg-muted/30',
      )}
      onDragOver={event => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        props.onDragOver()
      }}
      onDrop={event => {
        event.preventDefault()
        props.onDrop()
      }}
      leading={
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              draggable
              aria-label={`Reorder ${host.name}`}
              className="dshx:flex dshx:size-6 dshx:shrink-0 dshx:cursor-grab dshx:items-center dshx:justify-center dshx:rounded dshx:border-0 dshx:bg-transparent dshx:text-muted-foreground dshx:hover:bg-accent dshx:active:cursor-grabbing"
              onDragStart={event => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', host.id)
                props.onDragStart()
              }}
              onDragEnd={props.onDragEnd}
            >
              <GripVerticalIcon className="dshx:size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Drag to reorder</TooltipContent>
        </Tooltip>
      }
      heading={<span className={cn('dshx:font-medium', host.hidden && 'dshx:text-muted-foreground')}>{host.name}</span>}
      meta={
        <>
          {runtime?.remoteHome === undefined ? (
            target
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>{target}</TooltipTrigger>
              <TooltipContent>Remote DSH home: {runtime.remoteHome}</TooltipContent>
            </Tooltip>
          )}
          {host.hidden ? (
            <Badge variant="secondary" className="dshx:shrink-0 dshx:text-[10px]">
              Hidden
            </Badge>
          ) : null}
          {props.resource?.stale ? (
            <Badge variant="outline" className="dshx:shrink-0 dshx:text-[10px]">
              Stale
            </Badge>
          ) : null}
        </>
      }
      description={
        <>
          <span className="dshx:min-w-0 dshx:truncate">{state.label}</span>
          {props.resource === undefined ? null : <ResourceUsage hostName={host.name} resource={props.resource} />}
          {outdatedVersion === undefined ? null : (
            <span data-testid={`host-version-mismatch-${host.id}`} className="dshx:text-warning">
              Runs DSH {outdatedVersion}; this machine runs {props.localVersion}. Update its DSH core on that machine, then restart it.
            </span>
          )}
          {diagnose.data === undefined ? null : (
            <ConnectionTestSteps steps={diagnose.data.steps ?? []} {...(diagnose.data.ok ? { identity: diagnose.data.identity } : {})} />
          )}
          {diagnosisFailure === undefined && !diagnose.isError ? null : (
            <Alert variant="destructive">
              <AlertDescription>
                {diagnosisFailure?.message ?? errorMessage(diagnose.error, 'The connection test failed.')} {ConnectionDiagnostics.recovery(failedStep?.step)}
              </AlertDescription>
            </Alert>
          )}
          {diagnose.data !== undefined || diagnose.isError ? (
            <span className="dshx:flex dshx:items-center dshx:gap-2">
              <Button type="button" size="xs" variant="ghost" disabled={copyDiagnostics.isPending} onClick={() => copyDiagnostics.mutate()}>
                <CopyIcon className="dshx:size-3.5" />
                Copy diagnostics
              </Button>
              {copyDiagnostics.isSuccess ? (
                <span role="status" className="dshx:text-success">
                  Copied.
                </span>
              ) : null}
              {copyDiagnostics.isError ? (
                <span className="dshx:text-destructive">{errorMessage(copyDiagnostics.error, 'Allow clipboard access, then try again.')}</span>
              ) : null}
            </span>
          ) : null}
          {reconnect.isError ? (
            <span className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-destructive">
              {errorMessage(reconnect.error, 'Reconnect failed.')}
              <Button size="xs" variant="outline" onClick={() => reconnect.mutate()} disabled={reconnect.isPending}>
                Try again
              </Button>
            </span>
          ) : null}
          {remoteView.isError ? (
            <span className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-destructive">
              {errorMessage(remoteView.error, 'Remote host link failed.')}
              <Button size="xs" variant="outline" onClick={() => reconnect.mutate()} disabled={runtime === undefined || reconnect.isPending}>
                Reconnect
              </Button>
            </span>
          ) : null}
          {popupBlocked ? (
            <span className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-destructive">
              Allow pop-ups to open the remote host, or copy its link instead.
              <Button
                size="xs"
                variant="outline"
                onClick={() => remoteView.mutate({ action: 'copy' })}
                disabled={runtime === undefined || remoteView.isPending}
              >
                Copy link
              </Button>
            </span>
          ) : null}
          {remoteView.data === 'copied' ? (
            <span role="status" className="dshx:text-success">
              Remote host link copied.
            </span>
          ) : null}
        </>
      }
      trailing={
        <>
          <IconAction label={`Move ${host.name} up`} hint="Move up" disabled={props.index === 0} onClick={() => props.onMove('up')}>
            <ChevronUpIcon className="dshx:size-3.5" />
          </IconAction>
          <IconAction label={`Move ${host.name} down`} hint="Move down" disabled={props.index === props.count - 1} onClick={() => props.onMove('down')}>
            <ChevronDownIcon className="dshx:size-3.5" />
          </IconAction>
          <IconAction
            label={host.hidden ? `Show ${host.name}` : `Hide ${host.name}`}
            hint={host.hidden ? 'Show in the destination picker' : 'Hide from the destination picker; keeps its records'}
            onClick={() => props.onHide(!host.hidden)}
          >
            {host.hidden ? <EyeOffIcon className="dshx:size-3.5" /> : <EyeIcon className="dshx:size-3.5" />}
          </IconAction>
          {host.connector.kind === 'ssh' ? (
            <>
              <Button size="sm" variant="outline" disabled={runtime === undefined || remoteView.isPending} onClick={openHost}>
                <ExternalLinkIcon className="dshx:size-3.5" />
                Open host
              </Button>
              <IconAction
                label={`Copy ${host.name} link`}
                hint="Copy remote host link"
                disabled={runtime === undefined || remoteView.isPending}
                onClick={() => remoteView.mutate({ action: 'copy' })}
              >
                <CopyIcon className="dshx:size-3.5" />
              </IconAction>
              {runtime?.lastError === undefined ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Diagnose ${host.name}`}
                  disabled={diagnose.isPending}
                  onClick={() => {
                    copyDiagnostics.reset()
                    diagnose.mutate()
                  }}
                >
                  {diagnose.isPending ? <Spinner className="dshx:size-3.5" /> : <SearchIcon className="dshx:size-3.5" />}
                  Diagnose
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={runtime === undefined} onClick={props.onAddProject}>
                <PlusIcon className="dshx:size-3.5" />
                Add folder
              </Button>
              <Button size="sm" variant="outline" disabled={runtime === undefined} onClick={props.onCloneProject}>
                <PlusIcon className="dshx:size-3.5" />
                Clone project
              </Button>
              <Button size="sm" variant="outline" onClick={props.onSyncCheckout}>
                <RefreshCwIcon className="dshx:size-3.5" />
                Sync checkout
              </Button>
            </>
          ) : null}
          <IconAction
            label={`Reconnect ${host.name}`}
            hint="Reconnect"
            disabled={runtime === undefined || reconnect.isPending}
            onClick={() => reconnect.mutate()}
          >
            {reconnect.isPending ? <Spinner className="dshx:size-3.5" /> : <RefreshCwIcon className="dshx:size-3.5" />}
          </IconAction>
          {host.connector.kind === 'ssh' ? (
            <IconAction label={`Edit ${host.name}`} hint="Edit" onClick={props.onEdit}>
              <PencilIcon className="dshx:size-3.5" />
            </IconAction>
          ) : null}
          <IconAction
            label={confirming ? `Confirm remove ${host.name}` : `Remove ${host.name}`}
            hint={confirming ? 'Click again to remove; remote data stays' : 'Remove'}
            destructive={confirming}
            onClick={() => (confirming ? props.onRemove() : setConfirming(true))}
          >
            <Trash2Icon className="dshx:size-3.5" />
          </IconAction>
        </>
      }
    />
  )
}

/** The dedicated hosts page: manage, hide and reorder every registered host without opening a dialog. */
export const HostsPage = () => {
  const api = useApi(multiHostApi)
  const queryClient = useQueryClient()
  const directory = useQuery(multiHostQueries.directory(api, 15_000))
  const resourcePool = useQuery(multiHostQueries.resourcePool(api, 15_000))
  const localIdentity = useQuery(multiHostQueries.identity(api))
  const hosts = directory.data?.hosts ?? []
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  const [pendingOrder, setPendingOrder] = useState<readonly string[] | null>(null)
  const [form, setForm] = useState<HostDraft | null>(null)
  const [projectRuntimeId, setProjectRuntimeId] = useState<string | null>(null)
  const [cloneRuntimeId, setCloneRuntimeId] = useState<string | null>(null)
  const [syncHostId, setSyncHostId] = useState<string | null>(null)
  const [fleetOpen, setFleetOpen] = useState(false)
  const [updateRequest, setUpdateRequest] = useState(0)
  const projectRuntime = directory.data?.runtimes.find(runtime => runtime.id === projectRuntimeId)
  const projectHost = projectRuntime === undefined ? undefined : hosts.find(host => host.id === projectRuntime.hostId)

  const updateDirectoryHosts = (nextHosts: readonly HostSummary[]): void => {
    queryClient.setQueryData<DirectoryData>(multiHostKeys.directory, current =>
      current === undefined ? current : { hosts: nextHosts, runtimes: current.runtimes },
    )
  }
  const reorder = useMutation({
    mutationFn: async (ids: readonly string[]) => {
      const result = await api.hostReorder({ ids: [...ids] })
      return result.hosts
    },
    onSuccess: nextHosts => {
      updateDirectoryHosts(nextHosts)
      setPendingOrder(null)
    },
    onError: () => setPendingOrder(null),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: multiHostKeys.directory }),
  })
  const hide = useMutation({
    mutationFn: (input: { readonly id: string; readonly hidden: boolean }) => api.hostSetHidden(input),
    onSuccess: host =>
      queryClient.setQueryData<DirectoryData>(multiHostKeys.directory, current =>
        current === undefined ? current : { hosts: current.hosts.map(item => (item.id === host.id ? host : item)), runtimes: current.runtimes },
      ),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: multiHostKeys.directory }),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.hostRemove({ id, removeDirectory: true }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: multiHostKeys.all }),
  })
  const addProject = useMutation({
    mutationFn: async (input: { readonly runtimeId: string; readonly path: string }) => {
      const result = await api.runtimeOpenFolder(input)
      if (!result.ok) throw failure(result)
      return result
    },
    onSuccess: () => {
      setProjectRuntimeId(null)
      void queryClient.invalidateQueries({ queryKey: multiHostKeys.all })
    },
  })

  const runtimeFor = (host: HostSummary): RuntimeSummary | undefined => directory.data?.runtimes.find(runtime => runtime.hostId === host.id)
  const hostById = new Map(hosts.map(host => [host.id, host]))
  const order = pendingOrder ?? hosts.map(host => host.id)
  const ordered = order.flatMap(id => {
    const host = hostById.get(id)
    return host === undefined ? [] : [host]
  })
  const commitOrder = (ids: readonly string[]): void => {
    setPendingOrder(ids)
    reorder.mutate(ids)
  }

  const hiddenCount = hosts.filter(host => host.hidden).length
  const retryAlert = (input: { readonly message: string; readonly retry: () => void; readonly label?: string }) => (
    <Alert variant="destructive">
      <AlertDescription className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2">
        <span className="dshx:min-w-0">{input.message}</span>
        <Button size="xs" variant="outline" onClick={input.retry}>
          {input.label ?? 'Try again'}
        </Button>
      </AlertDescription>
    </Alert>
  )

  return (
    <TooltipProvider>
      <Page
        data-testid="dshfiles-hosts-page"
        scroll
        className="dshx:bg-background dshx:text-foreground"
        heading="Hosts"
        description="Machines threads can run on. Hidden hosts keep their records but leave the destination picker."
        meta={
          <Badge variant="secondary" className="dshx:text-[11px] dshx:font-normal">
            {hosts.length === 0 ? 'none' : `${hosts.length} registered`}
            {hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ''}
          </Badge>
        }
        primaryAction={{ id: 'add-host', label: 'Add host', icon: <PlusIcon className="dshx:size-4" />, onSelect: () => setForm(blankDraft) }}
        actions={[
          {
            id: 'update-hosts',
            label: 'Update hosts',
            icon: <RefreshCwIcon className="dshx:size-4" />,
            disabled: hosts.length === 0,
            onSelect: () => setFleetOpen(true),
          },
        ]}
      >
        {directory.isError ? retryAlert({ message: errorMessage(directory.error, 'Hosts are unavailable.'), retry: () => void directory.refetch() }) : null}
        {resourcePool.isError
          ? retryAlert({ message: errorMessage(resourcePool.error, 'Host resources are unavailable.'), retry: () => void resourcePool.refetch() })
          : null}
        {resourcePool.data?.selected === null ? (
          <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:border dshx:px-3 dshx:py-2 dshx:text-sm">
            <span className="dshx:font-medium">Auto destination</span>
            <Badge variant="secondary">Unavailable</Badge>
          </div>
        ) : resourcePool.data?.selected === undefined ? null : (
          <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:border dshx:px-3 dshx:py-2 dshx:text-sm" role="status">
            <span className="dshx:font-medium">Auto destination</span>
            <Badge variant="secondary">{resourcePool.data.selected.hostName}</Badge>
          </div>
        )}
        {hide.isError
          ? retryAlert({
              message: errorMessage(hide.error, 'The host visibility could not be saved.'),
              retry: () => {
                if (hide.variables !== undefined) hide.mutate(hide.variables)
              },
            })
          : null}
        {reorder.isError
          ? retryAlert({
              message: errorMessage(reorder.error, 'The host order could not be saved.'),
              retry: () => {
                if (reorder.variables !== undefined) reorder.mutate(reorder.variables)
              },
            })
          : null}
        {remove.isError
          ? retryAlert({
              message: errorMessage(remove.error, 'The host could not be removed.'),
              retry: () => {
                if (remove.variables !== undefined) remove.mutate(remove.variables)
              },
            })
          : null}
        {addProject.isError
          ? retryAlert({
              message: errorMessage(addProject.error, 'The remote project could not be added.'),
              retry: () => {
                if (addProject.variables !== undefined) addProject.mutate(addProject.variables)
              },
            })
          : null}
        {directory.isPending ? <Spinner aria-label="Loading hosts" /> : null}
        {!directory.isPending && ordered.length === 0 ? (
          <EntityList aria-label="Registered hosts">
            <EmptyState>No hosts yet. Use Add host to register an SSH destination and run threads on another machine.</EmptyState>
          </EntityList>
        ) : (
          <EntityList aria-label="Registered hosts">
            {ordered.map((host, index) => (
              <HostRow
                key={host.id}
                api={api}
                host={host}
                runtime={runtimeFor(host)}
                resource={resourcePool.data?.hosts.find(entry => entry.hostId === host.id)}
                localVersion={localIdentity.data?.dshVersion}
                index={index}
                count={ordered.length}
                dragging={draggedId === host.id}
                dropTarget={dropId === host.id && draggedId !== null && draggedId !== host.id}
                onDragStart={() => setDraggedId(host.id)}
                onDragEnd={() => {
                  setDraggedId(null)
                  setDropId(null)
                }}
                onDragOver={() => setDropId(host.id)}
                onDrop={() => {
                  if (draggedId === null || draggedId === host.id) return
                  const next = moveHostId({ ids: order, id: draggedId, toIndex: index })
                  setDraggedId(null)
                  setDropId(null)
                  if (next !== order) commitOrder(next)
                }}
                onMove={direction => {
                  const next = shiftHostId({ ids: order, id: host.id, direction })
                  if (next !== order) commitOrder(next)
                }}
                onHide={hidden => hide.mutate({ id: host.id, hidden })}
                onAddProject={() => setProjectRuntimeId(runtimeFor(host)?.id ?? null)}
                onCloneProject={() => setCloneRuntimeId(runtimeFor(host)?.id ?? null)}
                onSyncCheckout={() => setSyncHostId(host.id)}
                onEdit={() =>
                  setForm({
                    hostId: host.id,
                    name: host.name,
                    sshTarget: host.connector.kind === 'ssh' ? host.connector.sshTarget : '',
                    remoteHome: runtimeFor(host)?.remoteHome ?? '',
                    weight: host.weight,
                    fetchBeforeThread: host.fetchBeforeThread,
                  })
                }
                onRemove={() => remove.mutate(host.id)}
              />
            ))}
          </EntityList>
        )}
        <CloneProjectDialog
          api={api}
          runtime={directory.data?.runtimes.find(runtime => runtime.id === cloneRuntimeId)}
          hostName={hosts.find(host => directory.data?.runtimes.find(runtime => runtime.id === cloneRuntimeId)?.hostId === host.id)?.name}
          onClose={() => setCloneRuntimeId(null)}
        />
        {projectRuntime !== undefined && projectHost !== undefined ? (
          <ProjectFolderPicker
            projects={[]}
            directoryPicker={remoteDirectoryPicker(api, projectRuntime.id)}
            onRegisterWorkspace={async canonicalPath => {
              const result = await api.runtimeOpenFolder({ runtimeId: projectRuntime.id, path: canonicalPath })
              if (!result.ok) throw failure(result)
              return { workspaceId: result.workspaceId, title: canonicalPath.split('/').filter(Boolean).at(-1) ?? canonicalPath, canonicalPath }
            }}
            onSelect={(selection: ProjectFolderSelection) => addProject.mutate({ runtimeId: projectRuntime.id, path: selection.canonicalPath })}
            onClose={() => setProjectRuntimeId(null)}
            mode="directories"
            disabled={addProject.isPending}
            showNativePicker={false}
            machineName={projectHost.name}
            heading={`Add project · ${projectHost.name}`}
          />
        ) : null}
        <CheckoutSyncDialog api={api} host={hosts.find(host => host.id === syncHostId)} onClose={() => setSyncHostId(null)} />
        <HostDialog api={api} draft={form} onOpenChange={open => (open ? undefined : setForm(null))} />
        <FleetUpdateDialog
          api={api}
          hosts={ordered}
          open={fleetOpen}
          updateRequest={updateRequest}
          onUpdateAll={() => setUpdateRequest(current => current + 1)}
          onOpenChange={setFleetOpen}
        />
      </Page>
    </TooltipProvider>
  )
}
