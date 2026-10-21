import { describe, expect, it } from 'vitest'
import { remoteHostSchema, type RemoteHost } from './core.js'
import { PeerSnapshotModel, type PeerShellRunner, type StepResult } from './remote.js'

const { command: buildPeerCommand, jjCommand: buildPeerJjCommand, changeId: parseChangeId, revision: parseRevision } = PeerSnapshotModel
const shellQuote = PeerSnapshotModel.quote
const snapshotBookmark = PeerSnapshotModel.bookmark
const runPeerSnapshot = PeerSnapshotModel.run

const TARGET = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)

const ok = (stdout = ''): StepResult => ({ code: 0, stdout, stderr: '', failure: null })
const exited = (code: number, stderr = ''): StepResult => ({ code, stdout: '', stderr, failure: null })
const broken = (failure: StepResult['failure'], stderr = ''): StepResult => ({ code: null, stdout: '', stderr, failure })

const remote = (patch: Partial<RemoteHost> = {}): RemoteHost =>
  remoteHostSchema.parse({ id: 'm1', sshTarget: 'm1-perso', gitRemote: 'm1', workspace: '/Users/peer/dev/dshfiles-check', ...patch })

const action = { command: 'echo', args: ['ran'], timeoutMs: 1_000 }

interface Script {
  readonly push?: StepResult
  readonly fetch?: StepResult
  readonly forget?: StepResult
  readonly edit?: StepResult
  readonly diff?: StepResult
  readonly install?: StepResult
  readonly run?: StepResult
  readonly revisions?: readonly StepResult[]
}

const createPeer = (script: Script) => {
  const peerCommands: string[] = []
  const localCommands: string[][] = []
  const revisions = [...(script.revisions ?? [])]
  const runPeerShell: PeerShellRunner = async ({ command }) => {
    peerCommands.push(command)
    if (command.includes("'git' 'fetch'")) return script.fetch ?? ok()
    if (command.includes("'bookmark' 'forget'")) return script.forget ?? ok()
    if (command.includes("'diff'")) return script.diff ?? ok()
    if (command.includes("'edit'")) return script.edit ?? ok()
    if (command.includes("'commit_id'")) return revisions.shift() ?? ok(TARGET)
    if (command.includes("'install-peers'")) return script.install ?? ok()
    return script.run ?? ok()
  }
  return {
    peerCommands,
    localCommands,
    runPeerShell,
    runLocalGit: async ({ args }: { readonly args: readonly string[] }) => {
      localCommands.push([...args])
      return script.push ?? ok()
    },
  }
}

