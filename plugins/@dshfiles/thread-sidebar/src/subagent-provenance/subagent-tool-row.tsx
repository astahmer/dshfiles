import { useMemo, useState, type ComponentProps } from 'react'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { DisclosureRow, IconAgentPresetOutlineRegular, IconInspectOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { JsonText } from '../json-text.js'
import { SubagentFeedModel } from './subagent-feed.js'
import { SubagentLivePreview, subagentStateLabel, type SubagentPreviewBindings } from './subagent-live-preview.js'
import { subagentName } from './subagent-name.js'
import { providerModelLabel } from './route-label.js'

const subagentArgumentsSchema = Schema.StructWithRest(
  Schema.Struct({
    prompt: Schema.optional(Schema.String),
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

export const SubagentProvenanceToolRow = (props: SubagentToolRowProps) => {
  const call = props.phase === 'preparing' ? null : props.phase === 'result' ? props.block.call : props.block
  const argsRaw = call?.argsRaw
  const args = useMemo(() => callArguments(argsRaw), [argsRaw])
  const routeLabel = providerModelLabel(args?.provider, args?.model)
  const result = resultText(props)
  const childId = props.phase === 'result' && !props.block.isError ? SubagentFeedModel.childIdOfResult(result) : undefined
  // The result only says the child started; the child's own state is what the row reports from here on.
  const output = childId === undefined ? result : undefined
  const running = props.useSessionStatus(statuses => (childId === undefined ? false : statuses.get(SessionId(childId))?.running === true))
  const listedTurn = props.useSessions(list =>
    childId === undefined ? undefined : list.byId[SessionId(childId)]?.projectionValues?.subagentTiming?.lastTurnCompleted,
  )
  const [feedTurn, setFeedTurn] = useState<boolean | undefined>(undefined)
  const state = SubagentFeedModel.stateOf({
    phase: props.phase,
    failed: props.phase === 'result' && props.block.isError,
    childId,
    running,
    lastTurnCompleted: feedTurn ?? listedTurn,
  })
  const name = subagentName({ sessionId: props.sessionId, callId: props.callId })
  const heading = routeLabel === undefined ? `${props.t('tool.title.subagent')} · ${name}` : `${props.t('tool.title.subagent')} · ${name} · ${routeLabel}`
  const title = childId === undefined ? heading : `${heading} · ${subagentStateLabel(props.preview.t, state)}`
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
  }

  return (
    <div className="dshx-root" {...(childId === undefined ? {} : { 'data-dshfiles-live-preview': 'agent', 'data-state': state })}>
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
