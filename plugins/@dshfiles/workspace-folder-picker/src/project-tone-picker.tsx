import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useId } from 'react'
import { PROJECT_TONE_COUNT, PROJECT_TONE_NAMES, projectToneColor } from './project-tone.js'

/** Six swatches, one per shipped project tone; the chosen one carries a ring and doubles as the chip preview. */
export const ProjectTonePicker = (props: { readonly tone: number; readonly name: string; readonly onChange: (tone: number) => void }): JSX.Element => {
  const labelId = useId()
  return (
    <div className="dshx:flex dshx:items-center dshx:gap-3">
      <span className="dshx:text-sm dshx:text-muted-foreground" id={labelId}>
        Project colour
      </span>
      <div aria-labelledby={labelId} className="dshx:flex dshx:items-center dshx:gap-1.5" role="radiogroup">
        {Array.from({ length: PROJECT_TONE_COUNT }, (_, tone) => (
          <button
            key={tone}
            aria-checked={tone === props.tone}
            aria-label={PROJECT_TONE_NAMES[tone]}
            className={cn(
              'dshx:size-5 dshx:cursor-pointer dshx:rounded-full dshx:border dshx:border-black/10 dshx:outline-none dshx:transition-transform dshx:hover:scale-110 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
              tone === props.tone && 'dshx:ring-2 dshx:ring-ring dshx:ring-offset-2 dshx:ring-offset-background',
            )}
            onClick={() => props.onChange(tone)}
            role="radio"
            style={{ backgroundColor: projectToneColor(tone) }}
            title={`${props.name}: ${PROJECT_TONE_NAMES[tone]}`}
            type="button"
          />
        ))}
      </div>
    </div>
  )
}
