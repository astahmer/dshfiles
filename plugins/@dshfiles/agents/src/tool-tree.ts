import { ToolAccess, type ToolAccessConfig, type ToolAccessDecision, type ToolAccessEntry, type ToolGroupKind } from '@dshfiles/tool-search/access'

import type { ToolAccessEditInput, ToolCatalogView } from './api.js'

/**
 * The Tools tree of the agent editor: the Host's catalog crossed with one agent's draft access. Pure, so tri-state,
 * inheritance, sparse edits and the save batch are tested without a DOM.
 */

/** A checkbox state: every child, none, or some. */
export type ToolCheck = boolean | 'indeterminate'

export type ToolTarget = { readonly kind: 'tool' | 'group'; readonly key: string }

export interface ToolTreeTool {
  readonly name: string
  readonly summary: string
  readonly group: string
  readonly decision: ToolAccessDecision
  /** The tool's own entry in the draft: present means set on this tool, absent means inherited. */
  readonly entry: ToolAccessEntry | undefined
  /** tool_search and tool_call: always enabled. */
  readonly reserved: boolean
  /** The effective state differs from the saved one. */
  readonly changed: boolean
}

export interface ToolTreeGroup {
  readonly key: string
  readonly kind: ToolGroupKind
  readonly label: string
  readonly tools: readonly ToolTreeTool[]
  /** The tools the filter keeps: all of them without a query, or when the group's own label matches. */
  readonly matches: readonly ToolTreeTool[]
  readonly entry: ToolAccessEntry | undefined
  readonly enabled: ToolCheck
  readonly pinned: ToolCheck
  readonly enabledCount: number
  readonly pinnedCount: number
  readonly changed: boolean
}

export interface ToolTree {
  readonly groups: readonly ToolTreeGroup[]
  readonly total: number
  readonly enabled: number
  readonly pinned: number
  /** Tools whose effective state differs from the saved one. */
  readonly changed: number
}

type CatalogGroup = ToolCatalogView['groups'][number]
type Field = 'enabled' | 'pinned'

/** Most edits one `setToolAccess` call takes; the Host refuses more. */
export const MAX_TOOL_EDITS_PER_CALL = 200

const own = (record: Readonly<Record<string, ToolAccessEntry>>, key: string): ToolAccessEntry | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined

/** An entry in fixed key order without absent fields, or undefined when nothing is left. */
const normalized = (entry: ToolAccessEntry | undefined): ToolAccessEntry | undefined => {
  if (entry === undefined) return undefined
  if (entry.enabled !== undefined && entry.pinned !== undefined) return { enabled: entry.enabled, pinned: entry.pinned }
  if (entry.enabled !== undefined) return { enabled: entry.enabled }
  if (entry.pinned !== undefined) return { pinned: entry.pinned }
  return undefined
}

const sameEntry = (left: ToolAccessEntry | undefined, right: ToolAccessEntry | undefined): boolean =>
  JSON.stringify(normalized(left) ?? null) === JSON.stringify(normalized(right) ?? null)

const without = (entry: ToolAccessEntry | undefined, field: Field): ToolAccessEntry | undefined => {
  if (entry === undefined) return undefined
  const { [field]: _dropped, ...rest } = entry
  return normalized(rest)
}

const put = (access: ToolAccessConfig, target: ToolTarget, entry: ToolAccessEntry | undefined): ToolAccessConfig =>
  ToolAccess.withEntry(access, target, normalized(entry) ?? null)

const checkOf = (count: number, total: number): ToolCheck => (total === 0 || count === 0 ? false : count === total ? true : 'indeterminate')

const matchesQuery = (query: string, ...texts: readonly string[]): boolean => texts.some(text => text.toLowerCase().includes(query))

/** What a tool inherits for one field when it has no own value: its group's entry, else the default. */
const inherited = (access: ToolAccessConfig, group: string, field: Field): boolean => own(access.groups, group)?.[field] ?? field === 'enabled'

