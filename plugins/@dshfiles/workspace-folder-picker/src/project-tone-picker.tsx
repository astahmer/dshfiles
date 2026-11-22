import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useId } from 'react'
import { ProjectTone, type ProjectColorChoice } from './project-tone.js'

/**
 * Six palette swatches plus a native colour picker for any other colour. A chosen preset keeps its theme-aware palette
 * value; a custom `#rrggbb` is painted as-is, in both palettes.
 */
export const ProjectTonePicker = (props: {
  readonly choice: ProjectColorChoice
  readonly name: string
  readonly onChange: (choice: ProjectColorChoice) => void
}): JSX.Element => {
  const labelId = useId()
  const custom = props.choice.kind === 'custom' ? props.choice.color : '#7c3aed'
  return (
    <TooltipProvider>
      <div className="dshx:flex dshx:items-center dshx:gap-3">
        <span className="dshx:text-sm dshx:text-muted-foreground" id={labelId}>
          Project colour
        </span>
        <div aria-labelledby={labelId} className="dshx:flex dshx:items-center dshx:gap-1.5" role="radiogroup">
          {Array.from({ length: ProjectTone.count }, (_, tone) => (
            <Tooltip key={tone}>
              <TooltipTrigger asChild>
                <button
                  aria-checked={props.choice.kind === 'tone' && tone === props.choice.tone}
                  aria-label={ProjectTone.names[tone]}
                  className={cn(
                    'dshx:size-5 dshx:cursor-pointer dshx:rounded-full dshx:border dshx:border-black/10 dshx:outline-none dshx:transition-transform dshx:hover:scale-110 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
                    props.choice.kind === 'tone' && tone === props.choice.tone && 'dshx:ring-2 dshx:ring-ring dshx:ring-offset-2 dshx:ring-offset-background',
                  )}
                  onClick={() => props.onChange({ kind: 'tone', tone })}
                  role="radio"
                  style={{ backgroundColor: ProjectTone.toneColor(tone) }}
                  type="button"
                />
              </TooltipTrigger>
              <TooltipContent side="top">{`${props.name}: ${ProjectTone.names[tone]}`}</TooltipContent>
            </Tooltip>
          ))}
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
