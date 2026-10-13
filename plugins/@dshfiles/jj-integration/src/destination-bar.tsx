import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@dshfiles/plugin-ui/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { CheckIcon, GitBranchIcon } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { HostChip, multiHostApi } from '@dshfiles/multi-host/destination'
import { useState } from 'react'
import { jjIntegrationApi } from './api.js'
import type { JjIntegrationTranslate } from './locales.js'

export interface DestinationBarServices {
  readonly workspaces: IWorkspaces
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

type Target = { readonly workspaceId: string; readonly isolate: boolean; readonly base?: string }

/**
 * Where a new thread runs on this machine, chosen before its first message: the jj bookmark it starts from and
 * whether it gets its own jj workspace, rendered in the native New thread row beside its project chip after the host chip. A
 * Session's directory is fixed once created, so each change opens a blank thread at the new destination.
 */
export const DestinationBar = (props: {
  readonly workspaceId: string | undefined
  readonly services: DestinationBarServices
  readonly t: JjIntegrationTranslate
}) => {
  const { t, services } = props
  const api = useApi(jjIntegrationApi)
  const queryClient = useQueryClient()
  const [branchOpen, setBranchOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const workspaceId = props.workspaceId ?? null
  const destination = useQuery({
    queryKey: ['jj-integration', 'destination', workspaceId ?? ''],
    enabled: workspaceId !== null,
    queryFn: ({ signal }) =>
      runHostRequest({ signal, timeoutMs: 30_000, request: hostSignal => api.destination({ workspaceId: workspaceId ?? '' }, { signal: hostSignal }) }),
  })
  const move = useMutation({
    mutationFn: async (target: Target): Promise<void> => {
      const leaving = destination.data?.isolated === true ? workspaceId : null
      const next = (
        await api.provision({ workspaceId: target.workspaceId, isolate: target.isolate, ...(target.base === undefined ? {} : { base: target.base }) })
      ).workspaceId
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

  const current = destination.data
  const projectId = current?.projectWorkspaceId ?? workspaceId ?? ''
  const isJj = current?.vcs === 'jj'
  const isolated = current?.isolated === true
  const chip = 'dshx:h-7 dshx:gap-1.5 dshx:px-2 dshx:text-sm dshx:font-medium'

  return (
    // display: contents makes each chip an item of the native row, so the host chip can lead it.
    <div className="dshx-root dshx:contents" aria-label={t('destination')}>
      <HostChipSlot />
      {isJj ? (
        <span className="dshx:inline-flex dshx:items-center dshx:rounded-md">
          <Popover open={branchOpen} onOpenChange={setBranchOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" className={chip} disabled={move.isPending} title={isolated ? undefined : t('bookmarkIsolates')}>
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
          <label className="dshx:flex dshx:cursor-pointer dshx:items-center dshx:gap-1.5 dshx:border-l dshx:px-2 dshx:text-sm" title={t('isolateHint')}>
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
