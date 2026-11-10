/**
 * The native Markdown renderer with only the code-fence registry applied (see `./code-fences.tsx`): for Markdown that
 * is not an assistant answer (reasoning, compaction summaries, question text) and should not grow inline-reference
 * links, yet should show a ```` ```mermaid ```` fence the way the answer does.
 */
import { CodeBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { memo, type ComponentProps, type ReactNode } from 'react'
import { CodeFenceModel } from './code-fence-transform.js'

/** The native renderer's own function: calling it keeps its streaming cache, whose frozen blocks reach the fence cache. */
const renderMarkdownText = MarkdownText.type

/** `MarkdownText` with fences a code-fence renderer claims handed to that renderer; the same props. */
export const FencedMarkdown = memo(function FencedMarkdown(props: ComponentProps<typeof MarkdownText>): ReactNode {
  const fences = CodeFenceModel.useState(CodeBlock)
  return CodeFenceModel.transform(renderMarkdownText(props), fences)
})
