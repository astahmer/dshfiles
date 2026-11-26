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
  const custom = props.choice.kind === 'custom' ? props.choice.color : '#7c3aed'
  return (
    <TooltipProvider>
      <div className="dshx:flex dshx:items-center dshx:gap-3">
        <span className="dshx:text-sm dshx:text-muted-foreground">Project colour</span>
        <div className="dshx:flex dshx:items-center dshx:gap-1.5">
          <PalettePicker
            label="Project colour"
            onChange={tone => props.onChange({ kind: 'tone', tone })}
            value={props.choice.kind === 'tone' ? props.choice.tone : undefined}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <label
                className={cn(
                  'dshx:relative dshx:flex dshx:size-5 dshx:cursor-pointer dshx:items-center dshx:justify-center dshx:overflow-hidden dshx:rounded-full dshx:border dshx:border-black/10 dshx:outline-none dshx:hover:scale-110 dshx:focus-within:ring-2 dshx:focus-within:ring-ring dshx:focus-within:ring-offset-2',
                  props.choice.kind === 'custom' && 'dshx:ring-2 dshx:ring-ring dshx:ring-offset-2 dshx:ring-offset-background',
                )}
                style={
                  props.choice.kind === 'custom'
                    ? { backgroundColor: props.choice.color }
                    : { background: 'conic-gradient(from 0deg, #f87171, #facc15, #4ade80, #38bdf8, #a78bfa, #f87171)' }
                }
              >
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
