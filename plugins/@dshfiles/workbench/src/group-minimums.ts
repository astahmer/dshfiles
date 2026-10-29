import type { DockviewApi, DockviewGroupPanel } from 'dockview-react'

/** Dockview's own group floor is 100px each way, which keeps a one-row panel (the sidebar's navigation icons) far taller than its content. */
const GROUP_MINIMUM_PX = 32

const applyMinimum = (group: DockviewGroupPanel): void => {
  group.api.setConstraints({ minimumHeight: GROUP_MINIMUM_PX, minimumWidth: GROUP_MINIMUM_PX })
}

const retain = (api: DockviewApi) => {
  api.groups.forEach(applyMinimum)
  const added = api.onDidAddGroup(applyMinimum)
  const loaded = api.onDidLayoutFromJSON(() => api.groups.forEach(applyMinimum))
  return {
    dispose: () => {
      added.dispose()
      loaded.dispose()
    },
  }
}

export const GroupMinimums = { size: GROUP_MINIMUM_PX, retain }
