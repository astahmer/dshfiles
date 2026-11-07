/**
 * The native Markdown renderer with the inline-reference registry (see `./inline-references.tsx`) and the code-fence
 * registry (see `./code-fences.tsx`) applied. A separate module so a provider that only defines references or fences
 * never loads the native renderer.
 */
import { CodeBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { memo, type ComponentProps, type ReactNode } from 'react'
import { CodeFenceModel } from './code-fence-transform.js'
import { InlineReferenceModel } from './inline-references.js'

type MarkdownTextProps = ComponentProps<typeof MarkdownText>
/** The native renderer's own function: calling it keeps its streaming cache, whose frozen blocks reach the block cache. */
const renderMarkdownText = MarkdownText.type

/**
 * Fenced code, links and controls are left alone by references; inline code is offered as the `code` surface. A fence
 * whose language a code-fence renderer claims is handed to that renderer with the native card as its fallback. While a
 * message streams, the renderer's frozen blocks keep their element identity, so their transformed blocks come from the
 * caches and only the growing tail re-matches.
 */
export const InlineReferenceMarkdown = memo(function InlineReferenceMarkdown(props: MarkdownTextProps): ReactNode {
  const references = InlineReferenceModel.useState()
  const fences = CodeFenceModel.useState(CodeBlock)
  const output = renderMarkdownText(props)
  return CodeFenceModel.transform(InlineReferenceModel.transform(output, references), fences)
})
