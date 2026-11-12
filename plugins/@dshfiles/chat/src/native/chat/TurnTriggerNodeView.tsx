/** An independent, expandable notice explaining a non-human Turn trigger. */
import { useId, useState } from 'react'
import {
  BotIcon, ChevronDownIcon, ClockIcon, FileInputIcon, GitBranchIcon, GlobeIcon, GoalIcon, ListOrderedIcon, PlugIcon,
  SendIcon, type LucideIcon,
} from '@dshfiles/plugin-ui/icons'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import { formatMessageClock } from './message-chrome.ts'
import { NoticeBody } from './ContextBody.tsx'
import { turnTriggerDetails, type TurnTriggerIcon } from './turn-trigger.ts'
import css from './TurnTriggerNodeView.module.css'

const TRIGGER_ICONS: Record<TurnTriggerIcon, LucideIcon> = {
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

/** Render recorded trigger attribution above the whole-Turn disclosure. */
export function TurnTriggerNodeView({ node, t }: Pick<ChatNodeViewProps<'turn-trigger'>, 'node' | 't'>) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const details = turnTriggerDetails(node.data)
  const TriggerIcon = TRIGGER_ICONS[details.icon]
  const date = new Date(node.data.time)
  const time = formatMessageClock(node.data.time, t)
  return (
    <section className={css.root} data-turn-trigger>
      <button className={css.header} type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => { setOpen(!open) }}>
        <span className={css.icon} aria-hidden><TriggerIcon size={14} strokeWidth={1.5} /></span>
        <span className={css.title}>{t(details.title)}</span>
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
