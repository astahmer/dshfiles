import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Command, CommandGroup, CommandItem, CommandList, CommandSeparator } from '@dshfiles/plugin-ui/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { CheckIcon, ChevronDownIcon, LaptopIcon, PlusIcon, SearchIcon, ServerIcon, SettingsIcon, SparklesIcon } from '@dshfiles/plugin-ui/icons'
import { queryOptions, useQueries, useQuery } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import type { HostSummary, RuntimeSummary } from '../api.js'
import { HostDialog, hostState, StatusDot } from './hosts-dialog.js'
import { ConnectionDiagnostics } from './connection-diagnostics.js'
import { CloneProjectDialog } from './clone-project-dialog.js'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { runtimePingRefetchInterval } from '../runtime-status-refresh-policy.js'
import { DisconnectGrace } from './disconnect-grace.js'
import { hostTargetLabel } from './host-target.js'
import { InventoryPoll } from './inventory-poll.js'
import { multiHostQueries, type MultiHostClient } from './queries.js'
import { hostDestination, openHostsPage, setHostDestination } from './state.js'

const chipClassName = 'dshx:h-7 dshx:gap-1.5 dshx:px-2 dshx:text-sm dshx:font-medium'

const HostMenuRow = (props: {
  readonly host: HostSummary | undefined
  readonly runtime: RuntimeSummary
  readonly state: ReturnType<typeof hostState>
  readonly selected: boolean
  readonly onSelect: () => void
}) => {
  const state = DisconnectGrace.use(props.state)
  return (
    <CommandItem value={`host-${props.runtime.id}`} onSelect={props.onSelect}>
      <ServerIcon className="dshx:size-3.5" />
      <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
        <span className="dshx:truncate">{props.host?.name ?? props.runtime.name}</span>
        <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground" title={state.label}>
          {props.host === undefined ? 'this machine' : hostTargetLabel(props.host)} · {state.label}
        </span>
      </span>
      <StatusDot tone={state.tone} />
      {props.selected ? <CheckIcon className="dshx:size-3.5" /> : null}
    </CommandItem>
  )
}

/**
 * The first chip of the new-thread destination bar: where the thread runs. Auto chooses a visible remote host with
 * the least resource pressure; Local and concrete hosts remain available. "Add host…" opens the add dialog and
 * "Manage hosts…" opens the Hosts page. A started thread keeps its host, so the bar only appears on a blank thread.
 */
