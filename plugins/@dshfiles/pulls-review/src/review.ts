import { stat } from 'node:fs/promises'
import { MAX_PATCH_CHARS, type ReviewFailureReason, type ReviewResult } from './api.js'
import { JjCommandError, JjUnavailableError, type JjRun } from './jj.js'
import { groupPatch } from './scopes.js'

/** Base bookmarks tried in order when the caller does not name one. */
const BASE_CANDIDATES = ['main', 'master', 'trunk'] as const
const HEAD_REVISION = '@'
const REVISION_TEMPLATE = 'commit_id.short()'

const failure = (path: string, reason: ReviewFailureReason, message: string): ReviewResult => ({ status: 'failed', path, reason, message })

const isDirectory = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

const resolves = async (run: JjRun, input: { path: string; revision: string; signal?: AbortSignal | undefined }): Promise<boolean> => {
  try {
    const output = await run({
      path: input.path,
      args: ['log', '-r', input.revision, '--no-graph', '-T', REVISION_TEMPLATE],
      signal: input.signal,
      outputLimit: 4_096,
    })
    return output.stdout.trim().length > 0
  } catch (error) {
    // An unknown revision just means this candidate is absent; a workspace that
    // is not a jj repository must not be reported as a missing base bookmark.
    if (error instanceof JjCommandError && error.reason === 'jj-failed') return false
    throw error
  }
}

const resolveBase = async (
  run: JjRun,
  input: { path: string; requested?: string | undefined; signal?: AbortSignal | undefined },
): Promise<string | undefined> => {
  if (input.requested !== undefined && input.requested.length > 0) {
    return (await resolves(run, { path: input.path, revision: input.requested, signal: input.signal })) ? input.requested : undefined
  }
  for (const candidate of BASE_CANDIDATES) {
    if (await resolves(run, { path: input.path, revision: candidate, signal: input.signal })) return candidate
  }
  return undefined
}

export interface ReviewWorkspaceInput {
  readonly run: JjRun
  readonly path: string
  readonly base?: string | undefined
  readonly signal?: AbortSignal | undefined
}

/** The argv the Host builds for a review; exported so a test can drive the same one. */
const revisionArgs = (revision: string): readonly string[] => ['log', '-r', revision, '--no-graph', '-T', REVISION_TEMPLATE]

const diffArgs = (base: string): readonly string[] => ['diff', '--git', '--from', base, '--to', HEAD_REVISION]

/** Read one thread workspace's changes since its base bookmark and group them. */
const reviewWorkspace = async (input: ReviewWorkspaceInput): Promise<ReviewResult> => {
  if (!(await isDirectory(input.path))) return failure(input.path, 'workspace-missing', 'That thread workspace is no longer on disk.')
  try {
    const base = await resolveBase(input.run, { path: input.path, requested: input.base, signal: input.signal })
    if (base === undefined) {
      return failure(input.path, 'no-base', `No base bookmark found; expected one of ${BASE_CANDIDATES.join(', ')}.`)
    }
    const head = (
      await input.run({
        path: input.path,
        args: revisionArgs(HEAD_REVISION),
        signal: input.signal,
        outputLimit: 4_096,
      })
    ).stdout.trim()
    if (head.length === 0) return failure(input.path, 'jj-failed', 'The working-copy revision could not be read.')
    const diff = await input.run({
      path: input.path,
      args: diffArgs(base),
      signal: input.signal,
      outputLimit: MAX_PATCH_CHARS,
    })
    const grouped = await groupPatch({ patch: diff.stdout, title: `${base}..${HEAD_REVISION}` })
    return {
      status: 'ok',
      path: input.path,
      base,
      head,
      range: `${base}..${HEAD_REVISION}`,
      patch: diff.stdout,
      truncated: diff.truncated || grouped.clipped,
      fileCount: grouped.fileCount,
      additions: grouped.additions,
      deletions: grouped.deletions,
      files: [...grouped.files],
      scopes: [...grouped.scopes],
    }
  } catch (error) {
    if (error instanceof JjUnavailableError) return failure(input.path, 'jj-missing', 'Jujutsu (jj) is not available to the Host.')
    if (error instanceof JjCommandError) {
      return error.reason === 'not-a-repository'
        ? failure(input.path, 'not-a-repository', 'That thread workspace is not a Jujutsu repository.')
        : failure(input.path, 'jj-failed', 'Jujutsu could not read this workspace.')
    }
    throw error
  }
}

export class ReviewWorkspaceModel {
  static readonly resolveBase = resolveBase
  static readonly revisionArgs = revisionArgs
  static readonly diffArgs = diffArgs
  static readonly review = reviewWorkspace
}