const build = (catalog: ToolCatalogView, access: ToolAccessConfig, saved: ToolAccessConfig, query = ''): ToolTree => {
  const needle = query.trim().toLowerCase()
  let total = 0
  let enabled = 0
  let pinned = 0
  let changed = 0
  const groups: ToolTreeGroup[] = []
  for (const group of catalog.groups) {
    const tools = group.tools.map((tool): ToolTreeTool => {
      const subject = { name: tool.name, group: group.key }
      const decision = ToolAccess.decide(access, subject)
      const before = ToolAccess.decide(saved, subject)
      return {
        name: tool.name,
        summary: tool.summary,
        group: group.key,
        decision,
        entry: normalized(own(access.tools, tool.name)),
        reserved: ToolAccess.isReserved(tool.name),
        changed: decision.enabled !== before.enabled || decision.pinned !== before.pinned,
      }
    })
    const enabledCount = tools.filter(tool => tool.decision.enabled).length
    const pinnedCount = tools.filter(tool => tool.decision.enabled && tool.decision.pinned).length
    const toolsChanged = tools.filter(tool => tool.changed).length
    total += tools.length
    enabled += enabledCount
    pinned += pinnedCount
    changed += toolsChanged
    const labelMatches = needle === '' || matchesQuery(needle, group.label, group.key)
    const matches = labelMatches ? tools : tools.filter(tool => matchesQuery(needle, tool.name, tool.summary))
    if (needle !== '' && matches.length === 0) continue
    const entry = normalized(own(access.groups, group.key))
    groups.push({
      key: group.key,
      kind: group.kind,
      label: group.label,
      tools,
      matches,
      entry,
      enabled: checkOf(enabledCount, tools.length),
      pinned: checkOf(pinnedCount, enabledCount),
      enabledCount,
      pinnedCount,
      changed: toolsChanged > 0 || !sameEntry(entry, own(saved.groups, group.key)),
    })
  }
  return { groups, total, enabled, pinned, changed }
}

/**
 * Set one field of one tool. A value equal to what it would inherit drops the field instead, so unchecking and
 * rechecking a tool leaves no entry behind and it follows its group again. Reserved tools stay enabled.
 */
const setTool = (access: ToolAccessConfig, tool: { readonly name: string; readonly group: string }, field: Field, value: boolean): ToolAccessConfig => {
  if (field === 'enabled' && ToolAccess.isReserved(tool.name)) return access
  const rest = without(own(access.tools, tool.name), field)
  const next = value === inherited(access, tool.group, field) ? rest : { ...rest, [field]: value }
  return put(access, { kind: 'tool', key: tool.name }, next)
}

/**
 * Set one field for a whole group: the group entry takes the value (dropped when it equals the default) and every
 * tool of the group loses its own value for that field, so all of them follow the group, as a parent checkbox does.
 */
const setGroup = (access: ToolAccessConfig, group: Pick<CatalogGroup, 'key' | 'tools'>, field: Field, value: boolean): ToolAccessConfig => {
  const rest = without(own(access.groups, group.key), field)
  const fallback = field === 'enabled'
  let next = put(access, { kind: 'group', key: group.key }, value === fallback ? rest : { ...rest, [field]: value })
  for (const tool of group.tools) {
    const entry = own(next.tools, tool.name)
    if (entry?.[field] !== undefined) next = put(next, { kind: 'tool', key: tool.name }, without(entry, field))
  }
  return next
}

/** Drop an entry, so the tool or group inherits again (the `entry: null` edit). */
const reset = (access: ToolAccessConfig, target: ToolTarget): ToolAccessConfig => ToolAccess.withEntry(access, target, null)

/** What a click on a tri-state does: a partial or empty state checks every child, a full one clears them. */
const nextCheck = (state: ToolCheck): boolean => state !== true

/** The sparse edits that turn `saved` into `draft`: one per entry that differs, null where the draft has none. */
const edits = (saved: ToolAccessConfig, draft: ToolAccessConfig): ToolAccessEditInput[] => {
  const result: ToolAccessEditInput[] = []
  for (const [kind, field] of [
    ['group', 'groups'],
    ['tool', 'tools'],
  ] as const) {
    const keys = [...new Set([...Object.keys(saved[field]), ...Object.keys(draft[field])])].sort()
    for (const key of keys) {
      const before = own(saved[field], key)
      const after = normalized(own(draft[field], key))
      if (!sameEntry(before, after)) result.push({ target: { kind, key }, entry: after ?? null })
    }
  }
  return result
}

