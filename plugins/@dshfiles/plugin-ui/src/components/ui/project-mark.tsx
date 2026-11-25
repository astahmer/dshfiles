import * as React from 'react'
import { cn } from '../../lib/utils.js'

/** The two project palettes the kit ships as `project-tone-<palette>-<n>` classes (styles.css). */
export type ProjectPalette = 'balanced' | 'cool'

const PROJECT_TONE_COUNT = 6
const wrapTone = (tone: number): number => ((tone % PROJECT_TONE_COUNT) + PROJECT_TONE_COUNT) % PROJECT_TONE_COUNT

/**
 * A stable tone index for a project name, so a project keeps its colour across reloads and devices. The same hash as
 * the thread list's `projectTextTone` and the folder picker's `ProjectTone.defaultTone`, so all three agree.
 */
export const projectToneIndex = (name: string): number => {
  let hash = 0
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) | 0
  return Math.abs(hash) % PROJECT_TONE_COUNT
}

/** First letters of the first two words (`billing-api` → `BA`), else the first two letters (`dshfiles` → `DS`). */
export const projectMarkLetters = (name: string): string => {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const letters = words.length >= 2 ? [...words[0]!].slice(0, 1).concat([...words[1]!].slice(0, 1)) : [...(words[0] ?? '')].slice(0, 2)
  return letters.length === 0 ? '?' : letters.join('').toLocaleUpperCase()
}

export interface ProjectMarkProps extends Omit<React.ComponentPropsWithoutRef<'span'>, 'children' | 'color'> {
  /** The project's display name; the mark shows its two letters. */
  readonly name: string
  /** A palette tone the owner chose (0–5); without it and without `color` the name hashes to one. */
  readonly tone?: number | undefined
  /** A custom CSS colour the owner picked (`#rrggbb`); wins over `tone`. */
  readonly color?: string | undefined
  readonly palette?: ProjectPalette | undefined
  /** `default` is a 20px tile; `dense` a 16px tile for meta lines and tabs. */
  readonly size?: 'default' | 'dense' | undefined
  /**
   * Decorative beside the project's name (the default, hidden from assistive tech); `false` when the mark stands alone,
   * which makes it an image named after the project.
   */
  readonly decorative?: boolean | undefined
}

/**
 * A project's identity tile (DESIGN.md › Colour roles 5): the project colour at 14% behind two letters in that colour
 * (pulled a quarter toward the ink so they hold AA on the tile), 4px radius. Put the project name beside it in muted text. The tile widens instead of clipping a wide pair of letters.
 */
export const ProjectMark = React.forwardRef<HTMLSpanElement, ProjectMarkProps>(function ProjectMark(
  { name, tone, color, palette = 'balanced', size = 'default', decorative = true, className, style, ...props },
  ref,
) {
  const custom = color !== undefined && color.length > 0
  const toneClass = custom ? undefined : `project-tone-${palette}-${wrapTone(tone ?? projectToneIndex(name))}`
  return (
    <span
      ref={ref}
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      data-slot="project-mark"
      data-size={size}
      className={cn(
        'dshx:inline-flex dshx:w-auto dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-sm dshx:bg-current/14 dshx:px-0.5',
        'dshx:font-sans dshx:text-2xs dshx:leading-none dshx:font-semibold dshx:tracking-tight dshx:whitespace-nowrap dshx:tabular-nums dshx:select-none',
        size === 'dense' ? 'dshx:h-4 dshx:min-w-4' : 'dshx:h-5 dshx:min-w-5',
        toneClass,
        className,
      )}
      style={custom ? { ...style, color } : style}
      {...props}
    >
      <span className="dshx-project-mark-letters">{projectMarkLetters(name)}</span>
    </span>
  )
})
