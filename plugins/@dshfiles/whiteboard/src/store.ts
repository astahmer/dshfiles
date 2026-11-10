import { randomUUID } from 'node:crypto'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { ApiHostInput } from '@dshfiles/dshx/api'
import { SqliteStore } from '@dshfiles/sqlite-store'
import { type Cause, Clock, Context, Effect, FileSystem, Layer, Option, Path, Schema } from 'effect'
import { Reactivity } from 'effect/reactivity'
import { type SqlError, SqlSchema } from 'effect/sql'
import type { SqlClient } from 'effect/sql'
import type { whiteboardApi } from './api.js'
import { BoardDeleted, type BoardDomainError, BoardNotFound, BoardStoreFailed, InvalidBoardWrite, StaleBoardRevision, UnsafeBoardStorage } from './errors.js'
import { whiteboardMigrations } from './migrations.js'
import {
  type Board,
  type BoardSummary,
  emptyScene,
  liveElementCount,
  type PendingSource,
  pendingSourceSchema,
  type Scene,
  sceneByteLimit,
  sceneSchema,
  sceneTexts,
} from './model.js'

type Input<Method extends keyof typeof whiteboardApi.methods> = ApiHostInput<(typeof whiteboardApi.methods)[Method]>
export type BoardStoreError = BoardDomainError | BoardStoreFailed
type StepError = BoardDomainError | SqlError.SqlError | Schema.SchemaError | Cause.NoSuchElementError

const memoryFilename = ':memory:'
const strictJson = { onExcessProperty: 'error' } as const
const countInt = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const BoardRow = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  title: Schema.String,
  revision: countInt,
  pending_json: Schema.NullOr(Schema.String),
  element_count: countInt,
  created_at: countInt,
  updated_at: countInt,
  deleted_at: Schema.NullOr(countInt),
})
const BoardSceneRow = Schema.Struct({ ...BoardRow.fields, scene_json: Schema.String })
const ListFilter = Schema.Struct({ project: Schema.NullOr(Schema.String), includeDeleted: Schema.Literals([0, 1]) })
const BoardInsert = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  title: Schema.String,
  sceneJson: Schema.String,
  pendingJson: Schema.NullOr(Schema.String),
  elementCount: countInt,
  now: countInt,
})
const BoardUpdate = Schema.Struct({
  id: Schema.String,
  expectedRevision: countInt,
  title: Schema.String,
  sceneJson: Schema.String,
  pendingJson: Schema.NullOr(Schema.String),
  elementCount: countInt,
  deletedAt: Schema.NullOr(countInt),
  now: countInt,
})
const IdRow = Schema.Struct({ id: Schema.String })

const decodeScene = Schema.decodeEffect(Schema.fromJsonString(sceneSchema), strictJson)
const encodeScene = Schema.encodeEffect(Schema.fromJsonString(sceneSchema))
const decodePending = Schema.decodeEffect(Schema.fromJsonString(pendingSourceSchema), strictJson)
const encodePending = Schema.encodeEffect(Schema.fromJsonString(pendingSourceSchema))

/** Where boards live: `$DSH_HOME/plugins/whiteboard/boards.db`, resolved when the plugin activates. */
export class BoardStoreFile extends Context.Service<BoardStoreFile, { readonly filename: string }>()('@dshfiles/whiteboard/BoardStoreFile') {
  static readonly layer = (filename: string) => Layer.succeed(BoardStoreFile, BoardStoreFile.of({ filename }))
  static readonly fromDshHome = Layer.effect(
    BoardStoreFile,
    Effect.sync(() => BoardStoreFile.of({ filename: dshHomePath('plugins', 'whiteboard', 'boards.db') })),
  )
}

class BoardDb extends Context.Service<BoardDb, SqlClient.SqlClient>()('@dshfiles/whiteboard/BoardDb') {}

const refuseSymbolicLink = Effect.fnUntraced(function* (fs: FileSystem.FileSystem, target: string) {
  if (Option.isSome(yield* Effect.option(fs.readLink(target)))) return yield* new UnsafeBoardStorage({ reason: 'symbolic-link' })
})

