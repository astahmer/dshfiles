import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Command, CommandGroup, CommandItem, CommandList, CommandSeparator } from '@dshfiles/plugin-ui/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { CheckIcon, ChevronDownIcon, LaptopIcon, PlusIcon, ServerIcon, SettingsIcon } from '@dshfiles/plugin-ui/icons'
import { useQueries, useQuery } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import type { RuntimeSummary } from '../api.js'
import { hostState, HostsDialog, StatusDot } from './hosts-dialog.js'
import { isMultiHostMissing, multiHostQueries, type MultiHostClient } from './queries.js'
import { hostDestination, setHostDestination } from './state.js'

const chipClassName = 'dshx:h-7 dshx:gap-1.5 dshx:px-2 dshx:text-sm dshx:font-medium'

/**
 * The first chip of the new-thread destination bar: where the thread runs. Local, or a registered host with its live
 * status; "Add host…" and "Manage hosts…" open the hosts dialog. A started thread keeps its host, so the bar only
 * appears on a blank thread.
 */
export const HostChip = (props: { readonly api: MultiHostClient; readonly unavailable?: boolean }) => {
  const { api } = props
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<'closed' | 'manage' | 'add'>('closed')
  const destination = hostDestination.useValue()
  const directory = useQuery({ ...multiHostQueries.directory(api, open ? 4_000 : 30_000), enabled: props.unavailable !== true })
  const runtimes = directory.data?.runtimes ?? []
  // Opening the menu connects each host once, so its status is live rather than whatever the last call left behind.
  const pings = useQueries({
    queries: runtimes.map(runtime => ({
      queryKey: ['multi-host', 'ping', runtime.id],
      queryFn: ({ signal }: { readonly signal: AbortSignal }) => api.runtimePing({ runtimeId: runtime.id }, { signal }),
      enabled: open || (destination.kind === 'runtime' && destination.runtimeId === runtime.id),
      refetchInterval: open ? 10_000 : 60_000,
      retry: false,
    })),
  })
  const liveState = (runtime: RuntimeSummary | undefined) => {
    const ping = pings[runtimes.findIndex(item => item.id === runtime?.id)]?.data
    if (ping === undefined) return hostState(runtime)
    return ping.ok ? { tone: 'online' as const, label: `Connected · ${ping.ms} ms` } : { tone: 'error' as const, label: ping.message }
  }
  const selected: RuntimeSummary | undefined = destination.kind === 'runtime' ? runtimes.find(runtime => runtime.id === destination.runtimeId) : undefined
  const selectedHost = directory.data?.hosts.find(host => host.id === selected?.hostId)
  const label = destination.kind === 'local' ? 'Local' : (selectedHost?.name ?? selected?.name ?? 'Unknown host')
  const state = destination.kind === 'runtime' ? liveState(selected) : undefined
  if (isMultiHostMissing(directory.error)) return null

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
                {runtimes.map(runtime => {
                  const host = directory.data?.hosts.find(item => item.id === runtime.hostId)
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
                    setDialog('manage')
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
      <HostsDialog api={api} open={dialog !== 'closed'} adding={dialog === 'add'} onOpenChange={next => setDialog(next ? dialog : 'closed')} />
    </>
  )
}
