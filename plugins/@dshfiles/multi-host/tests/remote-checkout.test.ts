import { execFile as execFileCallback } from 'node:child_process'
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { ManagedRuntime } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { RemoteCheckout, type CheckoutSyncResult } from '../src/remote-checkout.js'
import { sshLayer } from './fixtures/ssh-runtime.js'

// Real jj repositories behind the fake ssh: the "host" is a folder here, origin a bare Git repository, and every sync
// runs the exact script a remote host runs. Nothing talks to another machine.

const execFile = promisify(execFileCallback)
const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-ssh.mjs')
const runtime = ManagedRuntime.make(sshLayer)
const originalEnvironment = { PATH: process.env.PATH, JJ_CONFIG: process.env.JJ_CONFIG, JJ_USER: process.env.JJ_USER, JJ_EMAIL: process.env.JJ_EMAIL }
const sshTarget = 'tester@fake-host'

let root = ''
let origin = ''
let publisher = ''
let host = ''

const jj = async (cwd: string, ...args: string[]): Promise<string> => (await execFile('jj', ['--color=never', '--no-pager', ...args], { cwd })).stdout

const write = (directory: string, name: string, text: string) => writeFile(join(directory, name), text)

const sync = (
  input: {
    readonly path?: string
    readonly bookmark?: string
    readonly apply?: boolean
    readonly expectedHead?: string
    readonly expectedTarget?: string
  } = {},
) =>
  runtime.runPromise(
    RemoteCheckout.run({
      sshTarget,
      path: input.path ?? host,
      bookmark: input.bookmark ?? 'main',
      apply: input.apply ?? false,
      expectedHead: input.expectedHead,
      expectedTarget: input.expectedTarget,
    }),
  )

const originTip = async (bookmark = 'main'): Promise<string> => (await execFile('git', ['-C', origin, 'rev-parse', `refs/heads/${bookmark}`])).stdout.trim()

/** A commit other hosts pushed: the publisher moves `bookmark` on origin. */
const publish = async (input: { readonly file: string; readonly text: string; readonly message: string; readonly bookmark?: string }) => {
  const bookmark = input.bookmark ?? 'main'
  await jj(publisher, 'git', 'fetch')
  await jj(publisher, 'new', `${bookmark}@origin`)
  await write(publisher, input.file, input.text)
  await jj(publisher, 'describe', '-m', input.message)
  await jj(publisher, 'bookmark', 'set', bookmark, '-r', '@')
  await jj(publisher, 'git', 'push', '--bookmark', bookmark)
}

const descriptions = async (revset: string, cwd = host): Promise<string[]> =>
  (await jj(cwd, '--ignore-working-copy', 'log', '--no-graph', '-r', revset, '-T', 'description.first_line() ++ "\\n"'))
    .split('\n')
    .filter(line => line.length > 0)

const statusSnapshot = async (cwd = host) => ({
  head: (await jj(cwd, 'log', '--no-graph', '-r', '@', '-T', 'commit_id')).trim(),
  parent: (await jj(cwd, 'log', '--no-graph', '-r', '@-', '-T', 'commit_id')).trim(),
})

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'multi-host-checkout-')))
  const bin = join(root, 'bin')
  await mkdir(bin)
  await cp(fixturePath, join(bin, 'fake-ssh.mjs'))
  await writeFile(join(bin, 'ssh'), `#!/bin/sh\nexec "${process.execPath}" "${join(bin, 'fake-ssh.mjs')}" "$@"\n`)
  await chmod(join(bin, 'ssh'), 0o755)
  await writeFile(join(root, 'jj.toml'), '')
  process.env.PATH = `${bin}:${originalEnvironment.PATH ?? ''}`
  process.env.JJ_CONFIG = join(root, 'jj.toml')
  process.env.JJ_USER = 'Tester'
  process.env.JJ_EMAIL = 'tester@example.com'
})

afterAll(async () => {
  await runtime.dispose()
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(root, { recursive: true, force: true })
})

beforeEach(async () => {
  const scenario = await mkdtemp(join(root, 'scenario-'))
  origin = join(scenario, 'origin.git')
  publisher = join(scenario, 'publisher')
  host = join(scenario, 'host checkout')
  await execFile('git', ['init', '--quiet', '--bare', origin])
  await execFile('jj', ['git', 'init', '--colocate', publisher])
  await jj(publisher, 'git', 'remote', 'add', 'origin', origin)
  await write(publisher, 'shared.txt', 'one\ntwo\nthree\n')
  await jj(publisher, 'describe', '-m', 'base')
  await jj(publisher, 'bookmark', 'create', 'main', '-r', '@')
  await jj(publisher, 'git', 'push', '--bookmark', 'main')
  await execFile('jj', ['git', 'clone', origin, host])
  await jj(host, 'new', 'main@origin')
}, 30_000)