/** Edits in calls the Host accepts: one call unless a single save holds more than the per-call limit. */
const batches = (all: readonly ToolAccessEditInput[], size = MAX_TOOL_EDITS_PER_CALL): ToolAccessEditInput[][] => {
  const result: ToolAccessEditInput[][] = []
  for (let index = 0; index < all.length; index += size) result.push(all.slice(index, index + size))
  return result
}

/** Whether two access configs mean the same entries, whatever their key order. */
const sameAccess = (left: ToolAccessConfig, right: ToolAccessConfig): boolean => edits(left, right).length === 0

/** One rendered row: a group header, a tool, or the "show more" row that ends a long group. */
export type ToolTreeRow =
  | { readonly kind: 'group'; readonly id: string; readonly group: ToolTreeGroup; readonly expanded: boolean }
  | { readonly kind: 'tool'; readonly id: string; readonly group: ToolTreeGroup; readonly tool: ToolTreeTool }
  | { readonly kind: 'more'; readonly id: string; readonly group: ToolTreeGroup; readonly hidden: number }

export const groupRowId = (key: string): string => `group:${key}`
export const toolRowId = (group: string, name: string): string => `tool:${group}:${name}`
const moreRowId = (key: string): string => `more:${key}`

/**
 * The rows to render: every group header, and the tools of expanded groups only, up to `limitOf(group)` each. A
 * collapsed group renders one row, so ~1000 tools in ~20 groups start as ~20 rows.
 */
const rows = (tree: ToolTree, view: { readonly isExpanded: (key: string) => boolean; readonly limitOf: (key: string) => number }): ToolTreeRow[] => {
  const result: ToolTreeRow[] = []
  for (const group of tree.groups) {
    const expanded = view.isExpanded(group.key)
    result.push({ kind: 'group', id: groupRowId(group.key), group, expanded })
    if (!expanded) continue
    const limit = view.limitOf(group.key)
    for (const tool of group.matches.slice(0, limit)) result.push({ kind: 'tool', id: toolRowId(group.key, tool.name), group, tool })
    if (group.matches.length > limit) result.push({ kind: 'more', id: moreRowId(group.key), group, hidden: group.matches.length - limit })
  }
  return result
}

export type ToolTreeMove = { readonly kind: 'focus'; readonly id: string } | { readonly kind: 'expand' | 'collapse'; readonly key: string } | null

/**
 * The tree keys of the WAI-ARIA tree pattern: Up/Down step through rows, Home/End jump, Right opens a group or enters
 * it, Left closes a group or returns from a tool to its group.
 */
const move = (list: readonly ToolTreeRow[], activeId: string, key: string): ToolTreeMove => {
  const index = list.findIndex(row => row.id === activeId)
  const row = list[index]
  if (row === undefined) return list[0] === undefined ? null : { kind: 'focus', id: list[0].id }
  const focus = (target: ToolTreeRow | undefined): ToolTreeMove => (target === undefined ? null : { kind: 'focus', id: target.id })
  if (key === 'ArrowDown') return focus(list[index + 1])
  if (key === 'ArrowUp') return focus(list[index - 1])
  if (key === 'Home') return focus(list[0])
  if (key === 'End') return focus(list[list.length - 1])
  if (key === 'ArrowRight') {
    if (row.kind !== 'group') return null
    return row.expanded ? focus(list[index + 1]?.kind === 'group' ? undefined : list[index + 1]) : { kind: 'expand', key: row.group.key }
  }
  if (key === 'ArrowLeft') {
    if (row.kind === 'group') return row.expanded ? { kind: 'collapse', key: row.group.key } : null
    return { kind: 'focus', id: groupRowId(row.group.key) }
  }
  return null
}

/** Pure rules of the Tools tree: build it, edit the draft access, and turn the draft into save edits. */
export class ToolTrees {
  static readonly build = build
  static readonly setTool = setTool
  static readonly setGroup = setGroup
  static readonly reset = reset
  static readonly nextCheck = nextCheck
  static readonly edits = edits
  static readonly batches = batches
  static readonly sameAccess = sameAccess
  static readonly rows = rows
  static readonly move = move
  static readonly normalizedEntry = normalized
}
