import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@dshfiles/plugin-ui/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { CheckIcon, GitBranchIcon } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { createActor, useSelector, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'
import { useQuery, type QueryClient } from '@dshfiles/plugin-ui/query'
import { useApi, useSettings } from '@dshfiles/dshx/client'
import { HostChip, multiHostApi } from '@dshfiles/multi-host/destination'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { z } from 'zod'
import { jjIntegrationApi, threadWorkspaceName } from './api.js'
import type { JjIntegrationTranslate } from './locales.js'
import { mainViewSessionId, mainViewSessionVisitId } from './main-view-session.js'
import { resolveNewThreadWorkspaceId } from './new-thread-workspace.js'
import { workspaceHasOtherSession } from './thread-session-ownership.js'
import { jjIntegrationSettings } from './settings.js'
import {
  defaultDestinationMove,
  eagerDestinationMove,
  workspaceToggleMachine,
  type ProvisionedDestination,
  type ProvisionInput,
  type SpareWorkspace,
  type ToggleRequest,
  type WorkspaceToggleClient,
} from './workspace-toggle-machine.js'

export type WorkspaceToggleActor = ActorRefFrom<typeof workspaceToggleMachine>

export interface DestinationBarServices {
  readonly workspaces: IWorkspaces
  readonly sessions: ISessions
  readonly openWorkspace: (workspaceId: string, signal: AbortSignal) => Promise<void>
  readonly pickWorkspace: (workspaceId: string) => boolean
  readonly bindWorkspacePicker: (pick: (workspaceId: string) => void) => () => void
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

/**
 * The workspace toggle outlives the New-thread screen: opening the new destination remounts it, and a per-mount
 * machine would forget the thread it just moved and move it again. The plugin starts one actor in its setup.
 */
export const startWorkspaceToggle = (input: {
  readonly provision: (input: ProvisionInput, options: { readonly signal: AbortSignal }) => Promise<ProvisionedDestination>
  readonly services: DestinationBarServices
  readonly t: JjIntegrationTranslate
  readonly queryClient: QueryClient
}): WorkspaceToggleActor => {
  const { services, t, queryClient } = input
  const client: WorkspaceToggleClient = {
    provision: (provisionInput, signal) => input.provision(provisionInput, { signal }),
    listed: workspaceId => workspaceListed(services.workspaces, workspaceId),
    open: (workspaceId, signal) => services.openWorkspace(workspaceId, signal),
    findSpare: key => {
      const spare = storedSpares.get()[key]
      if (spare === undefined) return undefined
      const workspace = services.workspaces.list.getSnapshot().items.find(item => item.workspaceId === spare.workspaceId)
      const sessions = services.sessions.list.getSnapshot().byId
      const blankAndExclusive =
        workspace !== undefined && workspace.sessionIds.length === 1 && workspace.sessionIds.every(sessionId => sessions[sessionId]?.blank === true)
      return blankAndExclusive ? spare : undefined
    },
    keepSpare: (key, spare) => void storedSpares.set({ ...storedSpares.get(), [key]: spare }),
    consumeSpare: (key, spare) => {
      const stored = storedSpares.get()
      if (stored[key]?.workspaceId !== spare.workspaceId) return
      const next = { ...stored }
      delete next[key]
      void storedSpares.set(next)
    },
    generateName: randomThreadName,
    preparationTimeoutReason: () => t('workspacePreparationTimedOut'),
  }
  const actor = createActor(workspaceToggleMachine, { input: { client } })
  actor.on('switched', event => {
    void queryClient.invalidateQueries({ queryKey: ['jj-integration', 'destination', event.workspaceId] })
    void queryClient.invalidateQueries({ queryKey: ['jj-integration', 'repositories'] })
  })
  return actor.start()
}

const useWorkspaceToggle = (actor: WorkspaceToggleActor) => {
  const pending = useSelector(actor, snapshot => snapshot.context.pending)
  const error = useSelector(actor, snapshot => snapshot.context.error)
  const busy = useSelector(actor, snapshot => !snapshot.matches('idle'))
  const events = useMemo(
    () => ({
      toggle: (request: ToggleRequest, visitId: string | undefined) => actor.send({ type: 'toggle', request, visitId }),
      arrive: (input: { readonly visitId: string; readonly workspaceId: string; readonly isolateByDefault: boolean }) =>
        actor.send({ type: 'arrive', ...input }),
      resolved: (visitId: string, request: ToggleRequest | null) => actor.send({ type: 'resolved', visitId, request }),
    }),
    [actor],
  )
  return { ...events, pending, error, busy }
}

/** The selected main-view Session and its workspace; only a blank Session can drive New-thread moves. */
const useComposerWorkspace = (services: DestinationBarServices, selectedWorkspaceId: string | undefined) => {
  // Read each store through the service on every call, as the rest of this file does; a detached store loses its owner.
  const sessions = useSyncExternalStore(
    useCallback((listener: () => void) => services.sessions.list.subscribe(listener), [services]),
    useCallback(() => services.sessions.list.getSnapshot(), [services]),
  )
  const workspaces = useSyncExternalStore(
    useCallback((listener: () => void) => services.workspaces.list.subscribe(listener), [services]),
    useCallback(() => services.workspaces.list.getSnapshot(), [services]),
  )
  const sessionId = mainViewSessionId(sessions)
  const session = sessionId === undefined ? undefined : sessions.byId[sessionId]
  if (session === undefined) return null
  const workspaceId = resolveNewThreadWorkspaceId({
    selectedWorkspaceId,
    sessionId: session.id,
    sessionCwd: session.cwd,
    workspaces: workspaces.items,
  })
  if (workspaceId === undefined) return null
  const workspace = workspaces.items.find(item => item.workspaceId === workspaceId)
  const occupied = session.blank && workspaceHasOtherSession({ sessionId: session.id, workspaceSessionIds: workspace?.sessionIds })
  return {
    sessionId: session.blank ? session.id : undefined,
    visitId: mainViewSessionVisitId(session.id),
    workspaceId,
    occupied: session.blank ? occupied : true,
    path: workspace?.path ?? session.cwd,
  }
}

/**
 * Where a new thread runs on this machine, chosen before its first message: the jj bookmark it starts from and
 * whether it gets its own jj workspace, rendered in the native New thread row beside its project chip after the host chip.
 * The toggle flips at once and names the thread workspace while the Host creates it; a Send waits only if submitted before it is ready.
 */
export const DestinationBar = (props: {
  readonly workspaceId: string | undefined
  readonly services: DestinationBarServices
  readonly toggle: WorkspaceToggleActor
  readonly t: JjIntegrationTranslate
}) => {
  const { t, services } = props
  const api = useApi(jjIntegrationApi)
  const [branchOpen, setBranchOpen] = useState(false)
  const toggle = useWorkspaceToggle(props.toggle)
  const composerWorkspace = useComposerWorkspace(services, props.workspaceId)
  const workspaceId = props.workspaceId ?? composerWorkspace?.workspaceId ?? null
  const destination = useQuery({
    queryKey: ['jj-integration', 'destination', workspaceId ?? '', composerWorkspace?.sessionId ?? ''],
    // While a new thread is moving, the destination it leaves does not matter; asking would only slow jj down.
    enabled: workspaceId !== null && !toggle.busy,
    queryFn: async ({ signal }) => {
      const input =
        composerWorkspace?.sessionId === undefined
          ? { workspaceId: workspaceId ?? '' }
          : { workspaceId: workspaceId ?? '', sessionId: composerWorkspace.sessionId }
      try {
        return await runHostRequest({ signal, timeoutMs: 30_000, request: hostSignal => api.destination(input, { signal: hostSignal }) })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (composerWorkspace?.sessionId === undefined || !/sessionId|unrecognized|unknown key/iu.test(message)) throw error
        return runHostRequest({
          signal,
          timeoutMs: 30_000,
          request: hostSignal => api.destination({ workspaceId: workspaceId ?? '' }, { signal: hostSignal }),
        })
      }
    },
  })
  const settings = useSettings(jjIntegrationSettings).value
  const isolateByDefault = settings?.isolateByDefault ?? false
  const bookmark = settings?.bookmark ?? 'main'
  const [mountId] = useState(() => crypto.randomUUID())
  const newThreadId = composerWorkspace?.sessionId === undefined ? null : composerWorkspace.visitId
  const occupied = destination.data?.ownedByAnotherSession ?? composerWorkspace?.occupied ?? true
  const inThreadWorkspace = composerWorkspace?.path === undefined ? null : threadNameOf(composerWorkspace.path) !== null

  // A New thread opens its composer at once wherever it was started; the machine then moves it, in the background,
  // to where new threads start by default (its own jj workspace, or the project checkout).
  const { arrive, resolved } = toggle
  useEffect(() => {
    if (newThreadId === null || workspaceId === null) return
    arrive({ visitId: newThreadId, workspaceId, isolateByDefault })
    if (!isolateByDefault || inThreadWorkspace === null) return
    // Use the owning checkout when known, and never reuse the inherited thread workspace as its own spare.
    resolved(
      newThreadId,
      eagerDestinationMove({
        workspaceId,
        projectWorkspaceId: destination.data?.projectWorkspaceId ?? workspaceId,
        bookmark,
      }),
    )
  }, [arrive, bookmark, destination.data?.projectWorkspaceId, inThreadWorkspace, isolateByDefault, newThreadId, resolved, workspaceId])
  useEffect(() => {
    if (newThreadId === null || workspaceId === null || destination.data === undefined) return
    resolved(newThreadId, defaultDestinationMove({ destination: destination.data, workspaceId }))
  }, [destination.data, newThreadId, resolved, workspaceId])

  const current = destination.data
  const rootSelectionHandledFor = useRef<string | null>(null)
  const rootSelectionVisitId = composerWorkspace?.visitId ?? mountId
  useEffect(() => {
    if (rootSelectionHandledFor.current === rootSelectionVisitId || workspaceId === null || current === undefined || toggle.busy) return
    rootSelectionHandledFor.current = rootSelectionVisitId
    if (newThreadId !== null || current.vcs !== 'jj' || !current.isolated || current.projectWorkspaceId === null || current.projectWorkspaceId === workspaceId)
      return
    services.pickWorkspace(current.projectWorkspaceId)
  }, [current, newThreadId, rootSelectionVisitId, services, toggle.busy, workspaceId])
  const projectId = current?.projectWorkspaceId ?? workspaceId ?? ''
  const isJj = current?.vcs === 'jj'
  const isolated = toggle.pending?.isolate ?? current?.isolated === true
  const move = (request: { readonly isolate: boolean; readonly base?: string }): void => {
    const leavingPath =
      current?.isolated === true ? services.workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)?.path : undefined
    const leavingName = threadNameOf(leavingPath)
    toggle.toggle(
      {
        ...request,
        projectWorkspaceId: projectId,
        // Another thread's workspace is not a spare: only an unused one is kept for reuse.
        leaving: workspaceId !== null && leavingName !== null && !occupied ? { workspaceId, name: leavingName } : null,
        leavingBase: current?.bookmark ?? null,
      },
      newThreadId ?? undefined,
    )
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
              onCheckedChange={checked => {
                const isolate = checked === true
                if (current === undefined || current.bookmark === null) {
                  move({ isolate })
                  return
                }
                move({ isolate, base: current.bookmark })
              }}
            />
            {t('workspace')}
          </label>
        </span>
      ) : null}
      {toggle.error === null ? null : <span className="dshx:text-xs dshx:text-destructive">{toggle.error}</span>}
    </div>
  )
}
