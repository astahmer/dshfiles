import { CheckIcon, CircleAlertIcon, CircleCheckIcon, CircleStopIcon, InboxIcon, MessagesSquareIcon, WandSparklesIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState, type ReactNode } from 'react'

import type { BacklogSummaryView } from './api.js'
import { linkedThreadIds, type InboxThread } from './inbox-threads.js'
import { ItemGlyphs } from './item-glyphs.js'
import { useBacklogActions } from './use-backlog-actions.js'

type InboxFilter = 'all' | 'needs-input' | 'blocked' | 'suggestions'

const threadReasons = {
  completed: { label: 'finished and waits for review', Icon: CircleCheckIcon, tone: 'dshx:text-success' },
  aborted: { label: 'was stopped', Icon: CircleStopIcon, tone: 'dshx:text-muted-foreground' },
  blocked: { label: 'is blocked', Icon: CircleAlertIcon, tone: 'dshx:text-warning' },
  error: { label: 'stopped with an error', Icon: CircleAlertIcon, tone: 'dshx:text-destructive' },
  'max-tokens': { label: 'ran out of tokens', Icon: CircleAlertIcon, tone: 'dshx:text-warning' },
} satisfies Record<InboxThread['reason'], { readonly label: string; readonly Icon: typeof CheckIcon; readonly tone: string }>

const threadMatches = (thread: InboxThread, filter: InboxFilter): boolean => filter === 'all' || (filter === 'blocked' && thread.reason !== 'completed')

const filters: readonly { readonly value: InboxFilter; readonly label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'needs-input', label: 'Needs you' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'suggestions', label: 'Suggestions' },
]

const matchesFilter = (item: BacklogSummaryView, filter: InboxFilter): boolean => {
  if (filter === 'all') return true
  if (filter === 'suggestions') return item.proposal !== null
  if (filter === 'blocked') return item.attention === 'blocked' || item.attention === 'waiting'
  return item.attention === 'needs-input'
}

/** Read is not done: an acknowledged request stays here until its attention is cleared. */
const isUnread = (item: BacklogSummaryView): boolean => item.acknowledgedAt === null || item.acknowledgedAt < item.lastActivityAt

const headline = (item: BacklogSummaryView): ReactNode => {
  const actor = <span className="dshx:font-semibold dshx:text-foreground">{ItemGlyphs.actorName(item.activity.last?.actor ?? item.actors[0]?.id)}</span>
  const title = <span className="dshx:font-semibold dshx:text-foreground">{item.title}</span>
  if (item.attention === 'needs-input')
    return (
      <>
        {actor} needs your input on {title}
      </>
    )
  if (item.attention === 'blocked') return <>{title} is blocked</>
  if (item.attention === 'waiting') return <>{title} is waiting</>
  return <>Triage has a suggestion for {title}</>
}

export const inboxOrder = (items: readonly BacklogSummaryView[], filter: InboxFilter = 'all'): BacklogSummaryView[] =>
  items.filter(item => matchesFilter(item, filter)).sort((left, right) => right.lastActivityAt - left.lastActivityAt)

