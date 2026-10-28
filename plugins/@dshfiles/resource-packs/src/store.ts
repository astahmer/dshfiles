import { randomUUID } from 'node:crypto'
import { chmodSync, closeSync, constants, lstatSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { ApiCaller, ApiHostInput, ApiHostOutput } from '@dshfiles/dshx/api'
import { z } from 'zod'
import type { resourcePacksApi } from './api.js'
import {
  attachmentSchema,
  resourceEventSchema,
  resourceRefSchema,
  resourceSchema,
  storedPackSchema,
  trackingPack,
  type ResourceEvent,
  type ResourceRecord,
  type StoredPack,
} from './model.js'
import { ResourceValidation } from './validation.js'

type Input<Method extends keyof typeof resourcePacksApi.methods> = ApiHostInput<(typeof resourcePacksApi.methods)[Method]>
type ResourceCatalog = ApiHostOutput<typeof resourcePacksApi.methods.catalog>
const jsonRow = z.object({ json: z.string() })
const resourceRow = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  kind: z.string(),
  native_id: z.string(),
  label: z.string(),
  revision: z.number().int().positive(),
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
})
const attachmentRow = z.object({ pack_id: z.string(), values_json: z.string(), attached: z.union([z.literal(0), z.literal(1)]) })

/** Owns only the registry database, never a native resource or its contents. */
export class ResourceStore {
  private readonly db: DatabaseSync
  private closed = false

