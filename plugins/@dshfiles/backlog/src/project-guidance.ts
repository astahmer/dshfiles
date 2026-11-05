import { BacklogItems } from './item.js'

/** One project's standing instructions for agents working on its items. */
export interface ProjectGuidanceEntry {
  readonly project: string
  readonly guidance: string
}

/** The guidance of every project that has some, keyed the way items file their project (a thread workspace folds to it). */
const mapOf = (entries: readonly ProjectGuidanceEntry[]): ReadonlyMap<string, string> =>
  new Map(entries.filter(entry => entry.guidance.trim() !== '').map(entry => [BacklogItems.projectPath(entry.project), entry.guidance.trim()] as const))

/** The list with one project's guidance replaced, added, or removed when empty. */
const withGuidance = (entries: readonly ProjectGuidanceEntry[], project: string, guidance: string): ProjectGuidanceEntry[] => {
  const key = BacklogItems.projectPath(project)
  const others = entries.filter(entry => BacklogItems.projectPath(entry.project) !== key)
  return guidance.trim() === '' ? others : [...others, { project: key, guidance: guidance.trim() }]
}

/** The block a started thread's first message opens with, one section per project of its items. */
const preamble = (sections: readonly { readonly project: string; readonly guidance: string }[]): string =>
  sections.map(section => `Project guidance for ${section.project}:\n\n${section.guidance}`).join('\n\n')

export class ProjectGuidance {
  static readonly mapOf = mapOf
  static readonly withGuidance = withGuidance
  static readonly preamble = preamble
}
