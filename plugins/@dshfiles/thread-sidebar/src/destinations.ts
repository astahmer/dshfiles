/**
 * The shell's destinations (plan `docs/ade-ux` §4.2): the fixed rail entries and the sections each one lists. The
 * thread sidebar owns the left column (it declares `shell.left` and the `sidebar.panellist` seat), so it owns this
 * registry. Published as the `@dshfiles/thread-sidebar/destinations` dshx module; importing it loads none of the sidebar.
 *
 * Plugins do not add rail entries. Their existing `sidebar.panellist` pages are re-homed here as sections: the table
 * below maps every page id the mounted profile registers today, and a plugin that ships a new page adds one
 * `DestinationSections` entry (`api.add(DestinationSections, { panelId, destination, label })`). A page nobody mapped
 * still shows, under Settings › Other pages, so nothing becomes unreachable.
 */
import { defineRegistry } from '@dshfiles/dshx/client'
import { DESTINATION_IDS, type DestinationId } from './destination-ids.js'

export { DESTINATION_IDS, type DestinationId }

/** A lucide icon the rail draws; the module carries only its name so it imports no React. */
export type DestinationIcon = 'messages-square' | 'inbox' | 'git-merge' | 'list-todo' | 'bot' | 'activity' | 'library' | 'settings'

export interface DestinationDefinition {
  readonly id: DestinationId
  readonly label: string
  /** One line under the destination's list heading. */
  readonly description: string
  readonly icon: DestinationIcon
  /**
   * Where the rail badge comes from: the glyph of this `sidebar.panellist` page, which draws its own count (the Inbox
   * glyph of `@dshfiles/activity-timeline` projects the attention store's Needs you count). Absent page, no badge.
   */
  readonly badgeFromPanel?: string
  /** Pinned to the bottom of the rail. */
  readonly bottom?: boolean
}

export const DESTINATIONS: readonly DestinationDefinition[] = [
  { id: 'threads', label: 'Threads', description: 'Every thread, grouped by status.', icon: 'messages-square' },
  { id: 'inbox', label: 'Inbox', description: 'What needs you, answered in place.', icon: 'inbox', badgeFromPanel: 'attention-inbox' },
  { id: 'land', label: 'Land', description: 'Workspaces ready to land, and repository history.', icon: 'git-merge' },
  { id: 'work', label: 'Work', description: 'Backlog items and schedules that start threads.', icon: 'list-todo' },
  { id: 'agents', label: 'Agents', description: 'Configured agents and their messages.', icon: 'bot' },
  { id: 'observe', label: 'Observe', description: 'Usage, activity, traces, jobs and hosts.', icon: 'activity' },
  { id: 'knowledge', label: 'Knowledge', description: 'Memory and reference material agents use.', icon: 'library' },
  { id: 'settings', label: 'Settings', description: 'Accounts, tools, secrets and plugins.', icon: 'settings', bottom: true },
]

export { KNOWN_SECTIONS, type DestinationSection } from './known-sections.js'
import type { DestinationSection } from './known-sections.js'
import { KNOWN_SECTIONS } from './known-sections.js'

/** Plugins that add a page after this table was written declare where it goes. */
export const DestinationSections = defineRegistry<DestinationSection>('@dshfiles/thread-sidebar.destination-section')

/** One page the sidebar knows about: a `sidebar.panellist` entry. */
export interface DestinationPanel {
  readonly id: string
  readonly label: string
  readonly order: number
}

export interface ResolvedSection extends DestinationSection {
  /** A page nobody mapped: listed under Settings › Other pages with its own label. */
  readonly unmapped: boolean
}

export interface ResolvedDestination extends DestinationDefinition {
  readonly sections: readonly ResolvedSection[]
}

/** "Usage: Analytics" → "Analytics"; a label without a prefix is kept. */
const withoutPluginPrefix = (label: string): string => {
  const index = label.indexOf(': ')
  return index > 0 && index < label.length - 2 ? label.slice(index + 2) : label
}

/**
 * Place every registered page under one destination. Contributed sections win over the built-in table (a plugin knows
 * its page best); pages nobody mapped land in Settings as unmapped, labelled without their plugin prefix.
 */
const resolve = (panels: readonly DestinationPanel[], contributed: readonly DestinationSection[] = []): readonly ResolvedDestination[] => {
  const mapped = new Map<string, DestinationSection>()
  for (const section of KNOWN_SECTIONS) mapped.set(section.panelId, section)
  for (const section of contributed) mapped.set(section.panelId, section)
  const byDestination = new Map<DestinationId, ResolvedSection[]>(DESTINATION_IDS.map(id => [id, []]))
  for (const panel of panels) {
    const section = mapped.get(panel.id)
    const resolved: ResolvedSection =
      section === undefined
        ? {
            panelId: panel.id,
            destination: 'settings',
            label: withoutPluginPrefix(panel.label),
            order: 1000 + panel.order,
            formerLabels: [panel.label],
            unmapped: true,
          }
        : { ...section, unmapped: false }
    byDestination.get(resolved.destination)?.push(resolved)
  }
  return DESTINATIONS.map(destination => ({
    ...destination,
    sections: [...(byDestination.get(destination.id) ?? [])].sort((left, right) => (left.order ?? 0) - (right.order ?? 0)),
  }))
}

/** The destination that lists this page, if any. */
const owning = (destinations: readonly ResolvedDestination[], panelId: string | null | undefined): ResolvedDestination | undefined =>
  panelId === null || panelId === undefined ? undefined : destinations.find(destination => destination.sections.some(section => section.panelId === panelId))

export class Destinations {
  static readonly resolve = resolve
  static readonly owning = owning
  static readonly withoutPluginPrefix = withoutPluginPrefix
}