/** A symlinked directory or database file is refused, never followed: sqlite-store creates files, it does not vet them. */
const preparePrivateFiles = Effect.fn('whiteboard store prepare')(function* (filename: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = path.dirname(filename)
  yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 })
  yield* refuseSymbolicLink(fs, directory)
  if ((yield* fs.stat(directory)).type !== 'Directory') return yield* new UnsafeBoardStorage({ reason: 'not-directory' })
  yield* fs.chmod(directory, 0o700)
  if (!(yield* fs.exists(filename))) return
  yield* refuseSymbolicLink(fs, filename)
  if ((yield* fs.stat(filename)).type !== 'File') return yield* new UnsafeBoardStorage({ reason: 'not-file' })
})

const boardDbLayer = Layer.effect(
  BoardDb,
  Effect.gen(function* () {
    const file = yield* BoardStoreFile
    if (file.filename !== memoryFilename)
      yield* preparePrivateFiles(file.filename).pipe(Effect.catchTag('PlatformError', cause => Effect.fail(new BoardStoreFailed({ operation: 'open', cause }))))
    return yield* SqliteStore.make({ filename: file.filename, migrations: whiteboardMigrations, pragmas: { journalMode: 'wal' } })
  }),
).pipe(Layer.provide(Reactivity.layer))

const failStore = (operation: BoardStoreFailed['operation']) => (cause: SqlError.SqlError | Schema.SchemaError | Cause.NoSuchElementError) =>
  Effect.fail(new BoardStoreFailed({ operation, cause }))

const storeFailure =
  (operation: BoardStoreFailed['operation']) =>
  <A, R>(effect: Effect.Effect<A, StepError, R>): Effect.Effect<A, BoardStoreError, R> =>
    effect.pipe(Effect.catchTags({ SqlError: failStore(operation), SchemaError: failStore(operation), NoSuchElementError: failStore(operation) }))

const summaryOf = (row: typeof BoardRow.Type, pending: PendingSource | null): BoardSummary => ({
  id: row.id,
  project: row.project,
  title: row.title,
  revision: row.revision,
  elementCount: row.element_count,
  pending: pending?.kind ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
})

/** The serialized scene, refused before it reaches the database when it is over the per-board budget. */
const encodeBoundedScene = Effect.fnUntraced(function* (scene: Scene) {
  const json = yield* encodeScene(scene)
  if (Buffer.byteLength(json) > sceneByteLimit) return yield* new InvalidBoardWrite({ reason: 'scene-too-large' })
  return json
})

const encodeOptionalPending = (pending: PendingSource | null) => (pending === null ? Effect.succeed(null) : encodePending(pending))

/** The source a write queues for the editor, or `undefined` when it queues none. */
const pendingOf = (input: Input<'write'>): Effect.Effect<PendingSource | undefined, InvalidBoardWrite> => {
  if (input.mermaid !== undefined && input.skeleton !== undefined) return Effect.fail(new InvalidBoardWrite({ reason: 'two-sources' }))
  if (input.mermaid !== undefined) return Effect.succeed({ kind: 'mermaid', source: input.mermaid })
  if (input.skeleton !== undefined) return Effect.succeed({ kind: 'skeleton', elements: input.skeleton })
  return Effect.succeed(undefined)
}

/** Owns the boards database; a board's scene is opaque Excalidraw JSON the editor restores and validates. */
export class BoardStore extends Context.Service<
  BoardStore,
  {
    readonly list: (input: Input<'list'>) => Effect.Effect<{ boards: BoardSummary[] }, BoardStoreError>
    readonly read: (input: Input<'read'>) => Effect.Effect<Board, BoardStoreError>
    readonly write: (input: Input<'write'>) => Effect.Effect<BoardSummary, BoardStoreError>
    readonly rename: (input: Input<'rename'>) => Effect.Effect<BoardSummary, BoardStoreError>
    readonly remove: (input: Input<'delete'>) => Effect.Effect<BoardSummary, BoardStoreError>
    readonly restore: (input: Input<'restore'>) => Effect.Effect<BoardSummary, BoardStoreError>
  }
