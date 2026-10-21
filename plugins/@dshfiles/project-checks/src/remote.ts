import type { RemoteHost } from './core.js'

const REVISION_PATTERN = /^[a-f0-9]{40,64}$/
const CHANGE_ID_PATTERN = /^[a-z]{16,64}$/

const SSH_OPTIONS = [
  '-o',
  'BatchMode=yes',
  '-o',
  'StrictHostKeyChecking=yes',
  '-o',
  'ExitOnForwardFailure=yes',
  '-o',
  'ForwardAgent=no',
  '-o',
  'PermitLocalCommand=no',
  '-o',
  'ConnectTimeout=8',
  '-o',
  'ServerAliveInterval=10',
  '-o',
  'ServerAliveCountMax=2',
] as const

/** The peer's checker repository holds no user work, so every snapshot stays rewritable there. */
const PEER_IMMUTABLE_OVERRIDE = 'revset-aliases."immutable_heads()"="none()"'

const PUSH_TIMEOUT_MS = 120_000
const BOOKKEEPING_TIMEOUT_MS = 30_000
const SSH_TIMEOUT_MS = 60_000
const MESSAGE_LIMIT = 240

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

/** One stable peer ref per jj change: repeated snapshots of a thread overwrite it instead of growing refs. */
const snapshotBookmark = (changeId: string): string => `dsh-check/${changeId}`

const bookmarkSetArgs = (changeId: string): readonly string[] => ['bookmark', 'set', snapshotBookmark(changeId), '-r', '@', '--allow-backwards']

const bookmarkTrackArgs = ({ changeId, gitRemote }: { readonly changeId: string; readonly gitRemote: string }): readonly string[] => [
  'bookmark',
  'track',
  `${snapshotBookmark(changeId)}@${gitRemote}`,
]

const pushBookmarkArgs = ({ gitRemote, changeId }: { readonly gitRemote: string; readonly changeId: string }): readonly string[] => [
  'git',
  'push',
  '--bookmark',
  snapshotBookmark(changeId),
  '--remote',
  gitRemote,
  '--allow-empty-description',
]

const peerFetchArgs = (peerRemote: string): readonly string[] => ['git', 'fetch', '--remote', peerRemote]

const peerForgetArgs = (bookmark: string): readonly string[] => ['bookmark', 'forget', bookmark]

const peerEditArgs = (revision: string): readonly string[] => ['--config', PEER_IMMUTABLE_OVERRIDE, 'edit', revision]

const peerRevisionArgs = (): readonly string[] => ['log', '--no-graph', '-r', '@', '--template', 'commit_id']

const peerChangeIdArgs = (): readonly string[] => ['log', '--no-graph', '-r', '@', '--template', 'change_id']

const peerDiffArgs = ({
  previousRevision,
  revision,
  paths,
}: {
  readonly previousRevision: string
  readonly revision: string
  readonly paths: readonly string[]
}): readonly string[] => ['--config', PEER_IMMUTABLE_OVERRIDE, 'diff', '--summary', '--from', previousRevision, '--to', revision, '--', ...paths]

const buildPeerJjCommand = ({ workspace, args }: { readonly workspace: string; readonly args: readonly string[] }): string =>
  `cd ${shellQuote(workspace)} && jj ${args.map(shellQuote).join(' ')}`

const buildPeerCommand = ({
  workspace,
  toolchain,
  args,
}: {
  readonly workspace: string
  readonly toolchain: readonly string[]
  readonly args: readonly string[]
}): string => `cd ${shellQuote(workspace)} && ${[...toolchain, ...args].map(shellQuote).join(' ')}`

const parseRevision = (stdout: string): string | null => {
  const value = stdout.trim()
  return REVISION_PATTERN.test(value) ? value : null
}

const parseChangeId = (stdout: string): string | null => {
  const value = stdout.trim()
  return CHANGE_ID_PATTERN.test(value) ? value : null
}

export interface StepResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly failure: 'cancelled' | 'timed-out' | 'spawn-failed' | null
}

export type LocalGitRunner = (input: {
  readonly args: readonly string[]
  readonly timeoutMs: number
  readonly signal: AbortSignal | undefined
}) => Promise<StepResult>

export type PeerShellRunner = (input: { readonly command: string; readonly timeoutMs: number; readonly signal: AbortSignal | undefined }) => Promise<StepResult>

