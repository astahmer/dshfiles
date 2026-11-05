import { createHash, randomUUID } from 'node:crypto'
import { Effect, FileSystem, Path, Schema } from 'effect'
import { parse, stringify } from 'yaml'
import type { BacklogKind } from './item.js'
import {
  BacklogProviderFailed,
  BacklogProviders,
  type BacklogProvider,
  type ProviderDescriptor,
  type ProviderScope,
  type RemotePatch,
  type RemoteRecord,
  type RemoteRelation,
} from './provider-port.js'

const LABEL = 'Markdown files'
const DEFAULT_FOLDER = 'backlog'
const MAX_FILES = 5_000

const descriptor: ProviderDescriptor = {
  kind: 'files',
  label: LABEL,
  containerLabel: 'Folder',
  credential: 'none',
  environmentVariables: [],
  referencePatterns: ['\\.md$'],
  referenceExample: 'a .md file in the bound folder',
  capabilities: {
    read: true,
    write: true,
    create: true,
    // Deleting a backlog item rewrites its file as `status: dropped`: the file stays as a tombstone for the repository's history.
    delete: 'close',
    statusModel: 'free-select',
    bodyFormat: 'markdown',
    comments: 'none',
    labels: true,
    priority: true,
    parent: true,
    relations: ['related', 'depends-on', 'blocks', 'duplicates'],
    changeFeed: 'full-scan',
    rateLimit: null,
  },
}

const stringList = Schema.Array(Schema.String)
/** What a file's frontmatter may hold; anything else is kept as it is on every write. */
const frontmatterSchema = Schema.Struct({
  ref: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  priority: Schema.optionalKey(Schema.String),
  tags: Schema.optionalKey(stringList),
  parent: Schema.optionalKey(Schema.NullOr(Schema.String)),
  links: Schema.optionalKey(stringList),
  created: Schema.optionalKey(Schema.String),
  updated: Schema.optionalKey(Schema.String),
})
type Frontmatter = typeof frontmatterSchema.Type

const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u

/** A YAML value as frontmatter holds it; anything else YAML can express (dates, binary) is dropped on read. */
interface YamlArray extends ReadonlyArray<YamlValue> {}
interface YamlRecord {
  readonly [key: string]: YamlValue
}
type YamlValue = string | number | boolean | null | YamlArray | YamlRecord
type FrontmatterData = YamlRecord

const yamlValueSchema: Schema.Codec<YamlValue> = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
  Schema.Array(Schema.suspend((): Schema.Codec<YamlValue> => yamlValueSchema)),
  Schema.Record(
    Schema.String,
    Schema.suspend((): Schema.Codec<YamlValue> => yamlValueSchema),
  ),
])
const yamlDocumentSchema = Schema.Record(Schema.String, Schema.Unknown)

/** The frontmatter YAML, one key at a time: a key whose value only YAML can hold is dropped, the others kept. */
const parseFrontmatter = (yamlText: string): FrontmatterData => {
  const document = Schema.decodeUnknownOption(yamlDocumentSchema)(
    (() => {
      try {
        return parse(yamlText)
      } catch {
        return {}
      }
    })(),
  )
  if (document._tag === 'None') return {}
  return Object.fromEntries(
    Object.entries(document.value).flatMap(([key, entry]) => {
      const value = Schema.decodeUnknownOption(yamlValueSchema)(entry)
      return value._tag === 'None' ? [] : [[key, value.value] as const]
    }),
  )
}

/** A file split into its frontmatter (every key, so unknown ones survive a write) and its markdown body. */
const splitFile = (text: string) => {
  const match = frontmatterPattern.exec(text)
  if (match === null) return { data: parseFrontmatter(''), body: text }
  return { data: parseFrontmatter(match[1] ?? ''), body: text.slice(match[0].length).replace(/^\r?\n/u, '') }
}

