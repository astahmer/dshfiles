import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { LinkHandler, MarkdownLinks, useRegistry } from '@dshfiles/dshx/client'
import { useMemo } from 'react'
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
}

/** The Host Markdown renderer with English chrome, whose custom-scheme links open through `LinkHandler`. */
export const Markdown = (props: MarkdownProps): JSX.Element => {
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
      <MarkdownText text={text} labels={props.labels ?? englishLabels} variant={props.variant ?? 'compact'} streaming={props.streaming ?? false} />
    </div>
  )
}
