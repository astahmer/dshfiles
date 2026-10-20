import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { JsonText } from './json-text.js'
import { ThreadIntegrationModel } from './thread-integration-state.js'
import { JjReadCache } from './jj-read-cache.js'

export interface JjResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stdoutLossy: boolean
  readonly stderr: string
}

/**
 * Concurrent read-only `jj` processes per repository scan. Each thread costs two of them, and the scan runs while the
 * New thread screen and the sidebar are open: 45 thread workspaces measured 2.1s at 4 and 1.0s at 8, with no gain above.
 */
const STATUS_READ_CONCURRENCY = 8

export type JjExecutor = (input: { readonly args: readonly string[]; readonly cwd: string; readonly signal?: AbortSignal | undefined }) => Promise<JjResult>

export class ThreadError extends Error {
  constructor(
    readonly code: 'not-a-repository' | 'not-a-thread' | 'jj-failed' | 'unsafe-path',
    message: string,
  ) {
    super(message)
    this.name = 'ThreadError'
  }
}

export interface ThreadRevision {
  readonly changeId: string
  readonly commitId: string
  readonly description: string
  readonly conflict: boolean
}

export interface ThreadLocation {
  /** Root of the checkout that owns the jj store; thread workspaces sit in its `-threads` sibling. */
  readonly repoRoot: string
  readonly workspaceRoot: string
  readonly threadName: string | undefined
}

const isSecondaryWorkspace = (location: ThreadLocation): boolean => location.workspaceRoot !== location.repoRoot

export interface ThreadStatus {
  readonly name: string
  readonly path: string
  readonly repoRoot: string
  readonly missing: boolean
  /** Non-empty revisions in the thread that the target bookmark does not contain yet. */
  readonly unlanded: readonly ThreadRevision[]
  /** The target bookmark moved since this thread last rebased. */
  readonly behind: boolean
  /** Revisions the target bookmark has that this workspace lacks. */
  readonly behindCount: number
  /** Timestamp of the latest successful land, persisted beside the thread workspaces. */
  readonly rebasedAt?: number
  /** Change ID of the bookmark tip when this thread last landed. */
  readonly rebasedTipChangeId?: string
  /** Every recorded land, oldest first; the last one matches `rebasedAt`. */
  readonly integrations?: readonly IntegrationRecord[]
}

export type LandOutcome =
  | { readonly status: 'landed'; readonly revisions: readonly ThreadRevision[]; readonly head: ThreadRevision }
  | { readonly status: 'nothing-to-land' }
  | { readonly status: 'needs-description'; readonly revisions: readonly ThreadRevision[] }
  | { readonly status: 'conflicted'; readonly revisions: readonly ThreadRevision[]; readonly files: readonly string[] }

export interface LandCandidate {
  readonly workingCopyCommitId: string
  readonly attempt: number
}

export type LandCandidateVerification =
  | { readonly status: 'passed' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'stale'; readonly message: string }
  | { readonly status: 'cancelled' }

export type VerifiedLandOutcome =
  | LandOutcome
  | { readonly status: 'already-integrated'; readonly revisions: readonly ThreadRevision[] }
  | { readonly status: 'patch-equivalent-work'; readonly revisions: readonly ThreadRevision[] }
  | { readonly status: 'patch-equivalence-unavailable'; readonly revisions: readonly ThreadRevision[] }
  | { readonly status: 'detached-work'; readonly revisions: readonly ThreadRevision[] }
  | { readonly status: 'not-eligible' }
  | { readonly status: 'verification-failed'; readonly message: string }
  | { readonly status: 'verification-stale'; readonly message: string }
  | { readonly status: 'verification-cancelled' }

export interface VerifiedLandOptions {
  readonly path: string
  readonly bookmark?: string | undefined
  readonly signal?: AbortSignal | undefined
  readonly expectedSourceRevision: string
  readonly authorize: (location: ThreadLocation) => Promise<boolean>
  readonly verifyCandidate: (candidate: LandCandidate) => Promise<LandCandidateVerification>
}

export type DiscardOutcome = { readonly status: 'discarded' } | { readonly status: 'has-work'; readonly revisions: readonly ThreadRevision[] }

const REVISION_TEMPLATE = 'change_id ++ "\\t" ++ commit_id ++ "\\t" ++ conflict ++ "\\t" ++ description.first_line() ++ "\\n"'
const LAND_REVISION_TEMPLATE =
  'change_id.short(12) ++ "\\t" ++ commit_id ++ "\\t" ++ conflict ++ "\\t" ++ empty ++ "\\t" ++ current_working_copy ++ "\\t" ++ description.first_line() ++ "\\n"'
const MAX_CONFLICT_FILES = 50
/** How far behind the bookmark a workspace is read; the count is displayed, so an exact value past this is noise. */
const MAX_BEHIND_REVISIONS = 1_000
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
const isCommitId = (value: string): boolean => value.length >= 40 && HEX_ID.test(value)
const commitIdRevset = (commitId: string): string => {
  if (!isCommitId(commitId)) throw new ThreadError('jj-failed', 'JJ returned an invalid commit ID; refusing revision selection.')
  return `commit_id(${JSON.stringify(commitId)})`
}
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
const rebaseTimestampSchema = z.number().int().nonnegative().safe()
const integrationRecordSchema = z.object({ at: rebaseTimestampSchema, tipChangeId: z.string().min(1).max(128).optional() }).strict()
const rebaseMetadataEntrySchema = integrationRecordSchema.extend({ history: z.array(integrationRecordSchema).optional() }).strict()
const rebaseMetadataValueSchema = z.union([rebaseTimestampSchema, rebaseMetadataEntrySchema])
const rebaseMetadataSchema = z.record(z.string(), rebaseMetadataValueSchema)
type RebaseMetadataEntry = z.infer<typeof rebaseMetadataEntrySchema>
type IntegrationRecord = z.infer<typeof integrationRecordSchema>
/** A thread lands again and again while it keeps working; the oldest landings stop mattering long before this many. */
const MAX_INTEGRATION_HISTORY = 50

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

const parseRevisions = (stdout: string): readonly ThreadRevision[] => {
  const revisions: ThreadRevision[] = []
  for (const line of stdout.split('\n').filter(line => line.length > 0)) {
    const [changeId = '', commitId = '', conflict = '', ...description] = line.split('\t')
    if (changeId.length === 0 || !isCommitId(commitId) || (conflict !== 'true' && conflict !== 'false')) {
      throw new ThreadError('jj-failed', 'JJ returned incomplete revision metadata; refusing to continue.')
    }
    revisions.push({ changeId, commitId, conflict: conflict === 'true', description: description.join('\t').trim() })
  }
  return revisions
}

const parseLandRevisions = (
  stdout: string,
): readonly { readonly revision: ThreadRevision; readonly empty: boolean; readonly currentWorkingCopy: boolean }[] => {
  const revisions: { readonly revision: ThreadRevision; readonly empty: boolean; readonly currentWorkingCopy: boolean }[] = []
  for (const line of stdout.split('\n').filter(line => line.length > 0)) {
    const [changeId = '', commitId = '', conflict = '', empty = '', currentWorkingCopy = '', ...description] = line.split('\t')
    if (
      changeId.length === 0 ||
      !isCommitId(commitId) ||
      (conflict !== 'true' && conflict !== 'false') ||
      (empty !== 'true' && empty !== 'false') ||
      (currentWorkingCopy !== 'true' && currentWorkingCopy !== 'false')
    ) {
      throw new ThreadError('jj-failed', 'JJ returned incomplete landing metadata; refusing to continue.')
    }
    revisions.push({
      revision: { changeId, commitId, conflict: conflict === 'true', description: description.join('\t').trim() },
      empty: empty === 'true',
      currentWorkingCopy: currentWorkingCopy === 'true',
    })
  }
  return revisions
}

