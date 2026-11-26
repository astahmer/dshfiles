import { useMemo, useState, type ComponentProps } from 'react'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { DisclosureRow, IconAgentPresetOutlineRegular, IconInspectOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { RouteModel } from '@dshfiles/plugin-ui/components/model-mark'
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

/** How a record row ends once its child stopped working; a working child says it with the row's spinner, not a word. */
const endingOf = (
  t: SubagentPreviewBindings['t'],
  state: ReturnType<typeof SubagentFeedModel.stateOf>,
  settledMs: number | undefined,
): readonly string[] => {
  if (state === 'finished') return settledMs === undefined || settledMs < 1_000 ? [subagentStateLabel(t, state)] : [subagentStateLabel(t, state), formatElapsed(settledMs)]
  if (state === 'interrupted' || state === 'failed' || state === 'failed-to-start') return [subagentStateLabel(t, state)]
  return []
}

/**
 * A delegation's record row in the transcript: `Subagent · {description}`, the same glyph and name as its dock row and
 * no clock, then the model it runs on as the kit's mark and name (council round 17 B1.1). It ends as `Done · 5m 02s`,
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
  const title = [props.preview.t('subagentPreviewKind'), task, ...endingOf(props.preview.t, state, child.settledMs)]
    .filter(part => part !== undefined)
    .join(' · ')
  const disclosure = props.useDisclosure()
  const prompt = args?.prompt?.trim()
  const expandable = (prompt !== undefined && prompt !== '') || output !== undefined || childId !== undefined
  /** The native row names its visible header through `title`; that is a heading, not hover help. */
  const disclosureProps: ComponentProps<typeof DisclosureRow> = {
    icon: <IconAgentPresetOutlineRegular />,
    title,
    open: disclosure.expanded,
    expandable,
    onToggle: disclosure.toggle,
    running: props.phase === 'preparing' || props.phase === 'start' || state === 'working',
    // Beside the title, outside the running shimmer: 13/18 like the title, in the secondary ink over its tertiary.
    ...(route === undefined
      ? {}
      : { headerAccessory: <RouteModel provider={route.provider} model={route.model} size="md" className="dshx:max-w-[45%] dshx:shrink-0" /> }),
  }

  return (
    <div className="dshx-root" {...(childId === undefined ? {} : { 'data-dshfiles-live-preview': 'agent', 'data-state': state ?? 'unknown' })}>
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
