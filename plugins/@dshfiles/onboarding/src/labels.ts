import type { StatusGlyphState } from '@dshfiles/plugin-ui/components/work-status'
import type { Prerequisite } from './catalog-model.js'
import type { ChecklistItem } from './overview-model.js'
import type { PluginState } from './pack-plan.js'

/** Words a plugin slug spells in capitals when it is read as a name. */
const ACRONYMS = new Map([
  ['ai', 'AI'],
  ['api', 'API'],
  ['dsh', 'DSH'],
  ['html', 'HTML'],
  ['mcp', 'MCP'],
  ['ui', 'UI'],
  ['url', 'URL'],
])

/**
 * A plugin's name as people read it (`thread-sidebar` → "Thread sidebar"): DESIGN.md keeps package and plugin ids out of
 * labels. The slug stays in `data-plugin` attributes and in what the agent tools return.
 */
export const pluginLabel = (slug: string): string => {
  const words = slug
    .replace(/^@[^/]+\//u, '')
    .split('-')
    .filter(word => word !== '')
    .map(word => ACRONYMS.get(word) ?? word)
  const [first, ...rest] = words
  if (first === undefined) return slug
  const head = ACRONYMS.has(first.toLowerCase()) || first === 'jj' ? first : `${first.charAt(0).toUpperCase()}${first.slice(1)}`
  return [head, ...rest].join(' ')
}

export const PREREQUISITE_LABELS = {
  account: 'AI account',
  project: 'Project',
  repository: 'Repository',
  github: 'GitHub CLI',
} as const satisfies Record<Prerequisite, string>

/** A checklist state as one of the kit's status glyphs: done is the muted check, to do the faint ring. */
export const CHECKLIST_GLYPH = { done: 'done', todo: 'idle', unknown: 'stale', off: 'stopped' } as const satisfies Record<
  ChecklistItem['state'],
  StatusGlyphState
>
export const CHECKLIST_LABEL = { done: 'Done', todo: 'To do', unknown: 'Unknown', off: 'Off' } as const satisfies Record<ChecklistItem['state'], string>

/** A plugin's state in a pack as a glyph; its name says the rest in neutral ink (no green or amber). */
export const PLUGIN_GLYPH = { enabled: 'done', disabled: 'stopped', 'not-installed': 'idle', unknown: 'stale' } as const satisfies Record<
  PluginState,
  StatusGlyphState
>
export const PLUGIN_STATE_LABEL = { enabled: 'enabled', disabled: 'disabled', 'not-installed': 'not installed', unknown: 'unknown' } as const satisfies Record<
  PluginState,
  string
>
