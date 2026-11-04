import { randomUUID } from 'node:crypto'
import { Context, Effect, FileSystem, Layer, Option, Path, type PlatformError, Schema } from 'effect'
import { deferredFilePathSchema } from './store.js'
import type { ParentQuestionOutcome } from './parent-questions.js'

export type DeferredParentQuestion = Extract<ParentQuestionOutcome, { readonly kind: 'deferred' }>

const MAXIMUM_DOCUMENT_BYTES = 256_000

const refusalMessages = {
  'workspace-not-directory': 'The child Session workspace is not a directory.',
  'questions-not-directory': 'The workspace questions path must be a real directory, not a symlink or file.',
  'questions-outside': 'The workspace questions directory resolves outside its expected path.',
  'existing-not-regular': 'The existing deferred-question path must be a small regular file, not a symlink.',
  'existing-too-large': 'The existing deferred-question path must be a small regular file.',
  'file-edited': 'The deferred-question file was edited; refusing to overwrite it.',
  'stored-path-taken': 'The stored deferred-question path belongs to different content; refusing to overwrite it.',
  'collision-unresolved': 'A deferred-question filename collision could not be resolved safely.',
  'invalid-file-path': 'The deferred-question file path is not a safe questions/ Markdown path.',
} as const

/** The workspace or an existing file makes writing the deferred question unsafe; nothing was overwritten. */
export class DeferredFileRefused extends Schema.TaggedError<DeferredFileRefused>()(
  'DeferredFileRefused',
  {
    reason: Schema.Literals([
      'workspace-not-directory',
      'questions-not-directory',
      'questions-outside',
      'existing-not-regular',
      'existing-too-large',
      'file-edited',
      'stored-path-taken',
      'collision-unresolved',
      'invalid-file-path',
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'deferred-file-refused' },
) {
  override get message(): string {
    return refusalMessages[this.reason]
  }
}

/** The file system failed while writing the deferred question file. */
export class DeferredFileIoFailed extends Schema.TaggedError<DeferredFileIoFailed>()('DeferredFileIoFailed', { cause: Schema.optional(Schema.Defect()) }) {
  override get message(): string {
    return 'The deferred-question file could not be written.'
  }
}

const decodeDeferredFilePath = Schema.decodeUnknownEffect(deferredFilePathSchema)

const isNotFound = (error: PlatformError.PlatformError): boolean => error.reason._tag === 'NotFound'
const isAlreadyExists = (error: PlatformError.PlatformError): boolean => error.reason._tag === 'AlreadyExists'

const codeBlock = (value: string): string => {
  const longestFence = Array.from(value.matchAll(/`+/g), match => match[0].length).reduce((longest, length) => Math.max(longest, length), 0)
  const fence = '`'.repeat(Math.max(3, longestFence + 1))
  return `${fence}text\n${value}\n${fence}`
}

const slugFor = (question: string): string => {
  const slug = question
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  return slug || 'question'
}

const filenameFor = (question: DeferredParentQuestion): string => {
  const timestamp = new Date(question.createdAt).toISOString().replace(/[:.]/g, '-')
  return `${timestamp}_${slugFor(question.question)}.md`
}

const markdownFor = (question: DeferredParentQuestion): string =>
  [
    '# Deferred agent question',
    '',
    'Status: Open',
    `Question ID: ${question.questionId}`,
    `Asked at: ${new Date(question.createdAt).toISOString()}`,
    `Deferred at: ${new Date(question.deferredAt).toISOString()}`,
    '',
    'Asked by child Session:',
    codeBlock(question.childSessionId),
    '',
    'Question (untrusted content):',
    codeBlock(question.question),
    '',
    'Context (untrusted content):',
    codeBlock(question.context ?? 'No additional context.'),
    '',
    'Options (untrusted content):',
    codeBlock(JSON.stringify(question.options, null, 2)),
    '',
    'Recommended option:',
    codeBlock(JSON.stringify(question.recommendedOption, null, 2)),
    '',
    'Answer:',
    'No answer recorded. Editing this file does not deliver a response to the child Agent.',
    '',
  ].join('\n')

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const ioFailure = (cause: unknown) => new DeferredFileIoFailed({ cause })

  const ensureQuestionDirectory = Effect.fnUntraced(function* (workspacePath: string) {
    const workspace = yield* fs.realPath(workspacePath).pipe(Effect.mapError(ioFailure))
    const workspaceInfo = yield* fs.lstat(workspace).pipe(Effect.mapError(ioFailure))
    if (workspaceInfo.type !== 'Directory') return yield* new DeferredFileRefused({ reason: 'workspace-not-directory' })
    const directory = path.join(workspace, 'questions')
    yield* fs.makeDirectory(directory, { mode: 0o700 }).pipe(
      Effect.catchIf(isAlreadyExists, () => Effect.void),
      Effect.mapError(ioFailure),
    )
    const directoryInfo = yield* fs.lstat(directory).pipe(Effect.mapError(ioFailure))
    if (directoryInfo.type !== 'Directory') return yield* new DeferredFileRefused({ reason: 'questions-not-directory' })
    if ((yield* fs.realPath(directory).pipe(Effect.mapError(ioFailure))) !== directory) return yield* new DeferredFileRefused({ reason: 'questions-outside' })
    return directory
  })

  /** The contents of an existing small regular file, or none when nothing is there. */
  const readExistingFile = Effect.fnUntraced(function* (filePath: string) {
    const info = yield* fs.lstat(filePath).pipe(
      Effect.map(Option.some),
      Effect.catchIf(isNotFound, () => Effect.succeedNone),
      Effect.mapError(ioFailure),
    )
    if (Option.isNone(info)) return Option.none<string>()
    if (info.value.type !== 'File' || Number(info.value.size) > MAXIMUM_DOCUMENT_BYTES)
      return yield* new DeferredFileRefused({ reason: 'existing-not-regular' })
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fs.open(filePath, { flag: 'r', noFollow: true })
        const details = yield* file.stat
        if (details.type !== 'File' || Number(details.size) > MAXIMUM_DOCUMENT_BYTES) return yield* new DeferredFileRefused({ reason: 'existing-too-large' })
        const bytes = yield* file.readAlloc(MAXIMUM_DOCUMENT_BYTES)
        return Option.some(Option.match(bytes, { onNone: () => '', onSome: value => Buffer.from(value).toString('utf8') }))
      }),
    ).pipe(
      Effect.catchIf(
        error => error._tag === 'PlatformError' && isNotFound(error),
        () => Effect.succeedNone,
      ),
      Effect.catchTag('PlatformError', error => Effect.fail(ioFailure(error))),
    )
  })

  /** Publish `contents` under `filename` only if nothing is there: an exclusive temp file hard-linked into place. */
  const createFileIfAbsent = Effect.fnUntraced(function* (input: { readonly directory: string; readonly filename: string; readonly contents: string }) {
    const destination = path.join(input.directory, input.filename)
    const temporary = path.join(input.directory, `.${path.basename(input.filename)}.${randomUUID()}.tmp`)
    return yield* Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const file = yield* fs.open(temporary, { flag: 'wx', mode: 0o600, noFollow: true })
          yield* file.writeAll(new TextEncoder().encode(input.contents))
          yield* file.sync
        }),
      )
      return yield* fs.link(temporary, destination).pipe(
        Effect.as(true),
        Effect.catchIf(isAlreadyExists, () => Effect.succeed(false)),
      )
    }).pipe(Effect.ensuring(fs.remove(temporary).pipe(Effect.ignore)), Effect.mapError(ioFailure))
  })

  const writeCandidate = Effect.fnUntraced(function* (input: {
    readonly directory: string
    readonly filename: string
    readonly contents: string
    readonly questionId: string
  }) {
    if (yield* createFileIfAbsent(input)) return Option.some(input.filename)
    const existing = yield* readExistingFile(path.join(input.directory, input.filename))
    if (Option.isNone(existing)) return (yield* createFileIfAbsent(input)) ? Option.some(input.filename) : Option.none<string>()
    if (existing.value === input.contents) return Option.some(input.filename)
    const existingQuestionId = existing.value.match(/^Question ID: ([0-9a-f-]+)$/m)?.[1]
    if (existingQuestionId === input.questionId) return yield* new DeferredFileRefused({ reason: 'file-edited' })
    return Option.none<string>()
  })

  const relativePath = (filename: string) =>
    decodeDeferredFilePath(`questions/${filename}`).pipe(Effect.mapError(cause => new DeferredFileRefused({ reason: 'invalid-file-path', cause })))

  /**
   * Write the deferred question under `questions/` in the child workspace, idempotently: the same content is the same
   * file, a human edit is never overwritten, and an unrelated file with the same name gets an id-suffixed sibling.
   */
  const write = Effect.fn('question defer')(function* (input: { readonly workspacePath: string; readonly question: DeferredParentQuestion }) {
    const directory = yield* ensureQuestionDirectory(input.workspacePath)
    const contents = markdownFor(input.question)
    const requestedFilename =
      input.question.filePath === undefined ? filenameFor(input.question) : path.basename(yield* relativePath(path.basename(input.question.filePath)))
    const first = yield* writeCandidate({ directory, filename: requestedFilename, contents, questionId: input.question.questionId })
    if (Option.isSome(first)) return yield* relativePath(first.value)
    if (input.question.filePath !== undefined) return yield* new DeferredFileRefused({ reason: 'stored-path-taken' })
    const collisionSafe = yield* writeCandidate({
      directory,
      filename: `${requestedFilename.slice(0, -3)}_${input.question.questionId.slice(0, 8)}.md`,
      contents,
      questionId: input.question.questionId,
    })
    if (Option.isSome(collisionSafe)) return yield* relativePath(collisionSafe.value)
    return yield* new DeferredFileRefused({ reason: 'collision-unresolved' })
  })

  return DeferredQuestionFiles.of({ write })
})

/** The `questions/` files a deferred parent question leaves in the child's workspace. */
export class DeferredQuestionFiles extends Context.Service<
  DeferredQuestionFiles,
  {
    readonly write: (input: {
      readonly workspacePath: string
      readonly question: DeferredParentQuestion
    }) => Effect.Effect<string, DeferredFileRefused | DeferredFileIoFailed>
  }
>()('@dshfiles/agent-questions/DeferredQuestionFiles') {
  static readonly layer = Layer.effect(DeferredQuestionFiles, make)
}
