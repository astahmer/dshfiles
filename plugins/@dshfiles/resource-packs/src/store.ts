import { randomUUID } from 'node:crypto'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { ApiCaller, ApiHostInput, ApiHostOutput } from '@dshfiles/dshx/api'
import { SqliteStore } from '@dshfiles/sqlite-store'
import { type Cause, Clock, Context, Effect, FileSystem, Layer, Option, Path, Schema } from 'effect'
import { Reactivity } from 'effect/reactivity'
import { type SqlError, SqlSchema } from 'effect/sql'
import type { SqlClient } from 'effect/sql'
import type { resourcePacksApi } from './api.js'
import {
  AttachmentLimitReached,
  PackNotAttached,
  PackNotFound,
  PackOwnerConflict,
  type ResourceDomainError,
  ResourceNotFound,
  ResourceStoreFailed,
  StaleResourceRevision,
  UnsafeResourceStorage,
} from './errors.js'
import { resourcePacksMigrations } from './migrations.js'
import {
  attachmentSchema,
  resourceEventSchema,
  resourceLabelSchema,
  resourceRefSchema,
  storedPackSchema,
  trackingPack,
  type ResourceAttachment,
  type ResourceEvent,
  type ResourceRecord,
  type StoredPack,
} from './model.js'
import { ResourceValidation } from './validation.js'

type Input<Method extends keyof typeof resourcePacksApi.methods> = ApiHostInput<(typeof resourcePacksApi.methods)[Method]>
/** One decoded pack per id for the length of a single read, so a page of resources does not re-decode a shared pack per attachment. */
type PackCache = Map<string, StoredPack>
type ResourceCatalog = ApiHostOutput<typeof resourcePacksApi.methods.catalog>
type Request<Method extends keyof typeof resourcePacksApi.methods> = { readonly input: Input<Method>; readonly caller: ApiCaller }
export type ResourceStoreError = ResourceDomainError | ResourceStoreFailed
type StepError = ResourceDomainError | SqlError.SqlError | Schema.SchemaError | Cause.NoSuchElementError

const memoryFilename = ':memory:'
const attachmentLimit = 40
const eventLimit = 100
const providerPackage = '@dshfiles/resource-packs'

const uuid = Schema.String.check(Schema.isUUID())
const positiveInt = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))
const countInt = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const strictJson = { onExcessProperty: 'error' } as const

const JsonRow = Schema.Struct({ json: Schema.String })
const IdRow = Schema.Struct({ id: uuid })
const TotalRow = Schema.Struct({ total: countInt })
const ResourceRow = Schema.Struct({
  id: uuid,
  provider: resourceRefSchema.fields.provider,
  kind: resourceRefSchema.fields.kind,
  native_id: resourceRefSchema.fields.id,
  label: resourceLabelSchema,
  revision: positiveInt,
  created_at: countInt,
  updated_at: countInt,
})
const AttachmentRow = Schema.Struct({ pack_id: attachmentSchema.fields.packId, values_json: Schema.String, attached: Schema.Literals([0, 1]) })
const PackWrite = Schema.Struct({ id: Schema.String, json: Schema.String })
const ResourceInsert = Schema.Struct({ id: uuid, provider: Schema.String, kind: Schema.String, nativeId: Schema.String, label: Schema.String, now: countInt })
const ListFilter = Schema.Struct({ query: Schema.NullOr(Schema.String), kind: Schema.NullOr(Schema.String), packId: Schema.NullOr(Schema.String) })
const ListPage = Schema.Struct({ ...ListFilter.fields, limit: positiveInt })
const RevisionBump = Schema.Struct({ id: uuid, expectedRevision: positiveInt, now: countInt })
const EventInsert = Schema.Struct({ resourceId: uuid, revision: positiveInt, json: Schema.String })
const AttachmentKey = Schema.Struct({ resourceId: uuid, packId: Schema.String })
const AttachmentValues = Schema.Struct({ ...AttachmentKey.fields, valuesJson: Schema.String })

const decodeStoredPack = Schema.decodeEffect(Schema.fromJsonString(storedPackSchema), strictJson)
const decodeEvent = Schema.decodeEffect(Schema.fromJsonString(resourceEventSchema), strictJson)
const encodeStoredPack = Schema.encodeEffect(Schema.fromJsonString(storedPackSchema))
const encodeEvent = Schema.encodeEffect(Schema.fromJsonString(resourceEventSchema))