/** The attention queue: what wants a decision from the user, beside the inspector of the selected one. */
export const InboxView = (props: {
  readonly items: readonly BacklogSummaryView[]
  readonly threads: readonly InboxThread[]
  readonly openId: number | null
  readonly select: (id: number) => void
  readonly openThread: (sessionId: string) => void
  readonly acknowledgeThread: (thread: InboxThread) => void
  readonly inspector: ReactNode
  readonly loaded: boolean
}): JSX.Element => {
  const actions = useBacklogActions()
  const [filter, setFilter] = useState<InboxFilter>('all')
  const rows = inboxOrder(props.items, filter)
  const threads = props.threads.filter(thread => threadMatches(thread, filter))
  return (
    <div className="dshx:flex dshx:min-h-0 dshx:flex-1">
      <section
        aria-label="Inbox"
        className="dshx:flex dshx:w-[400px] dshx:max-w-full dshx:shrink-0 dshx:flex-col dshx:border-r dshx:border-border dshx:@max-pane-compact:w-full dshx:@max-pane-compact:border-r-0"
      >
        <div
          role="tablist"
          aria-label="Inbox filters"
          className="dshx:flex dshx:h-10 dshx:shrink-0 dshx:items-end dshx:gap-4 dshx:border-b dshx:border-border dshx:px-4"
        >
          {filters.map(entry => {
            const count =
              props.items.filter(item => matchesFilter(item, entry.value)).length + props.threads.filter(thread => threadMatches(thread, entry.value)).length
            return (
              <button
                key={entry.value}
                role="tab"
                type="button"
                aria-selected={filter === entry.value}
                onClick={() => setFilter(entry.value)}
                className={cn(
                  'dshx:-mb-px dshx:flex dshx:h-full dshx:items-center dshx:gap-1 dshx:border-b-2 dshx:text-[13px] dshx:transition-colors',
                  filter === entry.value
                    ? 'dshx:border-foreground dshx:font-medium dshx:text-foreground'
                    : 'dshx:border-transparent dshx:text-muted-foreground dshx:hover:text-foreground',
                )}
              >
                {entry.label}
                {count === 0 ? null : <span className="dshx:text-[11px] dshx:text-muted-foreground">{count}</span>}
              </button>
            )
          })}
        </div>
        <ul className="dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto">
          {threads.map(thread => {
            const reason = threadReasons[thread.reason]
            const first = thread.items[0]
            return (
              <li
                key={thread.sessionId}
                aria-label={`Thread ${thread.title}`}
                onClick={() => (first === undefined ? undefined : props.select(first.id))}
                className={cn(
                  'dshx:group/row dshx:relative dshx:flex dshx:cursor-default dshx:gap-3 dshx:border-b dshx:border-border/60 dshx:px-4 dshx:py-3 dshx:transition-colors',
                  thread.items.some(item => item.id === props.openId) ? 'dshx:bg-accent/70' : 'dshx:hover:bg-accent/35',
                )}
              >
                <span
                  aria-label="Unread"
                  className="dshx:absolute dshx:top-1/2 dshx:left-1.5 dshx:size-1.5 dshx:-translate-y-1/2 dshx:rounded-full dshx:bg-info"
                />
                <span className="dshx:inline-flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:bg-muted">
                  <reason.Icon aria-hidden className={cn('dshx:size-3.5', reason.tone)} />
                </span>
                <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1">
                  <p className="dshx:line-clamp-2 dshx:text-[13px] dshx:leading-snug dshx:text-muted-foreground">
                    Thread <span className="dshx:font-semibold dshx:text-foreground">{thread.title}</span> {reason.label}
                  </p>
                  <p className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
                    Working on {thread.items.map(item => `b:${String(item.id)} ${item.title}`).join(', ')}
                  </p>
                  <p className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-[11px] dshx:text-muted-foreground">
                    <button
                      type="button"
                      onClick={event => {
                        event.stopPropagation()
                        props.openThread(thread.sessionId)
                      }}
                      className="dshx:inline-flex dshx:items-center dshx:gap-1 dshx:font-medium dshx:text-foreground dshx:hover:underline"
                    >
                      <MessagesSquareIcon className="dshx:size-3" /> Open thread
                    </button>
                    {thread.at === 0 ? null : <>· {ItemGlyphs.ago(thread.at)}</>}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Acknowledge"
                  title="Acknowledge (also clears it in the sidebar)"
                  onClick={event => {
                    event.stopPropagation()
                    props.acknowledgeThread(thread)
                  }}
                  className="dshx:self-start dshx:rounded-md dshx:p-1 dshx:text-muted-foreground dshx:opacity-0 dshx:transition-opacity dshx:group-hover/row:opacity-100 dshx:hover:bg-accent dshx:hover:text-foreground"
                >
                  <CheckIcon className="dshx:size-3.5" />
                </button>
              </li>
            )
          })}
          {props.loaded && rows.length === 0 && threads.length === 0 ? (
            <li className="dshx:flex dshx:flex-col dshx:items-center dshx:gap-2 dshx:px-6 dshx:py-20 dshx:text-center">
              <InboxIcon aria-hidden className="dshx:size-7 dshx:text-muted-foreground" />
              <p className="dshx:text-sm dshx:font-medium">Nothing needs you</p>
              <p className="dshx:text-xs dshx:text-muted-foreground">Agents asking for a decision, blocked work and triage suggestions land here.</p>
            </li>
          ) : null}
          {rows.map(item => (
            <li
              key={item.id}
              aria-label={`Item b:${String(item.id)}`}
              aria-current={item.id === props.openId ? 'true' : undefined}
              onClick={() => props.select(item.id)}
              className={cn(
                'dshx:group/row dshx:relative dshx:flex dshx:cursor-default dshx:gap-3 dshx:border-b dshx:border-border/60 dshx:px-4 dshx:py-3 dshx:transition-colors',
                item.id === props.openId ? 'dshx:bg-accent/70' : 'dshx:hover:bg-accent/35',
              )}
            >
              {isUnread(item) ? (
                <span
                  aria-label="Unread"
                  className="dshx:absolute dshx:top-1/2 dshx:left-1.5 dshx:size-1.5 dshx:-translate-y-1/2 dshx:rounded-full dshx:bg-info"
                />
              ) : null}
              {item.proposal !== null && item.attention === 'none' ? (
                <span className="dshx:inline-flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:bg-violet/15 dshx:text-violet">
                  <WandSparklesIcon className="dshx:size-3.5" />
                </span>
              ) : (
                <ItemGlyphs.ActorAvatar actorId={item.activity.last?.actor ?? item.actors[0]?.id} className="dshx:size-7 dshx:text-[11px] dshx:ring-0" />
              )}
              <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1">
                <p
                  className={cn('dshx:line-clamp-2 dshx:text-[13px] dshx:leading-snug', isUnread(item) ? 'dshx:text-foreground' : 'dshx:text-muted-foreground')}
                >
                  {headline(item)}
                </p>
                {item.activity.last?.kind === 'commented' ? (
                  <p className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{item.activity.last.detail}</p>
                ) : item.preview === '' ? null : (
                  <p className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{item.preview}</p>
                )}
                <p className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-[11px] dshx:text-muted-foreground">
                  <ItemGlyphs.AttentionBadge attention={item.attention} compact />
                  {linkedThreadIds(item).map(sessionId => (
                    <button
                      key={sessionId}
                      type="button"
                      onClick={event => {
                        event.stopPropagation()
                        props.openThread(sessionId)
                      }}
                      className="dshx:inline-flex dshx:items-center dshx:gap-1 dshx:font-medium dshx:text-foreground dshx:hover:underline"
                    >
                      <MessagesSquareIcon aria-hidden className="dshx:size-3" /> Open thread
                    </button>
                  ))}
                  {item.project === null ? null : (
                    <>
                      <ItemGlyphs.ProjectDot project={item.project} />
                      <span className="dshx:truncate">{ItemGlyphs.projectName(item.project)}</span>·
                    </>
                  )}
                  <span className="dshx:font-mono!">b:{item.id}</span>· {ItemGlyphs.ago(item.lastActivityAt)}
                </p>
              </div>
              <button
                type="button"
                aria-label="Resolve"
                title={item.attention === 'none' ? 'Dismiss the suggestion' : 'Mark resolved'}
                onClick={event => {
                  event.stopPropagation()
                  if (item.attention === 'none') actions.dismissProposal.mutate(item.id)
                  else actions.update.mutate({ id: item.id, attention: 'none' })
                }}
                className="dshx:self-start dshx:rounded-md dshx:p-1 dshx:text-muted-foreground dshx:opacity-0 dshx:transition-opacity dshx:group-hover/row:opacity-100 dshx:hover:bg-accent dshx:hover:text-foreground"
              >
                <CheckIcon className="dshx:size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </section>
      <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:@max-pane-compact:hidden">
        {props.inspector ?? (
          <div className="dshx:flex dshx:flex-1 dshx:flex-col dshx:items-center dshx:justify-center dshx:gap-2 dshx:text-center dshx:text-muted-foreground">
            <InboxIcon aria-hidden className="dshx:size-8 dshx:opacity-50" />
            <p className="dshx:text-xs">Select an item to see what it needs.</p>
          </div>
        )}
      </div>
    </div>
  )
}
