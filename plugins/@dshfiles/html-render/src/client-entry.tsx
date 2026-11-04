import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { PinnedToolCalls } from '@dshfiles/chat/pinned-tool-calls'
import { QuestionHtmlPreview } from '@dshfiles/user-questions/html-preview'
import { defineClientPlugin } from '@dshfiles/dshx/client'
import { decodeJsonSafe } from '@dshfiles/dshx/json'
import { useMemo } from 'react'
import * as Schema from 'effect/Schema'
import { HtmlPageCard, HtmlPageFailed, HtmlPagePending } from './html-page-card.js'
import type { HtmlPage } from './html-page.js'
import { HTML_PREVIEW_TOOL, HTML_RENDER_TOOL, HtmlPageModel, htmlPageSchema } from './html-page.js'
import { QuestionHtmlPreviewCard } from './question-preview.js'

const REGISTRANT = '@dshfiles/html-render'
const titleArgs = Schema.Struct({ title: Schema.optional(Schema.String), path: Schema.optional(Schema.String) })

const decodeArgs = <ArgsSchema extends Schema.ConstraintDecoder<unknown>>(schema: ArgsSchema, argsRaw: string | undefined): ArgsSchema['Type'] | undefined => {
  if (argsRaw === undefined) return undefined
  try {
    const decoded = decodeJsonSafe(schema, argsRaw)
    return decoded._tag === 'Success' ? decoded.success : undefined
  } catch {
    return undefined
  }
}

const argsRawOf = (props: ToolCallViewProps): string | undefined => {
  if (props.phase === 'start') return props.block.argsRaw
  if (props.phase === 'result') return props.block.call?.argsRaw
  return undefined
}

/** The settled page: its persisted presentation metadata, else (html_render only) the recorded call arguments. */
const settledPage = (props: ToolCallViewProps): HtmlPage | undefined => {
  if (props.phase !== 'result' || props.block.isError) return undefined
  const meta = Schema.decodeUnknownResult(htmlPageSchema)(props.block.meta)
  if (meta._tag === 'Success') return meta.success
  if (props.toolName !== HTML_RENDER_TOOL) return undefined
  const fromArgs = HtmlPageModel.parse(decodeArgs(Schema.Unknown, argsRawOf(props)))
  return fromArgs.ok ? fromArgs.page : undefined
}

const errorText = (props: ToolCallViewProps): string => {
  if (props.phase !== 'result') return ''
  const text = props.block.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('\n')
  return text || props.block.error?.reason || `The page was not published. Ask the agent to retry ${props.toolName}.`
}

const HtmlRenderToolView = (props: ToolCallViewProps): JSX.Element => {
  const argsRaw = argsRawOf(props)
  const title = useMemo(() => {
    const args = decodeArgs(titleArgs, argsRaw)
    return args?.title ?? args?.path
  }, [argsRaw])
  const page = settledPage(props)
  if (page !== undefined) return <HtmlPageCard page={page} />
  if (props.phase === 'result') return <HtmlPageFailed reason={errorText(props)} pageTitle={title} />
  return <HtmlPagePending pageTitle={title} />
}

export default defineClientPlugin({
  id: 'html-render',
  uses: ['ui'],
  setup(api) {
    for (const toolName of [HTML_RENDER_TOOL, HTML_PREVIEW_TOOL]) {
      api.ui.register({ name: 'tool.call.toolview', key: toolName, registrant: REGISTRANT, locale: 'conversation' }, HtmlRenderToolView)
      api.add(PinnedToolCalls, { toolName })
    }
    // The question form's ```html preview blocks render in the same sandboxed card.
    api.add(QuestionHtmlPreview, { Component: QuestionHtmlPreviewCard })
  },
})
