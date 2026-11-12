import type { InitPlan, SetupPack, SetupPlanResult } from './api.js'

/** A plugin as Review shows it: the title people read, the package name only behind Show details. */
export interface PlannedPlugin {
  readonly name: string
  readonly title: string
}

export interface PackGroup {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly plugins: readonly PlannedPlugin[]
}

/** The plan as Review lists it: each chosen pack with its plugins, then what came along or stays. */
export interface ReviewGroups {
  readonly packs: readonly PackGroup[]
  /** Plugins another plugin needs; no pack named them. */
  readonly needed: readonly PlannedPlugin[]
  /** Plugins the profile already held outside these packs (extend). */
  readonly kept: readonly PlannedPlugin[]
}

export interface PlannedFile {
  readonly path: string
  readonly change: string
}

const plural = (count: number, word: string): string => `${String(count)} ${word}${count === 1 ? '' : 's'}`

/** A plugin a pack lists sits under the first chosen pack that lists it, so every planned plugin appears once. */
const groupsOf = (input: {
  readonly plan: InitPlan
  readonly packs: readonly SetupPack[]
  readonly titles: Readonly<Record<string, string>>
}): ReviewGroups => {
  const titled = (name: string): PlannedPlugin => ({ name, title: input.titles[name] ?? name.replace(/^@[^/]+\//u, '') })
  const placed = new Set<string>()
  const packs = input.plan.packs.map(chosen => {
    const listed = input.packs.find(candidate => candidate.id === chosen.id)?.plugins ?? []
    const plugins = listed
      .map(directory => `@dshfiles/${directory}`)
      .filter(name => input.plan.plugins.includes(name) && !input.plan.suppliers.includes(name) && !placed.has(name))
    for (const name of plugins) placed.add(name)
    return {
      id: chosen.id,
      title: chosen.title,
      summary: input.packs.find(candidate => candidate.id === chosen.id)?.summary ?? '',
      plugins: plugins.map(titled),
    }
  })
  return { packs, needed: input.plan.plugins.filter(name => !placed.has(name)).map(titled), kept: input.plan.kept.map(titled) }
}

/** The one sentence Review leads with. */
const summaryOf = (plan: InitPlan): string => {
  const chosen = `${plural(plan.packs.length, 'pack')}, ${plural(plan.plugins.length, 'plugin')}`
  if (plan.created) return `Creates the ${plan.profile} profile with ${chosen}.`
  if (plan.upToDate) return `The ${plan.profile} profile already has these ${chosen}.`
  return `Adds ${plural(plan.linked.length, 'plugin')} to the ${plan.profile} profile, for ${plural(plan.packs.length, 'pack')}.`
}

const changeLabels = new Map([
  ['new profile file', 'New file'],
  ['pnpm install', 'Installs the plugins'],
  ['link: dependency and bundle entry', 'Adds the plugins'],
])

const relativeTo = (home: string, path: string): string => (path.startsWith(`${home}/`) ? path.slice(home.length + 1) : path)

/** What gets written, relative to the DSH home (the page names the home once), with the setup marker last. */
const filesOf = (input: { readonly result: SetupPlanResult; readonly dshHome: string }): readonly PlannedFile[] => {
  const files = (input.result.plan?.files ?? []).map(file => ({
    path: relativeTo(input.dshHome, file.path),
    change: changeLabels.get(file.change) ?? `${file.change.charAt(0).toUpperCase()}${file.change.slice(1)}`,
  }))
  const marker = input.result.marker
  return marker === null ? files : [...files, { path: relativeTo(input.dshHome, marker.path), change: 'Remembers the packs you chose' }]
}

export class ReviewModel {
  static readonly plural = plural
  static readonly groups = groupsOf
  static readonly summary = summaryOf
  static readonly files = filesOf
}