const joinFile = (data: FrontmatterData, body: string): string => `---\n${stringify(data, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.trimEnd()}\n`

/** A bare ref from `b:k3f9`, `k3f9` or a file stem. */
const bareRef = (value: string): string => value.trim().replace(/^b:/iu, '')

const slugOf = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48) || 'item'

interface ScannedFile {
  readonly stem: string
  readonly path: string
  readonly text: string
  readonly mtimeMs: number
  readonly data: FrontmatterData
  readonly frontmatter: Frontmatter
  readonly body: string
}

const kinds: readonly BacklogKind[] = ['task', 'bug', 'idea', 'note', 'question']
const isKind = (value: string | undefined): value is BacklogKind => kinds.some(kind => kind === value)
const isStatus = (value: string): value is (typeof BacklogProviders.statuses)[number] => BacklogProviders.statuses.some(status => status === value)
const isPriority = (value: string): value is (typeof BacklogProviders.priorities)[number] => BacklogProviders.priorities.some(priority => priority === value)
const isRelation = (value: string): value is RemoteRelation['relation'] => BacklogProviders.relations.some(relation => relation === value)

/** One file in backlog vocabulary: what the port calls `toCanonical`. `keyOfRef` turns a ref in a link into a file key. */
const toCanonical = (input: { readonly file: ScannedFile; readonly keyOfRef: (ref: string) => string | undefined }): RemoteRecord => {
  const file = input.file
  const frontmatter = file.frontmatter
  const status = frontmatter.status?.trim().toLowerCase()
  const priority = frontmatter.priority?.trim().toLowerCase()
  const parent =
    frontmatter.parent === undefined
      ? undefined
      : frontmatter.parent === null || frontmatter.parent.trim() === ''
        ? null
        : (input.keyOfRef(bareRef(frontmatter.parent)) ?? null)
  const relations = (frontmatter.links ?? []).flatMap((link): RemoteRelation[] => {
    const [head, ...rest] = link.split(':')
    const relation = head?.trim() ?? ''
    const key = input.keyOfRef(bareRef(rest.join(':')))
    return isRelation(relation) && key !== undefined ? [{ relation, key }] : []
  })
  const sha = createHash('sha256').update(file.text).digest('hex').slice(0, 16)
  const heading = /^#\s+(.+)$/mu.exec(file.body)?.[1]
  return {
    key: file.stem,
    displayKey: `${file.stem}.md`,
    url: `file://${file.path}`,
    title: (frontmatter.title ?? heading ?? file.stem).trim() || file.stem,
    body: file.body.trimEnd(),
    status:
      status === undefined || status === ''
        ? null
        : isStatus(status)
          ? BacklogProviders.exactStatus(status)
          : { category: 'todo', label: status, equivalents: ['todo'] },
    tags: (frontmatter.tags ?? []).map(tag => tag.trim().toLowerCase()).filter(tag => tag !== ''),
    ...(isKind(frontmatter.kind) && { kind: frontmatter.kind }),
    priority: priority !== undefined && isPriority(priority) ? priority : 'none',
    parentKey: parent ?? null,
    relations,
    updatedAt: Math.trunc(file.mtimeMs),
    version: `${String(Math.trunc(file.mtimeMs))}:${sha}`,
  }
}

/**
 * A folder of markdown files in the repository, one per item, as a two-way source: YAML frontmatter holds ref, title,
 * kind, status, priority, tags, parent, links and dates, and the body is the item body. Every pull scans the whole
 * folder (mtime + content hash), so an edit made in an editor or by `git pull` comes in on the next pass; a file that
 * disappears reads as removed. Comments are not written to files. A file's key is its name without `.md`, chosen once
 * (`<ref>-<slug>.md`); renaming a file reads as removing one item and adding another.
 */