export type PeerFailureCode =
  | 'peer-snapshot-unavailable'
  | 'peer-push-failed'
  | 'peer-unreachable'
  | 'peer-timeout'
  | 'peer-fetch-failed'
  | 'peer-edit-failed'
  | 'peer-revision-mismatch'
  | 'peer-install-failed'
  | 'peer-source-changed'
  | 'peer-cancelled'

export type PeerRunOutcome =
  | { readonly ok: true; readonly exitCode: number | null; readonly stdout: string; readonly stderr: string }
  | { readonly ok: false; readonly code: PeerFailureCode; readonly message: string }

export interface PeerActionRun {
  readonly remote: RemoteHost
  readonly revision: string
  readonly changeId: string
  readonly action: { readonly command: string; readonly args: readonly string[]; readonly timeoutMs: number }
  readonly signal?: AbortSignal | undefined
  readonly runLocalGit: LocalGitRunner
  readonly runPeerShell: PeerShellRunner
}

const summarize = (stderr: string): string => {
  const flattened = stderr
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return flattened.length > MESSAGE_LIMIT ? `${flattened.slice(0, MESSAGE_LIMIT - 1)}…` : flattened
}

const failureMessage = ({ step, result }: { readonly step: string; readonly result: StepResult }): string => {
  const detail = summarize(result.stderr)
  const reason =
    result.failure === 'timed-out'
      ? 'timed out'
      : result.failure === 'spawn-failed'
        ? 'could not start ssh'
        : result.failure === 'cancelled'
          ? 'was cancelled'
          : `exited ${result.code ?? 'unknown'}`
  return detail.length === 0 ? `${step} ${reason}` : `${step} ${reason}: ${detail}`
}

const TRANSPORT_FAILURE =
  /host key verification failed|permission denied|could not resolve hostname|name or service not known|connection refused|connection timed out|operation timed out|no route to host|broken pipe|connection closed/i

const stepCode = ({ step, result }: { readonly step: string; readonly result: StepResult }): PeerFailureCode => {
  if (result.failure === 'cancelled') return 'peer-cancelled'
  if (result.failure === 'timed-out') return 'peer-timeout'
  if (result.failure === 'spawn-failed') return 'peer-unreachable'
  if (result.code !== 0 && TRANSPORT_FAILURE.test(result.stderr)) return 'peer-unreachable'
  if (step === 'push') return 'peer-push-failed'
  if (step === 'fetch') return 'peer-fetch-failed'
  if (step === 'edit') return 'peer-edit-failed'
  if (step === 'install') return 'peer-install-failed'
  return 'peer-unreachable'
}

/**
 * Copies the working-copy revision to the peer, runs one action there, and proves the peer stayed
 * on that exact revision. Any deviation is reported instead of trusted.
 */
