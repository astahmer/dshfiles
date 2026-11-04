import type { ApiCaller } from '@dshfiles/dshx/api'
import { describe, expect, it } from '@effect/vitest'
import { Cause, Effect, Exit, FileSystem, Path, Schema } from 'effect'
import { packDefinitionSchema, type PackDefinition, type PropertyValues, type ResourceRecord } from '../src/model.js'
import type { ResourceStore } from '../src/store.js'
import { platformLayer, scratchStoreFile, storeLayer, withRawSql, withStore } from './store-layers.js'

type Store = ResourceStore['Service']

const user: ApiCaller = { kind: 'client' }
const plugin: ApiCaller = { kind: 'plugin', packageId: '@test/contributor' }
const ref = { provider: 'native', kind: 'file', id: '/Case/Sensitive/File.md' }
const definition = Schema.decodeUnknownSync(packDefinitionSchema)({
  id: 'all-types',
  version: 1,
  label: 'All types',
  properties: [
    { id: 'text', label: 'Text', type: 'text' },
    { id: 'number', label: 'Number', type: 'number' },
    { id: 'check', label: 'Check', type: 'checkbox' },
    { id: 'date', label: 'Date', type: 'date' },
    { id: 'datetime', label: 'Date/time', type: 'datetime' },
    { id: 'select', label: 'Select', type: 'select', options: [{ id: 'one', label: 'One' }] },
    {
      id: 'multi',
      label: 'Multi',
      type: 'multiselect',
      options: [
        { id: 'one', label: 'One' },
        { id: 'two', label: 'Two' },
      ],
    },
    { id: 'ref', label: 'Reference', type: 'reference' },
    { id: 'refs', label: 'References', type: 'references' },
    { id: 'computed', label: 'Owner only', type: 'text', readOnly: true },
  ],
})
const UserVersionRows = Schema.Array(Schema.Struct({ user_version: Schema.Number }))

const attached = (store: Store) =>
  Effect.gen(function* () {
    yield* store.registerPack({ input: { definition }, caller: plugin })
    const resource = yield* store.registerResource({ input: { ref, label: 'Case sensitive file' }, caller: user })
    return yield* store.attach({ input: { resourceId: resource.id, expectedRevision: resource.revision, packId: definition.id }, caller: user })
  })

const edit = (store: Store, resource: ResourceRecord, values: PropertyValues, packId = definition.id) =>
  store.setValues({ input: { resourceId: resource.id, expectedRevision: resource.revision, packId, values }, caller: user })

const modeOf = (file: string) =>
  Effect.map(
    Effect.flatMap(FileSystem.FileSystem, fs => fs.stat(file)),
    info => info.mode & 0o777,
  )

const failureReport = (exit: Exit.Exit<unknown, unknown>) => (Exit.isFailure(exit) ? Cause.pretty(exit.cause) : '')

