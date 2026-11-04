import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { InlineReferenceMarkdown } from '@dshfiles/chat/inline-reference-markdown'
import { LinkHandler, MarkdownLinks, useRegistry } from '@dshfiles/dshx/client'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useMemo } from 'react'

/** Markdown and chips put real controls inside an item row; a gesture the reader meant for one of them is not the row's. */
export const interactiveTargets = 'a, button, input, select, textarea, [role="button"], [role="link"]'

const englishLabels: MarkdownLabels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }

/**
 * Item text renders like the kit's compact Markdown, with Chat's inline references applied: `b:12` and `@{luna}` in a
 * title, body or comment open their cards the same way they do in a conversation.
 */
const ItemMarkdown = (props: { readonly text: string }): JSX.Element => {
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
    <div className="dshx:min-w-0" onAuxClickCapture={MarkdownLinks.openFromClick} onClickCapture={MarkdownLinks.openFromClick}>
      <InlineReferenceMarkdown labels={englishLabels} streaming={false} text={text} variant="compact" />
    </div>
  )
}

export const BacklogText = (props: { readonly text: string; readonly className?: string; readonly onActivate?: () => void }): JSX.Element => (
  <div
    className={cn('dshx:min-w-0', props.className)}
    onClick={event => {
      if (event.target instanceof Element && event.target.closest(interactiveTargets) !== null) {
        event.stopPropagation()
        return
      }
      props.onActivate?.()
    }}
  >
    <ItemMarkdown text={props.text} />
  </div>
)