  constructor(path = dshHomePath('plugins', 'resource-packs', 'resources.db')) {
    const directory = dirname(path)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) {
      ResourceValidation.refuse('unsafe-storage', 'The resource metadata directory must be a private directory, not a symbolic link.')
    }
    chmodSync(directory, 0o700)
    const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600)
    closeSync(fd)
    chmodSync(path, 0o600)
    this.db = new DatabaseSync(path)
    try {
      this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = DELETE;')
      this.migrate()
      this.registerPack({ definition: trackingPack }, { kind: 'plugin', packageId: '@dshfiles/resource-packs' })
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  close(): void {
    if (this.closed) return
    this.db.close()
    this.closed = true
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private migrate(): void {
    this.transaction(() => {
      const { user_version: version } = z.object({ user_version: z.number().int().nonnegative() }).parse(this.db.prepare('PRAGMA user_version').get())
      if (version > 1) ResourceValidation.refuse('unsupported-storage-version', 'This database was written by a newer resource-packs version.')
      if (version === 1) return
      this.db.exec(`
        CREATE TABLE packs (id TEXT PRIMARY KEY, json TEXT NOT NULL);
        CREATE TABLE resources (
          id TEXT PRIMARY KEY, provider TEXT NOT NULL, kind TEXT NOT NULL, native_id TEXT NOT NULL,
          label TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision > 0), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          UNIQUE (provider, kind, native_id)
        );
        CREATE TABLE attachments (
          resource_id TEXT NOT NULL REFERENCES resources(id), pack_id TEXT NOT NULL REFERENCES packs(id),
          values_json TEXT NOT NULL, attached INTEGER NOT NULL CHECK (attached IN (0, 1)), PRIMARY KEY (resource_id, pack_id)
        );
        CREATE TABLE events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, resource_id TEXT NOT NULL REFERENCES resources(id), revision INTEGER NOT NULL,
          json TEXT NOT NULL, UNIQUE (resource_id, revision)
        );
        CREATE INDEX resource_events ON events(resource_id, sequence DESC);
        CREATE INDEX attached_packs ON attachments(pack_id, attached, resource_id);
        PRAGMA user_version = 1;
      `)
    })
  }

  // oxlint-disable-next-line antislop/no-unknown-parameters -- SQLite rows enter here and are parsed immediately with the persisted-row and pack schemas.
  private readPack(row: unknown): StoredPack {
    const pack = storedPackSchema.parse(JSON.parse(jsonRow.parse(row).json))
    ResourceValidation.parseDefinition(pack.definition)
    return pack
  }

  private pack(id: string): StoredPack {
    const row = this.db.prepare('SELECT json FROM packs WHERE id = ?').get(id)
    if (row === undefined) return ResourceValidation.refuse('unknown-pack', 'This pack is not registered.')
    return this.readPack(row)
  }

  catalog(): ResourceCatalog {
    return {
      packs: this.db
        .prepare('SELECT json FROM packs ORDER BY id')
        .all()
        .map(row => this.readPack(row)),
    }
  }

  registerPack(input: Input<'registerPack'>, caller: ApiCaller): StoredPack {
    const definition = ResourceValidation.parseDefinition(input.definition)
    const owner = ResourceValidation.ownerOf(caller)
    return this.transaction(() => {
      const row = this.db.prepare('SELECT json FROM packs WHERE id = ?').get(definition.id)
      const previous = row === undefined ? undefined : this.readPack(row)
      if (previous !== undefined) {
        if (previous.owner !== owner) ResourceValidation.refuse('owner-conflict', 'This pack ID belongs to another owner. Choose a different namespace.')
        if (JSON.stringify(previous.definition) === JSON.stringify(definition)) return previous
        ResourceValidation.assertCompatible(previous.definition, definition)
      }
      const now = Date.now()
      const pack = storedPackSchema.parse({ definition, owner, createdAt: previous?.createdAt ?? now, updatedAt: now })
      this.db.prepare('INSERT INTO packs(id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(definition.id, JSON.stringify(pack))
      // Added null fields must not inflate an existing attached or detached resource beyond its budget.
      if (previous !== undefined && previous.definition.properties.length !== definition.properties.length) {
        for (const row of this.db.prepare('SELECT resource_id AS id FROM attachments WHERE pack_id = ?').all(definition.id)) {
          this.resource(z.object({ id: z.string().uuid() }).parse(row).id)
        }
      }
      return pack
    })
  }

  private resource(id: string): ResourceRecord {
    const row = this.db.prepare('SELECT * FROM resources WHERE id = ?').get(id)
    if (row === undefined) return ResourceValidation.refuse('unknown-resource', 'This resource is not registered.')
    const data = resourceRow.parse(row)
    const attachments = this.db
      .prepare('SELECT pack_id, values_json, attached FROM attachments WHERE resource_id = ? ORDER BY pack_id')
      .all(id)
      .map(row => {
        const attachment = attachmentRow.parse(row)
        const pack = this.pack(attachment.pack_id)
        const values = ResourceValidation.parseValues(pack.definition, JSON.parse(attachment.values_json))
        return attachmentSchema.parse({
          packId: attachment.pack_id,
          attached: attachment.attached === 1,
          values: ResourceValidation.fillMissing(pack.definition, values),
        })
      })
    const resource = resourceSchema.parse({
      id: data.id,
      ref: { provider: data.provider, kind: data.kind, id: data.native_id },
      label: data.label,
      revision: data.revision,
      attachments,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    })
    ResourceValidation.assertPayloadSize(resource, 256 * 1024, 'The resource metadata')
    return resource
  }

  get(input: Input<'get'>): { resource: ResourceRecord; events: ResourceEvent[] } {
    return this.transaction(() => ({
      resource: this.resource(input.resourceId),
      events: this.db
        .prepare('SELECT json FROM events WHERE resource_id = ? ORDER BY sequence DESC LIMIT 100')
        .all(input.resourceId)
        .map(row => resourceEventSchema.parse(JSON.parse(jsonRow.parse(row).json))),
    }))
  }

  list(input: Input<'list'>): { resources: ResourceRecord[]; total: number } {
    // instr treats wildcard punctuation literally; every caller value remains a bound SQL parameter.
    const where = `WHERE (? IS NULL OR instr(lower(r.label), lower(?)) > 0 OR instr(lower(r.native_id), lower(?)) > 0)
      AND (? IS NULL OR r.kind = ?)
      AND (? IS NULL OR EXISTS (SELECT 1 FROM attachments a WHERE a.resource_id = r.id AND a.pack_id = ? AND a.attached = 1))`
    const parameters = [
      input.query ?? null,
      input.query ?? null,
      input.query ?? null,
      input.kind ?? null,
      input.kind ?? null,
      input.packId ?? null,
      input.packId ?? null,
    ]
    return this.transaction(() => {
      const { total } = z
        .object({ total: z.number().int().nonnegative() })
        .parse(this.db.prepare(`SELECT count(*) AS total FROM resources r ${where}`).get(...parameters))
      const ids = this.db.prepare(`SELECT r.id FROM resources r ${where} ORDER BY r.updated_at DESC, r.id LIMIT ?`).all(...parameters, input.limit ?? 200)
      return { total, resources: ids.map(row => this.resource(z.object({ id: z.string().uuid() }).parse(row).id)) }
    })
  }

  private event(resource: ResourceRecord, caller: ApiCaller, action: ResourceEvent['action'], packId: string | null): void {
    const event = resourceEventSchema.parse({
      id: randomUUID(),
      resourceId: resource.id,
      revision: resource.revision,
      actor: ResourceValidation.ownerOf(caller),
      action,
      packId,
      at: resource.updatedAt,
    })
    this.db.prepare('INSERT INTO events(resource_id, revision, json) VALUES (?, ?, ?)').run(resource.id, resource.revision, JSON.stringify(event))
  }

  registerResource(input: Input<'registerResource'>, caller: ApiCaller): ResourceRecord {
    const ref = resourceRefSchema.parse(input.ref)
    const label = resourceSchema.shape.label.parse(input.label)
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT id FROM resources WHERE provider = ? AND kind = ? AND native_id = ?').get(ref.provider, ref.kind, ref.id)
      if (existing !== undefined) return this.resource(z.object({ id: z.string().uuid() }).parse(existing).id)
      const now = Date.now()
      const resource = resourceSchema.parse({ id: randomUUID(), ref, label, revision: 1, attachments: [], createdAt: now, updatedAt: now })
      this.db
        .prepare('INSERT INTO resources(id, provider, kind, native_id, label, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(resource.id, ref.provider, ref.kind, ref.id, label, 1, now, now)
      this.event(resource, caller, 'created', null)
      return resource
    })
  }

  private change(
    input: Input<'attach'>,
    caller: ApiCaller,
    action: ResourceEvent['action'],
    update: (resource: ResourceRecord, pack: StoredPack) => boolean,
  ): ResourceRecord {
    return this.transaction(() => {
      const resource = this.resource(input.resourceId)
      if (resource.revision !== input.expectedRevision)
        ResourceValidation.refuse('stale-revision', 'This resource changed. Reload it before editing its metadata.')
      const pack = this.pack(input.packId)
      if (!update(resource, pack)) return resource
      const now = Date.now()
      const result = this.db
        .prepare('UPDATE resources SET revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?')
        .run(now, resource.id, input.expectedRevision)
      if (result.changes !== 1) ResourceValidation.refuse('stale-revision', 'This resource changed. Reload it before editing its metadata.')
      const updated = this.resource(resource.id)
      this.event(updated, caller, action, pack.definition.id)
      return updated
    })
  }

  attach(input: Input<'attach'>, caller: ApiCaller): ResourceRecord {
    return this.change(input, caller, 'attached', (resource, pack) => {
      const attachment = resource.attachments.find(item => item.packId === input.packId)
      if (attachment?.attached) return false
      if (attachment === undefined && resource.attachments.length >= 40)
        ResourceValidation.refuse('attachment-limit', 'A resource may retain at most 40 packs, including detached packs.')
      const values = ResourceValidation.fillMissing(pack.definition, attachment?.values ?? {})
      this.db
        .prepare(
          'INSERT INTO attachments(resource_id, pack_id, values_json, attached) VALUES (?, ?, ?, 1) ON CONFLICT(resource_id, pack_id) DO UPDATE SET attached = 1',
        )
        .run(resource.id, input.packId, JSON.stringify(values))
      return true
    })
  }

  setValues(input: Input<'setValues'>, caller: ApiCaller): ResourceRecord {
    return this.change(input, caller, 'values-updated', (resource, pack) => {
      const attachment = resource.attachments.find(item => item.packId === input.packId)
      if (attachment?.attached !== true) ResourceValidation.refuse('pack-not-attached', 'Attach this pack before setting its properties.')
      const values = ResourceValidation.parseValues(pack.definition, input.values, caller, pack.owner)
      this.db
        .prepare('UPDATE attachments SET values_json = ? WHERE resource_id = ? AND pack_id = ?')
        .run(JSON.stringify({ ...attachment.values, ...values }), resource.id, input.packId)
      return true
    })
  }

  detach(input: Input<'detach'>, caller: ApiCaller): ResourceRecord {
    if (input.confirm !== true) return ResourceValidation.refuse('confirmation-required', 'Confirm detachment explicitly. Stored values will be retained.')
    return this.change(input, caller, 'detached', resource => {
      const attachment = resource.attachments.find(item => item.packId === input.packId)
      if (attachment?.attached !== true) return false
      this.db.prepare('UPDATE attachments SET attached = 0 WHERE resource_id = ? AND pack_id = ?').run(resource.id, input.packId)
      return true
    })
  }
}
