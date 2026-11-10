import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ExternalLinkIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import { multiHostApi } from './api.js'
import { openRemoteView } from './open-remote-view.js'

/**
 * A remote thread's shell lives on its host, so this pane says so and goes there. The tab opens on the click itself
 * because a browser blocks a popup that follows an async step.
 */
export const RemoteTerminalPanel = (props: { readonly sessionId: SessionId }) => {
  const api = useApi(multiHostApi)
  const [popupBlocked, setPopupBlocked] = useState(false)
  const open = useMutation({
    mutationFn: async (tab: Window) => {
      try {
        const owner = await api.sessionRuntime({ sessionId: props.sessionId })
        if (!owner.ok) throw new Error(owner.message)
        if (owner.runtimeId === null) throw new Error('This thread runs on this machine. Close this tab and open a new terminal.')
        const view = await api.runtimeOpenView({ runtimeId: owner.runtimeId, sessionId: props.sessionId })
        await openRemoteView({ tab, launchUrl: view.launchUrl, threadUrl: view.threadUrl })
      } catch (error) {
        tab.close()
        throw error
      }
    },
  })
  const start = (): void => {
    setPopupBlocked(false)
    const tab = window.open('about:blank', '_blank')
    if (tab === null) setPopupBlocked(true)
    else open.mutate(tab)
  }
  return (
    <div
      className="dshx-root dshx:flex dshx:h-full dshx:flex-col dshx:items-center dshx:justify-center dshx:gap-3 dshx:p-6 dshx:text-center"
      data-remote-terminal
    >
      <p className="dshx:max-w-sm dshx:text-sm dshx:text-muted-foreground">This thread runs on another machine, so its terminal opens there.</p>
      <Button type="button" size="sm" disabled={open.isPending} onClick={start}>
        <ExternalLinkIcon aria-hidden className="dshx:size-3.5" />
        Open terminal on host
      </Button>
      {popupBlocked ? (
        <p className="dshx:text-xs dshx:text-destructive">Your browser blocked the new tab. Allow pop-ups for this page, then try again.</p>
      ) : null}
      {open.error === null ? null : (
        <p className="dshx:text-xs dshx:text-destructive">{errorMessage(open.error, 'Could not reach the host. Check the Hosts page, then try again.')}</p>
      )}
    </div>
  )
}

export const RemoteTerminalTitle = () => <span>Terminal</span>
