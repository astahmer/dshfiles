/** The six tones plugin-ui ships as `project-tone-balanced-<n>` classes; index order is the palette's. */
export const PROJECT_TONE_COUNT = 6
export const PROJECT_TONE_NAMES = ['sky', 'green', 'amber', 'violet', 'rose', 'indigo'] as const
export type ProjectToneName = (typeof PROJECT_TONE_NAMES)[number]

/** A project's colour: one of the six palette tones, or any `#rrggbb` the operator picked. */
export type ProjectColorChoice = { readonly kind: 'tone'; readonly tone: number } | { readonly kind: 'custom'; readonly color: string }

/** One project's colour choice, stored in the plugin's settings keyed by absolute project folder. */
export interface ProjectColorEntry {
  readonly project: string
  /** Palette index; used when `color` is empty. */
  readonly tone: number
  /** Custom `#rrggbb`, empty when the palette tone applies. */
  readonly color: string
}

export const PROJECT_COLOR_PATTERN = /^#[0-9a-f]{6}$/iu

/** Trailing separators differ between a picker result and a workspace path; compare without them. */
export const normalizeProjectPath = (path: string): string => path.replace(/[\\/]+$/u, '')

export const projectFolderName = (path: string): string => normalizeProjectPath(path).split(/[\\/]/u).filter(Boolean).at(-1) ?? path

/**
 * Stable per project folder name: importing a project without touching the swatches still gives it a colour of its own,
 * the same one on every machine. Kept identical to the thread list's tint hash so both agree before an import persists it.
 */
export const defaultProjectTone = (project: string): number => {
  let hash = 0
  for (const character of project) hash = (hash * 31 + character.charCodeAt(0)) | 0
  return Math.abs(hash) % PROJECT_TONE_COUNT
}

const wrapTone = (tone: number): number => ((tone % PROJECT_TONE_COUNT) + PROJECT_TONE_COUNT) % PROJECT_TONE_COUNT

/** The theme-aware class that sets `color:` to this tone. */
export const projectToneClass = (tone: number): string => `project-tone-balanced-${wrapTone(tone)}`

/** The colour itself, for a solid swatch or a background tint. */
export const projectToneColor = (tone: number): string => `var(--dshx-project-balanced-${wrapTone(tone)})`

export const isProjectColor = (value: string): boolean => PROJECT_COLOR_PATTERN.test(value)

/** The palette tone a project gets when nobody picks one. */
export const defaultProjectColor = (project: string): ProjectColorChoice => ({ kind: 'tone', tone: defaultProjectTone(project) })

const choiceOfEntry = (entry: ProjectColorEntry): ProjectColorChoice =>
  isProjectColor(entry.color) ? { kind: 'custom', color: entry.color.toLowerCase() } : { kind: 'tone', tone: entry.tone }

/** The chosen colour for the project, else the deterministic default for its folder name. */
export const projectColorOf = (path: string, entries: readonly ProjectColorEntry[] | undefined): ProjectColorChoice => {
  const normalized = normalizeProjectPath(path)
  const chosen = entries?.find(entry => normalizeProjectPath(entry.project) === normalized)
  return chosen === undefined ? defaultProjectColor(projectFolderName(normalized)) : choiceOfEntry(chosen)
}

/** Replace the project's choice in place, so a re-import or a later pick keeps one entry per folder. */
export const upsertProjectColor = (entries: readonly ProjectColorEntry[], project: string, choice: ProjectColorChoice): ProjectColorEntry[] => {
  const normalized = normalizeProjectPath(project)
  const rest = entries.filter(entry => normalizeProjectPath(entry.project) !== normalized)
  const entry =
    choice.kind === 'tone'
      ? { project: normalized, tone: wrapTone(choice.tone), color: '' }
      : { project: normalized, tone: 0, color: choice.color.toLowerCase() }
  return [...rest, entry]
}

/** The CSS colour a chip paints, whether it comes from the theme-aware palette or a custom pick. */
export const projectColorCss = (choice: ProjectColorChoice): string => (choice.kind === 'tone' ? projectToneColor(choice.tone) : choice.color)
