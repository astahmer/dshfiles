import { describe, expect, it } from 'vitest'
import { remoteHostSchema } from './core.js'
import { runProcess } from './process-runner.js'
import { PeerSnapshotModel, type PeerShellRunner } from './remote.js'

const spike = process.env.DSH_PEER_SPIKE === '1'
const repoCwd = process.cwd()
const runPeerSnapshot = PeerSnapshotModel.run

const jj = async (args: readonly string[]): Promise<string> => (await runProcess({ file: 'jj', args, cwd: repoCwd, timeoutMs: 60_000 })).stdout.trim()

/**
 * Real second machine: DSH_PEER_SPIKE=1 plus DSH_PEER_SSH, DSH_PEER_WORKSPACE and
 * DSH_PEER_GIT_REMOTE after the peer's bare repository and checker workspace exist.
 */
describe.skipIf(!spike)('peer host spike', () => {
  // Parse only when an opted-in test runs. Every remote target must be supplied
  // explicitly; collecting this skipped suite must not select a maintainer's host.
  const configuredPeer = () =>
    remoteHostSchema.parse({
      id: 'peer',
      sshTarget: process.env.DSH_PEER_SSH,
      gitRemote: process.env.DSH_PEER_GIT_REMOTE,
      peerRemote: 'origin',
      workspace: process.env.DSH_PEER_WORKSPACE,
      toolchain: ['mise', 'exec', 'node@22.23.3', '--'],
      install: {
        command: ['pnpm', 'install', '--frozen-lockfile'],
        whenPaths: ['pnpm-lock.yaml', 'pnpm-workspace.yaml'],
        timeoutMs: 900_000,
      },
    })

  const runLocalGit = async ({ args, timeoutMs }: { readonly args: readonly string[]; readonly timeoutMs: number }) =>
    runProcess({ file: 'jj', args, cwd: repoCwd, timeoutMs })
  const runPeerShell: PeerShellRunner = async ({ command, timeoutMs }) =>
    runProcess({ file: 'ssh', args: [...PeerSnapshotModel.sshOptions, configuredPeer().sshTarget, command], cwd: repoCwd, timeoutMs })

  it('runs the real repo check on M1 and keeps the revision identity', async () => {
    const remote = configuredPeer()
    const revision = await jj(['log', '--no-graph', '-r', '@', '--template', 'commit_id'])
    const changeId = await jj(['log', '--no-graph', '-r', '@', '--template', 'change_id'])
    const startedAt = Date.now()
    const outcome = await runPeerSnapshot({
      remote,
      revision,
      changeId,
      action: { command: 'node', args: ['--run', 'check:diff'], timeoutMs: 600_000 },
      runLocalGit,
      runPeerShell,
    })
    console.log('SPIKE check:diff', JSON.stringify(outcome).slice(0, 600), `${Date.now() - startedAt} ms`)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.exitCode).toBe(0)
    expect(await jj(['log', '--no-graph', '-r', '@', '--template', 'commit_id'])).toBe(revision)

    const secondStartedAt = Date.now()
    const second = await runPeerSnapshot({
      remote,
      revision,
      changeId,
      action: { command: 'node', args: ['-e', 'process.stdout.write("warm")'], timeoutMs: 120_000 },
      runLocalGit,
      runPeerShell,
    })
    console.log('SPIKE warm repeat', JSON.stringify(second).slice(0, 400), `${Date.now() - secondStartedAt} ms`)
    expect(second).toMatchObject({ ok: true, exitCode: 0, stdout: 'warm' })
  }, 1_800_000)

  it('reports a real failing action exit code from M1', async () => {
    const remote = configuredPeer()
    const outcome = await runPeerSnapshot({
      remote,
      revision: await jj(['log', '--no-graph', '-r', '@', '--template', 'commit_id']),
      changeId: await jj(['log', '--no-graph', '-r', '@', '--template', 'change_id']),
      action: { command: 'node', args: ['-e', 'process.exit(7)'], timeoutMs: 120_000 },
      runLocalGit,
      runPeerShell,
    })
    expect(outcome).toMatchObject({ ok: true, exitCode: 7 })
  }, 600_000)

  it('surfaces an unreachable peer as a protocol failure', async () => {
    const remote = configuredPeer()
    const missingHost: PeerShellRunner = async ({ command, timeoutMs }) =>
      runProcess({ file: 'ssh', args: [...PeerSnapshotModel.sshOptions, 'dsh-peer.invalid', command], cwd: repoCwd, timeoutMs })
    const outcome = await runPeerSnapshot({
      remote: { ...remote, sshTarget: 'dsh-peer.invalid' },
      revision: await jj(['log', '--no-graph', '-r', '@', '--template', 'commit_id']),
      changeId: await jj(['log', '--no-graph', '-r', '@', '--template', 'change_id']),
      action: { command: 'node', args: ['-e', '0'], timeoutMs: 30_000 },
      runLocalGit,
      runPeerShell: missingHost,
    })
    console.log('SPIKE unreachable', JSON.stringify(outcome).slice(0, 400))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe('peer-unreachable')
  }, 300_000)
})