const parsePatchCandidateRecords = (stdout: string): readonly PatchCandidate[] | undefined => {
  const records: PatchCandidate[] = []
  for (const line of stdout.split('\n').filter(line => line.length > 0)) {
    const [commitId = '', parentCountText = '', conflictText = '', fingerprint = '', pathsText = '', ...extra] = line.split('\t')
    const paths = JsonText.decode(z.array(z.string()), pathsText)
    const parentCount = Number(parentCountText)
    if (
      extra.length > 0 ||
      !isCommitId(commitId) ||
      !Number.isSafeInteger(parentCount) ||
      parentCount < 0 ||
      (conflictText !== 'true' && conflictText !== 'false') ||
      paths?.success !== true
    ) {
      return undefined
    }
    records.push({ commitId, parentCount, conflict: conflictText === 'true', fingerprint, paths: paths.data })
  }
  return records
}

const parseTargetPatchRecords = (stdout: string): readonly TargetPatch[] | undefined => {
  const records: TargetPatch[] = []
  for (const line of stdout.split('\n').filter(line => line.length > 0)) {
    const [commitId = '', parentCountText = '', conflictText = '', fingerprint = '', ...extra] = line.split('\t')
    const parentCount = Number(parentCountText)
    if (
      extra.length > 0 ||
      !isCommitId(commitId) ||
      !Number.isSafeInteger(parentCount) ||
      parentCount < 0 ||
      (conflictText !== 'true' && conflictText !== 'false')
    ) {
      return undefined
    }
    records.push({ commitId, parentCount, conflict: conflictText === 'true', fingerprint })
  }
  return records
}

