import { createHash, randomUUID } from 'node:crypto'
import { Context, Effect, FileSystem, Layer, Option, Path, type PlatformError, Schema } from 'effect'

export class WritePathInvalid extends Schema.TaggedError<WritePathInvalid>()(
  'WritePathInvalid',
  { reason: Schema.Literals(['nul-byte', 'not-a-file-name']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'invalid-path' },
) {
  override get message(): string {
    return this.reason === 'nul-byte' ? 'Path contains a NUL byte.' : 'Path does not name a file.'
  }
}

export class WritePathOutsideWorkspace extends Schema.TaggedError<WritePathOutsideWorkspace>()(
  'WritePathOutsideWorkspace',
  { parentChanged: Schema.Boolean, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'outside-workspace' },
) {
  override get message(): string {
    return this.parentChanged ? 'Parent directory changed during the save.' : 'Path is outside the session workspace.'
  }
}

export class WriteParentMissing extends Schema.TaggedError<WriteParentMissing>()(
  'WriteParentMissing',
  { missing: Schema.Literals(['root', 'parent']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'missing-parent' },
) {
  override get message(): string {
    return this.missing === 'root' ? 'Workspace root is unavailable.' : 'Parent directory does not exist.'
  }
}

export class WriteTargetNotRegularFile extends Schema.TaggedError<WriteTargetNotRegularFile>()(
  'WriteTargetNotRegularFile',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'not-regular-file' },
) {
  override get message(): string {
    return 'Only regular files can be saved; symlinks and directories are refused.'
  }
}

export class WriteTooLarge extends Schema.TaggedError<WriteTooLarge>()(
  'WriteTooLarge',
  { maxBytes: Schema.Number, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'too-large' },
) {
  override get message(): string {
    return `File exceeds the ${String(this.maxBytes)} byte save limit.`
  }
}

export class WritePathProtected extends Schema.TaggedError<WritePathProtected>()(
  'WritePathProtected',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'protected-path' },
) {
  override get message(): string {
    return 'Version-control internals are not editable.'
  }
}

