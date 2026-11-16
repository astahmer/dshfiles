// The `conversation.composer.context` seat this plugin fills (b:ysaj).
import type {} from '@dshfiles/rich-composer/conversation-contract'
// The failure card's action row this plugin adds "Ask to fix" to, declared by the owned Chat fork.
import type { TurnErrorActionOwnerProps } from '@dshfiles/chat/turn-error-action'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { Composer, defineClientPlugin, useContract, useSettings } from '@dshfiles/dshx/client'
import { createElement, useMemo, type ComponentType, type ReactNode } from 'react'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { ActivityStrip } from './activity-strip.js'
import { CompactionMeter } from './compaction-meter.js'
import { ConversationTargets } from './conversation-targets.js'
import { AskToFix, type FailureComposer } from './failure-actions.js'
import { Failure } from './failure.js'
import { PlanCard, type PlanCallFacts } from './plan-card.js'
import { PlanPin } from './plan-pin.js'
import { PlanProgress } from './plan-progress.js'
import { agentPlanSettings, showsTodoStrip } from './settings.js'
import { markOwnComponent, wrapSlotEntries } from './slot-wrap.js'
import { agentTargets, useTarget, type AgentTargets } from './targets.js'

type SessionId = ToolCallViewProps['sessionId']

const REGISTRANT = '@dshfiles/agent-plan'
/** Above the native default 0: this entry renders only where no native occupant holds the seat. */
const FALLBACK_PRIORITY = 100

/** Standard Session props every session-scoped seat receives; read structurally so a missing hook reads as idle. */
interface SessionSeatProps {
  readonly sessionId: SessionId
  readonly useSession?: <Selected>(select: (session: { readonly running: boolean }) => Selected) => Selected
}

const isProjectionHook = (value: unknown): value is (key: string) => unknown => typeof value === 'function'

const useRunning = (props: SessionSeatProps): boolean => props.useSession?.(session => session.running) ?? false

/** A card is on unless the master switch or its own switch is off; values still loading read as on. */
const on = <Settings extends { readonly enabled?: boolean }>(settings: Settings | undefined, key: Exclude<keyof Settings, 'enabled'>): boolean =>
  settings?.enabled !== false && settings?.[key] !== false

const planCallOf = (props: ToolCallViewProps): PlanCallFacts | undefined => {
  if (props.phase === 'preparing') return undefined
  const items = PlanProgress.itemsFromArguments(props.phase === 'start' ? props.block.argsRaw : props.block.call?.argsRaw)
  if (items === undefined) return undefined
  if (props.phase === 'start') return { items, turn: props.block.turn, callTime: props.block.time, phase: 'start', failed: false }
  return { items, turn: undefined, callTime: props.block.callTime ?? undefined, phase: 'result', failed: props.block.isError }
}

const createViews = (targets: AgentTargets<SessionId>) => {
  const wrapTodoView = (Native: ComponentType<ToolCallViewProps>): ComponentType<ToolCallViewProps> =>
    function AgentPlanTodoView(props: ToolCallViewProps): ReactNode {
      const settings = useSettings(agentPlanSettings).value
      const writes = useTarget(props.sessionId, targets.plan)
      const running = useRunning(props)
      const native = createElement(Native, props)
      const call = planCallOf(props)
      if (!on(settings, 'planCard') || call === undefined) return native
      return <PlanCard call={call} fallback={native} running={running} timing={on(settings, 'stepTiming')} writes={writes ?? []} />
    }

  const PlanPinSeat = (props: SessionSeatProps): ReactNode => {
    const settings = useSettings(agentPlanSettings).value
    const writes = useTarget(props.sessionId, targets.plan)
    const activity = useTarget(props.sessionId, targets.activity)
    const running = useRunning(props)
    if (!on(settings, 'pinnedStep')) return null
    return <PlanPin activity={activity} running={running} timing={on(settings, 'stepTiming')} writes={writes} />
  }

  const ActivitySeat = (props: SessionSeatProps): ReactNode => {
    const settings = useSettings(agentPlanSettings).value
    const activity = useTarget(props.sessionId, targets.activity)
    if (!on(settings, 'activityStrip')) return null
    return <ActivityStrip activity={activity} />
  }

  const CompactionSeat = (props: SessionSeatProps & { readonly useProjection?: unknown }): ReactNode => {
    const settings = useSettings(agentPlanSettings).value
    const useProjection = props.useProjection
    if (!on(settings, 'compactionMeter') || !isProjectionHook(useProjection)) return null
    return (
      <PluginQueryProvider>
        <CompactionMeter sessionId={props.sessionId} useProjection={useProjection} />
      </PluginQueryProvider>
    )
  }

  /** The native occupant first, ours beside it, so the native control keeps its place and behaviour. */
  const beside = <Props extends SessionSeatProps>(Seat: ComponentType<SessionSeatProps>, Native: ComponentType<Props>): ComponentType<Props> =>
    function AgentPlanBeside(props: Props): ReactNode {
      return (
        <span className="dshx-root dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1" data-dshfiles-agent-plan-beside="">
          {createElement(Native, props)}
          <Seat sessionId={props.sessionId} {...(props.useSession === undefined ? {} : { useSession: props.useSession })} />
        </span>
      )
    }

  /** The native To-dos strip above the composer, shown only where the pinned step chip does not already show the plan. */
  const wrapTodoStrip = (Native: ComponentType<SessionSeatProps>): ComponentType<SessionSeatProps> =>
    function AgentPlanTodoStrip(props: SessionSeatProps): ReactNode {
      const settings = useSettings(agentPlanSettings).value
      return showsTodoStrip(settings) ? createElement(Native, props) : null
    }

  /** "Ask to fix" in the failure card's action row; the card itself (sentence, Retry, Details) is Chat's. */
  const AskToFixSeat = (props: TurnErrorActionOwnerProps & { readonly sessionId: SessionId }): ReactNode => {
    const settings = useSettings(agentPlanSettings).value
    const composer = useContract(Composer)
    const sessionId = props.sessionId
    const actions = useMemo<FailureComposer | undefined>(() => {
      if (composer.status !== 'active') return undefined
      const service = composer.value
      return { askToFix: text => service.insert({ sessionId, text }) && service.focus({ sessionId }) }
    }, [composer, sessionId])
    if (!on(settings, 'failureCard')) return null
    return <AskToFix composer={actions} facts={Failure.fromTurnError(props)} />
  }

  return { wrapTodoView, wrapTodoStrip, PlanPinSeat, ActivitySeat, CompactionSeat, beside, AskToFixSeat }
}

