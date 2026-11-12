import type { EditedFile } from './turn-activity.js'

/** Chips shown before the rest fold into "+N more"; a turn that touched more files shows them in its walkthrough. */
export const MAX_FILE_CHIPS = 4

const baseName = (path: string): string => path.split('/').filter(Boolean).at(-1) ?? path

/**
 * The turn footer's changed files (visual refresh T2.3): one quiet chip per file, `pricing.ts +5 −0`, opening that
 * turn's review in the Changes facet (or the file itself while the Host has not addressed the turn's changes yet).
 * They replace the footer's "Edited N files" count, so the edits are named once (GitHub #47).
 */
export const TurnFileChips = (props: {
  readonly files: readonly EditedFile[]
  readonly onOpen: (file: EditedFile) => void
  /** Whether a chip opens the Changes review (true) or the file in the editor (false). */
  readonly opensChanges: boolean
  readonly onMore: () => void
  readonly moreOpen: boolean
}): JSX.Element => {
  const shown = props.files.slice(0, MAX_FILE_CHIPS)
  const hidden = props.files.length - shown.length
  return (
    <span className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-1" data-dshfiles-turn-file-chips="">
      {shown.map(file => (
        <button
          aria-label={`${props.opensChanges ? 'Review' : 'Open'} ${file.path}${props.opensChanges ? ' in Changes' : ''}, ${String(file.added)} added, ${String(file.removed)} removed`}
          className="dshx:flex dshx:h-5 dshx:min-w-0 dshx:max-w-full dshx:items-center dshx:gap-1 dshx:rounded-sm dshx:border dshx:border-border dshx:bg-muted dshx:px-1.5 dshx:font-mono dshx:text-foreground dshx:hover:bg-accent"
          data-dshfiles-turn-file-chip={file.path}
          key={file.path}
          onClick={() => props.onOpen(file)}
          type="button"
        >
          <span className="dshx:min-w-0 dshx:truncate">{baseName(file.path)}</span>
          {file.added + file.removed > 0 && (
            <span className="dshx:shrink-0 dshx:tabular-nums">
              <span className="dshx:text-success">+{file.added}</span> <span className="dshx:text-destructive">−{file.removed}</span>
            </span>
          )}
        </button>
      ))}
      {hidden > 0 && (
        <button
          aria-expanded={props.moreOpen}
          className="dshx:flex dshx:h-5 dshx:shrink-0 dshx:items-center dshx:rounded-sm dshx:px-1 dshx:hover:text-foreground"
          onClick={props.onMore}
          type="button"
        >
          +{hidden} more
        </button>
      )}
    </span>
  )
}
