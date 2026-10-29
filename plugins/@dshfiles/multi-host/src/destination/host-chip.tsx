import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Command, CommandGroup, CommandItem, CommandList, CommandSeparator } from '@dshfiles/plugin-ui/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { CheckIcon, ChevronDownIcon, LaptopIcon, PlusIcon, ServerIcon, SettingsIcon } from '@dshfiles/plugin-ui/icons'
import { queryOptions, useQueries, useQuery } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import type { RuntimeSummary } from '../api.js'
import { HostDialog, hostState, StatusDot } from './hosts-dialog.js'
import { CloneProjectDialog } from './clone-project-dialog.js'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { runtimePingRefetchInterval } from '../runtime-status-refresh-policy.js'
import { multiHostQueries, type MultiHostClient } from './queries.js'
import { hostDestination, openHostsPage, setHostDestination } from './state.js'

const chipClassName = 'dshx:h-7 dshx:gap-1.5 dshx:px-2 dshx:text-sm dshx:font-medium'

/**
 * The first chip of the new-thread destination bar: where the thread runs. Local, or a visible registered host with
 * its live status; "Add host…" opens the add dialog and "Manage hosts…" the dedicated Hosts page. A started thread
 * keeps its host, so the bar only appears on a blank thread.
 */
export const HostChip = (props: { readonly api: MultiHostClient; readonly unavailable?: boolean; readonly localProjectPath?: string | undefined }) => {
  const { api } = props
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<'closed' | 'add'>('closed')
  const [cloneRuntimeId, setCloneRuntimeId] = useState<string | null>(null)
  const destination = hostDestination.useValue()
  const directory = useQuery({ ...multiHostQueries.directory(api, open ? 4_000 : 30_000), enabled: props.unavailable !== true })
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
  const liveState = (runtime: RuntimeSummary | undefined) => {
    const ping = pings[pickable.findIndex(item => item.id === runtime?.id)]?.data
    if (ping === undefined) return hostState(runtime)
    return ping.ok ? { tone: 'online' as const, label: `Connected · ${ping.ms} ms` } : { tone: 'error' as const, label: ping.message }
  }
  const selectedHost = hosts.find(host => host.id === selected?.hostId)
  const label = destination.kind === 'local' ? 'Local' : (selectedHost?.name ?? selected?.name ?? 'Unknown host')
  const state = destination.kind === 'runtime' ? liveState(selected) : undefined
  if (isApiOwnerMissing(directory.error)) return null

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" className={chipClassName} aria-label={`Run on ${label}`} title={state?.label}>
            {destination.kind === 'local' ? <LaptopIcon className="dshx:size-3.5" /> : <ServerIcon className="dshx:size-3.5" />}
            {label}
            {state === undefined ? null : <StatusDot tone={state.tone} />}
            <ChevronDownIcon className="dshx:size-3 dshx:opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="dshx:w-72 dshx:p-0">
          <Command>
            <CommandList>
              <CommandGroup heading="Run on">
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
                {pickable.map(runtime => {
                  const host = hosts.find(item => item.id === runtime.hostId)
                  const runtimeState = liveState(runtime)
                  return (
                    <CommandItem
                      key={runtime.id}
                      value={`host-${runtime.id}`}
                      onSelect={() => {
                        setHostDestination({ kind: 'runtime', runtimeId: runtime.id })
                        setOpen(false)
                      }}
                    >
                      <ServerIcon className="dshx:size-3.5" />
                      <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                        <span className="dshx:truncate">{host?.name ?? runtime.name}</span>
                        <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground" title={runtimeState.label}>
                          {host?.connector.kind === 'ssh' ? host.connector.sshTarget : 'this machine'} · {runtimeState.label}
                        </span>
                      </span>
                      <StatusDot tone={runtimeState.tone} />
                      {destination.kind === 'runtime' && destination.runtimeId === runtime.id ? <CheckIcon className="dshx:size-3.5" /> : null}
                    </CommandItem>
                  )
                })}
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
