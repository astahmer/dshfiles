import { CommandKeys, type CommandItem } from '@dshfiles/dshx/client'

/** One row of the cheat sheet: what a key does and which keys do it. */
export interface CheatSheetRow {
  readonly id: string
  readonly label: string
  readonly keys: readonly string[]
  /** Keycaps the Host already presented (`⌘`, `K`), shown as they are rather than read as a key spec. */
  readonly presented?: boolean
}

export interface CheatSheetSection {
  readonly id: string
  readonly title: string
  readonly rows: readonly CheatSheetRow[]
}

/** A Host shortcut catalog row, as the Web registry publishes it (keycaps already presented). */
export interface HostShortcutRow {
  readonly id: string
  readonly label: string
  readonly keys: readonly string[]
}

const SCOPE_TITLES = new Map<string, string>([
  ['global', 'Global'],
  ['page', 'Global'],
  ['not-typing', 'Global'],
  ['list', 'Lists'],
  ['triage', 'Triage'],
  ['changes', 'Changes'],
  ['composer', 'Composer'],
])

/**
 * Host registry labels use the core's words ("New Session", "Search sessions"). The sheet speaks the glossary
 * (docs/ade-ux §3): session and conversation are threads. Case follows the original word.
 */
const glossary = (label: string): string =>
  label.replace(/\b(sessions?|conversations?)\b/giu, (word, _match: string, offset: number) => {
    const thread = word.toLocaleLowerCase().endsWith('s') ? 'threads' : 'thread'
    // Sentence case: capital only where the label starts.
    return offset === 0 ? thread.charAt(0).toLocaleUpperCase() + thread.slice(1) : thread
  })

/**
 * What a row does, for spotting a Host chord that repeats one of ours: glossary words, lower case, without the verbs
 * and qualifiers that only phrase it differently ("Open keyboard shortcuts" = "Keyboard shortcuts", "Toggle left
 * sidebar" = "Toggle sidebar").
 */
const intent = (label: string): string =>
  glossary(label)
    .toLocaleLowerCase()
    .replace(/\b(open|show|the|left)\b/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()

/** Sections in reading order; any other section title follows them alphabetically. */
const ORDER = ['Global', 'Go to', 'Lists', 'Triage', 'Changes', 'Composer', 'App']

/**
 * Group every bound key by where it works: a command's own `section`, else its scope. Commands without keys are not
 * shortcuts and stay out; the same title and keys listed twice (two mounted lists) collapse into one row. Host
 * registry chords go under "App", minus any a command already lists.
 */
const sections = (input: {
  readonly commands: readonly CommandItem[]
  readonly keys: ReadonlyMap<string, readonly string[]>
  readonly host: readonly HostShortcutRow[]
  readonly singleKeys: boolean
}): readonly CheatSheetSection[] => {
  const byTitle = new Map<string, CheatSheetRow[]>()
  const seen = new Set<string>()
  const add = (title: string, row: CheatSheetRow): void => {
    const signature = `${title}\u0000${row.label}\u0000${row.keys.join('|')}`
    if (seen.has(signature)) return
    seen.add(signature)
    const rows = byTitle.get(title) ?? []
    rows.push(row)
    byTitle.set(title, rows)
  }
  for (const command of input.commands) {
    if (command.enabled === false) continue
    const specs = (input.keys.get(command.id) ?? command.keys ?? []).filter(spec => {
      const parsed = CommandKeys.parse(spec)
      return parsed !== undefined && (input.singleKeys || !parsed.characterKey)
    })
    if (specs.length === 0) continue
    add(command.section ?? SCOPE_TITLES.get(command.scope ?? 'global') ?? 'Global', {
      id: command.id,
      label: command.title,
      keys: CommandKeys.compact(specs),
    })
  }
  // Productivity pass Q5: Host rows read in the glossary, and one that repeats an action a command already lists
  // ("New Session" beside "New thread") stays out.
  const listedIntents = new Set([...byTitle.values()].flat().map(row => intent(row.label)))
  for (const entry of input.host) {
    if (entry.keys.length === 0 || listedIntents.has(intent(entry.label))) continue
    add('App', {
      id: entry.id,
      label: glossary(entry.label),
      keys: entry.keys,
      presented: true,
    })
  }
  const rank = (title: string): number => {
    const index = ORDER.indexOf(title)
    return index === -1 ? ORDER.length : index
  }
  return [...byTitle.entries()]
    .sort(([left], [right]) => rank(left) - rank(right) || left.localeCompare(right))
    .map(([title, rows]) => ({
      id: title.toLocaleLowerCase().replaceAll(' ', '-'),
      title,
      rows,
    }))
}

export class CheatSheetModel {
  static readonly sections = sections
  static readonly glossary = glossary
}
