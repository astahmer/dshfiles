import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { packDefinitionSchema, type PackDefinition, type PropertyValues } from '../src/model.js'
import { ResourceStore } from '../src/store.js'

const user = { kind: 'client' } as const
const plugin = { kind: 'plugin', packageId: '@test/contributor' } as const
const ref = { provider: 'native', kind: 'file', id: '/Case/Sensitive/File.md' }
const definition = packDefinitionSchema.parse({
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

let directory: string
let path: string
let store: ResourceStore
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'resource-packs-store-'))
  path = join(directory, 'metadata', 'resources.db')
  store = new ResourceStore(path)
})
afterEach(() => {
  store.close()
  rmSync(directory, { recursive: true, force: true })
})

function attached() {
  store.registerPack({ definition }, plugin)
  const resource = store.registerResource({ ref, label: 'Case sensitive file' }, user)
  return store.attach({ resourceId: resource.id, expectedRevision: resource.revision, packId: definition.id }, user)
}

function edit(resourceId: string, revision: number, values: PropertyValues) {
  return store.setValues({ resourceId, expectedRevision: revision, packId: definition.id, values }, user)
}

describe('persistent resource metadata', () => {
  it('uses private permissions, versioned SQLite and exact idempotent opaque identity', () => {
    const resource = store.registerResource({ ref, label: 'First label' }, user)
    expect(store.registerResource({ ref, label: 'Not an overwrite' }, plugin)).toEqual(resource)
    const differentlyCased = store.registerResource({ ref: { ...ref, id: ref.id.toLowerCase() }, label: 'Different resource' }, user)
    expect(differentlyCased.id).not.toBe(resource.id)
    expect(store.get({ resourceId: resource.id }).events).toHaveLength(1)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700)
    const db = new DatabaseSync(path)
    try {
      expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 })
    } finally {
      db.close()
    }
    store.close()
    store = new ResourceStore(path)
    expect(store.get({ resourceId: resource.id }).resource).toEqual(resource)
  })

  it('round-trips all nine types, partial updates, explicit nulls and owner-written values', () => {
    const resource = attached()
    expect(Object.values(resource.attachments[0]?.values ?? {})).toEqual(Array(10).fill(null))
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
    const updated = edit(resource.id, resource.revision, values)
    const computed = store.setValues(
      { resourceId: updated.id, expectedRevision: updated.revision, packId: definition.id, values: { computed: 'Owner snapshot' } },
      plugin,
    )
    const cleared = edit(computed.id, computed.revision, { text: null, number: 0 })
    expect(cleared.attachments[0]?.values).toEqual({ ...values, text: null, number: 0, computed: 'Owner snapshot' })
    store.close()
    store = new ResourceStore(path)
    expect(store.get({ resourceId: resource.id }).resource).toEqual(cleared)
    expect(store.registerResource({ ref, label: 'Do not reset attachments' }, user)).toEqual(cleared)
  })

  it.each<PropertyValues>([
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
  ])('rejects invalid values atomically: %j', invalid => {
    const resource = attached()
    const before = store.get({ resourceId: resource.id })
    expect(() => edit(resource.id, resource.revision, { text: 'Must not partially persist', ...invalid })).toThrow()
    expect(store.get({ resourceId: resource.id })).toEqual(before)
  })

  it('rejects user, agent and foreign-plugin read-only writes, including null', () => {
    const resource = attached()
    const input = { resourceId: resource.id, expectedRevision: resource.revision, packId: definition.id, values: { computed: null, text: 'not written' } }
    for (const caller of [user, { kind: 'agent' } as const, { kind: 'plugin', packageId: '@test/other' } as const]) {
      expect(() => store.setValues(input, caller)).toThrow(/Only the plugin/)
    }
    expect(store.get({ resourceId: resource.id }).resource).toEqual(resource)
  })

  it('refuses stale revisions across two SQLite handles with no partial changes', () => {
    const resource = attached()
    const second = new ResourceStore(path)
    try {
      const updated = edit(resource.id, resource.revision, { text: 'winner' })
      const snapshot = store.get({ resourceId: resource.id })
      expect(() =>
        second.setValues({ resourceId: resource.id, expectedRevision: resource.revision, packId: definition.id, values: { text: 'loser' } }, user),
      ).toThrow(/changed/)
      expect(() => second.detach({ resourceId: resource.id, expectedRevision: resource.revision, packId: definition.id, confirm: true }, user)).toThrow(
        /changed/,
      )
      expect(() => second.attach({ resourceId: resource.id, expectedRevision: resource.revision, packId: 'tracking' }, user)).toThrow(/changed/)
      expect(second.get({ resourceId: resource.id })).toEqual(snapshot)
      expect(snapshot.resource).toEqual(updated)
    } finally {
      second.close()
    }
  })

  it('rolls back value and revision changes if audit insertion fails', () => {
    const resource = attached()
    const before = store.get({ resourceId: resource.id })
    const db = new DatabaseSync(path)
    try {
      db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'test audit failure'); END")
    } finally {
      db.close()
    }
    expect(() => edit(resource.id, resource.revision, { text: 'rollback' })).toThrow(/test audit failure/)
    expect(store.get({ resourceId: resource.id })).toEqual(before)
  })

  it('detaches softly and reattaches retained values after reopening', () => {
    const resource = attached()
    const updated = edit(resource.id, resource.revision, { text: 'kept', date: '2024-02-29' })
    const detached = store.detach({ resourceId: resource.id, expectedRevision: updated.revision, packId: definition.id, confirm: true }, user)
    expect(detached.attachments[0]).toMatchObject({ attached: false, values: { text: 'kept' } })
    expect(store.list({ packId: definition.id }).total).toBe(0)
    expect(() => edit(resource.id, detached.revision, { text: 'no' })).toThrow(/Attach/)
    store.close()
    store = new ResourceStore(path)
    const reattached = store.attach({ resourceId: resource.id, expectedRevision: detached.revision, packId: definition.id }, user)
    expect(reattached.attachments[0]).toMatchObject({ attached: true, values: { text: 'kept', date: '2024-02-29' } })
  })

  it('bounds list to 200 with correct filtered total and literal query punctuation', () => {
    for (let index = 0; index < 205; index++) store.registerResource({ ref: { ...ref, id: `opaque-${index}` }, label: `Resource ${index}` }, user)
    const special = store.registerResource({ ref: { ...ref, kind: 'conversation', id: 'opaque_%' }, label: "Literal %_' OR 1=1 --" }, user)
    store.attach({ resourceId: special.id, expectedRevision: special.revision, packId: 'tracking' }, user)
    expect(store.list({}).resources).toHaveLength(200)
    expect(store.list({}).total).toBe(206)
    expect(store.list({ kind: 'file', limit: 3 })).toMatchObject({ total: 205, resources: Array(3).fill(expect.anything()) })
    expect(store.list({ query: "%'_" }).total).toBe(0)
    expect(store.list({ query: '%_', kind: 'conversation', packId: 'tracking' })).toMatchObject({ total: 1, resources: [{ id: special.id }] })
    expect(store.list({ packId: 'missing' }).total).toBe(0)
  })

  it('treats constructor as a normal field ID, never an inherited default', () => {
    const pack = packDefinitionSchema.parse({
      id: 'prototype-key',
      version: 1,
      label: 'Own keys',
      properties: [{ id: 'constructor', label: 'Constructor', type: 'text' }],
    })
    store.registerPack({ definition: pack }, plugin)
    let resource = store.registerResource({ ref, label: 'Own key resource' }, user)
    resource = store.attach({ resourceId: resource.id, expectedRevision: resource.revision, packId: pack.id }, user)
    expect(resource.attachments[0]?.values.constructor).toBeNull()
    resource = store.setValues({ resourceId: resource.id, expectedRevision: resource.revision, packId: pack.id, values: { constructor: 'Own property' } }, user)
    store.close()
    store = new ResourceStore(path)
    expect(store.get({ resourceId: resource.id }).resource.attachments[0]?.values.constructor).toBe('Own property')
  })

  it('refuses malformed plugin actor identities without persisting metadata or audit payload', () => {
    const before = store.catalog()
    expect(() => store.registerPack({ definition }, { kind: 'plugin', packageId: '@test/contributor\nsecret:DO_NOT_AUDIT' })).toThrowError(
      expect.objectContaining({ code: 'invalid-caller' }),
    )
    expect(() => store.registerResource({ ref, label: 'Not persisted' }, { kind: 'plugin', packageId: 'x'.repeat(201) })).toThrowError(
      expect.objectContaining({ code: 'invalid-caller' }),
    )
    expect(store.catalog()).toEqual(before)
    expect(store.list({})).toEqual({ total: 0, resources: [] })
  })

  it('returns the newest 100 payload-free audit events', () => {
    let resource = attached()
    for (let index = 0; index < 105; index++) resource = edit(resource.id, resource.revision, { text: 'secret:NEVER_IN_AUDIT' })
    const events = store.get({ resourceId: resource.id }).events
    expect(events).toHaveLength(100)
    expect(events[0]?.revision).toBe(resource.revision)
    expect(events[99]?.revision).toBe(resource.revision - 99)
    expect(JSON.stringify(events)).not.toContain('NEVER_IN_AUDIT')
    expect(events.every(event => event.actor === 'user')).toBe(true)
  })
})

