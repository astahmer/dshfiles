import { Context, Effect, FileSystem, Layer, Path, Schema } from 'effect'
import { BacklogReference } from './backlog-reference.js'
import { BacklogRepo } from './backlog-repo.js'
import { BacklogItems } from './item.js'
import { BacklogOps } from './op-log.js'

export const exportFormats = ['jsonl', 'sqlite'] as const
export type BacklogExportFormat = (typeof exportFormats)[number]

export interface BacklogExportReport {
  readonly path: string
  readonly format: BacklogExportFormat
  readonly items: number
  readonly ops: number
  readonly bytes: number
}

/** An export the Host will not write: each reason says what to change. */
export class BacklogExportRefused extends Schema.TaggedError<BacklogExportRefused>()(
  'BacklogExportRefused',
  { path: Schema.String, reason: Schema.Literals(['relative', 'exists', 'no-folder']) },
  { dshxWireCode: 'backlog-export-refused' },
) {
  override get message(): string {
    if (this.reason === 'relative') return `“${this.path}” is not an absolute path. Give the full path of a new file, such as /Users/you/backlog.jsonl.`
    if (this.reason === 'exists') return `${this.path} already exists, and an export never overwrites a file. Choose a new file name.`
    return `The folder of ${this.path} does not exist. Create it first, or choose a file in an existing folder.`
  }
}

export class BacklogExportFailed extends Schema.TaggedError<BacklogExportFailed>()(
  'BacklogExportFailed',
  { path: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'backlog-export-failed' },
) {
  override get message(): string {
    return `The backlog could not be exported to ${this.path}. Check that the folder is writable and has free space, then retry.`
  }
}

const encodeItem = Schema.encodeUnknownEffect(BacklogItems.itemSchema)
const encodeOp = Schema.encodeUnknownEffect(BacklogOps.schema)

/**
 * Writes the backlog to a new file the user named: JSONL with one folded item per line (and, on request, every op of
 * the log after the items), or a consistent copy of the SQLite file. Attachment bytes stay in the plugin's `files/`
 * folder; both formats carry their metadata.
 */
export class BacklogExport extends Context.Service<
  BacklogExport,
  {
    readonly run: (input: {
      readonly path: string
      readonly format: BacklogExportFormat
      readonly includeOps?: boolean | undefined
    }) => Effect.Effect<BacklogExportReport, BacklogExportRefused | BacklogExportFailed>
  }
>()('@dshfiles/backlog/BacklogExport') {
  static readonly layer = Layer.effect(
    BacklogExport,
    Effect.gen(function* () {
      const repo = yield* BacklogRepo
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const jsonl = Effect.fnUntraced(function* (target: string, includeOps: boolean) {
        const rows = yield* repo.exportRows
        const itemLines = yield* Effect.forEach(rows.items, row =>
          Effect.map(encodeItem(row.item), item => JSON.stringify({ type: 'item', itemId: row.itemId, ref: BacklogReference.refOf(row.item), item })),
        )
        const opLines = includeOps
          ? yield* Effect.forEach(rows.ops, record =>
              Effect.map(encodeOp(record.op), op =>
                JSON.stringify({ type: 'op', opId: record.opId, itemId: record.itemId, hlc: record.hlc, origin: record.origin, op }),
              ),
            )
          : []
        const text = [...itemLines, ...opLines].map(line => `${line}\n`).join('')
        yield* fs.writeFileString(target, text, { flag: 'wx', mode: 0o600 })
        return { items: rows.items.length, ops: opLines.length }
      })

      const sqlite = Effect.fnUntraced(function* (target: string) {
        const rows = yield* repo.exportRows
        yield* repo.vacuumInto(target)
        return { items: rows.items.length, ops: rows.ops.length }
      })

      const run = Effect.fn('backlog export')(function* (input: {
        readonly path: string
        readonly format: BacklogExportFormat
        readonly includeOps?: boolean | undefined
      }) {
        const target = input.path.trim()
        if (!path.isAbsolute(target)) return yield* new BacklogExportRefused({ path: target, reason: 'relative' })
        if (yield* fs.exists(target).pipe(Effect.orElseSucceed(() => true))) return yield* new BacklogExportRefused({ path: target, reason: 'exists' })
        if (!(yield* fs.exists(path.dirname(target)).pipe(Effect.orElseSucceed(() => false))))
          return yield* new BacklogExportRefused({ path: target, reason: 'no-folder' })
        const failed = (cause: unknown) => new BacklogExportFailed({ path: target, cause })
        const counts = yield* (input.format === 'jsonl' ? jsonl(target, input.includeOps === true) : sqlite(target)).pipe(Effect.mapError(failed))
        const bytes = Number((yield* fs.stat(target).pipe(Effect.mapError(failed))).size)
        yield* Effect.annotateCurrentSpan({
          'dshx.backlog.export.format': input.format,
          'dshx.backlog.export.items': counts.items,
          'dshx.backlog.export.ops': counts.ops,
          'dshx.backlog.export.bytes': bytes,
        })
        return { path: target, format: input.format, items: counts.items, ops: counts.ops, bytes } satisfies BacklogExportReport
      })

      return BacklogExport.of({ run })
    }),
  )
}
