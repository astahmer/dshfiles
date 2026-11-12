import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { Schema } from 'effect'
import { useEffect, useId, useRef, useState } from 'react'
import type { AttentionItem } from './attention-api.js'
import type { InboxTranslate } from './inbox-locales.js'

/** Opt-in, per browser: off until the user turns it on and grants permission (plan §4.8: only what needs you alerts). */
const storedBlockingAlerts = createStoredValue({ key: 'dshfiles.attention-inbox.blocking-alerts.v1', schema: Schema.Boolean, fallback: false })

const notificationsSupported = (): boolean => typeof window !== 'undefined' && window.isSecureContext && 'Notification' in window

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

/** What a browser notification says about one item: the thread as title, the question or the failure as body. */
export interface AttentionNotification {
  readonly title: string
  readonly body: string
  readonly tag: string
}

const BODY_LIMIT = 240

const shorten = (text: string): string => (text.length <= BODY_LIMIT ? text : `${text.slice(0, BODY_LIMIT - 1)}…`)

/** Needs you items worth interrupting for (plan §4.8): a question or approval, and a failure. Ready items never alert. */
const alerts = (item: AttentionItem): boolean => item.severity === 'blocking' || item.severity === 'failed'

/**
 * The thread's title heads the notification (an item about another subject uses its label); the body is the item's
 * own sentence, the question or the failure, followed by the first line of its detail for a failure (its recovery).
 */
const notificationOf = (item: AttentionItem, sessionLabel: (sessionId: string) => string): AttentionNotification => {
  const title = item.subject.kind === 'session' ? sessionLabel(item.subject.id) : (item.subject.label ?? item.subject.id)
  const recovery = item.severity === 'failed' && item.detail !== null ? item.detail.split('\n')[0]?.trim() : undefined
  return {
    title,
    body: shorten(recovery === undefined || recovery === '' ? item.reason : `${item.reason} ${recovery}`),
    tag: `dshfiles-attention-${item.id}`,
  }
}

const occurrenceKey = (item: AttentionItem): string => `${item.id}:${String(item.openedAt)}`

/** The items a list brings that the page has not announced yet; the first list only seeds what it has seen. */
const newAlerts = (known: ReadonlySet<string> | null, items: readonly AttentionItem[]): readonly AttentionItem[] =>
  known === null ? [] : items.filter(item => alerts(item) && !known.has(occurrenceKey(item)))

/**
 * Raise one browser notification per Needs you item (a question or a failure) that appears while the page is hidden.
 * Clicking it opens that item's thread (or page). The first list a page reads only seeds what it has seen, so opening
 * DSH never replays old items.
 */
const useBlockingAlerts = (
  items: readonly AttentionItem[] | undefined,
  onOpen: (item: AttentionItem) => void,
  sessionLabel: (sessionId: string) => string,
): void => {
  const enabled = storedBlockingAlerts.useValue()
  const seen = useRef<Set<string> | null>(null)
  const latestOpen = useRef(onOpen)
  latestOpen.current = onOpen
  const latestLabel = useRef(sessionLabel)
  latestLabel.current = sessionLabel
  useEffect(() => {
    if (items === undefined) return
    const fresh = newAlerts(seen.current, items)
    seen.current = new Set(items.filter(alerts).map(occurrenceKey))
    if (!enabled || !notificationsSupported() || Notification.permission !== 'granted' || !document.hidden) return
    for (const item of fresh) {
      const content = notificationOf(item, latestLabel.current)
      const notification = new Notification(content.title, { body: content.body, tag: content.tag })
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
  static readonly notificationOf = notificationOf
  static readonly newAlerts = newAlerts
}
