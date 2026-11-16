import { describe, expect, it } from 'vitest'
import { SidebarResourcePanelModel } from '@dshfiles/sidebar-right/resource-panels'
import { OrphanedResourcePanels } from './orphaned-resource-panels.js'

const gone = SidebarResourcePanelModel.id('session-gone', 'tab2')
const here = SidebarResourcePanelModel.id('session-here', 'tab1')

describe('OrphanedResourcePanels.replacedBy', () => {
  const known = { registered: (id: string) => id === 'backlog' || id === here, listed: (id: string) => id === here }

  it('finds the restored page of a thread that is gone, so the same view is not restored twice', () => {
    const panels = [
      { id: 'backlog', title: 'Changes' },
      { id: gone, title: 'Changes' },
    ]
    expect(OrphanedResourcePanels.replacedBy({ id: here, title: 'Changes' }, panels, known)).toBe(gone)
  })

  it('leaves another view, a registered page and a page the native owner still lists alone', () => {
    expect(OrphanedResourcePanels.replacedBy({ id: here, title: 'Cost' }, [{ id: gone, title: 'Changes' }], known)).toBeUndefined()
    expect(OrphanedResourcePanels.replacedBy({ id: here, title: 'Changes' }, [{ id: 'plugin-gone', title: 'Changes' }], known)).toBeUndefined()
    expect(OrphanedResourcePanels.replacedBy({ id: here, title: 'Changes' }, [{ id: here, title: 'Changes' }], known)).toBeUndefined()
    const later = { registered: () => false, listed: (id: string) => id === gone }
    expect(OrphanedResourcePanels.replacedBy({ id: here, title: 'Changes' }, [{ id: gone, title: 'Changes' }], later)).toBeUndefined()
  })
})
