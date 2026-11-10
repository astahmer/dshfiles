import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Layer } from 'effect'
import { BacklogDb, BacklogStorePaths } from './backlog-db.js'
import { BacklogRepo } from './backlog-repo.js'
import { backlogSettingsTestLayer } from './backlog-settings.js'
import { LegacyBacklogTables, type LegacySnapshot } from './legacy-tables.js'
import type { BacklogSettings } from './settings.js'
import { BacklogStore } from './store.js'

/** Where one test store keeps its SQLite file and attachment bytes; pass the same rows to a second layer to model a Host restart. */
export interface BacklogTestRows {
  readonly database: string
  readonly files: string
  /** What the JSON storage domains held before the SQLite store, imported on the first open. */
  readonly legacy: Partial<LegacySnapshot>
}

const scratchDirectory = (): string => mkdtempSync(join(tmpdir(), 'dshfiles-backlog-test-'))

/** A store file on disk, so a second open sees what the first wrote. */
export const backlogRows = (input: { readonly legacy?: Partial<LegacySnapshot> | undefined } = {}): BacklogTestRows => {
  const directory = scratchDirectory()
  return { database: join(directory, 'backlog.db'), files: join(directory, 'files'), legacy: input.legacy ?? {} }
}

const memoryRows = (): BacklogTestRows => ({ database: ':memory:', files: join(scratchDirectory(), 'files'), legacy: {} })

/** The real SQLite repo over the rows' file (`:memory:` by default) and a scratch attachment folder. */
const backlogRepoLayer = (rows: BacklogTestRows = memoryRows()) =>
  BacklogRepo.layer.pipe(
    Layer.provideMerge(BacklogDb.layer),
    Layer.provideMerge(Layer.mergeAll(BacklogStorePaths.layer({ database: rows.database, files: rows.files }), LegacyBacklogTables.layerMemory(rows.legacy))),
    Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
  )

/** A real BacklogStore over an in-memory SQLite file, or the given rows, and default settings. */
export const backlogStoreLayer = (input: { readonly rows?: BacklogTestRows | undefined; readonly settings?: Partial<BacklogSettings> | undefined } = {}) =>
  BacklogStore.layer.pipe(Layer.provideMerge(backlogRepoLayer(input.rows)), Layer.provideMerge(backlogSettingsTestLayer(input.settings)))

/** The backlog's SQLite file alone, for services that keep their own table and need no item fold. */
export const backlogDbLayer = (rows: BacklogTestRows = memoryRows()) =>
  BacklogDb.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(BacklogStorePaths.layer({ database: rows.database, files: rows.files }), NodeFileSystem.layer, NodePath.layer)),
  )