const expectUntouched = async (before: Awaited<ReturnType<typeof statusSnapshot>>) => {
  expect(await statusSnapshot()).toEqual(before)
}

describe('checkout sync reports what would move', () => {
  test('counts incoming work only after fetching, on the requested bookmark', async () => {
    await publish({ file: 'incoming.txt', text: 'new', message: 'feat: incoming' })
    const preview = await sync()
    expect(preview).toMatchObject({ ok: true, applied: false, status: 'would-sync', bookmark: 'main' })
    expect(preview.incoming.total).toBe(1)
    expect(preview.incoming.revisions[0]?.description).toBe('feat: incoming')
    expect(preview.target).toBe(await originTip())
  }, 30_000)

  test('an up-to-date checkout says so, and a checkout with its own work says it is ahead', async () => {
    expect(await sync()).toMatchObject({ ok: true, status: 'up-to-date', detail: 'Up to date with main@origin.' })
    await write(host, 'mine.txt', 'mine')
    await jj(host, 'describe', '-m', 'feat: mine')
    const ahead = await sync()
    expect(ahead).toMatchObject({ ok: true, status: 'ahead' })
    expect(ahead.outgoing.revisions.map(revision => revision.description)).toEqual(['feat: mine'])
    expect(ahead.recovery[0]?.command).toContain('git push --bookmark')
  }, 30_000)

  test('a preview leaves commits and files as they were', async () => {
    await write(host, 'local.txt', 'local edit')
    await publish({ file: 'incoming.txt', text: 'new', message: 'feat: incoming' })
    await jj(host, 'status')
    const before = await statusSnapshot()
    expect(await sync()).toMatchObject({ status: 'would-sync' })
    await expectUntouched(before)
    expect(await readFile(join(host, 'local.txt'), 'utf8')).toBe('local edit')
    await expect(readFile(join(host, 'incoming.txt'), 'utf8')).rejects.toThrow()
  }, 30_000)

  test('reports which workspace this is and the others in the repository', async () => {
    const secondary = join(dirname(host), 'second')
    await jj(host, 'workspace', 'add', secondary, '--name', 'second')
    const report = await sync()
    expect(report.workspace).toMatchObject({ name: 'default', path: host })
    expect(report.otherWorkspaces).toMatchObject([{ name: 'second', path: secondary, blocksSync: false }])
    const fromSecondary = await sync({ path: secondary })
    expect(fromSecondary.workspace).toMatchObject({ name: 'second', path: secondary })
  }, 30_000)
})