/** Where the registry lives: `$DSH_HOME/plugins/resource-packs/resources.db`, resolved when the plugin activates. */
export class ResourceStoreFile extends Context.Service<ResourceStoreFile, { readonly filename: string }>()('@dshfiles/resource-packs/ResourceStoreFile') {
  static readonly layer = (filename: string) => Layer.succeed(ResourceStoreFile, ResourceStoreFile.of({ filename }))
  static readonly fromDshHome = Layer.effect(
    ResourceStoreFile,
    Effect.sync(() => ResourceStoreFile.of({ filename: dshHomePath('plugins', 'resource-packs', 'resources.db') })),
  )
}

class ResourceDb extends Context.Service<ResourceDb, SqlClient.SqlClient>()('@dshfiles/resource-packs/ResourceDb') {}

const refuseSymbolicLink = Effect.fnUntraced(function* (fs: FileSystem.FileSystem, target: string) {
  if (Option.isSome(yield* Effect.option(fs.readLink(target)))) return yield* new UnsafeResourceStorage({ reason: 'symbolic-link' })
})

/** The private-path checks sqlite-store does not do: a symlinked directory or file is refused, never followed. */
const preparePrivateFiles = Effect.fn('resource-packs store prepare')(function* (filename: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = path.dirname(filename)
  yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 })
  yield* refuseSymbolicLink(fs, directory)
  if ((yield* fs.stat(directory)).type !== 'Directory') return yield* new UnsafeResourceStorage({ reason: 'not-directory' })
  yield* fs.chmod(directory, 0o700)
  if (!(yield* fs.exists(filename))) return
  yield* refuseSymbolicLink(fs, filename)
  if ((yield* fs.stat(filename)).type !== 'File') return yield* new UnsafeResourceStorage({ reason: 'not-file' })
})

const resourceDbLayer = Layer.effect(
  ResourceDb,
  Effect.gen(function* () {
    const file = yield* ResourceStoreFile
    if (file.filename !== memoryFilename)
      yield* preparePrivateFiles(file.filename).pipe(
        Effect.catchTag('PlatformError', cause => Effect.fail(new ResourceStoreFailed({ operation: 'open', cause }))),
      )
    return yield* SqliteStore.make({
      filename: file.filename,
      migrations: resourcePacksMigrations,
      legacyUserVersion: 1,
      pragmas: { journalMode: 'delete', foreignKeys: true },
    })
  }),
).pipe(Layer.provide(Reactivity.layer))

const failStore = (operation: ResourceStoreFailed['operation']) => (cause: SqlError.SqlError | Schema.SchemaError | Cause.NoSuchElementError) =>
  Effect.fail(new ResourceStoreFailed({ operation, cause }))

const storeFailure =
  (operation: ResourceStoreFailed['operation']) =>
  <A, R>(effect: Effect.Effect<A, StepError, R>): Effect.Effect<A, ResourceStoreError, R> =>
    effect.pipe(Effect.catchTags({ SqlError: failStore(operation), SchemaError: failStore(operation), NoSuchElementError: failStore(operation) }))

const attachmentOf = (resource: ResourceRecord, packId: string) => resource.attachments.find(item => item.packId === packId)

/** Owns only the registry database, never a native resource or its contents. */
export class ResourceStore extends Context.Service<
  ResourceStore,
  {
    readonly catalog: () => Effect.Effect<ResourceCatalog, ResourceStoreError>
    readonly list: (input: Input<'list'>) => Effect.Effect<{ resources: Array<ResourceRecord>; total: number }, ResourceStoreError>
    readonly get: (input: Input<'get'>) => Effect.Effect<{ resource: ResourceRecord; events: Array<ResourceEvent> }, ResourceStoreError>
    readonly registerPack: (request: Request<'registerPack'>) => Effect.Effect<StoredPack, ResourceStoreError>
    readonly registerResource: (request: Request<'registerResource'>) => Effect.Effect<ResourceRecord, ResourceStoreError>
    readonly attach: (request: Request<'attach'>) => Effect.Effect<ResourceRecord, ResourceStoreError>
    readonly setValues: (request: Request<'setValues'>) => Effect.Effect<ResourceRecord, ResourceStoreError>
    readonly detach: (request: Request<'detach'>) => Effect.Effect<ResourceRecord, ResourceStoreError>
  }
