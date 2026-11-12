import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { LinkHandler, MarkdownLinks, useRegistry } from '@dshfiles/dshx/client'
import { useMemo, type ComponentProps, type ComponentType } from 'react'
import { cn } from '../lib/utils.js'

const englishLabels: MarkdownLabels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }

export interface MarkdownProps {
  readonly text: string
  /** `compact` (the default) uses secondary text sizing for panels and cards; `body` uses document typography. */
  readonly variant?: 'compact' | 'body'
  readonly streaming?: boolean
  /** Translated chrome; keep the object stable, a new identity discards the streaming render cache. */
  readonly labels?: MarkdownLabels
  readonly className?: string
  /**
   * Swaps the text renderer for a surface that must also apply a code-fence renderer: pass Chat's `FencedMarkdown` and a
   * ```` ```mermaid ```` fence becomes a diagram wherever `@dshfiles/mermaid-diagrams` is active, the native code card
   * otherwise.
   */
  readonly renderText?: ComponentType<ComponentProps<typeof MarkdownText>> | undefined
}

/** The Host Markdown renderer with English chrome, whose custom-scheme links open through `LinkHandler`. */
export const Markdown = (props: MarkdownProps): JSX.Element => {
  const Text = props.renderText ?? MarkdownText
  const handlers = useRegistry(LinkHandler)
  const text = useMemo(
    () =>
      MarkdownLinks.rewrite(
        props.text,
        handlers.map(handler => handler.scheme),
      ),
    [props.text, handlers],
  )
  return (
    <div className={cn('dshx:min-w-0', props.className)} onClickCapture={MarkdownLinks.openFromClick} onAuxClickCapture={MarkdownLinks.openFromClick}>
      <Text text={text} labels={props.labels ?? englishLabels} variant={props.variant ?? 'compact'} streaming={props.streaming ?? false} />
    </div>
  )
}