describe('persistent resource metadata', () => {
  it.effect('uses private permissions, versioned SQLite and exact idempotent opaque identity', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchStoreFile
      const path = yield* Path.Path
      const resource = yield* withStore(scratch.filename, store =>
        Effect.gen(function* () {
          const registered = yield* store.registerResource({ input: { ref, label: 'First label' }, caller: user })
          expect(yield* store.registerResource({ input: { ref, label: 'Not an overwrite' }, caller: plugin })).toEqual(registered)
          const differentlyCased = yield* store.registerResource({
            input: { ref: { ...ref, id: ref.id.toLowerCase() }, label: 'Different resource' },
            caller: user,
          })
          expect(differentlyCased.id).not.toBe(registered.id)
          expect((yield* store.get({ resourceId: registered.id })).events).toHaveLength(1)
          return registered
        }),
      )
      expect(yield* modeOf(scratch.filename)).toBe(0o600)
      expect(yield* modeOf(path.dirname(scratch.filename))).toBe(0o700)
      const versions = yield* withRawSql(scratch.filename, sql => Effect.flatMap(sql`PRAGMA user_version`, Schema.decodeUnknownEffect(UserVersionRows)))
      expect(versions).toEqual([{ user_version: 1 }])
      expect((yield* withStore(scratch.filename, store => store.get({ resourceId: resource.id }))).resource).toEqual(resource)
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('round-trips all nine types, partial updates, explicit nulls and owner-written values', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchStoreFile
      const values = {
        text: 'Metadata only',
        number: 2.5,
        check: false,
        date: '2024-02-29',
        datetime: '2024-02-29T20:30:00+02:00',
        select: 'one',
        multi: ['one', 'two'],
        ref,
        refs: [ref],
      }
      const cleared = yield* withStore(scratch.filename, store =>
        Effect.gen(function* () {
          const resource = yield* attached(store)
          expect(Object.values(resource.attachments[0]?.values ?? {})).toEqual(Array(10).fill(null))
          const updated = yield* edit(store, resource, values)
          const computed = yield* store.setValues({
            input: { resourceId: updated.id, expectedRevision: updated.revision, packId: definition.id, values: { computed: 'Owner snapshot' } },
            caller: plugin,
          })
          return yield* edit(store, computed, { text: null, number: 0 })
        }),
      )
      expect(cleared.attachments[0]?.values).toEqual({ ...values, text: null, number: 0, computed: 'Owner snapshot' })
      yield* withStore(scratch.filename, store =>
        Effect.gen(function* () {
          expect((yield* store.get({ resourceId: cleared.id })).resource).toEqual(cleared)
          expect(yield* store.registerResource({ input: { ref, label: 'Do not reset attachments' }, caller: user })).toEqual(cleared)
        }),
      )
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect.each<PropertyValues>([
    { text: 12 },
    { number: '12' },
    { check: 'false' },
    { date: '2023-02-29' },
    { date: '2024-04-31' },
    { date: '2024-02-29T00:00:00Z' },
    { datetime: '2024-02-29' },
    { datetime: '2023-02-29T00:00:00Z' },
    { datetime: '2024-01-01T25:00:00Z' },
    { datetime: '2024-01-01T00:00:00' },
    { select: 'One' },
    { multi: ['one', 'one'] },
    { multi: ['missing'] },
    { refs: [ref, ref] },
    { ref: { provider: 'BAD', kind: 'file', id: 'opaque' } },
    { unknown: 'value' },
    { number: Number.POSITIVE_INFINITY },
  ])('rejects invalid values atomically: %j', invalid =>
    Effect.gen(function* () {
      const scratch = yield* scratchStoreFile
      yield* withStore(scratch.filename, store =>
        Effect.gen(function* () {
          const resource = yield* attached(store)
          const before = yield* store.get({ resourceId: resource.id })
          const error = yield* Effect.flip(edit(store, resource, { text: 'Must not partially persist', ...invalid }))
          expect(['InvalidPropertyValues', 'UnknownProperty']).toContain(error._tag)
          expect(yield* store.get({ resourceId: resource.id })).toEqual(before)
        }),
      )
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('rejects user, agent and foreign-plugin read-only writes, including null', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchStoreFile
      yield* withStore(scratch.filename, store =>
        Effect.gen(function* () {
          const resource = yield* attached(store)
          const input = { resourceId: resource.id, expectedRevision: resource.revision, packId: definition.id, values: { computed: null, text: 'not written' } }
          const callers: ReadonlyArray<ApiCaller> = [user, { kind: 'agent', sessionId: 'session-test' }, { kind: 'plugin', packageId: '@test/other' }]
          for (const caller of callers) {
            const error = yield* Effect.flip(store.setValues({ input, caller }))
            expect(error.message).toMatch(/Only the plugin/)
          }
          expect((yield* store.get({ resourceId: resource.id })).resource).toEqual(resource)
        }),
      )
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('refuses stale revisions across two SQLite handles with no partial changes', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchStoreFile
      yield* withStore(scratch.filename, store =>
        Effect.gen(function* () {
          const resource = yield* attached(store)
          yield* withStore(scratch.filename, second =>
            Effect.gen(function* () {
              const updated = yield* edit(store, resource, { text: 'winner' })
              const snapshot = yield* store.get({ resourceId: resource.id })
              const stale = { resourceId: resource.id, expectedRevision: resource.revision, packId: definition.id }
              const failures = [
                yield* Effect.flip(second.setValues({ input: { ...stale, values: { text: 'loser' } }, caller: user })),
                yield* Effect.flip(second.detach({ input: { ...stale, confirm: true }, caller: user })),
                yield* Effect.flip(second.attach({ input: { ...stale, packId: 'tracking' }, caller: user })),
              ]
              for (const failure of failures) expect(failure.message).toMatch(/changed/)
              expect(yield* second.get({ resourceId: resource.id })).toEqual(snapshot)
              expect(snapshot.resource).toEqual(updated)
            }),
          )
        }),
      )
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('rolls back value and revision changes if audit insertion fails', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchStoreFile
      yield* withStore(scratch.filename, store =>
        Effect.gen(function* () {
          const resource = yield* attached(store)
          const before = yield* store.get({ resourceId: resource.id })
          yield* withRawSql(scratch.filename, sql =>
            sql.unsafe("CREATE TRIGGER fail_audit BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'test audit failure'); END"),
          )
          const exit = yield* Effect.exit(edit(store, resource, { text: 'rollback' }))
          expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({ _tag: 'ResourceStoreFailed', operation: 'set-values' })
          expect(failureReport(exit)).toMatch(/test audit failure/)
          expect(yield* store.get({ resourceId: resource.id })).toEqual(before)
        }),
      )
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('detaches softly and reattaches retained values after reopening', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchStoreFile
      const detached = yield* withStore(scratch.filename, store =>
        Effect.gen(function* () {
          const resource = yield* attached(store)
          const updated = yield* edit(store, resource, { text: 'kept', date: '2024-02-29' })
          const detachedResource = yield* store.detach({
            input: { resourceId: resource.id, expectedRevision: updated.revision, packId: definition.id, confirm: true },
            caller: user,
          })
          expect(detachedResource.attachments[0]).toMatchObject({ attached: false, values: { text: 'kept' } })
          expect((yield* store.list({ packId: definition.id })).total).toBe(0)
          expect((yield* Effect.flip(edit(store, detachedResource, { text: 'no' }))).message).toMatch(/Attach/)
          return detachedResource
        }),
      )
      const reattached = yield* withStore(scratch.filename, store =>
        store.attach({ input: { resourceId: detached.id, expectedRevision: detached.revision, packId: definition.id }, caller: user }),
      )
      expect(reattached.attachments[0]).toMatchObject({ attached: true, values: { text: 'kept', date: '2024-02-29' } })
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('bounds list to 200 with correct filtered total and literal query punctuation', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchStoreFile
      yield* withStore(scratch.filename, store =>
        Effect.gen(function* () {
          for (let index = 0; index < 205; index++) {
            yield* store.registerResource({ input: { ref: { ...ref, id: `opaque-${index}` }, label: `Resource ${index}` }, caller: user })
          }
          const special = yield* store.registerResource({
            input: { ref: { ...ref, kind: 'conversation', id: 'opaque_%' }, label: "Literal %_' OR 1=1 --" },
            caller: user,
          })
          yield* store.attach({ input: { resourceId: special.id, expectedRevision: special.revision, packId: 'tracking' }, caller: user })
          expect((yield* store.list({})).resources).toHaveLength(200)
          expect((yield* store.list({})).total).toBe(206)
          expect(yield* store.list({ kind: 'file', limit: 3 })).toMatchObject({ total: 205, resources: Array(3).fill(expect.anything()) })
          expect((yield* store.list({ query: "%'_" })).total).toBe(0)
          expect(yield* store.list({ query: '%_', kind: 'conversation', packId: 'tracking' })).toMatchObject({ total: 1, resources: [{ id: special.id }] })
          expect((yield* store.list({ packId: 'missing' })).total).toBe(0)
        }),
      )
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('treats constructor as a normal field ID, never an inherited default', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchStoreFile
      const pack = Schema.decodeUnknownSync(packDefinitionSchema)({
        id: 'prototype-key',
        version: 1,
        label: 'Own keys',
        properties: [{ id: 'constructor', label: 'Constructor', type: 'text' }],
      })
      const written = yield* withStore(scratch.filename, store =>
        Effect.gen(function* () {
          yield* store.registerPack({ input: { definition: pack }, caller: plugin })
          const registered = yield* store.registerResource({ input: { ref, label: 'Own key resource' }, caller: user })
          const withPack = yield* store.attach({ input: { resourceId: registered.id, expectedRevision: registered.revision, packId: pack.id }, caller: user })
          expect(withPack.attachments[0]?.values.constructor).toBeNull()
          return yield* edit(store, withPack, { constructor: 'Own property' }, pack.id)
        }),
      )
      const reopened = yield* withStore(scratch.filename, store => store.get({ resourceId: written.id }))
      expect(reopened.resource.attachments[0]?.values.constructor).toBe('Own property')
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('refuses malformed plugin actor identities without persisting metadata or audit payload', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchStoreFile
      yield* withStore(scratch.filename, store =>
        Effect.gen(function* () {
          const before = yield* store.catalog()
          const spoofed = yield* Effect.flip(
            store.registerPack({ input: { definition }, caller: { kind: 'plugin', packageId: '@test/contributor\nsecret:DO_NOT_AUDIT' } }),
          )
          const oversized = yield* Effect.flip(
            store.registerResource({ input: { ref, label: 'Not persisted' }, caller: { kind: 'plugin', packageId: 'x'.repeat(201) } }),
          )
          expect([spoofed._tag, oversized._tag]).toEqual(['InvalidCaller', 'InvalidCaller'])
          expect(yield* store.catalog()).toEqual(before)
          expect(yield* store.list({})).toEqual({ total: 0, resources: [] })
        }),
      )
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('returns the newest 100 payload-free audit events', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchStoreFile
      yield* withStore(scratch.filename, store =>
        Effect.gen(function* () {
          let resource = yield* attached(store)
          for (let index = 0; index < 105; index++) resource = yield* edit(store, resource, { text: 'secret:NEVER_IN_AUDIT' })
          const events = (yield* store.get({ resourceId: resource.id })).events
          expect(events).toHaveLength(100)
          expect(events[0]?.revision).toBe(resource.revision)
          expect(events[99]?.revision).toBe(resource.revision - 99)
          expect(JSON.stringify(events)).not.toContain('NEVER_IN_AUDIT')
          expect(events.every(event => event.actor === 'user')).toBe(true)
        }),
      )
    }).pipe(Effect.provide(platformLayer)),
  )
})

describe('aggregate serialized metadata budgets', () => {
  it.effect('rejects a pack above 128 KiB without persisting a schema', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchStoreFile
      const oversized = Schema.decodeUnknownSync(packDefinitionSchema)({
        id: 'large-pack',
        version: 1,
        label: 'Large pack',
        properties: Array.from({ length: 15 }, (_, index) => ({
          id: `field-${index}`,
          label: 'Select',
          type: 'select',
          options: Array.from({ length: 100 }, (_, option) => ({ id: `option-${option}`, label: 'x'.repeat(100) })),
        })),
      })
      yield* withStore(scratch.filename, store =>
        Effect.gen(function* () {
          const before = yield* store.catalog()
          expect(yield* Effect.flip(store.registerPack({ input: { definition: oversized }, caller: plugin }))).toMatchObject({
            _tag: 'MetadataTooLarge',
            subject: 'pack-definition',
          })
          expect(yield* store.catalog()).toEqual(before)
        }),
      )
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('rejects patches above 64 KiB and accumulated resource metadata above 256 KiB atomically', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchStoreFile
      const pack = Schema.decodeUnknownSync(packDefinitionSchema)({
        id: 'large-values',
        version: 1,
        label: 'Large values',
        properties: Array.from({ length: 20 }, (_, index) => ({ id: `field-${index}`, label: 'Text', type: 'text' })),
      })
      const nearLimit = yield* withStore(scratch.filename, store =>
        Effect.gen(function* () {
          yield* store.registerPack({ input: { definition: pack }, caller: plugin })
          const registered = yield* store.registerResource({ input: { ref, label: 'Budgeted resource' }, caller: user })
          let resource = yield* store.attach({ input: { resourceId: registered.id, expectedRevision: registered.revision, packId: pack.id }, caller: user })
          const snapshot = yield* store.get({ resourceId: resource.id })
          const patch = (values: PropertyValues) => edit(store, resource, values, pack.id)
          // Both fields fit their per-field character bound, but their UTF-8 bytes exceed the patch budget.
          expect(yield* Effect.flip(patch({ 'field-0': 'é'.repeat(20_000), 'field-1': 'é'.repeat(20_000) }))).toMatchObject({
            _tag: 'MetadataTooLarge',
            subject: 'property-patch',
          })
          expect(yield* store.get({ resourceId: resource.id })).toEqual(snapshot)
          for (let index = 0; index < 13; index++) resource = yield* patch({ [`field-${index}`]: 'x'.repeat(20_000) })
          const full = yield* store.get({ resourceId: resource.id })
          expect(yield* Effect.flip(patch({ 'field-13': 'x'.repeat(20_000) }))).toMatchObject({ _tag: 'MetadataTooLarge', subject: 'resource' })
          expect(yield* store.get({ resourceId: resource.id })).toEqual(full)
          const headroom = 256 * 1024 - Buffer.byteLength(JSON.stringify(full.resource), 'utf8')
          expect(headroom).toBeGreaterThan(50)
          expect(headroom).toBeLessThan(20_000)
          resource = yield* patch({ 'field-13': 'x'.repeat(headroom - 50) })
          const atLimit = yield* store.get({ resourceId: resource.id })
          const catalog = yield* store.catalog()
          const expanded: PackDefinition = {
            ...pack,
            version: 2,
            properties: [...pack.properties, { id: `added-${'x'.repeat(70)}`, label: 'Added', type: 'text', description: '', readOnly: false }],
          }
          expect(yield* Effect.flip(store.registerPack({ input: { definition: expanded }, caller: plugin }))).toMatchObject({ _tag: 'MetadataTooLarge' })
          expect(yield* store.catalog()).toEqual(catalog)
          expect(yield* store.get({ resourceId: resource.id })).toEqual(atLimit)
          return atLimit
        }),
      )
      expect(yield* withStore(scratch.filename, store => store.get({ resourceId: nearLimit.resource.id }))).toEqual(nearLimit)
    }).pipe(Effect.provide(platformLayer)),
  )
})

describe('pack ownership and compatibility', () => {
  it.effect('persists owners, refuses namespace takeover and treats identical registration as idempotent', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchStoreFile
      yield* withStore(scratch.filename, store =>
        Effect.gen(function* () {
          const saved = yield* store.registerPack({ input: { definition }, caller: plugin })
          expect(yield* store.registerPack({ input: { definition }, caller: plugin })).toEqual(saved)
          expect((yield* Effect.flip(store.registerPack({ input: { definition }, caller: user }))).message).toMatch(/another owner/)
          const takeover = yield* Effect.flip(store.registerPack({ input: { definition: { ...definition, id: 'tracking' } }, caller: plugin }))
          expect(takeover.message).toMatch(/another owner/)
          expect((yield* store.catalog()).packs.find(pack => pack.definition.id === 'tracking')?.owner).toBe('@dshfiles/resource-packs')
          const userPack = yield* store.registerPack({ input: { definition: { ...definition, id: 'user-owned' } }, caller: user })
          expect(userPack.owner).toBe('user')
          const reserved = yield* Effect.flip(store.registerPack({ input: { definition: userPack.definition }, caller: { kind: 'plugin', packageId: 'user' } }))
          expect(reserved).toMatchObject({ _tag: 'InvalidCaller' })
          expect(yield* store.registerPack({ input: { definition: userPack.definition }, caller: { kind: 'agent', sessionId: 'session-test' } })).toEqual(
            userPack,
          )
        }),
      )
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('allows higher-version labels, option labels and additions without changing stored IDs', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchStoreFile
      const renamed: PackDefinition = {
        ...definition,
        version: 2,
        label: 'Renamed',
        properties: [
          ...definition.properties.map(property => {
            if (property.type === 'select' || property.type === 'multiselect')
              return {
                ...property,
                label: 'Renamed field',
                options: [...property.options.map(option => ({ ...option, label: 'Renamed option' })), { id: 'three', label: 'Three' }],
              }
            return property
          }),
          { id: 'added', label: 'Added', type: 'checkbox', readOnly: false, description: '' },
        ],
      }
      yield* withStore(scratch.filename, store =>
        Effect.gen(function* () {
          const resource = yield* attached(store)
          const updated = yield* edit(store, resource, { select: 'one', multi: ['two'] })
          yield* store.registerPack({ input: { definition: renamed }, caller: plugin })
          expect((yield* store.get({ resourceId: resource.id })).resource).toMatchObject({
            revision: updated.revision,
            attachments: [{ values: { select: 'one', multi: ['two'], added: null } }],
          })
        }),
      )
      const catalog = yield* withStore(scratch.filename, store => store.catalog())
      expect(catalog.packs.find(pack => pack.definition.id === definition.id)?.definition).toEqual(renamed)
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('rejects downgrade, same-version changes and dangerous schema updates without mutation', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchStoreFile
      const changes: PackDefinition[] = [
        { ...definition, label: 'Same version' },
        { ...definition, version: 0 },
        { ...definition, version: 2, properties: definition.properties.slice(1) },
        { ...definition, version: 2, properties: definition.properties.map(property => (property.id === 'text' ? { ...property, type: 'date' } : property)) },
        { ...definition, version: 2, properties: definition.properties.map(property => ({ ...property, readOnly: true })) },
        {
          ...definition,
          version: 2,
          properties: definition.properties.map(property => (property.type === 'multiselect' ? { ...property, options: property.options.slice(1) } : property)),
        },
      ]
      yield* withStore(scratch.filename, store =>
        Effect.gen(function* () {
          yield* store.registerPack({ input: { definition }, caller: plugin })
          const before = yield* store.catalog()
          const refusals = yield* Effect.forEach(changes, next => Effect.flip(store.registerPack({ input: { definition: next }, caller: plugin })))
          expect(refusals.map(refusal => refusal._tag)).toEqual([
            'PackVersionConflict',
            'InvalidPackDefinition',
            'PackMigrationRequired',
            'PackMigrationRequired',
            'PackMigrationRequired',
            'PackMigrationRequired',
          ])
          expect(yield* store.catalog()).toEqual(before)
        }),
      )
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('rolls back the entire initial migration when an existing table conflicts', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchStoreFile
      const path = yield* Path.Path
      const legacyPath = path.join(scratch.directory, 'legacy.db')
      yield* withRawSql(legacyPath, sql => sql`CREATE TABLE resources (legacy TEXT)`)
      const exit = yield* Effect.exit(Effect.provide(Effect.void, storeLayer(legacyPath)))
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({ _tag: 'SqliteMigrationFailed' })
      expect(failureReport(exit)).toMatch(/already exists/)
      const inspected = yield* withRawSql(legacyPath, sql =>
        Effect.all({
          version: Effect.flatMap(sql`PRAGMA user_version`, Schema.decodeUnknownEffect(UserVersionRows)),
          tables: sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
          migrations: sql`SELECT count(*) AS applied FROM effect_sql_migrations`,
        }),
      )
      expect(inspected).toEqual({
        version: [{ user_version: 0 }],
        tables: [{ name: 'effect_sql_migrations' }, { name: 'resources' }],
        migrations: [{ applied: 0 }],
      })
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('fails closed on malformed persisted JSON and unknown future migrations', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchStoreFile
      const resource = yield* withStore(scratch.filename, attached)
      yield* withRawSql(scratch.filename, sql => sql`UPDATE attachments SET values_json = ${'{"date":"2023-02-29"}'} WHERE resource_id = ${resource.id}`)
      const corrupt = yield* withStore(scratch.filename, store => Effect.flip(store.get({ resourceId: resource.id })))
      expect(corrupt.message).toMatch(/declared date/)
      yield* withRawSql(scratch.filename, sql => sql`UPDATE attachments SET values_json = ${'not json'} WHERE resource_id = ${resource.id}`)
      const unparsable = yield* withStore(scratch.filename, store => Effect.flip(store.get({ resourceId: resource.id })))
      expect(unparsable).toMatchObject({ _tag: 'InvalidPropertyValues' })
      yield* withRawSql(scratch.filename, sql => sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (999, ${'future'})`)
      const newer = yield* Effect.flip(Effect.provide(Effect.void, storeLayer(scratch.filename)))
      expect(newer).toMatchObject({ _tag: 'SqliteStoreVersionUnsupported', source: 'migrations', foundVersion: 999 })
      expect(newer.message).toMatch(/newer/)
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('refuses a newer legacy user_version before adopting the file', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchStoreFile
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      yield* fs.makeDirectory(path.dirname(scratch.filename), { recursive: true })
      yield* withRawSql(scratch.filename, sql => sql`PRAGMA user_version = 999`)
      const newer = yield* Effect.flip(Effect.provide(Effect.void, storeLayer(scratch.filename)))
      expect(newer).toMatchObject({ _tag: 'SqliteStoreVersionUnsupported', source: 'user-version', foundVersion: 999, supportedVersion: 1 })
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('refuses a symlinked registry directory or file instead of following it', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchStoreFile
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const real = path.join(scratch.directory, 'real')
      yield* fs.makeDirectory(real)
      yield* fs.symlink(real, path.join(scratch.directory, 'linked'))
      const viaDirectory = yield* Effect.flip(Effect.provide(Effect.void, storeLayer(path.join(scratch.directory, 'linked', 'resources.db'))))
      expect(viaDirectory).toMatchObject({ _tag: 'UnsafeResourceStorage', reason: 'symbolic-link' })
      yield* fs.writeFile(path.join(real, 'target.db'), new Uint8Array())
      yield* fs.symlink(path.join(real, 'target.db'), path.join(real, 'resources.db'))
      const viaFile = yield* Effect.flip(Effect.provide(Effect.void, storeLayer(path.join(real, 'resources.db'))))
      expect(viaFile).toMatchObject({ _tag: 'UnsafeResourceStorage', reason: 'symbolic-link' })
      expect(Number((yield* fs.stat(path.join(real, 'target.db'))).size)).toBe(0)
    }).pipe(Effect.provide(platformLayer)),
  )
})
