import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeServices } from '@effect/platform-node'
import { Jj } from '@dshfiles/jj-cli'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BacklogMainBranch } from './main-branch.js'

const layer = Layer.provideMerge(Jj.layer, NodeServices.layer)

describe('the main branch revset against a real jj repository', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'backlog-main-branch-'))
    const env = { ...process.env, JJ_USER: 'Test', JJ_EMAIL: 'test@example.com', JJ_CONFIG: '/dev/null' }
    execFileSync('jj', ['git', 'init'], { cwd: root, env, stdio: 'ignore' })
    execFileSync('jj', ['bookmark', 'set', 'develop', '-r', '@'], { cwd: root, env, stdio: 'ignore' })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('answers the revset of a bookmark the repository has, and nothing for one it lacks', async () => {
    const resolve = (bookmark: string) => Effect.runPromise(Effect.provide(BacklogMainBranch.resolvedRevset({ repository: root, bookmark }), layer))
    expect(await resolve('develop')).toBe(BacklogMainBranch.bookmarkRevset('develop'))
    expect(await resolve('main')).toBeUndefined()
  })
})
