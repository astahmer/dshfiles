import { useBacklogSelection } from './use-backlog-selection.js'
import { CheckIcon, CircleAlertIcon, CircleCheckIcon, CircleStopIcon, InboxIcon, MessagesSquareIcon, WandSparklesIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { useState, type ReactNode } from 'react'

import type { BacklogSummaryView } from './api.js'
import type { BacklogSort } from './backlog-sort.js'
import { inboxRows, type InboxFilter } from './inbox-model.js'
import { linkedThreadIds, type InboxThread } from './inbox-threads.js'
import { BacklogItemMenu } from './item-actions-menu.js'
import { ItemGlyphs } from './item-glyphs.js'
import type { StartThreadItem } from './start-thread.js'
import { useBacklogActions } from './use-backlog-actions.js'
import { StatusDot } from '@dshfiles/plugin-ui/components/ui/status-dot'

const threadReasons = {
  completed: { label: 'finished and waits for review', Icon: CircleCheckIcon, tone: 'dshx:text-success' },
  aborted: { label: 'was stopped', Icon: CircleStopIcon, tone: 'dshx:text-muted-foreground' },
  blocked: { label: 'is blocked', Icon: CircleAlertIcon, tone: 'dshx:text-warning' },
  error: { label: 'stopped with an error', Icon: CircleAlertIcon, tone: 'dshx:text-destructive' },
  'max-tokens': { label: 'ran out of tokens', Icon: CircleAlertIcon, tone: 'dshx:text-warning' },
} satisfies Record<InboxThread['reason'], { readonly label: string; readonly Icon: typeof CheckIcon; readonly tone: string }>

const filters: readonly { readonly value: InboxFilter; readonly label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'needs-input', label: 'Needs you' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'suggestions', label: 'Suggestions' },
]

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

