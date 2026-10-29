import { useMemo, type ComponentProps } from 'react'
import { z } from 'zod'
import { DisclosureRow, IconAgentPresetOutlineRegular, IconInspectOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { JsonText } from '../json-text.js'
import { subagentName } from './subagent-name.js'
import { providerModelLabel } from './route-label.js'

const subagentArgumentsSchema = z
  .object({
    prompt: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
  })
  .passthrough()

type SubagentToolRowProps = ToolCallViewProps & PropsLocale<'conversation'>

const callArguments = (argsRaw: string | undefined) => {
  if (argsRaw === undefined) return null
  const parsed = JsonText.decode(subagentArgumentsSchema, argsRaw)
  return parsed?.success === true ? parsed.data : null
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
  const output = resultText(props)
  const name = subagentName({ sessionId: props.sessionId, callId: props.callId })
  const title = routeLabel === undefined ? `${props.t('tool.title.subagent')} · ${name}` : `${props.t('tool.title.subagent')} · ${name} · ${routeLabel}`
  const disclosure = props.useDisclosure()
  const prompt = args?.prompt?.trim()
  const expandable = (prompt !== undefined && prompt !== '') || output !== undefined
  /** The native row names its visible header through `title`; that is a heading, not hover help. */
  const disclosureProps: ComponentProps<typeof DisclosureRow> = {
    icon: <IconAgentPresetOutlineRegular />,
    title,
    open: disclosure.expanded,
    expandable,
    onToggle: disclosure.toggle,
    running: props.phase === 'preparing' || props.phase === 'start',
  }

  return (
    <div className="dshx-root">
      <DisclosureRow {...disclosureProps}>
        <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:p-3">
          {prompt === undefined || prompt === '' ? null : (
            <pre className="dshx:max-h-64 dshx:overflow-auto dshx:whitespace-pre-wrap dshx:break-words">{prompt}</pre>
          )}
          {output === undefined ? null : <pre className="dshx:max-h-64 dshx:overflow-auto dshx:whitespace-pre-wrap dshx:break-words">{output}</pre>}
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