describe('checkout sync applies safely', () => {
  test('rebases local edits onto origin, keeps them, and pushes nothing', async () => {
    await write(host, 'local.txt', 'local edit')
    await publish({ file: 'incoming.txt', text: 'new', message: 'feat: incoming' })
    const tipBefore = await originTip()
    const preview = await sync()
    const synced = await sync({ apply: true, expectedHead: preview.head, expectedTarget: preview.target })
    expect(synced).toMatchObject({ ok: true, applied: true, status: 'synced' })
    expect(await readFile(join(host, 'local.txt'), 'utf8')).toBe('local edit')
    expect(await readFile(join(host, 'incoming.txt'), 'utf8')).toBe('new')
    expect(await originTip()).toBe(tipBefore)
    expect(synced.head).toBe((await jj(host, '--ignore-working-copy', 'log', '--no-graph', '-r', '@', '-T', 'commit_id')).trim())
    const after = await sync()
    expect(after).toMatchObject({ status: 'ahead', incoming: { total: 0 } })
  }, 30_000)

  test('follows another bookmark, not main', async () => {
    await jj(publisher, 'bookmark', 'create', 'release', '-r', 'main@origin')
    await jj(publisher, 'git', 'push', '--bookmark', 'release')
    await publish({ file: 'release.txt', text: 'r', message: 'feat: release only', bookmark: 'release' })
    expect(await sync({ apply: true, bookmark: 'release' })).toMatchObject({ status: 'synced', applied: true })
    expect(await readFile(join(host, 'release.txt'), 'utf8')).toBe('r')
  }, 30_000)

  test('described work origin lacks refuses the sync and stays', async () => {
    await write(host, 'mine.txt', 'mine')
    await jj(host, 'describe', '-m', 'feat: unpushed')
    await publish({ file: 'incoming.txt', text: 'new', message: 'feat: incoming' })
    const before = await statusSnapshot()
    const applied = await sync({ apply: true })
    expect(applied).toMatchObject({ ok: false, applied: false, status: 'unpushed-work' })
    await expectUntouched(before)
    expect(await readFile(join(host, 'mine.txt'), 'utf8')).toBe('mine')
    expect(applied.recovery.map(step => step.command).join('\n')).toContain('rebase -b @')
  }, 30_000)

  test('described work origin already holds drops out instead of blocking', async () => {
    await write(host, 'landed.txt', 'same')
    await jj(host, 'describe', '-m', 'feat: landed elsewhere')
    await publish({ file: 'landed.txt', text: 'same', message: 'feat: landed' })
    const preview = await sync()
    expect(preview).toMatchObject({ status: 'would-sync' })
    expect(preview.absorbed.map(revision => revision.description)).toEqual(['feat: landed elsewhere'])
    expect(await sync({ apply: true })).toMatchObject({ status: 'synced' })
    expect(await readFile(join(host, 'landed.txt'), 'utf8')).toBe('same')
  }, 30_000)

  test('a conflicting rebase names the files and changes nothing', async () => {
    await write(host, 'shared.txt', 'one\nlocal\nthree\n')
    await publish({ file: 'shared.txt', text: 'one\nremote\nthree\n', message: 'feat: remote edit' })
    await jj(host, 'status')
    const before = await statusSnapshot()
    const applied = await sync({ apply: true })
    expect(applied).toMatchObject({ ok: false, applied: false, status: 'conflicted', conflictFiles: ['shared.txt'] })
    await expectUntouched(before)
    expect(await readFile(join(host, 'shared.txt'), 'utf8')).toBe('one\nlocal\nthree\n')
    expect(await descriptions('conflicts()')).toEqual([])
  }, 30_000)

  test('a confirmed sync refuses when the checkout moved after its preview', async () => {
    await publish({ file: 'incoming.txt', text: 'new', message: 'feat: incoming' })
    const preview = await sync()
    await write(host, 'late.txt', 'late edit')
    const applied = await sync({ apply: true, expectedHead: preview.head, expectedTarget: preview.target })
    expect(applied).toMatchObject({ ok: false, status: 'moved', applied: false })
    expect(await readFile(join(host, 'late.txt'), 'utf8')).toBe('late edit')
    await expect(readFile(join(host, 'incoming.txt'), 'utf8')).rejects.toThrow()
  }, 30_000)

  test('another workspace built on these revisions refuses the sync and is named', async () => {
    await write(host, 'mine.txt', 'mine')
    await jj(host, 'describe', '-m', 'wip')
    const child = join(dirname(host), 'child')
    await jj(host, 'workspace', 'add', child, '--name', 'child', '-r', '@')
    await write(child, 'child.txt', 'child work')
    await jj(child, 'status')
    await publish({ file: 'incoming.txt', text: 'new', message: 'feat: incoming' })
    const report = await sync({ apply: true })
    expect(report).toMatchObject({ ok: false, status: 'workspace-busy' })
    expect(report.detail).toContain('child')
    expect(report.otherWorkspaces).toMatchObject([{ name: 'child', blocksSync: true }])
    expect(await readFile(join(child, 'child.txt'), 'utf8')).toBe('child work')
  }, 30_000)

  test('a stale working copy refuses the sync with its recovery', async () => {
    const secondary = join(dirname(host), 'second')
    await jj(host, 'workspace', 'add', secondary, '--name', 'second')
    await write(secondary, 'second.txt', 'second')
    await jj(secondary, 'status')
    await jj(host, 'rebase', '-r', 'second@', '-d', 'root()')
    const report = await sync({ path: secondary, apply: true })
    expect(report).toMatchObject({ ok: false, status: 'stale' })
    expect(report.recovery[0]?.command).toContain('workspace update-stale')
  }, 30_000)
})

