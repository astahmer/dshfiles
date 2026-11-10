import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it, vi } from 'vitest'
import type { LegacyPreferences } from './legacy-preferences-migration.js'
import { DEFAULT_PREFERENCES, type SidebarPreferences } from './organization.js'
import { SidebarPreferencesMachine, type SidebarPreferencesMachineClient } from './preferences-machine.js'
import { DEFAULT_THREAD_VIEW_SETTINGS } from './thread-view-preferences.js'

const deferred = <Value>() => {
  let resolve: (value: Value) => void = () => undefined
  const promise = new Promise<Value>(resolvePromise => {
    resolve = value => resolvePromise(value)
  })
  return { promise, resolve }
}

const settledLegacy = (overrides: Partial<LegacyPreferences> = {}): LegacyPreferences => ({
  threadViews: { settings: DEFAULT_THREAD_VIEW_SETTINGS, doneFiltersMigrated: true, shippedFiltersMigrated: true },
  collapsedGroups: [],
  ...overrides,
})

const customThreadViews = () => ({ ...DEFAULT_THREAD_VIEW_SETTINGS, showFilterControl: false })

const createClient = (
  options: {
    readonly local?: SidebarPreferences | null
    readonly host?: SidebarPreferences | null
    readonly legacy?: LegacyPreferences
    readonly writeHost?: (patch: Partial<SidebarPreferences>) => Promise<boolean>
  } = {},
) => {
  let local = options.local === undefined ? null : options.local
  const host = options.host === undefined ? DEFAULT_PREFERENCES : options.host
  const hostWrites: Partial<SidebarPreferences>[] = []
  let removeCount = 0
  let legacy = options.legacy ?? settledLegacy()
  let legacyClearCount = 0

  const client: SidebarPreferencesMachineClient = {
    readLocal: () => local,
    readHost: () => host,
    writeHost: patch => {
      hostWrites.push(patch)
      return options.writeHost?.(patch) ?? Promise.resolve(true)
    },
    removeLocal: () => {
      removeCount += 1
      local = null
    },
    legacy: {
      read: () => legacy,
      clear: () => {
        legacyClearCount += 1
        legacy = settledLegacy()
      },
    },
  }

  return { client, hostWrites, getLocal: () => local, getRemoveCount: () => removeCount, getLegacyClearCount: () => legacyClearCount }
}

const startMachine = (client: SidebarPreferencesMachineClient) => createActor(SidebarPreferencesMachine.machine, { input: { client } }).start()

const waitUntilSettled = (actor: ReturnType<typeof startMachine>) =>
  waitFor(actor, snapshot => snapshot.matches('idle') && Object.keys(snapshot.context.pendingOperationIds).length === 0)