/** The attention queue: what wants a decision from the user, beside the inspector of the selected one. */
export const InboxView = (props: {
  readonly items: readonly BacklogSummaryView[]
  readonly sort: BacklogSort
  readonly threads: readonly InboxThread[]
  readonly openId: number | null
  readonly cursorId: number | null
  readonly select: (id: number) => void
  readonly openThread: (sessionId: string) => void
  readonly acknowledgeThread: (thread: InboxThread) => void
  readonly inspector: ReactNode
  readonly loaded: boolean
  readonly startThread: (items: readonly StartThreadItem[]) => void
  readonly projectPaths: readonly string[]
  readonly triageOff: boolean
}): JSX.Element => {
  const actions = useBacklogActions()
  const [filter, setFilter] = useState<InboxFilter>('all')
  const rows = inboxRows({ items: props.items, threads: props.threads, filter, sort: props.sort })
  const selection = useBacklogSelection({ items: rows.map(row => row.item), openId: props.openId, scope: filter })
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
            const count = inboxRows({ items: props.items, threads: props.threads, filter: entry.value }).length
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
          {props.loaded && rows.length === 0 ? (
            <li className="dshx:flex dshx:flex-col dshx:items-center dshx:gap-2 dshx:px-6 dshx:py-20 dshx:text-center">
              <InboxIcon aria-hidden className="dshx:size-7 dshx:text-muted-foreground" />
              <p className="dshx:text-sm dshx:font-medium">Nothing needs you</p>
              <p className="dshx:text-xs dshx:text-muted-foreground">Agents asking for a decision, blocked work and triage suggestions land here.</p>
            </li>
          ) : null}
          {rows.map(({ item, threads, hasItemReason }) => (
            <BacklogItemMenu
              key={item.id}
              item={item}
              selection={selection.selected.has(item.id) ? selection.selection : undefined}
              clearSelection={selection.clear}
              projectPaths={props.projectPaths}
              update={input => actions.update.mutate(input)}
              triage={id => actions.triage.mutate(id)}
              triageOff={props.triageOff}
              startThread={props.startThread}
              openItem={props.select}
            >
              <li
                tabIndex={-1}
                aria-label={`Item b:${String(item.id)}`}
                data-selected={selection.selected.has(item.id) || undefined}
                aria-current={item.id === props.openId ? 'true' : undefined}
                onClick={event => {
                  if (!selection.click(item.id, event)) props.select(item.id)
                }}
                className={cn(
                  'dshx:group/row dshx:relative dshx:flex dshx:cursor-default dshx:gap-3 dshx:border-b dshx:border-border/60 dshx:px-4 dshx:py-3 dshx:transition-colors dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-info/50',
                  selection.selected.has(item.id) || item.id === props.openId
                    ? 'dshx:bg-accent/70'
                    : item.id === props.cursorId
                      ? 'dshx:bg-accent/45'
                      : 'dshx:hover:bg-accent/35',
                )}
              >
                {isUnread(item) || threads.length > 0 ? (
                  <StatusDot aria-label="Unread" size="sm" tone="info" className="dshx:absolute dshx:top-1/2 dshx:left-1.5 dshx:-translate-y-1/2" />
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
                    className={cn(
                      'dshx:line-clamp-2 dshx:text-[13px] dshx:leading-snug',
                      isUnread(item) ? 'dshx:text-foreground' : 'dshx:text-muted-foreground',
                    )}
                  >
                    {hasItemReason ? headline(item) : item.title}
                  </p>
                  {item.activity.last?.kind === 'commented' ? (
                    <p className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{item.activity.last.detail}</p>
                  ) : item.preview === '' ? null : (
                    <p className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{item.preview}</p>
                  )}
                  {threads.map(thread => {
                    const reason = threadReasons[thread.reason]
                    return (
                      <div
                        key={thread.sessionId}
                        className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-1.5 dshx:text-[11px] dshx:text-muted-foreground"
                      >
                        <reason.Icon aria-hidden className={cn('dshx:size-3.5', reason.tone)} />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label={`Open thread ${thread.title}`}
                              onClick={event => {
                                event.stopPropagation()
                                props.openThread(thread.sessionId)
                              }}
                              className="dshx:min-w-0 dshx:max-w-full dshx:truncate dshx:font-medium dshx:text-foreground dshx:hover:underline"
                            >
                              {thread.title}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>{thread.title}</TooltipContent>
                        </Tooltip>
                        <span>{reason.label}</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label={`Acknowledge thread ${thread.title}`}
                              onClick={event => {
                                event.stopPropagation()
                                props.acknowledgeThread(thread)
                              }}
                              className="dshx:rounded-md dshx:p-1 dshx:hover:bg-accent dshx:hover:text-foreground"
                            >
                              <CheckIcon className="dshx:size-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Acknowledge (also clears it in the sidebar)</TooltipContent>
                        </Tooltip>
                      </div>
                    )
                  })}
                  <p className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-[11px] dshx:text-muted-foreground">
                    <ItemGlyphs.AttentionBadge attention={item.attention} compact />
                    {linkedThreadIds(item)
                      .filter(sessionId => !threads.some(thread => thread.sessionId === sessionId))
                      .map(sessionId => (
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
                        <ItemGlyphs.ProjectLabel project={item.project} />·
                      </>
                    )}
                    <span className="dshx:font-mono!">b:{item.id}</span>· {ItemGlyphs.ago(item.lastActivityAt)}
                  </p>
                </div>
                {hasItemReason ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="Resolve"
                        onClick={event => {
                          event.stopPropagation()
                          if (item.attention === 'none') actions.dismissProposal.mutate(item.id)
                          else actions.update.mutate({ id: item.id, attention: 'none' })
                        }}
                        className="dshx:self-start dshx:rounded-md dshx:p-1 dshx:text-muted-foreground dshx:opacity-0 dshx:transition-opacity dshx:group-hover/row:opacity-100 dshx:hover:bg-accent dshx:hover:text-foreground"
                      >
                        <CheckIcon className="dshx:size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{item.attention === 'none' ? 'Dismiss the suggestion' : 'Mark resolved'}</TooltipContent>
                  </Tooltip>
                ) : null}
              </li>
            </BacklogItemMenu>
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
