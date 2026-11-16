import { BacklogMentionHandle } from './backlog-mention-handle.js'
import { ItemGlyphs } from './item-glyphs.js'

/**
 * The item detail's header line: project, then the item's own title, then its `b:` id as a muted mono chip (still
 * the drag handle that mentions the item in a thread). The id is for copying, not for reading.
 */
export const PeekHeading = (props: {
  readonly item: {
    readonly id: number
    readonly ref?: string | undefined
    readonly title: string
    readonly project: string | null
    readonly freshness: string
  }
}): JSX.Element => (
  <nav aria-label="Breadcrumb" className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground">
    {props.item.project === null ? null : (
      <>
        <span className="dshx:shrink-0 dshx:@max-pane-narrow:hidden">
          <ItemGlyphs.ProjectLabel project={props.item.project} />
        </span>
        <span aria-hidden className="dshx:@max-pane-narrow:hidden">
          /
        </span>
      </>
    )}
    <span data-peek-title="" className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-medium dshx:text-foreground">
      {props.item.title}
    </span>
    <BacklogMentionHandle item={props.item} className="dshx:shrink-0 dshx:rounded-sm dshx:bg-muted dshx:px-1 dshx:text-2xs dshx:text-muted-foreground" />
    {props.item.freshness === 'fresh' ? null : <span className="dshx:shrink-0 dshx:rounded-full dshx:bg-muted dshx:px-1.5 dshx:text-2xs">{props.item.freshness}</span>}
  </nav>
)
