import { Layer } from 'effect'
import { backlogSettingsTestLayer } from './backlog-settings.js'
import { BacklogTables, type BacklogFileRecord } from './backlog-tables.js'
import type { BacklogItem } from './item.js'
import type { BacklogSettings } from './settings.js'
import { BacklogStore } from './store.js'

/** The durable rows of one test store; pass the same rows to a second layer to model a Host restart. */
export const backlogRows = () => ({ items: new Map<string, BacklogItem>(), files: new Map<string, BacklogFileRecord>() })

/** A real BacklogStore over in-memory tables and default settings. */
export const backlogStoreLayer = (
  input: { readonly rows?: ReturnType<typeof backlogRows> | undefined; readonly settings?: Partial<BacklogSettings> | undefined } = {},
) =>
  BacklogStore.layer.pipe(
    Layer.provideMerge(BacklogTables.layerMemory(input.rows ?? backlogRows())),
    Layer.provideMerge(backlogSettingsTestLayer(input.settings)),
  )