describe('a conflicted bookmark', () => {
  const diverge = async () => {
    await jj(host, 'new', 'main@origin')
    await write(host, 'local-side.txt', 'unpushed')
    await jj(host, 'describe', '-m', 'feat: local side')
    await jj(host, 'bookmark', 'set', 'main', '-r', '@')
    await jj(host, 'new')
    await publish({ file: 'remote-side.txt', text: 'pushed', message: 'feat: remote side' })
  }

  test('refuses the sync, names both sides and loses neither', async () => {
    await diverge()
    const report = await sync({ apply: true })
    expect(report).toMatchObject({ ok: false, applied: false, status: 'bookmark-conflict' })
    expect(report.bookmarkState.conflicted).toBe(true)
    expect(report.bookmarkState.local).toHaveLength(2)
    expect(report.bookmarkState.local).toContain(await originTip())
    expect(await descriptions('all()')).toEqual(expect.arrayContaining(['feat: local side', 'feat: remote side']))
  }, 30_000)

  test('keeping the local commits resolves it without dropping them', async () => {
    await diverge()
    const report = await sync()
    const command = report.recovery[0]?.command
    await execFile('sh', ['-c', command ?? 'false'])
    const after = await sync()
    expect(after.bookmarkState.conflicted).toBe(false)
    expect(await descriptions('::main')).toEqual(expect.arrayContaining(['feat: local side', 'feat: remote side']))
  }, 30_000)

  test('following origin resolves it and the local commits stay in the repository', async () => {
    await diverge()
    const report = await sync()
    await execFile('sh', ['-c', report.recovery.at(-1)?.command ?? 'false'])
    const after = await sync()
    expect(after.bookmarkState.conflicted).toBe(false)
    expect(await descriptions('all()')).toContain('feat: local side')
  }, 30_000)
})

describe('checkouts a sync cannot run on', () => {
  const statusOf = (report: CheckoutSyncResult) => ({ ok: report.ok, status: report.status })

  test('a missing path, a Git-only folder and a repository without origin each name their recovery', async () => {
    expect(statusOf(await sync({ path: join(root, 'absent') }))).toEqual({ ok: false, status: 'no-checkout' })
    const plain = join(dirname(host), 'plain')
    await mkdir(plain)
    const notJj = await sync({ path: plain })
    expect(statusOf(notJj)).toEqual({ ok: false, status: 'not-jj' })
    expect(notJj.recovery[0]?.command).toContain('jj git init --colocate')
    const lonely = join(dirname(host), 'lonely')
    await execFile('jj', ['git', 'init', lonely])
    const noRemote = await sync({ path: lonely })
    expect(statusOf(noRemote)).toEqual({ ok: false, status: 'fetch-failed' })
    expect(noRemote.recovery.length).toBeGreaterThan(0)
  }, 30_000)

  test('a bookmark origin does not have is reported, not guessed', async () => {
    const report = await sync({ bookmark: 'nope' })
    expect(statusOf(report)).toEqual({ ok: false, status: 'no-remote-bookmark' })
    expect(report.recovery[0]?.command).toContain('git push --bookmark')
  }, 30_000)
})

describe('workspace ownership', () => {
  test('names the threads running in each workspace, and only those', async () => {
    const report = await sync()
    const path = report.workspace?.path ?? ''
    const named = RemoteCheckout.withThreads({
      result: report,
      threads: [
        { sessionId: 'session-inside', title: 'Inside', cwd: `${path}/plugins` },
        { sessionId: 'session-sibling', title: 'Sibling', cwd: `${path}-other` },
      ],
    })
    expect(named.workspace?.threads).toEqual([{ sessionId: 'session-inside', title: 'Inside' }])
  }, 30_000)
})

describe('the login shell of a host', () => {
  test('never interprets the script, so zsh and fish run it the same', async () => {
    const zsh = await execFile('sh', ['-c', 'command -v zsh || true'])
    const script = `status=fine; printf '%s\\n' "$status"`
    expect(RemoteCheckout.remoteShell(script)).toBe(`sh -c 'status=fine; printf '\\''%s\\n'\\'' "$status"'`)
    if (zsh.stdout.trim() === '') return
    expect((await execFile(zsh.stdout.trim(), ['-c', RemoteCheckout.remoteShell(script)])).stdout).toBe('fine\n')
  })
})

describe('fetch before a remote thread', () => {
  test('fetches the thread folder with jj on a usual PATH and quotes the folder', () => {
    const command = RemoteCheckout.fetchBeforeThreadCommand("/Users/me/dev/it's here")
    expect(command).toContain('/opt/homebrew/bin')
    expect(command).toContain(`jj -R '/Users/me/dev/it'\\''s here' git fetch`)
    expect(command).not.toContain('rebase')
  })
})
