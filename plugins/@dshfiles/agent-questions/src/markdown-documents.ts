import { createHash } from 'node:crypto'
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from 'effect'
import { type MarkdownFeedbackAnchor, workspaceMarkdownPathSchema } from './store.js'

const MAXIMUM_DOCUMENT_BYTES = 256_000
const MAXIMUM_EXCERPT_LINES = 200
const READ_CHUNK_BYTES = 16_384

const refusalMessages = {
  'invalid-path': 'Expected a safe workspace-relative Markdown path.',
  symlink: 'Markdown feedback paths cannot contain symlinks.',
  'not-regular-file': 'Markdown feedback target must be a regular workspace file.',
  'outside-workspace': 'Markdown feedback target leaves the workspace.',
  'too-large': `Markdown feedback documents are limited to ${String(MAXIMUM_DOCUMENT_BYTES)} bytes.`,
  'changed-while-reading': 'Markdown feedback target changed while it was being read.',
  'not-utf8': 'Markdown feedback documents must be UTF-8 text.',
  'line-range': `Markdown feedback anchors must cover at most ${String(MAXIMUM_EXCERPT_LINES)} ordered lines.`,
  'excerpt-mismatch': 'Selected Markdown text does not match the requested workspace lines.',
} as const

const RefusalReason = Schema.Literals([
  'invalid-path',
  'symlink',
  'not-regular-file',
  'outside-workspace',
  'too-large',
  'changed-while-reading',
  'not-utf8',
  'line-range',
  'excerpt-mismatch',
])

/** A Markdown feedback target or anchor the Host refuses; nothing was read past the refusal. */
export class MarkdownTargetRefused extends Schema.TaggedError<MarkdownTargetRefused>()(
  'MarkdownTargetRefused',
  { reason: RefusalReason, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'markdown-target-refused' },
) {
  override get message(): string {
    return refusalMessages[this.reason]
  }
}

/** The file system failed while reading a Markdown feedback target. */
export class MarkdownReadFailed extends Schema.TaggedError<MarkdownReadFailed>()('MarkdownReadFailed', { cause: Schema.optional(Schema.Defect()) }) {
  override get message(): string {
    return 'The Markdown feedback target could not be read.'
  }
}

export interface MarkdownDocumentTarget {
  readonly workspacePath: string
  readonly path: string
}

export interface MarkdownAnchorRequest extends MarkdownDocumentTarget {
  readonly startLine: number
  readonly endLine: number
  readonly selectedText: string
}