const runPeerSnapshot = async (input: PeerActionRun): Promise<PeerRunOutcome> => {
  const { remote, revision, changeId, signal } = input
  const bookmark = snapshotBookmark(changeId)
  const peerJj = async (args: readonly string[], timeoutMs = BOOKKEEPING_TIMEOUT_MS): Promise<StepResult> =>
    input.runPeerShell({ command: buildPeerJjCommand({ workspace: remote.workspace, args }), timeoutMs, signal })
  const peerCommand = async (args: readonly string[], timeoutMs: number): Promise<StepResult> =>
    input.runPeerShell({ command: buildPeerCommand({ workspace: remote.workspace, toolchain: remote.toolchain, args }), timeoutMs, signal })

  const bookmarkStep = await input.runLocalGit({
    args: bookmarkSetArgs(changeId),
    timeoutMs: BOOKKEEPING_TIMEOUT_MS,
    signal,
  })
  if (bookmarkStep.failure !== null || bookmarkStep.code !== 0) {
    return {
      ok: false,
      code: stepCode({ step: 'push', result: bookmarkStep }),
      message: failureMessage({ step: `Snapshot bookmark to ${remote.id}`, result: bookmarkStep }),
    }
  }

  // jj only creates a new remote bookmark for a tracked one; tracking is idempotent and the push
  // below reports the actionable error when the remote is misconfigured.
  await input.runLocalGit({
    args: bookmarkTrackArgs({ changeId, gitRemote: remote.gitRemote }),
    timeoutMs: BOOKKEEPING_TIMEOUT_MS,
    signal,
  })

  const push = await input.runLocalGit({
    args: pushBookmarkArgs({ gitRemote: remote.gitRemote, changeId }),
    timeoutMs: PUSH_TIMEOUT_MS,
    signal,
  })
  if (push.failure !== null || push.code !== 0) {
    return { ok: false, code: stepCode({ step: 'push', result: push }), message: failureMessage({ step: `Snapshot push to ${remote.id}`, result: push }) }
  }

  // Read the peer's materialized revision before fetching: a fetch may rebase its working copy onto
  // the new snapshot, which would hide which files the check is about to change.
  const previousRevision = parseRevision((await peerJj(peerRevisionArgs())).stdout)

  const fetch = await peerJj(peerFetchArgs(remote.peerRemote), SSH_TIMEOUT_MS)
  if (fetch.failure !== null || fetch.code !== 0) {
    return { ok: false, code: stepCode({ step: 'fetch', result: fetch }), message: failureMessage({ step: `Peer fetch on ${remote.id}`, result: fetch }) }
  }

  await peerJj(peerForgetArgs(bookmark))

  const edit = await peerJj(peerEditArgs(revision), SSH_TIMEOUT_MS)
  if (edit.failure !== null || edit.code !== 0) {
    return { ok: false, code: stepCode({ step: 'edit', result: edit }), message: failureMessage({ step: `Peer checkout on ${remote.id}`, result: edit }) }
  }

  const materialized = parseRevision((await peerJj(peerRevisionArgs())).stdout)
  if (materialized !== revision) {
    return {
      ok: false,
      code: 'peer-revision-mismatch',
      message: `Peer ${remote.id} checked out ${materialized?.slice(0, 12) ?? 'no revision'} instead of ${revision.slice(0, 12)}`,
    }
  }

  if (remote.install !== undefined) {
    const changed =
      previousRevision === null
        ? true
        : previousRevision === revision
          ? false
          : await hasChangedPaths({ peerJj, previousRevision, revision, paths: remote.install.whenPaths })
    if (changed) {
      const install = await peerCommand(remote.install.command, remote.install.timeoutMs)
      if (install.failure !== null || install.code !== 0) {
        return {
          ok: false,
          code: stepCode({ step: 'install', result: install }),
          message: failureMessage({ step: `Peer install on ${remote.id}`, result: install }),
        }
      }
    }
  }

  const run = await peerCommand([input.action.command, ...input.action.args], input.action.timeoutMs)
  if (run.failure === 'cancelled') return { ok: false, code: 'peer-cancelled', message: failureMessage({ step: `Peer run on ${remote.id}`, result: run }) }
  if (run.failure === 'timed-out') return { ok: false, code: 'peer-timeout', message: failureMessage({ step: `Peer run on ${remote.id}`, result: run }) }
  if (run.failure === 'spawn-failed') {
    return { ok: false, code: 'peer-unreachable', message: failureMessage({ step: `Peer run on ${remote.id}`, result: run }) }
  }

  const afterRevision = parseRevision((await peerJj(peerRevisionArgs())).stdout)
  if (run.code === 0 && afterRevision !== revision) {
    return {
      ok: false,
      code: 'peer-source-changed',
      message: `Peer ${remote.id} working copy moved to ${afterRevision?.slice(0, 12) ?? 'no revision'} while the check ran`,
    }
  }

  return { ok: true, exitCode: run.code, stdout: run.stdout, stderr: run.stderr }
}

const hasChangedPaths = async ({
  peerJj,
  previousRevision,
  revision,
  paths,
}: {
  readonly peerJj: (args: readonly string[], timeoutMs?: number) => Promise<StepResult>
  readonly previousRevision: string
  readonly revision: string
  readonly paths: readonly string[]
}): Promise<boolean> => {
  const diff = await peerJj(peerDiffArgs({ previousRevision, revision, paths }))
  if (diff.failure !== null || diff.code !== 0) return true
  return diff.stdout.trim().length > 0
}

export class PeerSnapshotModel {
  static readonly sshOptions = SSH_OPTIONS

  static readonly bookmarkSetArgs = bookmarkSetArgs
  static readonly trackArgs = bookmarkTrackArgs
  static readonly pushArgs = pushBookmarkArgs
  static readonly fetchArgs = peerFetchArgs
  static readonly forgetArgs = peerForgetArgs
  static readonly editArgs = peerEditArgs
  static readonly revisionArgs = peerRevisionArgs
  static readonly changeIdArgs = peerChangeIdArgs
  static readonly diffArgs = peerDiffArgs
  static readonly jjCommand = buildPeerJjCommand
  static readonly command = buildPeerCommand
  static readonly quote = shellQuote
  static readonly bookmark = snapshotBookmark
  static readonly revision = parseRevision
  static readonly changeId = parseChangeId
  static readonly run = runPeerSnapshot
}