describe('SidebarPreferencesMachine', () => {
  it('hands every edit to the Host at once and keeps the newest pending value until its own write settles', async () => {
    const firstWrite = deferred<boolean>()
    const secondWrite = deferred<boolean>()
    let writeCount = 0
    const harness = createClient({
      writeHost: () => {
        writeCount += 1
        return writeCount === 1 ? firstWrite.promise : secondWrite.promise
      },
    })
    const actor = startMachine(harness.client)

    actor.send({ type: 'host.update', patch: { idleMinutes: 30 } })
    actor.send({ type: 'host.update', patch: { idleMinutes: 45 } })
    expect(harness.hostWrites).toEqual([{ idleMinutes: 30 }, { idleMinutes: 45 }])
    expect(actor.getSnapshot().context.pending.idleMinutes).toBe(45)

    firstWrite.resolve(false)
    await vi.waitFor(() => expect(actor.getSnapshot().context.hostWriteFailed).toBe(true))
    expect(actor.getSnapshot().context.pending.idleMinutes).toBe(45)

    secondWrite.resolve(true)
    await waitUntilSettled(actor)
    expect(actor.getSnapshot().context.pending).toEqual({})
    expect(actor.getSnapshot().context.hostWriteFailed).toBe(false)
  })

  it('retains the browser copy after failed migration and removes it only after a successful retry', async () => {
    const migratedMode: SidebarPreferences['headerMode'] = DEFAULT_PREFERENCES.headerMode === 'compact' ? 'expanded' : 'compact'
    const local: SidebarPreferences = { ...DEFAULT_PREFERENCES, headerMode: migratedMode }
    let allowMigration = false
    const harness = createClient({ local, writeHost: async () => allowMigration })
    const actor = startMachine(harness.client)

    actor.send({ type: 'migration.requested' })
    await waitFor(actor, snapshot => snapshot.context.migrationStatus === 'failed')
    expect(harness.getLocal()).toEqual(local)
    expect(harness.getRemoveCount()).toBe(0)

    allowMigration = true
    actor.send({ type: 'migration.requested' })
    await waitFor(actor, snapshot => snapshot.context.migrationStatus === 'done')
    expect(harness.getLocal()).toBeNull()
    expect(harness.getRemoveCount()).toBe(1)
    expect(harness.hostWrites).toEqual([{ headerMode: migratedMode }, { headerMode: migratedMode }])
  })

  it('retains the browser copy when a migration write rejects', async () => {
    const migratedMode: SidebarPreferences['headerMode'] = DEFAULT_PREFERENCES.headerMode === 'compact' ? 'expanded' : 'compact'
    const local: SidebarPreferences = { ...DEFAULT_PREFERENCES, headerMode: migratedMode }
    const harness = createClient({
      local,
      writeHost: async () => {
        throw new Error('Settings unavailable')
      },
    })
    const actor = startMachine(harness.client)

    actor.send({ type: 'migration.requested' })
    await waitFor(actor, snapshot => snapshot.context.migrationStatus === 'failed')
    expect(harness.getLocal()).toEqual(local)
    expect(harness.getRemoveCount()).toBe(0)
    expect(actor.getSnapshot().context.hostWriteFailed).toBe(true)
  })

  it('keeps the browser copy when Host becomes unavailable before migration', async () => {
    const harness = createClient({ local: DEFAULT_PREFERENCES, host: null })
    const actor = startMachine(harness.client)

    actor.send({ type: 'migration.requested' })
    await waitFor(actor, snapshot => snapshot.matches('idle') && snapshot.context.migrationOperationId === null && snapshot.context.nextOperationId === 1)
    expect(actor.getSnapshot().context.migrationStatus).toBe('idle')
    expect(harness.getLocal()).toEqual(DEFAULT_PREFERENCES)
    expect(harness.getRemoveCount()).toBe(0)
    expect(harness.hostWrites).toEqual([])
  })

  it('does not migrate over customized Host values', async () => {
    const hostMode: SidebarPreferences['headerMode'] = DEFAULT_PREFERENCES.headerMode === 'compact' ? 'expanded' : 'compact'
    const host: SidebarPreferences = { ...DEFAULT_PREFERENCES, headerMode: hostMode }
    const harness = createClient({ local: DEFAULT_PREFERENCES, host })
    const actor = startMachine(harness.client)

    actor.send({ type: 'migration.requested' })
    await waitFor(actor, snapshot => snapshot.context.migrationStatus === 'done')
    expect(harness.hostWrites).toEqual([])
    expect(harness.getLocal()).toBeNull()
    expect(harness.getRemoveCount()).toBe(1)
  })

  it('keeps the browser copies until the Host write that holds them settles, then clears them', async () => {
    const write = deferred<boolean>()
    const harness = createClient({
      legacy: settledLegacy({ threadViews: { settings: customThreadViews(), doneFiltersMigrated: false, shippedFiltersMigrated: false } }),
      writeHost: () => write.promise,
    })
    const actor = startMachine(harness.client)

    actor.send({ type: 'migration.requested' })
    await vi.waitFor(() => expect(harness.hostWrites).toHaveLength(1))
    expect(harness.hostWrites[0]).toEqual({ threadViews: customThreadViews() })
    expect(harness.getLegacyClearCount()).toBe(0)

    write.resolve(true)
    await waitFor(actor, snapshot => snapshot.context.migrationStatus === 'done')
    expect(harness.getLegacyClearCount()).toBe(1)
  })

  it('keeps the browser copies when the Host refuses their value', async () => {
    const harness = createClient({
      legacy: settledLegacy({ collapsedGroups: ['project:alpha'] }),
      writeHost: async () => false,
    })
    const actor = startMachine(harness.client)

    actor.send({ type: 'migration.requested' })
    await waitFor(actor, snapshot => snapshot.context.migrationStatus === 'failed')
    expect(harness.hostWrites).toEqual([{ collapsedGroups: ['project:alpha'] }])
    expect(harness.getLegacyClearCount()).toBe(0)
  })

  it('writes the browser preferences before the legacy copies in one pass', async () => {
    const migratedMode: SidebarPreferences['headerMode'] = DEFAULT_PREFERENCES.headerMode === 'compact' ? 'expanded' : 'compact'
    const harness = createClient({
      local: { ...DEFAULT_PREFERENCES, headerMode: migratedMode },
      legacy: settledLegacy({ collapsedGroups: ['project:alpha'] }),
    })
    const actor = startMachine(harness.client)

    actor.send({ type: 'migration.requested' })
    await waitFor(actor, snapshot => snapshot.context.migrationStatus === 'done')
    expect(harness.hostWrites).toEqual([{ headerMode: migratedMode }, { collapsedGroups: ['project:alpha'] }])
    expect(harness.getLegacyClearCount()).toBe(1)
  })

  it('drops browser copies that need no write without writing anything', async () => {
    const harness = createClient()
    const actor = startMachine(harness.client)

    actor.send({ type: 'migration.requested' })
    await waitFor(actor, snapshot => snapshot.context.migrationStatus === 'done')
    expect(harness.hostWrites).toEqual([])
    expect(harness.getLegacyClearCount()).toBe(1)
  })

  it('keeps the browser copies when the Host is unavailable', async () => {
    const harness = createClient({ host: null, legacy: settledLegacy({ collapsedGroups: ['project:alpha'] }) })
    const actor = startMachine(harness.client)

    actor.send({ type: 'migration.requested' })
    await waitFor(actor, snapshot => snapshot.matches('idle') && snapshot.context.migrationOperationId === null)
    expect(actor.getSnapshot().context.migrationStatus).toBe('idle')
    expect(harness.hostWrites).toEqual([])
    expect(harness.getLegacyClearCount()).toBe(0)
  })

  it('records synchronous local storage results as warning state', () => {
    const actor = startMachine(createClient().client)

    actor.send({ type: 'local.write.result', success: false })
    expect(actor.getSnapshot().context.localWriteFailed).toBe(true)

    actor.send({ type: 'local.write.result', success: true })
    expect(actor.getSnapshot().context.localWriteFailed).toBe(false)
  })

  it('ignores a late Host result after the owning actor stops', async () => {
    const pendingWrite = deferred<boolean>()
    const harness = createClient({ writeHost: () => pendingWrite.promise })
    const actor = startMachine(harness.client)
    actor.send({ type: 'host.update', patch: { idleMinutes: 30 } })
    await vi.waitFor(() => expect(harness.hostWrites).toHaveLength(1))

    actor.stop()
    pendingWrite.resolve(false)
    await Promise.resolve()
    expect(actor.getSnapshot().status).toBe('stopped')
  })
})