export default defineClientPlugin({
  id: 'agent-plan',
  uses: ['ui'],
  inject: ['uiConversation', 'slots'],
  setup(api) {
    const ctx = api.raw.ctx
    const conversation = ctx.uiConversation
    api.lifecycle.onDispose(conversation.events.register(ConversationTargets.planWriteDefinition))
    api.lifecycle.onDispose(conversation.views.register(ConversationTargets.planView))
    api.lifecycle.onDispose(conversation.events.register(ConversationTargets.activityDefinition))
    api.lifecycle.onDispose(conversation.views.register(ConversationTargets.activityView))

    const views = createViews(agentTargets(conversation))
    const PlanPinSeat = markOwnComponent(api.bind(views.PlanPinSeat))
    const ActivitySeat = markOwnComponent(api.bind(views.ActivitySeat))
    const notOurs = (entry: { readonly registrant?: string | undefined; readonly component: unknown }) => entry.registrant !== REGISTRANT

    // todo_write: our card over the native row, which stays the fallback (setting off, unparsable call, failed call).
    api.lifecycle.onDispose(
      wrapSlotEntries<ToolCallViewProps>({
        slots: ctx.slots,
        slot: 'tool.call.toolview',
        matches: entry => entry.options.key === 'todo_write' && notOurs(entry),
        wrap: Native => api.bind(views.wrapTodoView(Native)),
      }),
    )

    // The To-dos strip (rich-composer's `todo` dock entry) repeats the pinned step: it gives way while the pin is on.
    api.lifecycle.onDispose(
      wrapSlotEntries<SessionSeatProps>({
        slots: ctx.slots,
        slot: 'conversation.input.dock',
        matches: entry => entry.options.id === 'todo' && notOurs(entry),
        wrap: Native => api.bind(views.wrapTodoStrip(Native)),
      }),
    )

    // Composer seats are single slots held by native controls (plan mode, voice input): draw ours beside the occupant.
    for (const [slot, Seat] of [
      ['conversation.input.plan', PlanPinSeat],
      ['conversation.input.activity', ActivitySeat],
    ] as const) {
      api.lifecycle.onDispose(
        wrapSlotEntries<SessionSeatProps>({ slots: ctx.slots, slot, matches: notOurs, wrap: Native => api.bind(views.beside(Seat, Native)) }),
      )
    }
    // Where no native control holds a seat, our own entry (losing to any native one) shows the chip alone.
    api.ui.register({ name: 'conversation.input.plan', priority: FALLBACK_PRIORITY, registrant: REGISTRANT }, PlanPinSeat)
    api.ui.register({ name: 'conversation.input.activity', priority: FALLBACK_PRIORITY, registrant: REGISTRANT }, ActivitySeat)

    // Inside the context meter's panel (rich-composer, b:ysaj): the meter line keeps one context item.
    api.ui.register({ name: 'conversation.composer.context', id: 'agent-plan-compaction', order: 5 }, api.bind(views.CompactionSeat))

    // The failure card is Chat's: one sentence, one Retry. "Ask to fix" joins its action row, after Retry.
    api.ui.register(
      { name: 'conversation.chat.turnErrorAction', id: 'agent-plan-ask-to-fix', order: 0, inject: sessionId => ({ sessionId }) },
      api.bind(views.AskToFixSeat),
    )
  },
})