describe('aggregate serialized metadata budgets', () => {
  it('rejects a pack above 128 KiB without persisting a schema', () => {
    const before = store.catalog()
    const oversized = packDefinitionSchema.parse({
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
    expect(() => store.registerPack({ definition: oversized }, plugin)).toThrowError(expect.objectContaining({ code: 'payload-too-large' }))
    expect(store.catalog()).toEqual(before)
  })

  it('rejects patches above 64 KiB and accumulated resource metadata above 256 KiB atomically', () => {
    const pack = packDefinitionSchema.parse({
      id: 'large-values',
      version: 1,
      label: 'Large values',
      properties: Array.from({ length: 20 }, (_, index) => ({ id: `field-${index}`, label: 'Text', type: 'text' })),
    })
    store.registerPack({ definition: pack }, plugin)
    let resource = store.registerResource({ ref, label: 'Budgeted resource' }, user)
    resource = store.attach({ resourceId: resource.id, expectedRevision: resource.revision, packId: pack.id }, user)
    const snapshot = store.get({ resourceId: resource.id })
    const patch = (values: PropertyValues) => store.setValues({ resourceId: resource.id, expectedRevision: resource.revision, packId: pack.id, values }, user)
    // Both fields fit their per-field character bound, but their UTF-8 bytes exceed the patch budget.
    expect(() => patch({ 'field-0': 'é'.repeat(20_000), 'field-1': 'é'.repeat(20_000) })).toThrowError(expect.objectContaining({ code: 'payload-too-large' }))
    expect(store.get({ resourceId: resource.id })).toEqual(snapshot)
    for (let index = 0; index < 13; index++) resource = patch({ [`field-${index}`]: 'x'.repeat(20_000) })
    const full = store.get({ resourceId: resource.id })
    expect(() => patch({ 'field-13': 'x'.repeat(20_000) })).toThrowError(expect.objectContaining({ code: 'payload-too-large' }))
    expect(store.get({ resourceId: resource.id })).toEqual(full)
    const headroom = 256 * 1024 - Buffer.byteLength(JSON.stringify(full.resource), 'utf8')
    expect(headroom).toBeGreaterThan(50)
    expect(headroom).toBeLessThan(20_000)
    resource = patch({ 'field-13': 'x'.repeat(headroom - 50) })
    const nearLimit = store.get({ resourceId: resource.id })
    const catalog = store.catalog()
    const expanded: PackDefinition = {
      ...pack,
      version: 2,
      properties: [...pack.properties, { id: `added-${'x'.repeat(70)}`, label: 'Added', type: 'text', description: '', readOnly: false }],
    }
    expect(() => store.registerPack({ definition: expanded }, plugin)).toThrowError(expect.objectContaining({ code: 'payload-too-large' }))
    expect(store.catalog()).toEqual(catalog)
    expect(store.get({ resourceId: resource.id })).toEqual(nearLimit)
    store.close()
    store = new ResourceStore(path)
    expect(store.get({ resourceId: resource.id })).toEqual(nearLimit)
  })
})

describe('pack ownership and compatibility', () => {
  it('persists owners, refuses namespace takeover and treats identical registration as idempotent', () => {
    const saved = store.registerPack({ definition }, plugin)
    expect(store.registerPack({ definition }, plugin)).toEqual(saved)
    expect(() => store.registerPack({ definition }, user)).toThrow(/another owner/)
    expect(() => store.registerPack({ definition: { ...definition, id: 'tracking' } }, plugin)).toThrow(/another owner/)
    expect(store.catalog().packs.find(pack => pack.definition.id === 'tracking')?.owner).toBe('@dshfiles/resource-packs')
    const userPack = store.registerPack({ definition: { ...definition, id: 'user-owned' } }, user)
    expect(userPack.owner).toBe('user')
    expect(() => store.registerPack({ definition: userPack.definition }, { kind: 'plugin', packageId: 'user' })).toThrowError(
      expect.objectContaining({ code: 'invalid-caller' }),
    )
    expect(store.registerPack({ definition: userPack.definition }, { kind: 'agent' })).toEqual(userPack)
  })

  it('allows higher-version labels, option labels and additions without changing stored IDs', () => {
    const resource = attached()
    const updated = edit(resource.id, resource.revision, { select: 'one', multi: ['two'] })
    const renamed: PackDefinition = {
      ...definition,
      version: 2,
      label: 'Renamed',
      properties: definition.properties.map(property => {
        if (property.type === 'select' || property.type === 'multiselect')
          return {
            ...property,
            label: 'Renamed field',
            options: [...property.options.map(option => ({ ...option, label: 'Renamed option' })), { id: 'three', label: 'Three' }],
          }
        return property
      }),
    }
    renamed.properties.push({ id: 'added', label: 'Added', type: 'checkbox', readOnly: false, description: '' })
    store.registerPack({ definition: renamed }, plugin)
    expect(store.get({ resourceId: resource.id }).resource).toMatchObject({
      revision: updated.revision,
      attachments: [{ values: { select: 'one', multi: ['two'], added: null } }],
    })
    store.close()
    store = new ResourceStore(path)
    expect(store.catalog().packs.find(pack => pack.definition.id === definition.id)?.definition).toEqual(renamed)
  })

  it('rejects downgrade, same-version changes and dangerous schema updates without mutation', () => {
    store.registerPack({ definition }, plugin)
    const before = store.catalog()
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
    for (const next of changes) expect(() => store.registerPack({ definition: next }, plugin)).toThrow()
    expect(store.catalog()).toEqual(before)
  })

  it('rolls back the entire initial migration when an existing table conflicts', () => {
    const legacyPath = join(directory, 'legacy.db')
    const legacy = new DatabaseSync(legacyPath)
    try {
      legacy.exec('CREATE TABLE resources (legacy TEXT)')
    } finally {
      legacy.close()
    }
    expect(() => new ResourceStore(legacyPath)).toThrow(/already exists/)
    const inspected = new DatabaseSync(legacyPath)
    try {
      expect(inspected.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 0 })
      expect(inspected.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([{ name: 'resources' }])
    } finally {
      inspected.close()
    }
  })

  it('fails closed on malformed persisted JSON and unknown future migrations', () => {
    const resource = attached()
    store.close()
    const db = new DatabaseSync(path)
    try {
      db.prepare('UPDATE attachments SET values_json = ? WHERE resource_id = ?').run('{"date":"2023-02-29"}', resource.id)
    } finally {
      db.close()
    }
    store = new ResourceStore(path)
    expect(() => store.get({ resourceId: resource.id })).toThrow(/declared date/)
    store.close()
    const newer = new DatabaseSync(path)
    try {
      newer.exec('PRAGMA user_version = 999')
    } finally {
      newer.close()
    }
    expect(() => new ResourceStore(path)).toThrow(/newer/)
  })
})