export const HostChip = (props: { readonly api: MultiHostClient; readonly unavailable?: boolean; readonly localProjectPath?: string | undefined }) => {
  const { api } = props
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<'closed' | 'add'>('closed')
  const [cloneRuntimeId, setCloneRuntimeId] = useState<string | null>(null)
  const destination = hostDestination.useValue()
  const closedInterval = InventoryPoll.use(30_000)
  const directory = useQuery({ ...multiHostQueries.directory(api, open ? 4_000 : closedInterval), enabled: props.unavailable !== true })
  const resourcePool = useQuery({ ...multiHostQueries.resourcePool(api, open ? 5_000 : false), enabled: open && props.unavailable !== true })
  const hosts = directory.data?.hosts ?? []
  const runtimes = directory.data?.runtimes ?? []
  const selected: RuntimeSummary | undefined = destination.kind === 'runtime' ? runtimes.find(runtime => runtime.id === destination.runtimeId) : undefined
  // Hidden hosts leave the picker; the one already selected stays so the chip never loses its own destination.
  // The page's host order wins over the directory's runtime-id order.
  const hostOrder = new Map(hosts.map((host, index) => [host.id, index]))
  const pickable = runtimes
    .filter(runtime => {
      if (selected !== undefined && runtime.id === selected.id) return true
      return hosts.find(host => host.id === runtime.hostId)?.hidden !== true
    })
    .sort((left, right) => (hostOrder.get(left.hostId) ?? 0) - (hostOrder.get(right.hostId) ?? 0))
  const cloneTargets = pickable.filter(runtime => hosts.find(host => host.id === runtime.hostId)?.connector.kind === 'ssh')
  // Reuse a recent ping for quick menu toggles, and stop probing an unavailable runtime every ten seconds.
  const pings = useQueries({
    queries: pickable.map(runtime =>
      queryOptions({
        queryKey: ['multi-host', 'ping', runtime.id],
        queryFn: ({ signal }) => api.runtimePing({ runtimeId: runtime.id }, { signal }),
        enabled: open || (destination.kind === 'runtime' && destination.runtimeId === runtime.id),
        staleTime: 15_000,
        refetchInterval: query => runtimePingRefetchInterval({ menuOpen: open, available: query.state.data?.ok }),
        retry: false,
      }),
    ),
  })
  // A failed ping only carries the runtime's last error; the stepwise test that Diagnose runs names the hop that broke.
  const hops = useQueries({
    queries: pickable.map((runtime, index) => {
      const host = hosts.find(item => item.id === runtime.hostId)
      const sshTarget = host?.connector.kind === 'ssh' ? host.connector.sshTarget : undefined
      return queryOptions({
        queryKey: ['multi-host', 'hop', runtime.id, sshTarget, runtime.remoteHome],
        queryFn: () => api.testConnection({ name: host?.name ?? runtime.name, sshTarget: sshTarget ?? '', remoteHome: runtime.remoteHome ?? '' }),
        enabled: pings[index]?.data?.ok === false && sshTarget !== undefined && runtime.remoteHome !== undefined,
        staleTime: 60_000,
        retry: false,
      })
    }),
  })
  const failedHop = (runtime: RuntimeSummary | undefined) => {
    const index = pickable.findIndex(item => item.id === runtime?.id)
    if (pings[index]?.data?.ok !== false) return undefined
    return ConnectionDiagnostics.failedHop(hops[index]?.data?.steps)
  }
  const liveState = (runtime: RuntimeSummary | undefined) => {
    const ping = pings[pickable.findIndex(item => item.id === runtime?.id)]?.data
    if (ping === undefined) return hostState(runtime)
    if (ping.ok) return { tone: 'online' as const, label: `Connected · ${ping.ms} ms` }
    return { tone: 'error' as const, label: failedHop(runtime)?.label ?? ping.message }
  }
  const failing = pickable.flatMap((runtime, index) => {
    const hop = failedHop(runtime)
    if (hop === undefined) return []
    return [{ runtime, failure: hop, name: hosts.find(host => host.id === runtime.hostId)?.name ?? runtime.name, hop: hops[index], ping: pings[index] }]
  })
  const selectedHop = failedHop(selected)
  const selectedHost = hosts.find(host => host.id === selected?.hostId)
  const label = destination.kind === 'local' ? 'Local' : (selectedHost?.name ?? selected?.name ?? 'Unknown host')
  const rawState = destination.kind === 'runtime' ? liveState(selected) : undefined
  const graceState = DisconnectGrace.use(rawState ?? { tone: 'idle', label: '' })
  const state = rawState === undefined ? undefined : graceState
  if (isApiOwnerMissing(directory.error)) return null

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <TooltipProvider delayDuration={400}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" className={chipClassName} aria-label={`Run on ${label}`} data-run-segment="host" data-host-kind={destination.kind}>
                  {destination.kind === 'local' ? <LaptopIcon className="dshx:size-3.5" /> : <ServerIcon className="dshx:size-3.5" />}
                  {label}
                  {state === undefined ? null : <StatusDot tone={state.tone} />}
                  <ChevronDownIcon className="dshx:size-3 dshx:opacity-60" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent className="dshx:max-w-72">
              Host: the machine this thread runs on. Local is this computer; a remote host runs it over SSH.
              {state === undefined ? null : ` ${state.label}.`}
              {selectedHop === undefined ? null : ` ${selectedHop.recovery}`}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <PopoverContent align="start" className="dshx:w-72 dshx:p-0">
          <Command>
            <CommandList>
              <CommandGroup heading="Run on">
                <CommandItem
                  value="auto"
                  disabled={resourcePool.data?.selected === null || resourcePool.data === undefined}
                  onSelect={() => {
                    const selected = resourcePool.data?.selected
                    if (selected === null || selected === undefined) return
                    setHostDestination({ kind: 'runtime', runtimeId: selected.runtimeId })
                    setOpen(false)
                  }}
                >
                  <SparklesIcon className="dshx:size-3.5" />
                  <span className="dshx:flex-1">Auto</span>
                  <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
                    {resourcePool.data?.selected?.hostName ??
                      (resourcePool.isFetching || resourcePool.data?.hosts.some(host => host.refreshing) === true ? 'Updating…' : 'Unavailable')}
                  </span>
                </CommandItem>
                <CommandItem
                  value="local"
                  onSelect={() => {
                    setHostDestination({ kind: 'local' })
                    setOpen(false)
                  }}
                >
                  <LaptopIcon className="dshx:size-3.5" />
                  <span className="dshx:flex-1">Local</span>
                  {destination.kind === 'local' ? <CheckIcon className="dshx:size-3.5" /> : null}
                </CommandItem>
                {pickable.map(runtime => (
                  <HostMenuRow
                    key={runtime.id}
                    host={hosts.find(item => item.id === runtime.hostId)}
                    runtime={runtime}
                    state={liveState(runtime)}
                    selected={destination.kind === 'runtime' && destination.runtimeId === runtime.id}
                    onSelect={() => {
                      setHostDestination({ kind: 'runtime', runtimeId: runtime.id })
                      setOpen(false)
                    }}
                  />
                ))}
              </CommandGroup>
              {cloneTargets.length > 0 ? (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Add project to another machine">
                    {cloneTargets.map(runtime => {
                      const host = hosts.find(item => item.id === runtime.hostId)
                      return (
                        <CommandItem
                          key={`add-project-${runtime.id}`}
                          value={`add-project-${runtime.id}`}
                          onSelect={() => {
                            setOpen(false)
                            setCloneRuntimeId(runtime.id)
                          }}
                        >
                          <PlusIcon className="dshx:size-3.5" />
                          {host?.name ?? runtime.name}
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                </>
              ) : null}
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  value="add-host"
                  onSelect={() => {
                    setOpen(false)
                    setDialog('add')
                  }}
                >
                  <PlusIcon className="dshx:size-3.5" />
                  Add host…
                </CommandItem>
                <CommandItem
                  value="manage-hosts"
                  onSelect={() => {
                    setOpen(false)
                    openHostsPage()
                  }}
                >
                  <SettingsIcon className="dshx:size-3.5" />
                  Manage hosts…
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
          {open && failing.length > 0 ? (
            <ul className="dshx:flex dshx:flex-col dshx:gap-1 dshx:border-t dshx:border-border dshx:px-3 dshx:py-2 dshx:text-xs" aria-label="Host recovery">
              {failing.map(item => (
                <li key={item.runtime.id} className="dshx:flex dshx:items-center dshx:gap-2">
                  <span className="dshx:min-w-0 dshx:flex-1 dshx:text-muted-foreground">
                    <span className="dshx:font-medium dshx:text-foreground">{item.name}</span>: {item.failure.recovery}
                  </span>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    aria-label={`Diagnose ${item.name}`}
                    disabled={item.hop?.isFetching === true}
                    onClick={() => {
                      void item.hop?.refetch()
                      void item.ping?.refetch()
                    }}
                  >
                    <SearchIcon className="dshx:size-3.5" />
                    Diagnose
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {directory.isError ? (
            <p className="dshx:px-3 dshx:pb-2 dshx:text-xs dshx:text-destructive">Hosts are unavailable: the multi-host plugin did not answer.</p>
          ) : null}
        </PopoverContent>
      </Popover>
      <CloneProjectDialog
        api={api}
        runtime={runtimes.find(runtime => runtime.id === cloneRuntimeId)}
        hostName={hosts.find(host => runtimes.find(runtime => runtime.id === cloneRuntimeId)?.hostId === host.id)?.name}
        localProjectPath={props.localProjectPath}
        onClose={() => setCloneRuntimeId(null)}
      />
      <HostDialog
        api={api}
        draft={dialog === 'add' ? { name: '', sshTarget: '', remoteHome: '' } : null}
        onOpenChange={open => setDialog(open ? 'add' : 'closed')}
      />
    </>
  )
}
