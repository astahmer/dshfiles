import { identityToneIndex, PalettePicker } from '@dshfiles/plugin-ui/components/palette-picker'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useId, type SyntheticEvent } from 'react'

/** A chip's popover sits in a portal, but React still bubbles its events to the row: a pick must not open the item. */
const stop = (event: SyntheticEvent): void => event.stopPropagation()

/**
 * A tag chip that is also the tag's colour menu (round eight, lane T): pressing it opens the theme's six identity
 * colours with the tag's default marked, and "Use default colour" returns a picked tag to the colour hashed from its
 * name. `className` paints the chip (its tone and wash); the button only adds hover and a touch-sized hit area.
 */
export const TagChip = (props: {
  readonly tag: string
  /** The slot the user chose, or undefined while the tag keeps its default. */
  readonly chosen: number | undefined
  readonly onChoose: (slot: number | null) => void
  readonly className?: string
}): JSX.Element => {
  const heading = useId()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`#${props.tag} colour`}
          data-tag-chip={props.tag}
          onClick={stop}
          onDoubleClick={stop}
          className={cn(
            props.className,
            // The kit sheet draws the focus ring; the chip only deepens its wash on hover and while its menu is open.
            'dshx:relative dshx:cursor-pointer dshx:transition-[background-color] dshx:duration-(--dshx-duration-hover) dshx:hover:bg-current/22 dshx:aria-expanded:bg-current/22',
            // The chip stays 20 px to read as a chip; on a touch screen its hit area reaches the 44 px row.
            'dshx:pointer-coarse:after:absolute dshx:pointer-coarse:after:-inset-y-3 dshx:pointer-coarse:after:-inset-x-1 dshx:pointer-coarse:after:content-[""]',
          )}
        >
          <span className="dshx-project-mark-letters">#{props.tag}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-labelledby={heading}
        onClick={stop}
        onDoubleClick={stop}
        onContextMenu={stop}
        className="dshx:flex dshx:w-auto dshx:flex-col dshx:items-start dshx:gap-2 dshx:p-3"
      >
        <p id={heading} className="dshx:text-xs dshx:font-medium">
          Colour of #{props.tag}
        </p>
        <PalettePicker
          label={`Colour of #${props.tag}`}
          value={props.chosen}
          defaultSlot={identityToneIndex(props.tag)}
          onChange={slot => props.onChoose(slot)}
        />
        <Button size="xs" variant="ghost" className="dshx:-ml-2" disabled={props.chosen === undefined} onClick={() => props.onChoose(null)}>
          Use default colour
        </Button>
      </PopoverContent>
    </Popover>
  )
}
