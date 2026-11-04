import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { Schema } from 'effect'
import { useEffect, useId, useRef, useState } from 'react'
import type { AttentionItem } from './attention-api.js'
import type { InboxTranslate } from './inbox-locales.js'

/** Opt-in, per browser: off until the user turns it on and grants permission (plan §4.8, push only for blocking). */
const storedBlockingAlerts = createStoredValue({ key: 'dshfiles.attention-inbox.blocking-alerts.v1', schema: Schema.Boolean, fallback: false })

const notificationsSupported = (): boolean => typeof window !== 'undefined' && 'Notification' in window

const Toggle = (props: { readonly t: InboxTranslate }): JSX.Element | null => {
  const enabled = storedBlockingAlerts.useValue()
  const id = useId()
  // Only after the user asked: a browser that blocks notifications by default should not open the page with an error.
  const [denied, setDenied] = useState(false)
  if (!notificationsSupported()) return null
  const change = (next: boolean): void => {
    if (!next) {
      storedBlockingAlerts.set(false)
      return
    }
    const ask = async (): Promise<void> => {
      const permission = await Notification.requestPermission()
      setDenied(permission === 'denied')
      storedBlockingAlerts.set(permission === 'granted')
    }
    void ask()
  }
  return (
    <div className="dshx:flex dshx:max-w-full dshx:flex-col dshx:gap-1">
      <div className="dshx:flex dshx:items-center dshx:gap-2">
        <Switch id={id} checked={enabled && Notification.permission === 'granted'} onCheckedChange={change} />
        <Label htmlFor={id} className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground">
          {props.t('notifyBlocking')}
        </Label>
      </div>
      {denied ? <p className="dshx:text-xs dshx:text-destructive">{props.t('notifyDenied')}</p> : null}
    </div>
  )
}

/**
 * Raise one browser notification per blocking item that appears while the page is hidden. The first list a page
 * reads only seeds what it has seen, so opening DSH never replays old items.
 */
const useBlockingAlerts = (items: readonly AttentionItem[] | undefined, onOpen: (item: AttentionItem) => void): void => {
  const enabled = storedBlockingAlerts.useValue()
  const seen = useRef<Set<string> | null>(null)
  const latestOpen = useRef(onOpen)
  latestOpen.current = onOpen
  useEffect(() => {
    if (items === undefined) return
    const blocking = items.filter(item => item.severity === 'blocking')
    const known = seen.current
    seen.current = new Set(blocking.map(item => `${item.id}:${String(item.openedAt)}`))
    if (known === null || !enabled || !notificationsSupported() || Notification.permission !== 'granted' || !document.hidden) return
    for (const item of blocking) {
      if (known.has(`${item.id}:${String(item.openedAt)}`)) continue
      const notification = new Notification('Needs you', { body: item.reason, tag: `dshfiles-attention-${item.id}` })
      notification.onclick = () => {
        window.focus()
        latestOpen.current(item)
        notification.close()
      }
    }
  }, [items, enabled])
}

export class InboxNotifications {
  static readonly Toggle = Toggle
  static readonly useBlockingAlerts = useBlockingAlerts
}
