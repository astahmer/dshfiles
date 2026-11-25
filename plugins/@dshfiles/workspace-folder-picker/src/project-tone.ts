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

const PROJECT_TONE_COUNT = 6
const PROJECT_TONE_NAMES = ['azure', 'olive', 'copper', 'violet', 'magenta', 'teal'] as const
const PROJECT_COLOR_PATTERN = /^#[0-9a-f]{6}$/iu

export type ProjectToneName = (typeof PROJECT_TONE_NAMES)[number]

const wrapTone = (tone: number): number => ((tone % PROJECT_TONE_COUNT) + PROJECT_TONE_COUNT) % PROJECT_TONE_COUNT

const choiceOfEntry = (entry: ProjectColorEntry): ProjectColorChoice =>
  PROJECT_COLOR_PATTERN.test(entry.color) ? { kind: 'custom', color: entry.color.toLowerCase() } : { kind: 'tone', tone: entry.tone }

/**
 * Pure domain helpers for per-project chip and label colours: the six theme-aware palette tones,
 * custom `#rrggbb` validation, deterministic folder-name defaults, and settings entry upserts.
 */
export class ProjectTone {
  /** The six tones plugin-ui ships as `project-tone-balanced-<n>` classes; index order is the palette's. */
  static readonly count = PROJECT_TONE_COUNT
  static readonly names = PROJECT_TONE_NAMES
  static readonly colorPattern = PROJECT_COLOR_PATTERN

  /** Trailing separators differ between a picker result and a workspace path; compare without them. */
  static readonly normalizeProjectPath = (path: string): string => path.replace(/[\\/]+$/u, '')

  static readonly projectFolderName = (path: string): string => ProjectTone.normalizeProjectPath(path).split(/[\\/]/u).filter(Boolean).at(-1) ?? path

  /**
   * Stable per project folder name: importing a project without touching the swatches still gives it a colour of its own,
   * the same one on every machine. Kept identical to the thread list's tint hash so both agree before an import persists it.
   */
  static readonly defaultTone = (project: string): number => {
    let hash = 0
    for (const character of project) hash = (hash * 31 + character.charCodeAt(0)) | 0
    return Math.abs(hash) % PROJECT_TONE_COUNT
  }

  /** The theme-aware class that sets `color:` to this tone. */
  static readonly toneClass = (tone: number): string => `project-tone-balanced-${wrapTone(tone)}`

  /** The colour itself, for a solid swatch or a background tint. */
  static readonly toneColor = (tone: number): string => `var(--dshx-project-balanced-${wrapTone(tone)})`

  static readonly isCustomColor = (value: string): boolean => PROJECT_COLOR_PATTERN.test(value)

  /** The palette tone a project gets when nobody picks one. */
  static readonly defaultColor = (project: string): ProjectColorChoice => ({ kind: 'tone', tone: ProjectTone.defaultTone(project) })

  /** The explicitly saved colour for the project, or `undefined` when no entry exists yet. */
  static readonly savedColorOf = (path: string, entries: readonly ProjectColorEntry[] | undefined): ProjectColorChoice | undefined => {
    const normalized = ProjectTone.normalizeProjectPath(path)
    const chosen = entries?.find(entry => ProjectTone.normalizeProjectPath(entry.project) === normalized)
    return chosen === undefined ? undefined : choiceOfEntry(chosen)
  }

  /** The chosen colour for the project, else the deterministic default for its folder name. */
  static readonly colorOf = (path: string, entries: readonly ProjectColorEntry[] | undefined): ProjectColorChoice =>
    ProjectTone.savedColorOf(path, entries) ?? ProjectTone.defaultColor(ProjectTone.projectFolderName(path))

  /** Replace the project's choice in place, so a re-import or a later pick keeps one entry per folder. */
  static readonly upsertColor = (entries: readonly ProjectColorEntry[], project: string, choice: ProjectColorChoice): ProjectColorEntry[] => {
    const normalized = ProjectTone.normalizeProjectPath(project)
    const rest = entries.filter(entry => ProjectTone.normalizeProjectPath(entry.project) !== normalized)
    const entry =
      choice.kind === 'tone'
        ? { project: normalized, tone: wrapTone(choice.tone), color: '' }
        : { project: normalized, tone: 0, color: choice.color.toLowerCase() }
    return [...rest, entry]
  }

  /** The CSS colour a chip paints, whether it comes from the theme-aware palette or a custom pick. */
  static readonly cssColor = (choice: ProjectColorChoice): string => (choice.kind === 'tone' ? ProjectTone.toneColor(choice.tone) : choice.color)
}
