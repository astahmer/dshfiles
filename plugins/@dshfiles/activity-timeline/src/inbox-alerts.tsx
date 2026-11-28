import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import type { InboxTranslate } from './inbox-locales.js'
import { InboxNotifications } from './inbox-notifications.js'
import { InboxPush } from './web-push-client.js'

/** Whether this browser has any alert to set: in-tab notifications, push, or the iPhone Home Screen hint. */
const available = (): boolean => InboxNotifications.supported() || InboxPush.support() !== 'unsupported'

/**
 * This device's alert settings, opened from the Inbox page menu: in-tab alerts and push, each off until turned on.
 * They are settings of the page, not items of the work list, so they do not sit under it.
 */
const SettingsDialog = (props: { readonly t: InboxTranslate; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }): JSX.Element => (
  <Dialog open={props.open} onOpenChange={props.onOpenChange}>
    <DialogContent className="dshx-root" data-inbox-alert-settings="">
      <DialogHeader>
        <DialogTitle>{props.t('alertSettings')}</DialogTitle>
        <DialogDescription>{props.t('alertSettingsHint')}</DialogDescription>
      </DialogHeader>
      <div className="dshx:flex dshx:flex-col dshx:gap-3">
        <InboxNotifications.Toggle t={props.t} />
        <InboxPush.Control t={props.t} />
      </div>
    </DialogContent>
  </Dialog>
)

export const InboxAlerts = { available, SettingsDialog } as const