const parsePatchBodies = (stdout: string): ReadonlyMap<string, string> | undefined => {
  const bodies = new Map<string, string>()
  for (const line of stdout.split('\n').filter(line => line.length > 0)) {
    const separator = line.indexOf('\t')
    if (separator < 1) return undefined
    const commitId = line.slice(0, separator)
    const body = JsonText.decode(z.string(), line.slice(separator + 1))
    if (!isCommitId(commitId) || bodies.has(commitId) || body?.success !== true) return undefined
    bodies.set(commitId, body.data)
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

/** `<root>/.jj/repo` is the store in the owning checkout and a pointer file in every other workspace. */
const storeRootOf = (workspaceRoot: string): string | undefined => {
  const marker = join(workspaceRoot, '.jj', 'repo')
  if (!existsSync(marker)) return undefined
  if (statSync(marker).isDirectory()) return workspaceRoot
  const store = resolve(dirname(marker), readFileSync(marker, 'utf8').trim())
  return dirname(dirname(store))
}

export const createThreads = (options: {
  readonly executor: JjExecutor
  readonly bookmark: () => string
  readonly threadsDirectory: (repoRoot: string) => string
}) => {
  const locks = new Map<string, Promise<unknown>>()
  /** Every mutation of one store runs in order, so two rebases never race to move the same bookmark. */
  const serialized = <Value>(repoRoot: string, operation: () => Promise<Value>): Promise<Value> => {
    const next = (locks.get(repoRoot) ?? Promise.resolve()).then(operation, operation)
    locks.set(
      repoRoot,
      next.catch(() => undefined),
    )
    return next
  }

  const viewReads = new JjReadCache<JjResult>()
  const execute = (args: readonly string[], cwd: string, signal?: AbortSignal): Promise<JjResult> =>
    JjReadCache.isViewRead(args)
      ? // Shared by every caller of the same read, so no single caller's signal may abort it.
        viewReads.read({ args, cwd, run: () => options.executor({ args, cwd }), succeeded: result => result.exitCode === 0 && !result.stdoutLossy })
      : signal === undefined
        ? options.executor({ args, cwd })
        : options.executor({ args, cwd, signal })

  const completeStdout = (result: JjResult): string => {
    if (result.stdoutLossy) throw new ThreadError('jj-failed', 'JJ output exceeded the safe size limit; refusing incomplete repository data.')
    return result.stdout
  }

  const jj = async (args: readonly string[], cwd: string, signal?: AbortSignal): Promise<string> => {
    const result = await execute(args, cwd, signal)
    if (result.exitCode !== 0) throw new ThreadError('jj-failed', `jj ${args.join(' ').slice(0, 120)}: ${result.stderr.trim().slice(0, 400)}`)
    return completeStdout(result)
  }

  const revisions = async (revset: string, cwd: string, observe = false, signal?: AbortSignal, maxRevisions?: number): Promise<readonly ThreadRevision[]> =>
    parseRevisions(
      await jj(
        [
          ...(observe ? ['--ignore-working-copy'] : []),
          'log',
          '--no-graph',
          ...(maxRevisions === undefined ? [] : ['-n', String(maxRevisions)]),
          '-r',
          revset,
          '-T',
          REVISION_TEMPLATE,
        ],
        cwd,
        signal,
      ),
    )

  const landRevisions = async (revset: string, cwd: string, observe = false, signal?: AbortSignal) =>
    parseLandRevisions(await jj([...(observe ? ['--ignore-working-copy'] : []), 'log', '--no-graph', '-r', revset, '-T', LAND_REVISION_TEMPLATE], cwd, signal))

  const readAtOperation = (args: readonly string[], cwd: string, operationId: string, signal?: AbortSignal): Promise<string> =>
    jj(['--at-operation', operationId, ...args], cwd, signal)

  const revisionsAtOperation = async (
    revset: string,
    cwd: string,
    operationId: string,
    signal?: AbortSignal,
    maxRevisions?: number,
  ): Promise<readonly ThreadRevision[]> =>
    parseRevisions(
      await readAtOperation(
        ['log', '--no-graph', ...(maxRevisions === undefined ? [] : ['-n', String(maxRevisions)]), '-r', revset, '-T', REVISION_TEMPLATE],
        cwd,
        operationId,
        signal,
      ),
    )

  const readSnapshot = async (repoRoot: string, bookmark: string, signal?: AbortSignal): Promise<ReadSnapshot> => {
    const operationOutput = await jj(['--ignore-working-copy', 'op', 'log', '-n', '1', '--no-graph', '-T', 'self.id() ++ "\\n"'], repoRoot, signal)
    const [operationId, ...extraOperations] = operationOutput.split('\n').filter(line => line.length > 0)
    if (operationId === undefined || extraOperations.length > 0 || !HEX_ID.test(operationId)) {
      throw new ThreadError('jj-failed', 'Could not pin one JJ operation for the safe integration scan.')
    }
    const bookmarkOutput = await readAtOperation(
      ['log', '--no-graph', '-r', bookmarkRevset(bookmark), '-T', 'commit_id ++ "\\n"'],
      repoRoot,
      operationId,
      signal,
    )
    const [bookmarkCommitId, ...extraBookmarkCommits] = bookmarkOutput.split('\n').filter(line => line.length > 0)
    if (bookmarkCommitId === undefined || extraBookmarkCommits.length > 0 || !isCommitId(bookmarkCommitId)) {
      throw new ThreadError('jj-failed', 'Could not resolve one exact target bookmark; automatic integration is paused.')
    }
    return { operationId, bookmarkCommitId }
  }

  const bookmarkTargetDescendsFrom = async (input: {
    readonly repoRoot: string
    readonly operationId: string
    readonly expectedCommitId: string
    readonly currentCommitId: string
    readonly signal?: AbortSignal | undefined
  }): Promise<boolean> => {
    if (input.expectedCommitId === input.currentCommitId) return true
    const [expectedRevision] = await revisionsAtOperation(
      `${commitIdRevset(input.expectedCommitId)} & ::${commitIdRevset(input.currentCommitId)}`,
      input.repoRoot,
      input.operationId,
      input.signal,
      1,
    )
    return expectedRevision?.commitId === input.expectedCommitId
  }

  const comparePatchEquivalence = async (input: {
    readonly candidates: readonly ThreadRevision[]
    readonly repoRoot: string
    readonly snapshot: ReadSnapshot
    readonly signal?: AbortSignal | undefined
  }): Promise<PatchComparison> => {
    const candidates = input.candidates
    const allCandidateIds = new Set(candidates.map(revision => revision.commitId))
    const incomplete = (): PatchComparison => ({
      equivalentCommitIds: new Set(),
      unverifiedCommitIds: allCandidateIds,
      fingerprintsByChangeId: new Map(),
      complete: false,
    })
    if (candidates.length === 0) return { equivalentCommitIds: new Set(), unverifiedCommitIds: new Set(), fingerprintsByChangeId: new Map(), complete: true }
    const changeIdByCommitId = new Map(candidates.map(revision => [revision.commitId, revision.changeId]))
    if (
      candidates.length > MAX_PATCH_REVISIONS ||
      changeIdByCommitId.size !== candidates.length ||
      new Set(changeIdByCommitId.values()).size !== candidates.length ||
      [...allCandidateIds].some(commitId => !isCommitId(commitId))
    ) {
      return incomplete()
    }

    const candidateRevset = [...allCandidateIds].map(commitIdRevset).join(' | ')
    const candidateOutput = await readAtOperation(
      ['log', '--no-graph', '-r', candidateRevset, '-T', PATCH_CANDIDATE_TEMPLATE],
      input.repoRoot,
      input.snapshot.operationId,
      input.signal,
    )
    const candidateRecords = parsePatchCandidateRecords(candidateOutput)
    if (candidateRecords === undefined || candidateRecords.length !== allCandidateIds.size) return incomplete()
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
      if (changeId === undefined || fingerprintsByChangeId.has(changeId)) return incomplete()
      fingerprintsByChangeId.set(changeId, candidate.fingerprint)
    }
    if (candidatesToCompare.length === 0) {
      return { equivalentCommitIds: new Set(), unverifiedCommitIds, fingerprintsByChangeId, complete: unverifiedCommitIds.size === 0 }
    }

    const paths = new Set<string>()
    let pathBytes = 0
    for (const candidate of candidatesToCompare) {
      for (const path of candidate.paths) {
        if (path.length === 0 || isUnsupportedRevsetPath(path)) return incomplete()
        if (paths.has(path)) continue
        pathBytes += Buffer.byteLength(path)
        paths.add(path)
        if (paths.size > MAX_PATCH_PATHS || pathBytes > MAX_PATCH_PATH_BYTES) return incomplete()
      }
    }

    const fileFilters = [...paths].map(path => `files(file:${JSON.stringify(path)})`)
    const targetRevset = `(::${commitIdRevset(input.snapshot.bookmarkCommitId)}) & (${fileFilters.join(' | ')})`
    const targetOutput = await readAtOperation(
      ['log', '--no-graph', '-n', String(MAX_PATCH_TARGET_REVISIONS + 1), '-r', targetRevset, '-T', PATCH_TARGET_TEMPLATE],
      input.repoRoot,
      input.snapshot.operationId,
      input.signal,
    )
    const targetRecords = parseTargetPatchRecords(targetOutput)
    if (targetRecords === undefined || targetRecords.length > MAX_PATCH_TARGET_REVISIONS) return incomplete()
    if (targetRecords.some(target => target.parentCount !== 1 || target.conflict || target.fingerprint.length === 0)) return incomplete()

    const targetsByFingerprint = new Map<string, TargetPatch[]>()
    for (const target of targetRecords) {
      const matches = targetsByFingerprint.get(target.fingerprint) ?? []
      matches.push(target)
      targetsByFingerprint.set(target.fingerprint, matches)
    }
    const equivalentCommitIds = new Set<string>()
    for (const candidate of candidatesToCompare) {
      for (const target of targetsByFingerprint.get(candidate.fingerprint) ?? []) {
        const bodyOutput = await readAtOperation(
          ['log', '--no-graph', '-r', `${commitIdRevset(candidate.commitId)} | ${commitIdRevset(target.commitId)}`, '-T', PATCH_BODY_TEMPLATE],
          input.repoRoot,
          input.snapshot.operationId,
          input.signal,
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
    return { equivalentCommitIds, unverifiedCommitIds, fingerprintsByChangeId, complete: unverifiedCommitIds.size === 0 }
  }

  const detachedRevisionsByWorkspace = async (
    repoRoot: string,
    snapshot: ReadSnapshot,
    signal?: AbortSignal,
  ): Promise<ReadonlyMap<string, WorkspaceRevisionGroups>> => {
    const detachedRevisions = await revisionsAtOperation(
      `((all() ~ ::${commitIdRevset(snapshot.bookmarkCommitId)}) ~ ::(working_copies())) ~ empty()`,
      repoRoot,
      snapshot.operationId,
      signal,
      MAX_DETACHED_REVISIONS + 1,
    )
    if (detachedRevisions.length > MAX_DETACHED_REVISIONS) {
      throw new ThreadError('jj-failed', 'Too many detached revisions to scan safely; automatic integration is paused.')
    }
    const patchComparison = await comparePatchEquivalence({ candidates: detachedRevisions, repoRoot, snapshot, signal })
    const byWorkspace = new Map<string, { detached: ThreadRevision[]; represented: ThreadRevision[] }>()
    for (const revision of detachedRevisions) {
      const workspaceOutput = await readAtOperation(
        ['evolog', '--no-graph', '-n', '1', '-r', commitIdRevset(revision.commitId), '-T', 'self.operation().workspace_name() ++ "\\n"'],
        repoRoot,
        snapshot.operationId,
        signal,
      )
      const [workspaceName, ...extraWorkspaceNames] = workspaceOutput.split('\n').filter(line => line.length > 0)
      if (workspaceName === undefined || extraWorkspaceNames.length > 0 || !workspaceName.endsWith('@')) {
        throw new ThreadError('jj-failed', 'Could not attribute detached JJ work to one owning workspace; automatic integration is paused.')
      }
      const name = workspaceName.slice(0, -1)
      if (name.length === 0 || (name.startsWith('thread-') && !THREAD_WORKSPACE_NAME.test(name))) {
        throw new ThreadError('jj-failed', 'Detached JJ work has an unrecognized thread owner; automatic integration is paused.')
      }
      if (!THREAD_WORKSPACE_NAME.test(name)) continue
      const owned = byWorkspace.get(name) ?? { detached: [], represented: [] }
      if (patchComparison.equivalentCommitIds.has(revision.commitId)) owned.represented.push(revision)
      else owned.detached.push(revision)
      byWorkspace.set(name, owned)
    }
    return byWorkspace
  }

  const locate = async (path: string, signal?: AbortSignal): Promise<ThreadLocation> => {
    const result = await execute(['--ignore-working-copy', 'root'], path, signal)
    if (result.exitCode !== 0) throw new ThreadError('not-a-repository', `${path} is not inside a jj repository.`)
    const workspaceRoot = completeStdout(result).trim()
    const repoRoot = storeRootOf(workspaceRoot) ?? workspaceRoot
    const isThread = workspaceRoot !== repoRoot && dirname(workspaceRoot) === options.threadsDirectory(repoRoot)
    return { repoRoot, workspaceRoot, threadName: isThread ? basename(workspaceRoot) : undefined }
  }

  const requireThread = async (path: string, signal?: AbortSignal): Promise<ThreadLocation & { readonly threadName: string }> => {
    const location = await locate(path, signal)
    if (location.threadName === undefined || !THREAD_WORKSPACE_NAME.test(location.threadName)) {
      throw new ThreadError('not-a-thread', `${path} is not a managed thread workspace.`)
    }
    return { ...location, threadName: location.threadName }
  }

  const workingCopyCommitId = async (path: string, signal?: AbortSignal): Promise<string> => {
    const commitId = (await jj(['log', '--no-graph', '-r', '@', '-T', 'commit_id'], path, signal)).trim()
    if (!isCommitId(commitId)) throw new ThreadError('jj-failed', 'Could not resolve the current working-copy revision.')
    return commitId
  }

  const unlandedRevset = (name: string): string => `(::${name}@ ~ ::${bookmarkRevset(options.bookmark())}) ~ empty()`
  const unlandedRevsetAt = (name: string, bookmarkCommitId: string): string => `(::${name}@ ~ ::${commitIdRevset(bookmarkCommitId)}) ~ empty()`
  /**
   * Commits the bookmark has that this working copy lacks. Comparing the other way round counts the workspace's own
   * commits — including its always-present empty working copy — so a workspace that merely predates the bookmark's
   * advance looked like it held work to integrate.
   */
  const behindRevset = (workingCopy: string): string => `(::${bookmarkRevset(options.bookmark())} ~ ::${workingCopy}) ~ empty()`

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

  const scanRebasedState = async (input: {
    readonly repoRoot: string
    readonly cwd: string
    readonly threadName: string
    readonly bookmark: string
    readonly expectedBookmarkCommitId: string
    readonly authorize: () => Promise<boolean>
    readonly signal?: AbortSignal | undefined
  }): Promise<RebasedStateScan> => {
    if (!(await input.authorize())) return { status: 'not-eligible' }
    await jj(['workspace', 'update-stale'], input.cwd, input.signal)
    const workingCopyRevisionId = await workingCopyCommitId(input.cwd, input.signal)
    const snapshot = await readSnapshot(input.repoRoot, input.bookmark, input.signal)
    if (snapshot.bookmarkCommitId !== input.expectedBookmarkCommitId) return { status: 'bookmark-moved', snapshot }
    const [revisionsOnThread, detachedByWorkspace, emptyRevision] = await Promise.all([
      revisionsAtOperation(unlandedRevsetAt(input.threadName, snapshot.bookmarkCommitId), input.repoRoot, snapshot.operationId, input.signal),
      detachedRevisionsByWorkspace(input.repoRoot, snapshot, input.signal),
      revisionsAtOperation('@ & empty()', input.cwd, snapshot.operationId, input.signal, 1),
    ])
    const comparison = await comparePatchEquivalence({ candidates: revisionsOnThread, repoRoot: input.repoRoot, snapshot, signal: input.signal })
    const detached = detachedByWorkspace.get(input.threadName)?.detached ?? []
    return {
      status: 'ready',
      snapshot,
      revisions: revisionsOnThread,
      comparison,
      detached,
      workingCopyEmpty: emptyRevision.length > 0,
      workingCopyRevisionId,
    }
  }
  const timestampFile = (repoRoot: string): string => join(options.threadsDirectory(repoRoot), '.dshfiles-rebase-timestamps.json')
  const readRebaseMetadata = async (repoRoot: string): Promise<Readonly<Record<string, RebaseMetadataEntry>>> => {
    try {
      const parsed = JsonText.decode(rebaseMetadataSchema, await readFile(timestampFile(repoRoot), 'utf8'))
      if (parsed?.success !== true) return {}
      return Object.fromEntries(
        Object.entries(parsed.data)
          .filter(([name]) => name.startsWith('thread-'))
          .map(([name, value]) => [name, typeof value === 'number' ? { at: value } : value]),
      )
    } catch {
      return {}
    }
  }
  // An entry written before the history existed only knows its latest land.
  const integrationHistory = (metadata: RebaseMetadataEntry | undefined): readonly IntegrationRecord[] => {
    if (metadata === undefined) return []
    if (metadata.history !== undefined) return metadata.history
    return [metadata.tipChangeId === undefined ? { at: metadata.at } : { at: metadata.at, tipChangeId: metadata.tipChangeId }]
  }
  const writeRebaseMetadata = async (repoRoot: string, name: string, tipChangeId: string | undefined): Promise<number> => {
    const at = Date.now()
    const directory = options.threadsDirectory(repoRoot)
    await mkdir(directory, { recursive: true })
    const path = timestampFile(repoRoot)
    const temporaryPath = `${path}.${randomBytes(4).toString('hex')}.tmp`
    const record: IntegrationRecord = tipChangeId === undefined ? { at } : { at, tipChangeId }
    const existing = await readRebaseMetadata(repoRoot)
    const history = [...integrationHistory(existing[name]), record].slice(-MAX_INTEGRATION_HISTORY)
    const metadata = { ...existing, [name]: { ...record, history } }
    await writeFile(temporaryPath, JSON.stringify(metadata), 'utf8')
    await rename(temporaryPath, path)
    return at
  }
  const withRebaseMetadata = (status: ThreadStatus, metadata: RebaseMetadataEntry | undefined): ThreadStatus => {
    if (metadata === undefined) return status
    const statusWithTimestamp = { ...status, rebasedAt: metadata.at, integrations: integrationHistory(metadata) }
    if (metadata.tipChangeId === undefined) return statusWithTimestamp
    return { ...statusWithTimestamp, rebasedTipChangeId: metadata.tipChangeId }
  }

  const list = async (repoRoot: string): Promise<readonly ThreadStatus[]> => {
    const directory = options.threadsDirectory(repoRoot)
    const names = (await jj(['--ignore-working-copy', 'workspace', 'list', '-T', 'name ++ "\\n"'], repoRoot)).split('\n').filter(name => name.length > 0)
    const rebaseMetadata = await readRebaseMetadata(repoRoot)
    /** Two read-only `jj` calls per thread, run with bounded parallelism: a store with dozens of thread workspaces stays responsive. */
    const statuses = new Array<ThreadStatus | undefined>(names.length)
    let next = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        // oxlint-disable-next-line antislop/no-passthrough-variable -- The slot index is read again when the result is stored, so it is paired with its name before the shared cursor advances.
        const index = next
        next += 1
        const name = names[index]
        if (name === undefined) return
        const path = join(directory, name)
        const present = existsSync(join(path, '.jj'))
        if (!present && !name.startsWith('thread-')) continue
        const unlanded = await revisions(unlandedRevset(name), repoRoot, true)
        const behind = await revisions(behindRevset(`${name}@`), repoRoot, true, undefined, MAX_BEHIND_REVISIONS + 1)
        statuses[index] = withRebaseMetadata(
          {
            name,
            path,
            repoRoot,
            missing: !present,
            unlanded,
            behind: behind.length > 0,
            behindCount: Math.min(behind.length, MAX_BEHIND_REVISIONS),
          },
          rebaseMetadata[name],
        )
      }
    }
    await Promise.all(Array.from({ length: Math.min(STATUS_READ_CONCURRENCY, names.length) }, () => worker()))
    return statuses.filter((status): status is ThreadStatus => status !== undefined)
  }

  const status = async (repoRoot: string, name: string): Promise<ThreadStatus> => {
    const path = join(options.threadsDirectory(repoRoot), name)
    const bookmark = options.bookmark()
    const [unlanded, behind, rebaseMetadata] = await Promise.all([
      revisions(`(::@ ~ ::${bookmarkRevset(bookmark)}) ~ empty()`, path, true),
      revisions(behindRevset('@'), path, true, undefined, MAX_BEHIND_REVISIONS + 1),
      readRebaseMetadata(repoRoot),
    ])
    const threadStatus = {
      name,
      path,
      repoRoot,
      missing: !existsSync(join(path, '.jj')),
      unlanded,
      behind: behind.length > 0,
      behindCount: Math.min(behind.length, MAX_BEHIND_REVISIONS),
    }
    return withRebaseMetadata(threadStatus, rebaseMetadata[name])
  }

  const provision = (repoRoot: string, base?: string, requestedName?: string): Promise<{ readonly name: string; readonly path: string }> =>
    serialized(repoRoot, async () => {
      const name = requestedName ?? `thread-${randomBytes(3).toString('hex')}`
      const directory = options.threadsDirectory(repoRoot)
      const path = join(directory, name)
      await mkdir(directory, { recursive: true })
      // Plain `workspace add`: with --ignore-working-copy jj registers the workspace but never checks its files out.
      await jj(['workspace', 'add', path, '--name', name, '-r', base ?? options.bookmark()], repoRoot)
      return { name, path }
    })

  /**
   * Checks a thread workspace out again after its folder was deleted, so a Session pinned to it can still run.
   * A workspace JJ still knows keeps its working-copy revision; a forgotten one starts again from the bookmark.
   */
  const restore = (repoRoot: string, path: string): Promise<void> =>
    serialized(repoRoot, async () => {
      if (existsSync(join(path, '.jj'))) return
      const name = basename(path)
      if (!THREAD_WORKSPACE_NAME.test(name) || dirname(path) !== options.threadsDirectory(repoRoot)) {
        throw new ThreadError('not-a-thread', `${path} is not a managed thread workspace.`)
      }
      const [workingCopy] = (
        await jj(
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
        )
      )
        .split('\n')
        .filter(line => line.length > 0)
        .map(line => {
          const [commitId = '', parents = '', disposition] = line.split('\t')
          return { commitId, parentIds: parents.split(',').filter(isCommitId), kept: disposition === 'kept' }
        })
      await mkdir(dirname(path), { recursive: true })
      if (workingCopy === undefined) {
        await jj(['workspace', 'add', path, '--name', name, '-r', options.bookmark()], repoRoot)
        return
      }
      if (!isCommitId(workingCopy.commitId) || workingCopy.parentIds.length === 0) {
        throw new ThreadError('jj-failed', `Could not read the working copy of ${name}; refusing to restore it.`)
      }
      await jj(['workspace', 'forget', name], repoRoot)
      await jj(['workspace', 'add', path, '--name', name, ...workingCopy.parentIds.flatMap(commitId => ['-r', commitIdRevset(commitId)])], repoRoot)
      if (workingCopy.kept) await jj(['edit', commitIdRevset(workingCopy.commitId)], path)
    })

  const landVerified = async (input: VerifiedLandOptions): Promise<VerifiedLandOutcome> => {
    if (input.signal?.aborted) return { status: 'verification-cancelled' }
    const initialThread = await requireThread(input.path, input.signal)
    return serialized(initialThread.repoRoot, async () => {
      if (input.signal?.aborted) return { status: 'verification-cancelled' }
      const thread = await requireThread(input.path, input.signal)
      if (thread.repoRoot !== initialThread.repoRoot || thread.threadName !== initialThread.threadName) return { status: 'not-eligible' }
      const ensureAuthorized = async (): Promise<boolean> => await input.authorize(thread)
      if (!(await ensureAuthorized())) return { status: 'not-eligible' }
      const repoRoot = thread.repoRoot
      const cwd = thread.workspaceRoot
      const bookmark = input.bookmark ?? options.bookmark()
      const sourceRevision = await workingCopyCommitId(cwd, input.signal)
      if (sourceRevision !== input.expectedSourceRevision) {
        return {
          status: 'verification-stale',
          message: 'The thread changed after its completion checks passed. Stop for Project Checks again; automatic integration did not rebase it.',
        }
      }

      const snapshot = await readSnapshot(repoRoot, bookmark, input.signal)
      const detachedGroup = (await detachedRevisionsByWorkspace(repoRoot, snapshot, input.signal)).get(thread.threadName) ?? {
        detached: [],
        represented: [],
      }
      if (detachedGroup.detached.length > 0) return { status: 'detached-work', revisions: detachedGroup.detached }
      const work = await revisionsAtOperation(unlandedRevsetAt(thread.threadName, snapshot.bookmarkCommitId), cwd, snapshot.operationId, input.signal)
      const leftovers = await revisionsAtOperation(
        `((${commitIdRevset(snapshot.bookmarkCommitId)}..@) & empty()) ~ @ ~ merges() ~ working_copies()`,
        cwd,
        snapshot.operationId,
        input.signal,
      )
      if (work.length === 0) {
        return detachedGroup.represented.length > 0 ? { status: 'already-integrated', revisions: detachedGroup.represented } : { status: 'nothing-to-land' }
      }
      const initialPatchComparison = await comparePatchEquivalence({ candidates: work, repoRoot, snapshot, signal: input.signal })
      const initialPatchBlock = patchGuardOutcome(work, initialPatchComparison)
      if (initialPatchBlock !== undefined) return initialPatchBlock
      const undescribed = work.filter(revision => ThreadIntegrationModel.isPlaceholderRevisionDescription(revision.description))
      if (undescribed.length > 0) return { status: 'needs-description', revisions: undescribed }

      if (!(await ensureAuthorized())) return { status: 'not-eligible' }
      if ((await workingCopyCommitId(cwd, input.signal)) !== sourceRevision) {
        return {
          status: 'verification-stale',
          message: 'The thread changed during the patch scan. Stop for Project Checks again; automatic integration did not rebase it.',
        }
      }
      if (leftovers.length > 0) {
        if (!(await ensureAuthorized())) return { status: 'not-eligible' }
        await jj(['abandon', ...leftovers.map(revision => commitIdRevset(revision.commitId))], cwd, input.signal)
      }

      for (let attempt = 1; ; attempt++) {
        if (input.signal?.aborted) return { status: 'verification-cancelled' }
        if (!(await ensureAuthorized())) return { status: 'not-eligible' }
        const attemptSourceRevision = await workingCopyCommitId(cwd, input.signal)
        if (attempt === 1 && attemptSourceRevision !== input.expectedSourceRevision) {
          return {
            status: 'verification-stale',
            message: 'The thread changed after its completion checks passed. Stop for Project Checks again; automatic integration did not rebase it.',
          }
        }
        const attemptSnapshot = await readSnapshot(repoRoot, bookmark, input.signal)
        const attemptWorkspaceRevision = await revisionsAtOperation('@', cwd, attemptSnapshot.operationId, input.signal)
        if (attemptWorkspaceRevision[0]?.commitId !== attemptSourceRevision) {
          return {
            status: 'verification-stale',
            message: 'The thread changed during the patch scan. Stop for Project Checks again; automatic integration did not rebase it.',
          }
        }
        const attemptDetachedGroup = (await detachedRevisionsByWorkspace(repoRoot, attemptSnapshot, input.signal)).get(thread.threadName) ?? {
          detached: [],
          represented: [],
        }
        if (attemptDetachedGroup.detached.length > 0) return { status: 'detached-work', revisions: attemptDetachedGroup.detached }
        const attemptWork = await revisionsAtOperation(
          unlandedRevsetAt(thread.threadName, attemptSnapshot.bookmarkCommitId),
          cwd,
          attemptSnapshot.operationId,
          input.signal,
        )
        const patchComparison = await comparePatchEquivalence({ candidates: attemptWork, repoRoot, snapshot: attemptSnapshot, signal: input.signal })
        if (!workMetadataMatches(work, attemptWork) || !patchFingerprintsMatch(initialPatchComparison, patchComparison)) {
          return {
            status: 'verification-stale',
            message: 'The thread work changed after its initial scan. Review the current work and run Project Checks again.',
          }
        }
        if (attemptWork.length === 0) {
          return attemptDetachedGroup.represented.length > 0
            ? { status: 'already-integrated', revisions: attemptDetachedGroup.represented }
            : { status: 'nothing-to-land' }
        }
        const patchBlock = patchGuardOutcome(attemptWork, patchComparison)
        if (patchBlock !== undefined) return patchBlock
        const attemptUndescribed = attemptWork.filter(revision => ThreadIntegrationModel.isPlaceholderRevisionDescription(revision.description))
        if (attemptUndescribed.length > 0) return { status: 'needs-description', revisions: attemptUndescribed }
        if (!(await ensureAuthorized())) return { status: 'not-eligible' }
        if ((await workingCopyCommitId(cwd, input.signal)) !== attemptSourceRevision) {
          return {
            status: 'verification-stale',
            message: 'The thread changed during the patch scan. Stop for Project Checks again; automatic integration did not rebase it.',
          }
        }
        const latestSnapshot = await readSnapshot(repoRoot, bookmark, input.signal)
        if (latestSnapshot.bookmarkCommitId !== attemptSnapshot.bookmarkCommitId) {
          const targetMovedForward = await bookmarkTargetDescendsFrom({
            repoRoot,
            operationId: latestSnapshot.operationId,
            expectedCommitId: attemptSnapshot.bookmarkCommitId,
            currentCommitId: latestSnapshot.bookmarkCommitId,
            signal: input.signal,
          })
          if (!targetMovedForward) {
            return { status: 'verification-stale', message: 'The target bookmark moved backwards or sideways during scanning; review it before retrying.' }
          }
          if (attempt >= LAND_ATTEMPTS) {
            return {
              status: 'verification-stale',
              message: 'The repository changed during the patch scan. Retry integration after the current changes settle.',
            }
          }
          continue
        }
        if (latestSnapshot.operationId !== attemptSnapshot.operationId) {
          if (attempt >= LAND_ATTEMPTS) {
            return {
              status: 'verification-stale',
              message: 'The repository changed during the patch scan. Retry integration after the current changes settle.',
            }
          }
          continue
        }
        if (!(await ensureAuthorized())) return { status: 'not-eligible' }
        await jj(
          [
            '--at-operation',
            attemptSnapshot.operationId,
            'rebase',
            '-b',
            commitIdRevset(attemptSourceRevision),
            '-d',
            commitIdRevset(attemptSnapshot.bookmarkCommitId),
          ],
          cwd,
          input.signal,
        )
        if (input.signal?.aborted) return { status: 'verification-cancelled' }
        const afterRebase = await scanRebasedState({
          repoRoot,
          cwd,
          threadName: thread.threadName,
          bookmark,
          expectedBookmarkCommitId: attemptSnapshot.bookmarkCommitId,
          authorize: ensureAuthorized,
          signal: input.signal,
        })
        if (afterRebase.status === 'not-eligible') return { status: 'not-eligible' }
        if (afterRebase.status === 'bookmark-moved') {
          const targetMovedForward = await bookmarkTargetDescendsFrom({
            repoRoot,
            operationId: afterRebase.snapshot.operationId,
            expectedCommitId: attemptSnapshot.bookmarkCommitId,
            currentCommitId: afterRebase.snapshot.bookmarkCommitId,
            signal: input.signal,
          })
          if (!targetMovedForward) {
            return { status: 'verification-stale', message: 'The target bookmark moved backwards or sideways during rebase; review it before retrying.' }
          }
          if (attempt >= LAND_ATTEMPTS)
            return { status: 'verification-stale', message: 'The bookmark changed during rebase. Retry integration after the current changes settle.' }
          continue
        }
        const rebased = afterRebase.revisions
        let workingCopyEmpty = afterRebase.workingCopyEmpty
        const conflicted = rebased.filter(revision => revision.conflict)
        if (conflicted.length > 0) {
          const files = new Set<string>()
          for (const revision of conflicted) {
            const listed = await execute(['resolve', '--list', '-r', commitIdRevset(revision.commitId)], cwd, input.signal)
            if (listed.exitCode !== 0) throw new ThreadError('jj-failed', `jj resolve --list failed: ${listed.stderr.trim().slice(0, 400)}`)
            for (const line of completeStdout(listed).split('\n')) {
              const file = line.trim().split(/\s{2,}/)[0]
              if (file !== undefined && file.length > 0) files.add(file)
            }
          }
          return { status: 'conflicted', revisions: conflicted, files: [...files].slice(0, MAX_CONFLICT_FILES) }
        }
        if (afterRebase.detached.length > 0) return { status: 'detached-work', revisions: afterRebase.detached }
        if (!workMetadataMatches(work, rebased) || !patchFingerprintsMatch(initialPatchComparison, afterRebase.comparison)) {
          return {
            status: 'verification-stale',
            message: 'The thread changed during rebase. The bookmark was not advanced; retry after reviewing the current work.',
          }
        }
        const [candidateRevision, ...extraCandidateRevisions] = await revisionsAtOperation(
          workingCopyEmpty ? '@-' : '@',
          cwd,
          afterRebase.snapshot.operationId,
          input.signal,
        )
        if (candidateRevision === undefined || extraCandidateRevisions.length > 0) {
          return { status: 'verification-stale', message: 'Could not identify one checked revision to advance the bookmark to.' }
        }

        if (input.signal?.aborted) return { status: 'verification-cancelled' }
        if (!(await ensureAuthorized())) return { status: 'not-eligible' }
        await jj(['edit', commitIdRevset(candidateRevision.commitId)], cwd, input.signal)
        const verificationState = await scanRebasedState({
          repoRoot,
          cwd,
          threadName: thread.threadName,
          bookmark,
          expectedBookmarkCommitId: attemptSnapshot.bookmarkCommitId,
          authorize: ensureAuthorized,
          signal: input.signal,
        })
        if (verificationState.status === 'not-eligible') return { status: 'not-eligible' }
        if (verificationState.status === 'bookmark-moved') {
          const targetMovedForward = await bookmarkTargetDescendsFrom({
            repoRoot,
            operationId: verificationState.snapshot.operationId,
            expectedCommitId: attemptSnapshot.bookmarkCommitId,
            currentCommitId: verificationState.snapshot.bookmarkCommitId,
            signal: input.signal,
          })
          if (!targetMovedForward) return { status: 'verification-stale', message: 'The target bookmark moved backwards or sideways before Project Checks.' }
          if (attempt >= LAND_ATTEMPTS)
            return { status: 'verification-stale', message: 'The bookmark changed while preparing Project Checks; retry integration.' }
          continue
        }
        if (
          verificationState.workingCopyRevisionId !== candidateRevision.commitId ||
          verificationState.detached.length > 0 ||
          !workMetadataMatches(work, verificationState.revisions) ||
          !patchFingerprintsMatch(initialPatchComparison, verificationState.comparison)
        ) {
          return {
            status: 'verification-stale',
            message: 'The thread changed while preparing Project Checks. The bookmark was not advanced; retry after reviewing the current work.',
          }
        }
        if (verificationState.revisions.some(revision => revision.conflict)) {
          return { status: 'verification-stale', message: 'A conflict appeared while preparing Project Checks; resolve it before retrying.' }
        }
        workingCopyEmpty = false
        if (!(await ensureAuthorized())) return { status: 'not-eligible' }
        const verification = await input.verifyCandidate({ workingCopyCommitId: candidateRevision.commitId, attempt })
        if (verification.status === 'cancelled' || input.signal?.aborted) return { status: 'verification-cancelled' }
        if (verification.status === 'stale') return { status: 'verification-stale', message: verification.message }
        if (verification.status === 'failed') return { status: 'verification-failed', message: verification.message }
        const postVerificationState = await scanRebasedState({
          repoRoot,
          cwd,
          threadName: thread.threadName,
          bookmark,
          expectedBookmarkCommitId: attemptSnapshot.bookmarkCommitId,
          authorize: ensureAuthorized,
          signal: input.signal,
        })
        if (postVerificationState.status === 'not-eligible') return { status: 'not-eligible' }
        if (postVerificationState.status === 'bookmark-moved') {
          const targetMovedForward = await bookmarkTargetDescendsFrom({
            repoRoot,
            operationId: postVerificationState.snapshot.operationId,
            expectedCommitId: attemptSnapshot.bookmarkCommitId,
            currentCommitId: postVerificationState.snapshot.bookmarkCommitId,
            signal: input.signal,
          })
          if (!targetMovedForward) {
            return { status: 'verification-stale', message: 'The target bookmark moved backwards or sideways during Project Checks.' }
          }
          if (attempt >= LAND_ATTEMPTS) return { status: 'verification-stale', message: 'The bookmark changed while Project Checks ran; retry integration.' }
          continue
        }
        if (
          postVerificationState.workingCopyRevisionId !== candidateRevision.commitId ||
          postVerificationState.detached.length > 0 ||
          !workMetadataMatches(work, postVerificationState.revisions) ||
          !patchFingerprintsMatch(initialPatchComparison, postVerificationState.comparison)
        ) {
          return {
            status: 'verification-stale',
            message: 'The thread changed while Project Checks ran. The bookmark was not advanced; review the current work.',
          }
        }

        const beforeMoveSnapshot = await readSnapshot(repoRoot, bookmark, input.signal)
        if (beforeMoveSnapshot.bookmarkCommitId !== attemptSnapshot.bookmarkCommitId) {
          const targetMovedForward = await bookmarkTargetDescendsFrom({
            repoRoot,
            operationId: beforeMoveSnapshot.operationId,
            expectedCommitId: attemptSnapshot.bookmarkCommitId,
            currentCommitId: beforeMoveSnapshot.bookmarkCommitId,
            signal: input.signal,
          })
          if (!targetMovedForward) {
            return { status: 'verification-stale', message: 'The target bookmark moved backwards or sideways before landing; review it before retrying.' }
          }
          if (attempt >= LAND_ATTEMPTS)
            return { status: 'verification-stale', message: 'The bookmark moved before landing. Retry integration after the current changes settle.' }
          continue
        }
        if (input.signal?.aborted) return { status: 'verification-cancelled' }
        if (!(await ensureAuthorized())) return { status: 'not-eligible' }
        const moved = await execute(
          [
            '--ignore-working-copy',
            'bookmark',
            'move',
            '--from',
            commitIdRevset(attemptSnapshot.bookmarkCommitId),
            '--to',
            commitIdRevset(candidateRevision.commitId),
            exactBookmarkNamePattern(bookmark),
          ],
          cwd,
          input.signal,
        )
        const afterMoveSnapshot = await readSnapshot(repoRoot, bookmark)
        const candidateIsOnBookmark = await bookmarkTargetDescendsFrom({
          repoRoot,
          operationId: afterMoveSnapshot.operationId,
          expectedCommitId: candidateRevision.commitId,
          currentCommitId: afterMoveSnapshot.bookmarkCommitId,
        })
        if (candidateIsOnBookmark) {
          if (!workingCopyEmpty && (await ensureAuthorized().catch(() => false))) {
            await jj(['new', commitIdRevset(afterMoveSnapshot.bookmarkCommitId)], cwd).catch(() => undefined)
          }
          await writeRebaseMetadata(thread.repoRoot, thread.threadName, candidateRevision.changeId).catch(() => undefined)
          return { status: 'landed', revisions: rebased, head: candidateRevision }
        }
        if (input.signal?.aborted) return { status: 'verification-cancelled' }
        const targetMovedForward = await bookmarkTargetDescendsFrom({
          repoRoot,
          operationId: afterMoveSnapshot.operationId,
          expectedCommitId: attemptSnapshot.bookmarkCommitId,
          currentCommitId: afterMoveSnapshot.bookmarkCommitId,
          signal: input.signal,
        })
        if (!targetMovedForward) {
          return { status: 'verification-stale', message: 'The target bookmark moved backwards or sideways while landing; review it before retrying.' }
        }
        if (attempt >= LAND_ATTEMPTS) {
          if (moved.exitCode !== 0) throw new ThreadError('jj-failed', `Could not move ${bookmark}: ${moved.stderr.trim().slice(0, 400)}`)
          return { status: 'verification-stale', message: 'The bookmark changed before the checked revision could be landed; retry integration.' }
        }
      }
    })
  }

  const landAt = async (
    thread: ThreadLocation & { readonly threadName: string },
    input: {
      readonly bookmark?: string | undefined
      readonly signal?: AbortSignal | undefined
      readonly validate?: () => Promise<void>
      readonly onProgress?: (phase: 'queued' | 'validating' | 'rebasing') => void
    } = {},
  ): Promise<LandOutcome> => {
    input.onProgress?.('queued')
    return serialized(thread.repoRoot, async () => {
      input.onProgress?.('validating')
      await input.validate?.()
      const cwd = thread.workspaceRoot
      const bookmark = input.bookmark ?? options.bookmark()

      for (let attempt = 1; ; attempt++) {
        input.onProgress?.('rebasing')
        await jj(['rebase', '-b', '@', '-d', bookmark, '--skip-emptied'], cwd, input.signal)
        const postRebase = await landRevisions(
          `((${bookmark}..@) ~ empty()) | (((${bookmark}..@) & empty()) ~ @ ~ merges() ~ working_copies()) | (@ & empty())`,
          cwd,
          true,
        )
        const leftovers = postRebase.filter(item => item.empty && !item.currentWorkingCopy).map(item => item.revision)
        if (leftovers.length > 0) {
          await jj(['abandon', ...leftovers.map(revision => revision.commitId)], cwd, input.signal)
          continue
        }
        const rebased = postRebase.filter(item => !item.empty).map(item => item.revision)
        if (rebased.length === 0) return { status: 'nothing-to-land' }
        const undescribed = rebased.filter(revision => ThreadIntegrationModel.isPlaceholderRevisionDescription(revision.description))
        if (undescribed.length > 0) return { status: 'needs-description', revisions: undescribed }
        const conflicted = rebased.filter(revision => revision.conflict)
        if (conflicted.length > 0) {
          const files = new Set<string>()
          for (const revision of conflicted) {
            const listed = await execute(['resolve', '--list', '-r', commitIdRevset(revision.commitId)], cwd, input.signal)
            if (listed.exitCode !== 0) throw new ThreadError('jj-failed', `jj resolve --list failed: ${listed.stderr.trim().slice(0, 400)}`)
            for (const line of completeStdout(listed).split('\n')) {
              const file = line.trim().split(/\s{2,}/)[0]
              if (file !== undefined && file.length > 0) files.add(file)
            }
          }
          return { status: 'conflicted', revisions: conflicted, files: [...files].slice(0, MAX_CONFLICT_FILES) }
        }
        const workingCopyEmpty = postRebase.some(item => item.empty && item.currentWorkingCopy)
        const target = workingCopyEmpty ? '@-' : '@'
        // A bookmark only moves forward; if another writer advanced it meanwhile, rebase again onto the new tip.
        const moved = await execute(['bookmark', 'set', bookmark, '-r', target], cwd, input.signal)
        if (moved.exitCode === 0) {
          if (!workingCopyEmpty) await jj(['new', bookmark], cwd, input.signal)
          const head = rebased[0]
          if (head === undefined) throw new ThreadError('jj-failed', 'The rebased revisions have no bookmark head.')
          await writeRebaseMetadata(thread.repoRoot, thread.threadName, head.changeId).catch(() => undefined)
          return { status: 'landed', revisions: rebased, head }
        }
        if (attempt >= LAND_ATTEMPTS) throw new ThreadError('jj-failed', `Could not move ${bookmark}: ${moved.stderr.trim().slice(0, 400)}`)
      }
    })
  }

  const land = async (
    path: string,
    input: {
      readonly signal?: AbortSignal | undefined
      readonly validate?: () => Promise<void>
      readonly onProgress?: (phase: 'queued' | 'validating' | 'rebasing') => void
    } = {},
  ): Promise<LandOutcome> => landAt(await requireThread(path), input)

  const discard = (input: { readonly repoRoot: string; readonly name: string; readonly force: boolean }): Promise<DiscardOutcome> =>
    serialized(input.repoRoot, async () => {
      const { repoRoot, name: threadName } = input
      if (threadName.includes('/') || threadName.startsWith('.')) throw new ThreadError('unsafe-path', `Refusing to discard workspace ${threadName}.`)
      const directory = options.threadsDirectory(repoRoot)
      const workspaceRoot = join(directory, threadName)
      // Snapshot first so edits still on disk count as work.
      if (existsSync(join(workspaceRoot, '.jj'))) await jj(['status'], workspaceRoot)
      const work = await revisions(unlandedRevset(threadName), repoRoot, true)
      if (work.length > 0 && !input.force) return { status: 'has-work', revisions: work }
      const owned = await revisions(`(::${threadName}@ ~ ::${options.bookmark()}) ~ ::(working_copies() ~ ${threadName}@)`, repoRoot, true)
      await jj(['--ignore-working-copy', 'workspace', 'forget', threadName], repoRoot)
      if (owned.length > 0) await jj(['--ignore-working-copy', 'abandon', ...owned.map(revision => revision.commitId)], repoRoot)
      await rm(workspaceRoot, { recursive: true, force: true })
      return { status: 'discarded' }
    })

  /** Local bookmarks, and the nearest one the workspace at `path` builds on. */
  const bookmarks = async (path: string): Promise<{ readonly current: string | null; readonly names: readonly string[] }> => {
    const [listed, nearest] = await Promise.all([
      jj(['--ignore-working-copy', 'bookmark', 'list', '-T', 'if(remote, "", name ++ "\\n")'], path),
      jj(
        ['--ignore-working-copy', 'log', '--no-graph', '-r', 'heads(::@ & bookmarks())', '-T', 'local_bookmarks.map(|b| b.name()).join("\\n") ++ "\\n"'],
        path,
      ),
    ])
    const names = listed.split('\n').filter(name => name.length > 0)
    const preferred = options.bookmark()
    const candidates = nearest.split('\n').filter(name => name.length > 0)
    return { current: candidates.includes(preferred) ? preferred : (candidates[0] ?? null), names: [...new Set(names)] }
  }

  const revisionGraph = async (path: string): Promise<string> => {
    const thread = await requireThread(path)
    const operationId = (await jj(['--ignore-working-copy', 'op', 'log', '--limit', '1', '--no-graph', '-T', 'id'], thread.workspaceRoot)).trim()
    if (operationId.length === 0) throw new ThreadError('jj-failed', 'Could not read the current jj operation.')

    const readAtOperation = (args: readonly string[]): Promise<string> =>
      jj(['--ignore-working-copy', '--at-operation', operationId, ...args], thread.workspaceRoot)
    const workspaceNames = (await readAtOperation(['workspace', 'list', '-T', 'name ++ "\\n"'])).split('\n')
    const hasDefaultWorkspace = workspaceNames.includes('default')
    const commitIdSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u)
    const defaultCommitId = hasDefaultWorkspace
      ? commitIdSchema.safeParse((await readAtOperation(['log', '--no-graph', '-r', 'default@', '-T', 'commit_id.short(64)'])).trim())
      : undefined
    if (defaultCommitId !== undefined && !defaultCommitId.success) {
      throw new ThreadError('jj-failed', 'Could not resolve the default workspace revision.')
    }
    const defaultWorkspaceLabel = defaultCommitId === undefined ? '""' : `if(commit_id.short(64) == "${defaultCommitId.data}", "default@", "")`
    const bookmark = options.bookmark()
    const bookmarkLiteral = JSON.stringify(bookmark)
    const threadRevisionLimit = 16
    const threadRevisionLines = (
      await readAtOperation(['log', '--no-graph', '--limit', String(threadRevisionLimit), '-r', `::@ ~ ::${bookmark}`, '-T', 'commit_id ++ "\\n"'])
    )
      .split('\n')
      .filter(line => line.length > 0)
    const threadRevisionIds = z.array(commitIdSchema).max(threadRevisionLimit).safeParse(threadRevisionLines)
    if (!threadRevisionIds.success) throw new ThreadError('jj-failed', 'Could not read thread revision IDs for the graph.')
    const revset = ['@', ...threadRevisionIds.data, bookmark, `present(${bookmark}@origin)`, ...(hasDefaultWorkspace ? ['default@'] : [])].join(' | ')
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
    return (await readAtOperation(['log', '--no-pager', '--color=never', '--limit', '20', '-r', revset, '-T', template])).trimEnd()
  }

  return { locate, list, status, provision, restore, land, landAt, landVerified, discard, bookmarks, workingCopyCommitId, revisionGraph }
}

export type Threads = ReturnType<typeof createThreads>

const defaultThreadsDirectory = (repoRoot: string): string => `${repoRoot}-threads`

/** `dshx checkout sync` from the dshx this plugin builds with; accepts an exact landed commit or the bookmark tip. */
const checkoutSyncArgv = (input: {
  readonly repoRoot: string
  readonly workspace: string
  readonly bookmark: string
  readonly revision?: string | undefined
}): readonly string[] => [
  process.execPath,
  join(dirname(createRequire(import.meta.url).resolve('@dshfiles/dshx')), 'cli', 'bin.js'),
  'checkout',
  'sync',
  '--workspace',
  input.workspace,
  '--bookmark',
  input.bookmark,
  ...(input.revision === undefined ? [] : ['--revision', input.revision]),
  '--cwd',
  input.repoRoot,
  '--json',
]

export class ThreadWorkspaceModel {
  static readonly isSecondaryWorkspace = isSecondaryWorkspace
  static readonly defaultThreadsDirectory = defaultThreadsDirectory
  static readonly checkoutSyncArgv = checkoutSyncArgv
}
