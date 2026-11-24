import { ProjectTone } from './project-tone.js'

/** One project's chip label, stored in the plugin's settings keyed by absolute project folder. */
export interface ProjectNameEntry {
  readonly project: string
  readonly name: string
}

/**
 * Per-project display name for chips and labels. A long folder name makes a tab strip unreadable, so a project can carry
 * a shorter label; an empty entry means the folder name still applies.
 */
export class ProjectName {
  /** The saved label for the project, trimmed; `undefined` when it has none (or it was blank). */
  static readonly displayNameOf = (path: string, entries: readonly ProjectNameEntry[] | undefined): string | undefined => {
    const normalized = ProjectTone.normalizeProjectPath(path)
    const entry = entries?.find(candidate => ProjectTone.normalizeProjectPath(candidate.project) === normalized)
    const name = entry?.name.trim() ?? ''
    return name === '' ? undefined : name
  }

  /** Replace the project's label; a blank name drops the entry so the folder name applies again. */
  static readonly upsert = (entries: readonly ProjectNameEntry[], project: string, name: string): ProjectNameEntry[] => {
    const normalized = ProjectTone.normalizeProjectPath(project)
    const rest = entries.filter(entry => ProjectTone.normalizeProjectPath(entry.project) !== normalized)
    const trimmed = name.trim()
    return trimmed === '' ? rest : [...rest, { project: normalized, name: trimmed }]
  }
}
