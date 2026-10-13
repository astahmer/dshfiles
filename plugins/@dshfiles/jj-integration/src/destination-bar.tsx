import type { ISessions, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@dshfiles/plugin-ui/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { CheckIcon, GitBranchIcon, LaptopIcon } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { jjIntegrationApi } from './api.js'
import type { JjIntegrationTranslate } from './locales.js'

export interface DestinationBarServices {
  readonly sessions: ISessions
  readonly workspaces: IWorkspaces
  readonly openWorkspace: (workspaceId: string) => Promise<void>
}

type Target = { readonly workspaceId: string; readonly isolate: boolean; readonly base?: string }

const useSessionView = (services: DestinationBarServices, sessionId: SessionSummary['id']) => {
  const subscribe = useCallback(
    (listener: () => void) => {
      const offSessions = services.sessions.list.subscribe(listener)
      const offWorkspaces = services.workspaces.list.subscribe(listener)
      return () => {
        offSessions()
        offWorkspaces()
      }
    },
    [services],
  )
  const blank = useSyncExternalStore(subscribe, () => services.sessions.list.getSnapshot().byId[sessionId]?.blank === true)
  const workspaceId = useSyncExternalStore(
    subscribe,
    () => services.workspaces.list.getSnapshot().items.find(item => item.sessionIds.includes(sessionId))?.workspaceId ?? null,
  )
  return { blank, workspaceId }
}

/**
 * Where a new thread runs, chosen before its first message: the jj bookmark it starts from and whether it gets its
 * own jj workspace. The folder is the native project chip above, whose picker this plugin replaces. A Session's
 * directory is fixed once created, so each change opens a blank thread at the new destination instead of moving it.
 */
export const DestinationBar = (props: { readonly sessionId: SessionSummary['id']; readonly services: DestinationBarServices; readonly t: JjIntegrationTranslate }) => {
  const { t, services } = props
  const api = useApi(jjIntegrationApi)
  const queryClient = useQueryClient()
  const view = useSessionView(services, props.sessionId)
  const [branchOpen, setBranchOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const workspaceId = view.workspaceId
  const destination = useQuery({
    queryKey: ['jj-integration', 'destination', workspaceId ?? ''],
    enabled: view.blank && workspaceId !== null,
    queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 30_000, request: hostSignal => api.destination({ workspaceId: workspaceId ?? '' }, { signal: hostSignal }) }),
  })
  const move = useMutation({
    mutationFn: async (target: Target): Promise<void> => {
      const leaving = destination.data?.isolated === true ? workspaceId : null
      const next = (await api.provision({ workspaceId: target.workspaceId, isolate: target.isolate, ...(target.base === undefined ? {} : { base: target.base }) }))
        .workspaceId
      if (next === workspaceId) return
      await services.openWorkspace(next)
      // The blank thread left behind had no message, so its fresh workspace holds nothing worth keeping.
      const leavingPath = leaving === null ? undefined : services.workspaces.list.getSnapshot().items.find(item => item.workspaceId === leaving)?.path
      if (leavingPath !== undefined) void api.discard({ path: leavingPath, force: false }).catch(() => undefined)
    },
    onMutate: () => setError(null),
    onError: cause => setError(errorMessage(cause, t('loadFailed'))),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['jj-integration'] }),
  })

  if (!view.blank || workspaceId === null) return null
  const current = destination.data
  const projectId = current?.projectWorkspaceId ?? workspaceId
  const isJj = current?.vcs === 'jj'
  const isolated = current?.isolated === true
  const chip = 'dshx:h-7 dshx:gap-1.5 dshx:px-2 dshx:text-xs dshx:font-normal'

  return (
    <div className="dshx-root dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5 dshx:pb-2" aria-label={t('destination')}>
      <span className={`dshx:inline-flex dshx:items-center dshx:rounded-md dshx:bg-muted ${chip}`} title={t('hostPlanned')}>
        <LaptopIcon className="dshx:size-3.5" />
        {t('hostLocal')}
      </span>
      {isJj ? (
        <span className="dshx:inline-flex dshx:items-center dshx:rounded-md dshx:bg-secondary">
          <Popover open={branchOpen} onOpenChange={setBranchOpen}>
            <PopoverTrigger asChild>
              <Button variant="secondary" className={chip} disabled={move.isPending} title={isolated ? undefined : t('bookmarkIsolates')}>
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
                        move.mutate({ workspaceId: projectId, isolate: true, base: name })
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
          <label className="dshx:flex dshx:cursor-pointer dshx:items-center dshx:gap-1.5 dshx:border-l dshx:px-2 dshx:text-xs" title={t('isolateHint')}>
            <Checkbox
              checked={isolated}
              disabled={move.isPending}
              onCheckedChange={checked =>
                move.mutate({ workspaceId: projectId, isolate: checked === true, ...(current?.bookmark == null ? {} : { base: current.bookmark }) })
              }
            />
            {t('workspace')}
          </label>
        </span>
      ) : null}
      {move.isPending ? <Spinner className="dshx:size-3.5" /> : null}
      {error === null ? null : <span className="dshx:text-xs dshx:text-destructive">{error}</span>}
    </div>
  )
}