/** The file system failed while the save ran; nothing outside the temporary sibling was changed. */
export class WriteIoFailed extends Schema.TaggedError<WriteIoFailed>()('WriteIoFailed', {
  operation: Schema.Literals(['inspect', 'read', 'write', 'rename']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Saving the file failed while trying to ${this.operation} it.`
  }
}

export type WorkspaceWriteError =
  | WritePathInvalid
  | WritePathOutsideWorkspace
  | WriteParentMissing
  | WriteTargetNotRegularFile
  | WriteTooLarge
  | WritePathProtected
  | WriteIoFailed

export interface WorkspaceWriteRequest {
  readonly root: string
  readonly path: string
  readonly text: string
  readonly expectedSha256: string | null
  readonly overwrite: boolean
  readonly maxBytes: number
}

export type WorkspaceWriteResult =
  | { readonly status: 'saved'; readonly absolutePath: string; readonly sha256: string; readonly bytes: number }
  | { readonly status: 'conflict'; readonly currentSha256: string | null }

const PROTECTED_SEGMENTS = new Set(['.git', '.jj'])

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const isNotFound = (error: PlatformError.PlatformError): boolean => error.reason._tag === 'NotFound'

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const isInside = (root: string, target: string): boolean => {
    const fromRoot = path.relative(root, target)
    return fromRoot !== '' && fromRoot !== '..' && !fromRoot.startsWith(`..${path.sep}`) && !path.isAbsolute(fromRoot)
  }

  const realDirectory = (directory: string) => fs.realPath(directory).pipe(Effect.option)

  const existingEntry = (target: string) =>
    fs.lstat(target).pipe(
      Effect.map(Option.some),
      Effect.catchIf(isNotFound, () => Effect.succeedNone),
      Effect.mapError(cause => new WriteIoFailed({ operation: 'inspect', cause })),
    )

  /** Write `content` to an exclusive temp sibling and fsync it; the handle closes before the rename. */
  const writeTemporary = (input: { readonly temporary: string; readonly content: Uint8Array; readonly mode: number }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fs.open(input.temporary, { flag: 'wx', mode: input.mode })
        yield* file.writeAll(input.content)
        yield* file.sync
      }),
    ).pipe(Effect.mapError(cause => new WriteIoFailed({ operation: 'write', cause })))

  /**
   * Replace (or create) one text file inside a workspace root. The parent directory is resolved through its real
   * path so a symlinked directory cannot carry the write outside the root; the target itself must be a regular file,
   * never a symlink. The content lands in an exclusive temp sibling, is fsynced, then renamed over the target, so
   * readers see the old or the new file, never a mix. `expectedSha256` is the hash of what the editor loaded: a
   * different file on disk is reported as a conflict unless `overwrite` is set.
   */
  const write = Effect.fn('editor workspace write')(function* (request: WorkspaceWriteRequest) {
    if (request.path.includes('\0')) return yield* new WritePathInvalid({ reason: 'nul-byte' })
    const content = Buffer.from(request.text, 'utf8')
    if (content.byteLength > request.maxBytes) return yield* new WriteTooLarge({ maxBytes: request.maxBytes })
    const root = yield* realDirectory(request.root)
    if (Option.isNone(root)) return yield* new WriteParentMissing({ missing: 'root' })
    const requested = path.isAbsolute(request.path) ? path.resolve(request.path) : path.resolve(root.value, request.path)
    const name = path.basename(requested)
    if (name === '' || name === '.' || name === '..') return yield* new WritePathInvalid({ reason: 'not-a-file-name' })
    const parent = yield* realDirectory(path.dirname(requested))
    if (Option.isNone(parent)) return yield* new WriteParentMissing({ missing: 'parent' })
    const target = path.join(parent.value, name)
    if (!isInside(root.value, target)) return yield* new WritePathOutsideWorkspace({ parentChanged: false })
    if (
      path
        .relative(root.value, target)
        .split(path.sep)
        .some(segment => PROTECTED_SEGMENTS.has(segment))
    )
      return yield* new WritePathProtected()

    const entry = yield* existingEntry(target)
    if (Option.isSome(entry) && entry.value.type !== 'File') return yield* new WriteTargetNotRegularFile()
    const currentSha256 = Option.isNone(entry)
      ? null
      : sha256Hex(yield* fs.readFile(target).pipe(Effect.mapError(cause => new WriteIoFailed({ operation: 'read', cause }))))
    if (!request.overwrite && currentSha256 !== request.expectedSha256) {
      const conflict: WorkspaceWriteResult = { status: 'conflict', currentSha256 }
      return conflict
    }

    const temporary = path.join(parent.value, `.${name}.${randomUUID()}.dshfiles-tmp`)
    const mode = Option.match(entry, { onNone: () => 0o644, onSome: info => info.mode & 0o7777 })
    yield* Effect.gen(function* () {
      yield* writeTemporary({ temporary, content, mode })
      const parentNow = yield* realDirectory(path.dirname(requested))
      if (Option.getOrUndefined(parentNow) !== parent.value) return yield* new WritePathOutsideWorkspace({ parentChanged: true })
      yield* fs.rename(temporary, target).pipe(Effect.mapError(cause => new WriteIoFailed({ operation: 'rename', cause })))
    }).pipe(Effect.onError(() => fs.remove(temporary).pipe(Effect.ignore)))
    const saved: WorkspaceWriteResult = { status: 'saved', absolutePath: target, sha256: sha256Hex(content), bytes: content.byteLength }
    return saved
  })

  return WorkspaceWrite.of({ write })
})

/** Guarded, atomic text-file saves inside a session workspace. */
export class WorkspaceWrite extends Context.Service<
  WorkspaceWrite,
  { readonly write: (request: WorkspaceWriteRequest) => Effect.Effect<WorkspaceWriteResult, WorkspaceWriteError> }
>()('@dshfiles/editor/WorkspaceWrite') {
  static readonly layer = Layer.effect(WorkspaceWrite, make)
}
