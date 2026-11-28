import { useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type RefObject } from 'react'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { DisclosureRow, IconAgentPresetOutlineRegular, IconInspectOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { RouteModel } from '@dshfiles/plugin-ui/components/model-mark'
import { StatusGlyph } from '@dshfiles/plugin-ui/components/work-status'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { LiveElapsed } from '@dshfiles/plugin-ui/components/live-elapsed'
import { formatElapsed } from '@dshfiles/plugin-ui/lib/format-duration'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { JsonText } from '../json-text.js'
import { SubagentFeedModel, type SubagentTerminal } from './subagent-feed.js'
import { SubagentLivePreview, subagentStateLabel, type SubagentPreviewBindings } from './subagent-live-preview.js'
import { useSubagentState } from './subagent-state.js'
import { SubagentRouteLabelModel } from './route-label.js'
import { TITLE_COLUMN_PROPERTY, useSubagentTitleColumn } from './subagent-title-column.js'
import css from './subagent-tool-row.module.css'

const subagentArgumentsSchema = Schema.StructWithRest(
  Schema.Struct({
    prompt: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
    provider: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

export type SubagentToolViewProps = ToolCallViewProps & PropsLocale<'conversation'>
type SubagentToolRowProps = SubagentToolViewProps & { readonly preview: SubagentPreviewBindings }

const callArguments = (argsRaw: string | undefined) => {
  if (argsRaw === undefined) return null
  const parsed = JsonText.decodeEffect(subagentArgumentsSchema, argsRaw)
  return parsed !== undefined && Result.isSuccess(parsed) ? parsed.success : null
}

const resultText = (props: SubagentToolRowProps): string | undefined => {
  if (props.phase !== 'result') return undefined
  const text = props.block.content.flatMap(content => (content.type === 'text' ? [content.text] : [])).join('\n')
  if (text !== '') return text
  return props.block.error === undefined ? undefined : `${props.block.error.name}: ${props.block.error.code}`
}

/**
 * How a record row ends once its child stopped working, after its model; a working child says it with the row's ring and
 * its live clock. A failure ends the row in failed ink instead ({@link failureWordOf}).
 */
const endingOf = (
  t: SubagentPreviewBindings['t'],
  state: ReturnType<typeof SubagentFeedModel.stateOf>,
  settledMs: number | undefined,
): readonly string[] => {
  if (state === 'finished') return settledMs === undefined || settledMs < 1_000 ? [subagentStateLabel(t, state)] : [subagentStateLabel(t, state), formatElapsed(settledMs)]
  if (state === 'interrupted') return [subagentStateLabel(t, state)]
  return []
}

/** Chat's marks on a seat whose row belongs to a run fold: a member, the head, or a failed call the run took in. */
const RUN_FOLD_MEMBER = 'data-run-fold-member'
/** The run's key and its row count, so the rows of a run of three or more share a title column (round 23, item 1). */
const RUN_FOLD_RUN = 'data-run-fold-run'
const RUN_FOLD_SIZE = 'data-run-fold-size'

interface RunFoldSeat {
  readonly inRun: boolean
  readonly runKey: string | undefined
  readonly size: number
}

const OUTSIDE_RUN: RunFoldSeat = { inRun: false, runKey: undefined, size: 0 }

/**
 * Whether the row sits in a transcript run fold ("8 calls · 6 working · …") and which run. Chat inlines its own copy of the
 * run-fold module, so no React context reaches this row; the seat's attributes are the contract, read before paint and
 * on every change.
 */
const useRunFoldSeat = (ref: RefObject<HTMLElement | null>): RunFoldSeat => {
  const [seatState, setSeatState] = useState(OUTSIDE_RUN)
  useLayoutEffect(() => {
    const seat = ref.current?.closest('[data-chat-flow-key]')
    if (seat === null || seat === undefined) return undefined
    const read = (): void => {
      const inRun = seat.hasAttribute(RUN_FOLD_MEMBER)
      const runKey = seat.getAttribute(RUN_FOLD_RUN) ?? undefined
      const size = Number(seat.getAttribute(RUN_FOLD_SIZE) ?? 0) || 0
      setSeatState(previous =>
        previous.inRun === inRun && previous.runKey === runKey && previous.size === size ? previous : { inRun, runKey, size },
      )
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(seat, { attributes: true, attributeFilter: [RUN_FOLD_MEMBER, RUN_FOLD_RUN, RUN_FOLD_SIZE] })
    return () => {
      observer.disconnect()
    }
  }, [ref])
  return seatState
}

/**
 * On a narrow pane (a phone) the row stacks like the failed-run notice (council round 25, item 1): one line held the
 * prefix, the title, a model kept at 45% and the outcome, and the title was cut mid-glyph ("Subagent · ("). The header
 * wraps there, with no gap between its lines; line 1 is the mark and the task, truncating across the whole width.
 */
const STACK_ON_NARROW_PANE =
  'dshx:@max-pane-narrow:[&>[data-disclosure-header]]:flex-wrap dshx:@max-pane-narrow:[&>[data-disclosure-header]]:gap-y-0!'
/**
 * The model and the outcome: inline items of the header on a wide pane (`contents`), on a narrow one line 2 at the
 * title's x (16 px leading + 6 px gap), the whole model, then · and the outcome, as the notice's "model · Turn failed".
 * Both in the title's size (`css.meta`; council round 25, item 2: one type size per role, the model read 15 px on a
 * phone beside the 13 px task); line 2 is 20 px, as the notice's.
 */
const META_LINE =
  'dshx:contents dshx:@max-pane-narrow:leading-[calc(20px+var(--dsh-content-font-delta-secondary,0px))] dshx:@max-pane-narrow:flex dshx:@max-pane-narrow:basis-full dshx:@max-pane-narrow:min-w-0 dshx:@max-pane-narrow:items-center dshx:@max-pane-narrow:gap-1 dshx:@max-pane-narrow:pl-[calc(22px+var(--dsh-content-font-delta,0px))]'

/**
 * The word a failed row ends with, in failed ink after its model (council round 22, item 2): "Turn failed" for a child
 * whose turn failed, "Didn't start" for a call that never started one.
 */
const failureWordOf = (t: SubagentPreviewBindings['t'], state: ReturnType<typeof SubagentFeedModel.stateOf>): string | undefined => {
  if (state === 'failed') return t('threadSidebarFailed')
  if (state === 'failed-to-start') return t('subagentRowNotStarted')
  return undefined
}

/**
 * A delegation's record row in the transcript: its task (`Subagent` when the call names none), as its dock row, then the model
 * it runs on as the kit's mark and name, with no empty mark seat inline (council round 17 B1.1, round 22 item 8). The
 * outcome ends the row (council round 23, item 1): a working child leads with the list's Working ring and ends with its
 * live clock, as in the dock; a settled one ends `Done · 5m 02s` or `Stopped`, a failed one `Turn failed` after its ✕.
 * The row prints its own time, so the tool row's call duration ("1s": the call returned once the child started) never
 * shows. It never shows a generated handle or the provider id.
 */
export const SubagentProvenanceToolRow = (props: SubagentToolRowProps) => {
  const call = props.phase === 'preparing' ? null : props.phase === 'result' ? props.block.call : props.block
  const argsRaw = call?.argsRaw
  const args = useMemo(() => callArguments(argsRaw), [argsRaw])
  const result = resultText(props)
  const childName = props.phase === 'result' && !props.block.isError ? SubagentFeedModel.childNameOfResult(result) : undefined
  const catalog = (list: Parameters<Parameters<SubagentToolRowProps['useSessions']>[0]>[0]) =>
    list.projectionsBySession[props.sessionId]?.values.subagentCatalog
  const childId = props.useSessions(list => SubagentFeedModel.childOf(catalog(list), childName))
  const catalogLabel = props.useSessions(list => (childId === undefined ? undefined : catalog(list)?.find(entry => entry.id === childId)?.label))
  // The route the child really runs on (or was started on), else the one the call asked for; never a guess.
  const childRouteLabel = props.useSessions(list => {
    if (childId === undefined) return undefined
    const summary = list.byId[SessionId(childId)]
    return SubagentRouteLabelModel.displayedAgentRouteLabel(summary?.projectionValues?.threadSidebarModelRoute, summary?.projectionValues?.subagent)
  })
  const route =
    SubagentRouteLabelModel.routeOf(childRouteLabel) ??
    SubagentRouteLabelModel.subagentRoute({ route: undefined, identity: undefined, requested: { provider: args?.provider, model: args?.model } })
  // The result only says the child started; the child's own state is what the row reports from here on.
  const output = childId === undefined ? result : undefined
  const child = useSubagentState({ childId, useSessions: props.useSessions, useSessionStatus: props.useSessionStatus })
  const [feedTurn, setFeedTurn] = useState<SubagentTerminal | undefined>(undefined)
  const state = SubagentFeedModel.stateOf({
    phase: props.phase,
    failed: props.phase === 'result' && props.block.isError,
    childId,
    running: child.working,
    terminal: feedTurn ?? child.terminal,
  })
  const task = args?.description?.trim() || catalogLabel?.trim() || undefined
  const rootRef = useRef<HTMLDivElement>(null)
  const runSeat = useRunFoldSeat(rootRef)
  // The task names the row, as in the dock, in or out of a run fold (council round 25, item 1); a row with no task keeps
  // the kind, so it never reads empty.
  const kind = task !== undefined ? undefined : props.preview.t('subagentPreviewKind')
  const title = [kind, task].filter(part => part !== undefined).join(' · ')
  // In a run of three or more rows the titles share one column, so every model starts on one x, as in the dock.
  const titleColumn = useSubagentTitleColumn({ rootRef, runKey: runSeat.runKey, size: runSeat.size, title })
  const ending = endingOf(props.preview.t, state, child.settledMs).join(' · ')
  const failure = failureWordOf(props.preview.t, state)
  const working = state === 'working' || (state === 'starting' && props.phase !== 'result')
  const since = state === 'working' ? child.since : undefined
  const disclosure = props.useDisclosure()
  const prompt = args?.prompt?.trim()
  const expandable = (prompt !== undefined && prompt !== '') || output !== undefined || childId !== undefined
  /** The native row names its visible header through `title`; that is a heading, not hover help. */
  const disclosureProps: ComponentProps<typeof DisclosureRow> = {
    // A failed row leads with the red cross the group's "✕ 1 failed" and the list use, a working one with the list's
    // Working ring; a settled one keeps the agent mark.
    icon:
      failure !== undefined ? (
        <StatusGlyph status="failed" decorative />
      ) : working ? (
        <StatusGlyph status="working" decorative />
      ) : (
        <IconAgentPresetOutlineRegular />
      ),
    title,
    open: disclosure.expanded,
    expandable,
    onToggle: disclosure.toggle,
    running: props.phase === 'preparing' || props.phase === 'start' || state === 'working',
    className: STACK_ON_NARROW_PANE,
    // The shared column sizes the title area (leading 16 px + 6 px gap, then the title, then 6 px that, with the header's
    // 8 px gap and the glyphs' side bearings, leave 16 px of paper between the widest title and the model's mark: council
    // round 24, item 2, measured in the shot); a longer title truncates in it, and a narrow pane still shrinks the area.
    // Without a column the row keeps its content width; on a narrow pane the title line takes the whole width.
    rowClassName:
      titleColumn === undefined
        ? undefined
        : 'dshx:w-[calc(var(--dshfiles-subagent-title-column)_+_28px_+_var(--dsh-content-font-delta,0px))] dshx:@max-pane-narrow:w-auto',
    // The title always truncates (council round 25, item 1): without a column it was cut mid-glyph by the row's edge. In a
    // run fold the task leads in primary ink at weight 500, as in the dock, over its secondary model and clock (round 25,
    // item 3); the native title's `color: inherit` is unlayered, so the ink takes `!`.
    titleClassName: cn('dshx:min-w-0! dshx:shrink! dshx:truncate', runSeat.inRun && 'dshx:font-medium dshx:text-foreground!'),
    // Beside the title, outside the running shimmer: 13/18 like the title, in the secondary ink over its tertiary; then
    // the outcome: the failure word in failed ink, the live clock or the settled ending in the tertiary ink.
    headerAccessory:
      route === undefined && failure === undefined && ending === '' && since === undefined ? undefined : (
        <span className={cn(css.meta, META_LINE)} data-subagent-row-meta="">
          {route === undefined ? null : (
            // In a shared title column the names stack, so an unknown family keeps its empty mark seat and its name starts on
            // the others' x, as in the dock (council round 24, item 1); inline, a lone row draws no seat (round 22, item 8).
            // In the column the model is the dock's fixed 144 px, truncating, so every outcome after it starts on one x (round
            // 24, item 2); a narrow pane lets it shrink again.
            <RouteModel
              provider={route.provider}
              model={route.model}
              size="md"
              seat={titleColumn !== undefined}
              className={cn(
                // On a narrow pane the model has line 2 to itself: whole, truncating only past the pane's edge.
                'dshx:max-w-[45%] dshx:shrink-0 dshx:@max-pane-narrow:max-w-none dshx:@max-pane-narrow:shrink',
                titleColumn !== undefined && 'dshx:w-36 dshx:@max-pane-narrow:w-auto',
              )}
            />
          )}
          {route === undefined || (failure === undefined && ending === '' && since === undefined) ? null : (
            <span aria-hidden className="dshx:hidden dshx:@max-pane-narrow:inline" data-subagent-row-separator="">
              ·
            </span>
          )}
          {failure === undefined ? null : (
            <span className="dshx:shrink-0 dshx:whitespace-nowrap dshx:text-destructive" data-subagent-failure={state}>
              {failure}
            </span>
          )}
          {since === undefined ? null : (
            <LiveElapsed active since={since} className="dshx:shrink-0 dshx:whitespace-nowrap dshx:text-muted-foreground" />
          )}
          {ending === '' ? null : (
            <span className="dshx:shrink-0 dshx:whitespace-nowrap dshx:tabular-nums dshx:text-muted-foreground" data-subagent-ending={state}>
              {ending}
            </span>
          )}
        </span>
      ),
  }

  return (
    <div
      ref={rootRef}
      className="dshx-root"
      data-dshfiles-subagent-row=""
      data-dshfiles-live-preview={childId === undefined ? undefined : 'agent'}
      data-state={childId === undefined ? undefined : (state ?? 'unknown')}
      // The row prints its own time, so tool-meta draws no call duration beside it.
      data-tool-card-timing="own"
      data-subagent-title-column={titleColumn}
      // SAFETY: React's style type lists no custom properties; this one is a plain length the row's class reads.
      style={titleColumn === undefined ? undefined : ({ [TITLE_COLUMN_PROPERTY]: `${String(titleColumn)}px` } as CSSProperties)}
    >
      <DisclosureRow {...disclosureProps}>
        <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:p-3">
          {prompt === undefined || prompt === '' ? null : (
            <pre className="dshx:max-h-64 dshx:overflow-auto dshx:whitespace-pre-wrap dshx:break-words">{prompt}</pre>
          )}
          {output === undefined ? null : <pre className="dshx:max-h-64 dshx:overflow-auto dshx:whitespace-pre-wrap dshx:break-words">{output}</pre>}
          {childId === undefined || !disclosure.expanded ? null : (
            <SubagentLivePreview {...props.preview} childId={childId} state={state} onTurnState={setFeedTurn} />
          )}
          {props.inspect === undefined ? null : (
            <Button variant="ghost" size="sm" onClick={props.inspect}>
              <IconInspectOutlineRegular />
              {props.t('row.inspect')}
            </Button>
          )}
        </div>
      </DisclosureRow>
    </div>
  )
}
