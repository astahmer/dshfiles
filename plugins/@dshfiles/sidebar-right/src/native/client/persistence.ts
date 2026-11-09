/** Validated current-layout snapshots; undo history belongs to the live window. */
import * as Schema from 'effect/Schema'
import { Effect } from 'effect'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { EMPTY_HISTORY, type PaneId, type SplitId, type TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SurfaceState } from './stores.ts'

const persistencePrefix = 'dsh.sidebar-right.v1'
const paneIdPattern = /^(?:pane|float)[1-9][0-9]*$/u
const splitIdPattern = /^split[1-9][0-9]*$/u
const tabIdPattern = /^tab[1-9][0-9]*$/u
const nodeIdPattern = /^(?:pane|float|split)[1-9][0-9]*$/u
const rejectsInvalidReferences = 'Invalid saved sidebar layout references'

/** A compile-time brand applied after the pattern already admitted the value. */
const brandedId = <Id extends Branded<string>>(pattern: RegExp): Schema.Codec<Id, string> =>
  Schema.String.check(Schema.isPattern(pattern)).pipe(Schema.decodeTo(Schema.declare<Id>((value): value is Id => typeof value === 'string')))

const paneId = brandedId<PaneId>(paneIdPattern)
const splitId = brandedId<SplitId>(splitIdPattern)
const tabId = brandedId<TabId>(tabIdPattern)
const nodeId = Schema.Union([paneId, splitId])
const positiveNumber = Schema.Finite.check(Schema.isGreaterThan(0))
const rectangle = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, width: positiveNumber, height: positiveNumber })
const absentOrUndefined = <ValueSchema extends Schema.Constraint>(schema: ValueSchema) =>
  Schema.UndefinedOr(schema).pipe(Schema.withDecodingDefaultKey(Effect.succeed(undefined)))
const pane = Schema.Struct({
  kind: Schema.Literal('pane'),
  id: paneId,
  host: Schema.Literals(['dock', 'float']),
  tabs: Schema.Array(tabId),
  activeTabId: absentOrUndefined(tabId),
  rect: absentOrUndefined(rectangle),
})
const split = Schema.Struct({
  kind: Schema.Literal('split'),
  id: splitId,
  axis: Schema.Literals(['row', 'column']),
  children: Schema.Array(nodeId).check(Schema.isMinLength(2)),
  sizes: Schema.Array(positiveNumber).check(Schema.isMinLength(2)),
})
const node = Schema.Union([pane, split])
const tab = Schema.Struct({
  id: tabId,
  kind: Schema.NonEmptyString,
  contentId: Schema.NonEmptyString,
  title: Schema.String,
})
const layout = Schema.Struct({
  nodes: Schema.Record(Schema.String, node).check(
    Schema.makeFilter(nodes => (Object.keys(nodes).every(key => nodeIdPattern.test(key)) ? true : rejectsInvalidReferences)),
  ),
  tabs: Schema.Record(Schema.String, tab).check(
    Schema.makeFilter(tabs => (Object.keys(tabs).every(key => tabIdPattern.test(key)) ? true : rejectsInvalidReferences)),
  ),
  rootId: nodeId,
  floats: Schema.Array(paneId),
  activePaneId: paneId,
  expanded: Schema.Boolean,
  mode: Schema.Literals(['push', 'fullscreen']),
})
const surface = Schema.Struct({ layout, minted: Schema.Natural })
const envelope = Schema.Struct({ bySession: Schema.Record(Schema.String, Schema.Unknown) })

function validateReferences(value: typeof surface.Type): void {
  const { layout, minted } = value
  const reject: () => never = () => {
    throw new Error(rejectsInvalidReferences)
  }
  const visited = new Set<string>()
  const usedTabs = new Set<string>()
  const pending = [{ id: layout.rootId, host: 'dock' }, ...layout.floats.map(id => ({ id, host: 'float' }))]
  for (const [id, entry] of [...Object.entries(layout.nodes), ...Object.entries(layout.tabs)]) {
    if (entry.id !== id || Number(id.replace(/^[a-z]+/u, '')) > minted) reject()
  }
  for (const { id, host } of pending) {
    const entry = layout.nodes[id]
    if (visited.has(id) || entry === undefined) reject()
    visited.add(id)
    if (entry.kind === 'split') {
      if (
        host !== 'dock' ||
        id !== layout.rootId ||
        entry.axis !== 'row' ||
        entry.children.length !== 2 ||
        entry.children.length !== entry.sizes.length ||
        Math.abs(entry.sizes.reduce((sum, size) => sum + size, 0) - 1) > 1e-9
      )
        reject()
      pending.push(...entry.children.map(id => ({ id, host })))
    } else {
      if (entry.host !== host || (host === 'float' ? entry.rect === undefined || entry.tabs.length !== 1 : entry.rect !== undefined)) reject()
      if (entry.tabs.length === 0 ? entry.activeTabId !== undefined : entry.activeTabId === undefined || !entry.tabs.includes(entry.activeTabId)) reject()
      for (const tab of entry.tabs) {
        if (usedTabs.has(tab) || layout.tabs[tab] === undefined) reject()
        usedTabs.add(tab)
      }
    }
  }
  if (
    visited.size !== Object.keys(layout.nodes).length ||
    usedTabs.size !== Object.keys(layout.tabs).length ||
    layout.nodes[layout.activePaneId]?.kind !== 'pane'
  )
    reject()
}

/** Validated per-Session sidebar layout storage shared by scoped stores and startup discovery. */
export class SidebarLayoutStorage {
  static readonly prefix = persistencePrefix

  /**
   * Restore one validated Session layout with a fresh in-window undo history.
   * @param sessionId - storage scope.
   * @returns the saved surface, or undefined when absent, inaccessible or invalid.
   */
  static read(sessionId: string): SurfaceState | undefined {
    if (typeof localStorage === 'undefined') return undefined
    let raw: string | null
    try {
      raw = localStorage.getItem(`${persistencePrefix}.${sessionId}`)
    } catch {
      return undefined
    }
    if (raw === null) return undefined
    try {
      const saved = Schema.decodeUnknownSync(envelope)(JSON.parse(raw)).bySession[sessionId]
      if (saved === undefined) return undefined
      const parsed = Schema.decodeUnknownSync(surface)(saved)
      validateReferences(parsed)
      return { layout: parsed.layout, minted: parsed.minted, history: EMPTY_HISTORY }
    } catch {
      SidebarLayoutStorage.clear(sessionId)
      return undefined
    }
  }

  /**
   * Persist current layout and identity allocation without retaining undo entries.
   * @param sessionId - storage scope.
   * @param surface - current in-memory surface.
   */
  static write(sessionId: string, surface: SurfaceState): void {
    if (typeof localStorage === 'undefined') return
    const saved = { bySession: { [sessionId]: { layout: surface.layout, minted: surface.minted } } }
    try {
      localStorage.setItem(`${persistencePrefix}.${sessionId}`, JSON.stringify(saved))
    } catch (error) {
      console.error('Sidebar layout persistence failed:', error)
    }
  }

  /**
   * Remove only one Session's persisted layout.
   * @param sessionId - storage scope to discard.
   */
  static clear(sessionId: string): void {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.removeItem(`${persistencePrefix}.${sessionId}`)
    } catch {
      /* The invalid layout is still excluded from this window. */
    }
  }
}
