import type { PaletteAction } from '@dshfiles/command-palette/palette-contract'
import type { WorkbenchPanelDefinition, WorkbenchPanelRegistry } from '@dshfiles/workbench/registry'

const listedViews = (input: {
  readonly registry: Pick<WorkbenchPanelRegistry, 'list' | 'open'>
  readonly existingMainPanelIds: ReadonlySet<string>
}): { readonly definition: WorkbenchPanelDefinition; readonly action: PaletteAction }[] => {
  const seenMainPanelIds = new Set(input.existingMainPanelIds)
  return input.registry.list().flatMap(definition => {
    if (definition.hiddenFromAdd || definition.tabId !== undefined || definition.id === 'conversation' || definition.id === 'current-conversation') return []
    if (definition.mainPanelId !== undefined) {
      if (seenMainPanelIds.has(definition.mainPanelId)) return []
      seenMainPanelIds.add(definition.mainPanelId)
    }
    const facet = definition.threadFacet
    const isAvailable = (): boolean => facet === undefined || facet.onScreen?.getSnapshot() !== undefined
    const action: PaletteAction = {
      id: `@dshfiles/thread-sidebar/workbench/${definition.id}`,
      group: 'destination',
      label: facet?.title() ?? definition.discoveryTitle ?? definition.title,
      aliases: facet?.description === undefined ? [] : [facet.description()],
      isAvailable,
      run: () => {
        if (isAvailable()) input.registry.open(definition.id)
      },
    }
    return [{ definition, action }]
  })
}

export const workbenchPaletteActions = (input: {
  readonly registry: Pick<WorkbenchPanelRegistry, 'list' | 'open'>
  readonly existingMainPanelIds: ReadonlySet<string>
}): PaletteAction[] => listedViews(input).map(view => view.action)

export const registerWorkbenchPaletteActions = (input: {
  readonly registry: Pick<WorkbenchPanelRegistry, 'list' | 'open' | 'subscribe'>
  readonly existingMainPanelIds: ReadonlySet<string>
  readonly addActions: (actions: readonly PaletteAction[]) => () => void
}): (() => void) => {
  // Each thread switch replaces Workbench occurrences this list leaves out; only an action whose view, label or aliases
  // changed is added again, since every add reruns the palette's whole contributed-row source.
  const registered = new Map<string, { readonly definition: WorkbenchPanelDefinition; readonly signature: string; readonly dispose: () => void }>()
  const update = (): void => {
    const views = listedViews(input)
    const listed = new Set(views.map(view => view.action.id))
    for (const [id, entry] of registered) {
      if (listed.has(id)) continue
      entry.dispose()
      registered.delete(id)
    }
    for (const { definition, action } of views) {
      const signature = JSON.stringify([action.label, action.aliases])
      const previous = registered.get(action.id)
      if (previous?.definition === definition && previous.signature === signature) continue
      previous?.dispose()
      registered.set(action.id, { definition, signature, dispose: input.addActions([action]) })
    }
  }
  update()
  const unsubscribe = input.registry.subscribe(update)
  return () => {
    unsubscribe()
    for (const entry of registered.values()) entry.dispose()
    registered.clear()
  }
}
