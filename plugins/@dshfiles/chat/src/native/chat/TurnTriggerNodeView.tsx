/** Recorded Turn triggers and compact manual-continuation receipts. */
import { useId, useState, useSyncExternalStore } from 'react'
import {
  BotIcon, ChevronDownIcon, ClockIcon, FileInputIcon, GitBranchIcon, GlobeIcon, GoalIcon, ListOrderedIcon, PlayIcon,
  PlugIcon, SendIcon, type LucideIcon,
} from '@dshfiles/plugin-ui/icons'
import { StatusGlyph } from '@dshfiles/plugin-ui/components/work-status'
import { RouteModel } from '@dshfiles/plugin-ui/components/model-mark'
import { RunFoldKinds } from '../../run-fold-kinds.ts'
import type { RunFoldChildRoute, RunFoldKind } from '../../run-folds.ts'
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

type ChildRouteHook = NonNullable<RunFoldKind['useChildRoute']>

/**
 * dshfiles (council round 23, item 7): line 2 of a failed subagent notice, "[mark] claude-sonnet-5-5 · Turn failed". The
 * model comes from the transcript's subagent kind (thread-sidebar provides it through `@dshfiles/chat/run-folds`, the
 * contract Chat owns), which reads the child's route projection; without a provider or a known model the line is the
 * reason alone.
 */
const FailureDetail = (props: { readonly route: RunFoldChildRoute | undefined; readonly reason: string }) => (
  <span className={css.detail} data-turn-trigger-detail>
    {props.route === undefined ? null : (
      <>
        <RouteModel provider={props.route.provider} model={props.route.model} size="md" className={css.model} />
        <span aria-hidden>·</span>
      </>
    )}
    <span className={css.failed}>{props.reason}</span>
  </span>
)

/** A separate component per provider, so the provider's hook keeps one call position. */
const RoutedFailureDetail = (props: {
  readonly useChildRoute: ChildRouteHook
  readonly childSessionId: string
  readonly useSessions: NonNullable<TurnTriggerProps['useSessions']>
  readonly reason: string
}) => <FailureDetail route={props.useChildRoute({ childSessionId: props.childSessionId, useSessions: props.useSessions })} reason={props.reason} />

const useChildRouteKind = (): RunFoldKind | undefined =>
  useSyncExternalStore(RunFoldKinds.subscribe, RunFoldKinds.get).find(kind => kind.useChildRoute !== undefined)

/** Render recorded trigger attribution above the whole-Turn disclosure. */
export function TurnTriggerNodeView(props: TurnTriggerProps) {
  const { node, t } = props
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const details = turnTriggerDetails(node.data)
  const TriggerIcon = TRIGGER_ICONS[details.icon]
  const failure = details.failure
  const childLabel = useChildLabel(props, failure?.childSessionId)
  const routeKind = useChildRouteKind()
  if (details.compact) return (
    <div className={css.continuation} data-generation-continuation>
      <span className={css.icon} aria-hidden><TriggerIcon size={14} strokeWidth={1.5} /></span>
      <span>{t(details.title)}</span>
    </div>
  )
  const date = new Date(node.data.time)
  const time = formatMessageClock(node.data.time, t)
  if (failure !== undefined) {
    // Council round 23, item 7: a failed subagent run reads on two lines, as its transcript row and dock row do:
    // "✕ Diff the ledger export against totals" over "[mark] claude-sonnet-5-5 · Turn failed", on a desktop and a phone.
    // The time moves into the disclosure, so line 1 keeps the child's name whole on a phone.
    const reason = t(failure.reason)
    const title = childLabel ?? t(details.title)
    const { useSessions } = props
    const useChildRoute = routeKind?.useChildRoute
    return (
      <section className={css.root} data-turn-trigger data-turn-trigger-failure="">
        <button
          className={`${css.header} ${css.failureHeader}`}
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => { setOpen(!open) }}
        >
          <span className={css.icon} aria-hidden><StatusGlyph status="failed" decorative /></span>
          {/* The name read aloud starts with what happened; the two lines say the rest. */}
          <span className={css.srOnly}>{`${t(details.title)}: `}</span>
          <span className={css.title}>{title}</span>
          <ChevronDownIcon strokeWidth={1.5} size={12} className={open ? css.openChevron : css.chevron} />
          {useChildRoute === undefined || useSessions === undefined || failure.childSessionId === ''
            ? <FailureDetail route={undefined} reason={reason} />
            : <RoutedFailureDetail key={routeKind?.id} useChildRoute={useChildRoute} childSessionId={failure.childSessionId} useSessions={useSessions} reason={reason} />}
        </button>
        {open && <div id={bodyId} className={css.body}>
          <p className={css.explanation}>
            <time dateTime={date.toISOString()}>{time}</time> · {t('message.trigger.explanation')}
          </p>
          <div className={css.content}><NoticeBody content={node.data.content} source={node.data.source} t={t} /></div>
        </div>}
      </section>
    )
  }
  return (
    <section className={css.root} data-turn-trigger>
      <button
        className={css.header}
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => { setOpen(!open) }}
      >
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
