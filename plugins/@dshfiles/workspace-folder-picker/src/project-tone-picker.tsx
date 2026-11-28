import { PalettePicker } from '@dshfiles/plugin-ui/components/palette-picker'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ProjectColorChoice } from './project-tone.js'

/**
 * The active theme's six identity swatches (the kit `PalettePicker`, one radio group) plus, beside it, a native colour
 * picker for any other colour (upstream #287). A swatch stores its slot, so the chip follows the theme; a custom
 * `#rrggbb` is painted as-is, in every theme.
 */
export const ProjectTonePicker = (props: {
  readonly choice: ProjectColorChoice
  readonly name: string
  readonly onChange: (choice: ProjectColorChoice) => void
}): JSX.Element => {
  const isCustom = props.choice.kind === 'custom'
  const custom = props.choice.kind === 'custom' ? props.choice.color : '#7c3aed'
  return (
    <TooltipProvider>
      {/* Six 44 pt seats and the custom one do not fit beside the label in a phone dialog: the label wraps above. */}
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-3 dshx:gap-y-1">
        <span className="dshx:text-sm dshx:text-muted-foreground">Project colour</span>
        <div className="dshx:flex dshx:items-center dshx:gap-1.5">
          <PalettePicker
            label="Project colour"
            onChange={tone => props.onChange({ kind: 'tone', tone })}
            value={props.choice.kind === 'tone' ? props.choice.tone : undefined}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              {/* The kit swatch's seat and ring (PalettePicker md), so the custom colour reads as a seventh choice and is as easy to hit.
                  `corner-shape: round` with `!`, as the kit's: the Host's unlayered squircle would square a full radius. */}
              <label
                className="dshx:group/custom-colour dshx:relative dshx:inline-flex dshx:size-7 dshx:shrink-0 dshx:cursor-pointer dshx:items-center dshx:justify-center dshx:rounded-full dshx:pointer-coarse:size-11"
                data-state={isCustom ? 'checked' : 'unchecked'}
              >
                <span
                  aria-hidden
                  className={cn(
                    'dshx:flex dshx:size-7 dshx:items-center dshx:justify-center dshx:rounded-full dshx:[corner-shape:round]! dshx:border-2 dshx:transition-[border-color,box-shadow] dshx:duration-(--dshx-duration-hover) dshx:group-has-focus-visible/custom-colour:ring-2 dshx:group-has-focus-visible/custom-colour:ring-ring',
                    isCustom ? 'dshx:border-foreground' : 'dshx:border-transparent dshx:group-hover/custom-colour:border-border',
                  )}
                >
                  <span
                    className="dshx:block dshx:size-5 dshx:rounded-full dshx:[corner-shape:round]!"
                    style={
                      props.choice.kind === 'custom'
                        ? { backgroundColor: props.choice.color }
                        : { background: 'conic-gradient(from 0deg, #f87171, #facc15, #4ade80, #38bdf8, #a78bfa, #f87171)' }
                    }
                  />
                </span>
                <input
                  aria-label={`Custom colour for ${props.name}`}
                  className="dshx:absolute dshx:inset-0 dshx:size-full dshx:cursor-pointer dshx:opacity-0"
                  onChange={event => {
                    const value = event.currentTarget.value.toLowerCase()
                    props.onChange({ kind: 'custom', color: value })
                  }}
                  type="color"
                  value={custom}
                />
              </label>
            </TooltipTrigger>
            <TooltipContent side="top">{`${props.name}: custom colour`}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}
