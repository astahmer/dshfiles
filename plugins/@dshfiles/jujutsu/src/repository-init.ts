import { lstat, open, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/** The Host supplies its traced, managed JJ runner. No process is spawned here. */
export type RepositoryInitRunner = (
  cwd: string,
  args: readonly string[],
  signal?: AbortSignal,
) => Promise<{ readonly stdout: string; readonly truncated: boolean }>

export interface EnsuredJujutsuRepository {
  readonly root: string
  readonly initialized: boolean
}

/** Only these static messages may cross the Host API boundary. */
export class RepositoryInitializationError extends Error {}

const messages = {
  path: 'Selected repository path must be an existing directory.',
  missing: 'Selected directory is not inside an existing Git or Jujutsu checkout.',
  marker: 'Repository metadata is invalid. Existing metadata was left untouched.',
  changed: 'Repository identity changed before initialization. Open the repository again.',
  existing: 'Existing Jujutsu metadata could not be opened. It was left untouched.',
  init: 'Jujutsu could not initialize this Git checkout. Existing files and metadata were not replaced.',
  worktree: 'Jujutsu could not initialize this Git worktree. This JJ version may not support Git worktrees; existing metadata was not replaced.',
  root: 'Jujutsu did not confirm the exact selected repository root.',
  cancelled: 'Jujutsu request was cancelled.',
} as const

type Boundary = { readonly root: string; readonly kind: 'jj' | 'git'; readonly identity: string; readonly worktree: boolean }
const pendingInits = new Map<string, Promise<EnsuredJujutsuRepository>>()

function fail(message: string): never {
  throw new RepositoryInitializationError(message)
}
const checkCancelled = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted === true) fail(messages.cancelled)
}
const isMissing = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT'
const entry = async (path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> => {
  try {
    return await lstat(path)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}
const identity = (value: Awaited<ReturnType<typeof stat>>): string => `${value.dev}:${value.ino}`

/** Read at most 8 KiB, even if a malformed marker grows during inspection. */
const readMarker = async (path: string): Promise<string> => {
  const file = await open(path, 'r')
  try {
    const metadata = await file.stat()
    if (!metadata.isFile() || metadata.size > 8192) fail(messages.marker)
    const { buffer, bytesRead } = await file.read(Buffer.alloc(8193), 0, 8193, 0)
    if (bytesRead > 8192) fail(messages.marker)
    return buffer.toString('utf8', 0, bytesRead)
  } finally {
    await file.close()
  }
}

const validateJjMarker = async (root: string): Promise<void> => {
  const jjPath = join(root, '.jj')
  const jj = await lstat(jjPath)
  if (!jj.isDirectory()) fail(messages.existing)
  await directoryIdentity(join(jjPath, 'working_copy'))
  const repoPath = join(jjPath, 'repo')
  const repo = await lstat(repoPath)
  if (!repo.isDirectory() && !repo.isFile()) fail(messages.existing)
  let storeRoot = repoPath
  if (repo.isFile()) {
    const pointer = (await readMarker(repoPath)).trim()
    if (pointer.length === 0 || /[\r\n\0]/u.test(pointer)) fail(messages.existing)
    storeRoot = resolve(jjPath, pointer)
  }
  await directoryIdentity(join(storeRoot, 'store'))
}

const directoryIdentity = async (path: string): Promise<string> => {
  const value = await stat(path)
  if (!value.isDirectory()) fail(messages.marker)
  return `${await realpath(path)}:${identity(value)}`
}

/** A gitdir file (linked worktree or --separate-git-dir) is a boundary too. */
const gitIdentity = async (root: string, marker: Awaited<ReturnType<typeof lstat>>): Promise<string> => {
  if (!marker.isDirectory() && !marker.isFile()) fail(messages.marker)
  const markerPath = join(root, '.git')
  const pointer = marker.isFile() ? await readMarker(markerPath) : ''
  const match = marker.isFile() ? /^gitdir: ([^\r\n\0]+)\r?\n?$/u.exec(pointer) : undefined
  if (marker.isFile() && match?.[1] === undefined) fail(messages.marker)
  const gitDir = await realpath(marker.isFile() ? resolve(root, match?.[1] ?? '') : markerPath)
  const gitDirIdentity = await directoryIdentity(gitDir)
  const head = await lstat(join(gitDir, 'HEAD'))
  if (!head.isFile()) fail(messages.marker)
  const commonMarker = await entry(join(gitDir, 'commondir'))
  if (commonMarker !== undefined && !commonMarker.isFile()) fail(messages.marker)
  const commonPointer = commonMarker === undefined ? '' : await readMarker(join(gitDir, 'commondir'))
  if (commonMarker !== undefined && (commonPointer.trim().length === 0 || commonPointer.includes('\0'))) fail(messages.marker)
  const commonDir = commonMarker === undefined ? gitDir : await realpath(resolve(gitDir, commonPointer.trim()))
  const commonIdentity = await directoryIdentity(commonDir)
  await directoryIdentity(join(commonDir, 'objects'))
  await directoryIdentity(join(commonDir, 'refs'))
  return JSON.stringify([identity(await stat(root)), identity(marker), pointer, gitDirIdentity, commonPointer, commonIdentity])
}

const discover = async (selection: string, signal: AbortSignal | undefined): Promise<Boundary> => {
  let root = selection
  for (;;) {
    checkCancelled(signal)
    const jj = await entry(join(root, '.jj'))
    if (jj !== undefined) return { root, kind: 'jj', identity: identity(await stat(root)), worktree: false }
    const git = await entry(join(root, '.git'))
    if (git !== undefined) {
      // A malformed nested marker must never fall through to an outer checkout.
      const fingerprint = await gitIdentity(root, git)
      return { root, kind: 'git', identity: fingerprint, worktree: git.isFile() }
    }
    // Stop inside bare repositories and Git administration directories, even
    // when they happen to be nested inside another working checkout.
    if (
      (await entry(join(root, 'HEAD'))) !== undefined &&
      (await entry(join(root, 'objects'))) !== undefined &&
      (await entry(join(root, 'refs'))) !== undefined
    ) {
      fail(messages.missing)
    }
    const parent = dirname(root)
    if (parent === root) fail(messages.missing)
    root = parent
  }
}

const verifyRoot = async (root: string, runJj: RepositoryInitRunner, signal: AbortSignal | undefined, existing: boolean): Promise<void> => {
  checkCancelled(signal)
  let output: Awaited<ReturnType<RepositoryInitRunner>>
  try {
    await validateJjMarker(root)
    output = await runJj(root, ['--ignore-working-copy', 'root'], signal)
  } catch {
    checkCancelled(signal)
    fail(existing ? messages.existing : messages.root)
  }
  const line = output.stdout.trim()
  if (output.truncated || line.length === 0 || /[\r\n\0]/u.test(line) || !isAbsolute(line)) fail(messages.root)
  if ((await realpath(line)) !== root) fail(messages.root)
}

const waitFor = (pending: Promise<EnsuredJujutsuRepository>, signal: AbortSignal | undefined): Promise<EnsuredJujutsuRepository> => {
  checkCancelled(signal)
  if (signal === undefined) return pending
  return new Promise((resolveResult, reject) => {
    const cancelled = (): void => reject(new RepositoryInitializationError(messages.cancelled))
    signal.addEventListener('abort', cancelled, { once: true })
    pending.then(resolveResult, reject).finally(() => signal.removeEventListener('abort', cancelled))
  })
}

/**
 * Called only when the user explicitly opens the Jujutsu graph. The nearest
 * marker wins: never create metadata in a plain folder or beyond a nested Git
 * boundary, and never repair/remove an existing (including broken) .jj marker.
 *
 * JJ 0.46 rejects --ignore-working-copy for git init. The command-local
 * auto-track override keeps untracked files untracked and preserves staged and
 * unstaged content; JJ may refresh Git's index cache and info/exclude. Later JJ
 * snapshot commands have their usual independent Git-index effects.
 */
export const ensureJujutsuRepository = async (options: {
  readonly path: string
  readonly runJj: RepositoryInitRunner
  readonly signal?: AbortSignal | undefined
}): Promise<EnsuredJujutsuRepository> => {
  const { path, runJj, signal } = options
  try {
    checkCancelled(signal)
    if (path.length === 0 || path.includes('\0')) fail(messages.path)
    const selection = await realpath(path)
    if (!(await stat(selection)).isDirectory()) fail(messages.path)
    const boundary = await discover(selection, signal)
    const pending = pendingInits.get(boundary.root)
    if (pending !== undefined) return await waitFor(pending, signal)
    if (boundary.kind === 'jj') {
      await verifyRoot(boundary.root, runJj, signal, true)
      return { root: boundary.root, initialized: false }
    }
    const initialize = async (): Promise<EnsuredJujutsuRepository> => {
      checkCancelled(signal)
      if ((await realpath(path)) !== selection) fail(messages.changed)
      const confirmed = await discover(selection, signal)
      if (confirmed.root !== boundary.root || confirmed.kind !== 'git' || confirmed.identity !== boundary.identity) fail(messages.changed)
      // Last metadata/identity check immediately before the managed mutation.
      if ((await realpath(boundary.root)) !== boundary.root || (await entry(join(boundary.root, '.jj'))) !== undefined) fail(messages.changed)
      checkCancelled(signal)
      try {
        await runJj(boundary.root, ['--config=snapshot.auto-track=none()', 'git', 'init', '--colocate'], signal)
      } catch {
        checkCancelled(signal)
        fail(boundary.worktree ? messages.worktree : messages.init)
      }
      if ((await gitIdentity(boundary.root, await lstat(join(boundary.root, '.git')))) !== boundary.identity) fail(messages.changed)
      if ((await entry(join(boundary.root, '.jj'))) === undefined) fail(messages.root)
      await verifyRoot(boundary.root, runJj, signal, false)
      return { root: boundary.root, initialized: true }
    }
    const operation = initialize()
    pendingInits.set(boundary.root, operation)
    // Delete only our own entry; do not leave a rejected cleanup promise behind.
    void operation.then(
      () => {
        if (pendingInits.get(boundary.root) === operation) pendingInits.delete(boundary.root)
      },
      () => {
        if (pendingInits.get(boundary.root) === operation) pendingInits.delete(boundary.root)
      },
    )
    return await waitFor(operation, signal)
  } catch (error) {
    if (error instanceof RepositoryInitializationError) throw error
    checkCancelled(signal)
    fail(messages.marker)
  }
}
