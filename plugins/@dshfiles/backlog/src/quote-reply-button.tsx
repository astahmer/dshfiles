import { ClipboardPlusIcon } from '@dshfiles/plugin-ui/icons'

/** A finished reply's action, a row of its `⋯` menu: open the Backlog capture with the reply quoted and the thread linked. */
export const QuoteReplyButton = (props: { readonly onQuote: () => void }): JSX.Element => (
  <button type="button" className="dshx-root dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm" data-dshfiles-backlog-quote-reply="" onClick={props.onQuote}>
    <ClipboardPlusIcon aria-hidden className="dshx:size-4 dshx:shrink-0" />
    Add to backlog
  </button>
)
