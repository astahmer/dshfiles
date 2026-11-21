/** The six tones plugin-ui ships as `project-tone-balanced-<n>` classes; index order is the palette's. */
export const PROJECT_TONE_COUNT = 6
export const PROJECT_TONE_NAMES = ['sky', 'green', 'amber', 'violet', 'teal', 'blue'] as const
export type ProjectToneName = (typeof PROJECT_TONE_NAMES)[number]

/** One project's colour choice, stored in the plugin's settings keyed by absolute project folder. */
export interface ProjectToneEntry {
  readonly project: string
  readonly tone: number
}

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

/** A chosen tint for the project, else the deterministic default for its folder name. */
export const projectToneOf = (path: string, tones: readonly ProjectToneEntry[] | undefined): number => {
  const normalized = normalizeProjectPath(path)
  const chosen = tones?.find(entry => normalizeProjectPath(entry.project) === normalized)
  return chosen?.tone ?? defaultProjectTone(projectFolderName(normalized))
}

/** Replace the project's choice in place, so a re-import or a later pick keeps one entry per folder. */
export const upsertProjectTone = (tones: readonly ProjectToneEntry[], project: string, tone: number): ProjectToneEntry[] => {
  const normalized = normalizeProjectPath(project)
  const rest = tones.filter(entry => normalizeProjectPath(entry.project) !== normalized)
  return [...rest, { project: normalized, tone: wrapTone(tone) }]
}