>()('@dshfiles/whiteboard/BoardStore') {
  static readonly layer = Layer.effect(
    BoardStore,
    Effect.gen(function* () {
      const sql = yield* BoardDb

      const listRows = SqlSchema.findAll({
        Request: ListFilter,
        Result: BoardRow,
        execute: filter =>
          sql`SELECT id, project, title, revision, pending_json, element_count, created_at, updated_at, deleted_at FROM boards
            WHERE (${filter.project} IS NULL OR project = ${filter.project}) AND (${filter.includeDeleted} = 1 OR deleted_at IS NULL)
            ORDER BY updated_at DESC, id`,
      })
      const findRow = SqlSchema.findOneOption({ Request: Schema.String, Result: BoardSceneRow, execute: id => sql`SELECT * FROM boards WHERE id = ${id}` })
      const insertRow = SqlSchema.void({
        Request: BoardInsert,
        execute: row =>
          sql`INSERT INTO boards(id, project, title, revision, scene_json, pending_json, element_count, created_at, updated_at, deleted_at)
            VALUES (${row.id}, ${row.project}, ${row.title}, 1, ${row.sceneJson}, ${row.pendingJson}, ${row.elementCount}, ${row.now}, ${row.now}, NULL)`,
      })
      const updateRow = SqlSchema.findAll({
        Request: BoardUpdate,
        Result: IdRow,
        execute: row =>
          sql`UPDATE boards SET title = ${row.title}, scene_json = ${row.sceneJson}, pending_json = ${row.pendingJson}, element_count = ${row.elementCount},
            deleted_at = ${row.deletedAt}, revision = revision + 1, updated_at = ${row.now}
            WHERE id = ${row.id} AND revision = ${row.expectedRevision} RETURNING id`,
      })

      const pendingOfRow = (json: string | null) => (json === null ? Effect.succeed(null) : decodePending(json))

      const loadRow = Effect.fnUntraced(function* (id: string) {
        const found = yield* findRow(id)
        if (Option.isNone(found)) return yield* new BoardNotFound()
        const row = found.value
        return { row, pending: yield* pendingOfRow(row.pending_json) }
      })

      const loadBoard = Effect.fnUntraced(function* (id: string) {
        const loaded = yield* loadRow(id)
        return { ...loaded, scene: yield* decodeScene(loaded.row.scene_json) }
      })

      /** Only a write that leaves part of the scene out has to parse the stored one: the autosave sends all three. */
      const sceneFor = Effect.fnUntraced(function* (sceneJson: string, input: Input<'write'>) {
        if (input.elements !== undefined && input.appState !== undefined && input.files !== undefined)
          return { elements: input.elements, appState: input.appState, files: input.files }
        const current = yield* decodeScene(sceneJson)
        return {
          elements: input.elements ?? current.elements,
          appState: input.appState ?? current.appState,
          files: input.files ?? current.files,
        }
      })

      /** One revision-checked replacement of a board row inside the caller's transaction. */
      const replace = Effect.fnUntraced(function* (change: {
        readonly id: string
        readonly expectedRevision: number
        readonly title: string
        readonly scene: Scene
        readonly pending: PendingSource | null
        readonly deletedAt: number | null
      }) {
        const now = yield* Clock.currentTimeMillis
        const updated = yield* updateRow({
          id: change.id,
          expectedRevision: change.expectedRevision,
          title: change.title,
          sceneJson: yield* encodeBoundedScene(change.scene),
          pendingJson: yield* encodeOptionalPending(change.pending),
          elementCount: liveElementCount(change.scene.elements),
          deletedAt: change.deletedAt,
          now,
        })
        if (updated.length !== 1) {
          const current = yield* loadRow(change.id)
          return yield* new StaleBoardRevision({ currentRevision: current.row.revision })
        }
        const reread = yield* loadRow(change.id)
        return summaryOf(reread.row, reread.pending)
      })

      const checked = (loaded: { readonly row: { readonly revision: number } }, expectedRevision: number) =>
        loaded.row.revision === expectedRevision ? Effect.void : Effect.fail(new StaleBoardRevision({ currentRevision: loaded.row.revision }))

      const list = Effect.fn('whiteboard list')(function* (input: Input<'list'>) {
        const rows = yield* listRows({ project: input.project ?? null, includeDeleted: input.includeDeleted === true ? 1 : 0 })
        const boards = yield* Effect.forEach(rows, row => Effect.map(pendingOfRow(row.pending_json), pending => summaryOf(row, pending)))
        return { boards }
      }, storeFailure('list'))

      const read = Effect.fn('whiteboard read')(function* (input: Input<'read'>) {
        const { row, scene, pending } = yield* loadBoard(input.boardId)
        const board: Board = { board: summaryOf(row, pending), scene, pending, texts: sceneTexts(scene.elements) }
        return board
      }, storeFailure('read'))

      const create = Effect.fnUntraced(function* (input: Input<'write'>, pending: PendingSource | undefined) {
        if (input.project === undefined || input.title === undefined) return yield* new InvalidBoardWrite({ reason: 'missing-project' })
        const scene: Scene = { elements: input.elements ?? emptyScene.elements, appState: input.appState ?? {}, files: input.files ?? {} }
        const id = randomUUID()
        yield* insertRow({
          id,
          project: input.project,
          title: input.title,
          sceneJson: yield* encodeBoundedScene(scene),
          pendingJson: yield* encodeOptionalPending(pending ?? null),
          elementCount: liveElementCount(scene.elements),
          now: yield* Clock.currentTimeMillis,
        })
        const created = yield* loadRow(id)
        return summaryOf(created.row, created.pending)
      })

      const write = Effect.fn('whiteboard write')(function* (input: Input<'write'>) {
        const pending = yield* pendingOf(input)
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            if (input.boardId === undefined) return yield* create(input, pending)
            if (input.expectedRevision === undefined) return yield* new InvalidBoardWrite({ reason: 'missing-revision' })
            const current = yield* loadRow(input.boardId)
            if (current.row.deleted_at !== null) return yield* new BoardDeleted()
            yield* checked(current, input.expectedRevision)
            const scene = yield* sceneFor(current.row.scene_json, input)
            return yield* replace({
              id: input.boardId,
              expectedRevision: input.expectedRevision,
              title: input.title ?? current.row.title,
              scene,
              pending: pending ?? (input.clearPending === true ? null : current.pending),
              deletedAt: null,
            })
          }),
        )
      }, storeFailure('write'))

      const rename = Effect.fn('whiteboard rename')(function* (input: Input<'rename'>) {
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const current = yield* loadBoard(input.boardId)
            yield* checked(current, input.expectedRevision)
            if (current.row.title === input.title) return summaryOf(current.row, current.pending)
            return yield* replace({
              ...current,
              id: input.boardId,
              expectedRevision: input.expectedRevision,
              title: input.title,
              deletedAt: current.row.deleted_at,
            })
          }),
        )
      }, storeFailure('rename'))

      /** Delete and restore only move the board in and out of Recently deleted; the scene is never touched. */
      const setDeleted = (operation: 'delete' | 'restore') =>
        Effect.fn(`whiteboard ${operation}`)(function* (boardId: string) {
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const current = yield* loadBoard(boardId)
              const deleted = current.row.deleted_at !== null
              if (deleted === (operation === 'delete')) return summaryOf(current.row, current.pending)
              const deletedAt = operation === 'delete' ? yield* Clock.currentTimeMillis : null
              return yield* replace({ ...current, id: boardId, expectedRevision: current.row.revision, title: current.row.title, deletedAt })
            }),
          )
        }, storeFailure(operation))
      const remove = setDeleted('delete')
      const restore = setDeleted('restore')

      return BoardStore.of({
        list,
        read,
        write,
        rename,
        remove: input => remove(input.boardId),
        restore: input => restore(input.boardId),
      })
    }),
  ).pipe(Layer.provide(boardDbLayer))
}
