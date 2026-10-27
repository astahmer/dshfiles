import { useApi } from '@dshfiles/dshx/client'
import { ProjectFolderPicker, type ProjectFolderSelection } from '@dshfiles/project-folder-picker'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  EyeIcon,
  EyeOffIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  ServerIcon,
  Trash2Icon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import { multiHostApi, type HostSummary, type RuntimeSummary } from '../api.js'
import { remoteDirectoryPicker } from './remote-folders.js'
import { HostDialog, hostState, StatusDot, type HostDraft } from './hosts-dialog.js'
import { moveHostId, shiftHostId } from './host-order.js'
import { CloneProjectDialog } from './clone-project-dialog.js'
import { multiHostKeys, multiHostQueries, type MultiHostClient } from './queries.js'

type DirectoryData = { readonly hosts: readonly HostSummary[]; readonly runtimes: readonly RuntimeSummary[] }

const blankDraft: HostDraft = { name: '', sshTarget: '', remoteHome: '' }

const failure = (result: { readonly ok: boolean; readonly code?: string; readonly message?: string }): Error =>
  new Error(result.message === undefined ? 'The host request failed.' : `${result.message}${result.code === undefined ? '' : ` (${result.code})`}`)

const HostRow = (props: {
  readonly api: MultiHostClient
  readonly host: HostSummary
  readonly runtime: RuntimeSummary | undefined
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
  readonly onRemove: () => void
}) => {
  const { api, host, runtime } = props
  const queryClient = useQueryClient()
  const state = hostState(runtime)
  const [confirming, setConfirming] = useState(false)
  const reconnect = useMutation({
    mutationFn: async () => {
      if (runtime === undefined) throw new Error('This host has no runtime.')
      const result = await api.runtimeReconnect({ runtimeId: runtime.id })
      if (!result.ok) throw failure(result)
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: multiHostKeys.all }),
  })
  return (
    <li
      data-testid={`host-row-${host.id}`}
      className={cn(
        'dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-start dshx:gap-2 dshx:rounded-lg dshx:border dshx:bg-background dshx:p-3',
        props.dragging && 'dshx:opacity-50',
        props.dropTarget && 'dshx:border-primary dshx:ring-2 dshx:ring-primary/30',
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
    >
      <button
        type="button"
        draggable
        aria-label={`Reorder ${host.name}`}
        title="Drag to reorder"
        className="dshx:mt-0.5 dshx:flex dshx:size-6 dshx:shrink-0 dshx:cursor-grab dshx:items-center dshx:justify-center dshx:rounded dshx:border-0 dshx:bg-transparent dshx:text-muted-foreground dshx:hover:bg-accent active:dshx:cursor-grabbing"
        onDragStart={event => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', host.id)
          props.onDragStart()
        }}
        onDragEnd={props.onDragEnd}
      >
        <GripVerticalIcon className="dshx:size-4" />
      </button>
      <div className="dshx:flex dshx:min-w-0 dshx:basis-40 dshx:flex-1 dshx:flex-col dshx:gap-1">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-2">
          <ServerIcon className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
          <span className={cn('dshx:min-w-0 dshx:truncate dshx:font-medium', host.hidden && 'dshx:text-muted-foreground')}>{host.name}</span>
          <Badge variant="outline" className="dshx:shrink-0 dshx:font-mono dshx:text-[11px]">
            {host.connector.kind === 'ssh' ? host.connector.sshTarget : 'this machine'}
          </Badge>
          {host.hidden ? (
            <Badge variant="secondary" className="dshx:shrink-0 dshx:text-[10px]">
              Hidden
            </Badge>
          ) : null}
        </div>
        <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
          <StatusDot tone={state.tone} />
          <span className="dshx:min-w-0 dshx:truncate" title={state.label}>
            {state.label}
          </span>
          {runtime?.remoteHome === undefined ? null : (
            <span className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:@max-pane-compact:hidden">{runtime.remoteHome}</span>
          )}
        </div>
        {reconnect.isError ? <span className="dshx:text-xs dshx:text-destructive">{errorMessage(reconnect.error, 'Reconnect failed.')}</span> : null}
      </div>
      <div className="dshx:ml-auto dshx:flex dshx:shrink-0 dshx:flex-wrap dshx:items-center dshx:justify-end dshx:gap-1 dshx:@max-pane-compact:ml-0 dshx:@max-pane-compact:basis-full">
        <Button
          size="icon"
          variant="ghost"
          className="dshx:size-7"
          aria-label={`Move ${host.name} up`}
          title="Move up"
          disabled={props.index === 0}
          onClick={() => props.onMove('up')}
        >
          <ChevronUpIcon className="dshx:size-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="dshx:size-7"
          aria-label={`Move ${host.name} down`}
          title="Move down"
          disabled={props.index === props.count - 1}
          onClick={() => props.onMove('down')}
        >
          <ChevronDownIcon className="dshx:size-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="dshx:size-7"
          aria-label={host.hidden ? `Show ${host.name}` : `Hide ${host.name}`}
          title={host.hidden ? 'Show in the destination picker' : 'Hide from the destination picker; keeps its records'}
          onClick={() => props.onHide(!host.hidden)}
        >
          {host.hidden ? <EyeOffIcon className="dshx:size-3.5" /> : <EyeIcon className="dshx:size-3.5" />}
        </Button>
        {host.connector.kind === 'ssh' ? (
          <>
            <Button size="sm" variant="outline" disabled={runtime === undefined} onClick={props.onAddProject}>
              <PlusIcon className="dshx:size-3.5" />
              Add folder
            </Button>
            <Button size="sm" variant="outline" disabled={runtime === undefined} onClick={props.onCloneProject}>
              <PlusIcon className="dshx:size-3.5" />
              Clone project
            </Button>
          </>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          className="dshx:size-7"
          aria-label={`Reconnect ${host.name}`}
          title="Reconnect"
          disabled={runtime === undefined || reconnect.isPending}
          onClick={() => reconnect.mutate()}
        >
          {reconnect.isPending ? <Spinner className="dshx:size-3.5" /> : <RefreshCwIcon className="dshx:size-3.5" />}
        </Button>
        {host.connector.kind === 'ssh' ? (
          <Button size="icon" variant="ghost" className="dshx:size-7" aria-label={`Edit ${host.name}`} title="Edit" onClick={props.onEdit}>
            <PencilIcon className="dshx:size-3.5" />
          </Button>
        ) : null}
        <Button
          size="icon"
          variant={confirming ? 'destructive' : 'ghost'}
          className="dshx:size-7"
          aria-label={confirming ? `Confirm remove ${host.name}` : `Remove ${host.name}`}
          title={confirming ? 'Click again to remove; remote data stays' : 'Remove'}
          onClick={() => (confirming ? props.onRemove() : setConfirming(true))}
        >
          <Trash2Icon className="dshx:size-3.5" />
        </Button>
      </div>
    </li>
  )
}

/** The dedicated hosts page: manage, hide and reorder every registered host without opening a dialog. */
export const HostsPage = () => {
  const api = useApi(multiHostApi)
  const queryClient = useQueryClient()
  const directory = useQuery(multiHostQueries.directory(api, 15_000))
  const hosts = directory.data?.hosts ?? []
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  const [pendingOrder, setPendingOrder] = useState<readonly string[] | null>(null)
  const [form, setForm] = useState<HostDraft | null>(null)
  const [projectRuntimeId, setProjectRuntimeId] = useState<string | null>(null)
  const [cloneRuntimeId, setCloneRuntimeId] = useState<string | null>(null)
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

  return (
    <main
      data-testid="dshfiles-hosts-page"
      className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:bg-background dshx:text-foreground"
    >
      <header className="dshx:flex dshx:items-start dshx:gap-3 dshx:px-5 dshx:pt-5 dshx:pb-3 dshx:@max-pane-narrow:px-3 dshx:@max-pane-narrow:pt-3">
        <div className="dshx:flex dshx:size-11 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-2xl dshx:bg-primary/10 dshx:text-primary dshx:ring-1 dshx:ring-primary/15 dshx:@max-pane-narrow:hidden">
          <ServerIcon className="dshx:size-6" />
        </div>
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
          <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-2">
            <h1 className="dshx:text-xl dshx:font-semibold dshx:leading-tight">Hosts</h1>
            <Badge variant="outline" className="dshx:border-transparent dshx:bg-muted dshx:text-[10px] dshx:text-muted-foreground">
              {hosts.length === 0 ? 'none' : `${hosts.length} registered`}
              {hosts.some(host => host.hidden) ? ` · ${hosts.filter(host => host.hidden).length} hidden` : ''}
            </Badge>
            <Button size="sm" className="dshx:ml-auto" onClick={() => setForm(blankDraft)}>
              <PlusIcon className="dshx:size-4" />
              Add host
            </Button>
          </div>
          <p className="dshx:text-xs dshx:text-muted-foreground">
            Every machine this one can run threads on. Drag a row (or use the arrows) to set the order of the destination picker; hidden hosts keep their
            runtimes and threads.
          </p>
        </div>
      </header>
      <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:gap-3 dshx:overflow-y-auto dshx:px-5 dshx:pb-6">
        {directory.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(directory.error, 'Hosts are unavailable.')}</AlertDescription>
          </Alert>
        ) : null}
        {hide.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(hide.error, 'The host visibility could not be saved.')}</AlertDescription>
          </Alert>
        ) : null}
        {reorder.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(reorder.error, 'The host order could not be saved.')}</AlertDescription>
          </Alert>
        ) : null}
        {remove.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(remove.error, 'The host could not be removed.')}</AlertDescription>
          </Alert>
        ) : null}
        {addProject.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(addProject.error, 'The remote project could not be added.')}</AlertDescription>
          </Alert>
        ) : null}
        {directory.isPending ? <Spinner aria-label="Loading hosts" /> : null}
        {!directory.isPending && ordered.length === 0 ? (
          <p className="dshx:rounded-lg dshx:border dshx:border-dashed dshx:p-6 dshx:text-center dshx:text-sm dshx:text-muted-foreground">
            No hosts yet. Add an SSH destination to run threads on another machine.
          </p>
        ) : null}
        <ul className="dshx:flex dshx:flex-col dshx:gap-2" aria-label="Registered hosts">
          {ordered.map((host, index) => (
            <HostRow
              key={host.id}
              api={api}
              host={host}
              runtime={runtimeFor(host)}
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
              onEdit={() =>
                setForm({
                  hostId: host.id,
                  name: host.name,
                  sshTarget: host.connector.kind === 'ssh' ? host.connector.sshTarget : '',
                  remoteHome: runtimeFor(host)?.remoteHome ?? '',
                })
              }
              onRemove={() => remove.mutate(host.id)}
            />
          ))}
        </ul>
      </div>
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
      <HostDialog api={api} draft={form} onOpenChange={open => (open ? undefined : setForm(null))} />
    </main>
  )
}