describe('peer snapshot protocol', () => {
  it('pushes one named snapshot, materializes it and runs the action there', async () => {
    const peer = createPeer({ revisions: [ok(OTHER), ok(TARGET), ok(TARGET)], run: ok('checked') })
    const outcome = await runPeerSnapshot({
      remote: remote(),
      revision: TARGET,
      changeId: 'abcdefghijklmnop',
      action,
      runLocalGit: peer.runLocalGit,
      runPeerShell: peer.runPeerShell,
    })

    expect(outcome).toEqual({ ok: true, exitCode: 0, stdout: 'checked', stderr: '' })
    expect(peer.localCommands).toEqual([
      ['bookmark', 'set', 'dsh-check/abcdefghijklmnop', '-r', '@', '--allow-backwards'],
      ['bookmark', 'track', 'dsh-check/abcdefghijklmnop@m1'],
      ['git', 'push', '--bookmark', 'dsh-check/abcdefghijklmnop', '--remote', 'm1', '--allow-empty-description'],
    ])
    expect(peer.peerCommands[1]).toContain("'git' 'fetch' '--remote' 'origin'")
    expect(peer.peerCommands.some(command => command.includes("'bookmark' 'forget' 'dsh-check/abcdefghijklmnop'"))).toBe(true)
    expect(peer.peerCommands.some(command => command.includes("'edit'"))).toBe(true)
    expect(peer.peerCommands.some(command => command.includes("'echo' 'ran'"))).toBe(true)
    expect(peer.peerCommands.at(-1)).toContain("'commit_id'")
  })

  it('reports a failing snapshot push without touching the peer', async () => {
    const peer = createPeer({ push: exited(1, 'error: no such remote m1') })
    const outcome = await runPeerSnapshot({
      remote: remote(),
      revision: TARGET,
      changeId: 'abcdefghijklmnop',
      action,
      runLocalGit: peer.runLocalGit,
      runPeerShell: peer.runPeerShell,
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('peer-push-failed')
    expect(outcome.message).toContain('no such remote m1')
    expect(peer.peerCommands).toEqual([])
  })

  it('distinguishes an unreachable peer, a failed checkout and a moved revision', async () => {
    const unreachable = createPeer({ fetch: broken('spawn-failed', 'ssh: connect to host: Connection refused') })
    const fetchOutcome = await runPeerSnapshot({
      remote: remote(),
      revision: TARGET,
      changeId: 'abcdefghijklmnop',
      action,
      runLocalGit: unreachable.runLocalGit,
      runPeerShell: unreachable.runPeerShell,
    })
    expect(fetchOutcome.ok).toBe(false)
    if (!fetchOutcome.ok) {
      expect(fetchOutcome.code).toBe('peer-unreachable')
      expect(fetchOutcome.message).toContain('Connection refused')
    }

    const editFailure = createPeer({ edit: exited(1, 'immutable') })
    const editOutcome = await runPeerSnapshot({
      remote: remote(),
      revision: TARGET,
      changeId: 'abcdefghijklmnop',
      action,
      runLocalGit: editFailure.runLocalGit,
      runPeerShell: editFailure.runPeerShell,
    })
    expect(editOutcome.ok).toBe(false)
    if (!editOutcome.ok) expect(editOutcome.code).toBe('peer-edit-failed')

    const mismatch = createPeer({ revisions: [ok(TARGET), ok(OTHER)] })
    const mismatchOutcome = await runPeerSnapshot({
      remote: remote(),
      revision: TARGET,
      changeId: 'abcdefghijklmnop',
      action,
      runLocalGit: mismatch.runLocalGit,
      runPeerShell: mismatch.runPeerShell,
    })
    expect(mismatchOutcome.ok).toBe(false)
    if (!mismatchOutcome.ok) {
      expect(mismatchOutcome.code).toBe('peer-revision-mismatch')
      expect(mismatchOutcome.message).toContain(OTHER.slice(0, 12))
    }
  })

  it('keeps a failing command as a failed receipt when the peer stayed put', async () => {
    const peer = createPeer({ revisions: [ok(TARGET), ok(TARGET), ok(TARGET)], run: exited(2, 'lint failed') })
    const outcome = await runPeerSnapshot({
      remote: remote(),
      revision: TARGET,
      changeId: 'abcdefghijklmnop',
      action,
      runLocalGit: peer.runLocalGit,
      runPeerShell: peer.runPeerShell,
    })

    expect(outcome).toEqual({ ok: true, exitCode: 2, stdout: '', stderr: 'lint failed' })
  })

  it('reports a peer command that outlived the action timeout, and a moved working copy', async () => {
    const timedOut = createPeer({ revisions: [ok(TARGET), ok(TARGET)], run: broken('timed-out') })
    const timeoutOutcome = await runPeerSnapshot({
      remote: remote(),
      revision: TARGET,
      changeId: 'abcdefghijklmnop',
      action,
      runLocalGit: timedOut.runLocalGit,
      runPeerShell: timedOut.runPeerShell,
    })
    expect(timeoutOutcome.ok).toBe(false)
    if (!timeoutOutcome.ok) expect(timeoutOutcome.code).toBe('peer-timeout')

    const moved = createPeer({ revisions: [ok(TARGET), ok(TARGET), ok(OTHER)] })
    const movedOutcome = await runPeerSnapshot({
      remote: remote(),
      revision: TARGET,
      changeId: 'abcdefghijklmnop',
      action,
      runLocalGit: moved.runLocalGit,
      runPeerShell: moved.runPeerShell,
    })
    expect(movedOutcome.ok).toBe(false)
    if (!movedOutcome.ok) expect(movedOutcome.code).toBe('peer-source-changed')
  })

  it('installs on the first run and whenever the tracked paths changed', async () => {
    const install = { command: ['install-peers'], whenPaths: ['pnpm-lock.yaml'], timeoutMs: 1_000 }
    const first = createPeer({ revisions: [ok(''), ok(TARGET), ok(TARGET)] })
    await runPeerSnapshot({
      remote: remote({ install }),
      revision: TARGET,
      changeId: 'abcdefghijklmnop',
      action,
      runLocalGit: first.runLocalGit,
      runPeerShell: first.runPeerShell,
    })
    expect(first.peerCommands.some(command => command.includes("'install-peers'"))).toBe(true)

    const unchanged = createPeer({ revisions: [ok(TARGET), ok(TARGET), ok(TARGET)] })
    await runPeerSnapshot({
      remote: remote({ install }),
      revision: TARGET,
      changeId: 'abcdefghijklmnop',
      action,
      runLocalGit: unchanged.runLocalGit,
      runPeerShell: unchanged.runPeerShell,
    })
    expect(unchanged.peerCommands.some(command => command.includes("'install-peers'"))).toBe(false)
    expect(unchanged.peerCommands.some(command => command.includes("'diff'"))).toBe(false)

    const lockfileChanged = createPeer({ revisions: [ok(OTHER), ok(TARGET), ok(TARGET)], diff: ok('M pnpm-lock.yaml\n') })
    await runPeerSnapshot({
      remote: remote({ install }),
      revision: TARGET,
      changeId: 'abcdefghijklmnop',
      action,
      runLocalGit: lockfileChanged.runLocalGit,
      runPeerShell: lockfileChanged.runPeerShell,
    })
    expect(lockfileChanged.peerCommands.some(command => command.includes("'pnpm-lock.yaml'"))).toBe(true)
    expect(lockfileChanged.peerCommands.some(command => command.includes("'install-peers'"))).toBe(true)

    const unrelatedChange = createPeer({ revisions: [ok(OTHER), ok(TARGET), ok(TARGET)], diff: ok('') })
    await runPeerSnapshot({
      remote: remote({ install }),
      revision: TARGET,
      changeId: 'abcdefghijklmnop',
      action,
      runLocalGit: unrelatedChange.runLocalGit,
      runPeerShell: unrelatedChange.runPeerShell,
    })
    expect(unrelatedChange.peerCommands.some(command => command.includes("'install-peers'"))).toBe(false)
  })

  it('ignores a bookmark cleanup failure and reports cancellation', async () => {
    const peer = createPeer({ revisions: [ok(TARGET), ok(TARGET), ok(TARGET)], forget: exited(1) })
    const outcome = await runPeerSnapshot({
      remote: remote(),
      revision: TARGET,
      changeId: 'abcdefghijklmnop',
      action,
      runLocalGit: peer.runLocalGit,
      runPeerShell: peer.runPeerShell,
    })
    expect(outcome.ok).toBe(true)

    const cancelled = createPeer({ revisions: [ok(TARGET), ok(TARGET)], run: broken('cancelled') })
    const cancelledOutcome = await runPeerSnapshot({
      remote: remote(),
      revision: TARGET,
      changeId: 'abcdefghijklmnop',
      action,
      runLocalGit: cancelled.runLocalGit,
      runPeerShell: cancelled.runPeerShell,
    })
    expect(cancelledOutcome.ok).toBe(false)
    if (!cancelledOutcome.ok) expect(cancelledOutcome.code).toBe('peer-cancelled')
  })
})

describe('peer command construction', () => {
  it('quotes every token and the workspace path', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
    expect(buildPeerJjCommand({ workspace: '/tmp/a b', args: ['git', 'fetch'] })).toBe(`cd '/tmp/a b' && jj 'git' 'fetch'`)
    expect(
      buildPeerCommand({
        workspace: '/tmp/a b',
        toolchain: ['mise', 'exec', 'node@22.23.3', '--'],
        args: ['pnpm', 'test', '--filter', "@dshfiles/it's"],
      }),
    ).toBe(String.raw`cd '/tmp/a b' && 'mise' 'exec' 'node@22.23.3' '--' 'pnpm' 'test' '--filter' '@dshfiles/it'\''s'`)
  })

  it('accepts only whole revision and change-id lines', () => {
    expect(parseRevision(`${TARGET}\n`)).toBe(TARGET)
    expect(parseRevision(`warning\n${TARGET}`)).toBeNull()
    expect(parseRevision('main')).toBeNull()
    expect(parseChangeId('abcdefghijklmnop\n')).toBe('abcdefghijklmnop')
    expect(parseChangeId('short')).toBeNull()
    expect(snapshotBookmark('abc')).toBe('dsh-check/abc')
  })
})
