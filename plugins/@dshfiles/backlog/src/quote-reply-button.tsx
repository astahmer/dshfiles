import { ClipboardPlusIcon } from '@dshfiles/plugin-ui/icons'

/** A finished reply's action: open the Backlog capture with the reply quoted and the thread linked. */
export const QuoteReplyButton = (props: { readonly onQuote: () => void }): JSX.Element => (
  <div className="dshx-root dshx:flex dshx:text-xs">
    <button
      type="button"
      aria-label="Quote this reply in a new backlog item"
      className="dshx:flex dshx:items-center dshx:gap-1 dshx:rounded dshx:text-muted-foreground dshx:hover:text-foreground dshx:focus-visible:outline-2 dshx:focus-visible:outline-ring"
      onClick={props.onQuote}
    >
      <ClipboardPlusIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
      Add to backlog
    </button>
  </div>
)
