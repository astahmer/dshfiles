import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'

type StorageSource = () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null

/** Convert the old fixed footer once; later explicit closes/moves stay authoritative. */
export class SidebarPreviewMigration {
  static readonly panelId = 'dshfiles-thread-sidebar.workbench-status'
  static readonly storageKey = 'dshfiles.workbench.sidebar-preview-docked.v1'

  static create(storage?: StorageSource) {
    const completed = createStoredValue({ key: this.storageKey, schema: z.boolean(), fallback: false, ...(storage === undefined ? {} : { storage }) })
    return {
      reset(): void {
        completed.remove()
      },
      seat(options: { readonly alreadyPlaced: () => boolean; readonly place: () => void }): void {
        if (completed.get()) return
        if (!options.alreadyPlaced()) options.place()
        completed.set(true)
      },
    }
  }
}
