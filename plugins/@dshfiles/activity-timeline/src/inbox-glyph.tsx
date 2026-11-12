import { useResource } from '@dshfiles/dshx/client'
import { useMemo } from 'react'
import { ATTENTION_LIST_LIMIT, ATTENTION_READ, attentionApi } from './attention-api.js'
import { InboxNotifications } from './inbox-notifications.js'
import { useInboxOpener, type Navigation } from './inbox-panel.js'

/**
 * The Inbox nav glyph and its one badge: the Needs you count, a projection of inbox state (plan §4.8). It also hosts
 * the opt-in blocking alerts, because the nav entry is mounted for as long as the sidebar is.
 */
export const InboxGlyph = (props: { readonly size?: number; readonly navigation: Navigation }): JSX.Element => {
  const openSubject = useInboxOpener(props.navigation)
  const needsYou = useResource(attentionApi, 'list', { view: 'needs-you', limit: ATTENTION_LIST_LIMIT }, ATTENTION_READ)
  const items = useMemo(() => needsYou.data?.items.slice(0, 100), [needsYou.data])
  InboxNotifications.useBlockingAlerts(items, item => void openSubject(item.subject))
  const count = needsYou.data?.counts.needsYou ?? 0
  const size = props.size ?? 18
  return (
    <span className="dshx-root dshx:relative dshx:inline-flex" data-attention-badge={count}>
      <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
        <path d="M4 13h4.5l1 2h5l1-2H20" />
      </svg>
      {count === 0 ? null : (
        <span className="dshx:absolute dshx:-right-2 dshx:-top-1.5 dshx:min-w-4 dshx:rounded-full dshx:bg-primary dshx:px-1 dshx:text-center dshx:text-[10px] dshx:font-semibold dshx:leading-4 dshx:text-primary-foreground">
          {count > 99 ? '99+' : count}
          <span className="dshx:sr-only"> need you</span>
        </span>
      )}
    </span>
  )
}
