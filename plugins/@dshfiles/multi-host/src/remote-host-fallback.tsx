import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { useState } from 'react'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ExternalLinkIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { multiHostApi } from './api.js'

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
  const openHost = useMutation({
    mutationFn: async ({ runtimeId, tab }: { readonly runtimeId: string; readonly tab: Window }) => {
      try {
        const view = await api.runtimeOpenView({ runtimeId })
        tab.opener = null
        tab.location.href = view.launchUrl
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
      <span className="dshx:text-xs dshx:text-muted-foreground">
        Opens the host home; select this thread there for its native questions, approvals, terminals, or JJ tools.
      </span>
    </div>
  )
}
