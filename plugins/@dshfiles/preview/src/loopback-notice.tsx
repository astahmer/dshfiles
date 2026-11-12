import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import type { LoopbackNotice } from './preview-opener.js'

/**
 * Why a dev server cannot open on this device and how to fix it (T6.4): it listens on loopback only, and the GUI was
 * reached over Tailscale or the LAN. Nothing on the Host is changed for the user; the fix is theirs to run.
 */
export const LoopbackNoticeView = (props: { readonly notice: LoopbackNotice | null; readonly onDismiss: () => void }): JSX.Element | null => {
  if (props.notice === null) return null
  return (
    <Alert role="status" data-preview-loopback-notice="" className="dshx:text-xs">
      <AlertDescription className="dshx:flex dshx:flex-col dshx:gap-2">
        <span>{props.notice.message}</span>
        <Button variant="outline" size="xs" className="dshx:self-start" onClick={props.onDismiss}>
          Dismiss
        </Button>
      </AlertDescription>
    </Alert>
  )
}
