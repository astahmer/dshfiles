import { stat } from 'node:fs/promises'
import { Effect, FileSystem, Path, Schema } from 'effect'

export class JsonlPurgeRefused extends Schema.TaggedError<JsonlPurgeRefused>()('JsonlPurgeRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return `Conversation purge stopped: ${this.reason} Older generations may already be removed. Inspect the configured session storage before retrying.`
  }
}

interface JsonlFilesInput {
  readonly root: string
  readonly cwd?: string
  readonly sessionId: string
}

// Layout adapted from @deepseek-ai/dsh-session-persistence-jsonl 0.2.1-rc.2 (MIT), format.ts.
const encodeSegment = (raw: string): string => {
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let encoded = ''
  for (let index = 0; index < raw.length; index++) {
    const code = raw.charCodeAt(index)
    const character = String.fromCharCode(code)
    encoded += /^[A-Za-z0-9._-]$/.test(character) ? character : `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return encoded
}

const projectKey = (cwd: string): string => {
  let readable = ''
  let separatorRun = false
  for (let index = 0; index < cwd.length; index++) {
    const code = cwd.charCodeAt(index)
    const character = String.fromCharCode(code)
    if (character === '/' || character === '\\' || character === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
      continue
    }
    readable += /^[A-Za-z0-9._-]$/.test(character) ? character : `~${code.toString(16).toUpperCase().padStart(4, '0')}`
    separatorRun = false
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

export const jsonlSessionDirectory = Effect.fn('conversation jsonl directory')(function* (input: JsonlFilesInput) {
  const path = yield* Path.Path
  if (
    !path.isAbsolute(input.root) ||
    input.root.includes('\0') ||
    input.sessionId.length === 0 ||
    input.cwd === '' ||
    path.resolve(input.root) === path.parse(input.root).root
  ) {
    return yield* new JsonlPurgeRefused({ reason: 'The storage root, session identity, or project path is invalid.' })
  }
  return path.join(path.resolve(input.root), input.cwd === undefined ? '_no-cwd' : projectKey(input.cwd), encodeSegment(input.sessionId))
})

/** Caller owns the native write lease and has rejected attached Sessions. Only canonical logs are removed; locks, directories and sidecars remain. */
export const purgeJsonlFiles = Effect.fn('conversation jsonl purge')(function* (input: JsonlFilesInput & { readonly expectedRevision: string }) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* jsonlSessionDirectory(input)
  const root = path.resolve(input.root)
  const canonicalRoot = yield* fs.realPath(root)
  const project = path.dirname(directory)
  yield* Effect.forEach(
    [root, project, directory],
    component =>
      Effect.gen(function* () {
        if ((yield* fs.lstat(component)).type !== 'Directory') {
          return yield* new JsonlPurgeRefused({ reason: 'A session storage directory is a symbolic link or not a directory.' })
        }
        const expected = component === root ? canonicalRoot : path.join(canonicalRoot, path.relative(root, component))
        if ((yield* fs.realPath(component)) !== expected) {
          return yield* new JsonlPurgeRefused({ reason: 'A session storage directory resolves outside its expected location.' })
        }
      }),
    { concurrency: 1 },
  )
  const files: { readonly name: string; readonly version: number }[] = []
  yield* Effect.forEach(
    yield* fs.readDirectory(directory),
    name =>
      Effect.gen(function* () {
        const match = /^session(?:\.v([1-9][0-9]*))?\.jsonl(?:\.zstd)?$/u.exec(name)
        if (match === null) return
        const version = match[1] === undefined ? 0 : Number(match[1])
        if (!Number.isSafeInteger(version) || version > 4) {
          return yield* new JsonlPurgeRefused({ reason: 'A log uses a generation newer than the supported session format.' })
        }
        if ((yield* fs.lstat(path.join(directory, name))).type !== 'File') {
          return yield* new JsonlPurgeRefused({ reason: 'A canonical log is a symbolic link or not a regular file.' })
        }
        files.push({ name, version })
      }),
    { concurrency: 1 },
  )
  if (files.length === 0) return yield* new JsonlPurgeRefused({ reason: 'No canonical session log exists at the verified location.' })
  const current = files.filter(file => file.version === 4)
  const selected = current.length === 1 ? current[0] : undefined
  if (selected === undefined) return yield* new JsonlPurgeRefused({ reason: 'Exactly one current-format log must exist at the verified location.' })
  // The pinned backend uses nanosecond metadata unavailable through Effect FileSystem; this is its exact 0.2.1-rc.2 revision adapter.
  const currentRevision = Effect.tryPromise({
    try: () => stat(path.join(directory, selected.name), { bigint: true }),
    catch: () => new JsonlPurgeRefused({ reason: 'The current log identity could not be read.' }),
  }).pipe(Effect.map(identity => [identity.dev, identity.ino, identity.size, identity.mtimeNs, identity.ctimeNs].join(':')))
  if ((yield* currentRevision) !== input.expectedRevision) {
    return yield* new JsonlPurgeRefused({ reason: 'The computed log location does not match the previewed persistence revision.' })
  }
  const syncDirectory = Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* fs.open(directory, { flag: 'r', noFollow: true })
      yield* handle.sync
    }),
  )
  files.sort((left, right) => left.version - right.version || left.name.localeCompare(right.name))
  yield* Effect.forEach(
    files,
    file =>
      Effect.gen(function* () {
        if ((yield* fs.lstat(path.join(directory, file.name))).type !== 'File') {
          return yield* new JsonlPurgeRefused({ reason: 'A canonical log changed during deletion.' })
        }
        if (file.name === selected.name) {
          yield* syncDirectory
          if ((yield* currentRevision) !== input.expectedRevision) {
            return yield* new JsonlPurgeRefused({ reason: 'The current log identity changed while removing historical generations.' })
          }
        }
        yield* fs.remove(path.join(directory, file.name)).pipe(Effect.andThen(syncDirectory), Effect.uninterruptible)
      }),
    { concurrency: 1 },
  )
  yield* syncDirectory
  return files.length
})
