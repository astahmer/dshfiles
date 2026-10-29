/** Validated current-layout snapshots; undo history belongs to the live window. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { EMPTY_HISTORY, type PaneId, type SplitId, type TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SurfaceState } from './stores.ts'

const persistencePrefix = 'dsh.sidebar-right.v1'

const paneId = z
  .string()
  .regex(/^(?:pane|float)[1-9][0-9]*$/u)
  .transform(id => brandString<PaneId>(id))
const splitId = z
  .string()
  .regex(/^split[1-9][0-9]*$/u)
  .transform(id => brandString<SplitId>(id))
const tabId = z
  .string()
  .regex(/^tab[1-9][0-9]*$/u)
  .transform(id => brandString<TabId>(id))
const nodeId = z.union([paneId, splitId])
const rectangle = z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() })
const node = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('pane'),
      id: paneId,
      host: z.enum(['dock', 'float']),
      tabs: z.array(tabId),
      activeTabId: tabId.optional(),
      rect: rectangle.optional(),
    })
    .transform(pane => ({ ...pane, activeTabId: pane.activeTabId, rect: pane.rect })),
  z.object({
    kind: z.literal('split'),
    id: splitId,
    axis: z.enum(['row', 'column']),
    children: z.array(nodeId).min(2),
    sizes: z.array(z.number().positive()).min(2),
  }),
])
const layout = z.object({
  nodes: z.record(nodeId, node),
  tabs: z.record(tabId, z.object({ id: tabId, kind: z.string().min(1), contentId: z.string().min(1), title: z.string() })),
  rootId: nodeId,
  floats: z.array(paneId),
  activePaneId: paneId,
  expanded: z.boolean(),
  mode: z.enum(['push', 'fullscreen']),
})
const surface = z.object({ layout, minted: z.int().nonnegative() })
const envelope = z.object({ bySession: z.record(z.string(), z.unknown()) })

function validateReferences(value: z.infer<typeof surface>): void {
  const { layout, minted } = value
  const reject: () => never = () => {
    throw new Error('Invalid saved sidebar layout references')
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
      const saved = envelope.parse(JSON.parse(raw)).bySession[sessionId]
      if (saved === undefined) return undefined
      const parsed = surface.parse(saved)
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
