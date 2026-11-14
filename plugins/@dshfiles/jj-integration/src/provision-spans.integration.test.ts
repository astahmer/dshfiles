import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { ThreadWorkspaceModel } from './thread-workspace-model.js'
import { ThreadWorkspacesTestSupport } from './thread-workspaces-test-support.js'
import { ThreadWorkspaces } from './thread-workspaces.js'

const jjAvailable = spawnSync('jj', ['--version']).status === 0

const jj = (cwd: string, ...args: string[]): void => {
  execFileSync('jj', ['--color=never', '--no-pager', ...args], { cwd, stdio: 'ignore', env: { ...process.env, JJ_CONFIG: '' } })
}

const repository = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'jj-provision-spans-')))
  const repo = join(root, 'repo')
  execFileSync('jj', ['git', 'init', repo], { stdio: 'ignore', env: { ...process.env, JJ_CONFIG: '' } })
  jj(repo, 'config', 'set', '--repo', 'user.name', 'Test')
  jj(repo, 'config', 'set', '--repo', 'user.email', 'test@example.com')
  writeFileSync(join(repo, 'shared.txt'), 'one\n')
  jj(repo, 'commit', '-m', 'base')
  jj(repo, 'bookmark', 'create', 'main', '-r', '@-')
  return { root, repo }
}

describe.skipIf(!jjAvailable)('thread workspace provisioning spans', () => {
  it.effect('names the wait for a warming spare and whether provisioning claimed one', () =>
    Effect.gen(function* () {
      const { root, repo } = repository()
      try {
        using recorder = recordSpans()
        const threads = yield* ThreadWorkspaces
        // No spare yet: nothing to wait for, and the workspace is checked out from scratch. It starts the next spare.
        yield* threads.provision(repo)
        // The spare is still being added: the next send waits for it, then claims it instead of adding another.
        yield* threads.provision(repo)
        const waits = recorder.spans.filter(span => span.name === 'thread workspaces await warming')
        expect(waits.map(span => span.attributes['dshx.thread.warming_awaited'])).toEqual([false, true])
        const provisions = recorder.spans.filter(span => span.name === 'thread workspaces provision')
        expect(provisions.map(span => span.attributes['dshx.thread.spare_claimed'])).toEqual([false, true])
        for (const span of [...waits, ...provisions]) expect(JSON.stringify(span.attributes)).not.toContain(root)
      } finally {
        rmSync(ThreadWorkspaceModel.defaultThreadsDirectory(repo), { recursive: true, force: true })
        rmSync(root, { recursive: true, force: true })
      }
    }).pipe(Effect.provide(ThreadWorkspacesTestSupport.layer()), Effect.provide(DshxEffect.tracerLayer)),
  )
})
