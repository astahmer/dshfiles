import { JjViewReads, type JjRunError } from '@dshfiles/jj-cli'
import { KeyedMutex } from '@dshfiles/dshx/effect/keyed-mutex'
import { commandAttributes } from '@dshfiles/dshx/tracing'
import { Context, Effect, FiberMap, FileSystem, Layer, Option, Path, type PlatformError, Ref, Schema } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { JjFailed, NotARepository, NotAThread, UnsafePath, WorkspaceFilesFailed } from './errors.js'
import { Executables } from './executables-promise.js'
import { JjSettings } from './jj-settings.js'
import { RepoLocks } from './repo-locks.js'
import { ThreadIntegrationModel } from './thread-integration-state.js'
import { ThreadMetadata, type RebaseMetadataEntry } from './thread-metadata.js'
import type {
  DiscardOutcome,
  LandAtOptions,
  LandOutcome,
  LandPhase,
  SecondaryDiscardResult,
  SecondaryWorkspaceStatus,
  ThreadDiscardResult,
  ThreadRevision,
  ThreadStatus,
  ThreadWorkspacesBackend,
  UntrackedEntry,
  VerifiedLandOptions,
  VerifiedLandOutcome,
} from './thread-workspace-types.js'
import type { ThreadLocation } from './thread-workspace-model.js'

/**
 * Concurrent read-only `jj` processes per repository scan. Each thread costs two of them, and the scan runs while the
 * New thread screen and the sidebar are open: 45 thread workspaces measured 2.1s at 4 and 1.0s at 8, with no gain above.
 */
const STATUS_READ_CONCURRENCY = 8

const REVISION_TEMPLATE = 'change_id ++ "\\t" ++ commit_id ++ "\\t" ++ conflict ++ "\\t" ++ description.first_line() ++ "\\n"'
const LAND_REVISION_TEMPLATE =
  'change_id.short(12) ++ "\\t" ++ commit_id ++ "\\t" ++ conflict ++ "\\t" ++ empty ++ "\\t" ++ current_working_copy ++ "\\t" ++ description.first_line() ++ "\\n"'
const MAX_CONFLICT_FILES = 50
/** How far behind the bookmark a workspace is read; the count is displayed, so an exact value past this is noise. */
const MAX_BEHIND_REVISIONS = 1_000
const MAX_DANGLING_EMPTY_REVISIONS = 500
const MAX_DETACHED_REVISIONS = 128
const MAX_PATCH_REVISIONS = 128
const MAX_PATCH_FILES = 64
const MAX_PATCH_PATHS = 128
const MAX_PATCH_PATH_BYTES = 16_384
const MAX_PATCH_TARGET_REVISIONS = 1_024
const MAX_PATCH_BODY_BYTES = 65_536
const LAND_ATTEMPTS = 3
const THREAD_WORKSPACE_NAME = /^thread-[0-9a-f]{6}$/u
const HEX_ID = /^[0-9a-f]+$/u
const OPERATION_ID = /^[0-9a-f]{12,128}$/u
const isCommitId = (value: string): boolean => value.length >= 40 && HEX_ID.test(value)
const exactBookmarkNamePattern = (bookmark: string): string => `exact:${JSON.stringify(bookmark)}`
const bookmarkRevset = (bookmark: string): string => `bookmarks(${exactBookmarkNamePattern(bookmark)})`
const isUnsupportedRevsetPath = (path: string): boolean =>
  [...path].some(character => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint < 32 || codePoint === 127)
  })
const PATCH_FINGERPRINT = `if(stringify(diff.git(3)).contains("Binary files") || stringify(diff.git(3)).contains("GIT binary patch") || stringify(diff.git(3)).len() > ${MAX_PATCH_BODY_BYTES} || diff.files().len() > ${MAX_PATCH_FILES}, "", hash(diff.git(3)))`
const PATCH_CANDIDATE_TEMPLATE = `commit_id ++ "\\t" ++ parents.len() ++ "\\t" ++ conflict ++ "\\t" ++ ${PATCH_FINGERPRINT} ++ "\\t" ++ if(diff.files().len() > ${MAX_PATCH_FILES}, "[]", json(diff.files().map(|file| file.path()))) ++ "\\n"`
const PATCH_TARGET_TEMPLATE = `commit_id ++ "\\t" ++ parents.len() ++ "\\t" ++ conflict ++ "\\t" ++ ${PATCH_FINGERPRINT} ++ "\\n"`
const PATCH_BODY_TEMPLATE = 'commit_id ++ "\\t" ++ json(stringify(diff.git(3))) ++ "\\n"'
/** Base revset → name of the unclaimed thread workspace made ahead for it. */
const decodeSpares = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String.check(Schema.isPattern(THREAD_WORKSPACE_NAME)))),
)
const decodePaths = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))
const decodeJsonString = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.String))
const decodeWorkspaceName = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.String.check(Schema.isMinLength(1))))
const decodeWorkspaceRoot = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.NullOr(Schema.String.check(Schema.isMinLength(1)))))
const commitIdSchema = Schema.String.check(Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u))

interface PatchCandidate {
  readonly commitId: string
  readonly parentCount: number
  readonly conflict: boolean
  readonly fingerprint: string
  readonly paths: readonly string[]
}

interface TargetPatch {
  readonly commitId: string
  readonly parentCount: number
  readonly conflict: boolean
  readonly fingerprint: string
}

interface PatchComparison {
  readonly equivalentCommitIds: ReadonlySet<string>
  readonly unverifiedCommitIds: ReadonlySet<string>
  readonly fingerprintsByChangeId: ReadonlyMap<string, string>
  readonly complete: boolean
}

interface ReadSnapshot {
  readonly operationId: string
  readonly bookmarkCommitId: string
}

interface WorkspaceRevisionGroups {
  readonly detached: readonly ThreadRevision[]
  readonly represented: readonly ThreadRevision[]
}

type RebasedStateScan =
  | { readonly status: 'not-eligible' }
  | { readonly status: 'bookmark-moved'; readonly snapshot: ReadSnapshot }
  | {
      readonly status: 'ready'
      readonly snapshot: ReadSnapshot
      readonly revisions: readonly ThreadRevision[]
      readonly comparison: PatchComparison
      readonly detached: readonly ThreadRevision[]
      readonly workingCopyEmpty: boolean
      readonly workingCopyRevisionId: string
    }

const jjFailed = (detail: string) => new JjFailed({ detail })

const commitIdRevset = (commitId: string): Effect.Effect<string, JjFailed> =>
  isCommitId(commitId)
    ? Effect.succeed(`commit_id(${JSON.stringify(commitId)})`)
    : Effect.fail(jjFailed('JJ returned an invalid commit ID; refusing revision selection.'))

/** Only ever called with ids `isCommitId` already accepted. */
const knownCommitRevset = (commitId: string): string => `commit_id(${JSON.stringify(commitId)})`

const lines = (stdout: string): readonly string[] => stdout.split('\n').filter(line => line.length > 0)

const parseRevisions = (stdout: string): Effect.Effect<readonly ThreadRevision[], JjFailed> => {
  const revisions: ThreadRevision[] = []
  for (const line of lines(stdout)) {
    const [changeId = '', commitId = '', conflict = '', ...description] = line.split('\t')
    if (changeId.length === 0 || !isCommitId(commitId) || (conflict !== 'true' && conflict !== 'false'))
      return Effect.fail(jjFailed('JJ returned incomplete revision metadata; refusing to continue.'))
    revisions.push({ changeId, commitId, conflict: conflict === 'true', description: description.join('\t').trim() })
  }
  return Effect.succeed(revisions)
}

interface LandRevision {
  readonly revision: ThreadRevision
  readonly empty: boolean
  readonly currentWorkingCopy: boolean
}

const isFlag = (value: string): boolean => value === 'true' || value === 'false'

const parseLandRevisions = (stdout: string): Effect.Effect<readonly LandRevision[], JjFailed> => {
  const revisions: LandRevision[] = []
  for (const line of lines(stdout)) {
    const [changeId = '', commitId = '', conflict = '', empty = '', currentWorkingCopy = '', ...description] = line.split('\t')
    if (changeId.length === 0 || !isCommitId(commitId) || !isFlag(conflict) || !isFlag(empty) || !isFlag(currentWorkingCopy))
      return Effect.fail(jjFailed('JJ returned incomplete landing metadata; refusing to continue.'))
    revisions.push({
      revision: { changeId, commitId, conflict: conflict === 'true', description: description.join('\t').trim() },
      empty: empty === 'true',
      currentWorkingCopy: currentWorkingCopy === 'true',
    })
  }
  return Effect.succeed(revisions)
}