const decodeMarkdownPath = Schema.decodeUnknownEffect(workspaceMarkdownPathSchema)
const utf8 = new TextDecoder('utf-8', { fatal: true })

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const ioFailure = (cause: unknown) => new MarkdownReadFailed({ cause })

  const isInside = (parent: string, child: string): boolean => {
    const relative = path.relative(parent, child)
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  }

  /** Read every byte of an open regular file, refusing once it grows past the document limit. */
  const readBounded = (file: FileSystem.File) =>
    Effect.gen(function* () {
      const chunks: Uint8Array[] = []
      let bytesRead = 0
      while (bytesRead <= MAXIMUM_DOCUMENT_BYTES) {
        const chunk = yield* file.readAlloc(Math.min(READ_CHUNK_BYTES, MAXIMUM_DOCUMENT_BYTES + 1 - bytesRead))
        if (Option.isNone(chunk)) break
        chunks.push(chunk.value)
        bytesRead += chunk.value.byteLength
      }
      if (bytesRead > MAXIMUM_DOCUMENT_BYTES) return yield* new MarkdownTargetRefused({ reason: 'too-large' })
      return Buffer.concat(chunks)
    })

  const readDocument = Effect.fn('feedback markdown read')(function* (target: MarkdownDocumentTarget) {
    const safePath = yield* decodeMarkdownPath(target.path).pipe(Effect.mapError(cause => new MarkdownTargetRefused({ reason: 'invalid-path', cause })))
    const root = yield* fs.realPath(target.workspacePath).pipe(Effect.mapError(ioFailure))
    const segments = safePath.split('/')
    let candidate = root
    for (const [index, segment] of segments.entries()) {
      candidate = path.resolve(candidate, segment)
      const info = yield* fs.lstat(candidate).pipe(Effect.mapError(ioFailure))
      if (info.type === 'SymbolicLink') return yield* new MarkdownTargetRefused({ reason: 'symlink' })
      const expected = index === segments.length - 1 ? 'File' : 'Directory'
      if (info.type !== expected) return yield* new MarkdownTargetRefused({ reason: 'not-regular-file' })
    }
    const canonicalTarget = yield* fs.realPath(candidate).pipe(Effect.mapError(ioFailure))
    if (!isInside(root, canonicalTarget)) return yield* new MarkdownTargetRefused({ reason: 'outside-workspace' })

    const bytes = yield* Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fs.open(canonicalTarget, { flag: 'r', noFollow: true }).pipe(Effect.mapError(ioFailure))
        const info = yield* file.stat.pipe(Effect.mapError(ioFailure))
        if (info.type !== 'File' || Number(info.size) > MAXIMUM_DOCUMENT_BYTES) return yield* new MarkdownTargetRefused({ reason: 'too-large' })
        return yield* readBounded(file).pipe(Effect.catchTag('PlatformError', error => Effect.fail(ioFailure(error))))
      }),
    )
    const content = yield* Effect.try({ try: () => utf8.decode(bytes), catch: cause => new MarkdownTargetRefused({ reason: 'not-utf8', cause }) })
    const latestTarget = yield* fs.realPath(candidate).pipe(Effect.mapError(ioFailure))
    if (latestTarget !== canonicalTarget || !isInside(root, latestTarget)) return yield* new MarkdownTargetRefused({ reason: 'changed-while-reading' })
    return { path: safePath, revision: createHash('sha256').update(bytes).digest('hex'), lines: content.split(/\r\n|\n|\r/) }
  })

  /** Anchor feedback to exact workspace lines of the current whole-file revision. */
  const captureAnchor = Effect.fn('feedback anchor capture')(function* (request: MarkdownAnchorRequest) {
    if (
      !Number.isSafeInteger(request.startLine) ||
      !Number.isSafeInteger(request.endLine) ||
      request.startLine < 1 ||
      request.endLine < request.startLine ||
      request.endLine - request.startLine >= MAXIMUM_EXCERPT_LINES
    ) {
      return yield* new MarkdownTargetRefused({ reason: 'line-range' })
    }
    const document = yield* readDocument(request)
    const excerpt = document.lines.slice(request.startLine - 1, request.endLine).join('\n')
    if (excerpt.length === 0 || excerpt !== request.selectedText) return yield* new MarkdownTargetRefused({ reason: 'excerpt-mismatch' })
    const anchor: MarkdownFeedbackAnchor = {
      kind: 'markdown',
      path: document.path,
      revision: document.revision,
      startLine: request.startLine,
      endLine: request.endLine,
      excerpt,
    }
    return anchor
  })

  /** The whole-file revision now, or null once the document is gone or no longer a safe target. */
  const currentRevision = Effect.fn('feedback markdown revision')(function* (target: MarkdownDocumentTarget) {
    return yield* readDocument(target).pipe(
      Effect.map(document => document.revision),
      Effect.orElseSucceed(() => null),
    )
  })

  return MarkdownDocuments.of({ captureAnchor, currentRevision })
})

/** Workspace Markdown documents that child feedback anchors to, read without following symlinks. */
export class MarkdownDocuments extends Context.Service<
  MarkdownDocuments,
  {
    readonly captureAnchor: (request: MarkdownAnchorRequest) => Effect.Effect<MarkdownFeedbackAnchor, MarkdownTargetRefused | MarkdownReadFailed>
    readonly currentRevision: (target: MarkdownDocumentTarget) => Effect.Effect<string | null>
  }
>()('@dshfiles/agent-questions/MarkdownDocuments') {
  static readonly layer = Layer.effect(MarkdownDocuments, make)
}
