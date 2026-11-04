/**
 * The native Markdown renderer with the inline-reference registry applied (see `./inline-references.tsx`). A separate
 * module so a provider that only defines references never loads the native renderer.
 */
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { memo, type ComponentProps, type ReactNode } from 'react'
import { InlineReferenceModel } from './inline-references.tsx'

type MarkdownTextProps = ComponentProps<typeof MarkdownText>
/** The native renderer's own function: calling it keeps its streaming cache, whose frozen blocks reach the block cache. */
const renderMarkdownText = MarkdownText.type

/**
 * Fenced code, links and controls are left alone; inline code is offered as the `code` surface. While a message
 * streams, the renderer's frozen blocks keep their element identity, so their transformed blocks come from the cache
 * and only the growing tail re-matches.
 */
export const InlineReferenceMarkdown = memo(function InlineReferenceMarkdown(props: MarkdownTextProps): ReactNode {
  const state = InlineReferenceModel.useState()
  const output = renderMarkdownText(props)
  return InlineReferenceModel.transform(output, state)
})