>()('@dshfiles/resource-packs/ResourceStore') {
  static readonly layer = Layer.effect(
    ResourceStore,
    Effect.gen(function* () {
      const sql = yield* ResourceDb

      const findPackJson = SqlSchema.findOneOption({ Request: Schema.String, Result: JsonRow, execute: id => sql`SELECT json FROM packs WHERE id = ${id}` })
      const allPackJson = SqlSchema.findAll({ Request: Schema.Void, Result: JsonRow, execute: () => sql`SELECT json FROM packs ORDER BY id` })
      const savePack = SqlSchema.void({
        Request: PackWrite,
        execute: row => sql`INSERT INTO packs(id, json) VALUES (${row.id}, ${row.json}) ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
      })
      const attachedResourceIds = SqlSchema.findAll({
        Request: Schema.String,
        Result: IdRow,
        execute: packId => sql`SELECT resource_id AS id FROM attachments WHERE pack_id = ${packId}`,
      })
      const findResourceRow = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: ResourceRow,
        execute: id => sql`SELECT * FROM resources WHERE id = ${id}`,
      })
      const attachmentRows = SqlSchema.findAll({
        Request: Schema.String,
        Result: AttachmentRow,
        execute: id => sql`SELECT pack_id, values_json, attached FROM attachments WHERE resource_id = ${id} ORDER BY pack_id`,
      })
      const recentEventJson = SqlSchema.findAll({
        Request: Schema.String,
        Result: JsonRow,
        execute: id => sql`SELECT json FROM events WHERE resource_id = ${id} ORDER BY sequence DESC LIMIT ${eventLimit}`,
      })
      // instr treats wildcard punctuation literally; every caller value remains a bound SQL parameter.
      const listWhere = (filter: typeof ListFilter.Encoded) =>
        sql`WHERE (${filter.query} IS NULL OR instr(lower(r.label), lower(${filter.query})) > 0 OR instr(lower(r.native_id), lower(${filter.query})) > 0)
          AND (${filter.kind} IS NULL OR r.kind = ${filter.kind})
          AND (${filter.packId} IS NULL OR EXISTS (SELECT 1 FROM attachments a WHERE a.resource_id = r.id AND a.pack_id = ${filter.packId} AND a.attached = 1))`
      const countResources = SqlSchema.findOne({
        Request: ListFilter,
        Result: TotalRow,
        execute: filter => sql`SELECT count(*) AS total FROM resources r ${listWhere(filter)}`,
      })
      const pageResourceIds = SqlSchema.findAll({
        Request: ListPage,
        Result: IdRow,
        execute: page => sql`SELECT r.id FROM resources r ${listWhere(page)} ORDER BY r.updated_at DESC, r.id LIMIT ${page.limit}`,
      })
      const findResourceIdByRef = SqlSchema.findOneOption({
        Request: resourceRefSchema,
        Result: IdRow,
        execute: ref => sql`SELECT id FROM resources WHERE provider = ${ref.provider} AND kind = ${ref.kind} AND native_id = ${ref.id}`,
      })
      const insertResource = SqlSchema.void({
        Request: ResourceInsert,
        execute: row =>
          sql`INSERT INTO resources(id, provider, kind, native_id, label, revision, created_at, updated_at) VALUES (${row.id}, ${row.provider}, ${row.kind}, ${row.nativeId}, ${row.label}, 1, ${row.now}, ${row.now})`,
      })
      const bumpRevision = SqlSchema.findAll({
        Request: RevisionBump,
        Result: IdRow,
        execute: bump =>
          sql`UPDATE resources SET revision = revision + 1, updated_at = ${bump.now} WHERE id = ${bump.id} AND revision = ${bump.expectedRevision} RETURNING id`,
      })
      const insertEvent = SqlSchema.void({
        Request: EventInsert,
        execute: row => sql`INSERT INTO events(resource_id, revision, json) VALUES (${row.resourceId}, ${row.revision}, ${row.json})`,
      })
      const upsertAttachment = SqlSchema.void({
        Request: AttachmentValues,
        execute: row =>
          sql`INSERT INTO attachments(resource_id, pack_id, values_json, attached) VALUES (${row.resourceId}, ${row.packId}, ${row.valuesJson}, 1) ON CONFLICT(resource_id, pack_id) DO UPDATE SET attached = 1`,
      })
      const updateAttachmentValues = SqlSchema.void({
        Request: AttachmentValues,
        execute: row => sql`UPDATE attachments SET values_json = ${row.valuesJson} WHERE resource_id = ${row.resourceId} AND pack_id = ${row.packId}`,
      })
      const markDetached = SqlSchema.void({
        Request: AttachmentKey,
        execute: key => sql`UPDATE attachments SET attached = 0 WHERE resource_id = ${key.resourceId} AND pack_id = ${key.packId}`,
      })

      const readPack = Effect.fnUntraced(function* (json: string) {
        const pack = yield* decodeStoredPack(json)
        yield* ResourceValidation.checkDefinition(pack.definition)
        return pack
      })

      const packOf = Effect.fnUntraced(function* (request: { readonly id: string; readonly cache: PackCache | null }) {
        const cached = request.cache?.get(request.id)
        if (cached !== undefined) return cached
        const row = yield* findPackJson(request.id)
        if (Option.isNone(row)) return yield* new PackNotFound()
        const pack = yield* readPack(row.value.json)
        request.cache?.set(request.id, pack)
        return pack
      })

      const attachmentRecord = Effect.fnUntraced(function* (attachment: typeof AttachmentRow.Type, cache: PackCache | null) {
        const pack = yield* packOf({ id: attachment.pack_id, cache })
        const values = yield* ResourceValidation.readPersistedValues({ definition: pack.definition, json: attachment.values_json })
        const record: ResourceAttachment = {
          packId: attachment.pack_id,
          attached: attachment.attached === 1,
          values: ResourceValidation.fillMissing(pack.definition, values),
        }
        return record
      })

      const resourceOf = Effect.fnUntraced(function* (request: { readonly id: string; readonly cache: PackCache | null }) {
        const found = yield* findResourceRow(request.id)
        if (Option.isNone(found)) return yield* new ResourceNotFound()
        const row = found.value
        const resource: ResourceRecord = {
          id: row.id,
          ref: { provider: row.provider, kind: row.kind, id: row.native_id },
          label: row.label,
          revision: row.revision,
          attachments: yield* Effect.forEach(yield* attachmentRows(request.id), attachment => attachmentRecord(attachment, request.cache)),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
        yield* ResourceValidation.assertPayloadSize({ value: resource, subject: 'resource' })
        return resource
      })

      const recordEvent = Effect.fnUntraced(function* (input: {
        readonly resource: ResourceRecord
        readonly caller: ApiCaller
        readonly action: ResourceEvent['action']
        readonly packId: string | null
      }) {
        const event: ResourceEvent = {
          id: randomUUID(),
          resourceId: input.resource.id,
          revision: input.resource.revision,
          actor: yield* ResourceValidation.ownerOf(input.caller),
          action: input.action,
          packId: input.packId,
          at: input.resource.updatedAt,
        }
        yield* insertEvent({ resourceId: input.resource.id, revision: input.resource.revision, json: yield* encodeEvent(event) })
      })

      const registerPack = Effect.fn('resource-packs register pack')(function* (request: Request<'registerPack'>) {
        const definition = yield* ResourceValidation.checkDefinition(request.input.definition)
        const owner = yield* ResourceValidation.ownerOf(request.caller)
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const row = yield* findPackJson(definition.id)
            const previous = Option.isNone(row) ? undefined : yield* readPack(row.value.json)
            if (previous !== undefined) {
              if (previous.owner !== owner) return yield* new PackOwnerConflict()
              if (JSON.stringify(previous.definition) === JSON.stringify(definition)) return previous
              yield* ResourceValidation.assertCompatible({ previous: previous.definition, next: definition })
            }
            const now = yield* Clock.currentTimeMillis
            const pack: StoredPack = { definition, owner, createdAt: previous?.createdAt ?? now, updatedAt: now }
            yield* savePack({ id: definition.id, json: yield* encodeStoredPack(pack) })
            // Added null fields must not inflate an existing attached or detached resource beyond its budget.
            if (previous !== undefined && previous.definition.properties.length !== definition.properties.length) {
              yield* Effect.forEach(yield* attachedResourceIds(definition.id), attached => resourceOf({ id: attached.id, cache: null }), { discard: true })
            }
            return pack
          }),
        )
      }, storeFailure('register-pack'))

      const changeResource = Effect.fnUntraced(function* (change: {
        readonly input: Input<'attach'>
        readonly caller: ApiCaller
        readonly action: ResourceEvent['action']
        readonly update: (resource: ResourceRecord, pack: StoredPack) => Effect.Effect<boolean, StepError>
      }) {
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const resource = yield* resourceOf({ id: change.input.resourceId, cache: null })
            if (resource.revision !== change.input.expectedRevision) return yield* new StaleResourceRevision()
            const pack = yield* packOf({ id: change.input.packId, cache: null })
            if (!(yield* change.update(resource, pack))) return resource
            const now = yield* Clock.currentTimeMillis
            const bumped = yield* bumpRevision({ id: resource.id, expectedRevision: change.input.expectedRevision, now })
            if (bumped.length !== 1) return yield* new StaleResourceRevision()
            const updated = yield* resourceOf({ id: resource.id, cache: null })
            yield* recordEvent({ resource: updated, caller: change.caller, action: change.action, packId: pack.definition.id })
            return updated
          }),
        )
      })

      yield* registerPack({ input: { definition: trackingPack }, caller: { kind: 'plugin', packageId: providerPackage } }).pipe(
        Effect.mapError(cause => new ResourceStoreFailed({ operation: 'open', cause })),
      )

      return ResourceStore.of({
        catalog: Effect.fn('resource-packs catalog')(function* () {
          const rows = yield* allPackJson(undefined)
          return { packs: yield* Effect.forEach(rows, row => readPack(row.json)) }
        }, storeFailure('catalog')),
        list: Effect.fn('resource-packs list')(function* (input: Input<'list'>) {
          const filter = { query: input.query ?? null, kind: input.kind ?? null, packId: input.packId ?? null }
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const cache: PackCache = new Map()
              const counted = yield* countResources(filter)
              const ids = yield* pageResourceIds({ ...filter, limit: input.limit ?? 200 })
              return { total: counted.total, resources: yield* Effect.forEach(ids, row => resourceOf({ id: row.id, cache })) }
            }),
          )
        }, storeFailure('list')),
        get: Effect.fn('resource-packs get')(function* (input: Input<'get'>) {
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const resource = yield* resourceOf({ id: input.resourceId, cache: new Map() })
              const events = yield* Effect.forEach(yield* recentEventJson(input.resourceId), row => decodeEvent(row.json))
              return { resource, events }
            }),
          )
        }, storeFailure('get')),
        registerPack,
        registerResource: Effect.fn('resource-packs register resource')(function* (request: Request<'registerResource'>) {
          const ref = request.input.ref
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const existing = yield* findResourceIdByRef(ref)
              if (Option.isSome(existing)) return yield* resourceOf({ id: existing.value.id, cache: new Map() })
              const now = yield* Clock.currentTimeMillis
              const resource: ResourceRecord = {
                id: randomUUID(),
                ref,
                label: request.input.label,
                revision: 1,
                attachments: [],
                createdAt: now,
                updatedAt: now,
              }
              yield* insertResource({ id: resource.id, provider: ref.provider, kind: ref.kind, nativeId: ref.id, label: resource.label, now })
              yield* recordEvent({ resource, caller: request.caller, action: 'created', packId: null })
              return resource
            }),
          )
        }, storeFailure('register-resource')),
        attach: Effect.fn('resource-packs attach')(function* (request: Request<'attach'>) {
          const packId = request.input.packId
          return yield* changeResource({
            input: request.input,
            caller: request.caller,
            action: 'attached',
            update: (resource, pack) =>
              Effect.gen(function* () {
                const attachment = attachmentOf(resource, packId)
                if (attachment?.attached === true) return false
                if (attachment === undefined && resource.attachments.length >= attachmentLimit)
                  return yield* new AttachmentLimitReached({ limit: attachmentLimit })
                const values = ResourceValidation.fillMissing(pack.definition, attachment?.values ?? {})
                yield* upsertAttachment({ resourceId: resource.id, packId, valuesJson: JSON.stringify(values) })
                return true
              }),
          })
        }, storeFailure('attach')),
        setValues: Effect.fn('resource-packs set values')(function* (request: Request<'setValues'>) {
          const input = request.input
          return yield* changeResource({
            input,
            caller: request.caller,
            action: 'values-updated',
            update: (resource, pack) =>
              Effect.gen(function* () {
                const attachment = attachmentOf(resource, input.packId)
                if (attachment?.attached !== true) return yield* new PackNotAttached()
                const values = yield* ResourceValidation.checkValues({
                  definition: pack.definition,
                  values: input.values,
                  writer: { caller: request.caller, owner: pack.owner },
                })
                yield* updateAttachmentValues({
                  resourceId: resource.id,
                  packId: input.packId,
                  valuesJson: JSON.stringify({ ...attachment.values, ...values }),
                })
                return true
              }),
          })
        }, storeFailure('set-values')),
        detach: Effect.fn('resource-packs detach')(function* (request: Request<'detach'>) {
          const packId = request.input.packId
          return yield* changeResource({
            input: request.input,
            caller: request.caller,
            action: 'detached',
            update: resource =>
              Effect.gen(function* () {
                if (attachmentOf(resource, packId)?.attached !== true) return false
                yield* markDetached({ resourceId: resource.id, packId })
                return true
              }),
          })
        }, storeFailure('detach')),
      })
    }),
  ).pipe(Layer.provide(resourceDbLayer))
}
