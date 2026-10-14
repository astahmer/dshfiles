import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ComposerBlocks } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@dshfiles/plugin-ui/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { CheckIcon, GitBranchIcon } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { HostChip, multiHostApi } from '@dshfiles/multi-host/destination'
import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { jjIntegrationApi, threadWorkspaceName } from './api.js'
import type { JjIntegrationTranslate } from './locales.js'
import { workspaceToggleMachine, type SpareWorkspace, type ToggleRequest, type WorkspaceToggleClient } from './workspace-toggle-machine.js'

export interface DestinationBarServices {
  readonly workspaces: IWorkspaces
  readonly sessions: ISessions
  readonly blocks: ComposerBlocks
  readonly openWorkspace: (workspaceId: string) => Promise<void>
  /** Replace the blank thread's composer with the remote one; returns the undo. */
  readonly takeOverComposer: () => () => void
}

/** The host chip leads the native row; `display: contents` lets each chip of the bar be an item of that row. */
export const HostChipSlot = () => (
  <span className="dshx-root dshx:inline-flex dshx:items-center" style={{ order: -1 }}>
    <HostChip api={useApi(multiHostApi)} />
  </span>
)

/**
 * The Host answers a call that registers a workspace before its workspace-list push lands, and the client refuses to
 * open an id it has not seen, so a freshly provisioned workspace is opened only once the list carries it.
 */
export const workspaceListed = (workspaces: IWorkspaces, workspaceId: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const known = (): boolean => workspaces.list.getSnapshot().items.some(item => item.workspaceId === workspaceId)
    if (known()) return resolve()
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`Workspace ${workspaceId} never reached the workspace list.`))
    }, 15_000)
    const unsubscribe = workspaces.list.subscribe(() => {
      if (!known()) return
      clearTimeout(timer)
      unsubscribe()
      resolve()
    })
  })

const noSpares: Readonly<Record<string, SpareWorkspace>> = {}

const storedSpares = createStoredValue({
  key: 'dshfiles-jj-integration.spare-workspaces',
  schema: z.record(z.string(), z.object({ workspaceId: z.string(), name: threadWorkspaceName })),
  fallback: noSpares,
})

