import type { PaletteAction } from '@dshfiles/command-palette/palette-contract'
import type { WorkbenchPanelRegistry } from '@dshfiles/workbench/registry'

export const workbenchPaletteActions = (input: {
  readonly registry: Pick<WorkbenchPanelRegistry, 'list' | 'open'>
  readonly existingMainPanelIds: ReadonlySet<string>
}): PaletteAction[] => {
  const seenMainPanelIds = new Set(input.existingMainPanelIds)
  return input.registry.list().flatMap(definition => {
    if (definition.hiddenFromAdd || definition.tabId !== undefined || definition.id === 'conversation' || definition.id === 'current-conversation') return []
    if (definition.mainPanelId !== undefined) {
      if (seenMainPanelIds.has(definition.mainPanelId)) return []
      seenMainPanelIds.add(definition.mainPanelId)
    }
    const facet = definition.threadFacet
    const isAvailable = (): boolean => facet === undefined || facet.onScreen?.getSnapshot() !== undefined
    return [
      {
        id: `@dshfiles/thread-sidebar/workbench/${definition.id}`,
        group: 'destination' as const,
        label: facet?.title() ?? definition.discoveryTitle ?? definition.title,
        aliases: facet?.description === undefined ? [] : [facet.description()],
        isAvailable,
        run: () => {
          if (isAvailable()) input.registry.open(definition.id)
        },
      },
    ]
  })
}

export const registerWorkbenchPaletteActions = (input: {
  readonly registry: Pick<WorkbenchPanelRegistry, 'list' | 'open' | 'subscribe'>
  readonly existingMainPanelIds: ReadonlySet<string>
  readonly addActions: (actions: readonly PaletteAction[]) => () => void
}): (() => void) => {
  let dispose = (): void => {}
  const update = (): void => {
    dispose()
    dispose = input.addActions(workbenchPaletteActions(input))
  }
  update()
  const unsubscribe = input.registry.subscribe(update)
  return () => {
    unsubscribe()
    dispose()
  }
}