export const makeFilesProvider = Effect.fn('backlog files provider')(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const failed = (code: BacklogProviderFailed['code'], detail = '', cause?: unknown) =>
    new BacklogProviderFailed({ provider: LABEL, code, detail, ...(cause !== undefined && { cause }) })

  const folderOf = (scope: ProviderScope) =>
    Effect.gen(function* () {
      const configured = scope.container.trim()
      if (configured !== '' && path.isAbsolute(configured)) return configured
      if (scope.project === null) return yield* failed('target-missing', 'set an absolute folder on the binding, or scope it to a project')
      return path.join(scope.project, configured === '' ? DEFAULT_FOLDER : configured)
    })

  const scan = Effect.fn('backlog files scan')(function* (folder: string) {
    yield* Effect.annotateCurrentSpan({ 'dshx.plugin.package': '@dshfiles/backlog', 'dshx.backlog.sync.provider': 'files' })
    if (!(yield* fs.exists(folder).pipe(Effect.orElseSucceed(() => false)))) return []
    const names = (yield* fs.readDirectory(folder).pipe(Effect.mapError(cause => failed('transport', `cannot read ${folder}`, cause))))
      .filter(name => name.endsWith('.md'))
      .sort()
      .slice(0, MAX_FILES)
    const files = yield* Effect.forEach(
      names,
      name =>
        Effect.gen(function* () {
          const filePath = path.join(folder, name)
          const info = yield* fs.stat(filePath)
          if (info.type !== 'File') return undefined
          const text = yield* fs.readFileString(filePath)
          const { data, body } = splitFile(text)
          const frontmatter = Schema.decodeUnknownOption(frontmatterSchema)(data)
          const mtime = info.mtime._tag === 'Some' ? info.mtime.value.getTime() : 0
          return {
            stem: name.slice(0, -'.md'.length),
            path: filePath,
            text,
            mtimeMs: mtime,
            data,
            frontmatter: frontmatter._tag === 'Some' ? frontmatter.value : {},
            body,
          } satisfies ScannedFile
        }).pipe(Effect.mapError(cause => failed('transport', `cannot read ${name}`, cause))),
      { concurrency: 8 },
    )
    const scanned = files.filter(file => file !== undefined)
    yield* Effect.annotateCurrentSpan('dshx.backlog.files.count', scanned.length)
    return scanned
  })

  /** Resolves a ref or a stem written in a file to the key of the file it names. */
  const keyResolver = (files: readonly ScannedFile[]) => {
    const byRef = new Map<string, string>()
    for (const file of files) {
      byRef.set(file.stem, file.stem)
      if (file.frontmatter.ref !== undefined) byRef.set(bareRef(file.frontmatter.ref), file.stem)
    }
    return (ref: string): string | undefined => byRef.get(ref)
  }

  /** The ref a link to the file of `key` is written as: its own `ref`, else its stem. */
  const refOfKey = (files: readonly ScannedFile[], key: string): string => {
    const file = files.find(candidate => candidate.stem === key)
    return file?.frontmatter.ref === undefined ? key : bareRef(file.frontmatter.ref)
  }

  const recordsOf = (files: readonly ScannedFile[]) => {
    const keyOfRef = keyResolver(files)
    return files.map(file => toCanonical({ file, keyOfRef }))
  }

  /** The frontmatter a patch writes: what the port calls `fromCanonical`. Keys the patch does not name stay untouched. */
  const fromCanonical = (input: {
    readonly data: FrontmatterData
    readonly patch: RemotePatch
    readonly files: readonly ScannedFile[]
    readonly now: Date
  }) => {
    const patch = input.patch
    return {
      ...input.data,
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.kind !== undefined && { kind: patch.kind }),
      ...(patch.status !== undefined && { status: patch.statusLabel ?? patch.status }),
      ...(patch.priority !== undefined && { priority: patch.priority }),
      ...(patch.tags !== undefined && { tags: [...patch.tags] }),
      ...(patch.parentKey !== undefined && { parent: patch.parentKey === null ? null : refOfKey(input.files, patch.parentKey) }),
      ...(patch.relations !== undefined && { links: patch.relations.map(relation => `${relation.relation}:${refOfKey(input.files, relation.key)}`) }),
      updated: input.now.toISOString(),
    } satisfies FrontmatterData
  }

  const writeAtomically = (filePath: string, text: string) =>
    Effect.gen(function* () {
      yield* fs.makeDirectory(path.dirname(filePath), { recursive: true })
      const staged = `${filePath}.${randomUUID()}.tmp`
      yield* fs.writeFileString(staged, text)
      yield* fs.rename(staged, filePath)
    }).pipe(Effect.mapError(cause => failed('transport', `cannot write ${filePath}`, cause)))

  const recordOfKey = (folder: string, key: string) =>
    Effect.gen(function* () {
      const files = yield* scan(folder)
      const record = recordsOf(files).find(candidate => candidate.key === key)
      if (record === undefined) return yield* failed('not-found', `${key}.md`)
      return record
    })

  const push = (scope: ProviderScope & { readonly key: string; readonly patch: RemotePatch }) =>
    Effect.gen(function* () {
      const folder = yield* folderOf(scope)
      const files = yield* scan(folder)
      const file = files.find(candidate => candidate.stem === scope.key)
      if (file === undefined) return yield* failed('not-found', `${scope.key}.md`)
      const now = new Date(yield* Effect.clockWith(clock => clock.currentTimeMillis))
      const data = fromCanonical({ data: file.data, patch: scope.patch, files, now })
      yield* writeAtomically(file.path, joinFile(data, scope.patch.body ?? file.body))
      return yield* recordOfKey(folder, scope.key)
    })

  const create = (scope: ProviderScope & { readonly patch: RemotePatch }) =>
    Effect.gen(function* () {
      const folder = yield* folderOf(scope)
      const files = yield* scan(folder)
      const ref = scope.patch.localRef ?? randomUUID().slice(0, 8)
      const taken = new Set(files.map(file => file.stem))
      const base = `${ref}-${slugOf(scope.patch.title ?? 'item')}`
      const stem = taken.has(base) ? `${base}-${randomUUID().slice(0, 4)}` : base
      const now = new Date(yield* Effect.clockWith(clock => clock.currentTimeMillis))
      const data = fromCanonical({ data: { ref, created: now.toISOString() }, patch: scope.patch, files, now })
      yield* writeAtomically(path.join(folder, `${stem}.md`), joinFile(data, scope.patch.body ?? ''))
      return yield* recordOfKey(folder, stem)
    })

  const provider: BacklogProvider = {
    descriptor,
    identity: () => Effect.succeed({ account: 'local files', credentialSource: 'none', containers: [] }),
    pull: input =>
      Effect.gen(function* () {
        const folder = yield* folderOf(input)
        const records = recordsOf(yield* scan(folder))
        const open = input.openOnly
          ? records.filter(record => record.status === null || (record.status.category !== 'done' && record.status.category !== 'dropped'))
          : records
        const newest = records.reduce((latest, record) => Math.max(latest, record.updatedAt), 0)
        return { records: open, nextPage: null, checkpoint: String(newest), complete: !input.openOnly }
      }),
    fetch: scope => Effect.flatMap(folderOf(scope), folder => recordOfKey(folder, scope.key)),
    resolve: scope =>
      Effect.gen(function* () {
        const folder = yield* folderOf(scope)
        const name = path.basename(scope.reference.trim())
        return yield* recordOfKey(folder, name.endsWith('.md') ? name.slice(0, -'.md'.length) : name)
      }),
    push,
    create,
    comment: () => Effect.fail(failed('unsupported', 'comments are not written to files')),
  }
  return provider
})

export class FilesMapping {
  static readonly descriptor = descriptor
  static readonly defaultFolder = DEFAULT_FOLDER
  static readonly splitFile = splitFile
  static readonly joinFile = joinFile
}
