import { BacklogItems } from './item.js'
import type { BacklogSettings } from './settings.js'
import type { SyncMapping } from './sync-legacy-mapping.js'
import { BacklogSyncModel, type ExternalRef, type SyncBinding, type SyncConnection } from './sync-model.js'
import type { StoredRef } from './sync-sources.js'

type LegacyRow = BacklogSettings['syncBackends'][number]

const providerLabels = { linear: 'Linear', github: 'GitHub' } as const

/** The legacy row that served a project: its own row first, then a row with an empty project. */
const legacyRowFor = (rows: readonly LegacyRow[], backend: LegacyRow['backend'], project: string | null): LegacyRow | undefined => {
  const candidates = rows.filter(row => row.enabled && row.backend === backend)
  const own = project === null ? undefined : candidates.find(row => row.project !== '' && BacklogItems.projectPath(row.project) === project)
  return own ?? candidates.find(row => row.project === '')
}

const lastSegment = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

/**
 * The connections, bindings and external refs one settings `syncBackends` list and the per-item mappings become.
 * Rows sharing a tracker and a key share one connection; every row becomes a two-way binding of the four fields the
 * old sync owned; every mapping becomes a ref of the binding that served its item's project, or of a disabled
 * `<tracker>-migrated` binding when no row serves it any more, so no link is ever lost.
 */
const plan = (input: {
  readonly rows: readonly LegacyRow[]
  readonly mappings: readonly SyncMapping[]
  readonly projectOf: (itemId: number) => string | null | undefined
  readonly hostId: string
}) => {
  const connections: SyncConnection[] = []
  const bindings: SyncBinding[] = []
  const bindingOfRow = new Map<LegacyRow, string>()
  const connectionFor = (backend: LegacyRow['backend'], secret: string): string => {
    const credential = secret.trim()
    const found = connections.find(connection => connection.kind === backend && connection.credential === credential)
    if (found !== undefined) return found.instanceId
    const instanceId = BacklogSyncModel.uniqueSlug(backend, new Set(connections.map(connection => connection.instanceId)))
    const sameKind = connections.filter(connection => connection.kind === backend).length
    connections.push({
      instanceId,
      kind: backend,
      label: sameKind === 0 ? providerLabels[backend] : `${providerLabels[backend]} (${String(sameKind + 1)})`,
      credential,
      baseUrl: '',
      identity: null,
    })
    return instanceId
  }
  const fieldMap = BacklogSyncModel.defaultFieldMap(['title', 'body', 'status', 'tags'])
  const addBinding = (
    fields: Omit<SyncBinding, 'id' | 'direction' | 'fieldMap' | 'conflictPolicy' | 'importNew' | 'ownerHostId'> & { readonly name: string },
  ) => {
    const { name, ...rest } = fields
    const id = BacklogSyncModel.uniqueSlug(BacklogSyncModel.slugOf(name), new Set(bindings.map(binding => binding.id)))
    bindings.push({ ...rest, id, direction: 'two-way', fieldMap, conflictPolicy: 'lww', importNew: false, ownerHostId: input.hostId })
    return id
  }
  for (const row of input.rows) {
    const scope = row.project.trim() === '' ? null : BacklogItems.projectPath(row.project)
    const id = addBinding({
      name: `${row.backend}-${row.target.trim() || (scope === null ? 'all' : lastSegment(scope))}`,
      connectionId: connectionFor(row.backend, row.secret),
      container: row.target.trim(),
      scope,
      pollEverySec: Math.min(row.autoSyncMinutes * 60, BacklogSyncModel.maxPollSeconds),
      pushAgentComments: row.pushAgentComments,
      enabled: row.enabled,
    })
    bindingOfRow.set(row, id)
  }
  const fallback = new Map<LegacyRow['backend'], string>()
  const fallbackBinding = (backend: LegacyRow['backend']): string => {
    const existing = fallback.get(backend)
    if (existing !== undefined) return existing
    const anyRow = input.rows.find(row => row.backend === backend)
    const id =
      anyRow === undefined
        ? addBinding({
            name: `${backend}-migrated`,
            connectionId: connectionFor(backend, ''),
            container: '',
            scope: null,
            pollEverySec: 0,
            pushAgentComments: false,
            enabled: false,
          })
        : (bindingOfRow.get(anyRow) ?? '')
    fallback.set(backend, id)
    return id
  }
  const refs = input.mappings.flatMap((mapping): StoredRef[] => {
    const project = input.projectOf(mapping.itemId)
    if (project === undefined) return []
    const row = legacyRowFor(input.rows, mapping.backend, project)
    const bindingId = (row === undefined ? undefined : bindingOfRow.get(row)) ?? fallbackBinding(mapping.backend)
    const ref: ExternalRef = {
      bindingId,
      // A GitHub key names its repository (`owner/repo#42`), so one binding may reach several repositories.
      key: mapping.backend === 'github' ? mapping.remoteKey : mapping.remoteId,
      displayKey: mapping.remoteKey,
      url: mapping.url,
      linkedAt: mapping.linkedAt,
      lastSyncedAt: mapping.lastSyncedAt,
      remoteUpdatedAt: mapping.remoteUpdatedAt,
      lastRemoteVersion: null,
      localSyncedAt: mapping.localSyncedAt,
      base: mapping.base,
      comments: mapping.comments,
      pushCommentsSince: mapping.pushCommentsSince,
      state: mapping.state,
      conflicts: mapping.conflicts,
      lastError: mapping.lastError,
    }
    return [{ itemId: mapping.itemId, ref }]
  })
  const seen = new Set<string>()
  const unique = refs.filter(entry => {
    const keys = [`${entry.ref.bindingId}\n${entry.ref.key}`, `${entry.ref.bindingId}\n#${String(entry.itemId)}`]
    if (keys.some(key => seen.has(key))) return false
    for (const key of keys) seen.add(key)
    return true
  })
  return { connections, bindings, refs: unique }
}

export class SyncMigration {
  /** The `meta` key the one-time migration leaves; its value is the JSON receipt. */
  static readonly marker = 'sync_sources_migrated'
  static readonly plan = plan
}
