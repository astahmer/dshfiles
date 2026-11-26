/** Recorded Turn triggers and compact manual-continuation receipts. */
import { useId, useState } from 'react'
import {
  BotIcon, ChevronDownIcon, ClockIcon, FileInputIcon, GitBranchIcon, GlobeIcon, GoalIcon, ListOrderedIcon, PlayIcon,
  PlugIcon, SendIcon, type LucideIcon,
} from '@dshfiles/plugin-ui/icons'
import { StatusGlyph } from '@dshfiles/plugin-ui/components/work-status'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import { formatMessageClock } from './message-chrome.ts'
import { NoticeBody } from './ContextBody.tsx'
import { turnTriggerDetails, type TurnTriggerIcon } from './turn-trigger.ts'
import css from './TurnTriggerNodeView.module.css'

const TRIGGER_ICONS: Record<TurnTriggerIcon, LucideIcon> = {
  continue: PlayIcon,
  request: FileInputIcon,
  goal: GoalIcon,
  agent: SendIcon,
  team: BotIcon,
  subagent: BotIcon,
  github: GitBranchIcon,
  webhook: GlobeIcon,
  schedule: ClockIcon,
  job: ListOrderedIcon,
  plugin: PlugIcon,
}

type TurnTriggerProps = Pick<ChatNodeViewProps<'turn-trigger'>, 'node' | 't'> &
  Partial<Pick<ChatNodeViewProps<'turn-trigger'>, 'sessionId' | 'useSessions'>>

/**
 * dshfiles (council round 22, item 2): the name a failed subagent notice gives its child, the description its parent's
 * catalog holds (as the list, the dock and the child's header do); none when the catalog does not list it.
 */
const useChildLabel = (props: TurnTriggerProps, childSessionId: string | undefined): string | undefined => {
  const { sessionId, useSessions } = props
  // A notice outside a Session view (or a test without one) names no child: the hook still runs once per render.
  const read = useSessions ?? ((select: (list: undefined) => string | undefined) => select(undefined))
  return read(list =>
    childSessionId === undefined || childSessionId === '' || sessionId === undefined || list === undefined
      ? undefined
      : list.projectionsBySession[sessionId]?.values.subagentCatalog?.find(entry => entry.id === childSessionId)?.label?.trim() || undefined,
  )
}

/** Render recorded trigger attribution above the whole-Turn disclosure. */
export function TurnTriggerNodeView(props: TurnTriggerProps) {
  const { node, t } = props
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const details = turnTriggerDetails(node.data)
  const TriggerIcon = TRIGGER_ICONS[details.icon]
  const failure = details.failure
  const childLabel = useChildLabel(props, failure?.childSessionId)
  if (details.compact) return (
    <div className={css.continuation} data-generation-continuation>
      <span className={css.icon} aria-hidden><TriggerIcon size={14} strokeWidth={1.5} /></span>
      <span>{t(details.title)}</span>
    </div>
  )
  const date = new Date(node.data.time)
  const time = formatMessageClock(node.data.time, t)
  // A failed subagent run names its child and why, with the red cross the failed rows use: "Check refund rounding ·
  // failed before it finished". Its name still starts with the notice's own title.
  const named = failure === undefined || childLabel === undefined ? undefined : `${childLabel} · ${t(failure.reason)}`
  return (
    <section className={css.root} data-turn-trigger data-turn-trigger-failure={failure === undefined ? undefined : ''}>
      <button
        className={css.header}
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        {...(named === undefined ? {} : { 'aria-label': `${t(details.title)}: ${named}, ${time}` })}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.icon} aria-hidden>
          {failure === undefined ? <TriggerIcon size={14} strokeWidth={1.5} /> : <StatusGlyph status="failed" decorative />}
        </span>
        <span className={css.title}>{named ?? t(details.title)}</span>
        <time className={css.time} dateTime={date.toISOString()}>{time}</time>
        <ChevronDownIcon strokeWidth={1.5} size={12} className={open ? css.openChevron : css.chevron} />
      </button>
      {open && <div id={bodyId} className={css.body}>
        <p className={css.explanation}>{t('message.trigger.explanation')}</p>
        <div className={css.content}><NoticeBody content={node.data.content} source={node.data.source} t={t} /></div>
      </div>}
    </section>
  )
}
