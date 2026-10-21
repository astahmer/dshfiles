import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { remoteHostSchema, type RemoteHost } from './core.js'
import { runProcess } from './process-runner.js'
import { PeerSnapshotModel, type PeerShellRunner } from './remote.js'

const exec = promisify(execFile)
const runPeerSnapshot = PeerSnapshotModel.run

const jj = async (cwd: string, args: readonly string[]): Promise<string> => {
  const { stdout } = await exec('jj', [...args], { cwd, maxBuffer: 4 * 1024 * 1024 })
  return stdout.trim()
}

const git = async (cwd: string, args: readonly string[]): Promise<string> => {
  const { stdout } = await exec('git', [...args], { cwd, maxBuffer: 4 * 1024 * 1024 })
  return stdout.trim()
}

const available = async (): Promise<boolean> => {
  try {
    await exec('jj', ['--version'])
    await exec('git', ['--version'])
    return true
  } catch {
    return false
  }
}

const revisionOf = (cwd: string): Promise<string> => jj(cwd, ['log', '--no-graph', '-r', '@', '--template', 'commit_id'])

describe.skipIf(!(await available()))('peer checker integration', () => {
  let root = ''
  let local = ''
  let peer = ''
  let remote: RemoteHost
  let firstRevision = ''

  const runPeer: PeerShellRunner = async ({ command, timeoutMs }) => runProcess({ file: 'sh', args: ['-c', command], cwd: root, timeoutMs })
  const runLocalGit = async ({ args, timeoutMs }: { readonly args: readonly string[]; readonly timeoutMs: number }) =>
    runProcess({ file: 'jj', args, cwd: local, timeoutMs })

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'peer-check-'))
    local = join(root, 'local')
    peer = join(root, 'peer')
    const bare = join(root, 'peer.git')

    await git(root, ['init', '--bare', '-q', bare])
    await mkdir(local)
    await git(local, ['init', '-q'])
    await jj(local, ['git', 'init', '--colocate'])
    await writeFile(join(local, '.gitignore'), 'node_modules/\ninstalled.log\n')
    await writeFile(join(local, 'pnpm-lock.yaml'), 'lockfile v1\n')
    await writeFile(join(local, 'a.txt'), 'first\n')
    await jj(local, ['describe', '-m', 'feat: first'])
    firstRevision = await revisionOf(local)
    await jj(local, ['git', 'remote', 'add', 'peer', bare])

    await jj(root, ['git', 'init', peer])
    await jj(root, ['-R', peer, 'git', 'remote', 'add', 'origin', bare])

    remote = remoteHostSchema.parse({
      id: 'peer',
      sshTarget: 'peer-host',
      gitRemote: 'peer',
      peerRemote: 'origin',
      workspace: peer,
      install: {
        command: [process.execPath, '-e', 'require("node:fs").appendFileSync("installed.log", "install\\n")'],
        whenPaths: ['pnpm-lock.yaml'],
        timeoutMs: 30_000,
      },
    })
  }, 120_000)

  afterAll(async () => {
    if (root.length > 0) await rm(root, { recursive: true, force: true })
  })

  it('materializes the exact local revision on the peer and runs there', async () => {
    const outcome = await runPeerSnapshot({
      remote,
      revision: firstRevision,
      changeId: await jj(local, ['log', '--no-graph', '-r', '@', '--template', 'change_id']),
      action: { command: process.execPath, args: ['-e', 'process.stdout.write("checked")'], timeoutMs: 30_000 },
      runLocalGit,
      runPeerShell: runPeer,
    })

    expect(outcome).toMatchObject({ ok: true, exitCode: 0, stdout: 'checked' })
    expect(await revisionOf(peer)).toBe(firstRevision)
    expect(await readFile(join(peer, 'a.txt'), 'utf8')).toBe('first\n')
  }, 120_000)

  it('keeps ignored peer state across snapshots and follows a rewritten revision', async () => {
    await mkdir(join(peer, 'node_modules'), { recursive: true })
    await writeFile(join(peer, 'node_modules', 'marker.txt'), 'cached\n')

    await writeFile(join(local, 'a.txt'), 'second\n')
    await jj(local, ['describe', '-m', 'feat: second'])
    const secondRevision = await revisionOf(local)

    const outcome = await runPeerSnapshot({
      remote,
      revision: secondRevision,
      changeId: await jj(local, ['log', '--no-graph', '-r', '@', '--template', 'change_id']),
      action: { command: process.execPath, args: ['-e', 'process.stdout.write("ok")'], timeoutMs: 30_000 },
      runLocalGit,
      runPeerShell: runPeer,
    })

    expect(outcome).toMatchObject({ ok: true, exitCode: 0 })
    expect(await revisionOf(peer)).toBe(secondRevision)
    expect(await readFile(join(peer, 'a.txt'), 'utf8')).toBe('second\n')
    expect(await readFile(join(peer, 'node_modules', 'marker.txt'), 'utf8')).toBe('cached\n')
  }, 120_000)

  it('returns the peer exit code and detects an action that moves the peer working copy', async () => {
    const failing = await runPeerSnapshot({
      remote,
      revision: await revisionOf(local),
      changeId: await jj(local, ['log', '--no-graph', '-r', '@', '--template', 'change_id']),
      action: { command: process.execPath, args: ['-e', 'process.exit(3)'], timeoutMs: 30_000 },
      runLocalGit,
      runPeerShell: runPeer,
    })
    expect(failing).toMatchObject({ ok: true, exitCode: 3 })

    const mutating = await runPeerSnapshot({
      remote,
      revision: await revisionOf(local),
      changeId: await jj(local, ['log', '--no-graph', '-r', '@', '--template', 'change_id']),
      action: { command: process.execPath, args: ['-e', 'require("node:fs").writeFileSync("b.txt", "dirty")'], timeoutMs: 30_000 },
      runLocalGit,
      runPeerShell: runPeer,
    })
    expect(mutating.ok).toBe(false)
    if (!mutating.ok) expect(mutating.code).toBe('peer-source-changed')
  }, 120_000)

  it('installs only when the tracked lockfile changed', async () => {
    const logPath = join(peer, 'installed.log')
    const readLog = async (): Promise<string> => {
      try {
        return await readFile(logPath, 'utf8')
      } catch {
        return ''
      }
    }
    const sameRevision = await runPeerSnapshot({
      remote,
      revision: await revisionOf(local),
      changeId: await jj(local, ['log', '--no-graph', '-r', '@', '--template', 'change_id']),
      action: { command: process.execPath, args: ['-e', 'process.stdout.write("ok")'], timeoutMs: 30_000 },
      runLocalGit,
      runPeerShell: runPeer,
    })
    expect(sameRevision.ok).toBe(true)
    const baseline = await readLog()

    await writeFile(join(local, 'pnpm-lock.yaml'), 'lockfile v2\n')
    await jj(local, ['describe', '-m', 'feat: lockfile'])
    const changed = await runPeerSnapshot({
      remote,
      revision: await revisionOf(local),
      changeId: await jj(local, ['log', '--no-graph', '-r', '@', '--template', 'change_id']),
      action: { command: process.execPath, args: ['-e', 'process.stdout.write("ok")'], timeoutMs: 30_000 },
      runLocalGit,
      runPeerShell: runPeer,
    })
    expect(changed.ok).toBe(true)
    expect((await readLog()).length).toBeGreaterThan(baseline.length)
  }, 120_000)

  it('reports an unreachable peer instead of trusting a result', async () => {
    const outcome = await runPeerSnapshot({
      remote,
      revision: await revisionOf(local),
      changeId: await jj(local, ['log', '--no-graph', '-r', '@', '--template', 'change_id']),
      action: { command: process.execPath, args: ['-e', 'process.stdout.write("ok")'], timeoutMs: 30_000 },
      runLocalGit,
      runPeerShell: async () => ({ code: null, stdout: '', stderr: 'ssh: connect to host peer-host port 22: Connection refused', failure: 'spawn-failed' }),
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.code).toBe('peer-unreachable')
      expect(outcome.message).toContain('Connection refused')
    }
  }, 120_000)
})
