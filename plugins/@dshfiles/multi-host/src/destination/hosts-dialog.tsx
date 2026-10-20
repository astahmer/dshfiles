import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@dshfiles/plugin-ui/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { CheckIcon, ChevronDownIcon, PencilIcon, PlusIcon, RefreshCwIcon, SearchIcon, ServerIcon, Trash2Icon, XIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import type { ConnectionTestStep, HostSummary, RuntimeSummary } from '../api.js'
import { multiHostKeys, multiHostQueries, type MultiHostClient } from './queries.js'
import { hostDestination, setHostDestination } from './state.js'

type Draft = { readonly hostId?: string; readonly name: string; readonly sshTarget: string; readonly remoteHome: string }

const stepLabels: Record<ConnectionTestStep['step'], string> = { ssh: 'SSH login', runtime: 'DSH runtime', identity: 'multi-host identity' }

const failure = (result: { readonly ok: boolean; readonly code?: string; readonly message?: string }): Error =>
  new Error(result.message === undefined ? 'The host request failed.' : `${result.message}${result.code === undefined ? '' : ` (${result.code})`}`)

/** Status of one host as the chip and the dialog show it. */
export const hostState = (runtime: RuntimeSummary | undefined): { readonly tone: 'online' | 'idle' | 'error'; readonly label: string } => {
  if (runtime === undefined) return { tone: 'error', label: 'No DSH runtime registered' }
  if (runtime.connected) return { tone: 'online', label: 'Connected' }
  if (runtime.lastError !== undefined) return { tone: 'error', label: runtime.lastError.message }
  return { tone: 'idle', label: runtime.lastSeenAt === undefined ? 'Not connected yet' : `Idle · last seen ${new Date(runtime.lastSeenAt).toLocaleString()}` }
}

export const StatusDot = (props: { readonly tone: 'online' | 'idle' | 'error' }) => (
  <span
    aria-hidden
    className={
      props.tone === 'online'
        ? 'dshx:inline-block dshx:size-2 dshx:shrink-0 dshx:rounded-full dshx:bg-emerald-500'
        : props.tone === 'error'
          ? 'dshx:inline-block dshx:size-2 dshx:shrink-0 dshx:rounded-full dshx:bg-destructive'
          : 'dshx:inline-block dshx:size-2 dshx:shrink-0 dshx:rounded-full dshx:bg-muted-foreground/50'
    }
  />
)

const HostForm = (props: { readonly api: MultiHostClient; readonly initial: Draft; readonly onDone: () => void; readonly onCancel: () => void }) => {
  const { api } = props
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft>(props.initial)
  const [targetPickerOpen, setTargetPickerOpen] = useState(false)
  const [customTargetSelected, setCustomTargetSelected] = useState(false)
  const suggestions = useQuery({
    queryKey: multiHostKeys.sshHosts,
    queryFn: ({ signal }) => api.sshConfigHosts(undefined, { signal }),
    staleTime: 60_000,
  })
  const aliases = suggestions.data?.hosts.aliases ?? []
  const knownHosts = suggestions.data?.hosts.knownHosts ?? []
  const known = [...aliases, ...knownHosts]
  const customTargetActive =
    customTargetSelected || (draft.sshTarget !== '' && (suggestions.isSuccess || suggestions.isError) && !known.includes(draft.sshTarget))
  const targetLabel = customTargetActive ? 'Custom SSH destination' : draft.sshTarget || 'Choose an SSH host…'
  const discover = useMutation({
    mutationFn: async () => {
      const result = await api.discoverHomes({ sshTarget: draft.sshTarget.trim() })
      if (!result.ok) throw failure(result)
      return result.homes
    },
    onSuccess: homes => {
      const first = homes[0]
      if (first !== undefined && draft.remoteHome.trim() === '') setDraft(current => ({ ...current, remoteHome: first.path }))
    },
  })
  const test = useMutation({
    mutationFn: async () => {
      const result = await api.testConnection({
        name: draft.name.trim() || draft.sshTarget.trim(),
        sshTarget: draft.sshTarget.trim(),
        remoteHome: draft.remoteHome.trim(),
      })
      if (!result.ok) throw failure(result)
      return result
    },
  })
  const save = useMutation({
    mutationFn: async () => {
      const result = await api.saveSshHost({
        ...(draft.hostId === undefined ? {} : { hostId: draft.hostId }),
        name: draft.name.trim() || draft.sshTarget.trim(),
        sshTarget: draft.sshTarget.trim(),
        remoteHome: draft.remoteHome.trim(),
      })
      if (!result.ok) throw failure(result)
      return result.runtime
    },
    onSuccess: runtime => {
      void queryClient.invalidateQueries({ queryKey: multiHostKeys.all })
      if (draft.hostId === undefined) setHostDestination({ kind: 'runtime', runtimeId: runtime.id })
      props.onDone()
    },
  })
  const ready = draft.sshTarget.trim() !== '' && draft.remoteHome.trim().startsWith('/')
  const busy = discover.isPending || test.isPending || save.isPending

  return (
    <form
      className="dshx:flex dshx:flex-col dshx:gap-3"
      onSubmit={event => {
        event.preventDefault()
        if (ready) save.mutate()
      }}
    >
      <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:text-sm">
        <span className="dshx:font-medium">SSH destination</span>
        <Popover open={targetPickerOpen} onOpenChange={setTargetPickerOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" className="dshx:justify-between dshx:font-normal" aria-label="SSH destination">
              <span className="dshx:min-w-0 dshx:truncate">{targetLabel}</span>
              <ChevronDownIcon className="dshx:ml-2 dshx:size-3.5 dshx:shrink-0 dshx:opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="dshx-root dshx:w-80 dshx:p-0">
            <Command>
              <CommandInput placeholder="Search SSH hosts…" aria-label="Search SSH hosts" />
              <CommandList>
                <CommandEmpty>No matching SSH hosts.</CommandEmpty>
                {aliases.length === 0 ? null : (
                  <CommandGroup heading="SSH config">
                    {aliases.map(alias => (
                      <CommandItem
                        key={alias}
                        value={alias}
                        onSelect={() => {
                          setDraft(current => ({ ...current, sshTarget: alias }))
                          setCustomTargetSelected(false)
                          setTargetPickerOpen(false)
                        }}
                      >
                        <ServerIcon className="dshx:size-3.5" />
                        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{alias}</span>
                        {draft.sshTarget === alias ? <CheckIcon className="dshx:size-3.5" /> : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {knownHosts.length === 0 ? null : (
                  <CommandGroup heading="Known hosts">
                    {knownHosts.map(host => (
                      <CommandItem
                        key={host}
                        value={host}
                        onSelect={() => {
                          setDraft(current => ({ ...current, sshTarget: host }))
                          setCustomTargetSelected(false)
                          setTargetPickerOpen(false)
                        }}
                      >
                        <ServerIcon className="dshx:size-3.5" />
                        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{host}</span>
                        {draft.sshTarget === host ? <CheckIcon className="dshx:size-3.5" /> : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value="custom-ssh-destination"
                    onSelect={() => {
                      setDraft(current => ({ ...current, sshTarget: known.includes(current.sshTarget) ? '' : current.sshTarget }))
                      setCustomTargetSelected(true)
                      setTargetPickerOpen(false)
                    }}
                  >
                    <PlusIcon className="dshx:size-3.5" />
                    Enter a custom destination…
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {customTargetActive ? (
          <Input
            autoFocus
            aria-label="Custom SSH destination"
            placeholder="user@host"
            value={draft.sshTarget}
            onChange={event => setDraft({ ...draft, sshTarget: event.target.value })}
          />
        ) : null}
        <span className="dshx:text-xs dshx:text-muted-foreground">
          Choose an SSH config alias or a known host. Uses your SSH agent and keys (BatchMode); the host key must already be in known_hosts.
        </span>
      </div>
      <label className="dshx:flex dshx:flex-col dshx:gap-1 dshx:text-sm">
        <span className="dshx:font-medium">Name</span>
        <Input placeholder="Raspberry Pi" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />
      </label>
      <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:text-sm">
        <span className="dshx:font-medium">Remote DSH home</span>
        <div className="dshx:flex dshx:gap-2">
          <Input
            placeholder="/home/me/.dsh"
            value={draft.remoteHome}
            onChange={event => setDraft({ ...draft, remoteHome: event.target.value })}
            aria-label="Remote DSH home"
          />
          <Button type="button" variant="outline" disabled={draft.sshTarget.trim() === '' || busy} onClick={() => discover.mutate()}>
            {discover.isPending ? <Spinner className="dshx:size-3.5" /> : <SearchIcon className="dshx:size-3.5" />}
            Find
          </Button>
        </div>
        {discover.data !== undefined ? (
          discover.data.length === 0 ? (
            <span className="dshx:text-xs dshx:text-muted-foreground">
              No running DSH found under the remote home. Start DSH there with @dshfiles/multi-host installed, then Find again.
            </span>
          ) : (
            <div className="dshx:flex dshx:flex-wrap dshx:gap-1">
              {discover.data.map(home => (
                <Button
                  key={home.path}
                  type="button"
                  size="sm"
                  variant={home.path === draft.remoteHome ? 'secondary' : 'ghost'}
                  className="dshx:h-6 dshx:font-mono dshx:text-xs"
                  onClick={() => setDraft({ ...draft, remoteHome: home.path })}
                  title={home.source === 'web-url' ? 'Started through dsh-web; needs @dshfiles/multi-host to be added' : undefined}
                >
                  {home.path}
                </Button>
              ))}
            </div>
          )
        ) : null}
        <span className="dshx:text-xs dshx:text-muted-foreground">
          The DSH_HOME of a running DSH there; it publishes its launch URL in plugins/multi-host/launch.json.
        </span>
      </div>
      {test.data !== undefined ? (
        <ul className="dshx:flex dshx:flex-col dshx:gap-1 dshx:text-xs" aria-label="Connection test">
          {test.data.steps.map(step => (
            <li key={step.step} className="dshx:flex dshx:items-center dshx:gap-2">
              {step.ok ? <CheckIcon className="dshx:size-3.5 dshx:text-emerald-500" /> : <XIcon className="dshx:size-3.5 dshx:text-destructive" />}
              {stepLabels[step.step]} <span className="dshx:text-muted-foreground">{step.ms} ms</span>
            </li>
          ))}
          <li className="dshx:text-muted-foreground">
            DSH {test.data.identity.dshVersion} · profile {test.data.identity.profile}
          </li>
        </ul>
      ) : null}
      {[discover, test, save].map((mutation, index) =>
        mutation.isError ? (
          <Alert key={index} variant="destructive">
            <AlertDescription>{errorMessage(mutation.error, 'The host request failed.')}</AlertDescription>
          </Alert>
        ) : null,
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={props.onCancel} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="button" variant="outline" disabled={!ready || busy} onClick={() => test.mutate()}>
          {test.isPending ? <Spinner className="dshx:size-3.5" /> : null}
          Test connection
        </Button>
        <Button type="submit" disabled={!ready || busy}>
          {save.isPending ? <Spinner className="dshx:size-3.5" /> : null}
          {draft.hostId === undefined ? 'Add host' : 'Save'}
        </Button>
      </DialogFooter>
    </form>
  )
}

const HostRow = (props: {
  readonly api: MultiHostClient
  readonly host: HostSummary
  readonly runtime: RuntimeSummary | undefined
  readonly onEdit: () => void
}) => {
  const { api, host, runtime } = props
  const queryClient = useQueryClient()
  const state = hostState(runtime)
  const reconnect = useMutation({
    mutationFn: async () => {
      if (runtime === undefined) throw new Error('This host has no runtime.')
      const result = await api.runtimeReconnect({ runtimeId: runtime.id })
      if (!result.ok) throw failure(result)
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: multiHostKeys.all }),
  })
  const remove = useMutation({
    mutationFn: () => api.hostRemove({ id: host.id, removeDirectory: true }),
    onSuccess: () => {
      const current = hostDestination.get()
      if (current.kind === 'runtime' && current.runtimeId === runtime?.id) setHostDestination({ kind: 'local' })
      void queryClient.invalidateQueries({ queryKey: multiHostKeys.all })
    },
  })
  const [confirming, setConfirming] = useState(false)
  return (
    <li className="dshx:flex dshx:flex-col dshx:gap-1 dshx:rounded-md dshx:border dshx:p-2">
      <div className="dshx:flex dshx:items-center dshx:gap-2">
        <ServerIcon className="dshx:size-4 dshx:text-muted-foreground" />
        <span className="dshx:font-medium">{host.name}</span>
        <Badge variant="outline" className="dshx:font-mono dshx:text-[11px]">
          {host.connector.kind === 'ssh' ? host.connector.sshTarget : 'this machine'}
        </Badge>
        <span className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-1">
          <Button size="icon" variant="ghost" className="dshx:size-7" title="Reconnect" disabled={reconnect.isPending} onClick={() => reconnect.mutate()}>
            {reconnect.isPending ? <Spinner className="dshx:size-3.5" /> : <RefreshCwIcon className="dshx:size-3.5" />}
          </Button>
          {host.connector.kind === 'ssh' ? (
            <Button size="icon" variant="ghost" className="dshx:size-7" title="Edit" onClick={props.onEdit}>
              <PencilIcon className="dshx:size-3.5" />
            </Button>
          ) : null}
          <Button
            size="icon"
            variant={confirming ? 'destructive' : 'ghost'}
            className="dshx:size-7"
            title={confirming ? 'Click again to remove; remote data stays' : 'Remove'}
            disabled={remove.isPending}
            onClick={() => (confirming ? remove.mutate() : setConfirming(true))}
          >
            <Trash2Icon className="dshx:size-3.5" />
          </Button>
        </span>
      </div>
      <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
        <StatusDot tone={state.tone} />
        <span className="dshx:min-w-0 dshx:truncate" title={state.label}>
          {state.label}
        </span>
        {runtime?.remoteHome === undefined ? null : <span className="dshx:ml-auto dshx:shrink-0 dshx:font-mono">{runtime.remoteHome}</span>}
      </div>
      {reconnect.isError ? <span className="dshx:text-xs dshx:text-destructive">{errorMessage(reconnect.error, 'Reconnect failed.')}</span> : null}
    </li>
  )
}

/** Add, edit, test, reconnect and remove hosts. Opened from the host chip ("Add host…" / "Manage hosts…"). */
export const HostsDialog = (props: {
  readonly api: MultiHostClient
  readonly open: boolean
  readonly adding: boolean
  readonly onOpenChange: (open: boolean) => void
}) => {
  const { api } = props
  const directory = useQuery({ ...multiHostQueries.directory(api, props.open ? 5_000 : false), enabled: props.open })
  const [editing, setEditing] = useState<Draft | null>(null)
  const form = editing ?? (props.adding ? { name: '', sshTarget: '', remoteHome: '' } : null)
  return (
    <Dialog
      open={props.open}
      onOpenChange={open => {
        if (!open) setEditing(null)
        props.onOpenChange(open)
      }}
    >
      <DialogContent className="dshx-root dshx:sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{form === null ? 'Hosts' : form.hostId === undefined ? 'Add host' : 'Edit host'}</DialogTitle>
          <DialogDescription>
            A host is another machine running DSH that this one reaches over SSH. New threads can start there from the host chip.
          </DialogDescription>
        </DialogHeader>
        {form !== null ? (
          <HostForm
            key={form.hostId ?? 'new'}
            api={api}
            initial={form}
            onDone={() => {
              setEditing(null)
              props.onOpenChange(false)
            }}
            onCancel={() => {
              setEditing(null)
              if (props.adding) props.onOpenChange(false)
            }}
          />
        ) : (
          <div className="dshx:flex dshx:flex-col dshx:gap-3">
            {directory.isError ? (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage(directory.error, 'Hosts are unavailable.')}</AlertDescription>
              </Alert>
            ) : null}
            <ul className="dshx:flex dshx:flex-col dshx:gap-2">
              {(directory.data?.hosts ?? []).map(host => {
                const runtime = directory.data?.runtimes.find(item => item.hostId === host.id)
                return (
                  <HostRow
                    key={host.id}
                    api={api}
                    host={host}
                    runtime={runtime}
                    onEdit={() =>
                      setEditing({
                        hostId: host.id,
                        name: host.name,
                        sshTarget: host.connector.kind === 'ssh' ? host.connector.sshTarget : '',
                        remoteHome: runtime?.remoteHome ?? '',
                      })
                    }
                  />
                )
              })}
              {directory.data?.hosts.length === 0 ? <li className="dshx:text-sm dshx:text-muted-foreground">No hosts yet.</li> : null}
            </ul>
            <DialogFooter>
              <Button onClick={() => setEditing({ name: '', sshTarget: '', remoteHome: '' })}>
                <PlusIcon className="dshx:size-3.5" />
                Add host
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
