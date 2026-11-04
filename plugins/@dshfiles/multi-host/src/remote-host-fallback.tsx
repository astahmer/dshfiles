import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { useState } from 'react'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ExternalLinkIcon, EyeOffIcon, TriangleAlertIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { multiHostApi } from './api.js'
import { openRemoteView } from './open-remote-view.js'
import { versionMismatch } from './destination/connection-diagnostics.js'
import { multiHostKeys, multiHostQueries } from './destination/queries.js'

export const RemoteHostFallback = (props: { readonly sessionId: SessionId }) => {
  const api = useApi(multiHostApi)
  const [popupBlocked, setPopupBlocked] = useState(false)
  const owner = useQuery({
    queryKey: ['multi-host', 'session-runtime', props.sessionId],
    queryFn: async ({ signal }) => {
      const result = await api.sessionRuntime({ sessionId: props.sessionId }, { signal })
      if (!result.ok) throw new Error(result.message)
      return result.runtimeId
    },
  })
  const directory = useQuery({ ...multiHostQueries.directory(api), enabled: owner.data !== undefined && owner.data !== null })
  const localIdentity = useQuery({ ...multiHostQueries.identity(api), enabled: owner.data !== undefined && owner.data !== null })
  const queryClient = useQueryClient()
  const hideHost = useMutation({
    mutationFn: (hostId: string) => api.hostSetHidden({ id: hostId, hidden: true }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: multiHostKeys.all }),
  })
  const openHost = useMutation({
    mutationFn: async ({ runtimeId, tab }: { readonly runtimeId: string; readonly tab: Window }) => {
      try {
        const view = await api.runtimeOpenView({ runtimeId, sessionId: props.sessionId })
        await openRemoteView({ tab, launchUrl: view.launchUrl, threadUrl: view.threadUrl })
      } catch (error) {
        tab.close()
        throw error
      }
    },
  })

  if (owner.data === null) return null
  if (owner.data === undefined) {
    if (isApiOwnerMissing(owner.error)) {
      return <span className="dshx:text-xs dshx:text-muted-foreground">Remote host links need a newer multi-host Host.</span>
    }
    return null
  }

  const runtimeId = owner.data
  const hostVersion = directory.data?.runtimes.find(runtime => runtime.id === runtimeId)?.identity?.dshVersion
  const ownerRuntime = directory.data?.runtimes.find(runtime => runtime.id === runtimeId)
  const unreachable = ownerRuntime !== undefined && !ownerRuntime.connected && ownerRuntime.lastError !== undefined
  const outdatedVersion = versionMismatch({ localVersion: localIdentity.data?.dshVersion, remoteVersion: hostVersion })
  const open = (): void => {
    setPopupBlocked(false)
    const tab = window.open('about:blank', '_blank')
    if (tab === null) {
      setPopupBlocked(true)
      return
    }
    openHost.mutate({ runtimeId, tab })
  }

  return (
    <div className="dshx:flex dshx:items-center dshx:gap-2" data-remote-host-fallback="">
      <Button type="button" variant="outline" size="sm" disabled={openHost.isPending} onClick={open}>
        <ExternalLinkIcon aria-hidden />
        Open on remote host
      </Button>
      {openHost.isError ? <span className="dshx:text-xs dshx:text-destructive">{errorMessage(openHost.error, 'Could not open the remote host.')}</span> : null}
      {popupBlocked ? <span className="dshx:text-xs dshx:text-destructive">Allow pop-ups to open the remote host.</span> : null}
      {unreachable ? (
        <Button type="button" variant="ghost" size="sm" disabled={hideHost.isPending} onClick={() => hideHost.mutate(ownerRuntime.hostId)}>
          <EyeOffIcon aria-hidden />
          Hide this host
        </Button>
      ) : null}
      {hideHost.isError ? <span className="dshx:text-xs dshx:text-destructive">{errorMessage(hideHost.error, 'Could not hide the host.')}</span> : null}
      {outdatedVersion === undefined ? null : (
        <span data-remote-host-version-drift="" className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-xs dshx:text-warning">
          <TriangleAlertIcon className="dshx:size-3.5" aria-hidden />
          This host runs DSH {outdatedVersion}; this machine runs {localIdentity.data?.dshVersion}. Update its DSH core on that machine, then restart it.
        </span>
      )}
    </div>
  )
}
