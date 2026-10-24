import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import type { AlertEvent } from './alert-types.js'
import { tracesAlertsApi } from './alerts-api.js'
import type { TracesAlertsTranslate } from './alerts-locale.js'
import { alertsQueries } from './alerts-queries.js'

const TOAST_HOLD_MS = 8_000
/** An event older than this when a tab first sees it (a reload after a long absence) is history, not news. */
const ANNOUNCE_WITHIN_MS = 10 * 60_000

/** The newest event id any tab announced: tabs share it, so one alert is announced once per browser. */
const storedAnnouncedId = createStoredValue({ key: 'dshfiles.traces.alerts.announced.v1', schema: z.number().int().nonnegative().nullable(), fallback: null })

type Announcement = { readonly sequence: number; readonly text: string }

/** Takes the events newer than what this browser announced, or null when another tab already took them. */
const claimEvents = (latestEventId: number, events: readonly AlertEvent[]): readonly AlertEvent[] | null => {
  storedAnnouncedId.reload()
  const announced = storedAnnouncedId.get()
  if (announced !== null && announced >= latestEventId) return null
  storedAnnouncedId.set(latestEventId)
  if (announced === null) return []
  const now = Date.now()
  return events.filter(event => event.id > announced && event.notify && now - event.at < ANNOUNCE_WITHIN_MS)
}

const titleOf = (event: AlertEvent, t: TracesAlertsTranslate): string => `${event.kind === 'firing' ? t('toastFiring') : t('toastResolved')}: ${event.ruleName}`

const notifySystem = (event: AlertEvent, t: TracesAlertsTranslate, onOpen: () => void): void => {
  if (!('Notification' in window) || window.Notification.permission !== 'granted') return
  try {
    const notification = new window.Notification(titleOf(event, t), { body: t('toastOpen'), tag: `dshfiles-traces-alert-${String(event.id)}` })
    notification.onclick = () => {
      window.focus()
      onOpen()
      notification.close()
    }
  } catch {
    // Some browsers only allow notifications from a service worker; the in-app banner already said it.
  }
}

/**
 * Lives in the shell overlay so an alert is announced wherever the user is: an in-app banner through the Host's own
 * Toast, and a browser notification when the user allowed them. Only firing events of rules that announce, and resolutions
 * of those, are shown; a muted rule's events carry notify: false.
 */
export const AlertNotifier = (props: { readonly onOpenAlerts: () => void; readonly t: TracesAlertsTranslate }): JSX.Element | null => {
  const t = props.t
  const client = useApi(tracesAlertsApi)
  const announcedId = storedAnnouncedId.useValue()
  const feed = useQuery(alertsQueries.feed(client, announcedId))
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)

  useEffect(() => {
    if (feed.data === undefined) return
    const fresh = claimEvents(feed.data.latestEventId, feed.data.events)
    if (fresh === null || fresh.length === 0) return
    const newest = fresh[0]
    if (newest === undefined) return
    const more = fresh.length > 1 ? ` (+${String(fresh.length - 1)})` : ''
    setAnnouncement({ sequence: newest.id, text: `${titleOf(newest, t)}${more}` })
    for (const event of fresh.filter(candidate => candidate.kind === 'firing')) notifySystem(event, t, props.onOpenAlerts)
  }, [feed.data, t, props.onOpenAlerts])

  if (announcement === null) return null
  return (
    <Toast
      key={announcement.sequence}
      text={announcement.text}
      holdMs={TOAST_HOLD_MS}
      actions={[
        {
          label: t('toastOpen'),
          onClick: () => {
            props.onOpenAlerts()
            setAnnouncement(null)
          },
        },
      ]}
      onDone={() => setAnnouncement(current => (current?.sequence === announcement.sequence ? null : current))}
    />
  )
}
