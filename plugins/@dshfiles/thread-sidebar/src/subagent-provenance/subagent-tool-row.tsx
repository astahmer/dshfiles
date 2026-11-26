import { useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type RefObject } from 'react'
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
import { formatElapsed } from '@dshfiles/plugin-ui/lib/format-duration'
import { JsonText } from '../json-text.js'
import { SubagentFeedModel, type SubagentTerminal } from './subagent-feed.js'
import { SubagentLivePreview, subagentStateLabel, type SubagentPreviewBindings } from './subagent-live-preview.js'
import { useSubagentState } from './subagent-state.js'
import { SubagentRouteLabelModel } from './route-label.js'

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
 * How a record row ends once its child stopped working; a working child says it with the row's spinner, not a word. A
 * failure is not part of the title: it ends the row in failed ink ({@link failureWordOf}).
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

/** Chat's mark on a seat whose row belongs to a run fold: a member, the head, or a failed call the run took in. */
const RUN_FOLD_MEMBER = 'data-run-fold-member'

/**
 * Whether the row sits in a transcript run fold ("8 calls · 6 working · …"), whose summary already names the kind, so
 * the row drops its "Subagent ·" prefix (council round 22, item 9). Chat inlines its own copy of the run-fold module,
 * so no React context reaches this row; the seat's attribute is the contract, read before paint and on every change.
 */
const useInRunFold = (ref: RefObject<HTMLElement | null>): boolean => {
  const [inRun, setInRun] = useState(false)
  useLayoutEffect(() => {
    const seat = ref.current?.closest('[data-chat-flow-key]')
    if (seat === null || seat === undefined) return undefined
    const read = (): void => {
      setInRun(seat.hasAttribute(RUN_FOLD_MEMBER))
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(seat, { attributes: true, attributeFilter: [RUN_FOLD_MEMBER] })
    return () => {
      observer.disconnect()
    }
  }, [ref])
  return inRun
}

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
 * A delegation's record row in the transcript: `Subagent · {description}`, the same glyph and name as its dock row and
 * no clock, then the model it runs on as the kit's mark and name, with no empty mark seat inline (council round 17 B1.1, round 22 item 8). It ends as `Done · 5m 02s`,
 * `Failed` or `Stopped`; it never shows a generated handle or the provider id.
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
  const inRun = useInRunFold(rootRef)
  // In a run fold the summary names the kind; a row with no task keeps it, so it never reads empty.
  const kind = inRun && task !== undefined ? undefined : props.preview.t('subagentPreviewKind')
  const title = [kind, task, ...endingOf(props.preview.t, state, child.settledMs)]
    .filter(part => part !== undefined)
    .join(' · ')
  const failure = failureWordOf(props.preview.t, state)
  const disclosure = props.useDisclosure()
  const prompt = args?.prompt?.trim()
  const expandable = (prompt !== undefined && prompt !== '') || output !== undefined || childId !== undefined
  /** The native row names its visible header through `title`; that is a heading, not hover help. */
  const disclosureProps: ComponentProps<typeof DisclosureRow> = {
    // A failed row leads with the red cross the group's "2 failed" and the list use, not the agent mark.
    icon: failure === undefined ? <IconAgentPresetOutlineRegular /> : <StatusGlyph status="failed" decorative />,
    title,
    open: disclosure.expanded,
    expandable,
    onToggle: disclosure.toggle,
    running: props.phase === 'preparing' || props.phase === 'start' || state === 'working',
    // Beside the title, outside the running shimmer: 13/18 like the title, in the secondary ink over its tertiary; a
    // failed row ends with its failure word.
    headerAccessory:
      route === undefined && failure === undefined ? undefined : (
        <>
          {route === undefined ? null : <RouteModel provider={route.provider} model={route.model} size="md" className="dshx:max-w-[45%] dshx:shrink-0" />}
          {failure === undefined ? null : (
            <span className="dshx:shrink-0 dshx:whitespace-nowrap dshx:text-destructive" data-subagent-failure={state}>
              {failure}
            </span>
          )}
        </>
      ),
  }

  return (
    <div
      ref={rootRef}
      className="dshx-root"
      data-dshfiles-subagent-row=""
      data-dshfiles-live-preview={childId === undefined ? undefined : 'agent'}
      data-state={childId === undefined ? undefined : (state ?? 'unknown')}
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
