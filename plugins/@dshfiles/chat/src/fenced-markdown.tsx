/**
 * The native Markdown renderer with only the code-fence registry applied (see `./code-fences.tsx`): for Markdown that
 * is not an assistant answer (reasoning, compaction summaries, question text) and should not grow inline-reference
 * links, yet should show a ```` ```mermaid ```` fence the way the answer does.
 */
import { CodeBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { useRegistry } from '@dshfiles/dshx/client'
import { memo, type ComponentProps, type ReactNode } from 'react'
import { CodeFenceSeat } from './code-fence-seat.js'
import { CodeFences } from './code-fences.js'
import { MarkdownProse } from './markdown-prose.js'

/** The native renderer's own function: calling it keeps its streaming cache. */
const renderMarkdownText = MarkdownText.type

/** `MarkdownText` with fences a code-fence renderer claims handed to that renderer; the same props. */
export const FencedMarkdown = memo(function FencedMarkdown(props: ComponentProps<typeof MarkdownText>): ReactNode {
  const renderers = useRegistry(CodeFences)
  const prose = MarkdownProse.useState(CodeBlock)
  return (
    <CodeFenceSeat renderers={renderers} labels={props.labels.code}>
      {MarkdownProse.transform(renderMarkdownText(props), prose, 'fenced')}
    </CodeFenceSeat>
  )
})
