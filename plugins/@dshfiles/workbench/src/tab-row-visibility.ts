import type { DockviewApi, DockviewGroupPanel } from 'dockview-react'

export interface TabRowVisibilityController {
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshotVersion: () => number
  readonly dispose: () => void
}

interface Observation {
  readonly listeners: Set<() => void>
  version: number
  persist: (() => void) | undefined
  lease: object | undefined
}

/** Only observation/lifetime bookkeeping: the native header flag is the preference. */
const observations = new WeakMap<DockviewApi, Observation>()
const observation = (api: DockviewApi): Observation => {
  let current = observations.get(api)
  if (current === undefined) {
    current = { listeners: new Set(), version: 0, persist: undefined, lease: undefined }
    observations.set(api, current)
  }
  return current
}
const publish = (current: Observation): void => {
  current.version += 1
  for (const listener of [...current.listeners]) listener()
}
const writeHidden = (group: DockviewGroupPanel, hidden: boolean): boolean => {
  if (group.header.hidden === hidden) return false
  group.header.hidden = hidden
  // Native header.hidden changes display only; relayout invalidates its cached extent.
  group.relayout()
  return true
}
const owns = (api: DockviewApi, group: DockviewGroupPanel): boolean => api.groups.includes(group)

/** Group presentation intent persisted by Dockview's own hideHeader JSON field. */
export class TabRows {
  static supports(group: DockviewGroupPanel): boolean {
    // Native edge-shell restoration does not restore hideHeader. Workbench's
    // root/nested regions use ordinary Dockviews, not these native edge groups.
    return group.api.location.type !== 'edge'
  }

  static canHide(group: DockviewGroupPanel): boolean {
    return TabRows.supports(group) && group.panels.length === 1
  }

  static subscribe(api: DockviewApi, listener: () => void): () => void {
    const current = observation(api)
    current.listeners.add(listener)
    return () => {
      current.listeners.delete(listener)
    }
  }

  static version(api: DockviewApi): number {
    return observation(api).version
  }

  static hide(api: DockviewApi, group: DockviewGroupPanel): boolean {
    if (!owns(api, group) || !TabRows.canHide(group) || !writeHidden(group, true)) return false
    const current = observation(api)
    publish(current)
    current.persist?.()
    return true
  }

  static show(api: DockviewApi, group: DockviewGroupPanel): boolean {
    if (!owns(api, group) || !writeHidden(group, false)) return false
    const current = observation(api)
    publish(current)
    current.persist?.()
    return true
  }

  static showAll(api: DockviewApi): void {
    let changed = false
    for (const group of api.groups) changed = writeHidden(group, false) || changed
    if (!changed) return
    const current = observation(api)
    publish(current)
    current.persist?.()
  }

  /** Retain before fromJSON so restored members are observed before they populate. */
  static retain(api: DockviewApi, persist: () => void): TabRowVisibilityController {
    const current = observation(api)
    if (current.lease !== undefined) throw new Error('Tab row visibility already has an owner for this Dockview')
    const lease = {}
    current.lease = lease
    current.persist = persist
    const groups = new Map<DockviewGroupPanel, () => void>()
    let disposed = false

    const attach = (group: DockviewGroupPanel): boolean => {
      if (groups.has(group)) return false
      const membersChanged = (): void => {
        // Model events fire even inside native movingLock, unlike API add/remove
        // events. Clearing on the second member also survives a later return to one.
        if (group.panels.length > 1) writeHidden(group, false)
        publish(current)
        // Never serialize here: a move/restore can still be half-finished.
      }
      const added = group.model.onDidAddPanel(membersChanged)
      const removed = group.model.onDidRemovePanel(membersChanged)
      groups.set(group, () => {
        added.dispose()
        removed.dispose()
      })
      // Newly announced groups may be empty while fromJSON opens their members.
      // Do not erase a valid restored singleton's intent at that transient point.
      return group.panels.length > 1 && writeHidden(group, false)
    }
    const detach = (group: DockviewGroupPanel): void => {
      groups.get(group)?.()
      groups.delete(group)
    }
    const reconcile = (): boolean => {
      let changed = false
      const live = new Set(api.groups)
      for (const group of groups.keys()) if (!live.has(group)) detach(group)
      for (const group of live) {
        changed = attach(group) || changed
        if (group.panels.length !== 1 || !TabRows.supports(group)) changed = writeHidden(group, false) || changed
      }
      return changed
    }
    const added = api.onDidAddGroup(group => {
      attach(group)
      publish(current)
    })
    const removed = api.onDidRemoveGroup(group => {
      detach(group)
      publish(current)
    })
    const loaded = api.onDidLayoutFromJSON(() => {
      reconcile()
      publish(current)
    })
    const mutated = api.onDidMutateLayout(() => {
      reconcile()
      publish(current)
    })
    // Existing invalid state can predate this owner, so normalize it too. Native
    // structural mutations are saved later by WorkbenchView's layout listener.
    const normalized = reconcile()
    publish(current)
    if (normalized) persist()

    return {
      subscribe: listener => TabRows.subscribe(api, listener),
      getSnapshotVersion: () => current.version,
      dispose: () => {
        if (disposed) return
        disposed = true
        added.dispose()
        removed.dispose()
        loaded.dispose()
        mutated.dispose()
        for (const release of groups.values()) release()
        groups.clear()
        if (current.lease === lease) {
          current.lease = undefined
          current.persist = undefined
        }
      },
    }
  }
}