const randomThreadName = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(3))
  return `thread-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
}

const threadNameOf = (path: string | undefined): string | null => {
  const name = path?.split('/').at(-1)
  return threadWorkspaceName.safeParse(name).success && name !== undefined ? name : null
}

const useWorkspaceToggle = (services: DestinationBarServices, t: JjIntegrationTranslate) => {
  const api = useApi(jjIntegrationApi)
  const queryClient = useQueryClient()
  const client = useMemo(
    (): WorkspaceToggleClient => ({
      provision: (input, signal) => api.provision(input, { signal }),
      listed: workspaceId => workspaceListed(services.workspaces, workspaceId),
      open: workspaceId => services.openWorkspace(workspaceId),
      findSpare: key => {
        const spare = storedSpares.get()[key]
        if (spare === undefined) return undefined
        const workspace = services.workspaces.list.getSnapshot().items.find(item => item.workspaceId === spare.workspaceId)
        const sessions = services.sessions.list.getSnapshot().byId
        const blank = workspace?.sessionIds.every(sessionId => sessions[sessionId]?.blank === true) ?? false
        return blank ? spare : undefined
      },
      keepSpare: (key, spare) => void storedSpares.set({ ...storedSpares.get(), [key]: spare }),
      blockComposer: reason => {
        const sessions = services.sessions.list.getSnapshot()
        const current = sessions.ids.find(sessionId => (sessions.byId[sessionId]?.retainedBy.mainView ?? 0) > 0)
        if (current === undefined) return () => undefined
        services.blocks.set(current, { reason })
        return () => services.blocks.set(current, undefined)
      },
      generateName: randomThreadName,
      preparingReason: name => (name === null ? t('switchingDestination') : t('preparingWorkspace', { name })),
    }),
    [api, services, t],
  )
  const [snapshot, send, actor] = useMachine(workspaceToggleMachine, { input: { client } })
  useEffect(() => {
    const subscription = actor.on('switched', event => {
      if (event.destination !== undefined) queryClient.setQueryData(['jj-integration', 'destination', event.workspaceId], event.destination)
      else void queryClient.invalidateQueries({ queryKey: ['jj-integration', 'destination', event.workspaceId] })
      void queryClient.invalidateQueries({ queryKey: ['jj-integration', 'repositories'] })
    })
    return () => subscription.unsubscribe()
  }, [actor, queryClient])
  return {
    pending: snapshot.context.pending,
    error: snapshot.context.error,
    busy: snapshot.matches('switching'),
    toggle: (request: ToggleRequest) => send({ type: 'toggle', request }),
  }
}

/**
 * Where a new thread runs on this machine, chosen before its first message: the jj bookmark it starts from and
 * whether it gets its own jj workspace, rendered in the native New thread row beside its project chip after the host chip.
 * The toggle flips at once and names the thread workspace while the Host creates it; the composer waits until it is ready.
 */
export const DestinationBar = (props: {
  readonly workspaceId: string | undefined
  readonly services: DestinationBarServices
  readonly t: JjIntegrationTranslate
}) => {
  const { t, services } = props
  const api = useApi(jjIntegrationApi)
  const [branchOpen, setBranchOpen] = useState(false)
  const workspaceId = props.workspaceId ?? null
  const destination = useQuery({
    queryKey: ['jj-integration', 'destination', workspaceId ?? ''],
    enabled: workspaceId !== null,
    queryFn: ({ signal }) =>
      runHostRequest({ signal, timeoutMs: 30_000, request: hostSignal => api.destination({ workspaceId: workspaceId ?? '' }, { signal: hostSignal }) }),
  })
  const toggle = useWorkspaceToggle(services, t)

  const current = destination.data
  const projectId = current?.projectWorkspaceId ?? workspaceId ?? ''
  const isJj = current?.vcs === 'jj'
  const isolated = toggle.pending?.isolate ?? current?.isolated === true
  const move = (request: { readonly isolate: boolean; readonly base?: string | undefined }): void => {
    const leavingPath =
      current?.isolated === true ? services.workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)?.path : undefined
    const leavingName = threadNameOf(leavingPath)
    toggle.toggle({
      ...request,
      projectWorkspaceId: projectId,
      leaving: workspaceId !== null && leavingName !== null ? { workspaceId, name: leavingName } : null,
      leavingBase: current?.bookmark ?? null,
    })
  }
  const chip = 'dshx:h-7 dshx:gap-1.5 dshx:px-2 dshx:text-sm dshx:font-medium'

  return (
    // display: contents makes each chip an item of the native row, so the host chip can lead it.
    <div className="dshx-root dshx:contents" aria-label={t('destination')}>
      <HostChipSlot />
      {toggle.busy ? (
        // Order 0 keeps it right after the native folder chip, which it stands in for until the switch lands.
        <span
          data-pending=""
          role="status"
          aria-label={toggle.pending?.name ?? t('switchingDestination')}
          className="dshx:inline-flex dshx:h-7 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:bg-muted dshx:px-2 dshx:font-mono! dshx:text-xs dshx:text-muted-foreground"
          style={{ order: 0 }}
        >
          <Spinner className="dshx:size-3.5" />
          {toggle.pending?.name ?? t('switchingDestination')}
        </span>
      ) : null}
      {isJj ? (
        <span className="dshx:inline-flex dshx:items-center dshx:rounded-md">
          <Popover open={branchOpen} onOpenChange={setBranchOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" className={chip} disabled={toggle.busy} title={isolated ? undefined : t('bookmarkIsolates')}>
                <GitBranchIcon className="dshx:size-3.5" />
                {current?.bookmark ?? '—'}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="dshx:w-72 dshx:p-0">
              <Command>
                <CommandInput placeholder={t('searchBookmarks')} />
                <CommandList>
                  <CommandEmpty>{t('noBookmarks')}</CommandEmpty>
                  {(current?.bookmarks ?? []).map(name => (
                    <CommandItem
                      key={name}
                      value={name}
                      onSelect={() => {
                        setBranchOpen(false)
                        move({ isolate: true, base: name })
                      }}
                    >
                      <span className="dshx:flex-1 dshx:truncate">{name}</span>
                      {name === current?.bookmark ? <CheckIcon className="dshx:size-3.5" /> : null}
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <label className="dshx:flex dshx:cursor-pointer dshx:items-center dshx:gap-1.5 dshx:border-l dshx:px-2 dshx:text-sm" title={t('isolateHint')}>
            <Checkbox
              checked={isolated}
              disabled={toggle.busy}
              onCheckedChange={checked => move({ isolate: checked === true, base: current?.bookmark ?? undefined })}
            />
            {t('workspace')}
          </label>
        </span>
      ) : null}
      {toggle.error === null ? null : <span className="dshx:text-xs dshx:text-destructive">{toggle.error}</span>}
    </div>
  )
}