const parseCount = (text: string): number | undefined => {
  const value = Number(text)
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

const parsePatchCandidateRecords = (stdout: string): readonly PatchCandidate[] | undefined => {
  const records: PatchCandidate[] = []
  for (const line of lines(stdout)) {
    const [commitId = '', parentCountText = '', conflictText = '', fingerprint = '', pathsText = '', ...extra] = line.split('\t')
    const paths = decodePaths(pathsText)
    const parentCount = parseCount(parentCountText)
    if (extra.length > 0 || !isCommitId(commitId) || parentCount === undefined || !isFlag(conflictText) || Option.isNone(paths)) return undefined
    records.push({ commitId, parentCount, conflict: conflictText === 'true', fingerprint, paths: paths.value })
  }
  return records
}

const parseTargetPatchRecords = (stdout: string): readonly TargetPatch[] | undefined => {
  const records: TargetPatch[] = []
  for (const line of lines(stdout)) {
    const [commitId = '', parentCountText = '', conflictText = '', fingerprint = '', ...extra] = line.split('\t')
    const parentCount = parseCount(parentCountText)
    if (extra.length > 0 || !isCommitId(commitId) || parentCount === undefined || !isFlag(conflictText)) return undefined
    records.push({ commitId, parentCount, conflict: conflictText === 'true', fingerprint })
  }
  return records
}

const parsePatchBodies = (stdout: string): ReadonlyMap<string, string> | undefined => {
  const bodies = new Map<string, string>()
  for (const line of lines(stdout)) {
    const separator = line.indexOf('\t')
    if (separator < 1) return undefined
    const commitId = line.slice(0, separator)
    const body = decodeJsonString(line.slice(separator + 1))
    if (!isCommitId(commitId) || bodies.has(commitId) || Option.isNone(body)) return undefined
    bodies.set(commitId, body.value)
  }
  return bodies
}

const patchFingerprintsMatch = (expected: PatchComparison, actual: PatchComparison): boolean => {
  if (!expected.complete || !actual.complete || expected.fingerprintsByChangeId.size !== actual.fingerprintsByChangeId.size) return false
  for (const [changeId, fingerprint] of expected.fingerprintsByChangeId) {
    if (actual.fingerprintsByChangeId.get(changeId) !== fingerprint) return false
  }
  return true
}

const workMetadataMatches = (expected: readonly ThreadRevision[], actual: readonly ThreadRevision[]): boolean => {
  if (expected.length !== actual.length) return false
  const actualByChangeId = new Map(actual.map(revision => [revision.changeId, revision.description]))
  return expected.every(revision => actualByChangeId.get(revision.changeId) === revision.description)
}

const patchGuardOutcome = (
  revisions: readonly ThreadRevision[],
  comparison: PatchComparison,
):
  | { readonly status: 'already-integrated'; readonly revisions: readonly ThreadRevision[] }
  | { readonly status: 'patch-equivalent-work'; readonly revisions: readonly ThreadRevision[] }
  | { readonly status: 'patch-equivalence-unavailable'; readonly revisions: readonly ThreadRevision[] }
  | undefined => {
  if (!comparison.complete) {
    const unverified = revisions.filter(revision => comparison.unverifiedCommitIds.has(revision.commitId))
    return { status: 'patch-equivalence-unavailable', revisions: unverified.length > 0 ? unverified : revisions }
  }
  const represented = revisions.filter(revision => comparison.equivalentCommitIds.has(revision.commitId))
  if (represented.length === 0) return undefined
  return represented.length === revisions.length
    ? { status: 'already-integrated', revisions: represented }
    : { status: 'patch-equivalent-work', revisions: represented }
}

const withRebaseMetadata = (status: ThreadStatus, entry: RebaseMetadataEntry | undefined): ThreadStatus => {
  if (entry === undefined) return status
  const statusWithTimestamp = { ...status, rebasedAt: entry.at, integrations: ThreadMetadata.integrationHistory(entry) }
  if (entry.tipChangeId === undefined) return statusWithTimestamp
  return { ...statusWithTimestamp, rebasedTipChangeId: entry.tipChangeId }
}

const conflictFiles = (stdout: string): readonly string[] =>
  stdout.split('\n').flatMap(line => {
    const file = line.trim().split(/\s{2,}/)[0]
    return file !== undefined && file.length > 0 ? [file] : []
  })

const jjRunFailed =
  (args: readonly string[]) =>
  (error: JjRunError): JjFailed => {
    if (error._tag === 'JjOutputTruncated')
      return new JjFailed({ detail: 'JJ output exceeded the safe size limit; refusing incomplete repository data.', cause: error })
    if (error._tag === 'JjTimedOut') return new JjFailed({ detail: `jj ${args.join(' ').slice(0, 120)}: ${error.message}`, cause: error })
    return new JjFailed({ detail: error.message, cause: error })
  }

const make = Effect.gen(function* () {
  const viewReads = yield* JjViewReads
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const locks = yield* RepoLocks
  const settings = yield* JjSettings
  const metadata = yield* ThreadMetadata
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const executables = yield* Executables
  const spareWrites = yield* KeyedMutex.make<string>()
  const warming = yield* FiberMap.make<string>()
  // A spare exists in `jj workspace list` before its record is written; until then it is still not a thread.
  const sparesBeingAdded = yield* Ref.make<ReadonlySet<string>>(new Set())

  const bookmark = Effect.map(settings.get, current => current.bookmark)

  const threadsDirectory = metadata.threadsDirectory

  const exists = (target: string) => fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false))
  const filesFailed = (detail: string) => (cause: PlatformError.PlatformError) => new WorkspaceFilesFailed({ detail, cause })

  const run = (args: readonly string[], cwd: string) => viewReads.read({ args, cwd }).pipe(Effect.mapError(jjRunFailed(args)))

  const jj = (args: readonly string[], cwd: string): Effect.Effect<string, JjFailed> =>
    Effect.flatMap(run(args, cwd), output =>
      output.exitCode === 0
        ? Effect.succeed(output.stdout)
        : Effect.fail(jjFailed(`jj ${args.join(' ').slice(0, 120)}: ${output.stderr.trim().slice(0, 400)}`)),
    )

  /** `<root>/.jj/repo` is the store in the owning checkout and a pointer file in every other workspace. */
  const storeRootOf = Effect.fnUntraced(function* (workspaceRoot: string) {
    const marker = path.join(workspaceRoot, '.jj', 'repo')
    const info = yield* fileSystem.stat(marker).pipe(Effect.option)
    if (Option.isNone(info)) return undefined
    if (info.value.type === 'Directory') return workspaceRoot
    const pointer = yield* fileSystem.readFileString(marker).pipe(Effect.mapError(filesFailed(`Could not read the jj store pointer of ${workspaceRoot}.`)))
    return path.dirname(path.dirname(path.resolve(path.dirname(marker), pointer.trim())))
  })

  const changeIdOf = Effect.fnUntraced(function* (revision: string, cwd: string) {
    const changeId = (yield* jj(['log', '--no-graph', '-r', revision, '-T', 'change_id'], cwd)).trim()
    if (changeId.length === 0) return yield* jjFailed('Could not resolve the persistent JJ change ID.')
    return changeId
  })

  const changeIdForCommit = (commitId: string, cwd: string) => Effect.flatMap(commitIdRevset(commitId), revset => changeIdOf(revset, cwd))

  const revisions = (revset: string, cwd: string, options: { readonly observe?: boolean; readonly maxRevisions?: number } = {}) =>
    jj(
      [
        ...(options.observe === true ? ['--ignore-working-copy'] : []),
        'log',
        '--no-graph',
        ...(options.maxRevisions === undefined ? [] : ['-n', String(options.maxRevisions)]),
        '-r',
        revset,
        '-T',
        REVISION_TEMPLATE,
      ],
      cwd,
    ).pipe(Effect.flatMap(parseRevisions))

  const readAtOperation = (args: readonly string[], cwd: string, operationId: string) => jj(['--at-operation', operationId, ...args], cwd)

  const revisionsAtOperation = (revset: string, cwd: string, operationId: string, maxRevisions?: number) =>
    readAtOperation(
      ['log', '--no-graph', ...(maxRevisions === undefined ? [] : ['-n', String(maxRevisions)]), '-r', revset, '-T', REVISION_TEMPLATE],
      cwd,
      operationId,
    ).pipe(Effect.flatMap(parseRevisions))

  const readSnapshot = Effect.fnUntraced(function* (repoRoot: string, target: string) {
    const operationOutput = yield* jj(['--ignore-working-copy', 'op', 'log', '-n', '1', '--no-graph', '-T', 'self.id() ++ "\\n"'], repoRoot)
    const [operationId, ...extraOperations] = lines(operationOutput)
    if (operationId === undefined || extraOperations.length > 0 || !HEX_ID.test(operationId))
      return yield* jjFailed('Could not pin one JJ operation for the safe integration scan.')
    const bookmarkOutput = yield* readAtOperation(['log', '--no-graph', '-r', bookmarkRevset(target), '-T', 'commit_id ++ "\\n"'], repoRoot, operationId)
    const [bookmarkCommitId, ...extraBookmarkCommits] = lines(bookmarkOutput)
    if (bookmarkCommitId === undefined || extraBookmarkCommits.length > 0 || !isCommitId(bookmarkCommitId))
      return yield* jjFailed('Could not resolve one exact target bookmark; automatic integration is paused.')
    return { operationId, bookmarkCommitId } satisfies ReadSnapshot
  })

  const bookmarkTargetDescendsFrom = Effect.fnUntraced(function* (input: {
    readonly repoRoot: string
    readonly operationId: string
    readonly expectedCommitId: string
    readonly currentCommitId: string
  }) {
    if (input.expectedCommitId === input.currentCommitId) return true
    const [expectedRevision] = yield* revisionsAtOperation(
      `${yield* commitIdRevset(input.expectedCommitId)} & ::${yield* commitIdRevset(input.currentCommitId)}`,
      input.repoRoot,
      input.operationId,
      1,
    )
    return expectedRevision?.commitId === input.expectedCommitId
  })

  const comparePatchEquivalence = Effect.fnUntraced(function* (input: {
    readonly candidates: readonly ThreadRevision[]
    readonly repoRoot: string
    readonly snapshot: ReadSnapshot
  }) {
    const candidates = input.candidates
    const allCandidateIds = new Set(candidates.map(revision => revision.commitId))
    const incomplete: PatchComparison = {
      equivalentCommitIds: new Set(),
      unverifiedCommitIds: allCandidateIds,
      fingerprintsByChangeId: new Map(),
      complete: false,
    }
    if (candidates.length === 0)
      return { equivalentCommitIds: new Set(), unverifiedCommitIds: new Set(), fingerprintsByChangeId: new Map(), complete: true } satisfies PatchComparison
    const changeIdByCommitId = new Map(candidates.map(revision => [revision.commitId, revision.changeId]))
    if (
      candidates.length > MAX_PATCH_REVISIONS ||
      changeIdByCommitId.size !== candidates.length ||
      new Set(changeIdByCommitId.values()).size !== candidates.length ||
      [...allCandidateIds].some(commitId => !isCommitId(commitId))
    )
      return incomplete

    const candidateRevset = [...allCandidateIds].map(knownCommitRevset).join(' | ')
    const candidateOutput = yield* readAtOperation(
      ['log', '--no-graph', '-r', candidateRevset, '-T', PATCH_CANDIDATE_TEMPLATE],
      input.repoRoot,
      input.snapshot.operationId,
    )
    const candidateRecords = parsePatchCandidateRecords(candidateOutput)
    if (candidateRecords === undefined || candidateRecords.length !== allCandidateIds.size) return incomplete
    const candidateById = new Map(candidateRecords.map(candidate => [candidate.commitId, candidate]))
    const unverifiedCommitIds = new Set<string>()
    const candidatesToCompare: PatchCandidate[] = []
    for (const commitId of allCandidateIds) {
      const candidate = candidateById.get(commitId)
      if (candidate === undefined || candidate.parentCount !== 1 || candidate.conflict || candidate.fingerprint.length === 0 || candidate.paths.length === 0) {
        unverifiedCommitIds.add(commitId)
        continue
      }
      candidatesToCompare.push(candidate)
    }
    const fingerprintsByChangeId = new Map<string, string>()
    for (const candidate of candidatesToCompare) {
      const changeId = changeIdByCommitId.get(candidate.commitId)
      if (changeId === undefined || fingerprintsByChangeId.has(changeId)) return incomplete
      fingerprintsByChangeId.set(changeId, candidate.fingerprint)
    }
    if (candidatesToCompare.length === 0)
      return { equivalentCommitIds: new Set(), unverifiedCommitIds, fingerprintsByChangeId, complete: unverifiedCommitIds.size === 0 } satisfies PatchComparison

    const paths = new Set<string>()
    let pathBytes = 0
    for (const candidate of candidatesToCompare) {
      for (const candidatePath of candidate.paths) {
        if (candidatePath.length === 0 || isUnsupportedRevsetPath(candidatePath)) return incomplete
        if (paths.has(candidatePath)) continue
        pathBytes += new TextEncoder().encode(candidatePath).byteLength
        paths.add(candidatePath)
        if (paths.size > MAX_PATCH_PATHS || pathBytes > MAX_PATCH_PATH_BYTES) return incomplete
      }
    }

    const fileFilters = [...paths].map(candidatePath => `files(file:${JSON.stringify(candidatePath)})`)
    const targetRevset = `(::${yield* commitIdRevset(input.snapshot.bookmarkCommitId)}) & (${fileFilters.join(' | ')})`
    const targetOutput = yield* readAtOperation(
      ['log', '--no-graph', '-n', String(MAX_PATCH_TARGET_REVISIONS + 1), '-r', targetRevset, '-T', PATCH_TARGET_TEMPLATE],
      input.repoRoot,
      input.snapshot.operationId,
    )
    const targetRecords = parseTargetPatchRecords(targetOutput)
    if (targetRecords === undefined || targetRecords.length > MAX_PATCH_TARGET_REVISIONS) return incomplete
    if (targetRecords.some(target => target.parentCount !== 1 || target.conflict || target.fingerprint.length === 0)) return incomplete

    const targetsByFingerprint = new Map<string, TargetPatch[]>()
    for (const target of targetRecords) {
      const matches = targetsByFingerprint.get(target.fingerprint) ?? []
      matches.push(target)
      targetsByFingerprint.set(target.fingerprint, matches)
    }
    const equivalentCommitIds = new Set<string>()
    // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- each candidate stops at its first matching target body; most candidates have none.
    for (const candidate of candidatesToCompare) {
      for (const target of targetsByFingerprint.get(candidate.fingerprint) ?? []) {
        const bodyOutput = yield* readAtOperation(
          ['log', '--no-graph', '-r', `${knownCommitRevset(candidate.commitId)} | ${knownCommitRevset(target.commitId)}`, '-T', PATCH_BODY_TEMPLATE],
          input.repoRoot,
          input.snapshot.operationId,
        )
        const bodies = parsePatchBodies(bodyOutput)
        const candidateBody = bodies?.get(candidate.commitId)
        const targetBody = bodies?.get(target.commitId)
        if (candidateBody === undefined || targetBody === undefined) {
          unverifiedCommitIds.add(candidate.commitId)
          break
        }
        if (candidateBody === targetBody) {
          equivalentCommitIds.add(candidate.commitId)
          break
        }
      }
    }
    return { equivalentCommitIds, unverifiedCommitIds, fingerprintsByChangeId, complete: unverifiedCommitIds.size === 0 } satisfies PatchComparison
  })

  const detachedRevisionsByWorkspace = Effect.fnUntraced(function* (repoRoot: string, snapshot: ReadSnapshot) {
    const detachedRevisions = yield* revisionsAtOperation(
      `((all() ~ ::${yield* commitIdRevset(snapshot.bookmarkCommitId)}) ~ ::(working_copies())) ~ empty()`,
      repoRoot,
      snapshot.operationId,
      MAX_DETACHED_REVISIONS + 1,
    )
    if (detachedRevisions.length > MAX_DETACHED_REVISIONS)
      return yield* jjFailed('Too many detached revisions to scan safely; automatic integration is paused.')
    const patchComparison = yield* comparePatchEquivalence({ candidates: detachedRevisions, repoRoot, snapshot })
    const ownerOf = Effect.fnUntraced(function* (revision: ThreadRevision) {
      const workspaceOutput = yield* readAtOperation(
        ['evolog', '--no-graph', '-n', '1', '-r', knownCommitRevset(revision.commitId), '-T', 'self.operation().workspace_name() ++ "\\n"'],
        repoRoot,
        snapshot.operationId,
      )
      const [workspaceName, ...extraWorkspaceNames] = lines(workspaceOutput)
      if (workspaceName === undefined || extraWorkspaceNames.length > 0 || !workspaceName.endsWith('@'))
        return yield* jjFailed('Could not attribute detached JJ work to one owning workspace; automatic integration is paused.')
      const name = workspaceName.slice(0, -1)
      if (name.length === 0 || (name.startsWith('thread-') && !THREAD_WORKSPACE_NAME.test(name)))
        return yield* jjFailed('Detached JJ work has an unrecognized thread owner; automatic integration is paused.')
      return { revision, name }
    })
    const owners = yield* Effect.forEach(detachedRevisions, ownerOf, { concurrency: STATUS_READ_CONCURRENCY })
    const byWorkspace = new Map<string, { detached: ThreadRevision[]; represented: ThreadRevision[] }>()
    for (const { revision, name } of owners) {
      if (!THREAD_WORKSPACE_NAME.test(name)) continue
      const owned = byWorkspace.get(name) ?? { detached: [], represented: [] }
      if (patchComparison.equivalentCommitIds.has(revision.commitId)) owned.represented.push(revision)
      else owned.detached.push(revision)
      byWorkspace.set(name, owned)
    }
    return byWorkspace satisfies ReadonlyMap<string, WorkspaceRevisionGroups>
  })

  const locate = Effect.fn('thread workspaces locate')(function* (target: string) {
    const notARepository = new NotARepository({ detail: `${target} is not inside a jj repository.` })
    // jj cannot even start in a folder that is gone, which is the same answer for the caller.
    if (!(yield* exists(target))) return yield* notARepository
    const output = yield* run(['--ignore-working-copy', 'root'], target)
    if (output.exitCode !== 0) return yield* notARepository
    const workspaceRoot = output.stdout.trim()
    const repoRoot = (yield* storeRootOf(workspaceRoot)) ?? workspaceRoot
    const isThread = workspaceRoot !== repoRoot && path.dirname(workspaceRoot) === (yield* threadsDirectory(repoRoot))
    return { repoRoot, workspaceRoot, threadName: isThread ? path.basename(workspaceRoot) : undefined, vcs: 'jj' } satisfies ThreadLocation
  })

  const requireThread = Effect.fnUntraced(function* (target: string) {
    const location = yield* locate(target)
    if (location.threadName === undefined || !THREAD_WORKSPACE_NAME.test(location.threadName))
      return yield* new NotAThread({ detail: `${target} is not a managed thread workspace.` })
    return { ...location, threadName: location.threadName }
  })

  /** Snapshots the working copy and names the operation holding it; `restoreFiles` reads `@` back at that operation. */
  const snapshotFiles = Effect.fn('thread workspaces snapshot files')(function* (target: string) {
    const workspaceRoot = (yield* locate(target)).workspaceRoot
    yield* jj(['util', 'snapshot'], workspaceRoot)
    const operationId = (yield* jj(['--ignore-working-copy', 'op', 'log', '--no-graph', '-n', '1', '-T', 'id'], workspaceRoot)).trim()
    if (!OPERATION_ID.test(operationId)) return yield* jjFailed('Could not read the operation that recorded the working copy.')
    return operationId
  })

  /** Puts this workspace's files back to `@` as it was at an operation; history, bookmarks and other workspaces stay. */
  const restoreFiles = Effect.fn('thread workspaces restore files')(function* (target: string, operationId: string) {
    if (!OPERATION_ID.test(operationId)) return yield* jjFailed('That snapshot is not a jj operation id.')
    const location = yield* locate(target)
    return yield* locks.withRepo(location.repoRoot)(
      Effect.gen(function* () {
        const previous = yield* snapshotFiles(location.workspaceRoot)
        yield* jj(['restore', '--from', `at_operation(${operationId}, @)`, '--into', '@'], location.workspaceRoot)
        return previous
      }),
    )
  })

  const workingCopyCommitId = Effect.fn('thread workspaces working copy')(function* (target: string) {
    const commitId = (yield* jj(['log', '--no-graph', '-r', '@', '-T', 'commit_id'], target)).trim()
    if (!isCommitId(commitId)) return yield* jjFailed('Could not resolve the current working-copy revision.')
    return commitId
  })

  const targetRevset = Effect.fnUntraced(function* (repoRoot: string, target?: string) {
    const name = target ?? (yield* bookmark)
    const local = yield* revisions(bookmarkRevset(name), repoRoot, { observe: true })
    if (local.length > 0) return bookmarkRevset(name)
    const remoteRevset = `remote_bookmarks(${exactBookmarkNamePattern(name)}, remote=${exactBookmarkNamePattern('origin')})`
    const remote = yield* revisions(remoteRevset, repoRoot, { observe: true })
    const remoteCommit = remote[0]
    if (remote.length === 1 && remoteCommit !== undefined) return knownCommitRevset(remoteCommit.commitId)
    if (remote.length > 1) return remoteRevset
    return bookmarkRevset(name)
  })
  const unlandedRevset = (name: string, target: string): string => `(::${name}@ ~ ::${target}) ~ empty()`
  /**
   * Commits the bookmark has that this working copy lacks. Comparing the other way round counts the workspace's own
   * commits — including its always-present empty working copy — so a workspace that merely predates the bookmark's
   * advance looked like it held work to integrate.
   */
  const behindRevset = (workingCopy: string, target: string): string => `(::${target} ~ ::${workingCopy}) ~ empty()`

  const scanRebasedState = Effect.fnUntraced(function* (input: {
    readonly repoRoot: string
    readonly cwd: string
    readonly threadName: string
    readonly bookmark: string
    readonly expectedBookmarkCommitId: string
    readonly authorize: Effect.Effect<boolean>
  }) {
    if (!(yield* input.authorize)) return { status: 'not-eligible' } satisfies RebasedStateScan
    yield* jj(['workspace', 'update-stale'], input.cwd)
    const workingCopyRevisionId = yield* workingCopyCommitId(input.cwd)
    const snapshot = yield* readSnapshot(input.repoRoot, input.bookmark)
    if (snapshot.bookmarkCommitId !== input.expectedBookmarkCommitId) return { status: 'bookmark-moved', snapshot } satisfies RebasedStateScan
    const unlanded = `(::${input.threadName}@ ~ ::${yield* commitIdRevset(snapshot.bookmarkCommitId)}) ~ empty()`
    const [revisionsOnThread, detachedByWorkspace, emptyRevision] = yield* Effect.all(
      [
        revisionsAtOperation(unlanded, input.repoRoot, snapshot.operationId),
        detachedRevisionsByWorkspace(input.repoRoot, snapshot),
        revisionsAtOperation('@ & empty()', input.cwd, snapshot.operationId, 1),
      ],
      { concurrency: 'unbounded' },
    )
    const comparison = yield* comparePatchEquivalence({ candidates: revisionsOnThread, repoRoot: input.repoRoot, snapshot })
    return {
      status: 'ready',
      snapshot,
      revisions: revisionsOnThread,
      comparison,
      detached: detachedByWorkspace.get(input.threadName)?.detached ?? [],
      workingCopyEmpty: emptyRevision.length > 0,
      workingCopyRevisionId,
    } satisfies RebasedStateScan
  })

  const readRebaseMetadata = metadata.read
  const writeAtomically = metadata.writeAtomically
  const writeRebaseMetadata = metadata.record

  const sparesFile = (repoRoot: string) => Effect.map(threadsDirectory(repoRoot), directory => path.join(directory, '.dshfiles-spare-workspaces.json'))

  const readSpares = Effect.fnUntraced(function* (repoRoot: string) {
    const text = yield* fileSystem.readFileString(yield* sparesFile(repoRoot)).pipe(Effect.orElseSucceed(() => '{}'))
    return Option.getOrElse(decodeSpares(text), (): Readonly<Record<string, string>> => ({}))
  })

  const updateSpares = (repoRoot: string, change: (spares: Readonly<Record<string, string>>) => Readonly<Record<string, string>>) =>
    spareWrites.withLock(repoRoot)(
      Effect.gen(function* () {
        const target = yield* sparesFile(repoRoot)
        yield* writeAtomically(target, JSON.stringify(change(yield* readSpares(repoRoot))))
      }),
    )

  const usableSpare = Effect.fnUntraced(function* (repoRoot: string, name: string | undefined) {
    if (name === undefined) return undefined
    return (yield* exists(path.join(yield* threadsDirectory(repoRoot), name, '.jj'))) ? name : undefined
  })

  const list = Effect.fn('thread workspaces list')(function* (repoRoot: string) {
    const directory = yield* threadsDirectory(repoRoot)
    const listedNames = (yield* jj(['--ignore-working-copy', 'workspace', 'list', '-T', 'name ++ "\\n"'], repoRoot)).split('\n')
    // Snapshot before reading the record: a spare that leaves the set has already written it.
    const inFlightSpares = yield* Ref.get(sparesBeingAdded)
    const spares = new Set(Object.values(yield* readSpares(repoRoot)))
    const names = listedNames.filter(name => name.length > 0 && !spares.has(name) && !inFlightSpares.has(name))
    const rebaseMetadata = yield* readRebaseMetadata(repoRoot)
    const target = yield* targetRevset(repoRoot)
    const statuses = yield* Effect.forEach(
      names,
      name =>
        Effect.gen(function* () {
          const workspacePath = path.join(directory, name)
          const present = yield* exists(path.join(workspacePath, '.jj'))
          if (!present && !name.startsWith('thread-')) return undefined
          const unlanded = yield* revisions(unlandedRevset(name, target), repoRoot, { observe: true })
          const behind = yield* revisions(behindRevset(`${name}@`, target), repoRoot, { observe: true, maxRevisions: MAX_BEHIND_REVISIONS + 1 })
          return withRebaseMetadata(
            {
              name,
              path: workspacePath,
              repoRoot,
              missing: !present,
              unlanded,
              behind: behind.length > 0,
              behindCount: Math.min(behind.length, MAX_BEHIND_REVISIONS),
            },
            rebaseMetadata[name],
          )
        }),
      { concurrency: STATUS_READ_CONCURRENCY },
    )
    return statuses.filter((status): status is ThreadStatus => status !== undefined)
  })

  const reviewHistory = Effect.fn('thread workspaces review history')(function* (input: { readonly repoRoot: string; readonly name: string }) {
    if (!THREAD_WORKSPACE_NAME.test(input.name) || !path.isAbsolute(input.repoRoot))
      return yield* new NotAThread({ detail: 'The path is not a managed thread workspace location.' })
    const repoRoot = path.resolve(input.repoRoot)
    const root = yield* jj(['--ignore-working-copy', 'root'], repoRoot).pipe(Effect.orElseSucceed(() => ''))
    if (root.trim() !== repoRoot) return yield* new NotARepository({ detail: 'The owning project is no longer a JJ repository.' })
    const records = yield* readRebaseMetadata(repoRoot)
    return { repoRoot, name: input.name, integrations: [...ThreadMetadata.integrationHistory(records[input.name])] }
  })

  const status = Effect.fn('thread workspaces status')(function* (repoRoot: string, name: string) {
    const workspacePath = path.join(yield* threadsDirectory(repoRoot), name)
    const target = yield* targetRevset(workspacePath)
    const [unlanded, behind, rebaseMetadata] = yield* Effect.all(
      [
        revisions(`(::@ ~ ::${target}) ~ empty()`, workspacePath, { observe: true }),
        revisions(behindRevset('@', target), workspacePath, { observe: true, maxRevisions: MAX_BEHIND_REVISIONS + 1 }),
        readRebaseMetadata(repoRoot),
      ],
      { concurrency: 'unbounded' },
    )
    return withRebaseMetadata(
      {
        name,
        path: workspacePath,
        repoRoot,
        missing: !(yield* exists(path.join(workspacePath, '.jj'))),
        unlanded,
        behind: behind.length > 0,
        behindCount: Math.min(behind.length, MAX_BEHIND_REVISIONS),
      },
      rebaseMetadata[name],
    )
  })

  /**
   * jj 0.46 backs each workspace of a colocated repository with a git worktree. A workspace whose folder was deleted
   * stays registered with git and blocks a new `jj workspace add` at that path, and a moved folder is lost to git
   * until repaired. Both fixes are best effort: a non-colocated repository has nothing to fix.
   */
  const gitWorktrees = (repoRoot: string, args: readonly string[]) =>
    Effect.gen(function* () {
      if (!(yield* exists(path.join(repoRoot, '.git')))) return
      const git = yield* executables.resolve('git')
      const exitCode = yield* spawner
        .spawn(ChildProcess.make(git, ['-C', repoRoot, 'worktree', ...args], { cwd: repoRoot, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }))
        .pipe(
          Effect.flatMap(handle => handle.exitCode),
          Effect.scoped,
        )
      yield* Effect.annotateCurrentSpan({ 'process.exit.code': exitCode })
    }).pipe(
      Effect.withSpan('git worktree', {
        kind: 'client',
        attributes: commandAttributes({ executable: 'git', args: ['-C', repoRoot, 'worktree', ...args], valueFlags: ['-C'] }),
      }),
      Effect.ignore,
    )

  /**
   * One checked-out, unclaimed workspace per repository and base, made ahead of the first send that isolates a thread:
   * `jj workspace add` checks the whole tree out (1.6–2.8 s on a 2 700-file repo with 70 workspaces), while moving a
   * spare onto the base as it is now takes 0.15–0.35 s. The record survives a Host restart; a spare deleted from disk
   * is ignored.
   */
  const warmSpare = Effect.fnUntraced(function* (repoRoot: string, target: string) {
    if ((yield* usableSpare(repoRoot, (yield* readSpares(repoRoot))[target])) !== undefined) return
    const name = `thread-${yield* ThreadMetadata.randomHex(3)}`
    const directory = yield* threadsDirectory(repoRoot)
    yield* Ref.update(sparesBeingAdded, current => new Set([...current, name]))
    yield* Effect.gen(function* () {
      yield* fileSystem.makeDirectory(directory, { recursive: true })
      yield* jj(['workspace', 'add', path.join(directory, name), '--name', name, '-r', target], repoRoot)
      yield* updateSpares(repoRoot, spares => ({ ...spares, [target]: name }))
    }).pipe(Effect.ensuring(Ref.update(sparesBeingAdded, current => new Set([...current].filter(entry => entry !== name)))))
  })

  /** Make the spare for `base` in the background; outside the repo lock, since adding a workspace moves no bookmark. */
  const prewarm = Effect.fn('thread workspaces prewarm')(function* (repoRoot: string, base?: string) {
    const target = base ?? (yield* bookmark)
    yield* FiberMap.run(warming, `${repoRoot}\0${target}`, warmSpare(repoRoot, target).pipe(Effect.ignore), { onlyIfMissing: true })
  })

  /** Neither a folder nor a jj workspace may already carry the name: reusing either would put two threads in one checkout. */
  const isFreeThreadName = Effect.fnUntraced(function* (repoRoot: string, name: string) {
    if (yield* exists(path.join(yield* threadsDirectory(repoRoot), name))) return false
    const names = yield* jj(['--ignore-working-copy', 'workspace', 'list', '-T', 'name ++ "\\n"'], repoRoot)
    return !names.split('\n').includes(name)
  })

  /** The client names a thread workspace before it exists; a name taken meanwhile silently yields a fresh one. */
  const freeThreadName = (repoRoot: string, requestedName: string | undefined): Effect.Effect<string, JjFailed> =>
    Effect.gen(function* () {
      if (requestedName !== undefined && (yield* isFreeThreadName(repoRoot, requestedName))) return requestedName
      const name = `thread-${yield* ThreadMetadata.randomHex(3)}`
      return (yield* isFreeThreadName(repoRoot, name)) ? name : yield* freeThreadName(repoRoot, undefined)
    })

  const provision = Effect.fn('thread workspaces provision')(function* (repoRoot: string, base?: string, requestedName?: string) {
    return yield* locks.withRepo(repoRoot)(
      Effect.gen(function* () {
        const target = base ?? (yield* bookmark)
        const directory = yield* threadsDirectory(repoRoot)
        const spare = yield* usableSpare(repoRoot, (yield* readSpares(repoRoot))[target])
        if (spare !== undefined) {
          yield* updateSpares(repoRoot, ({ [target]: _claimed, ...rest }) => rest)
          // The thread keeps the name the client already shows: the spare's folder moves within the same directory, so
          // its relative pointer to the store still holds, and jj renames the workspace to match.
          const name = requestedName !== undefined && (yield* isFreeThreadName(repoRoot, requestedName)) ? requestedName : spare
          const workspacePath = path.join(directory, name)
          if (name !== spare) {
            yield* fileSystem.rename(path.join(directory, spare), workspacePath)
            yield* gitWorktrees(repoRoot, ['repair', workspacePath])
            yield* jj(['workspace', 'rename', name], workspacePath)
          }
          yield* jj(['new', target], workspacePath)
          if (!isCommitId(target)) yield* prewarm(repoRoot, target)
          return { name, path: workspacePath }
        }
        const name = yield* freeThreadName(repoRoot, requestedName)
        const workspacePath = path.join(directory, name)
        yield* fileSystem.makeDirectory(directory, { recursive: true })
        // Plain `workspace add`: with --ignore-working-copy jj registers the workspace but never checks its files out.
        yield* jj(['workspace', 'add', workspacePath, '--name', name, '-r', target], repoRoot)
        // A spare waits for the next thread from a bookmark; a thread branched from one exact revision gets none.
        if (!isCommitId(target)) yield* prewarm(repoRoot, target)
        return { name, path: workspacePath }
      }).pipe(
        Effect.mapError(error =>
          error._tag === 'PlatformError' ? new WorkspaceFilesFailed({ detail: `Could not create a thread workspace in ${repoRoot}.`, cause: error }) : error,
        ),
      ),
    )
  })

  /** The revision a thread branched from this workspace starts on: its working copy when it holds work, else its parent. */
  const branchPoint = Effect.fn('thread workspaces branch point')(function* (workspaceRoot: string) {
    const [commitId] = (yield* jj(['log', '--no-graph', '-r', 'coalesce(@ ~ empty(), @-)', '-T', 'commit_id ++ "\\n"'], workspaceRoot))
      .split('\n')
      .filter(isCommitId)
    if (commitId === undefined) return yield* jjFailed('Could not resolve the revision to branch the new thread from.')
    return commitId
  })

  /**
   * Checks a thread workspace out again after its folder was deleted, so a Session pinned to it can still run.
   * A workspace JJ still knows keeps its working-copy revision; a forgotten one starts again from the bookmark.
   */
  const restore = Effect.fn('thread workspaces restore')(function* (repoRoot: string, workspacePath: string) {
    return yield* locks.withRepo(repoRoot)(
      Effect.gen(function* () {
        if (yield* exists(path.join(workspacePath, '.jj'))) return
        const name = path.basename(workspacePath)
        if (!THREAD_WORKSPACE_NAME.test(name) || path.dirname(workspacePath) !== (yield* threadsDirectory(repoRoot)))
          return yield* new NotAThread({ detail: `${workspacePath} is not a managed thread workspace.` })
        const [workingCopy] = lines(
          yield* jj(
            [
              '--ignore-working-copy',
              'log',
              '--no-graph',
              '-r',
              `present(${name}@)`,
              '-T',
              'commit_id ++ "\\t" ++ parents.map(|p| p.commit_id()).join(",") ++ "\\t" ++ if(empty && !description, "discardable", "kept") ++ "\\n"',
            ],
            repoRoot,
          ),
        ).map(line => {
          const [commitId = '', parents = '', disposition] = line.split('\t')
          return { commitId, parentIds: parents.split(',').filter(isCommitId), kept: disposition === 'kept' }
        })
        yield* fileSystem
          .makeDirectory(path.dirname(workspacePath), { recursive: true })
          .pipe(Effect.mapError(filesFailed(`Could not create ${path.dirname(workspacePath)}.`)))
        yield* gitWorktrees(repoRoot, ['prune'])
        if (workingCopy === undefined) {
          yield* jj(['workspace', 'add', workspacePath, '--name', name, '-r', yield* bookmark], repoRoot)
          return
        }
        if (!isCommitId(workingCopy.commitId) || workingCopy.parentIds.length === 0)
          return yield* jjFailed(`Could not read the working copy of ${name}; refusing to restore it.`)
        yield* jj(['workspace', 'forget', name], repoRoot)
        yield* jj(
          ['workspace', 'add', workspacePath, '--name', name, ...workingCopy.parentIds.flatMap(commitId => ['-r', knownCommitRevset(commitId)])],
          repoRoot,
        )
        if (workingCopy.kept) yield* jj(['edit', knownCommitRevset(workingCopy.commitId)], workspacePath)
      }),
    )
  })

  const staleSourceMessage = 'The thread changed after its completion checks passed. Stop for Project Checks again; automatic integration did not rebase it.'
  const changedDuringScanMessage = 'The thread changed during the patch scan. Stop for Project Checks again; automatic integration did not rebase it.'
  const stale = (message: string): VerifiedLandOutcome => ({ status: 'verification-stale', message })

  const landVerified = Effect.fn('thread workspaces land verified')(function* (input: VerifiedLandOptions) {
    const cancelled = input.cancelled ?? Effect.succeed(false)
    const cancelledOutcome: VerifiedLandOutcome = { status: 'verification-cancelled' }
    if (yield* cancelled) return cancelledOutcome
    const initialThread = yield* requireThread(input.path)
    return yield* locks.withRepo(initialThread.repoRoot)(
      Effect.gen(function* () {
        if (yield* cancelled) return cancelledOutcome
        const thread = yield* requireThread(input.path)
        if (thread.repoRoot !== initialThread.repoRoot || thread.threadName !== initialThread.threadName)
          return { status: 'not-eligible' } satisfies VerifiedLandOutcome
        const ensureAuthorized = input.authorize(thread)
        if (!(yield* ensureAuthorized)) return { status: 'not-eligible' } satisfies VerifiedLandOutcome
        const repoRoot = thread.repoRoot
        const cwd = thread.workspaceRoot
        const target = input.bookmark ?? (yield* bookmark)
        const sourceRevision = yield* workingCopyCommitId(cwd)
        if (sourceRevision !== input.expectedSourceRevision) return stale(staleSourceMessage)

        const snapshot = yield* readSnapshot(repoRoot, target)
        const detachedGroup = (yield* detachedRevisionsByWorkspace(repoRoot, snapshot)).get(thread.threadName) ?? { detached: [], represented: [] }
        if (detachedGroup.detached.length > 0) return { status: 'detached-work', revisions: detachedGroup.detached } satisfies VerifiedLandOutcome
        const work = yield* revisionsAtOperation(unlandedRevsetAt(thread.threadName, snapshot.bookmarkCommitId), cwd, snapshot.operationId)
        const leftovers = yield* revisionsAtOperation(
          `((${knownCommitRevset(snapshot.bookmarkCommitId)}..@) & empty()) ~ @ ~ merges() ~ working_copies()`,
          cwd,
          snapshot.operationId,
        )
        if (work.length === 0)
          return detachedGroup.represented.length > 0
            ? ({ status: 'already-integrated', revisions: detachedGroup.represented } satisfies VerifiedLandOutcome)
            : ({ status: 'nothing-to-land' } satisfies VerifiedLandOutcome)
        const initialPatchComparison = yield* comparePatchEquivalence({ candidates: work, repoRoot, snapshot })
        const initialPatchBlock = patchGuardOutcome(work, initialPatchComparison)
        if (initialPatchBlock !== undefined) return initialPatchBlock
        const undescribed = work.filter(revision => ThreadIntegrationModel.isPlaceholderRevisionDescription(revision.description))
        if (undescribed.length > 0) return { status: 'needs-description', revisions: undescribed } satisfies VerifiedLandOutcome

        if (!(yield* ensureAuthorized)) return { status: 'not-eligible' } satisfies VerifiedLandOutcome
        if ((yield* workingCopyCommitId(cwd)) !== sourceRevision) return stale(changedDuringScanMessage)
        if (leftovers.length > 0) {
          if (!(yield* ensureAuthorized)) return { status: 'not-eligible' } satisfies VerifiedLandOutcome
          yield* jj(['abandon', ...leftovers.map(revision => knownCommitRevset(revision.commitId))], cwd)
        }

        const bookmarkMovedOutcome = Effect.fnUntraced(function* (moved: {
          readonly snapshot: ReadSnapshot
          readonly expectedCommitId: string
          readonly attempt: number
          readonly sideways: string
          readonly exhausted: string
        }) {
          const targetMovedForward = yield* bookmarkTargetDescendsFrom({
            repoRoot,
            operationId: moved.snapshot.operationId,
            expectedCommitId: moved.expectedCommitId,
            currentCommitId: moved.snapshot.bookmarkCommitId,
          })
          if (!targetMovedForward) return stale(moved.sideways)
          if (moved.attempt >= LAND_ATTEMPTS) return stale(moved.exhausted)
          return undefined
        })

        for (let attempt = 1; ; attempt++) {
          if (yield* cancelled) return cancelledOutcome
          if (!(yield* ensureAuthorized)) return { status: 'not-eligible' } satisfies VerifiedLandOutcome
          const attemptSourceRevision = yield* workingCopyCommitId(cwd)
          if (attempt === 1 && attemptSourceRevision !== input.expectedSourceRevision) return stale(staleSourceMessage)
          const attemptSnapshot = yield* readSnapshot(repoRoot, target)
          const attemptWorkspaceRevision = yield* revisionsAtOperation('@', cwd, attemptSnapshot.operationId)
          if (attemptWorkspaceRevision[0]?.commitId !== attemptSourceRevision) return stale(changedDuringScanMessage)
          const attemptDetachedGroup = (yield* detachedRevisionsByWorkspace(repoRoot, attemptSnapshot)).get(thread.threadName) ?? {
            detached: [],
            represented: [],
          }
          if (attemptDetachedGroup.detached.length > 0)
            return { status: 'detached-work', revisions: attemptDetachedGroup.detached } satisfies VerifiedLandOutcome
          const attemptWork = yield* revisionsAtOperation(
            unlandedRevsetAt(thread.threadName, attemptSnapshot.bookmarkCommitId),
            cwd,
            attemptSnapshot.operationId,
          )
          const patchComparison = yield* comparePatchEquivalence({ candidates: attemptWork, repoRoot, snapshot: attemptSnapshot })
          if (!workMetadataMatches(work, attemptWork) || !patchFingerprintsMatch(initialPatchComparison, patchComparison))
            return stale('The thread work changed after its initial scan. Review the current work and run Project Checks again.')
          if (attemptWork.length === 0)
            return attemptDetachedGroup.represented.length > 0
              ? ({ status: 'already-integrated', revisions: attemptDetachedGroup.represented } satisfies VerifiedLandOutcome)
              : ({ status: 'nothing-to-land' } satisfies VerifiedLandOutcome)
          const patchBlock = patchGuardOutcome(attemptWork, patchComparison)
          if (patchBlock !== undefined) return patchBlock
          const attemptUndescribed = attemptWork.filter(revision => ThreadIntegrationModel.isPlaceholderRevisionDescription(revision.description))
          if (attemptUndescribed.length > 0) return { status: 'needs-description', revisions: attemptUndescribed } satisfies VerifiedLandOutcome
          if (!(yield* ensureAuthorized)) return { status: 'not-eligible' } satisfies VerifiedLandOutcome
          if ((yield* workingCopyCommitId(cwd)) !== attemptSourceRevision) return stale(changedDuringScanMessage)
          const latestSnapshot = yield* readSnapshot(repoRoot, target)
          if (latestSnapshot.bookmarkCommitId !== attemptSnapshot.bookmarkCommitId) {
            const blocked = yield* bookmarkMovedOutcome({
              snapshot: latestSnapshot,
              expectedCommitId: attemptSnapshot.bookmarkCommitId,
              attempt,
              sideways: 'The target bookmark moved backwards or sideways during scanning; review it before retrying.',
              exhausted: 'The repository changed during the patch scan. Retry integration after the current changes settle.',
            })
            if (blocked !== undefined) return blocked
            continue
          }
          if (latestSnapshot.operationId !== attemptSnapshot.operationId) {
            if (attempt >= LAND_ATTEMPTS) return stale('The repository changed during the patch scan. Retry integration after the current changes settle.')
            continue
          }
          if (!(yield* ensureAuthorized)) return { status: 'not-eligible' } satisfies VerifiedLandOutcome
          yield* jj(
            [
              '--at-operation',
              attemptSnapshot.operationId,
              'rebase',
              '-b',
              knownCommitRevset(attemptSourceRevision),
              '-d',
              knownCommitRevset(attemptSnapshot.bookmarkCommitId),
            ],
            cwd,
          )
          if (yield* cancelled) return cancelledOutcome
          const scanAfter = scanRebasedState({
            repoRoot,
            cwd,
            threadName: thread.threadName,
            bookmark: target,
            expectedBookmarkCommitId: attemptSnapshot.bookmarkCommitId,
            authorize: ensureAuthorized,
          })
          const afterRebase = yield* scanAfter
          if (afterRebase.status === 'not-eligible') return { status: 'not-eligible' } satisfies VerifiedLandOutcome
          if (afterRebase.status === 'bookmark-moved') {
            const blocked = yield* bookmarkMovedOutcome({
              snapshot: afterRebase.snapshot,
              expectedCommitId: attemptSnapshot.bookmarkCommitId,
              attempt,
              sideways: 'The target bookmark moved backwards or sideways during rebase; review it before retrying.',
              exhausted: 'The bookmark changed during rebase. Retry integration after the current changes settle.',
            })
            if (blocked !== undefined) return blocked
            continue
          }
          const rebased = afterRebase.revisions
          const conflicted = rebased.filter(revision => revision.conflict)
          if (conflicted.length > 0) {
            const files = yield* conflictedFiles(conflicted, cwd)
            return { status: 'conflicted', revisions: conflicted, files } satisfies VerifiedLandOutcome
          }
          if (afterRebase.detached.length > 0) return { status: 'detached-work', revisions: afterRebase.detached } satisfies VerifiedLandOutcome
          if (!workMetadataMatches(work, rebased) || !patchFingerprintsMatch(initialPatchComparison, afterRebase.comparison))
            return stale('The thread changed during rebase. The bookmark was not advanced; retry after reviewing the current work.')
          const [candidateRevision, ...extraCandidateRevisions] = yield* revisionsAtOperation(
            afterRebase.workingCopyEmpty ? '@-' : '@',
            cwd,
            afterRebase.snapshot.operationId,
          )
          if (candidateRevision === undefined || extraCandidateRevisions.length > 0)
            return stale('Could not identify one checked revision to advance the bookmark to.')

          if (yield* cancelled) return cancelledOutcome
          if (!(yield* ensureAuthorized)) return { status: 'not-eligible' } satisfies VerifiedLandOutcome
          yield* jj(['edit', knownCommitRevset(candidateRevision.commitId)], cwd)
          const verificationState = yield* scanAfter
          if (verificationState.status === 'not-eligible') return { status: 'not-eligible' } satisfies VerifiedLandOutcome
          if (verificationState.status === 'bookmark-moved') {
            const blocked = yield* bookmarkMovedOutcome({
              snapshot: verificationState.snapshot,
              expectedCommitId: attemptSnapshot.bookmarkCommitId,
              attempt,
              sideways: 'The target bookmark moved backwards or sideways before Project Checks.',
              exhausted: 'The bookmark changed while preparing Project Checks; retry integration.',
            })
            if (blocked !== undefined) return blocked
            continue
          }
          if (
            verificationState.workingCopyRevisionId !== candidateRevision.commitId ||
            verificationState.detached.length > 0 ||
            !workMetadataMatches(work, verificationState.revisions) ||
            !patchFingerprintsMatch(initialPatchComparison, verificationState.comparison)
          )
            return stale('The thread changed while preparing Project Checks. The bookmark was not advanced; retry after reviewing the current work.')
          if (verificationState.revisions.some(revision => revision.conflict))
            return stale('A conflict appeared while preparing Project Checks; resolve it before retrying.')
          if (!(yield* ensureAuthorized)) return { status: 'not-eligible' } satisfies VerifiedLandOutcome
          const verification = yield* input.verifyCandidate({ workingCopyCommitId: candidateRevision.commitId, attempt })
          if (verification.status === 'cancelled' || (yield* cancelled)) return cancelledOutcome
          if (verification.status === 'stale') return stale(verification.message)
          if (verification.status === 'failed') return { status: 'verification-failed', message: verification.message } satisfies VerifiedLandOutcome
          const postVerificationState = yield* scanAfter
          if (postVerificationState.status === 'not-eligible') return { status: 'not-eligible' } satisfies VerifiedLandOutcome
          if (postVerificationState.status === 'bookmark-moved') {
            const blocked = yield* bookmarkMovedOutcome({
              snapshot: postVerificationState.snapshot,
              expectedCommitId: attemptSnapshot.bookmarkCommitId,
              attempt,
              sideways: 'The target bookmark moved backwards or sideways during Project Checks.',
              exhausted: 'The bookmark changed while Project Checks ran; retry integration.',
            })
            if (blocked !== undefined) return blocked
            continue
          }
          if (
            postVerificationState.workingCopyRevisionId !== candidateRevision.commitId ||
            postVerificationState.detached.length > 0 ||
            !workMetadataMatches(work, postVerificationState.revisions) ||
            !patchFingerprintsMatch(initialPatchComparison, postVerificationState.comparison)
          )
            return stale('The thread changed while Project Checks ran. The bookmark was not advanced; review the current work.')

          const beforeMoveSnapshot = yield* readSnapshot(repoRoot, target)
          if (beforeMoveSnapshot.bookmarkCommitId !== attemptSnapshot.bookmarkCommitId) {
            const blocked = yield* bookmarkMovedOutcome({
              snapshot: beforeMoveSnapshot,
              expectedCommitId: attemptSnapshot.bookmarkCommitId,
              attempt,
              sideways: 'The target bookmark moved backwards or sideways before landing; review it before retrying.',
              exhausted: 'The bookmark moved before landing. Retry integration after the current changes settle.',
            })
            if (blocked !== undefined) return blocked
            continue
          }
          if (yield* cancelled) return cancelledOutcome
          if (!(yield* ensureAuthorized)) return { status: 'not-eligible' } satisfies VerifiedLandOutcome
          const moved = yield* run(
            [
              '--ignore-working-copy',
              'bookmark',
              'move',
              '--from',
              knownCommitRevset(attemptSnapshot.bookmarkCommitId),
              '--to',
              knownCommitRevset(candidateRevision.commitId),
              exactBookmarkNamePattern(target),
            ],
            cwd,
          )
          const afterMoveSnapshot = yield* readSnapshot(repoRoot, target)
          const candidateIsOnBookmark = yield* bookmarkTargetDescendsFrom({
            repoRoot,
            operationId: afterMoveSnapshot.operationId,
            expectedCommitId: candidateRevision.commitId,
            currentCommitId: afterMoveSnapshot.bookmarkCommitId,
          })
          if (candidateIsOnBookmark) {
            // The checked candidate is `@`, so the thread continues on a fresh change above the advanced bookmark.
            if (yield* ensureAuthorized) yield* jj(['new', knownCommitRevset(afterMoveSnapshot.bookmarkCommitId)], cwd).pipe(Effect.ignore)
            const baseChangeId = yield* changeIdForCommit(attemptSnapshot.bookmarkCommitId, cwd).pipe(Effect.option, Effect.map(Option.getOrUndefined))
            const tipChangeId = yield* changeIdForCommit(candidateRevision.commitId, cwd).pipe(Effect.option, Effect.map(Option.getOrUndefined))
            yield* writeRebaseMetadata(thread.repoRoot, thread.threadName, { tipChangeId, baseChangeId, sessionId: input.sessionId }).pipe(Effect.ignore)
            return { status: 'landed', revisions: rebased, head: candidateRevision } satisfies VerifiedLandOutcome
          }
          if (yield* cancelled) return cancelledOutcome
          const targetMovedForward = yield* bookmarkTargetDescendsFrom({
            repoRoot,
            operationId: afterMoveSnapshot.operationId,
            expectedCommitId: attemptSnapshot.bookmarkCommitId,
            currentCommitId: afterMoveSnapshot.bookmarkCommitId,
          })
          if (!targetMovedForward) return stale('The target bookmark moved backwards or sideways while landing; review it before retrying.')
          if (attempt >= LAND_ATTEMPTS) {
            if (moved.exitCode !== 0) return yield* jjFailed(`Could not move ${target}: ${moved.stderr.trim().slice(0, 400)}`)
            return stale('The bookmark changed before the checked revision could be landed; retry integration.')
          }
        }
      }),
    )
  })

  const unlandedRevsetAt = (name: string, bookmarkCommitId: string): string => `(::${name}@ ~ ::${knownCommitRevset(bookmarkCommitId)}) ~ empty()`

  const conflictedFiles = Effect.fnUntraced(function* (conflicted: readonly ThreadRevision[], cwd: string) {
    const files = new Set<string>()
    for (const revision of conflicted) {
      const listed = yield* run(['resolve', '--list', '-r', knownCommitRevset(revision.commitId)], cwd)
      if (listed.exitCode !== 0) return yield* jjFailed(`jj resolve --list failed: ${listed.stderr.trim().slice(0, 400)}`)
      for (const file of conflictFiles(listed.stdout)) files.add(file)
    }
    return [...files].slice(0, MAX_CONFLICT_FILES)
  })

  const landAt = <E = never>(
    thread: ThreadLocation & { readonly threadName: string },
    input: LandAtOptions<E> = {},
  ): Effect.Effect<LandOutcome, JjFailed | E> => {
    const progress = (phase: LandPhase) => input.onProgress?.(phase) ?? Effect.void
    return Effect.gen(function* () {
      yield* progress('queued')
      return yield* locks.withRepo(thread.repoRoot)(
        Effect.gen(function* () {
          yield* progress('validating')
          if (input.validate !== undefined) yield* input.validate
          const cwd = thread.workspaceRoot
          const target = input.bookmark ?? (yield* bookmark)
          for (let attempt = 1; ; attempt++) {
            yield* progress('rebasing')
            const baseChangeId = yield* changeIdOf(target, cwd).pipe(Effect.option, Effect.map(Option.getOrUndefined))
            yield* jj(['rebase', '-b', '@', '-d', target, '--skip-emptied'], cwd)
            const postRebase = yield* jj(
              [
                '--ignore-working-copy',
                'log',
                '--no-graph',
                '-r',
                `((${target}..@) ~ empty()) | (((${target}..@) & empty()) ~ @ ~ merges() ~ working_copies()) | (@ & empty())`,
                '-T',
                LAND_REVISION_TEMPLATE,
              ],
              cwd,
            ).pipe(Effect.flatMap(parseLandRevisions))
            const leftovers = postRebase.filter(item => item.empty && !item.currentWorkingCopy).map(item => item.revision)
            if (leftovers.length > 0) {
              yield* jj(['abandon', ...leftovers.map(revision => revision.commitId)], cwd)
              continue
            }
            const rebased = postRebase.filter(item => !item.empty).map(item => item.revision)
            if (rebased.length === 0) return { status: 'nothing-to-land' } satisfies LandOutcome
            const undescribed = rebased.filter(revision => ThreadIntegrationModel.isPlaceholderRevisionDescription(revision.description))
            if (undescribed.length > 0) return { status: 'needs-description', revisions: undescribed } satisfies LandOutcome
            const conflicted = rebased.filter(revision => revision.conflict)
            if (conflicted.length > 0)
              return { status: 'conflicted', revisions: conflicted, files: yield* conflictedFiles(conflicted, cwd) } satisfies LandOutcome
            const workingCopyEmpty = postRebase.some(item => item.empty && item.currentWorkingCopy)
            // A bookmark only moves forward; if another writer advanced it meanwhile, rebase again onto the new tip.
            const moved = yield* run(['bookmark', 'set', target, '-r', workingCopyEmpty ? '@-' : '@'], cwd)
            if (moved.exitCode === 0) {
              if (!workingCopyEmpty) yield* jj(['new', target], cwd)
              const head = rebased[0]
              if (head === undefined) return yield* jjFailed('The rebased revisions have no bookmark head.')
              const tipChangeId = yield* changeIdForCommit(head.commitId, cwd).pipe(Effect.option, Effect.map(Option.getOrUndefined))
              yield* writeRebaseMetadata(thread.repoRoot, thread.threadName, { tipChangeId, baseChangeId, sessionId: input.sessionId }).pipe(Effect.ignore)
              return { status: 'landed', revisions: rebased, head } satisfies LandOutcome
            }
            if (attempt >= LAND_ATTEMPTS) return yield* jjFailed(`Could not move ${target}: ${moved.stderr.trim().slice(0, 400)}`)
          }
        }),
      )
    }).pipe(Effect.withSpan('thread workspaces land'))
  }

  const land = <E = never>(target: string, input: LandAtOptions<E> = {}) => Effect.flatMap(requireThread(target), thread => landAt(thread, input))

  const ensureSafeName = (name: string, verb: string) =>
    name.includes('/') || name.startsWith('.') ? Effect.fail(new UnsafePath({ detail: `Refusing to ${verb} ${name}.` })) : Effect.void

  const removeTree = (target: string) =>
    fileSystem.remove(target, { recursive: true, force: true }).pipe(Effect.mapError(filesFailed(`Could not remove ${target}.`)))

  const discard = Effect.fn('thread workspaces discard')(function* (input: { readonly repoRoot: string; readonly name: string; readonly force: boolean }) {
    return yield* locks.withRepo(input.repoRoot)(
      Effect.gen(function* () {
        yield* ensureSafeName(input.name, 'discard workspace')
        const workspaceRoot = path.join(yield* threadsDirectory(input.repoRoot), input.name)
        // Snapshot first so edits still on disk count as work.
        if (yield* exists(path.join(workspaceRoot, '.jj'))) yield* jj(['status'], workspaceRoot)
        const target = yield* targetRevset(input.repoRoot)
        const work = yield* revisions(unlandedRevset(input.name, target), input.repoRoot, { observe: true })
        if (work.length > 0 && !input.force) return { status: 'has-work', revisions: work } satisfies DiscardOutcome
        const owned = yield* revisions(`(::${input.name}@ ~ ::${target}) ~ ::(working_copies() ~ ${input.name}@)`, input.repoRoot, { observe: true })
        yield* jj(['--ignore-working-copy', 'workspace', 'forget', input.name], input.repoRoot)
        if (owned.length > 0) yield* jj(['--ignore-working-copy', 'abandon', ...owned.map(revision => revision.commitId)], input.repoRoot)
        yield* removeTree(workspaceRoot)
        return { status: 'discarded' } satisfies DiscardOutcome
      }),
    )
  })

  const discardMany = Effect.fn('thread workspaces discard many')(function* (input: {
    readonly repoRoot: string
    readonly names: readonly string[]
    readonly force: boolean
  }) {
    return yield* locks.withRepo(input.repoRoot)(
      Effect.gen(function* () {
        const target = yield* targetRevset(input.repoRoot)
        const directory = yield* threadsDirectory(input.repoRoot)
        const candidates: { readonly name: string; readonly workspaceRoot: string; readonly owned: readonly ThreadRevision[] }[] = []
        const results: ThreadDiscardResult[] = []
        // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- each `jj status` snapshots into the same store, so they run one at a time.
        for (const name of new Set(input.names)) {
          const planned = yield* Effect.gen(function* () {
            yield* ensureSafeName(name, 'discard workspace')
            const workspaceRoot = path.join(directory, name)
            if (yield* exists(path.join(workspaceRoot, '.jj'))) yield* jj(['status'], workspaceRoot)
            const work = yield* revisions(unlandedRevset(name, target), input.repoRoot, { observe: true })
            if (work.length > 0 && !input.force) return { name, status: 'has-work', revisions: work, error: null } satisfies ThreadDiscardResult
            const owned = yield* revisions(`(::${name}@ ~ ::${target}) ~ ::(working_copies() ~ ${name}@)`, input.repoRoot, { observe: true })
            candidates.push({ name, workspaceRoot, owned })
            return undefined
          }).pipe(Effect.catch(error => Effect.succeed<ThreadDiscardResult>({ name, status: 'error', revisions: [], error: error.message })))
          if (planned !== undefined) results.push(planned)
        }
        if (candidates.length === 0) return { results }
        const forgotten = yield* Effect.gen(function* () {
          yield* jj(['--ignore-working-copy', 'workspace', 'forget', ...candidates.map(candidate => candidate.name)], input.repoRoot)
          const ownedCommitIds = new Set(candidates.flatMap(candidate => candidate.owned.map(revision => revision.commitId)))
          if (ownedCommitIds.size > 0) yield* jj(['--ignore-working-copy', 'abandon', ...ownedCommitIds], input.repoRoot)
        }).pipe(Effect.result)
        if (forgotten._tag === 'Failure') {
          const message = forgotten.failure.message
          return {
            results: [
              ...results,
              ...candidates.map((candidate): ThreadDiscardResult => ({ name: candidate.name, status: 'error', revisions: [], error: message })),
            ],
          }
        }
        const removed = yield* Effect.forEach(
          candidates,
          candidate =>
            removeTree(candidate.workspaceRoot).pipe(
              Effect.as<ThreadDiscardResult>({ name: candidate.name, status: 'discarded', revisions: [], error: null }),
              Effect.catch(error => Effect.succeed<ThreadDiscardResult>({ name: candidate.name, status: 'error', revisions: [], error: error.message })),
            ),
          { concurrency: STATUS_READ_CONCURRENCY },
        )
        return { results: [...results, ...removed] }
      }),
    )
  })

  const pathIsWithin = (parent: string, candidate: string): boolean => {
    const relativePath = path.relative(parent, candidate)
    return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !relativePath.startsWith(path.sep))
  }
  const pathsOverlap = (left: string, right: string): boolean => pathIsWithin(left, right) || pathIsWithin(right, left)

  const secondaryWorkspaces = Effect.fn('thread workspaces list secondary')(function* (repoRoot: string) {
    const rootRecords: { readonly name: string; readonly path: string }[] = []
    for (const line of lines(yield* jj(['--ignore-working-copy', 'workspace', 'list', '-T', 'json(name) ++ "\\t" ++ json(self.root()) ++ "\\n"'], repoRoot))) {
      const separator = line.indexOf('\t')
      const name = separator < 1 ? Option.none() : decodeWorkspaceName(line.slice(0, separator))
      const root = separator < 1 ? Option.none() : decodeWorkspaceRoot(line.slice(separator + 1))
      if (Option.isNone(name) || Option.isNone(root)) return yield* jjFailed('JJ returned an invalid workspace row; refusing secondary cleanup.')
      if (root.value !== null) rootRecords.push({ name: name.value, path: root.value })
    }
    const realRepoRoot = yield* fileSystem.realPath(repoRoot).pipe(Effect.mapError(filesFailed(`Could not resolve ${repoRoot}.`)))
    const threadDirectory = path.resolve(yield* threadsDirectory(repoRoot))
    const out: SecondaryWorkspaceStatus[] = []
    // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- each `jj status` snapshots into the same store, so they run one at a time.
    for (const record of rootRecords) {
      const reportedRoot = path.resolve(record.path)
      if (
        record.name.startsWith('thread-') ||
        pathsOverlap(reportedRoot, realRepoRoot) ||
        pathsOverlap(reportedRoot, threadDirectory) ||
        rootRecords.some(other => other.name !== record.name && pathIsWithin(reportedRoot, path.resolve(other.path)))
      )
        continue
      if (!(yield* exists(reportedRoot))) {
        const unlanded = yield* revisions(`(::${record.name}@ ~ ::${bookmarkRevset(yield* bookmark)}) ~ empty()`, realRepoRoot, { observe: true })
        out.push({ name: record.name, path: reportedRoot, repoRoot: realRepoRoot, missing: true, unlanded, workingCopyState: 'missing' })
        continue
      }
      if (!(yield* exists(path.join(reportedRoot, '.jj')))) continue
      const actualRoot = yield* fileSystem.realPath(reportedRoot).pipe(Effect.mapError(filesFailed(`Could not resolve ${reportedRoot}.`)))
      if (actualRoot !== reportedRoot || (yield* storeRootOf(actualRoot)) !== realRepoRoot) continue
      const readWorkingCopyId = run(['--ignore-working-copy', 'log', '--no-graph', '-r', '@', '-T', 'commit_id'], actualRoot).pipe(
        Effect.map(output => (output.exitCode === 0 && isCommitId(output.stdout.trim()) ? output.stdout.trim() : undefined)),
        Effect.orElseSucceed(() => undefined),
      )
      const beforeStatus = yield* readWorkingCopyId
      const statusExit = yield* run(['status'], actualRoot).pipe(
        Effect.map(output => output.exitCode),
        Effect.orElseSucceed(() => 1),
      )
      const afterStatus = yield* readWorkingCopyId
      const target = yield* targetRevset(realRepoRoot)
      const unlanded = yield* revisions(`(::@ ~ ::${target}) ~ empty()`, actualRoot, { observe: true }).pipe(Effect.option)
      const workingCopyState =
        Option.isNone(unlanded) || statusExit !== 0 || beforeStatus === undefined || afterStatus === undefined
          ? 'unknown'
          : beforeStatus === afterStatus
            ? 'clean'
            : 'dirty'
      out.push({
        name: record.name,
        path: actualRoot,
        repoRoot: realRepoRoot,
        missing: false,
        unlanded: Option.getOrElse(unlanded, () => []),
        workingCopyState,
      })
    }
    return out
  })

  const discardSecondaryMany = Effect.fn('thread workspaces discard secondary')(function* (input: {
    readonly repoRoot: string
    readonly workspaces: readonly { readonly name: string; readonly path: string; readonly missing: boolean }[]
  }) {
    return yield* locks.withRepo(input.repoRoot)(
      Effect.gen(function* () {
        const results: SecondaryDiscardResult[] = []
        const seen = new Set<string>()
        // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- each removal rereads the workspaces the previous one may have changed.
        for (const expected of input.workspaces) {
          if (seen.has(expected.name)) continue
          seen.add(expected.name)
          results.push(
            yield* Effect.gen(function* () {
              const current = (yield* secondaryWorkspaces(input.repoRoot)).find(workspace => workspace.name === expected.name)
              if (current === undefined || current.path !== expected.path || current.missing !== expected.missing)
                return { ...expected, status: 'error', message: 'The JJ workspace name or root changed after preview.' } satisfies SecondaryDiscardResult
              if ((!current.missing && current.workingCopyState !== 'clean') || current.unlanded.length > 0) {
                const message =
                  current.workingCopyState === 'unknown'
                    ? 'The working-copy state could not be verified.'
                    : current.workingCopyState === 'dirty'
                      ? 'The workspace has uncommitted changes.'
                      : 'The workspace has unlanded work.'
                return { ...expected, status: 'has-work', message } satisfies SecondaryDiscardResult
              }
              yield* jj(['--ignore-working-copy', 'workspace', 'forget', expected.name], input.repoRoot)
              if (!current.missing)
                yield* fileSystem
                  .remove(current.path, { recursive: true, force: false })
                  .pipe(Effect.mapError(filesFailed(`Could not remove ${current.path}.`)))
              return { ...expected, status: 'discarded', message: null } satisfies SecondaryDiscardResult
            }).pipe(
              Effect.map((result): SecondaryDiscardResult => ({ name: result.name, path: result.path, status: result.status, message: result.message })),
              Effect.catch(error =>
                Effect.succeed<SecondaryDiscardResult>({ name: expected.name, path: expected.path, status: 'error', message: error.message }),
              ),
            ),
          )
        }
        return { results }
      }),
    )
  })

  /** When each workspace's working-copy commit last changed, in epoch milliseconds, keyed by workspace name. */
  const workingCopyChangedAt = Effect.fn('thread workspaces working copy times')(function* (repoRoot: string) {
    const output = yield* jj(
      [
        '--ignore-working-copy',
        'log',
        '--no-graph',
        '-r',
        'working_copies()',
        '-T',
        'working_copies.map(|w| w.name()).join(",") ++ "\\t" ++ committer.timestamp().format("%s") ++ "\\n"',
      ],
      repoRoot,
    )
    const changedAt = new Map<string, number>()
    for (const line of output.split('\n')) {
      const [names = '', seconds = ''] = line.split('\t')
      const epochSeconds = Number.parseInt(seconds, 10)
      if (!Number.isFinite(epochSeconds)) continue
      for (const name of names.split(',')) if (name.length > 0) changedAt.set(name, epochSeconds * 1000)
    }
    return changedAt satisfies ReadonlyMap<string, number>
  })

  /**
   * Empty, undescribed, single-parent mutable revisions that nothing still builds on: no working copy, bookmark or
   * revision with content or a description descends from them, so abandoning them rewrites no live workspace.
   */
  const danglingEmptyRevset =
    '(mutable() & empty() & ~merges() & description(exact:"")) ~ ::(working_copies() | bookmarks() | remote_bookmarks() | tags() | (mutable() & ~empty()) | (mutable() & ~description(exact:"")))'

  const danglingEmptyRevisions = Effect.fn('thread workspaces dangling empties')(function* (input: { readonly repoRoot: string; readonly abandon: boolean }) {
    return yield* locks.withRepo(input.repoRoot)(
      Effect.gen(function* () {
        const found = yield* revisions(danglingEmptyRevset, input.repoRoot, { observe: true, maxRevisions: MAX_DANGLING_EMPTY_REVISIONS })
        if (input.abandon && found.length > 0) yield* jj(['--ignore-working-copy', 'abandon', ...found.map(revision => revision.commitId)], input.repoRoot)
        return found
      }),
    )
  })

  /**
   * Whether an entry of the threads directory belongs to a live jj workspace. jj's recorded root goes stale when a
   * workspace folder is renamed, so a match on the name, the recorded root, or a working `.jj` inside it all count.
   */
  const ownedByWorkspace = Effect.fnUntraced(function* (repoRoot: string) {
    const listed = lines(yield* jj(['--ignore-working-copy', 'workspace', 'list', '-T', 'name ++ "\\t" ++ self.root() ++ "\\n"'], repoRoot)).map(line =>
      line.split('\t'),
    )
    const names = new Set(listed.map(([name = '']) => name))
    const roots = new Set(listed.map(([, root = '']) => root))
    return (entry: string): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        if (names.has(path.basename(entry)) || roots.has(entry)) return true
        if (!(yield* exists(path.join(entry, '.jj')))) return false
        return yield* run(['--ignore-working-copy', 'workspace', 'root'], entry).pipe(
          Effect.map(output => output.exitCode === 0),
          Effect.orElseSucceed(() => false),
        )
      })
  })

  /** Entries of the threads directory that no jj workspace owns: folders of forgotten workspaces, stray logs, recovery copies. */
  const untrackedEntries = Effect.fn('thread workspaces untracked')(function* (repoRoot: string) {
    const directory = yield* threadsDirectory(repoRoot)
    const [isOwned, entries] = yield* Effect.all(
      [ownedByWorkspace(repoRoot), fileSystem.readDirectory(directory).pipe(Effect.orElseSucceed((): readonly string[] => []))],
      { concurrency: 'unbounded' },
    )
    const found = yield* Effect.forEach(
      entries.filter(name => !name.startsWith('.')),
      name =>
        Effect.gen(function* () {
          const entry = path.join(directory, name)
          if (yield* isOwned(entry)) return undefined
          const modifiedAt = Option.flatMap(yield* fileSystem.lstat(entry).pipe(Effect.option), info => info.mtime)
          return Option.isSome(modifiedAt) ? ({ name, path: entry, modifiedAt: Math.round(modifiedAt.value.getTime()) } satisfies UntrackedEntry) : undefined
        }),
      { concurrency: STATUS_READ_CONCURRENCY },
    )
    return found.filter(entry => entry !== undefined)
  })

  const removeUntrackedEntry = Effect.fn('thread workspaces remove untracked')(function* (input: { readonly repoRoot: string; readonly name: string }) {
    return yield* locks.withRepo(input.repoRoot)(
      Effect.gen(function* () {
        yield* ensureSafeName(input.name, 'remove')
        const entry = path.join(yield* threadsDirectory(input.repoRoot), input.name)
        if (yield* (yield* ownedByWorkspace(input.repoRoot))(entry)) return yield* new UnsafePath({ detail: `${input.name} belongs to a jj workspace now.` })
        yield* removeTree(entry)
        yield* gitWorktrees(input.repoRoot, ['prune'])
      }),
    )
  })

  /** Local bookmarks, and the nearest one the workspace at `path` builds on. */
  const bookmarks = Effect.fn('thread workspaces bookmarks')(function* (target: string) {
    const [listed, nearest] = yield* Effect.all(
      [
        jj(['--ignore-working-copy', 'bookmark', 'list', '-T', 'if(remote, "", name ++ "\\n")'], target),
        jj(
          ['--ignore-working-copy', 'log', '--no-graph', '-r', 'heads(::@ & bookmarks())', '-T', 'local_bookmarks.map(|b| b.name()).join("\\n") ++ "\\n"'],
          target,
        ),
      ],
      { concurrency: 'unbounded' },
    )
    const preferred = yield* bookmark
    const candidates = lines(nearest)
    return { current: candidates.includes(preferred) ? preferred : (candidates[0] ?? null), names: [...new Set(lines(listed))] }
  })

  const revisionGraph = Effect.fn('thread workspaces revision graph')(function* (target: string) {
    const thread = yield* requireThread(target)
    const operationId = (yield* jj(['--ignore-working-copy', 'op', 'log', '--limit', '1', '--no-graph', '-T', 'id'], thread.workspaceRoot)).trim()
    if (operationId.length === 0) return yield* jjFailed('Could not read the current jj operation.')
    const readGraph = (args: readonly string[]) => jj(['--ignore-working-copy', '--at-operation', operationId, ...args], thread.workspaceRoot)
    const hasDefaultWorkspace = (yield* readGraph(['workspace', 'list', '-T', 'name ++ "\\n"'])).split('\n').includes('default')
    let defaultCommitId: string | undefined
    if (hasDefaultWorkspace) {
      const candidate = (yield* readGraph(['log', '--no-graph', '-r', 'default@', '-T', 'commit_id.short(64)'])).trim()
      if (!Schema.is(commitIdSchema)(candidate)) return yield* jjFailed('Could not resolve the default workspace revision.')
      defaultCommitId = candidate
    }
    const defaultWorkspaceLabel = defaultCommitId === undefined ? '""' : `if(commit_id.short(64) == "${defaultCommitId}", "default@", "")`
    const bookmarkName = yield* bookmark
    const bookmarkLiteral = JSON.stringify(bookmarkName)
    const threadRevisionLimit = 16
    const threadRevisionLines = lines(
      yield* readGraph(['log', '--no-graph', '--limit', String(threadRevisionLimit), '-r', `::@ ~ ::${bookmarkName}`, '-T', 'commit_id ++ "\\n"']),
    )
    if (!Schema.is(Schema.Array(commitIdSchema).check(Schema.isMaxLength(threadRevisionLimit)))(threadRevisionLines))
      return yield* jjFailed('Could not read thread revision IDs for the graph.')
    const revset = ['@', ...threadRevisionLines, bookmarkName, `present(${bookmarkName}@origin)`, ...(hasDefaultWorkspace ? ['default@'] : [])].join(' | ')
    const template = [
      'change_id.short(8)',
      '" "',
      `local_bookmarks.filter(|bookmark| bookmark.name() == ${bookmarkLiteral}).map(|bookmark| bookmark.name()).join(",")`,
      '" "',
      `remote_bookmarks.filter(|bookmark| bookmark.name() == ${bookmarkLiteral} && bookmark.remote() == "origin").map(|bookmark| bookmark.name() ++ "@" ++ bookmark.remote()).join(",")`,
      '" "',
      defaultWorkspaceLabel,
      '" "',
      'description.first_line().substr(0, 64)',
      '"\\n"',
    ].join(' ++ ')
    return (yield* readGraph(['log', '--no-pager', '--color=never', '--limit', '20', '-r', revset, '-T', template])).trimEnd()
  })

  return {
    vcs: 'jj' as const,
    threadsDirectory,
    locate,
    list,
    status,
    reviewHistory,
    provision,
    prewarm,
    branchPoint,
    restore,
    land,
    landAt,
    landVerified,
    discard,
    discardMany,
    secondaryWorkspaces,
    discardSecondaryMany,
    workingCopyChangedAt,
    danglingEmptyRevisions,
    untrackedEntries,
    removeUntrackedEntry,
    bookmarks,
    workingCopyCommitId,
    snapshotFiles,
    restoreFiles,
    revisionGraph,
  }
})

/** The jj adapter of the thread-workspace port: jj workspaces, operation-pinned landing and patch-equivalence guards. */
export class JjThreadWorkspaces extends Context.Service<JjThreadWorkspaces, ThreadWorkspacesBackend>()('@dshfiles/jj-integration/JjThreadWorkspaces') {
  static readonly layer = Layer.effect(
    JjThreadWorkspaces,
    Effect.map(make, backend => JjThreadWorkspaces.of(backend)),
  )
}
