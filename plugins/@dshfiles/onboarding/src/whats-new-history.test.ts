import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { NodeServices } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'
import type { PackManagerSurface } from './plugin-manager-promise.js'
import { WhatsNewHistory } from './whats-new-history.js'
import type { WhatsNew, WhatsNewInput } from './whats-new-model.js'

const scratch = mkdtempSync(join(tmpdir(), 'onboarding-history-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const hasJj = (() => {
  try {
    execFileSync('jj', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const plugins = [
  { name: 'backlog', description: 'Backlog items.', ui: true, features: 3 },
  { name: 'onboarding', description: 'Getting started.', ui: true, features: 5 },
]

/** Records each call, then runs the real tool: the reader is tested against real jj and git repositories. */
const recording = (tool: 'jj' | 'git') => {
  const log = join(scratch, `${tool}-calls.log`)
  const file = join(scratch, `record-${tool}`)
  writeFileSync(file, `#!/bin/sh\nprintf "%s\\n" "$*" >> "${log}"\nexec ${tool} "$@"\n`)
  chmodSync(file, 0o755)
  return { file, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').length : 0), reset: () => rmSync(log, { force: true }) }
}
const jj = recording('jj')
const git = recording('git')

/** A dshfiles-shaped checkout: profile-sync marks it, the onboarding package is what the bundle record links. */
const checkout = (name: string): string => {
  const root = join(scratch, name)
  mkdirSync(join(root, 'plugins', '@dshfiles', 'onboarding'), { recursive: true })
  mkdirSync(join(root, 'scripts'), { recursive: true })
  writeFileSync(join(root, 'scripts', 'profile-sync.ts'), '')
  return root
}

const manager = (source: string | undefined): PackManagerSurface<string> => ({
  listPlugins: async () => [],
  setPluginEnabled: async () => ({ changed: false, application: 'applied' }),
  listBundles: async () => (source === undefined ? [{ name: '@dshfiles/onboarding' }] : [{ name: '@dshfiles/onboarding', source }]),
})

const read = (input: { readonly source: string | undefined; readonly request?: WhatsNewInput; readonly times?: number }): Promise<readonly WhatsNew[]> =>
  Effect.runPromise(
    WhatsNewHistory.use(history => Effect.forEach(Array.from({ length: input.times ?? 1 }), () => history.read(input.request ?? {}))).pipe(
      Effect.provide(
        WhatsNewHistory.layerFrom({ manager: () => manager(input.source), plugins, jjExecutable: jj.file, gitExecutable: git.file }).pipe(
          Layer.provide(NodeServices.layer),
        ),
      ),
      Effect.provide(DshxEffect.tracerLayer),
    ),
  )

const linkOf = (root: string): string => `link:${join(root, 'plugins', '@dshfiles', 'onboarding')}`

const gitRun = (root: string, args: readonly string[], date = '2026-11-10T09:00:00Z') =>
  execFileSync('git', [...args], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.invalid',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.invalid',
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
    encoding: 'utf8',
  }).trim()

/** main: two owned changes and a chore; `upstream/main`: one more feat that main lacks. No network: the remote ref is written locally. */
const gitCheckout = (name: string): string => {
  const root = checkout(name)
  gitRun(root, ['init', '--quiet', '--initial-branch', 'main'])
  gitRun(root, ['commit', '--quiet', '--allow-empty', '-m', 'feat(backlog): capture from the composer'], '2026-11-08T09:00:00Z')
  gitRun(root, ['commit', '--quiet', '--allow-empty', '-m', 'chore(backlog): regenerate'], '2026-11-09T09:00:00Z')
  gitRun(root, ['commit', '--quiet', '--allow-empty', '-m', 'fix(onboarding): keep the wizard closed'], '2026-11-10T09:00:00Z')
  gitRun(root, ['commit', '--quiet', '--allow-empty', '-m', 'feat(onboarding): show what is new upstream'], '2026-11-11T09:00:00Z')
  const ahead = gitRun(root, ['rev-parse', 'HEAD'])
  gitRun(root, ['reset', '--quiet', '--hard', 'HEAD~1'])
  gitRun(root, ['remote', 'add', 'fork-source', 'https://user:secret@example.invalid/dshfiles.git'])
  gitRun(root, ['update-ref', 'refs/remotes/fork-source/main', ahead])
  return root
}

describe('What’s new history on the Host', () => {
  it('reads a git checkout, names the upstream changes main lacks, and opens one onboarding history read span', async () => {
    const root = gitCheckout('git-span')
    git.reset()
    using recorder = recordSpans()
    const [value] = await read({ source: linkOf(root) })
    expect(value).toMatchObject({ state: 'ready', vcs: 'git', bookmark: 'main', more: false })
    if (value?.state !== 'ready') throw new Error('not ready')
    expect(value.entries.map(entry => [entry.plugin, entry.kind, entry.summary])).toEqual([
      ['onboarding', 'fix', 'keep the wizard closed'],
      ['backlog', 'feat', 'capture from the composer'],
    ])
    expect(value.upstream).toEqual([
      {
        remote: 'fork-source',
        bookmark: 'main',
        fetchCommand: 'git fetch fork-source',
        more: false,
        entries: [expect.objectContaining({ plugin: 'onboarding', summary: 'show what is new upstream' })],
      },
    ])
    expect(value.plugins.map(plugin => plugin.name)).toEqual(['onboarding', 'backlog'])
    expect(JSON.stringify(value)).not.toContain('secret')
    expect(JSON.stringify(value)).not.toContain(scratch)
    expect(recorder.span('onboarding history read').attributes).toMatchObject({
      'onboarding.history.state': 'ready',
      'onboarding.history.vcs': 'git',
      'onboarding.history.entries': 2,
      'onboarding.history.upstreams': 1,
    })
  })

  it('serves repeated reads from a short cache and slices them per request', async () => {
    const root = gitCheckout('git-cache')
    git.reset()
    const [first, second] = await read({ source: linkOf(root), times: 2, request: { plugin: 'backlog' } })
    expect(first).toEqual(second)
    expect(first).toMatchObject({ state: 'ready', entries: [{ plugin: 'backlog' }], upstream: [{ entries: [] }] })
    const calls = git.calls()
    expect(calls).toBeGreaterThan(0)
    await read({ source: linkOf(root), times: 3 })
    expect(git.calls()).toBe(calls * 2)
  })

  it.skipIf(!hasJj)('prefers jj in a jj checkout, never snapshotting the working copy', async () => {
    const root = checkout('jj-checkout')
    const env = { ...process.env, JJ_USER: 't', JJ_EMAIL: 't@example.invalid', JJ_TIMESTAMP: '2026-11-10T09:00:00Z' }
    const jjRun = (args: readonly string[]) => execFileSync('jj', [...args], { cwd: root, env, stdio: 'ignore' })
    jjRun(['git', 'init', '--quiet', '--colocate'])
    jjRun(['commit', '-m', 'feat(backlog): capture from the composer'])
    jjRun(['commit', '-m', 'docs(backlog): describe it'])
    jjRun(['bookmark', 'create', 'main', '-r', '@-'])
    jjRun(['commit', '-m', 'fix(onboarding): only upstream has this'])
    // A remote bookmark ahead of main, as a fetch would leave it; written locally, no network.
    const ahead = execFileSync('jj', ['log', '--no-graph', '-r', '@-', '-T', 'commit_id'], { cwd: root, env, encoding: 'utf8' }).trim()
    gitRun(root, ['remote', 'add', 'fork-source', 'https://example.invalid/dshfiles.git'])
    gitRun(root, ['update-ref', 'refs/remotes/fork-source/main', ahead])
    jjRun(['git', 'import'])
    jj.reset()
    const [value] = await read({ source: linkOf(root) })
    expect(value).toMatchObject({
      state: 'ready',
      vcs: 'jj',
      bookmark: 'main',
      entries: [{ plugin: 'backlog', kind: 'feat' }],
      upstream: [
        { remote: 'fork-source', bookmark: 'main', fetchCommand: 'jj git fetch --remote fork-source', entries: [{ plugin: 'onboarding', kind: 'fix' }] },
      ],
    })
    const calls = readFileSync(join(scratch, 'jj-calls.log'), 'utf8').trim().split('\n')
    expect(calls.every(call => call.startsWith('--ignore-working-copy'))).toBe(true)
  })

  it('reads nothing without a linked checkout, and points at the repository commits instead', async () => {
    git.reset()
    jj.reset()
    const [value] = await read({ source: undefined })
    expect(value).toMatchObject({
      state: 'no-checkout',
      reason: expect.stringMatching(/does not link Getting started/u),
      commitsUrl: expect.stringMatching(/^https:\/\/github\.com\//u),
    })
    expect(git.calls() + jj.calls()).toBe(0)
  })

  it('says how to recover when the checkout holds no history', async () => {
    const [value] = await read({ source: linkOf(checkout('no-history')) })
    expect(value).toMatchObject({ state: 'unreadable', reason: expect.stringMatching(/neither \.jj nor \.git/u) })
  })
})
