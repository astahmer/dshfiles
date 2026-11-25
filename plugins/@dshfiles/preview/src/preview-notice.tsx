import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import type { PreviewNotice } from './preview-opener.js'

/**
 * Why an Open click did not end in the pane, and what to do instead: a loopback-only port the viewer cannot reach
 * (T6.4), a page that refuses embedding, or a port nothing answers on. The pane cannot report any of these itself —
 * an iframe sees only Chrome's grey page — so the Host's answer is spoken here.
 */
export const PreviewNoticeView = (props: { readonly notice: PreviewNotice | null; readonly onDismiss: () => void }): JSX.Element | null => {
  if (props.notice === null) return null
  const embed = props.notice.kind === 'embed' ? props.notice : null
  return (
    <Alert role="status" data-preview-notice={embed?.verdict ?? 'loopback-only'} className="dshx:text-xs">
      <AlertDescription className="dshx:flex dshx:flex-col dshx:gap-2">
        <span>{props.notice.message}</span>
        {embed === null ? null : <span className="dshx:text-muted-foreground">{embed.fix}</span>}
        {embed?.action === undefined ? null : (
          <Button variant="outline" size="xs" className="dshx:self-start" onClick={embed.action.run}>
            {embed.action.label}
          </Button>
        )}
        <Button variant="outline" size="xs" className="dshx:self-start" onClick={props.onDismiss}>
          Dismiss
        </Button>
      </AlertDescription>
    </Alert>
  )
}
